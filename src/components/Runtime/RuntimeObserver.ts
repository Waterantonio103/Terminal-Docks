/**
 * RuntimeObserver — Live runtime session observer pattern.
 *
 * Subscribes to RuntimeManager to maintain a map of currently-alive runtime
 * sessions. This is the data source for RuntimeView and is independent of
 * MissionControlPane or persisted workspace state.
 *
 * Sessions only exist while the PTY/process is alive. On reload, no stale
 * sessions appear until a new workflow activates nodes.
 *
 * Phase 9 — Wave 3 / Agent D
 */

import type { MissionArtifact, WorkflowNodeStatus } from '../../store/workspace';
import { runtimeManager } from '../../lib/runtime/RuntimeManager';

// ──────────────────────────────────────────────
// Types
// ──────────────────────────────────────────────

export interface LiveRuntimeSession {
  nodeId: string;
  terminalId: string;
  sessionId: string;
  missionId: string;
  paneId?: string;
  cli: string;
  executionMode: string;
  roleId: string;
  title: string;
  status: WorkflowNodeStatus;
  attempt: number;
  runId?: string;
  currentAction?: string;
  artifacts: MissionArtifact[];
  startedAt: number;
  lastActivityAt: number;
  activeRunId?: string;
  activePermission?: import('../../lib/runtime/RuntimeTypes').RuntimePermissionRequest;
}

export type RuntimeSessionListener = (sessions: LiveRuntimeSession[]) => void;

// ──────────────────────────────────────────────
// RuntimeObserver singleton
// ──────────────────────────────────────────────

class RuntimeObserver {
  private listeners = new Set<RuntimeSessionListener>();
  private unsubscribeManager?: () => void;
  private started = false;

  start(): void {
    if (this.started) return;
    this.started = true;
    this.unsubscribeManager = runtimeManager.subscribeSnapshot((snapshot) => {
      this.notifyAll(snapshot);
    });
  }

  stop(): void {
    if (!this.started) return;
    this.started = false;
    if (this.unsubscribeManager) {
      this.unsubscribeManager();
      this.unsubscribeManager = undefined;
    }
    this.notifyAll({ sessions: [], activeCount: 0 });
  }

  subscribe(listener: RuntimeSessionListener): () => void {
    this.listeners.add(listener);
    listener(this.getSessions());
    return () => {
      this.listeners.delete(listener);
    };
  }

  getSessions(): LiveRuntimeSession[] {
    const snapshot = runtimeManager.snapshot();
    return this.mapSnapshotToSessions(snapshot);
  }

  getSessionByNodeId(nodeId: string): LiveRuntimeSession | undefined {
    return this.getSessions().find(s => s.nodeId === nodeId);
  }

  getSessionByTerminal(terminalId: string): LiveRuntimeSession | undefined {
    return this.getSessions().find(s => s.terminalId === terminalId);
  }

  // ──────────────────────────────────────────────
  // Private — event handling
  // ──────────────────────────────────────────────

  private notifyAll(snapshot: import('../../lib/runtime/RuntimeTypes').RuntimeManagerSnapshot): void {
    const sessions = this.mapSnapshotToSessions(snapshot);
    for (const listener of this.listeners) {
      try { listener(sessions); } catch {}
    }
  }

  private mapSnapshotToSessions(snapshot: import('../../lib/runtime/RuntimeTypes').RuntimeManagerSnapshot): LiveRuntimeSession[] {
    return snapshot.sessions.map(s => ({
      nodeId: s.nodeId,
      terminalId: s.terminalId,
      sessionId: s.sessionId,
      missionId: s.missionId,
      paneId: s.paneId,
      cli: s.cliId,
      executionMode: s.executionMode,
      roleId: s.role,
      title: `${s.role || 'Agent'} — ${s.nodeId}`,
      status: this.mapRuntimeStateToNodeStatus(s.state),
      attempt: s.attempt,
      artifacts: [],
      startedAt: s.createdAt,
      lastActivityAt: s.lastHeartbeatAt ?? s.createdAt,
      currentAction: s.activePermission ? 'Awaiting Permission' : (s.lastError ? 'Failed' : undefined),
      activePermission: s.activePermission
    }));
  }

  private mapRuntimeStateToNodeStatus(state: string): WorkflowNodeStatus {
    switch (state) {
      case 'creating':
      case 'launching_cli':
      case 'awaiting_cli_ready':
      case 'registering_mcp':
      case 'bootstrap_injecting':
      case 'bootstrap_sent':
      case 'awaiting_mcp_ready':
        return 'launching';
      case 'ready':
        return 'ready';
      case 'injecting_task':
      case 'awaiting_ack':
        return 'activation_pending';
      case 'running':
      case 'awaiting_permission':
        return 'running';
      case 'completed':
        return 'completed';
      case 'failed':
      case 'cancelled':
        return 'failed';
      default:
        return 'idle';
    }
  }
}

// ──────────────────────────────────────────────
// Singleton export
// ──────────────────────────────────────────────

export const runtimeObserver = new RuntimeObserver();
