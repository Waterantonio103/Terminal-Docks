export function workflowStatusLabel(status?: string): string {
  if (!status) return 'idle';
  if (status === 'handoff_pending') return 'handoff';
  if (status === 'completed') return 'done';
  return status;
}

export function workflowStatusTone(
  status: string | undefined,
  variant: 'graph' | 'mission' = 'graph',
): string {
  if (status === 'launching') {
    return variant === 'mission'
      ? 'text-blue-300 border-blue-300/30 bg-blue-300/10'
      : 'text-blue-200 border-blue-300/40 bg-blue-500/10';
  }
  if (status === 'connecting') {
    return variant === 'mission'
      ? 'text-cyan-300 border-cyan-300/30 bg-cyan-300/10'
      : 'text-cyan-200 border-cyan-300/40 bg-cyan-500/10';
  }
  if (status === 'ready') {
    return variant === 'mission'
      ? 'text-emerald-300 border-emerald-300/30 bg-emerald-300/10'
      : 'text-emerald-200 border-emerald-300/40 bg-emerald-500/10';
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
  if (status === 'failed' || status === 'unbound') {
    return variant === 'mission'
      ? 'text-red-400 border-red-400/30 bg-red-400/10'
      : 'text-red-200 border-red-300/40 bg-red-500/10';
  }
  return 'text-text-muted border-border-panel bg-bg-surface';
}
