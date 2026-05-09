import { useMemo, useState } from 'react';
import {
  AlertTriangle,
  Bell,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  CircleDot,
  Clock3,
  Focus,
  RefreshCw,
  ShieldAlert,
  Square,
  Trash2,
  UserCheck,
  X,
} from 'lucide-react';
import { missionRepository } from '../../lib/missionRepository.js';
import type { ActionCenterActionId, ActionCenterItem, ActionCenterSection } from '../../lib/actionCenter/index.js';
import { useRuntimeObserver } from '../Runtime/useRuntimeSessions.js';
import { useActionCenterItems } from './useActionCenterItems.js';

const SECTION_LABELS: Record<ActionCenterSection, string> = {
  needs_you: 'Needs You',
  active_now: 'Active Now',
  recently_resolved: 'Recently Resolved',
};

function formatTime(value: number): string {
  return new Date(value).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function toneClasses(item: ActionCenterItem): string {
  if (item.severity === 'critical') return 'border-red-400/30 bg-red-500/5';
  if (item.severity === 'warning') return 'border-amber-400/30 bg-amber-500/5';
  if (item.severity === 'success') return 'border-emerald-400/25 bg-emerald-500/5';
  return 'border-border-panel background-bg-surface';
}

function iconForItem(item: ActionCenterItem) {
  if (item.kind === 'permission') return <ShieldAlert size={15} className="text-amber-300" />;
  if (item.kind === 'delegation') return <UserCheck size={15} className="text-accent-primary" />;
  if (item.kind === 'runtime_blocker') return <AlertTriangle size={15} className={item.severity === 'critical' ? 'text-red-300' : 'text-amber-300'} />;
  if (item.kind === 'active_runtime') return <CircleDot size={15} className="text-accent-primary" />;
  return <CheckCircle2 size={15} className={item.severity === 'critical' ? 'text-red-300' : 'text-emerald-300'} />;
}

function actionIcon(actionId: ActionCenterActionId) {
  switch (actionId) {
    case 'approve_permission':
    case 'approve_delegation':
    case 'claim_delegation':
    case 'resume_node':
    case 'force_success':
      return <Check size={13} />;
    case 'deny_permission':
    case 'reject_delegation':
    case 'force_fail':
      return <X size={13} />;
    case 'focus_terminal':
      return <Focus size={13} />;
    case 'retry_runtime':
      return <RefreshCw size={13} />;
    case 'stop_runtime':
      return <Square size={12} />;
    case 'clear_recent':
      return <Trash2 size={13} />;
    default:
      return null;
  }
}

function actionClasses(tone: 'primary' | 'danger' | 'neutral' | undefined): string {
  if (tone === 'primary') return 'bg-accent-primary text-accent-text hover:bg-accent-hover border-accent-primary';
  if (tone === 'danger') return 'bg-red-500/10 text-red-300 border-red-400/30 hover:bg-red-500/20';
  return 'background-bg-panel text-text-muted border-border-panel hover:text-text-primary hover:background-bg-surface';
}

function SourceBadge({ item }: { item: ActionCenterItem }) {
  const label = item.source === 'mcp_inbox'
    ? 'delegation'
    : item.source === 'runtime'
      ? 'runtime'
      : item.source;
  return (
    <span className="text-[10px] px-1.5 py-0.5 rounded border border-border-panel text-text-muted background-bg-panel uppercase tracking-wide">
      {label}
    </span>
  );
}

export function ActionCenterPane({ compactHeader = false }: { compactHeader?: boolean }) {
  const { items, needsYouCount, loadingInbox, refreshInbox, clearRecent, clearAllRecent, sessions } = useActionCenterItems();
  const runtimeActions = useRuntimeObserver();
  const [expandedRaw, setExpandedRaw] = useState<Record<string, boolean>>({});
  const [busyAction, setBusyAction] = useState<string | null>(null);

  const grouped = useMemo(() => ({
    needs_you: items.filter(item => item.section === 'needs_you'),
    active_now: items.filter(item => item.section === 'active_now'),
    recently_resolved: items.filter(item => item.section === 'recently_resolved'),
  }), [items]);

  const dispatchAction = async (item: ActionCenterItem, actionId: ActionCenterActionId) => {
    const busyId = `${item.id}:${actionId}`;
    setBusyAction(busyId);
    try {
      const session = item.sessionId ? sessions.find(candidate => candidate.sessionId === item.sessionId) : undefined;
      const runtimeSession = session ? ({
        ...session,
        nodeId: session.nodeId ?? '',
        terminalId: session.terminalId ?? '',
        missionId: session.missionId ?? '',
        cli: session.cli ?? '',
        executionMode: '',
        roleId: session.roleId ?? '',
        title: session.title ?? '',
        status: session.status ?? 'idle',
        attempt: 0,
        artifacts: [],
        startedAt: session.startedAt ?? Date.now(),
        lastActivityAt: session.lastActivityAt ?? Date.now(),
      } as any) : undefined;
      if (actionId === 'approve_permission' && item.kind === 'permission') {
        await runtimeActions.resolvePermission(item.sessionId!, item.permissionId, 'approve');
      } else if (actionId === 'deny_permission' && item.kind === 'permission') {
        await runtimeActions.resolvePermission(item.sessionId!, item.permissionId, 'deny');
      } else if (actionId === 'focus_terminal' && runtimeSession) {
        runtimeActions.focusRuntime(runtimeSession);
      } else if (actionId === 'retry_runtime' && runtimeSession) {
        runtimeActions.retryRuntime(runtimeSession);
      } else if (actionId === 'stop_runtime' && runtimeSession) {
        runtimeActions.stopRuntime(runtimeSession);
      } else if (actionId === 'resume_node' && item.missionId && item.nodeId) {
        await runtimeActions.resumeNode(item.missionId, item.nodeId);
      } else if (actionId === 'force_success' && item.missionId && item.nodeId) {
        await runtimeActions.forceCompleteNode(item.missionId, item.nodeId, 'success', 'Manually completed from Action Center');
      } else if (actionId === 'force_fail' && item.missionId && item.nodeId) {
        await runtimeActions.forceFailNode(item.missionId, item.nodeId, 'Manually failed from Action Center');
      } else if (actionId === 'approve_delegation' && item.kind === 'delegation') {
        await missionRepository.invokeMcp('approve_inbox_item', { itemId: item.inboxItemId });
        await refreshInbox();
      } else if (actionId === 'reject_delegation' && item.kind === 'delegation') {
        const reason = window.prompt('Reason for rejection:');
        if (reason === null) return;
        await missionRepository.invokeMcp('reject_inbox_item', { itemId: item.inboxItemId, reason });
        await refreshInbox();
      } else if (actionId === 'claim_delegation' && item.kind === 'delegation') {
        await missionRepository.invokeMcp('claim_inbox_item', { itemId: item.inboxItemId });
        await refreshInbox();
      } else if (actionId === 'clear_recent') {
        clearRecent(item.id);
      }
    } catch (error) {
      console.error('Action Center action failed', actionId, error);
    } finally {
      setBusyAction(null);
    }
  };

  const renderItem = (item: ActionCenterItem) => {
    const rawExpanded = expandedRaw[item.id] ?? false;
    return (
      <div key={item.id} className={`rounded-lg border p-3 transition-colors ${toneClasses(item)}`}>
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex items-start gap-2">
            <div className="mt-0.5 shrink-0">{iconForItem(item)}</div>
            <div className="min-w-0">
              <div className="text-xs font-semibold text-text-primary break-words">{item.title}</div>
              {item.detail && <div className="mt-1 text-[11px] leading-relaxed text-text-secondary line-clamp-3">{item.detail}</div>}
              <div className="mt-2 flex items-center gap-2 text-[10px] text-text-muted flex-wrap">
                <SourceBadge item={item} />
                {item.nodeId && <span>node {item.nodeId.slice(0, 8)}</span>}
                {item.sessionId && <span>session {item.sessionId.slice(0, 8)}</span>}
                <span>{formatTime(item.createdAt)}</span>
              </div>
            </div>
          </div>
          {item.kind === 'active_runtime' && (
            <span className="shrink-0 text-[10px] uppercase tracking-wide px-2 py-1 rounded border border-accent-primary/30 text-accent-primary bg-accent-primary/10">
              {item.status.replace(/_/g, ' ')}
            </span>
          )}
        </div>

        {item.kind === 'permission' && item.rawPrompt && (
          <div className="mt-3">
            <button
              className="flex items-center gap-1 text-[10px] uppercase tracking-wide text-text-muted hover:text-text-primary"
              onClick={() => setExpandedRaw(prev => ({ ...prev, [item.id]: !rawExpanded }))}
            >
              {rawExpanded ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
              Raw prompt
            </button>
            {rawExpanded && (
              <pre className="mt-2 max-h-36 overflow-auto whitespace-pre-wrap break-words rounded border border-border-panel background-bg-app p-2 text-[10px] text-text-secondary">
                {item.rawPrompt}
              </pre>
            )}
          </div>
        )}

        {item.actions.length > 0 && (
          <div className="mt-3 flex items-center justify-end gap-1.5 border-t border-border-panel/70 pt-2">
            {item.actions.map(action => {
              const isBusy = busyAction === `${item.id}:${action.id}`;
              return (
                <button
                  key={action.id}
                  disabled={isBusy}
                  onClick={() => dispatchAction(item, action.id)}
                  className={`h-7 px-2 rounded border text-[10px] font-semibold uppercase tracking-wide flex items-center gap-1.5 transition-colors disabled:opacity-50 ${actionClasses(action.tone)}`}
                  title={action.label}
                >
                  {isBusy ? <RefreshCw size={12} className="animate-spin" /> : actionIcon(action.id)}
                  <span>{action.label}</span>
                </button>
              );
            })}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex h-full flex-col background-bg-panel text-text-secondary overflow-hidden">
      <div className={`shrink-0 border-b border-border-panel px-4 ${compactHeader ? 'py-2' : 'py-3'}`}>
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            {!compactHeader && <Bell size={15} className="text-accent-primary" />}
            <div>
              {!compactHeader && <div className="text-xs font-semibold uppercase tracking-wider text-text-primary">Action Center</div>}
              <div className="text-[10px] text-text-muted">{needsYouCount} item{needsYouCount === 1 ? '' : 's'} need attention</div>
            </div>
          </div>
          <div className="flex items-center gap-1.5">
            {loadingInbox && <RefreshCw size={13} className="animate-spin text-accent-primary" />}
            <button
              onClick={refreshInbox}
              className="w-7 h-7 flex items-center justify-center rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface"
              title="Refresh delegations"
            >
              <RefreshCw size={13} />
            </button>
            <button
              onClick={clearAllRecent}
              className="w-7 h-7 flex items-center justify-center rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface"
              title="Clear recent"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-5">
        {items.length === 0 && !loadingInbox && (
          <div className="h-full flex flex-col items-center justify-center text-text-muted gap-2 opacity-60">
            <Bell size={30} strokeWidth={1.5} />
            <div className="text-xs">No active items</div>
          </div>
        )}

        {(['needs_you', 'active_now', 'recently_resolved'] as ActionCenterSection[]).map(section => {
          const sectionItems = grouped[section];
          if (sectionItems.length === 0) return null;
          return (
            <section key={section} className="space-y-2">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  {section === 'needs_you' ? <AlertTriangle size={13} className="text-amber-300" /> : section === 'active_now' ? <Clock3 size={13} className="text-accent-primary" /> : <CheckCircle2 size={13} className="text-emerald-300" />}
                  <h2 className="text-[10px] font-bold uppercase tracking-[0.18em] text-text-muted">{SECTION_LABELS[section]}</h2>
                </div>
                <span className="text-[10px] text-text-muted">{sectionItems.length}</span>
              </div>
              <div className="space-y-2">
                {sectionItems.map(renderItem)}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
