export type ActionCenterSection = 'needs_you' | 'active_now' | 'recently_resolved';
export type ActionCenterSeverity = 'critical' | 'warning' | 'info' | 'success';
export type ActionCenterSource = 'runtime' | 'workflow' | 'mcp_inbox' | 'rust_pty';

export type ActionCenterActionId =
  | 'approve_permission'
  | 'deny_permission'
  | 'focus_terminal'
  | 'retry_runtime'
  | 'stop_runtime'
  | 'resume_node'
  | 'force_success'
  | 'force_fail'
  | 'approve_delegation'
  | 'reject_delegation'
  | 'claim_delegation'
  | 'clear_recent';

export interface ActionCenterAction {
  id: ActionCenterActionId;
  label: string;
  tone?: 'primary' | 'danger' | 'neutral';
}

interface ActionCenterItemBase {
  id: string;
  section: ActionCenterSection;
  severity: ActionCenterSeverity;
  title: string;
  detail?: string;
  source: ActionCenterSource;
  createdAt: number;
  nodeId?: string;
  sessionId?: string;
  terminalId?: string;
  missionId?: string;
  actions: ActionCenterAction[];
  dismissible?: boolean;
}

export interface PermissionActionItem extends ActionCenterItemBase {
  kind: 'permission';
  permissionId: string;
  category: string;
  rawPrompt?: string;
}

export interface RuntimeBlockerItem extends ActionCenterItemBase {
  kind: 'runtime_blocker';
  blockerKind: 'auth_wait' | 'manual_takeover' | 'failed' | 'disconnected' | 'stale';
}

export interface DelegationItem extends ActionCenterItemBase {
  kind: 'delegation';
  inboxItemId: number;
  status: 'pending' | 'approved' | 'rejected' | 'claimed' | 'completed';
  fromSessionId?: string;
  recipientNodeId?: string | null;
  roleId?: string | null;
}

export interface ActiveRuntimeItem extends ActionCenterItemBase {
  kind: 'active_runtime';
  status: string;
  roleId?: string;
  cli?: string;
}

export interface RecentEventItem extends ActionCenterItemBase {
  kind: 'recent_event';
  eventType: string;
}

export type ActionCenterItem =
  | PermissionActionItem
  | RuntimeBlockerItem
  | DelegationItem
  | ActiveRuntimeItem
  | RecentEventItem;

export interface ActionCenterPermissionInput {
  permissionId: string;
  category: string;
  rawPrompt?: string;
  detail?: string;
  detectedAt?: number;
  sessionId: string;
  nodeId?: string;
}

export interface ActionCenterRuntimeSessionInput {
  nodeId?: string;
  terminalId?: string;
  sessionId: string;
  missionId?: string;
  cli?: string;
  roleId?: string;
  title?: string;
  status?: string;
  currentAction?: string;
  startedAt?: number;
  lastActivityAt?: number;
  activePermission?: ActionCenterPermissionInput;
}

export interface ActionCenterInboxInput {
  id: number;
  mission_id?: string;
  from_session_id?: string;
  recipient_session_id?: string | null;
  recipient_node_id?: string | null;
  role_id?: string | null;
  title?: string;
  objective?: string | null;
  status: 'pending' | 'approved' | 'rejected' | 'claimed' | 'completed';
  created_at?: string;
}

export interface ActionCenterRecentInput {
  id: string;
  source: ActionCenterSource;
  eventType: string;
  title: string;
  detail?: string;
  createdAt: number;
  severity?: ActionCenterSeverity;
  nodeId?: string;
  sessionId?: string;
  terminalId?: string;
  missionId?: string;
}

export interface DeriveActionCenterItemsInput {
  sessions?: ActionCenterRuntimeSessionInput[];
  inboxItems?: ActionCenterInboxInput[];
  recentEvents?: ActionCenterRecentInput[];
  now?: number;
  recentLimit?: number;
  recentWindowMs?: number;
}
