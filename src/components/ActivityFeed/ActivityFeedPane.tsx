import { useEffect, useState, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Activity, Wifi, Users, Lock } from 'lucide-react';
import { useWorkspaceStore, McpMessage } from '../../store/workspace';

interface FileLock {
  agentId: string;
  sessionId: string;
  lockedAt: number;
}

const TYPE_COLORS: Record<string, string> = {
  message: 'text-blue-400',
  status:  'text-green-400',
  error:   'text-red-400',
  warning: 'text-yellow-400',
};

function shortId(id: string) {
  return id.slice(0, 8);
}

function AgentPanel({ baseUrl, token }: { baseUrl: string, token: string }) {
  const [sessions, setSessions] = useState<string[]>([]);
  const [locks, setLocks]       = useState<Record<string, FileLock>>({});

  useEffect(() => {
    if (!baseUrl) return;
    let cancelled = false;

    async function fetchData() {
      try {
        const query = token ? `?token=${token}` : '';
        const [sRes, lRes] = await Promise.all([
          fetch(`${baseUrl}/sessions${query}`),
          fetch(`${baseUrl}/locks${query}`),
        ]);
        if (!cancelled) {
          setSessions(await sRes.json());
          setLocks(await lRes.json());
        }
      } catch { /* server not ready yet */ }
    }

    fetchData();

    const unlisten = listen<McpMessage>('mcp-message', (event) => {
      const t = event.payload.type;
      if (t === 'lock_update' || t === 'session_update') {
        fetchData();
      }
    });

    return () => {
      cancelled = true;
      unlisten.then((f) => f());
    };
  }, [baseUrl]);

  const lockEntries = Object.entries(locks);

  return (
    <div className="shrink-0 border-b border-border-panel px-3 py-2 space-y-2">
      {/* Sessions */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <Users size={11} className="text-accent-primary opacity-70" />
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Sessions ({sessions.length})
          </span>
        </div>
        {sessions.length === 0 ? (
          <p className="text-[10px] text-text-muted opacity-40 pl-1">No active sessions</p>
        ) : (
          <div className="flex flex-wrap gap-1">
            {sessions.map((sid) => (
              <span
                key={sid}
                className="font-mono text-[10px] bg-bg-surface border border-border-panel rounded px-1.5 py-0.5 text-accent-primary"
                title={sid}
              >
                {shortId(sid)}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* File Locks */}
      <div>
        <div className="flex items-center gap-1.5 mb-1">
          <Lock size={11} className="text-yellow-400 opacity-70" />
          <span className="text-[10px] font-semibold text-text-muted uppercase tracking-wider">
            Locks ({lockEntries.length})
          </span>
        </div>
        {lockEntries.length === 0 ? (
          <p className="text-[10px] text-text-muted opacity-40 pl-1">No files locked</p>
        ) : (
          <div className="space-y-0.5">
            {lockEntries.map(([filePath, lock]) => (
              <div key={filePath} className="flex items-center gap-1.5 text-[10px] font-mono">
                <span className="text-yellow-400 shrink-0">⬤</span>
                <span className="text-text-secondary truncate flex-1" title={filePath}>
                  {filePath.split(/[\\/]/).pop()}
                </span>
                <span className="text-text-muted shrink-0" title={lock.agentId}>
                  {lock.agentId.length > 12 ? lock.agentId.slice(0, 12) + '…' : lock.agentId}
                </span>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export function ActivityFeedPane() {
  const messages = useWorkspaceStore((s) => s.messages);
  const [mcpUrl,   setMcpUrl]   = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  // Derive base URL and append token to fetch requests
  const urlObj = mcpUrl ? new URL(mcpUrl) : null;
  const baseUrl = urlObj ? `${urlObj.protocol}//${urlObj.host}` : '';
  const token = urlObj?.searchParams.get('token') || '';

  useEffect(() => {
    invoke<string>('get_mcp_url').then(setMcpUrl).catch(() => {});
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-bg-panel overflow-hidden">

      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-panel shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent-primary" />
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Swarm</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${messages.length > 0 ? 'bg-green-400' : 'bg-text-muted opacity-30'}`} />
          <span className="text-xs text-text-muted">{messages.length > 0 ? 'Live' : 'Idle'}</span>
        </div>
      </div>

      {/* Agent status panel */}
      {baseUrl && <AgentPanel baseUrl={baseUrl} token={token} />}

      {/* Activity log */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-3 py-2 font-mono text-xs">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
            <Wifi size={28} className="opacity-20" />
            <p className="opacity-50 text-center">Listening for MCP messages…</p>
            {mcpUrl && (
              <p className="opacity-30 text-center break-all px-2">{mcpUrl}</p>
            )}
          </div>
        ) : (
          messages.map((m) => (
            <div key={m.id} className="flex items-start gap-2 py-0.5 hover:bg-bg-surface rounded px-1 group transition-colors">
              <span className="text-text-muted shrink-0 mt-px opacity-60">
                {new Date(m.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit' })}
              </span>
              <span className="text-accent-primary shrink-0 font-medium">{m.from}</span>
              <span className={`shrink-0 ${TYPE_COLORS[m.type] ?? 'text-text-muted'}`}>[{m.type}]</span>
              <span className="text-text-secondary break-all">{m.content}</span>
            </div>
          ))
        )}
      </div>

    </div>
  );
}
