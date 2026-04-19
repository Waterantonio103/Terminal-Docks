import { useEffect, useRef, useState } from 'react';
import { Pane, MissionAgent, DbTask, useWorkspaceStore } from '../../store/workspace';
import agentsConfig from '../../config/agents.json';
import { Monitor, FileText, ChevronRight, Loader2, CheckCircle2, Clock, ListTree, Download } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

type HandoffEvent = {
  taskId?: number;
  fromRole: string;
  targetRole: string;
  title?: string;
  description?: string | null;
  payload?: string | null;
};

// Phase 2/3 special handoff edges.
const DONE_ROLE = 'done';
const RETRY_TARGETS = new Set(['builder', 'tester', 'security']);
const isRetryEdge = (h: HandoffEvent) => h.fromRole === 'reviewer' && RETRY_TARGETS.has(h.targetRole);

function AgentBadge({ agent }: { agent: MissionAgent }) {
  const role = agentsConfig.agents.find(a => a.id === agent.roleId);
  
  const statusIcon = agent.status === 'running' 
    ? <Loader2 size={10} className="animate-spin text-accent-primary" />
    : agent.status === 'completed'
    ? <CheckCircle2 size={10} className="text-green-400" />
    : agent.status === 'waiting'
    ? <Clock size={10} className="text-text-muted" />
    : null;

  return (
    <div className={`flex items-center gap-1.5 px-2 py-0.5 bg-bg-surface border rounded-md shrink-0 transition-colors ${
      agent.status === 'running' ? 'border-accent-primary/40 shadow-[0_0_8px_rgba(112,89,245,0.1)]' : 'border-border-panel'
    }`}>
      <span className={`text-xs font-medium ${agent.status === 'running' ? 'text-accent-primary' : 'text-text-primary'}`}>
        {agent.title}
      </span>
      {role && (
        <span className="text-[9px] text-text-muted opacity-60">
          {role.name}
        </span>
      )}
      {statusIcon && <div className="ml-0.5">{statusIcon}</div>}
    </div>
  );
}

export function MissionControlPane({ pane }: { pane: Pane }) {
  const taskDescription: string = pane.data?.taskDescription ?? '';
  const agents: MissionAgent[]  = pane.data?.agents ?? [];
  const pipeline: string[]      = pane.data?.pipeline ?? [];
  // Phase 3: stageGroups groups parallel roles (builder/tester/security) into
  // one stage. Fall back to wrapping each role as a single-item group for
  // pre-Phase-3 missions persisted before this change.
  const stageGroups: string[][] = pane.data?.stageGroups ?? pipeline.map(r => [r]);

  const results = useWorkspaceStore(s => s.results);
  const messages = useWorkspaceStore(s => s.messages);
  const allTasks = useWorkspaceStore(s => s.tasks);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);

  const [tab, setTab]               = useState<'preview' | 'output' | 'tasks'>('preview');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<{ path: string } | { error: string } | null>(null);
  const outputRef                   = useRef<HTMLDivElement>(null);
  // Retry edges need exactly-once handling or we'd re-fire builders on every
  // messages-array update. Normal stage handoffs are idempotent so they don't.
  const processedRetryIds = useRef<Set<number>>(new Set());

  // Watch for PTY spawn events to reset individual agent status
  useEffect(() => {
    const unlisten = listen<{ id: string }>('pty-spawned', (event) => {
      const spawnedId = event.payload.id;
      const agentIdx = agents.findIndex(a => a.terminalId === spawnedId);
      if (agentIdx !== -1) {
        const updatedAgents = [...agents];
        updatedAgents[agentIdx] = { ...updatedAgents[agentIdx], status: 'idle', triggered: false };
        updatePaneData(pane.id, { agents: updatedAgents });
      }
    });
    return () => { unlisten.then(f => f()); };
  }, [agents, pane.id, updatePaneData]);

  // Orchestrator: advance the pipeline on handoff_task events.
  // A handoff message carries { fromRole, targetRole, ... } as JSON. Phase 2
  // adds two special edges on top of the linear stage advance:
  //   • reviewer → done:    marks all running agents completed (workflow end).
  //   • reviewer → builder: retry loop — reset reviewer to waiting and re-fire
  //     every builder terminal with the failure payload waiting in their inbox.
  useEffect(() => {
    if (messages.length === 0 && agents.every(a => a.status !== 'running')) return;

    const updatedAgents: MissionAgent[] = agents.map(a => ({ ...a }));
    let changed = false;

    const handoffs: Array<HandoffEvent & { msgId: number }> = [];
    for (const msg of messages) {
      if (msg.type !== 'handoff') continue;
      try {
        const parsed = JSON.parse(msg.content) as HandoffEvent;
        if (parsed.fromRole && parsed.targetRole) handoffs.push({ ...parsed, msgId: msg.id });
      } catch { /* malformed handoff payload — ignore */ }
    }

    for (const handoff of handoffs) {
      // Retry loop — must run exactly once per handoff or we'd re-fire the
      // retried specialist on every message-array update. Retry now targets
      // a specific role (builder | tester | security), not just Builder.
      if (isRetryEdge(handoff)) {
        if (processedRetryIds.current.has(handoff.msgId)) continue;
        processedRetryIds.current.add(handoff.msgId);

        const retryRole = handoff.targetRole;
        for (const agent of updatedAgents) {
          if (agent.roleId === 'reviewer' && (agent.status === 'running' || agent.status === 'completed')) {
            agent.status = 'waiting';
            agent.triggered = false;
            agent.completedAt = undefined;
            agent.startedAt = undefined;
            changed = true;
          }
          if (agent.roleId === retryRole) {
            invoke('write_to_pty', { id: agent.terminalId, data: '\r' }).catch(console.error);
            agent.status = 'running';
            agent.triggered = true;
            agent.startedAt = Date.now();
            agent.completedAt = undefined;
            changed = true;
          }
        }
        continue;
      }

      // Terminal handoff — workflow is done, close out any still-running agents.
      if (handoff.targetRole === DONE_ROLE) {
        for (const agent of updatedAgents) {
          if (agent.status === 'running') {
            agent.status = 'completed';
            agent.completedAt = Date.now();
            changed = true;
          }
        }
        continue;
      }

      if (!pipeline.includes(handoff.fromRole) || !pipeline.includes(handoff.targetRole)) continue;

      // Normal stage advance: mark every running agent in fromRole completed.
      // Parallel peers (e.g. tester finishing while builder is still running)
      // each mark their own role done; the group-level predecessor check below
      // waits until the whole group is finished before firing the next stage.
      for (const agent of updatedAgents) {
        if (agent.roleId === handoff.fromRole && agent.status === 'running') {
          agent.status = 'completed';
          agent.completedAt = Date.now();
          changed = true;
        }
      }
    }

    // Advance any stage group whose predecessor group is fully completed.
    // Idempotent — recovers if a handoff event was missed while the UI mounted.
    for (let i = 1; i < stageGroups.length; i++) {
      const prevGroup = stageGroups[i - 1];
      const prevAgents = updatedAgents.filter(a => prevGroup.includes(a.roleId));
      const prevAllDone = prevAgents.length > 0 && prevAgents.every(a => a.status === 'completed');
      if (!prevAllDone) continue;

      const currentGroup = stageGroups[i];
      for (const next of updatedAgents) {
        if (!currentGroup.includes(next.roleId)) continue;
        if ((next.status === 'waiting' || next.status === 'idle') && !next.triggered) {
          invoke('write_to_pty', { id: next.terminalId, data: '\r' }).catch(console.error);
          next.status = 'running';
          next.triggered = true;
          next.startedAt = Date.now();
          changed = true;
        }
      }
    }

    if (changed) {
      updatePaneData(pane.id, { agents: updatedAgents });
    }
  }, [messages, pipeline, agents, pane.id, updatePaneData]);

  // Update preview URL when a new URL result comes in
  useEffect(() => {
    const latestUrl = results.filter(r => r.type === 'url').pop();
    if (latestUrl) {
      setPreviewUrl(latestUrl.content.trim());
      setTab('preview');
    }
  }, [results]);

  // Auto-scroll output
  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [results]);

  const markdownEntries = results.filter(e => e.type === 'markdown');

  async function exportLog() {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    const generated_at = `${now.getFullYear()}-${pad(now.getMonth()+1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const file_ts = `${now.getFullYear()}${pad(now.getMonth()+1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const agentExports = agents.map(a => {
      const role = agentsConfig.agents.find(r => r.id === a.roleId);
      return { title: a.title, role_name: role?.role ?? a.roleId, status: a.status ?? 'idle' };
    });

    const pipelineNames = pipeline.map(id => {
      const role = agentsConfig.agents.find(r => r.id === id);
      return role?.name ?? id;
    });

    const resultExports = results.map(r => ({
      agent_id: r.agentId,
      content: r.content,
      result_type: r.type,
      timestamp: r.timestamp,
    }));

    try {
      const path = await invoke<string>('export_workflow_log', {
        taskDescription: taskDescription,
        generatedAt: generated_at,
        fileTs: file_ts,
        agents: agentExports,
        pipelineNames,
        results: resultExports,
      });
      if (path) {
        setExportStatus({ path });
        setTimeout(() => setExportStatus(null), 8000);
      }
    } catch (err) {
      setExportStatus({ error: String(err) });
      setTimeout(() => setExportStatus(null), 6000);
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg-panel overflow-hidden">

      {/* Header: task + agent badges */}
      <div className="shrink-0 px-3 py-2 border-b border-border-panel bg-bg-titlebar">
        <div className="flex items-center justify-between mb-1.5">
          <p className="text-[11px] font-semibold text-text-primary truncate">{taskDescription || 'Mission'}</p>
          <button
            onClick={exportLog}
            title="Export workflow log"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-muted hover:text-text-primary hover:bg-bg-surface border border-transparent hover:border-border-panel transition-colors shrink-0 ml-2"
          >
            <Download size={10} />
            Export Log
          </button>
        </div>
        {exportStatus && (
          <div className={`text-[10px] px-2 py-1 rounded mb-1 ${
            'path' in exportStatus
              ? 'bg-green-400/10 text-green-400 border border-green-400/20'
              : 'bg-red-400/10 text-red-400 border border-red-400/20'
          }`}>
            {'path' in exportStatus
              ? `Log saved: ${exportStatus.path}`
              : `Export failed: ${exportStatus.error}`}
          </div>
        )}
        {/* Pipeline stage visualization — renders one chip per stage group so
            parallel peers (builder + tester + security) share a single chip. */}
        <div className="flex items-center flex-wrap gap-1">
          {stageGroups.length > 0 ? stageGroups.map((group, idx) => {
            const groupAgents = agents.filter(a => group.includes(a.roleId));
            const allDone    = groupAgents.length > 0 && groupAgents.every(a => a.status === 'completed');
            const anyRunning = groupAgents.some(a => a.status === 'running');
            const label = group
              .map(id => agentsConfig.agents.find(r => r.id === id)?.name ?? id)
              .join(' + ');
            const key = group.join('+');
            return (
              <span key={key} className="flex items-center gap-1">
                <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${
                  allDone    ? 'text-green-400 border-green-400/30 bg-green-400/10' :
                  anyRunning ? 'text-accent-primary border-accent-primary/30 bg-accent-primary/10' :
                               'text-text-muted border-border-panel bg-bg-surface'
                }`}>
                  {groupAgents.length > group.length ? `${groupAgents.length}× ` : ''}{label}
                </span>
                {idx < stageGroups.length - 1 && (
                  <span className="text-[10px] text-text-muted opacity-30">→</span>
                )}
              </span>
            );
          }) : agents.map(a => <AgentBadge key={a.terminalId} agent={a} />)}
        </div>
      </div>

      {/* Tab bar */}
      <div className="flex items-center border-b border-border-panel shrink-0 px-3 gap-1 h-8">
        <button
          onClick={() => setTab('preview')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'preview' ? 'bg-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <Monitor size={11} />
          Preview
          {previewUrl && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        </button>
        <button
          onClick={() => setTab('output')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'output' ? 'bg-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <FileText size={11} />
          Output
          {markdownEntries.length > 0 && (
            <span className="text-[9px] bg-accent-primary text-accent-text rounded-full px-1 leading-4">
              {markdownEntries.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('tasks')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'tasks' ? 'bg-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <ListTree size={11} />
          Tasks
          {allTasks.length > 0 && (
            <span className="text-[9px] bg-bg-surface text-text-muted border border-border-panel rounded-full px-1 leading-4">
              {allTasks.length}
            </span>
          )}
        </button>
      </div>

      {/* Preview tab */}
      {tab === 'preview' && (
        <div className="flex-1 overflow-hidden relative">
          {!previewUrl ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-muted px-6 text-center">
              <Monitor size={28} className="opacity-20" />
              <p className="text-xs opacity-40">
                Waiting for a preview URL. An agent can call{' '}
                <code className="font-mono text-accent-primary">publish_result</code> with{' '}
                <code className="font-mono">type="url"</code> and a localhost address to show it here.
              </p>
            </div>
          ) : (
            <iframe
              src={previewUrl}
              className="w-full h-full border-0"
              title="Dev server preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )}
        </div>
      )}

      {/* Output tab */}
      {tab === 'output' && (
        <div ref={outputRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 font-mono text-xs">
          {markdownEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
              <FileText size={28} className="opacity-20" />
              <p className="text-xs opacity-40 text-center px-4">
                Agent summaries and instructions will appear here when they call{' '}
                <code className="text-accent-primary">publish_result</code>.
              </p>
            </div>
          ) : (
            markdownEntries.map(e => (
              <div key={e.id} className="border border-border-panel rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-surface border-b border-border-panel">
                  <ChevronRight size={10} className="text-accent-primary" />
                  <span className="text-accent-primary font-semibold">{e.agentId}</span>
                  <span className="text-text-muted opacity-50 ml-auto text-[10px]">
                    {new Date(e.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                  </span>
                </div>
                <div className="px-3 py-2 text-text-secondary whitespace-pre-wrap break-words leading-relaxed text-[11px] prose prose-invert max-w-none prose-sm prose-pre:bg-bg-panel prose-pre:border prose-pre:border-border-panel">
                  <ReactMarkdown>{e.content}</ReactMarkdown>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {/* Tasks tab — live delegated task tree */}
      {tab === 'tasks' && (
        <TaskTreePanel tasks={allTasks} />
      )}

    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  todo:        'text-text-muted border-border-panel bg-bg-surface',
  'in-progress': 'text-accent-primary border-accent-primary/30 bg-accent-primary/10',
  done:        'text-green-400 border-green-400/30 bg-green-400/10',
  blocked:     'text-red-400 border-red-400/30 bg-red-400/10',
};

function TaskRow({ task, depth }: { task: DbTask & { children?: any[] }; depth: number }) {
  const statusStyle = STATUS_STYLES[task.status] ?? STATUS_STYLES.todo;
  return (
    <>
      <div
        className="flex items-start gap-2 py-1.5 border-b border-border-panel/40 last:border-0 hover:bg-bg-surface/40 transition-colors px-3"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {depth > 0 && <span className="text-text-muted opacity-30 shrink-0 mt-0.5">↳</span>}
        <span className="flex-1 text-[11px] text-text-secondary leading-snug">{task.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {task.agent_id && (
            <span className="text-[9px] text-text-muted opacity-50 font-mono">{task.agent_id}</span>
          )}
          <span className={`text-[9px] font-semibold uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusStyle}`}>
            {task.status}
          </span>
        </div>
      </div>
      {task.children?.map((child: any) => (
        <TaskRow key={child.id} task={child} depth={depth + 1} />
      ))}
    </>
  );
}

function TaskTreePanel({ tasks }: { tasks: DbTask[] }) {
  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
        <ListTree size={28} className="opacity-20" />
        <p className="text-xs opacity-40 text-center px-4">
          Delegated tasks appear here. A Coordinator can call{' '}
          <code className="text-accent-primary">delegate_task</code> to create subtasks.
        </p>
      </div>
    );
  }

  // Build tree from flat list
  const map: Record<number, DbTask & { children: any[] }> = {};
  const roots: Array<DbTask & { children: any[] }> = [];
  for (const t of tasks) map[t.id] = { ...t, children: [] };
  for (const t of tasks) {
    if (t.parent_id !== null && map[t.parent_id]) {
      map[t.parent_id].children.push(map[t.id]);
    } else {
      roots.push(map[t.id]);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {roots.map(t => <TaskRow key={t.id} task={t} depth={0} />)}
    </div>
  );
}
