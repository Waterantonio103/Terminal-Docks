export function workflowStatusLabel(status?: string): string {
  if (!status) return 'idle';
  if (status === 'handoff_pending') return 'handoff';
  return status;
}

export function workflowStatusTone(
  status: string | undefined,
  variant: 'graph' | 'mission' = 'graph',
): string {
  if (status === 'bound') {
    return variant === 'mission'
      ? 'text-slate-300 border-slate-300/30 bg-slate-300/10'
      : 'text-slate-200 border-slate-300/40 bg-slate-500/10';
  }
  if (status === 'launching' || status === 'spawning' || status === 'terminal_started' || status === 'activation_pending') {
    return variant === 'mission'
      ? 'text-blue-300 border-blue-300/30 bg-blue-300/10'
      : 'text-blue-200 border-blue-300/40 bg-blue-500/10';
  }
  if (status === 'connecting' || status === 'adapter_starting' || status === 'mcp_connecting' || status === 'registered') {
    return variant === 'mission'
      ? 'text-cyan-300 border-cyan-300/30 bg-cyan-300/10'
      : 'text-cyan-200 border-cyan-300/40 bg-cyan-500/10';
  }
  if (status === 'ready') {
    return variant === 'mission'
      ? 'text-emerald-300 border-emerald-300/30 bg-emerald-300/10'
      : 'text-emerald-200 border-emerald-300/40 bg-emerald-500/10';
  }
  if (status === 'activated' || status === 'activation_acked') {
    return variant === 'mission'
      ? 'text-violet-300 border-violet-300/30 bg-violet-300/10'
      : 'text-violet-200 border-violet-300/40 bg-violet-500/10';
  }
  if (status === 'running') {
    return variant === 'mission'
      ? 'text-accent-primary border-accent-primary/30 bg-accent-primary/10'
      : 'text-accent-primary border-accent-primary/40 bg-accent-primary/10';
  }
  if (status === 'handoff_pending' || status === 'waiting') {
    return variant === 'mission'
      ? 'text-amber-300 border-amber-300/30 bg-amber-300/10'
      : 'text-amber-200 border-amber-300/40 bg-amber-500/10';
  }
  if (status === 'done' || status === 'completed') {
    return variant === 'mission'
      ? 'text-green-400 border-green-400/30 bg-green-400/10'
      : 'text-green-200 border-green-300/40 bg-green-500/10';
  }
  if (status === 'failed' || status === 'unbound' || status === 'disconnected') {
    return variant === 'mission'
      ? 'text-red-400 border-red-400/30 bg-red-400/10'
      : 'text-red-200 border-red-300/40 bg-red-500/10';
  }
  return 'text-text-muted border-border-panel bg-bg-surface';
}
