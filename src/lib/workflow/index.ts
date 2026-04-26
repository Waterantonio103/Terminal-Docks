/**
 * src/lib/workflow — Workflow type system barrel.
 *
 * Phase 2 + Phase 5 / Agent A
 *
 * This module separates persisted workflow design from live run state:
 *   - WorkflowTypes          = shared enumerations and base types
 *   - WorkflowDefinition     = saved graph design (persistable)
 *   - WorkflowRun            = live execution instance (runtime only)
 *   - WorkflowEvents         = typed event bus for state change notifications
 *   - WorkflowStateMachine   = node lifecycle state validation
 *   - WorkflowOrchestrator   = canonical workflow brain (singleton: orchestrator)
 */

export type {
  Artifact,
  ArtifactKind,
  AuthoringMode,
  CapabilityEntry,
  CapabilityId,
  CliId,
  CompletionOutcome,
  EdgeCondition,
  ExecutionMode,
  LaunchMode,
  LegalTarget,
  NodeLifecycleState,
  NodeStatusCategory,
  PermissionCategory,
  PermissionDecision,
  PermissionRequest,
  RunStatus,
  TaskRequirements,
  WorkflowNodeKind,
} from './WorkflowTypes.js';

export { categorizeNodeStatus } from './WorkflowTypes.js';

export type {
  WorkflowDefinition,
  WorkflowEdgeDefinition,
  WorkflowNodeDefinition,
  DefinitionValidationIssue,
} from './WorkflowDefinition.js';

export {
  definitionToWorkflowGraph,
  getExecutableNodeIds,
  getIncomingEdges,
  getOutgoingEdges,
  getTaskNode,
  sanitizeDefinition,
  validateDefinition,
  workflowGraphToDefinition,
} from './WorkflowDefinition.js';

export type {
  AttemptRecord,
  HandoffRecord,
  RuntimeSessionInfo,
  WorkflowEvent,
  WorkflowNodeRunState,
  WorkflowRun,
} from './WorkflowRun.js';

export {
  activateNode,
  attachRuntime,
  cancelRun,
  completeNode,
  completeRun,
  createWorkflowRun,
  detachRuntime,
  failNode,
  getActiveNodes,
  getCompletedNodeIds,
  getFailedNodeIds,
  getLegalTargetsForNode,
  getNodeState,
  recordArtifact,
  recordHandoff,
  requestPermission,
  resolvePermission,
  setNodeState,
  startRun,
} from './WorkflowRun.js';

export type {
  OrchestratorEvent,
  OrchestratorEventHandler,
  OrchestratorEventSubscription,
} from './WorkflowEvents.js';

export { WorkflowEventEmitter } from './WorkflowEvents.js';

export type {
  TransitionValidation,
} from './WorkflowStateMachine.js';

export {
  getAllowedTransitions,
  getLifecycleIndex,
  getLifecyclePath,
  isActiveState,
  isProgression,
  isTerminalState,
  isValidTransition,
  validateTransition,
} from './WorkflowStateMachine.js';

export type {
  RuntimeManagerPort,
  NodeActivationContext,
  StartRunOptions,
  NodeCompletionReport,
  HandoffRequest,
} from './WorkflowOrchestrator.js';

export {
  WorkflowOrchestrator,
  workflowOrchestrator,
} from './WorkflowOrchestrator.js';
