import type {
  ActionCenterAction,
  ActionCenterInboxInput,
  ActionCenterItem,
  ActionCenterRecentInput,
  ActionCenterRuntimeSessionInput,
  DeriveActionCenterItemsInput,
} from './ActionCenterTypes.js';

const ACTIVE_RUNTIME_STATUSES = new Set([
  'launching',
  'connecting',
  'spawning',
  'terminal_started',
  'adapter_starting',
  'mcp_connecting',
  'registered',
  'ready',
  'activation_pending',
  'activation_acked',
  'activated',
  'creating',
  'launching_cli',
  'awaiting_cli_ready',
  'registering_mcp',
  'bootstrap_injecting',
  'bootstrap_sent',
  'awaiting_mcp_ready',
  'injecting_task',
  'awaiting_ack',
  'awaiting_permission',
  'running',
  'handoff_pending',
  'waiting',
]);

const RECENT_DEFAULT_LIMIT = 50;
const RECENT_DEFAULT_WINDOW_MS = 30 * 60 * 1000;

const permissionActions: ActionCenterAction[] = [
  { id: 'deny_permission', label: 'Deny', tone: 'danger' },
  { id: 'approve_permission', label: 'Approve', tone: 'primary' },
  { id: 'focus_terminal', label: 'Focus', tone: 'neutral' },
];

const runtimeRecoveryActions: ActionCenterAction[] = [
  { id: 'focus_terminal', label: 'Focus', tone: 'neutral' },
  { id: 'retry_runtime', label: 'Retry', tone: 'primary' },
  { id: 'stop_runtime', label: 'Stop', tone: 'danger' },
];

const activeRuntimeActions: ActionCenterAction[] = [
  { id: 'focus_terminal', label: 'Focus', tone: 'neutral' },
  { id: 'stop_runtime', label: 'Stop', tone: 'danger' },
];

function createdAtFromInbox(item: ActionCenterInboxInput): number {
  const parsed = item.created_at ? Date.parse(item.created_at) : NaN;
  return Number.isFinite(parsed) ? parsed : Date.now();
}

function shortId(value: string | null | undefined): string {
  return value ? value.slice(0, 8) : 'unknown';
}

function statusLabel(status: string | undefined): string {
  return (status || 'unknown').replace(/_/g, ' ');
}

function isAuthWait(session: ActionCenterRuntimeSessionInput): boolean {
  return session.status === 'waiting_auth' || /authentication required/i.test(session.currentAction ?? '');
}

function runtimeBlockerKind(session: ActionCenterRuntimeSessionInput) {
  if (isAuthWait(session)) return 'auth_wait';
  if (session.status === 'manual_takeover') return 'manual_takeover';
  if (session.status === 'disconnected') return 'disconnected';
  if (session.status === 'failed') return 'failed';
  return null;
}

function runtimeTitle(session: ActionCenterRuntimeSessionInput): string {
  return session.roleId || session.title || `Runtime ${shortId(session.sessionId)}`;
}

function runtimeDetail(session: ActionCenterRuntimeSessionInput): string {
  const bits = [
    session.cli,
    session.nodeId ? `node ${shortId(session.nodeId)}` : null,
    session.terminalId ? `terminal ${shortId(session.terminalId)}` : null,
  ].filter(Boolean);
  return bits.join(' · ');
}

function deriveRuntimeItems(sessions: ActionCenterRuntimeSessionInput[]): ActionCenterItem[] {
  const items: ActionCenterItem[] = [];

  for (const session of sessions) {
    if (session.activePermission) {
      const permission = session.activePermission;
      items.push({
        id: `permission:${permission.permissionId}`,
        kind: 'permission',
        section: 'needs_you',
        severity: 'critical',
        source: 'runtime',
        title: `Permission needed: ${permission.category}`,
        detail: permission.detail || runtimeDetail(session),
        createdAt: permission.detectedAt ?? session.lastActivityAt ?? Date.now(),
        nodeId: permission.nodeId ?? session.nodeId,
        sessionId: permission.sessionId || session.sessionId,
        terminalId: session.terminalId,
        missionId: session.missionId,
        permissionId: permission.permissionId,
        category: permission.category,
        rawPrompt: permission.rawPrompt,
        actions: permissionActions,
      });
      continue;
    }

    const blockerKind = runtimeBlockerKind(session);
    if (blockerKind) {
      const manualActions: ActionCenterAction[] = blockerKind === 'manual_takeover'
        ? [
            { id: 'focus_terminal', label: 'Focus', tone: 'neutral' },
            { id: 'resume_node', label: 'Resume', tone: 'primary' },
            { id: 'force_success', label: 'Success', tone: 'neutral' },
            { id: 'force_fail', label: 'Fail', tone: 'danger' },
          ]
        : runtimeRecoveryActions;
      items.push({
        id: `runtime-blocker:${session.sessionId}:${blockerKind}`,
        kind: 'runtime_blocker',
        blockerKind,
        section: 'needs_you',
        severity: blockerKind === 'failed' || blockerKind === 'disconnected' ? 'critical' : 'warning',
        source: 'runtime',
        title: blockerKind === 'auth_wait'
          ? `${runtimeTitle(session)} needs authentication`
          : blockerKind === 'manual_takeover'
            ? `${runtimeTitle(session)} is waiting for manual takeover`
            : `${runtimeTitle(session)} ${statusLabel(session.status)}`,
        detail: session.currentAction || runtimeDetail(session),
        createdAt: session.lastActivityAt ?? session.startedAt ?? Date.now(),
        nodeId: session.nodeId,
        sessionId: session.sessionId,
        terminalId: session.terminalId,
        missionId: session.missionId,
        actions: manualActions,
      });
      continue;
    }

    if (ACTIVE_RUNTIME_STATUSES.has(session.status ?? '')) {
      items.push({
        id: `active-runtime:${session.sessionId}`,
        kind: 'active_runtime',
        section: 'active_now',
        severity: 'info',
        source: 'runtime',
        title: runtimeTitle(session),
        detail: session.currentAction || runtimeDetail(session) || statusLabel(session.status),
        createdAt: session.startedAt ?? Date.now(),
        nodeId: session.nodeId,
        sessionId: session.sessionId,
        terminalId: session.terminalId,
        missionId: session.missionId,
        status: session.status ?? 'unknown',
        roleId: session.roleId,
        cli: session.cli,
        actions: activeRuntimeActions,
      });
    }
  }

  return items;
}

function deriveInboxItems(inboxItems: ActionCenterInboxInput[]): ActionCenterItem[] {
  return inboxItems.map((item) => {
    const needsYou = item.status === 'pending' || item.status === 'approved';
    const actions: ActionCenterAction[] = item.status === 'pending'
      ? [
          { id: 'reject_delegation', label: 'Reject', tone: 'danger' },
          { id: 'approve_delegation', label: 'Approve', tone: 'primary' },
        ]
      : item.status === 'approved'
        ? [{ id: 'claim_delegation', label: 'Claim', tone: 'primary' }]
        : [];

    return {
      id: `delegation:${item.id}`,
      kind: 'delegation',
      section: needsYou ? 'needs_you' : 'recently_resolved',
      severity: needsYou ? 'warning' : item.status === 'rejected' ? 'critical' : 'success',
      source: 'mcp_inbox',
      title: item.title || `Delegation ${item.id}`,
      detail: item.objective ?? undefined,
      createdAt: createdAtFromInbox(item),
      nodeId: item.recipient_node_id ?? undefined,
      sessionId: item.recipient_session_id ?? undefined,
      missionId: item.mission_id,
      actions,
      dismissible: !needsYou,
      inboxItemId: item.id,
      status: item.status,
      fromSessionId: item.from_session_id,
      recipientNodeId: item.recipient_node_id,
      roleId: item.role_id,
    };
  });
}

function deriveRecentItems(
  recentEvents: ActionCenterRecentInput[],
  now: number,
  limit: number,
  windowMs: number,
): ActionCenterItem[] {
  return recentEvents
    .filter(event => now - event.createdAt <= windowMs)
    .sort((a, b) => b.createdAt - a.createdAt)
    .slice(0, limit)
    .map(event => ({
      id: `recent:${event.source}:${event.id}`,
      kind: 'recent_event',
      section: 'recently_resolved',
      severity: event.severity ?? 'info',
      source: event.source,
      title: event.title,
      detail: event.detail,
      createdAt: event.createdAt,
      nodeId: event.nodeId,
      sessionId: event.sessionId,
      terminalId: event.terminalId,
      missionId: event.missionId,
      actions: [{ id: 'clear_recent', label: 'Clear', tone: 'neutral' }],
      dismissible: true,
      eventType: event.eventType,
    }));
}

export function deriveActionCenterItems(input: DeriveActionCenterItemsInput): ActionCenterItem[] {
  const now = input.now ?? Date.now();
  const recentLimit = input.recentLimit ?? RECENT_DEFAULT_LIMIT;
  const recentWindowMs = input.recentWindowMs ?? RECENT_DEFAULT_WINDOW_MS;

  const items = [
    ...deriveRuntimeItems(input.sessions ?? []),
    ...deriveInboxItems(input.inboxItems ?? []),
    ...deriveRecentItems(input.recentEvents ?? [], now, recentLimit, recentWindowMs),
  ];

  return items.sort((a, b) => {
    const sectionRank = { needs_you: 0, active_now: 1, recently_resolved: 2 };
    const severityRank = { critical: 0, warning: 1, info: 2, success: 3 };
    const sectionDelta = sectionRank[a.section] - sectionRank[b.section];
    if (sectionDelta !== 0) return sectionDelta;
    const severityDelta = severityRank[a.severity] - severityRank[b.severity];
    if (severityDelta !== 0) return severityDelta;
    return b.createdAt - a.createdAt;
  });
}

export function countNeedsYou(items: ActionCenterItem[]): number {
  return items.filter(item => item.section === 'needs_you').length;
}
