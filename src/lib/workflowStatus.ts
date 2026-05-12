const LOADING_STATUSES = new Set([
  'creating',
  'launching',
  'connecting',
  'spawning',
  'terminal_started',
  'adapter_starting',
  'mcp_connecting',
  'launching_cli',
  'awaiting_cli_ready',
  'registering_mcp',
  'bootstrap_injecting',
  'bootstrap_sent',
  'awaiting_mcp_ready',
]);

const ACTIVE_STATUSES = new Set([
  'registered',
  'ready',
  'activation_pending',
  'activation_acked',
  'activated',
  'injecting_task',
  'awaiting_ack',
  'running',
  'handoff_pending',
  'waiting',
  'awaiting_permission',
  ...LOADING_STATUSES,
]);

export function isWorkflowStatusLoading(status: string | undefined): boolean {
  return LOADING_STATUSES.has(status ?? '');
}

export function isWorkflowStatusActive(status: string | undefined): boolean {
  return ACTIVE_STATUSES.has(status ?? '');
}

function agentState(status: string | undefined): 'idle' | 'loading' | 'online' | 'success' | 'failure' | 'cancelled' {
  if (!status || status === 'idle' || status === 'bound') return 'idle';
  if (isWorkflowStatusLoading(status)) return 'loading';
  if (status === 'done' || status === 'completed') return 'success';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed' || status === 'unbound' || status === 'disconnected') return 'failure';
  return 'online';
}

export function workflowStatusLabel(status?: string): string {
  const state = agentState(status);
  if (state === 'loading') return 'LOADING';
  if (state === 'online') return 'ONLINE';
  if (state === 'success') return 'SUCCESS';
  if (state === 'failure') return 'FAILURE';
  if (state === 'cancelled') return 'CANCELLED';
  return 'IDLE';
}

export function workflowStatusTone(
  status: string | undefined,
  _variant: 'graph' | 'mission' = 'graph',
): string {
  const state = agentState(status);
  if (state === 'loading') return 'badge-beam badge-beam-loading text-sky-300 border-transparent bg-sky-500/10';
  if (state === 'online') return 'badge-beam badge-beam-online text-accent-primary border-transparent bg-accent-primary/10';
  if (state === 'success') return 'badge-beam badge-beam-success text-green-500 border-transparent bg-green-500/10';
  if (state === 'failure') return 'badge-beam badge-beam-failure text-red-500 border-transparent bg-red-500/10';
  if (state === 'cancelled') return 'badge-beam badge-beam-idle text-text-muted border-transparent background-bg-surface';
  return 'badge-beam badge-beam-idle text-text-muted border-transparent background-bg-surface';
}
