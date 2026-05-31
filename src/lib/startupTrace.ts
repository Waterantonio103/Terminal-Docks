const marks: Array<{ label: string; elapsedMs: number }> = [];
const startedAt = typeof performance !== 'undefined' ? performance.now() : Date.now();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

export function markStartup(label: string): void {
  const elapsedMs = Math.round(now() - startedAt);
  marks.push({ label, elapsedMs });

  if (import.meta.env.DEV) {
    console.info(`[startup] ${label} +${elapsedMs}ms`);
  }
}

export function readStartupMarks(): Array<{ label: string; elapsedMs: number }> {
  return [...marks];
}
