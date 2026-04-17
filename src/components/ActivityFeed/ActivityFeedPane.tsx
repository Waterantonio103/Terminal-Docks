import { useEffect, useState, useRef } from 'react';
import { listen } from '@tauri-apps/api/event';
import { invoke } from '@tauri-apps/api/core';
import { Activity, Wifi } from 'lucide-react';

interface McpMessage {
  id: number;
  from: string;
  content: string;
  type: string;
  timestamp: number;
}

const TYPE_COLORS: Record<string, string> = {
  message: 'text-blue-400',
  status: 'text-green-400',
  error: 'text-red-400',
  warning: 'text-yellow-400',
};

export function ActivityFeedPane() {
  const [messages, setMessages] = useState<McpMessage[]>([]);
  const [mcpUrl, setMcpUrl] = useState<string>('');
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    invoke<string>('get_mcp_url').then(setMcpUrl).catch(() => {});
  }, []);

  useEffect(() => {
    const unlisten = listen<McpMessage>('mcp-message', (event) => {
      setMessages((prev) => [...prev, event.payload].slice(-200));
    });
    return () => { unlisten.then((f) => f()); };
  }, []);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <div className="flex flex-col h-full bg-bg-panel overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-panel shrink-0">
        <div className="flex items-center gap-2">
          <Activity size={14} className="text-accent-primary" />
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">MCP Activity</span>
        </div>
        <div className="flex items-center gap-1.5">
          <span className={`w-1.5 h-1.5 rounded-full ${messages.length > 0 ? 'bg-green-400' : 'bg-text-muted opacity-30'}`} />
          <span className="text-xs text-text-muted">{messages.length > 0 ? 'Live' : 'Idle'}</span>
        </div>
      </div>

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
