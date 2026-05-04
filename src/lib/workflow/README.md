# Workflow Layer

The workflow layer owns graph execution state and routing.

## Files

- `WorkflowDefinition.ts`: static persisted workflow design model.
- `WorkflowRun.ts`: live run state, attempts, handoffs, permissions, artifacts, and events.
- `WorkflowOrchestrator.ts`: canonical workflow brain for activation, routing, completion, and runtime coordination.
- `WorkflowStateMachine.ts`: legal state transitions.
- `WorkflowEvents.ts`: orchestrator event emitter and event contracts.
- `PlanningRouter.ts`: deterministic planning/DAG builder.
- `QualityGateService.ts`: quality gate checks over completed runs.

## Rules

- `WorkflowDefinition` must not contain runtime fields.
- `WorkflowRun` is the live execution record.
- Graph-mode routing should use exact node IDs and legal graph edges.
- Runtime lifecycle details should stay behind the RuntimeManager port.
