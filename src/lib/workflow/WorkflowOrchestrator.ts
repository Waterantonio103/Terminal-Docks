/**
 * WorkflowOrchestrator.ts — Canonical workflow brain.
 *
 * One orchestrator instance owns all active WorkflowRun objects.
 * It activates start nodes, requests runtimes from RuntimeManager,
 * routes completions/handoffs to downstream nodes, and emits
 * state updates for UI components to observe.
 *
 * The orchestrator does NOT own raw PTY, CLI-specific parsing,
 * file editing, or UI rendering. It is a pure state + routing layer.
 *
 * Phase 5 — Wave 3 / Agent A
 */

import type {
  Artifact,
  CompletionOutcome,
  EdgeCondition,
  FailureCategory,
  NodeLifecycleState,
  PermissionDecision,
  PermissionRequest,
} from './WorkflowTypes.js';
import type {
  WorkflowDefinition,
  WorkflowEdgeDefinition,
  WorkflowNodeDefinition,
} from './WorkflowDefinition.js';
import {
  activateNode,
  attachRuntime,
  completeNode as completeNodeInRun,
  createWorkflowRun,
  detachRuntime,
  failNode,
  getNodeState,
  getLegalTargetsForNode,
  getIncomingHandoffs,
  recordArtifact,
  recordHandoff,
  requestPermission,
  resolvePermission as resolvePermissionInRun,
  setNodeState,
  startRun,
} from './WorkflowRun.js';
import type {
  WorkflowRun,
  RuntimeSessionInfo,
  HandoffRecord,
} from './WorkflowRun.js';
import type {
  OrchestratorEvent,
  OrchestratorEventHandler,
  OrchestratorEventSubscription,
} from './WorkflowEvents.js';
import { WorkflowEventEmitter } from './WorkflowEvents.js';
import { validateTransition } from './WorkflowStateMachine.js';
import { mcpBus } from '../workers/mcpEventBus.js';

// ──────────────────────────────────────────────
// Runtime Manager Port
//
// Interface the Orchestrator uses to request runtimes.
// Phase 4 (Agent B) will provide the real implementation.
// Until then, a no-op stub can be injected.
// ──────────────────────────────────────────────

export interface RuntimeManagerPort {
  getSessionForNode(missionId: string, nodeId: string, attempt: number): import('../runtime/RuntimeSession.js').RuntimeSession | undefined;

  validateSessionForReuse(
    sessionId: string,
    expected: import('../runtime/RuntimeTypes.js').RuntimeReuseExpectation,
  ): Promise<import('../runtime/RuntimeTypes.js').SessionLivenessResult>;

  ensureRuntimeReadyForTask(args: import('../runtime/RuntimeTypes.js').CreateRuntimeArgs): Promise<import('../runtime/RuntimeSession.js').RuntimeSession>;

  startNodeRun(args: import('../runtime/RuntimeTypes.js').CreateRuntimeArgs): Promise<import('../runtime/RuntimeSession.js').RuntimeSession>;

  reinjectTask(sessionId: string): Promise<void>;

  sendTask(args: import('../runtime/RuntimeTypes.js').SendTaskArgs): Promise<void>;

  sendInput(args: import('../runtime/RuntimeTypes.js').SendInputArgs): Promise<void>;

  stopRuntime(args: import('../runtime/RuntimeTypes.js').StopRuntimeArgs): Promise<void>;

  writeBootstrapToTerminal(terminalId: string, data: string, caller: string): Promise<void>;

  subscribe(listener: (event: import('../runtime/RuntimeTypes.js').RuntimeManagerEvent) => void): () => void;
}


// ──────────────────────────────────────────────
// Node Activation Context
//
// Everything the orchestrator needs to know about
// a node when activating it.
// ──────────────────────────────────────────────

export interface NodeActivationContext {
  nodeId: string;
  roleId: string;
  cliId: string;
  modelId: string | null;
  yolo: boolean;
  executionMode: string;
  workspaceDir: string | null;
  legalTargets: WorkflowEdgeDefinition[];
  upstreamPayloads: HandoffRecord[];
}

// ──────────────────────────────────────────────
// Start Run Options
// ──────────────────────────────────────────────

export interface StartRunOptions {
  runId?: string;
  missionId?: string;
  workspaceDir?: string | null;
}

// ──────────────────────────────────────────────
// Completion Report (from MCP tools or runtime callbacks)
// ──────────────────────────────────────────────

export interface NodeCompletionReport {
  nodeId: string;
  attempt: number;
  outcome: CompletionOutcome;
  summary?: string;
  filesChanged?: string[];
  artifactReferences?: string[];
  rawOutput?: string;
  downstreamPayload?: unknown;
}

// ──────────────────────────────────────────────
// Handoff Request (from MCP tools)
// ──────────────────────────────────────────────

export interface HandoffRequest {
  fromNodeId: string;
  targetNodeId: string;
  fromAttempt: number;
  outcome: CompletionOutcome;
  title: string;
  description?: string;
  payload?: unknown;
}

// ──────────────────────────────────────────────
// Orchestrator
// ──────────────────────────────────────────────

export class WorkflowOrchestrator {
  private runs = new Map<string, WorkflowRun>();
  private eventEmitter = new WorkflowEventEmitter();
  private runtimeManager: RuntimeManagerPort | null = null;

  // ──────────────────────────────────────────
  // Dependency Injection
  // ──────────────────────────────────────────

  private unlistenRuntimeManager?: () => void;
  private mcpUnsubscribers = new Map<string, () => void>();
  private pendingRuntimeSessions = new Map<string, { runId: string; nodeId: string }>();

  setRuntimeManager(manager: RuntimeManagerPort): void {
    if (this.unlistenRuntimeManager) {
      this.unlistenRuntimeManager();
    }
    this.runtimeManager = manager;
    this.unlistenRuntimeManager = manager.subscribe(event => {
      this.handleRuntimeManagerEvent(event);
    });
  }

  private handleRuntimeManagerEvent(event: import('../runtime/RuntimeTypes.js').RuntimeManagerEvent): void {
    const run = this.findRunForRuntimeEvent(event);
    if (!run) return;

    switch (event.type) {
      case 'session_created':
        this.pendingRuntimeSessions.set(event.sessionId, { runId: run.runId, nodeId: event.nodeId });
        this.wireMcpForSession(run.runId, event.sessionId);
        break;

      case 'session_completed':
        this.handleNodeCompletion(run.runId, {
          nodeId: event.nodeId,
          attempt: run.nodeStates[event.nodeId]?.attempt || 1,
          outcome: event.outcome,
        });
        this.pendingRuntimeSessions.delete(event.sessionId);
        break;

      case 'session_state_changed':
        setNodeState(run, event.nodeId, event.to as import('./WorkflowTypes.js').NodeLifecycleState);
        this.emit({
          type: 'node_state_changed',
          runId: run.runId,
          nodeId: event.nodeId,
          from: event.from as import('./WorkflowTypes.js').NodeLifecycleState,
          to: event.to as import('./WorkflowTypes.js').NodeLifecycleState,
          timestamp: Date.now(),
        });
        break;

      case 'permission_requested':
        this.handlePermissionRequest(run.runId, {
          permissionId: event.request.permissionId,
          nodeId: event.nodeId,
          category: event.request.category,
          description: event.request.detail,
          rawPrompt: event.request.rawPrompt,
          detectedAt: event.request.detectedAt,
        });
        break;

      case 'permission_resolved':
        this.resolvePermission(run.runId, event.permissionId, event.decision);
        break;

      case 'task_acked':
        // Transitioned by setNodeState in session_state_changed
        break;

      case 'artifact_published':
        {
          const artifact: Artifact = {
            id: event.artifact.id,
            kind: event.artifact.kind,
            label: event.artifact.label,
            content: event.artifact.content,
            path: event.artifact.path,
            timestamp: event.artifact.timestamp,
          };
          recordArtifact(run, event.nodeId, artifact);
          this.emit({
            type: 'artifact_published',
            runId: run.runId,
            nodeId: event.nodeId,
            artifact,
            timestamp: Date.now(),
          });
        }
        break;

      case 'session_failed':
        failNode(run, event.nodeId, event.error);
        this.emit({
          type: 'node_failed',
          runId: run.runId,
          nodeId: event.nodeId,
          error: event.error,
          attempt: run.nodeStates[event.nodeId]?.attempt || 1,
          timestamp: Date.now(),
        });
        break;
    }
  }

  private wireMcpForSession(runId: string, sessionId: string): void {
    if (this.mcpUnsubscribers.has(sessionId)) return;

    const unsub = mcpBus.subscribe(sessionId, event => {
      if (event.type === 'task:completed') {
        this.handleNodeCompletion(runId, {
          nodeId: event.nodeId!,
          attempt: event.attempt || 1,
          outcome: event.outcome as import('./WorkflowTypes.js').CompletionOutcome,
          summary: event.summary,
          filesChanged: event.filesChanged,
          artifactReferences: event.artifactReferences,
          downstreamPayload: event.payload,
          targetNodeId: event.targetNodeId || undefined,
        });
      }
    });

    this.mcpUnsubscribers.set(sessionId, unsub);
  }

  private handleNodeCompletion(runId: string, report: NodeCompletionReport & { targetNodeId?: string }): void {
    const run = this.runs.get(runId);
    if (!run) return;

    const { nodeId, outcome, targetNodeId } = report;
    const existingState = run.nodeStates[nodeId]?.state;
    const attempts = run.nodeStates[nodeId]?.attempts ?? [];
    const currentAttempt = attempts[attempts.length - 1];
    if (
      (existingState === 'completed' || existingState === 'failed' || existingState === 'cancelled') &&
      currentAttempt?.outcome
    ) {
      return;
    }

    let explicitHandoff: HandoffRecord | null = null;

    // Phase 11: Validation of legal targets
    if (targetNodeId) {
      const legalTargets = getLegalTargetsForNode(run, nodeId, outcome);
      const legalTarget = legalTargets.find(t => t.toNodeId === targetNodeId);
      if (!legalTarget) {
        console.warn(`[Orchestrator] Illegal handoff attempt from ${nodeId} to ${targetNodeId}. Target is not a downstream neighbor in the graph.`);
        // Ignore the explicit target and fall back to normal routing.
      } else {
        // Explicit legal handoff
        explicitHandoff = {
          fromNodeId: nodeId,
          targetNodeId,
          fromAttempt: report.attempt,
          outcome,
          payload: report.downstreamPayload,
          condition: (legalTarget.condition || 'always') as import('./WorkflowTypes.js').EdgeCondition,
          timestamp: Date.now(),
        };
        recordHandoff(run, explicitHandoff);
      }
    }

    completeNodeInRun(run, nodeId, outcome, report.summary, report.filesChanged, (report as any).artifacts);
    this.emit({
      type: 'node_completed',
      runId,
      nodeId,
      outcome,
      attempt: report.attempt,
      timestamp: Date.now(),
    });

    // Determine next nodes
    if (explicitHandoff) {
      // Explicit handoff is still subject to fan-in readiness.
      this.activateDownstreamNode(run, explicitHandoff.targetNodeId, nodeId, explicitHandoff);
    } else {
      // Normal completion: activate all downstream nodes matching outcome
      this.routeToDownstream(run, nodeId, outcome, report.downstreamPayload);
    }

    // Check if run is complete
    this.checkRunCompletion(run);
  }

  private findRunBySessionId(sessionId: string): WorkflowRun | undefined {
    for (const run of this.runs.values()) {
      if (run.runtimeSessions[sessionId]) return run;
    }
    return undefined;
  }

  private findRunForRuntimeEvent(event: import('../runtime/RuntimeTypes.js').RuntimeManagerEvent): WorkflowRun | undefined {
    const attachedRun = this.findRunBySessionId(event.sessionId);
    if (attachedRun) return attachedRun;

    const pending = this.pendingRuntimeSessions.get(event.sessionId);
    if (pending) return this.runs.get(pending.runId);

    if (event.type === 'session_created') {
      return this.runs.get(event.missionId);
    }

    return undefined;
  }

  getRuntimeManager(): RuntimeManagerPort | null {
    return this.runtimeManager;
  }

  // ──────────────────────────────────────────
  // Run Lifecycle
  // ──────────────────────────────────────────

  startRun(definition: WorkflowDefinition, options?: StartRunOptions): WorkflowRun {
    const runId = options?.runId ?? generateRunId();
    const run = createWorkflowRun(runId, definition);

    this.runs.set(runId, run);
    this.emit({ type: 'run_created', runId, definitionId: definition.id, timestamp: Date.now() });

    startRun(run);
    this.emit({ type: 'run_started', runId, timestamp: Date.now() });

    const startNodeIds = this.resolveStartNodes(definition);
    for (const nodeId of startNodeIds) {
      this.activateNodeInternal(run, nodeId);
    }

    return run;
  }

  cancelRun(runId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    const prevStatus = run.status;

    for (const [sessionId, session] of Object.entries(run.runtimeSessions)) {
      if (!session.disconnectedAt && this.runtimeManager) {
        this.runtimeManager.stopRuntime({ sessionId }).catch((err) => {
          console.warn(`[Orchestrator] Failed to stop runtime ${sessionId}:`, err);
        });
      }
    }

    for (const nodeState of Object.values(run.nodeStates)) {
      if (
        nodeState.state !== 'completed' &&
        nodeState.state !== 'failed' &&
        nodeState.state !== 'cancelled'
      ) {
        const prev = nodeState.state;
        nodeState.state = 'cancelled';
        nodeState.completedAt = Date.now();
        this.emit({
          type: 'node_state_changed',
          runId,
          nodeId: nodeState.nodeId,
          from: prev,
          to: 'cancelled',
          timestamp: Date.now(),
        });
      }
    }

    run.status = 'cancelled';
    run.completedAt = Date.now();
    run.events.push({ type: 'run_cancelled', timestamp: Date.now() });

    this.emit({
      type: 'run_status_changed',
      runId,
      from: prevStatus,
      to: 'cancelled',
      timestamp: Date.now(),
    });
    this.emit({ type: 'run_cancelled', runId, timestamp: Date.now() });
  }

  // ──────────────────────────────────────────
  // Node Activation
  // ──────────────────────────────────────────

  public activateNodeInternal(run: WorkflowRun, nodeId: string): void {
    const nodeDef = this.getNodeDefinition(run, nodeId);
    if (!nodeDef) {
      this.emit({
        type: 'error',
        runId: run.runId,
        nodeId,
        error: `Node ${nodeId} not found in definition.`,
        timestamp: Date.now(),
      });
      return;
    }

    if (nodeDef.kind !== 'agent') return;

    activateNode(run, nodeId);
    this.emit({
      type: 'node_activated',
      runId: run.runId,
      nodeId,
      attempt: getNodeState(run, nodeId)?.attempt ?? 1,
      timestamp: Date.now(),
    });

    this.transitionNodeState(run, nodeId, 'launching_runtime');

    this.emit({
      type: 'runtime_requested',
      runId: run.runId,
      nodeId,
      cliId: nodeDef.config.cli ?? 'claude',
      timestamp: Date.now(),
    });

    if (this.runtimeManager) {
      this.requestRuntimeFromManager(run, nodeId, nodeDef);
    }
  }

  private async requestRuntimeFromManager(
    run: WorkflowRun,
    nodeId: string,
    nodeDef: WorkflowNodeDefinition,
  ): Promise<void> {
    try {
      const attempt = run.nodeStates[nodeId]?.attempt || 1;

      const workspaceDir = this.resolveWorkspaceDir(run.definition, nodeDef);

      // Group 5: Single entry point for runtime readiness.
      // Handles reuse, stale cleanup, and new launch.
      const result = await this.runtimeManager!.startNodeRun({
        missionId: run.runId,
        nodeId,
        attempt,
        role: nodeDef.roleId,
        agentId: nodeDef.roleId, // Fallback agentId
        profileId: nodeDef.config.profileId ?? nodeDef.roleId,
        cliId: nodeDef.config.cli ?? 'claude',
        executionMode: nodeDef.config.executionMode ?? 'interactive_pty',
        terminalId: nodeDef.config.terminalId || '',
        paneId: nodeDef.config.paneId,
        workspaceDir,
        instructionOverride: nodeDef.config.instructionOverride ?? null,
        modelId: nodeDef.config.model ?? null,
        yolo: nodeDef.config.yolo ?? false,
        goal: (run.definition.nodes.find(n => n.kind === 'task') as any)?.config?.prompt || '',
        legalTargets: getLegalTargetsForNode(run, nodeId) as any,
        upstreamPayloads: getIncomingHandoffs(run, nodeId),
      });

      const refreshedRun = this.runs.get(run.runId);
      if (!refreshedRun) return;

      const session: RuntimeSessionInfo = {
        sessionId: result.sessionId,
        terminalId: result.terminalId,
        cliId: result.cliId,
        executionMode: result.executionMode,
        createdAt: result.createdAt,
      };

      attachRuntime(refreshedRun, nodeId, session);

      // Wire MCP events now that the session is attached to the run.
      this.wireMcpForSession(run.runId, result.sessionId);

      this.emit({
        type: 'runtime_attached',
        runId: run.runId,
        nodeId,
        sessionId: result.sessionId,
        terminalId: result.terminalId,
        timestamp: Date.now(),
      });
    } catch (err) {
      const refreshedRun = this.runs.get(run.runId);
      if (!refreshedRun) return;

      const errorMessage = err instanceof Error ? err.message : String(err);
      this.failNodeInternal(refreshedRun, nodeId, `Runtime readiness check failed: ${errorMessage}`);
    }
  }

  // ──────────────────────────────────────────
  // Node State Transitions
  // ──────────────────────────────────────────

  transitionNodeState(
    run: WorkflowRun,
    nodeId: string,
    newState: NodeLifecycleState,
  ): boolean {
    const nodeState = getNodeState(run, nodeId);
    if (!nodeState) return false;

    const validation = validateTransition(nodeState.state, newState);
    if (!validation.legal) {
      this.emit({
        type: 'error',
        runId: run.runId,
        nodeId,
        error: validation.reason ?? 'Illegal transition',
        timestamp: Date.now(),
      });
      return false;
    }

    const prevState = nodeState.state;
    const evt = setNodeState(run, nodeId, newState);
    if (evt) {
      run.events.push(evt);
      this.emit({
        type: 'node_state_changed',
        runId: run.runId,
        nodeId,
        from: prevState,
        to: newState,
        timestamp: Date.now(),
      });
    }
    return true;
  }

  // ──────────────────────────────────────────
  // Completion and Handoff Routing
    // ──────────────────────────────────────────

  completeNode(report: NodeCompletionReport): void {
    const run = this.findRunByNodeId(report.nodeId);
    if (!run) {
      this.emitGlobalError(`No active run found for node ${report.nodeId}`);
      return;
    }

    const nodeState = getNodeState(run, report.nodeId);
    if (!nodeState) return;

    if (nodeState.attempt !== report.attempt) {
      this.emit({
        type: 'error',
        runId: run.runId,
        nodeId: report.nodeId,
        error: `Stale completion: attempt ${report.attempt} != current ${nodeState.attempt}`,
        timestamp: Date.now(),
      });
      return;
    }

    const outcome = report.outcome;
    completeNodeInRun(run, report.nodeId, outcome, report.summary, report.filesChanged);

    this.emit({
      type: outcome === 'success' ? 'node_completed' : 'node_failed',
      runId: run.runId,
      nodeId: report.nodeId,
      outcome,
      attempt: report.attempt,
      timestamp: Date.now(),
    });

    if (report.filesChanged && report.filesChanged.length > 0 && nodeState.attempts.length > 0) {
      const currentAttempt = nodeState.attempts[nodeState.attempts.length - 1];
      if (currentAttempt) {
        nodeState.attempts[nodeState.attempts.length - 1] = {
          ...currentAttempt,
          filesChanged: report.filesChanged,
        };
      }
    }

    this.routeToDownstream(run, report.nodeId, outcome, report.downstreamPayload);

    this.checkRunCompletion(run);
  }

  handleHandoff(request: HandoffRequest): boolean {
    const run = this.findRunByNodeId(request.fromNodeId);
    if (!run) {
      this.emitGlobalError(`No active run found for node ${request.fromNodeId}`);
      return false;
    }

    const nodeState = getNodeState(run, request.fromNodeId);
    if (!nodeState) {
      this.emit({
        type: 'handoff_rejected',
        runId: run.runId,
        fromNodeId: request.fromNodeId,
        toNodeId: request.targetNodeId,
        reason: 'Source node not found in run.',
        timestamp: Date.now(),
      });
      return false;
    }

    if (nodeState.attempt !== request.fromAttempt) {
      this.emit({
        type: 'handoff_rejected',
        runId: run.runId,
        fromNodeId: request.fromNodeId,
        toNodeId: request.targetNodeId,
        reason: `Stale handoff: attempt ${request.fromAttempt} != current ${nodeState.attempt}`,
        timestamp: Date.now(),
      });
      return false;
    }

    if (!this.isValidEdge(run, request.fromNodeId, request.targetNodeId, request.outcome)) {
      this.emit({
        type: 'handoff_rejected',
        runId: run.runId,
        fromNodeId: request.fromNodeId,
        toNodeId: request.targetNodeId,
        reason: `No legal edge from ${request.fromNodeId} to ${request.targetNodeId} for outcome ${request.outcome}.`,
        timestamp: Date.now(),
      });
      return false;
    }

    completeNodeInRun(run, request.fromNodeId, request.outcome);
    this.emit({
      type: 'node_completed',
      runId: run.runId,
      nodeId: request.fromNodeId,
      outcome: request.outcome,
      attempt: request.fromAttempt,
      timestamp: Date.now(),
    });

    const handoff: HandoffRecord = {
      fromNodeId: request.fromNodeId,
      targetNodeId: request.targetNodeId,
      outcome: request.outcome,
      condition: this.getEdgeCondition(run, request.fromNodeId, request.targetNodeId, request.outcome),
      fromAttempt: request.fromAttempt,
      timestamp: Date.now(),
      summary: request.description,
      payload: request.payload,
    };

    recordHandoff(run, handoff);
    this.emit({
      type: 'handoff_completed',
      runId: run.runId,
      fromNodeId: request.fromNodeId,
      toNodeId: request.targetNodeId,
      outcome: request.outcome,
      timestamp: Date.now(),
    });

    this.activateDownstreamNode(run, request.targetNodeId, request.fromNodeId, handoff);
    this.checkRunCompletion(run);

    return true;
  }

  // ──────────────────────────────────────────
  // Downstream Routing
  // ──────────────────────────────────────────

  private routeToDownstream(
    run: WorkflowRun,
    completedNodeId: string,
    outcome: CompletionOutcome,
    downstreamPayload?: unknown,
  ): void {
    const matchingEdges = run.definition.edges.filter((edge) => {
      if (edge.fromNodeId !== completedNodeId) return false;
      if (edge.condition === 'always') return true;
      if (edge.condition === 'on_success' && outcome === 'success') return true;
      if (edge.condition === 'on_failure' && outcome === 'failure') return true;
      return false;
    });

    for (const edge of matchingEdges) {
      const handoff: HandoffRecord = {
        fromNodeId: completedNodeId,
        targetNodeId: edge.toNodeId,
        outcome,
        condition: edge.condition,
        fromAttempt: getNodeState(run, completedNodeId)?.attempt ?? 1,
        timestamp: Date.now(),
        payload: downstreamPayload,
      };

      recordHandoff(run, handoff);
      this.emit({
        type: 'handoff_completed',
        runId: run.runId,
        fromNodeId: completedNodeId,
        toNodeId: edge.toNodeId,
        outcome,
        timestamp: Date.now(),
      });

      this.activateDownstreamNode(run, edge.toNodeId, completedNodeId, handoff);
    }
  }

  private activateDownstreamNode(
    run: WorkflowRun,
    targetNodeId: string,
    sourceNodeId: string,
    _triggeringHandoff: HandoffRecord,
  ): void {
    const targetDef = this.getNodeDefinition(run, targetNodeId);
    if (!targetDef) return;

    if (targetDef.kind === 'barrier') {
      const allParentsComplete = this.checkFanIn(run, targetNodeId);
      if (!allParentsComplete) {
        const pending = this.getPendingParentIds(run, targetNodeId);
        this.emit({
          type: 'fan_in_pending',
          runId: run.runId,
          targetNodeId,
          pendingFromNodes: pending,
          timestamp: Date.now(),
        });
        return;
      }

      const outgoingFromBarrier = run.definition.edges.filter(
        (e) => e.fromNodeId === targetNodeId,
      );
      for (const barrierEdge of outgoingFromBarrier) {
        this.activateDownstreamNode(run, barrierEdge.toNodeId, targetNodeId, _triggeringHandoff);
      }
      return;
    }

    if (targetDef.kind === 'reroute') {
      const outgoingFromReroute = run.definition.edges.filter(
        (e) => e.fromNodeId === targetNodeId,
      );
      for (const rerouteEdge of outgoingFromReroute) {
        this.activateDownstreamNode(run, rerouteEdge.toNodeId, targetNodeId, _triggeringHandoff);
      }
      return;
    }

    if (targetDef.kind !== 'agent') return;

    const targetState = getNodeState(run, targetNodeId);
    if (!targetState || targetState.state !== 'idle') {
      this.emit({
        type: 'downstream_activation_skipped',
        runId: run.runId,
        sourceNodeId,
        targetNodeId,
        reason: targetState ? `Target node is already ${targetState.state}.` : 'Target node state not found.',
        timestamp: Date.now(),
      });
      return;
    }

    if (!this.checkFanIn(run, targetNodeId)) {
      const pending = this.getPendingParentIds(run, targetNodeId);
      this.emit({
        type: 'fan_in_pending',
        runId: run.runId,
        targetNodeId,
        pendingFromNodes: pending,
        timestamp: Date.now(),
      });
      return;
    }

    this.activateNodeInternal(run, targetNodeId);
    this.emit({
      type: 'downstream_activated',
      runId: run.runId,
      sourceNodeId,
      targetNodeId,
      timestamp: Date.now(),
    });
  }

  // ──────────────────────────────────────────
  // Fan-In
    // ──────────────────────────────────────────

  private checkFanIn(run: WorkflowRun, targetNodeId: string): boolean {
    const incomingEdges = run.definition.edges.filter(
      (e) => e.toNodeId === targetNodeId,
    );
    if (incomingEdges.length <= 1) return true;

    return incomingEdges.every((edge) => {
      const parentState = getNodeState(run, edge.fromNodeId);
      if (!parentState) return false;
      if (parentState.state === 'completed') return true;
      if (edge.condition === 'on_failure' && parentState.state === 'failed') return true;
      return false;
    });
  }

  private getPendingParentIds(run: WorkflowRun, targetNodeId: string): string[] {
    return run.definition.edges
      .filter((e) => e.toNodeId === targetNodeId)
      .filter((edge) => {
        const parentState = getNodeState(run, edge.fromNodeId);
        if (!parentState) return true;
        if (parentState.state === 'completed') return false;
        if (edge.condition === 'on_failure' && parentState.state === 'failed') return false;
        return true;
      })
      .map((e) => e.fromNodeId);
  }

  // ──────────────────────────────────────────
  // Run Completion Check
  // ──────────────────────────────────────────

  public checkRunCompletion(run: WorkflowRun): void {
    if (run.status !== 'running') return;
    const nodeStates = Object.values(run.nodeStates);
    const allTerminal = nodeStates.every(
      (ns) =>
        ns.state === 'completed' ||
        ns.state === 'failed' ||
        ns.state === 'cancelled',
    );

    if (!allTerminal) return;

    const hasFailure = nodeStates.some((ns) => ns.state === 'failed');
    const outcome: CompletionOutcome = hasFailure ? 'failure' : 'success';

    run.status = 'completed';
    run.completedAt = Date.now();
    run.events.push({ type: 'run_completed', timestamp: Date.now(), outcome });

    this.emit({
      type: 'run_status_changed',
      runId: run.runId,
      from: 'running',
      to: 'completed',
      timestamp: Date.now(),
    });
    this.emit({
      type: 'run_completed',
      runId: run.runId,
      outcome,
      timestamp: Date.now(),
    });
  }

  // ──────────────────────────────────────────
  // Permission Management
    // ──────────────────────────────────────────

  handlePermissionRequest(
    runId: string,
    request: PermissionRequest,
  ): void {
    const run = this.runs.get(runId);
    if (!run) return;

    requestPermission(run, request);
    this.emit({
      type: 'permission_requested',
      runId,
      nodeId: request.nodeId,
      permissionId: request.permissionId,
      category: request.category,
      timestamp: Date.now(),
    });
  }

  resolvePermission(
    runId: string,
    permissionId: string,
    decision: PermissionDecision,
  ): void {
    const run = this.runs.get(runId);
    if (!run) return;

    resolvePermissionInRun(run, permissionId, decision);
    this.emit({
      type: 'permission_resolved',
      runId,
      nodeId: this.findPermissionNodeId(run, permissionId) ?? '',
      permissionId,
      decision,
      timestamp: Date.now(),
    });
  }

  // ──────────────────────────────────────────
  // Artifact Recording
    // ──────────────────────────────────────────

  publishArtifact(runId: string, nodeId: string, artifact: Artifact): void {
    const run = this.runs.get(runId);
    if (!run) return;

    recordArtifact(run, nodeId, artifact);
    this.emit({
      type: 'artifact_published',
      runId,
      nodeId,
      artifact,
      timestamp: Date.now(),
    });
  }

  // ──────────────────────────────────────────
  // Task Lifecycle Callbacks (from RuntimeManager / MCP)
    // ──────────────────────────────────────────

  onTaskInjected(runId: string, nodeId: string, attempt: number): void {
    const run = this.runs.get(runId);
    if (!run) return;

    this.emit({
      type: 'task_injected',
      runId,
      nodeId,
      attempt,
      timestamp: Date.now(),
    });
  }

  onTaskAcked(runId: string, nodeId: string, attempt: number): void {
    const run = this.runs.get(runId);
    if (!run) return;

    this.transitionNodeState(run, nodeId, 'running');

    run.events.push({
      type: 'task_acked',
      timestamp: Date.now(),
      nodeId,
      attempt,
    });
    this.emit({
      type: 'task_acked',
      runId,
      nodeId,
      attempt,
      timestamp: Date.now(),
    });
  }

  onRuntimeDisconnected(runId: string, nodeId: string, sessionId: string): void {
    const run = this.runs.get(runId);
    if (!run) return;

    detachRuntime(run, nodeId, sessionId);
    this.emit({
      type: 'runtime_detached',
      runId,
      nodeId,
      sessionId,
      timestamp: Date.now(),
    });
  }

  // ──────────────────────────────────────────
  // Failure Helpers
    // ──────────────────────────────────────────

  public failNodeInternal(run: WorkflowRun, nodeId: string, error?: string, category: FailureCategory = 'unknown'): void {
    const nodeState = getNodeState(run, nodeId);
    if (!nodeState) return;

    const nodeDef = this.getNodeDefinition(run, nodeId);
    const policy = nodeDef?.config.retryPolicy;

    const currentAttempt = nodeState.attempt;
    const maxAttempts = policy?.maxAttempts ?? 1;
    const canRetry = policy && 
                    currentAttempt < maxAttempts && 
                    (policy.retryOn.includes(category) || policy.retryOn.includes('unknown'));

    if (canRetry) {
      this.emit({
        type: 'node_failed',
        runId: run.runId,
        nodeId,
        error: `${error} (Retry ${currentAttempt}/${maxAttempts} scheduled)`,
        attempt: currentAttempt,
        timestamp: Date.now(),
      });

      // Schedule retry with backoff
      const backoff = policy.backoffMs ?? 1000;
      setTimeout(() => {
        const refreshedRun = this.runs.get(run.runId);
        if (refreshedRun && refreshedRun.status === 'running') {
            this.activateNodeInternal(refreshedRun, nodeId);
        }
      }, backoff);
    } else {
      failNode(run, nodeId, error);
      this.emit({
        type: 'node_failed',
        runId: run.runId,
        nodeId,
        error,
        attempt: currentAttempt,
        timestamp: Date.now(),
      });

      // Reroute logic (Phase 12)
      if (policy?.rerouteRoles && policy.rerouteRoles.length > 0) {
          this.handleReroute(run, nodeId, policy.rerouteRoles);
      }

      this.routeToDownstream(run, nodeId, 'failure');
      this.checkRunCompletion(run);
    }
  }

  private handleReroute(run: WorkflowRun, failedNodeId: string, roles: string[]): void {
      // For now, just log reroute attempt
      this.emit({
          type: 'error',
          runId: run.runId,
          nodeId: failedNodeId,
          error: `Reroute requested to roles: ${roles.join(', ')}. (Reroute logic pending implementation)`,
          timestamp: Date.now(),
      });
  }

  failNode(runId: string, nodeId: string, error?: string): void {
    const run = this.runs.get(runId);
    if (!run) return;
    this.failNodeInternal(run, nodeId, error);
  }

  // ──────────────────────────────────────────
  // Queries
    // ──────────────────────────────────────────

  getRun(runId: string): WorkflowRun | undefined {
    return this.runs.get(runId);
  }

  getActiveRuns(): WorkflowRun[] {
    return Array.from(this.runs.values()).filter((r) => r.status === 'running');
  }

  getAllRuns(): WorkflowRun[] {
    return Array.from(this.runs.values());
  }

  getNodeActivationContext(runId: string, nodeId: string): NodeActivationContext | null {
    const run = this.runs.get(runId);
    if (!run) return null;

    const nodeDef = this.getNodeDefinition(run, nodeId);
    if (!nodeDef) return null;

    const legalTargets = getLegalTargetsForNode(run, nodeId);
    const upstreamHandoffs = run.handoffs.filter((h) => h.targetNodeId === nodeId);

    return {
      nodeId,
      roleId: nodeDef.roleId,
      cliId: nodeDef.config.cli ?? 'claude',
      modelId: nodeDef.config.model ?? null,
      yolo: nodeDef.config.yolo ?? false,
      executionMode: nodeDef.config.executionMode ?? 'interactive_pty',
      workspaceDir: this.resolveWorkspaceDir(run.definition, nodeDef),
      legalTargets,
      upstreamPayloads: upstreamHandoffs,
    };
  }

  getLegalTargetsForNode(
    runId: string,
    nodeId: string,
    outcome?: CompletionOutcome,
  ): WorkflowEdgeDefinition[] {
    const run = this.runs.get(runId);
    if (!run) return [];
    return getLegalTargetsForNode(run, nodeId, outcome);
  }

  // ──────────────────────────────────────────
  // Event Subscription
    // ──────────────────────────────────────────

  subscribe(handler: OrchestratorEventHandler): OrchestratorEventSubscription {
    return this.eventEmitter.subscribe(handler);
  }

  subscribeForRun(
    runId: string,
    handler: OrchestratorEventHandler,
  ): OrchestratorEventSubscription {
    return this.eventEmitter.subscribeForRun(runId, handler);
  }

  subscribeForNode(
    runId: string,
    nodeId: string,
    handler: OrchestratorEventHandler,
  ): OrchestratorEventSubscription {
    return this.eventEmitter.subscribeForNode(runId, nodeId, handler);
  }

  getEventHistory(runId?: string): OrchestratorEvent[] {
    return this.eventEmitter.getHistory(runId);
  }

  // ──────────────────────────────────────────
  // Run Cleanup
    // ──────────────────────────────────────────

  removeRun(runId: string): void {
    this.runs.delete(runId);
  }

  clearCompletedRuns(): void {
    for (const [runId, run] of this.runs.entries()) {
      if (run.status === 'completed' || run.status === 'failed' || run.status === 'cancelled') {
        this.runs.delete(runId);
      }
    }
  }

  // ──────────────────────────────────────────
  // Internal Helpers
    // ──────────────────────────────────────────

  private emit(event: OrchestratorEvent): void {
    this.eventEmitter.emit(event);
  }

  private emitGlobalError(error: string): void {
    this.emit({ type: 'error', runId: '', error, timestamp: Date.now() });
  }

  private getNodeDefinition(
    run: WorkflowRun,
    nodeId: string,
  ): WorkflowNodeDefinition | undefined {
    return run.definition.nodes.find((n) => n.id === nodeId);
  }

  private findRunByNodeId(nodeId: string): WorkflowRun | undefined {
    for (const run of this.runs.values()) {
      if (run.nodeStates[nodeId]) return run;
    }
    return undefined;
  }

  private findPermissionNodeId(run: WorkflowRun, permissionId: string): string | undefined {
    for (const ns of Object.values(run.nodeStates)) {
      if (ns.activePermission?.permissionId === permissionId) {
        return ns.nodeId;
      }
    }
    return undefined;
  }

  private isValidEdge(
    run: WorkflowRun,
    fromNodeId: string,
    toNodeId: string,
    outcome: CompletionOutcome,
  ): boolean {
    return run.definition.edges.some((edge) => {
      if (edge.fromNodeId !== fromNodeId || edge.toNodeId !== toNodeId) return false;
      if (edge.condition === 'always') return true;
      if (edge.condition === 'on_success' && outcome === 'success') return true;
      if (edge.condition === 'on_failure' && outcome === 'failure') return true;
      return false;
    });
  }

  private getEdgeCondition(
    run: WorkflowRun,
    fromNodeId: string,
    toNodeId: string,
    outcome: CompletionOutcome,
  ): EdgeCondition {
    const edge = run.definition.edges.find((e) => {
      if (e.fromNodeId !== fromNodeId || e.toNodeId !== toNodeId) return false;
      if (e.condition === 'always') return true;
      if (e.condition === 'on_success' && outcome === 'success') return true;
      if (e.condition === 'on_failure' && outcome === 'failure') return true;
      return false;
    });
    return edge?.condition ?? 'always';
  }

  private resolveWorkspaceDir(
    definition: WorkflowDefinition,
    nodeDef: WorkflowNodeDefinition,
  ): string | null {
    return nodeDef.config.workspaceDir
      ?? definition.nodes.find((n) => n.kind === 'task')?.config.workspaceDir
      ?? null;
  }

  private resolveStartNodes(definition: WorkflowDefinition): string[] {
    const taskNode = definition.nodes.find((n) => n.kind === 'task');
    if (!taskNode) return [];

    const startAgentIds = new Set<string>();
    const visited = new Set<string>();
    const queue = [taskNode.id];

    while (queue.length > 0) {
      const currentId = queue.shift();
      if (!currentId || visited.has(currentId)) continue;
      visited.add(currentId);

      for (const edge of definition.edges) {
        if (edge.fromNodeId !== currentId) continue;
        const target = definition.nodes.find((n) => n.id === edge.toNodeId);
        if (!target) continue;

        if (target.kind === 'agent') {
          startAgentIds.add(target.id);
        } else {
          queue.push(target.id);
        }
      }
    }

    return Array.from(startAgentIds);
  }
}

// ──────────────────────────────────────────────
// Singleton Instance
//
// The app should use a single orchestrator instance.
// Components can import this directly.
// ──────────────────────────────────────────────

export const workflowOrchestrator = new WorkflowOrchestrator();

// ──────────────────────────────────────────────
// ID Generation
// ──────────────────────────────────────────────

function generateRunId(): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `run:${Date.now().toString(36)}:${rand}`;
}
