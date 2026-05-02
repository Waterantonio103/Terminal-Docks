import type { ReadyState, WorkerKind, WorkerSession } from './types.js';

type Listener = (snapshot: RegistrySnapshot) => void;

export interface RegistrySnapshot {
  sessions: Array<{
    sessionId: string;
    paneId: string;
    terminalId: string;
    agentId: string;
    profileId: string;
    kind: WorkerKind;
    readyState: ReadyState;
    workspaceDir: string | null;
    lastHeartbeatAt: number;
    msSinceHeartbeat: number;
    currentTask?: WorkerSession['currentTask'];
  }>;
  totals: Record<ReadyState, number>;
}

export interface CandidateFilter {
  kind?: WorkerKind;
  agentId?: string;
  workspaceDir?: string | null;
  excludedSessionIds?: Set<string>;
}

const STALE_HEARTBEAT_MS = 60_000;

class WorkerRegistry {
  private bySession = new Map<string, WorkerSession>();
  private byPaneIndex = new Map<string, string>();
  private taskSeqBySession = new Map<string, number>();
  private listeners = new Set<Listener>();

  put(session: WorkerSession): WorkerSession {
    this.bySession.set(session.sessionId, session);
    this.byPaneIndex.set(session.paneId, session.sessionId);
    this.notify();
    return session;
  }

  get(sessionId: string): WorkerSession | null {
    return this.bySession.get(sessionId) ?? null;
  }

  byPane(paneId: string): WorkerSession | null {
    const sessionId = this.byPaneIndex.get(paneId);
    if (!sessionId) return null;
    return this.bySession.get(sessionId) ?? null;
  }

  remove(sessionId: string): void {
    const session = this.bySession.get(sessionId);
    this.bySession.delete(sessionId);
    this.taskSeqBySession.delete(sessionId);
    if (session) this.byPaneIndex.delete(session.paneId);
    this.notify();
  }

  nextTaskSeq(sessionId: string): number {
    const current = this.taskSeqBySession.get(sessionId) ?? 0;
    const next = current + 1;
    this.taskSeqBySession.set(sessionId, next);
    return next;
  }

  candidates(filter: CandidateFilter): WorkerSession[] {
    const excluded = filter.excludedSessionIds ?? new Set<string>();
    const normalizedDir = filter.workspaceDir?.trim().toLowerCase() ?? null;
    const results: WorkerSession[] = [];
    for (const session of this.bySession.values()) {
      if (excluded.has(session.sessionId)) continue;
      if (filter.kind && session.kind !== filter.kind) continue;
      if (filter.agentId && session.agentId !== filter.agentId) continue;
      if (normalizedDir) {
        const candidateDir = session.workspaceDir?.trim().toLowerCase() ?? null;
        if (candidateDir !== normalizedDir) continue;
      }
      if (session.readyState === 'stale' || session.readyState === 'dead') continue;
      results.push(session);
    }
    results.sort((left, right) => {
      const readyRank = (r: ReadyState) => (r === 'ready' ? 0 : r === 'busy' ? 1 : 2);
      return readyRank(left.readyState) - readyRank(right.readyState);
    });
    return results;
  }

  // ── MCP event consumers ─────────────────────────────────────────────────
  onReady(sessionId: string): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    session.readyState = 'ready';
    session.lastHeartbeatAt = Date.now();
    this.notify();
  }

  onHeartbeat(sessionId: string): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    session.lastHeartbeatAt = Date.now();
    this.notify();
  }

  onTaskAcked(sessionId: string, taskSeq: number): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    if (session.currentTask && session.currentTask.taskSeq === taskSeq) {
      session.readyState = 'busy';
    }
    this.notify();
  }

  onTaskCompleted(
    sessionId: string,
    taskSeq: number,
    outcome: 'success' | 'failure',
  ): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    if (session.currentTask && session.currentTask.taskSeq === taskSeq) {
      session.currentTask = undefined;
      session.readyState = 'ready';
    } else if (!session.currentTask) {
      session.readyState = 'ready';
    }
    session.lastHeartbeatAt = Date.now();
    void outcome;
    this.notify();
  }

  markStale(sessionId: string, _detail: string): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    session.readyState = 'stale';
    this.notify();
  }

  markDead(sessionId: string, _detail: string): void {
    const session = this.bySession.get(sessionId);
    if (!session) return;
    session.readyState = 'dead';
    this.notify();
  }

  tickStale(now = Date.now(), thresholdMs = STALE_HEARTBEAT_MS): string[] {
    const flipped: string[] = [];
    for (const session of this.bySession.values()) {
      if (session.readyState !== 'ready' && session.readyState !== 'busy') continue;
      if (now - session.lastHeartbeatAt > thresholdMs) {
        session.readyState = 'stale';
        flipped.push(session.sessionId);
      }
    }
    if (flipped.length > 0) this.notify();
    return flipped;
  }

  snapshot(now = Date.now()): RegistrySnapshot {
    const totals: Record<ReadyState, number> = {
      spawning: 0,
      booting: 0,
      ready: 0,
      busy: 0,
      stale: 0,
      dead: 0,
    };
    const sessions = Array.from(this.bySession.values()).map(session => {
      totals[session.readyState] += 1;
      return {
        sessionId: session.sessionId,
        paneId: session.paneId,
        terminalId: session.terminalId,
        agentId: session.agentId,
        profileId: session.profileId,
        kind: session.kind,
        readyState: session.readyState,
        workspaceDir: session.workspaceDir,
        lastHeartbeatAt: session.lastHeartbeatAt,
        msSinceHeartbeat: Math.max(0, now - session.lastHeartbeatAt),
        currentTask: session.currentTask,
      };
    });
    return { sessions, totals };
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => { this.listeners.delete(listener); };
  }

  private notify(): void {
    if (this.listeners.size === 0) return;
    const snap = this.snapshot();
    for (const listener of this.listeners) {
      try { listener(snap); } catch (error) { console.warn('registry listener failed', error); }
    }
  }
}

export const registry = new WorkerRegistry();

let staleInterval: ReturnType<typeof setInterval> | null = null;
export function startStaleTicker(intervalMs = 5_000): () => void {
  if (staleInterval) return () => {};
  staleInterval = setInterval(() => { registry.tickStale(); }, intervalMs);
  return () => {
    if (staleInterval) { clearInterval(staleInterval); staleInterval = null; }
  };
}
