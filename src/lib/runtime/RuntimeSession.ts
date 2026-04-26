/**
 * RuntimeSession.ts — Represents a single live CLI runtime session.
 *
 * Encapsulates session state, the active CLI adapter, and provides
 * methods for lifecycle transitions. The RuntimeManager creates and
 * owns RuntimeSession instances.
 *
 * Phase 4 — Wave 3 / Agent B
 */

import type { CliAdapter } from './adapters/CliAdapter.js';
import type {
  RuntimeSessionDescriptor,
  RuntimeSessionState,
  RuntimePermissionRequest,
} from './RuntimeTypes.js';
import type { CliId, ExecutionMode } from '../workflow/WorkflowTypes.js';

function generateSessionId(cliId: string): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${cliId}:${Date.now().toString(36)}:${rand}`;
}

export class RuntimeSession {
  readonly sessionId: string;
  readonly missionId: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly role: string;
  readonly agentId: string;
  readonly profileId: string;
  readonly cliId: CliId;
  readonly executionMode: ExecutionMode;
  readonly terminalId: string;
  readonly paneId?: string;
  readonly workspaceDir: string | null;
  readonly goal?: string;
  readonly legalTargets?: import('../workflow/WorkflowTypes.js').LegalTarget[];
  readonly upstreamPayloads?: import('../workflow/WorkflowRun.js').HandoffRecord[];
  readonly createdAt: number;
  readonly adapter: CliAdapter;

  private _state: RuntimeSessionState;
  private _lastHeartbeatAt?: number;
  private _disconnectedAt?: number;
  private _lastError?: string;
  private _activePermission?: RuntimePermissionRequest;

  private stateListeners = new Set<(from: RuntimeSessionState, to: RuntimeSessionState) => void>();

  constructor(
    adapter: CliAdapter,
    args: {
      missionId: string;
      nodeId: string;
      attempt: number;
      role: string;
      agentId: string;
      profileId?: string | null;
      cliId: CliId;
      executionMode: ExecutionMode;
      terminalId: string;
      paneId?: string | null;
      workspaceDir?: string | null;
      goal?: string;
      legalTargets?: import('../workflow/WorkflowTypes.js').LegalTarget[];
      upstreamPayloads?: import('../workflow/WorkflowRun.js').HandoffRecord[];
    },
  ) {
    this.sessionId = generateSessionId(adapter.id);
    this.adapter = adapter;
    this.missionId = args.missionId;
    this.nodeId = args.nodeId;
    this.attempt = args.attempt;
    this.role = args.role;
    this.agentId = args.agentId;
    this.profileId = args.profileId ?? args.role;
    this.cliId = args.cliId;
    this.executionMode = args.executionMode;
    this.terminalId = args.terminalId;
    this.paneId = args.paneId ?? undefined;
    this.workspaceDir = args.workspaceDir ?? null;
    this.goal = args.goal;
    this.legalTargets = args.legalTargets;
    this.upstreamPayloads = args.upstreamPayloads;
    this.createdAt = Date.now();
    this._state = 'creating';
  }

  get state(): RuntimeSessionState {
    return this._state;
  }

  get lastHeartbeatAt(): number | undefined {
    return this._lastHeartbeatAt;
  }

  get disconnectedAt(): number | undefined {
    return this._disconnectedAt;
  }

  get lastError(): string | undefined {
    return this._lastError;
  }

  get activePermission(): RuntimePermissionRequest | undefined {
    return this._activePermission;
  }

  get isHeadless(): boolean {
    return this.executionMode === 'headless' || this.executionMode === 'streaming_headless';
  }

  get isTerminal(): boolean {
    return !this.isHeadless;
  }

  toDescriptor(): RuntimeSessionDescriptor {
    return {
      sessionId: this.sessionId,
      missionId: this.missionId,
      nodeId: this.nodeId,
      attempt: this.attempt,
      role: this.role,
      agentId: this.agentId,
      profileId: this.profileId,
      cliId: this.cliId,
      executionMode: this.executionMode,
      terminalId: this.terminalId,
      paneId: this.paneId,
      workspaceDir: this.workspaceDir,
      createdAt: this.createdAt,
      state: this._state,
      lastHeartbeatAt: this._lastHeartbeatAt,
      disconnectedAt: this._disconnectedAt,
      lastError: this._lastError,
      activePermission: this._activePermission,
      goal: this.goal,
      legalTargets: this.legalTargets,
      upstreamPayloads: this.upstreamPayloads,
    };
  }

  // ── State transitions ──────────────────────────────────────────────

  transitionTo(newState: RuntimeSessionState): void {
    const prev = this._state;
    if (prev === newState) return;
    this._state = newState;
    for (const listener of this.stateListeners) {
      try {
        listener(prev, newState);
      } catch {
        // swallow listener errors
      }
    }
  }

  markFailed(error: string): void {
    this._lastError = error;
    this.transitionTo('failed');
  }

  markCompleted(): void {
    this.transitionTo('completed');
  }

  markCancelled(reason: string): void {
    this._lastError = reason;
    this.transitionTo('cancelled');
  }

  markDisconnected(reason: string): void {
    this._disconnectedAt = Date.now();
    this._lastError = reason;
  }

  updateHeartbeat(at?: number): void {
    this._lastHeartbeatAt = at ?? Date.now();
  }

  setPermission(request: RuntimePermissionRequest): void {
    this._activePermission = request;
    this.transitionTo('awaiting_permission');
  }

  clearPermission(): void {
    this._activePermission = undefined;
    if (this._state === 'awaiting_permission') {
      this.transitionTo('running');
    }
  }

  // ── Subscription ──────────────────────────────────────────────

  onStateChange(listener: (from: RuntimeSessionState, to: RuntimeSessionState) => void): () => void {
    this.stateListeners.add(listener);
    return () => {
      this.stateListeners.delete(listener);
    };
  }
}
