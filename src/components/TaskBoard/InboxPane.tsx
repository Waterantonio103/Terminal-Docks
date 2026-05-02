import { useState, useEffect } from "react";
import { Check, X, User, Box, MessageSquare } from "lucide-react";
import { missionRepository } from "../../lib/missionRepository";

interface InboxItem {
  id: number;
  mission_id: string;
  from_session_id: string;
  recipient_session_id: string | null;
  recipient_node_id: string | null;
  role_id: string | null;
  title: string;
  objective: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'claimed' | 'completed';
  created_at: string;
}

export function InboxPane() {
  const [items, setItems] = useState<InboxItem[]>([]);
  const [loading, setLoading] = useState(false);

  const fetchInbox = async () => {
    try {
      setLoading(true);
      const result = await missionRepository.invokeMcp("list_inbox", {});
      setItems(JSON.parse(result));
    } catch (err) {
      console.error("Failed to fetch inbox", err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    fetchInbox();
    
    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('mcp-message', (event: any) => {
        if (event.payload?.type === 'inbox_update') {
          fetchInbox();
        }
      }).then(fn => { unlisten = fn; });
    });

    return () => { if (unlisten) unlisten(); };
  }, []);

  const handleApprove = async (itemId: number) => {
    try {
      await missionRepository.invokeMcp("approve_inbox_item", { itemId });
      fetchInbox();
    } catch (err) {
      console.error("Failed to approve item", err);
    }
  };

  const handleReject = async (itemId: number) => {
    const reason = window.prompt("Reason for rejection:");
    if (reason === null) return;
    try {
      await missionRepository.invokeMcp("reject_inbox_item", { itemId, reason });
      fetchInbox();
    } catch (err) {
      console.error("Failed to reject item", err);
    }
  };

  const handleClaim = async (itemId: number) => {
    try {
      await missionRepository.invokeMcp("claim_inbox_item", { itemId });
      fetchInbox();
    } catch (err) {
      console.error("Failed to claim item", err);
    }
  };

  return (
    <div className="flex flex-col h-full background-bg-panel text-text-secondary overflow-hidden">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-panel shrink-0">
        <div className="flex items-center gap-2">
          <MessageSquare size={14} className="text-accent-primary" />
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Delegation Inbox</span>
          {loading && <div className="w-3 h-3 border-2 border-accent-primary border-t-transparent rounded-full animate-spin ml-2" />}
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-3">
        {items.length === 0 && !loading && (
          <div className="flex flex-col items-center justify-center h-full text-text-muted space-y-2 opacity-50">
            <Box size={32} strokeWidth={1.5} />
            <span className="text-xs">Your inbox is empty</span>
          </div>
        )}

        {items.map((item) => (
          <div key={item.id} className={`background-bg-surface border border-border-panel rounded-lg p-3 transition-all hover:border-border-divider ${item.status !== 'pending' && item.status !== 'approved' ? 'opacity-60' : ''}`}>
            <div className="flex items-start justify-between gap-3 mb-2">
              <div className="flex flex-col gap-1 min-w-0">
                <div className="text-xs font-bold text-text-primary break-words">{item.title}</div>
                <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                   <User size={10} />
                   <span>from {item.from_session_id.slice(0, 8)}...</span>
                   <span>•</span>
                   <span>{new Date(item.created_at).toLocaleTimeString()}</span>
                </div>
              </div>
              <div className={`text-[10px] px-1.5 py-0.5 rounded-full border font-bold uppercase tracking-tighter ${
                item.status === 'pending' ? 'bg-yellow-500/10 text-yellow-400 border-yellow-500/20' :
                item.status === 'approved' ? 'bg-green-500/10 text-green-400 border-green-500/20' :
                item.status === 'rejected' ? 'bg-red-500/10 text-red-400 border-red-500/20' :
                'background-bg-panel text-text-muted border-border-panel'
              }`}>
                {item.status}
              </div>
            </div>

            <div className="text-[11px] text-text-secondary leading-relaxed mb-3 line-clamp-3">
              {item.objective}
            </div>

            <div className="flex items-center justify-between border-t border-border-panel pt-2">
              <div className="flex items-center gap-2">
                {item.role_id && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-accent-primary/10 text-accent-primary border border-accent-primary/20">
                    {item.role_id}
                  </span>
                )}
                {item.recipient_node_id && (
                  <span className="text-[10px] px-1.5 py-0.5 rounded bg-bg-app text-text-muted border border-border-panel">
                    node:{item.recipient_node_id.slice(0, 8)}
                  </span>
                )}
              </div>
              
              <div className="flex items-center gap-1">
                {item.status === 'pending' && (
                  <>
                    <button onClick={() => handleReject(item.id)} className="p-1.5 rounded hover:bg-red-500/10 text-text-muted hover:text-red-400 transition-colors" title="Reject">
                      <X size={14} />
                    </button>
                    <button onClick={() => handleApprove(item.id)} className="p-1.5 rounded hover:bg-green-500/10 text-text-muted hover:text-green-400 transition-colors" title="Approve">
                      <Check size={14} />
                    </button>
                  </>
                )}
                {item.status === 'approved' && (
                  <button onClick={() => handleClaim(item.id)} className="text-[10px] px-2.5 py-1 bg-accent-primary hover:bg-accent-hover text-accent-text rounded font-bold uppercase transition-all shadow-sm">
                    Claim
                  </button>
                )}
              </div>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
