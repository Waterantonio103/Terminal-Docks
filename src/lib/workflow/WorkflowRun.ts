/**
 * WorkflowRun.ts — Live workflow execution state.
 *
 * A WorkflowRun represents a single execution instance of a WorkflowDefinition.
 * It contains all runtime-only data: node statuses, attempts, runtime sessions,
 * events, permission requests, artifacts, and completion results.
 *
 * This data must NOT be persisted as part of the workflow design.
 * It may be persisted to SQLite for audit/history but never mixed into the
 * WorkflowDefinition.
 *
 * Phase 2 — Wave 2 / Agent A
 */

import type {
  Artifact,
  CompletionOutcome,
  EdgeCondition,
  NodeLifecycleState,
  PermissionDecision,
  PermissionRequest,
  RunStatus,
} from './WorkflowTypes.js';
import type {
  WorkflowDefinition,
  WorkflowEdgeDefinition,
} from './WorkflowDefinition.js';

// ──────────────────────────────────────────────
// Runtime Session
// ──────────────────────────────────────────────

export interface RuntimeSessionInfo {
  readonly sessionId: string;
  readonly terminalId: string;
  readonly paneId?: string;
  readonly cliId: string;
  readonly executionMode: string;
  readonly createdAt: number;
  lastHeartbeatAt?: number;
  disconnectedAt?: number;
}

// ──────────────────────────────────────────────
// Attempt Record
// ──────────────────────────────────────────────

export interface AttemptRecord {
  readonly attempt: number;
  readonly state: NodeLifecycleState;
  readonly startedAt?: number;
  readonly completedAt?: number;
  readonly outcome?: CompletionOutcome;
  readonly summary?: string;
  readonly artifacts: Artifact[];
  readonly filesChanged: string[];
  readonly payloadPreview?: string;
  readonly error?: string;
}

// ──────────────────────────────────────────────
// Node Run State
//
// Per-node runtime state during a workflow execution.
// ──────────────────────────────────────────────

export interface WorkflowNodeRunState {
  readonly nodeId: string;

  state: NodeLifecycleState;

  attempt: number;
  attempts: AttemptRecord[];

  runtimeSession?: RuntimeSessionInfo;

  activePermission?: PermissionRequest;

  currentAction?: string;

  activatedAt?: number;
  completedAt?: number;
}

// ──────────────────────────────────────────────
// Handoff Record
// ──────────────────────────────────────────────

export interface HandoffRecord {
  readonly fromNodeId: string;
  readonly targetNodeId: string;
  readonly outcome: CompletionOutcome;
  readonly condition: EdgeCondition;
  readonly fromAttempt: number;
  readonly timestamp: number;
  readonly summary?: string;
  readonly payload?: unknown;
}

// ──────────────────────────────────────────────
// Workflow Event
//
// Immutable log of what happened during a run.
// ──────────────────────────────────────────────

export type WorkflowEvent =
  | { type: 'run_started'; timestamp: number }
  | { type: 'run_completed'; timestamp: number; outcome: CompletionOutcome }
  | { type: 'run_cancelled'; timestamp: number }
  | { type: 'node_activated'; timestamp: number; nodeId: string; attempt: number }
  | { type: 'node_state_changed'; timestamp: number; nodeId: string; from: NodeLifecycleState; to: NodeLifecycleState }
  | { type: 'node_completed'; timestamp: number; nodeId: string; outcome: CompletionOutcome; attempt: number }
  | { type: 'node_failed'; timestamp: number; nodeId: string; error?: string; attempt: number }
  | { type: 'runtime_created'; timestamp: number; nodeId: string; sessionId: string; terminalId: string }
  | { type: 'runtime_disconnected'; timestamp: number; nodeId: string; sessionId: string }
  | { type: 'permission_requested'; timestamp: number; nodeId: string; permissionId: string; category: string }
  | { type: 'permission_resolved'; timestamp: number; nodeId: string; permissionId: string; decision: PermissionDecision }
  | { type: 'handoff'; timestamp: number; handoff: HandoffRecord }
  | { type: 'artifact_published'; timestamp: number; nodeId: string; artifact: Artifact }
  | { type: 'task_injected'; timestamp: number; nodeId: string; attempt: number }
  | { type: 'task_acked'; timestamp: number; nodeId: string; attempt: number }
  | { type: 'output_captured'; timestamp: number; nodeId: string; text: string };

// ──────────────────────────────────────────────
// Workflow Run
// ──────────────────────────────────────────────

export interface WorkflowRun {
  readonly runId: string;
  readonly definitionId: string;
  readonly definition: WorkflowDefinition;

  status: RunStatus;

  nodeStates: Record<string, WorkflowNodeRunState>;
  runtimeSessions: Record<string, RuntimeSessionInfo>;

  events: WorkflowEvent[];
  handoffs: HandoffRecord[];

  activePermissions: PermissionRequest[];

  startedAt?: number;
  completedAt?: number;
}

// ──────────────────────────────────────────────
// Factory — create a new WorkflowRun from a definition
// ──────────────────────────────────────────────

export function createWorkflowRun(
  runId: string,
  definition: WorkflowDefinition,
): WorkflowRun {
  const nodeStates: Record<string, WorkflowNodeRunState> = {};

  for (const node of definition.nodes) {
    if (node.kind === 'task' || node.kind === 'barrier' || node.kind === 'frame' || node.kind === 'reroute') {
      continue;
    }

    nodeStates[node.id] = {
      nodeId: node.id,
      state: 'idle',
      attempt: 0,
      attempts: [],
    };
  }

  return {
    runId,
    definitionId: definition.id,
    definition,
    status: 'idle',
    nodeStates,
    runtimeSessions: {},
    events: [],
    handoffs: [],
    activePermissions: [],
  };
}

// ──────────────────────────────────────────────
// Node State Mutations
// ──────────────────────────────────────────────

export function setNodeState(
  run: WorkflowRun,
  nodeId: string,
  newState: NodeLifecycleState,
): WorkflowEvent | null {
  const nodeState = run.nodeStates[nodeId];
  if (!nodeState) return null;

  const prevState = nodeState.state;
  if (prevState === newState) return null;

  nodeState.state = newState;

  return {
    type: 'node_state_changed',
    timestamp: Date.now(),
    nodeId,
    from: prevState,
    to: newState,
  };
}

export function activateNode(
  run: WorkflowRun,
  nodeId: string,
): void {
  const nodeState = run.nodeStates[nodeId];
  if (!nodeState) return;

  const nextAttempt = nodeState.attempt + 1;
  nodeState.attempt = nextAttempt;
  nodeState.state = 'queued';
  nodeState.activatedAt = Date.now();
  nodeState.completedAt = undefined;

  nodeState.attempts = [
    ...nodeState.attempts,
    {
      attempt: nextAttempt,
      state: 'queued',
      startedAt: Date.now(),
      artifacts: [],
      filesChanged: [],
    },
  ];

  run.events.push({
    type: 'node_activated',
    timestamp: Date.now(),
    nodeId,
    attempt: nextAttempt,
  });
}

export function completeNode(
  run: WorkflowRun,
  nodeId: string,
  outcome: CompletionOutcome,
  summary?: string,
  filesChanged?: string[],
  artifacts?: Artifact[],
): void {
  const nodeState = run.nodeStates[nodeId];
  if (!nodeState) return;

  const terminalState: NodeLifecycleState = outcome === 'success' ? 'completed' : 'failed';
  nodeState.state = terminalState;
  nodeState.completedAt = Date.now();

  if (nodeState.attempts.length > 0) {
    const current = nodeState.attempts[nodeState.attempts.length - 1];
    if (current) {
      nodeState.attempts[nodeState.attempts.length - 1] = {
        ...current,
        state: terminalState,
        completedAt: Date.now(),
        outcome,
        summary,
        filesChanged: filesChanged ?? current.filesChanged,
        artifacts: artifacts ?? current.artifacts,
      };
    }
  }

  run.events.push({
    type: outcome === 'success' ? 'node_completed' : 'node_failed',
    timestamp: Date.now(),
    nodeId,
    outcome,
    attempt: nodeState.attempt,
    ...(outcome === 'failure' ? { error: summary } : {}),
  });
}

export function failNode(
  run: WorkflowRun,
  nodeId: string,
  error?: string,
): void {
  completeNode(run, nodeId, 'failure', error);
}

// ──────────────────────────────────────────────
// Runtime Session Management
// ──────────────────────────────────────────────

export function attachRuntime(
  run: WorkflowRun,
  nodeId: string,
  session: RuntimeSessionInfo,
): void {
  const nodeState = run.nodeStates[nodeId];
  if (!nodeState) return;

  nodeState.runtimeSession = session;
  run.runtimeSessions[session.sessionId] = session;

  run.events.push({
    type: 'runtime_created',
    timestamp: Date.now(),
    nodeId,
    sessionId: session.sessionId,
    terminalId: session.terminalId,
  });
}

export function detachRuntime(
  run: WorkflowRun,
  nodeId: string,
  sessionId: string,
): void {
  const nodeState = run.nodeStates[nodeId];
  if (!nodeState) return;

  if (nodeState.runtimeSession?.sessionId === sessionId) {
    nodeState.runtimeSession = {
      ...nodeState.runtimeSession,
      disconnectedAt: Date.now(),
    };
  }

  run.events.push({
    type: 'runtime_disconnected',
    timestamp: Date.now(),
    nodeId,
    sessionId,
  });
}

// ──────────────────────────────────────────────
// Permission Management
// ──────────────────────────────────────────────

export function requestPermission(
  run: WorkflowRun,
  request: PermissionRequest,
): void {
  const nodeState = run.nodeStates[request.nodeId];
  if (!nodeState) return;

  nodeState.state = 'awaiting_permission';
  nodeState.activePermission = request;
  run.activePermissions.push(request);

  run.events.push({
    type: 'permission_requested',
    timestamp: Date.now(),
    nodeId: request.nodeId,
    permissionId: request.permissionId,
    category: request.category,
  });
}

export function resolvePermission(
  run: WorkflowRun,
  permissionId: string,
  decision: PermissionDecision,
): void {
  const idx = run.activePermissions.findIndex(p => p.permissionId === permissionId);
  if (idx === -1) return;

  const request = run.activePermissions[idx];
  if (!request) return;

  run.activePermissions.splice(idx, 1);

  const nodeState = run.nodeStates[request.nodeId];
  if (nodeState?.activePermission?.permissionId === permissionId) {
    nodeState.activePermission = undefined;
    nodeState.state = 'running';
  }

  run.events.push({
    type: 'permission_resolved',
    timestamp: Date.now(),
    nodeId: request.nodeId,
    permissionId,
    decision,
  });
}

// ──────────────────────────────────────────────
// Handoff Recording
// ──────────────────────────────────────────────

export function recordHandoff(
  run: WorkflowRun,
  handoff: HandoffRecord,
): void {
  run.handoffs.push(handoff);
  run.events.push({
    type: 'handoff',
    timestamp: handoff.timestamp,
    handoff,
  });
}

// ──────────────────────────────────────────────
// Artifact Recording
// ──────────────────────────────────────────────

export function recordArtifact(
  run: WorkflowRun,
  nodeId: string,
  artifact: Artifact,
): void {
  const nodeState = run.nodeStates[nodeId];
  if (!nodeState) return;

  if (nodeState.attempts.length > 0) {
    const current = nodeState.attempts[nodeState.attempts.length - 1];
    if (current && !current.artifacts.some(a => a.id === artifact.id)) {
      nodeState.attempts[nodeState.attempts.length - 1] = {
        ...current,
        artifacts: [...current.artifacts, artifact],
      };
    }
  }

  run.events.push({
    type: 'artifact_published',
    timestamp: Date.now(),
    nodeId,
    artifact,
  });
}

// ──────────────────────────────────────────────
// Run Lifecycle
// ──────────────────────────────────────────────

export function startRun(run: WorkflowRun): void {
  run.status = 'running';
  run.startedAt = Date.now();
  run.events.push({ type: 'run_started', timestamp: Date.now() });
}

export function completeRun(
  run: WorkflowRun,
  outcome: CompletionOutcome,
): void {
  run.status = 'completed';
  run.completedAt = Date.now();
  run.events.push({ type: 'run_completed', timestamp: Date.now(), outcome });
}

export function cancelRun(run: WorkflowRun): void {
  run.status = 'cancelled';
  run.completedAt = Date.now();
  run.events.push({ type: 'run_cancelled', timestamp: Date.now() });

  for (const nodeState of Object.values(run.nodeStates)) {
    if (
      nodeState.state !== 'completed' &&
      nodeState.state !== 'failed' &&
      nodeState.state !== 'cancelled'
    ) {
      nodeState.state = 'cancelled';
      nodeState.completedAt = Date.now();
    }
  }
}

// ──────────────────────────────────────────────
// Query Helpers
// ──────────────────────────────────────────────

export function getNodeState(
  run: WorkflowRun,
  nodeId: string,
): WorkflowNodeRunState | undefined {
  return run.nodeStates[nodeId];
}

export function getActiveNodes(run: WorkflowRun): WorkflowNodeRunState[] {
  return Object.values(run.nodeStates).filter(
    ns =>
      ns.state !== 'idle' &&
      ns.state !== 'completed' &&
      ns.state !== 'failed' &&
      ns.state !== 'cancelled',
  );
}

export function getLegalTargetsForNode(
  run: WorkflowRun,
  nodeId: string,
  outcome?: CompletionOutcome,
): WorkflowEdgeDefinition[] {
  return run.definition.edges.filter(edge => {
    if (edge.fromNodeId !== nodeId) return false;
    if (outcome === undefined) return true;
    if (edge.condition === 'always') return true;
    if (edge.condition === 'on_success' && outcome === 'success') return true;
    if (edge.condition === 'on_failure' && outcome === 'failure') return true;
    return false;
  });
}

export function getIncomingHandoffs(
  run: WorkflowRun,
  nodeId: string,
): HandoffRecord[] {
  return run.handoffs.filter(h => h.targetNodeId === nodeId);
}

export function getCompletedNodeIds(run: WorkflowRun): string[] {
  return Object.values(run.nodeStates)
    .filter(ns => ns.state === 'completed')
    .map(ns => ns.nodeId);
}

export function getFailedNodeIds(run: WorkflowRun): string[] {
  return Object.values(run.nodeStates)
    .filter(ns => ns.state === 'failed')
    .map(ns => ns.nodeId);
}
