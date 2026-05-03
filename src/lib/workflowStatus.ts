function agentState(status: string | undefined): 'idle' | 'online' | 'success' | 'failure' | 'cancelled' {
  if (!status || status === 'idle' || status === 'bound') return 'idle';
  if (status === 'done' || status === 'completed') return 'success';
  if (status === 'cancelled') return 'cancelled';
  if (status === 'failed' || status === 'unbound' || status === 'disconnected') return 'failure';
  return 'online';
}

export function workflowStatusLabel(status?: string): string {
  const state = agentState(status);
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
  if (state === 'online') return 'badge-beam badge-beam-online text-accent-primary border-transparent bg-accent-primary/10';
  if (state === 'success') return 'badge-beam badge-beam-success text-green-500 border-transparent bg-green-500/10';
  if (state === 'failure') return 'badge-beam badge-beam-failure text-red-500 border-transparent bg-red-500/10';
  if (state === 'cancelled') return 'badge-beam badge-beam-idle text-text-muted border-transparent background-bg-surface';
  return 'badge-beam badge-beam-idle text-text-muted border-transparent background-bg-surface';
}
