import { useEffect, useRef, useState } from 'react';
import { Pane, MissionAgent, useWorkspaceStore } from '../../store/workspace';
import agentsConfig from '../../config/agents.json';
import { Monitor, FileText, ChevronRight, Loader2, CheckCircle2, Clock } from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';

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
  const isSequential: boolean   = pane.data?.isSequential ?? false;

  const results = useWorkspaceStore(s => s.results);
  const messages = useWorkspaceStore(s => s.messages);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);

  const [tab, setTab]               = useState<'preview' | 'output'>('preview');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const outputRef                   = useRef<HTMLDivElement>(null);

  // Orchestrator: Watch for completion signals in broadcasts
  useEffect(() => {
    if (!isSequential) return;

    const lastMessage = messages[messages.length - 1];
    if (!lastMessage || lastMessage.type !== 'message') return;

    // Iterate agents to see if any are waiting for this signal
    const updatedAgents = [...agents];
    let changed = false;

    for (let i = 0; i < updatedAgents.length; i++) {
      const agent = updatedAgents[i];
      const role = agentsConfig.agents.find(r => r.id === agent.roleId);
      
      // 1. Mark previous agent as completed if we see their signal
      // Search backwards from current agent to find who emits this signal
      const emitterIdx = updatedAgents.findIndex(a => {
        const r = agentsConfig.agents.find(role => role.id === a.roleId);
        return r?.triggerSignal && lastMessage.content.includes(r.triggerSignal);
      });

      if (emitterIdx !== -1 && updatedAgents[emitterIdx].status === 'running') {
        updatedAgents[emitterIdx].status = 'completed';
        changed = true;
      }

      // 2. Trigger next agent if its prerequisite signal is detected
      if (agent.status === 'waiting' && role?.triggerSignal) {
        if (lastMessage.content.includes(role.triggerSignal)) {
          // Prerequisite met! Launch.
          invoke('write_to_pty', { id: agent.terminalId, data: '\r' });
          agent.status = 'running';
          agent.triggered = true;
          changed = true;
          console.log(`[Orchestrator] Triggered ${agent.title} (${agent.roleId}) via signal: ${role.triggerSignal}`);
        }
      }
    }

    if (changed) {
      updatePaneData(pane.id, { agents: updatedAgents });
    }
  }, [messages, isSequential, agents, pane.id, updatePaneData]);

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

  return (
    <div className="flex flex-col h-full bg-bg-panel overflow-hidden">

      {/* Header: task + agent badges */}
      <div className="shrink-0 px-3 py-2 border-b border-border-panel bg-bg-titlebar">
        <p className="text-[11px] font-semibold text-text-primary truncate mb-1.5">{taskDescription || 'Mission'}</p>
        <div className="flex flex-wrap gap-1.5">
          {agents.map(a => <AgentBadge key={a.terminalId} agent={a} />)}
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

    </div>
  );
}
