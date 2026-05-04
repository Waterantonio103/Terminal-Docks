# CAO-Quality Refactor Agent Guide

## Purpose

Use this document to guide an implementation agent improving Terminal Docks toward the engineering quality of AWS Labs CLI Agent Orchestrator (CAO): <https://github.com/awslabs/cli-agent-orchestrator>.

Both projects target local multi-agent orchestration through CLI coding agents. CAO is narrower and more productized. This app is broader: a desktop agentic IDE with graph authoring, runtime visualization, PTY panes, workflow execution, task board, workspace editor, and MCP coordination.

The goal is not to copy CAO feature-for-feature. The goal is to adopt its strongest engineering patterns while preserving this repo's graph-first desktop vision.

## Current Repo Context

This repo currently contains:

- React + TypeScript frontend under `src/`.
- Electron desktop shell under `electron/`.
- Rust backend under `backend/` for PTY, workflow, DB, MCP registration, and runtime events.
- Node MCP server under `mcp-server/` providing agent coordination.
- Workflow graph compiler and runtime logic in `src/lib/workflow`, `src/lib/runtime`, and related modules.
- Tests under `tests/`, mostly focused on workflow graph/compiler/MCP smoke paths.

Important existing files:

- `src/lib/workflow/WorkflowOrchestrator.ts` is intended to be the canonical workflow brain.
- `src/lib/runtime/RuntimeManager.ts` owns runtime sessions but currently bridges into UI state and legacy events.
- `src/lib/runtime/adapters/CliAdapter.ts` defines the right kind of provider abstraction.
- `src/lib/runtime/TerminalRuntime.ts` wraps backend PTY/runtime IPC calls.
- `backend/src/workflow_engine.rs` owns Rust-side workflow state and activation dispatch.
- `mcp-server/server.mjs` owns MCP tools and directly creates SQLite tables.
- `README.md` previously contained stale Tauri references and has been corrected during the documentation cleanup phase.

## CAO Patterns To Adopt

CAO's strongest qualities:

- Clear service-oriented architecture: CLI/MCP/API entry points feed a service layer, then clients/providers, then tmux/SQLite.
- Small agent-facing protocol: `handoff`, `assign`, and `send_message` are the primary orchestration primitives.
- Provider-specific behavior is isolated in provider classes.
- Terminal lifecycle is cohesive and centrally owned.
- SQLite is behind a database/client/service layer, not scattered across entry points.
- Provider output parsing has broad fixture-based unit tests.
- Docs, install path, examples, and control planes are productized.

Do not blindly copy:

- CAO's supervisor-worker-only model. This app should retain graph workflows.
- CAO's Python/tmux substrate unless intentionally chosen later. This app currently uses Electron + Rust PTY.
- CAO's exact APIs where the graph model needs richer semantics.

## Target Architecture

Move toward this layering:

```text
Desktop UI / future CLI / MCP ops
        |
HTTP or IPC API
        |
orchestration services
        |
workflow engine + runtime service + provider registry
        |
PTY/process client + SQLite
        |
CLI agents
```

Key rule: UI observes runtime state; UI must not be part of the orchestration core.

The ideal split:

- `WorkflowOrchestrator`: pure graph/run state and routing.
- `RuntimeService` or cleaned `RuntimeManager`: owns runtime lifecycle and emits events, with no React/Zustand imports.
- `TerminalRuntime`: low-level PTY/process API only.
- `ProviderAdapter`s: own CLI-specific startup, input strategy, status detection, output extraction, permission prompt handling, and tool restriction translation.
- `MCP server`: protocol facade only. It should call backend/runtime services, not own DB schema.
- `Persistence`: one backend-owned schema and migration path.

## Highest Priority Problems

### 1. RuntimeManager is not headless-pure

`src/lib/runtime/RuntimeManager.ts` imports UI/store concerns and emits legacy UI events. This makes runtime behavior hard to test and impossible to reuse cleanly from CLI/headless paths.

Fix direction:

- Remove direct `useWorkspaceStore` dependency from runtime core.
- Replace direct UI mutations with structured runtime events/snapshots.
- Let React hooks/components subscribe and translate runtime events into UI state.
- Keep backward compatibility temporarily through a thin bridge module if needed.

Acceptance criteria:

- Runtime core can be imported and tested without React/Zustand.
- UI state updates happen in a UI-facing adapter/hook, not inside runtime manager.
- Existing workflow tests still pass.

### 2. MCP server directly owns database schema

`mcp-server/server.mjs` creates and migrates SQLite tables directly. Rust backend also has workflow/database state. This creates split authority.

Fix direction:

- Decide one persistence owner. Prefer backend/Rust service ownership for app runtime state.
- Convert MCP server DB operations into API/IPC calls where feasible.
- Leave temporary compatibility adapters only where needed.
- Document any remaining shared DB access clearly.

Acceptance criteria:

- New MCP features do not add direct table creation to `mcp-server/server.mjs`.
- One module/file owns schema creation for mission/runtime/session state.
- MCP tools are protocol facades over services.

### 3. Agent-facing MCP protocol is too broad/implicit

The graph model can be rich internally, but agents need a small stable vocabulary.

Recommended baseline tools:

- `connect_agent`
- `get_task_details`
- `complete_task`
- `handoff`
- `assign`
- `send_message`

Define semantics clearly:

- `handoff`: synchronous transfer to another node/agent and wait for result.
- `assign`: asynchronous delegation that returns immediately and requires callback/message completion.
- `send_message`: queued delivery to an existing session/node when it is ready.
- `complete_task`: terminal/node declares outcome and artifacts.
- `get_task_details`: retrieves full assignment context from backend by mission/node/attempt.
- `connect_agent`: registers runtime identity and capabilities.

Acceptance criteria:

- Tool descriptions are explicit enough for agents to use without hidden prompt lore.
- Tool responses are structured and typed.
- Graph-specific details are exposed only where necessary.

### 4. Provider behavior needs fixture tests

Provider/TUI parsing is the most failure-prone part of CLI orchestration. CAO has extensive provider fixtures. This repo needs the same discipline.

Add fixture tests for each supported CLI adapter:

- Idle prompt detection.
- Running/processing detection.
- Completion detection.
- Failure/error detection.
- Permission prompt detection.
- Message extraction if supported.
- Bracketed paste/input strategy edge cases.
- Trust/workspace prompt handling where relevant.

Start with Codex and Claude because they are likely primary targets.

Acceptance criteria:

- Each adapter has fixture files under a predictable test fixture directory.
- Tests run with `npm run test:workflow` or a new clearly named test script.
- Adapter parsing changes require fixture updates.

### 5. Documentation and product identity are stale

`README.md` previously referenced Tauri even though the repo had migrated to Electron. Docs need to keep describing the actual architecture.

Fix direction:

- Update README to say Electron + React frontend + Rust backend binary/service if that is the current state.
- Add architecture docs matching the target layering.
- Add a control-plane doc explaining Desktop UI, MCP, and future CLI/headless surfaces.
- Add provider adapter docs inspired by CAO's provider docs.

Acceptance criteria:

- New contributor can run the app using correct commands.
- Docs do not reference nonexistent `src-tauri` paths.
- Architecture doc identifies ownership boundaries.

## Implementation Phases

### Phase 1: Stabilize Boundaries

Objective: stop architecture drift before adding features.

Tasks:

1. Map current runtime call paths from graph run to terminal spawn to MCP registration to completion.
2. Identify direct UI/store imports from runtime/workflow/backend-facing modules.
3. Create a UI bridge layer for translating runtime snapshots/events into Zustand state.
4. Remove UI imports from runtime core.
5. Add tests around the refactored runtime event flow.

Do not:

- Rewrite the graph engine.
- Redesign the UI.
- Add new agent features.

### Phase 2: Consolidate Persistence Ownership

Objective: make backend state authority explicit.

Integration note: persistence ownership is documented in `docs/persistence-ownership.md`. `backend/src/db.rs` is the canonical schema owner; `mcp-server/persistence.mjs` is only a standalone MCP compatibility bootstrap.

Tasks:

1. Inventory tables created by `mcp-server/server.mjs` and Rust backend DB modules.
2. Decide canonical owner for each table.
3. Move schema creation/migration into the canonical owner.
4. Replace direct MCP DB calls with backend service calls where practical.
5. Add compatibility tests for MCP workflow paths.

Do not:

- Delete existing DB tables without migration/compatibility.
- Break standalone MCP smoke tests without replacing them.

### Phase 3: Define Stable MCP Tools

Objective: make agents reliable users of the orchestration system.

Integration note: stable baseline contracts are documented in `docs/mcp-tool-contracts.md`. The registered MCP handlers for connect, get task, complete, handoff, assign, and send message delegate to exported executor functions in `mcp-server/server.mjs`, with smoke coverage in `tests/mcpStableTools.test.mjs`.

Tasks:

1. Document the six baseline tools and response schemas.
2. Normalize tool naming and payload shapes.
3. Add validation with clear error messages.
4. Ensure each tool maps to backend/runtime services, not ad hoc state mutations.
5. Add smoke tests for connect, get task, complete, handoff, assign, and send message.

Do not:

- Expose every internal graph field to agents.
- Add provider-specific MCP tools unless unavoidable.

### Phase 4: Harden Providers

Objective: make CLI adapters dependable.

Integration note: provider adapter contracts and extension rules are documented in `docs/provider-adapters.md`. `CliAdapter` now includes capability metadata, `RuntimeManager` delegates provider-specific process-exit completion policy to that metadata, and `tests/runtimeProviderAdapters.test.mjs` covers Codex/Claude readiness, permission, completion, and input formatting fixtures.

Tasks:

1. Create test fixtures for Codex and Claude output states.
2. Add adapter unit tests around readiness, permission, completion, and input formatting.
3. Move any CLI-specific hacks out of runtime manager and into adapters.
4. Add provider capability metadata: supports headless, supports MCP config, supports hard tool restrictions, supports permissions, requires trust prompt handling.
5. Add docs for adding a new provider.

Do not:

- Add more providers before Codex/Claude are solid.

### Phase 5: Productize Control Planes

Objective: make orchestration scriptable and testable outside the desktop UI.

Integration note: control planes are documented in `docs/control-planes.md`. `scripts/control-plane-client.mjs` provides the shared backend JSON-RPC client, `scripts/tdctl.mjs` exposes workflow launch, headless run, and session list/inspect/kill commands, and MCP now exposes supervisor read tools for persisted runtime sessions and agent runs. `tests/controlPlane.test.mjs` covers the client delegation, CLI help surface, and MCP supervisor queries.

Tasks:

1. Add or plan a CLI wrapper for launching workflows/sessions.
2. Add headless workflow execution entry point.
3. Add session list/inspect/kill commands.
4. Add API/MCP ops surface for external supervisors.
5. Document all control planes.

Do not:

- Let CLI commands duplicate orchestration logic. They should call the same service layer.

### Phase 6: Replace Static Boundary Checks With Runtime Behavior Tests

Objective: prove the runtime core works headlessly by behavior, not just by source-code grep.

Integration note: `tests/runtimeManagerHeadless.test.mjs` now bundles the real `RuntimeManager` class with in-memory mocks for desktop, MCP bus, terminal, and adapter dependencies. The test constructs manager instances with and without a bridge, verifies session-created/state-change events, snapshot updates, bridge state callbacks, terminal binding callbacks, and keeps source-level UI dependency checks as secondary guardrails.

Tasks:

1. Add tests that construct `RuntimeManager` with an in-memory/test bridge.
2. Verify session creation emits manager events and snapshots without React/Zustand.
3. Verify bridge callbacks receive session state changes and terminal binding requests.
4. Verify runtime behavior still works when no bridge is installed.
5. Keep source-level dependency checks only as secondary guardrails.

Do not:

- Reintroduce UI/store imports into runtime core.
- Depend on Electron, browser globals, or a real PTY for the core behavior tests.

### Phase 7: Move MCP Persistence Access Behind Backend/Service APIs

Objective: make MCP a protocol facade instead of a direct SQLite application layer.

Integration note: MCP SQL ownership is now isolated in `mcp-server/services.mjs` via `createMcpServiceStore(db)`, grouped by missions, task inbox, runtime sessions, agent runs, file locks, workspace context, adapters, and standalone compatibility helpers. `mcp-server/server.mjs` now delegates persistence through `services.*` calls and has no direct `db.prepare`, `db.exec`, schema creation, or migration statements. `tests/mcpPersistenceOwnership.test.mjs` enforces that boundary while preserving standalone compatibility schema coverage.

Tasks:

1. Inventory every direct `db.prepare`, `db.exec`, and transaction in `mcp-server/server.mjs`.
2. Group operations into service-owned responsibilities: missions, task inbox, runtime sessions, agent runs, file locks, and workspace context.
3. Move app-runtime writes to backend commands or a shared service layer owned outside the MCP protocol file.
4. Leave standalone MCP compatibility reads/writes only where explicitly documented.
5. Add tests proving MCP tools call service functions rather than owning SQL inline.

Do not:

- Remove standalone MCP smoke-test support without a replacement compatibility path.
- Add new MCP features that create or mutate schema directly.

### Phase 8: Typed MCP Tool Contracts

Objective: make agent-facing tools small, stable, and machine-checkable.

Tasks:

1. Define response builders for the baseline tools: `connect_agent`, `get_task_details`, `complete_task`, `handoff`, `assign`, and `send_message`.
2. Return consistent envelopes for success and error responses.
3. Validate payloads at executor boundaries, not only in `registerTool` schemas.
4. Add bad-input tests for each baseline tool.
5. Document which graph fields are intentionally exposed and which remain internal.

Do not:

- Return ad hoc JSON strings where a typed response helper should be used.
- Expand the agent-facing tool surface to mirror internal graph state.

### Phase 9: Provider Transcript Fixtures

Objective: raise CLI adapter coverage to CAO-style provider reliability.

Integration note: provider transcript fixtures now live under `tests/fixtures/providers/{codex,claude}/`. `tests/runtimeProviderAdapters.test.mjs` loads multi-line fixtures for idle/ready, running, completed, failed, permission, trust, interrupted, prompt-shortening, and bracketed-paste cases. Codex and Claude parser updates now include fixture-backed assertions for readiness, normalized events, permission classification, completion/failure detection, interruption handling, and input formatting. Fixture update expectations are documented in `docs/provider-adapters.md`.

Tasks:

1. Move inline adapter test strings into fixture files under a predictable directory.
2. Add real or representative Codex and Claude transcripts for idle, running, completed, failed, permission prompt, trust prompt, and interrupted states.
3. Test output parsing, readiness, permission classification, completion detection, and input formatting against those fixtures.
4. Add regression fixtures for known prompt truncation and bracketed-paste edge cases.
5. Document how fixture updates should accompany adapter parser changes.

Do not:

- Add new providers before Codex and Claude have durable fixture coverage.
- Treat one-line synthetic strings as sufficient provider hardening.

### Phase 10: End-To-End Control Plane Verification

Objective: prove the CLI and external control planes work against the real backend path.

Integration note: `tests/controlPlane.test.mjs` now builds the Rust backend and verifies `tdctl` plus `ControlPlaneClient` against the real newline-delimited JSON-RPC path. Coverage includes workflow launch, headless run start, persisted session list, inspect, active kill, missing backend, invalid request JSON, unknown run ID, and backend command launch failure. Manual sample payloads live under `scripts/control-plane-samples/`, and `TD_BACKEND_CWD` lets tests and manual runs isolate backend `.mcp/` state from a developer workspace.

Tasks:

1. Add integration tests for `tdctl` against a test backend binary or backend harness.
2. Verify workflow launch, headless run, session list, inspect, and kill paths with real JSON-RPC responses.
3. Exercise error paths: missing backend, invalid request JSON, unknown run ID, and backend command failure.
4. Add sample request files for repeatable manual control-plane testing.
5. Keep `tdctl` as a thin client over backend/service commands.

Do not:

- Duplicate orchestration rules in the CLI.
- Make tests depend on a developer's personal agent credentials.

### Phase 11: Product Documentation Cleanup

Objective: remove stale product identity and make the current architecture discoverable.

Integration note: `README.md`, `docs/architecture.md`, `docs/repository-map.md`,
and `docs/README.md` now describe the current Electron + React renderer + Rust
backend shape. Contributor commands cover app dev, MCP setup, workflow tests,
Rust tests, and `tdctl`. Historical Tauri-era planning docs are marked as
reference-only so they do not read like functional app inputs.

Tasks:

1. Update `README.md` to describe Electron + React frontend + Rust backend service.
2. Remove or clearly mark stale Tauri and `src-tauri` references.
3. Add a current architecture document covering UI, backend JSON-RPC, runtime manager, provider adapters, MCP, and persistence ownership.
4. Add contributor commands for app dev, MCP setup, workflow tests, Rust tests, and `tdctl`.
5. Keep historical/reference docs separate from functional app inputs.

Do not:

- Put app-required configuration or runtime files under `docs/`.
- Leave docs that tell contributors to run nonexistent commands.

## Testing Expectations

Before and after each phase, run relevant tests:

```bash
npm run test:workflow
npm run build
```

If Rust backend changes are made:

```bash
npm run test:rust
```

If new tests are added, add scripts to `package.json` so future agents can run them consistently.

Minimum new test coverage to add:

- Runtime manager emits state without UI dependency.
- MCP tool schemas validate bad inputs and successful paths.
- Provider adapter fixtures for Codex and Claude.
- Persistence/schema ownership path does not regress existing MCP smoke tests.

## Engineering Constraints

- Do not revert unrelated user changes.
- Keep changes incremental and testable.
- Preserve the graph-first product direction.
- Prefer service boundaries over large rewrites.
- Keep the agent-facing API small even if internal graph state is rich.
- Avoid adding features until lifecycle, persistence, MCP tools, and providers are stable.

## Recommended First Agent Task

Start with Phase 1 only.

Concrete first task:

1. Inspect imports in `src/lib/runtime` and `src/lib/workflow` for UI/store coupling.
2. Create a runtime UI bridge module/hook that subscribes to runtime snapshots/events.
3. Remove `useWorkspaceStore` and legacy UI event emission from `RuntimeManager` where possible.
4. Keep old UI behavior working through the bridge.
5. Add a test proving runtime manager can be constructed and used without React/Zustand.
6. Run `npm run test:workflow` and `npm run build`.

Expected result:

The orchestration/runtime core becomes more headless and easier to test, without changing user-visible behavior.
