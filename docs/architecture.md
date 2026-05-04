# Terminal Docks Architecture

Terminal Docks should stay graph-first and local-first while supporting multiple
control planes over one runtime model.

## Layering

```text
Desktop UI / MCP / tdctl / future CLI
        |
Electron IPC / backend JSON-RPC / MCP protocol
        |
workflow orchestration + runtime services
        |
provider adapters + terminal runtime
        |
PTY/backend/persistence
        |
CLI agents
```

## Ownership Boundaries

### Control Planes

Control planes translate user or agent intent into service/API calls.

- Desktop UI renders state and sends user actions through the Electron preload/main-process bridge.
- MCP exposes agent-facing protocol tools.
- `scripts/tdctl.mjs` is the current scriptable CLI wrapper.
- Future headless/CLI entry points should use the same backend/service boundary.

Control planes must not duplicate workflow routing rules or own runtime state.

### Workflow Orchestration

`src/lib/workflow/` owns graph/run semantics in the renderer-side TypeScript
model. `WorkflowOrchestrator` is the primary entry point for graph routing,
node activation, completion, handoff, and permission events.

`backend/src/workflow_engine.rs` owns backend-side persisted workflow execution
and activation dispatch.

When changing workflow behavior, keep graph nodes and edges as the source of
truth. Do not replace the graph with a supervisor-worker-only model.

### Runtime Services

`src/lib/runtime/RuntimeManager.ts` owns runtime session lifecycle in the
renderer-side model. Runtime services create, launch, reuse, message, and stop
sessions.

Runtime services emit events/snapshots for UI observation. React and Zustand may
subscribe, but they should not become runtime truth.

### Provider Adapters

`src/lib/runtime/adapters/` owns CLI-specific behavior:

- launch command construction
- readiness detection
- initial prompt/input strategy
- permission prompt detection and responses
- completion detection
- output normalization
- capability metadata

Provider-specific branching belongs in adapters, not in workflow orchestration or
UI components.

### Terminal Runtime

`src/lib/runtime/TerminalRuntime.ts` wraps low-level backend/desktop IPC for PTY
and process operations. Keep this layer mechanical. It should not decide graph
routing or provider semantics.

### Backend And Persistence

`backend/src/` owns backend process concerns: PTY/process management, database
schema, workflow execution, MCP process registration, workspace access, and
JSON-RPC control-plane commands.

`backend/src/db.rs` is the canonical schema owner. MCP may read/write through a
compatibility layer, but new schema ownership starts in Rust.

The Electron main process and `tdctl` talk to the backend over newline-delimited
JSON-RPC. Backend command handlers should call shared backend services instead
of reimplementing workflow rules in each caller.

### MCP Facade

`mcp-server/server.mjs` exposes agent-facing tools and protocol envelopes. It
should stay a facade over persisted state and backend/runtime services.

Do not add orchestration-only state machines or schema creation inline in
`server.mjs`. Prefer typed services such as `mcp-server/services.mjs` and backend
APIs as the implementation matures.

## Dependency Direction

Allowed direction:

```text
UI -> workflow/runtime APIs -> adapters/terminal runtime -> backend/persistence
MCP -> services/backend state -> backend/persistence
CLI scripts -> backend JSON-RPC -> backend services
```

Avoid:

- runtime core importing React components or Zustand stores
- workflow orchestration depending on UI layout state
- provider adapters reaching into UI state
- MCP creating or migrating backend-owned schema
- duplicated routing logic across UI, MCP, and CLI scripts
