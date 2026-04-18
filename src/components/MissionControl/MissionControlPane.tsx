import { useEffect, useRef, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { Pane, MissionAgent } from '../../store/workspace';
import agentsConfig from '../../config/agents.json';
import { Monitor, FileText, ChevronRight } from 'lucide-react';

interface ResultEntry {
  id: number;
  agentId: string;
  content: string;
  type: 'markdown' | 'url';
  timestamp: number;
}

interface McpMessage {
  id: number;
  from: string;
  content: string;
  type: string;
  timestamp: number;
}

function AgentBadge({ agent }: { agent: MissionAgent }) {
  const role = agentsConfig.agents.find(a => a.id === agent.roleId);
  return (
    <div className="flex items-center gap-1.5 px-2.5 py-1 bg-bg-surface border border-border-panel rounded-md shrink-0">
      <span className="text-xs font-medium text-text-primary">{agent.title}</span>
      {role && (
        <span className="text-[9px] text-accent-primary bg-accent-primary/10 border border-accent-primary/20 px-1.5 py-0.5 rounded-full">
          {role.name}
        </span>
      )}
    </div>
  );
}

export function MissionControlPane({ pane }: { pane: Pane }) {
  const taskDescription: string = pane.data?.taskDescription ?? '';
  const agents: MissionAgent[]  = pane.data?.agents ?? [];

  const [tab, setTab]               = useState<'preview' | 'output'>('preview');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [results, setResults]       = useState<ResultEntry[]>([]);
  const outputRef                   = useRef<HTMLDivElement>(null);

  // Listen for published results from agents
  useEffect(() => {
    const unlisten = listen<McpMessage>('mcp-message', (event) => {
      const msg = event.payload;
      if (!msg.type.startsWith('result:')) return;
      const type = msg.type === 'result:url' ? 'url' : 'markdown';
      if (type === 'url') {
        setPreviewUrl(msg.content.trim());
        setTab('preview');
      }
      setResults(prev => [...prev, {
        id: msg.id, agentId: msg.from, content: msg.content, type, timestamp: msg.timestamp,
      }]);
    });
    return () => { unlisten.then(f => f()); };
  }, []);

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
                <pre className="px-3 py-2 text-text-secondary whitespace-pre-wrap break-words leading-relaxed text-[11px]">
                  {e.content}
                </pre>
              </div>
            ))
          )}
        </div>
      )}

    </div>
  );
}
