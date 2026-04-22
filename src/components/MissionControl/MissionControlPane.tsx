import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pane,
  MissionAgent,
  MissionAttemptRecord,
  DbTask,
  useWorkspaceStore,
  type CompiledMission,
} from '../../store/workspace';
import agentsConfig from '../../config/agents';
import {
  Monitor,
  FileText,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Clock,
  ListTree,
  Download,
  TerminalSquare,
  ArrowUpRight,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { buildNewTaskSignal, summarizeHandoffPayload } from '../../lib/missionRuntime';

type MissionTab = 'nodes' | 'preview' | 'output' | 'tasks';

function formatTime(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(start?: number, end?: number): string | null {
  if (!start || !end || end < start) return null;
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  return `${seconds}s`;
}

function summarizePayload(payload?: string | null): string | null {
  return summarizeHandoffPayload(payload, 220);
}

function upsertAttemptHistory(
  history: MissionAttemptRecord[] | undefined,
  attempt: number,
  patch: Partial<MissionAttemptRecord>
): MissionAttemptRecord[] {
  const next = [...(history ?? [])];
  const existingIdx = next.findIndex(entry => entry.attempt === attempt);
  const previous = existingIdx >= 0
    ? next[existingIdx]
    : { attempt, status: patch.status ?? 'running' };
  const updated: MissionAttemptRecord = {
    ...previous,
    ...patch,
    attempt,
    status: patch.status ?? previous.status,
  };

  if (existingIdx >= 0) {
    next[existingIdx] = updated;
  } else {
    next.push(updated);
  }

  next.sort((left, right) => right.attempt - left.attempt);
  return next;
}

function readAgentsForPane(paneId: string, fallback: MissionAgent[]): MissionAgent[] {
  const state = useWorkspaceStore.getState();
  for (const tab of state.tabs) {
    const pane = tab.panes.find(candidate => candidate.id === paneId);
    if (pane) {
      return (pane.data?.agents as MissionAgent[] | undefined) ?? fallback;
    }
  }
  return fallback;
}

function focusAgentTerminal(terminalId: string) {
  const state = useWorkspaceStore.getState();
  const targetTab = state.tabs.find(tab =>
    tab.panes.some(pane => pane.type === 'terminal' && pane.data?.terminalId === terminalId)
  );
  if (!targetTab) return;

  if (state.activeTabId !== targetTab.id) {
    state.switchTab(targetTab.id);
  }

  window.setTimeout(() => {
    emit('focus-terminal', { terminalId }).catch(console.error);
  }, 80);
}

function statusTone(status?: MissionAgent['status']): string {
  switch (status) {
    case 'running':
      return 'text-accent-primary border-accent-primary/30 bg-accent-primary/10';
    case 'completed':
      return 'text-green-400 border-green-400/30 bg-green-400/10';
    case 'failed':
      return 'text-red-400 border-red-400/30 bg-red-400/10';
    case 'waiting':
      return 'text-amber-300 border-amber-300/30 bg-amber-300/10';
    default:
      return 'text-text-muted border-border-panel bg-bg-surface';
  }
}

function statusLabel(status?: MissionAgent['status']): string {
  return status ?? 'idle';
}

function StatusIcon({ status }: { status?: MissionAgent['status'] }) {
  if (status === 'running') return <Loader2 size={10} className="animate-spin text-accent-primary" />;
  if (status === 'completed') return <CheckCircle2 size={10} className="text-green-400" />;
  if (status === 'failed') return <AlertCircle size={10} className="text-red-400" />;
  if (status === 'waiting') return <Clock size={10} className="text-amber-300" />;
  return <Clock size={10} className="text-text-muted" />;
}

function AgentBadge({
  agent,
  onOpenTerminal,
}: {
  agent: MissionAgent;
  onOpenTerminal: (agent: MissionAgent) => void;
}) {
  const role = agentsConfig.agents.find(entry => entry.id === agent.roleId);
  const clickable = Boolean(agent.terminalId);

  return (
    <button
      type="button"
      onClick={() => clickable && onOpenTerminal(agent)}
      disabled={!clickable}
      title={clickable ? 'Open live terminal' : 'Terminal not available'}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md border shrink-0 transition-colors ${
        clickable ? 'hover:border-accent-primary/50 hover:bg-bg-surface' : 'cursor-default'
      } ${statusTone(agent.status)}`}
    >
      <StatusIcon status={agent.status} />
      <span className="text-xs font-medium text-left">{agent.title}</span>
      {agent.attempt && agent.attempt > 0 && (
        <span className="text-[9px] uppercase tracking-wide opacity-80">#{agent.attempt}</span>
      )}
      {role && (
        <span className="text-[9px] text-text-muted opacity-70">
          {role.name}
        </span>
      )}
      {clickable && <ArrowUpRight size={10} className="opacity-70" />}
    </button>
  );
}

function NodeCard({
  agent,
  onOpenTerminal,
}: {
  agent: MissionAgent;
  onOpenTerminal: (agent: MissionAgent) => void;
}) {
  const role = agentsConfig.agents.find(entry => entry.id === agent.roleId);
  const history = agent.attemptHistory ?? [];
  const latestDuration = formatDuration(agent.startedAt, agent.completedAt);

  return (
    <div className="border border-border-panel rounded-lg bg-bg-panel overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-panel bg-bg-surface">
        <StatusIcon status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-text-primary truncate">{agent.title}</span>
            <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusTone(agent.status)}`}>
              {statusLabel(agent.status)}
            </span>
          </div>
          <div className="text-[10px] text-text-muted truncate">
            {role?.name ?? agent.roleId}
            {agent.nodeId ? ` · ${agent.nodeId}` : ''}
          </div>
        </div>
        <button
          type="button"
          onClick={() => onOpenTerminal(agent)}
          className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-muted hover:text-text-primary hover:bg-bg-panel border border-border-panel transition-colors"
        >
          <TerminalSquare size={11} />
          Open PTY
        </button>
      </div>

      <div className="px-3 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded border border-border-panel bg-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Current Attempt</div>
            <div className="text-text-primary font-medium">{agent.attempt ?? 0}</div>
          </div>
          <div className="rounded border border-border-panel bg-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Last Outcome</div>
            <div className="text-text-primary font-medium">{agent.lastOutcome ?? '—'}</div>
          </div>
          <div className="rounded border border-border-panel bg-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Started</div>
            <div className="text-text-primary font-medium">{formatTime(agent.startedAt)}</div>
          </div>
          <div className="rounded border border-border-panel bg-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Completed</div>
            <div className="text-text-primary font-medium">
              {formatTime(agent.completedAt)}
              {latestDuration ? ` · ${latestDuration}` : ''}
            </div>
          </div>
        </div>

        {agent.lastPayload && (
          <div className="rounded border border-border-panel bg-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted mb-1">Latest Handoff Preview</div>
            <div className="text-[11px] text-text-secondary break-words">
              {summarizePayload(agent.lastPayload) ?? 'No preview'}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Attempt History
          </div>
          {history.length === 0 ? (
            <div className="rounded border border-dashed border-border-panel px-2 py-2 text-[11px] text-text-muted">
              Waiting for the first activation.
            </div>
          ) : (
            history.map(entry => {
              const duration = formatDuration(entry.startedAt, entry.completedAt);
              return (
                <div key={entry.attempt} className="rounded border border-border-panel bg-bg-surface px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-text-primary">Attempt {entry.attempt}</span>
                    <span className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${statusTone(entry.status)}`}>
                      {entry.status}
                    </span>
                    {entry.outcome && (
                      <span className="text-[9px] uppercase tracking-wide text-text-muted">
                        {entry.outcome}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] text-text-muted">
                    {formatTime(entry.startedAt)}
                    {entry.completedAt ? ` → ${formatTime(entry.completedAt)}` : ''}
                    {duration ? ` · ${duration}` : ''}
                  </div>
                  {entry.payloadPreview && (
                    <div className="mt-1 text-[11px] text-text-secondary break-words">
                      {entry.payloadPreview}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

export function MissionControlPane({ pane }: { pane: Pane }) {
  const mission: CompiledMission | null = pane.data?.mission ?? null;
  const taskDescription: string = pane.data?.taskDescription ?? mission?.task.prompt ?? '';
  const agents: MissionAgent[] = pane.data?.agents ?? [];
  const currentMissionId: string | null = pane.data?.missionId ?? mission?.missionId ?? null;
  const executionLayers: string[][] = mission?.metadata.executionLayers ?? [];

  const results = useWorkspaceStore(s => s.results);
  const allTasks = useWorkspaceStore(s => s.tasks);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);

  const [tab, setTab] = useState<MissionTab>('nodes');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<{ path: string } | { error: string } | null>(null);
  const outputRef = useRef<HTMLDivElement>(null);

  const orderedAgents = useMemo(() => {
    if (executionLayers.length === 0) return agents;

    const byNodeId = new Map(
      agents
        .filter(agent => agent.nodeId)
        .map(agent => [agent.nodeId as string, agent])
    );
    const ordered: MissionAgent[] = [];

    for (const layer of executionLayers) {
      for (const nodeId of layer) {
        const agent = byNodeId.get(nodeId);
        if (agent) {
          ordered.push(agent);
          byNodeId.delete(nodeId);
        }
      }
    }

    for (const agent of agents) {
      if (!ordered.includes(agent)) ordered.push(agent);
    }

    return ordered;
  }, [agents, executionLayers]);

  function openTerminal(agent: MissionAgent) {
    if (!agent.terminalId) return;
    focusAgentTerminal(agent.terminalId);
  }

  // Watch for PTY spawn events to reset individual agent status.
  useEffect(() => {
    let unlistenFn: (() => void) | undefined;
    let unmounted = false;

    listen<{ id: string }>('pty-spawned', (event) => {
      if (unmounted) return;
      const spawnedId = event.payload.id;
      const liveAgents = readAgentsForPane(pane.id, agents);
      const nextAgents = liveAgents.map(agent =>
        agent.terminalId === spawnedId
          ? { ...agent, status: 'idle', triggered: false }
          : agent
      );
      updatePaneData(pane.id, { agents: nextAgents });
    }).then(fn => {
      unlistenFn = fn;
      if (unmounted) fn();
    });

    return () => {
      unmounted = true;
      unlistenFn?.();
    };
  }, [agents, pane.id, updatePaneData]);

  // Mission Control is the only runtime surface that reacts to workflow triggers.
  useEffect(() => {
    let unlistenTriggerFn: (() => void) | undefined;
    let unlistenUpdateFn: (() => void) | undefined;
    let unmounted = false;

    listen<{
      missionId: string;
      nodeId: string;
      roleId: string;
      attempt: number;
      payload?: string;
    }>('workflow-node-triggered', (event) => {
      if (unmounted) return;
      const { missionId, nodeId, roleId, attempt, payload } = event.payload;
      if (currentMissionId && currentMissionId !== missionId) return;

      const liveAgents = readAgentsForPane(pane.id, agents);
      let signal: string | null = null;
      let terminalId: string | null = null;
      let changed = false;

      const nextAgents = liveAgents.map(agent => {
        const matches = agent.nodeId === nodeId || (!agent.nodeId && agent.roleId === roleId);
        if (!matches) return agent;

        const shouldDispatch = attempt !== (agent.attempt ?? 0) || agent.status !== 'running';
        if (!shouldDispatch) return agent;

        const now = Date.now();
        const payloadPreview = summarizePayload(payload ?? null);
        signal = buildNewTaskSignal({
          missionId,
          nodeId,
          roleId,
          attempt,
          payload: payload ?? null,
        });
        terminalId = agent.terminalId;
        changed = true;

        return {
          ...agent,
          status: 'running',
          triggered: true,
          attempt,
          startedAt: now,
          completedAt: undefined,
          lastOutcome: undefined,
          lastPayload: payload ?? null,
          attemptHistory: upsertAttemptHistory(agent.attemptHistory, attempt, {
            attempt,
            status: 'running',
            startedAt: now,
            completedAt: undefined,
            outcome: undefined,
            payloadPreview,
          }),
        };
      });

      if (!changed) return;

      if (terminalId && signal) {
        invoke('write_to_pty', { id: terminalId, data: `${signal}\r` }).catch(console.error);
      }
      updatePaneData(pane.id, { agents: nextAgents });
    }).then(fn => {
      unlistenTriggerFn = fn;
      if (unmounted) fn();
    });

    listen<{
      id: string;
      status: string;
      attempt?: number;
      outcome?: 'success' | 'failure';
    }>('workflow-node-update', (event) => {
      if (unmounted) return;
      const { id: nodeId, status, attempt, outcome } = event.payload;
      const liveAgents = readAgentsForPane(pane.id, agents);
      const now = Date.now();

      const nextAgents = liveAgents.map(agent => {
        if (agent.nodeId !== nodeId) return agent;

        const nextAttempt = typeof attempt === 'number' ? attempt : (agent.attempt ?? 0);
        const nextStatus = status as MissionAgent['status'];
        const isTerminalState = nextStatus === 'completed' || nextStatus === 'failed';

        return {
          ...agent,
          status: nextStatus,
          attempt: nextAttempt,
          completedAt: isTerminalState ? now : agent.completedAt,
          lastOutcome: outcome ?? agent.lastOutcome,
          attemptHistory: nextAttempt > 0
            ? upsertAttemptHistory(agent.attemptHistory, nextAttempt, {
                attempt: nextAttempt,
                status: nextStatus ?? 'idle',
                completedAt: isTerminalState ? now : undefined,
                outcome: outcome ?? undefined,
              })
            : agent.attemptHistory,
        };
      });

      updatePaneData(pane.id, { agents: nextAgents });
    }).then(fn => {
      unlistenUpdateFn = fn;
      if (unmounted) fn();
    });

    return () => {
      unmounted = true;
      unlistenTriggerFn?.();
      unlistenUpdateFn?.();
    };
  }, [agents, currentMissionId, pane.id, updatePaneData]);

  useEffect(() => {
    const latestUrl = results.filter(result => result.type === 'url').pop();
    if (latestUrl) {
      setPreviewUrl(latestUrl.content.trim());
      setTab('preview');
    }
  }, [results]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [results]);

  const markdownEntries = results.filter(entry => entry.type === 'markdown');

  async function exportLog() {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const fileTs = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const agentExports = orderedAgents.map(agent => {
      const role = agentsConfig.agents.find(entry => entry.id === agent.roleId);
      return {
        title: agent.title,
        role_name: role?.role ?? agent.roleId,
        status: agent.status ?? 'idle',
      };
    });

    const pipelineNames = mission
      ? mission.metadata.executionLayers.map(layer =>
          layer
            .map(nodeId => orderedAgents.find(agent => agent.nodeId === nodeId)?.title ?? nodeId)
            .join(' + ')
        )
      : orderedAgents.map(agent => agent.title);

    const resultExports = results.map(result => ({
      agent_id: result.agentId,
      content: result.content,
      result_type: result.type,
      timestamp: result.timestamp,
    }));

    try {
      const path = await invoke<string>('export_workflow_log', {
        taskDescription,
        generatedAt,
        fileTs,
        agents: agentExports,
        pipelineNames,
        results: resultExports,
      });
      if (path) {
        setExportStatus({ path });
        window.setTimeout(() => setExportStatus(null), 8000);
      }
    } catch (error) {
      setExportStatus({ error: String(error) });
      window.setTimeout(() => setExportStatus(null), 6000);
    }
  }

  return (
    <div className="flex flex-col h-full bg-bg-panel overflow-hidden">
      <div className="shrink-0 px-3 py-2 border-b border-border-panel bg-bg-titlebar">
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-text-primary truncate">
              {taskDescription || 'Mission'}
            </p>
            {currentMissionId && (
              <p className="text-[10px] text-text-muted truncate">
                Mission {currentMissionId}
              </p>
            )}
          </div>
          <button
            onClick={exportLog}
            title="Export workflow log"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-muted hover:text-text-primary hover:bg-bg-surface border border-transparent hover:border-border-panel transition-colors shrink-0"
          >
            <Download size={10} />
            Export Log
          </button>
        </div>
        {exportStatus && (
          <div className={`text-[10px] px-2 py-1 rounded mb-2 ${
            'path' in exportStatus
              ? 'bg-green-400/10 text-green-400 border border-green-400/20'
              : 'bg-red-400/10 text-red-400 border border-red-400/20'
          }`}>
            {'path' in exportStatus
              ? `Log saved: ${exportStatus.path}`
              : `Export failed: ${exportStatus.error}`}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {executionLayers.length > 0 ? executionLayers.map((layer, idx) => (
            <div key={layer.join(':')} className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] uppercase tracking-wide text-text-muted min-w-[44px]">
                Layer {idx + 1}
              </span>
              <div className="flex items-center flex-wrap gap-1">
                {layer.map(nodeId => {
                  const agent = orderedAgents.find(entry => entry.nodeId === nodeId);
                  return agent ? (
                    <AgentBadge key={nodeId} agent={agent} onOpenTerminal={openTerminal} />
                  ) : (
                    <span
                      key={nodeId}
                      className="text-[10px] px-2 py-1 rounded-md border border-border-panel bg-bg-surface text-text-muted"
                    >
                      {nodeId}
                    </span>
                  );
                })}
              </div>
            </div>
          )) : (
            <div className="flex items-center flex-wrap gap-1">
              {orderedAgents.map(agent => (
                <AgentBadge key={agent.terminalId} agent={agent} onOpenTerminal={openTerminal} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center border-b border-border-panel shrink-0 px-3 gap-1 h-8">
        <button
          onClick={() => setTab('nodes')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'nodes' ? 'bg-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <TerminalSquare size={11} />
          Nodes
          <span className="text-[9px] bg-bg-surface text-text-muted border border-border-panel rounded-full px-1 leading-4">
            {orderedAgents.length}
          </span>
        </button>
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

      {tab === 'nodes' && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {orderedAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted px-6 text-center">
              <TerminalSquare size={28} className="opacity-20" />
              <p className="text-xs opacity-40">
                Node runtime details appear here after a mission is staged.
              </p>
            </div>
          ) : (
            orderedAgents.map(agent => (
              <NodeCard key={`${agent.nodeId ?? agent.terminalId}`} agent={agent} onOpenTerminal={openTerminal} />
            ))
          )}
        </div>
      )}

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
            markdownEntries.map(entry => (
              <div key={entry.id} className="border border-border-panel rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 bg-bg-surface border-b border-border-panel">
                  <ChevronRight size={10} className="text-accent-primary" />
                  <span className="text-accent-primary font-semibold">{entry.agentId}</span>
                  <span className="text-text-muted opacity-50 ml-auto text-[10px]">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
                <div className="px-3 py-2 text-text-secondary whitespace-pre-wrap break-words leading-relaxed text-[11px] prose prose-invert max-w-none prose-sm prose-pre:bg-bg-panel prose-pre:border prose-pre:border-border-panel">
                  <ReactMarkdown>{entry.content}</ReactMarkdown>
                </div>
              </div>
            ))
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <TaskTreePanel tasks={allTasks} />
      )}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  todo: 'text-text-muted border-border-panel bg-bg-surface',
  'in-progress': 'text-accent-primary border-accent-primary/30 bg-accent-primary/10',
  done: 'text-green-400 border-green-400/30 bg-green-400/10',
  blocked: 'text-red-400 border-red-400/30 bg-red-400/10',
};

function TaskRow({ task, depth }: { task: DbTask & { children?: DbTask[] }; depth: number }) {
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
      {task.children?.map(child => (
        <TaskRow key={child.id} task={child as DbTask & { children?: DbTask[] }} depth={depth + 1} />
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

  const map: Record<number, DbTask & { children: DbTask[] }> = {};
  const roots: Array<DbTask & { children: DbTask[] }> = [];
  for (const task of tasks) map[task.id] = { ...task, children: [] };
  for (const task of tasks) {
    if (task.parent_id !== null && map[task.parent_id]) {
      map[task.parent_id].children.push(map[task.id]);
    } else {
      roots.push(map[task.id]);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {roots.map(task => (
        <TaskRow key={task.id} task={task} depth={0} />
      ))}
    </div>
  );
}
