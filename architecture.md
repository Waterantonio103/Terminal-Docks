# Comet-AI Architecture

## System Shape

Comet-AI is a Tauri desktop app with a React/TypeScript frontend, Rust native services, and a local Node.js MCP server named Starlink.

The main architectural rule is separation of responsibilities:

- React components render the workspace shell, editor/terminal panes, app modes, workflow authoring, runtime visibility, and user controls.
- TypeScript workflow modules own graph compilation, workflow definitions, workflow runs, state transitions, and mission orchestration.
- TypeScript runtime modules own CLI runtime sessions, readiness gates, task injection, adapter behavior, and terminal output routing.
- Rust/Tauri owns PTY processes, SQLite commands, filesystem commands, MCP server process lifecycle, and native OS integration.
- The MCP server exposes agent-facing tools for handoffs, completions, locks, inbox, artifacts, resources, prompts, and debug automation.

## Repository Map

- `src/App.tsx`: top-level app shell, mode rail, layout wiring, and global listeners.
- `src/store/workspace.ts`: Zustand store for UI state, panes, workflow graph data, compiled mission data, and mission snapshots.
- `src/components/AgentDock/AgentDock.tsx`: global workspace agent dock for continuing active missions outside Mission Control.
- `src/components/ChangeReview/ChangeReviewPane.tsx`: review surface for agent patch artifacts, changed files, hunk accept/reject, and applying accepted unified-diff hunks.
- `src/components/Editor/EditorPane.tsx`: CodeMirror-based file editor, image preview, file reload/save, language loading, and cursor status.
- `src/components/Sidebar/FileTree.tsx`: workspace file browsing and file-open entry points.
- `src/components/NodeTree/NodeTreePane.tsx`: workflow graph authoring and run controls.
- `src/components/MissionControl/MissionControlPane.tsx`: mission progress, lifecycle visibility, node state, runtime logs, artifacts, and manual controls.
- `src/components/Runtime/RuntimeView.tsx`: runtime/machine view for live sessions.
- `src/components/Terminal/TerminalPane.tsx`: xterm pane integration with Tauri PTY events.
- `src/lib/graphCompiler.ts`: converts UI graph nodes and edges into compiled missions.
- `src/lib/workflow/*`: canonical workflow definition, run, orchestrator, state machine, events, and planning router.
- `src/lib/runtime/*`: RuntimeManager, RuntimeSession, terminal runtime facade, output bus, readiness gate, and CLI adapters.
- `src/lib/workers/*`: MCP event bus and worker/session compatibility layer.
- `src/config/agents.json`: role roster and in-app agent instructions for scout, coordinator, builder, tester, security, and reviewer.
- `src-tauri/src/*`: Rust commands for PTY, DB, workspace filesystem, MCP lifecycle, model detection, workflow engine compatibility, and native helpers.
- `mcp-server/src/*`: modular Starlink MCP server, tools, resources, prompts, debug tools, state, and SQLite access.
- `tests/*`: Node-based and TypeScript-compiled regression tests for graph, workflow, MCP, runtime adapters, readiness, launch hardening, and debug MCP.

## Workspace Flow

1. The app opens into Workspace mode by default.
2. The sidebar exposes the workspace file tree.
3. Editor panes use Tauri workspace commands to read, write, reload, and preview files.
4. Terminal panes use Tauri PTY commands and keep output available to runtime logic through `TerminalOutputBus`.
5. `AgentDock` exposes the active mission follow-up composer from the global workspace shell.
6. `ChangeReviewPane` opens from mission evidence when agents report file changes or patch artifacts.
7. Workflow, Runtime Monitor, Starlink Toolbox, and Action Center remain available as secondary modes.

## Workflow Runtime Flow

1. The user authors or selects a workflow graph.
2. `graphCompiler.ts` normalizes graph data into a compiled mission.
3. `WorkflowDefinition.ts` stores static design data only.
4. `WorkflowRun.ts` creates live execution state for one run.
5. `WorkflowOrchestrator.ts` activates legal start nodes and coordinates routing.
6. `RuntimeManager.ts` creates or validates runtime sessions for each active node.
7. CLI adapters under `src/lib/runtime/adapters/` launch and interpret Claude, Codex, Gemini, OpenCode, or streaming runtimes.
8. `TerminalRuntime.ts` calls Tauri commands for PTY spawn, write, resize, destroy, MCP registration, and headless execution.
9. Rust PTY/native services emit terminal and workflow events back to the frontend.
10. Starlink MCP tools let agents receive task details, complete tasks, hand off to legal targets, publish artifacts, coordinate locks, and update shared workspace context.

## State Ownership

### Workflow Design State

Owned by `WorkflowDefinition` and graph/compiler structures. It contains static node and edge configuration. It must not contain terminal IDs, process IDs, runtime statuses, attempts, permission prompts, or live session data.

### Workflow Run State

Owned by `WorkflowRun` and `WorkflowOrchestrator`. It contains node lifecycle state, attempts, runtime sessions, active permissions, handoffs, artifacts, events, and completion outcomes.

### Runtime Session State

Owned by `RuntimeManager` and `RuntimeSession`. It contains CLI identity, execution mode, terminal binding, readiness state, MCP registration state, task injection state, active permission state, heartbeat, and completion/failure state.

### Native Persistent State

Owned through Rust/Tauri SQLite commands and MCP server database helpers. It stores tasks, mission records, workflow events, artifacts, runtime session records, debug state, locks, inbox items, and related audit data.

## Starlink Server Boundary

Starlink is the agent gateway and coordination layer. It exposes deterministic MCP-compatible tools, validates graph-mode routing, records events, and communicates with the app. It should not become an independent UI workflow brain that conflicts with `WorkflowOrchestrator`.

Important tool groups:

- `task-details`: task and graph context for active agents.
- `workflow`: `handoff_task`, `complete_task`, retry requests, adaptive patches, graph lookup.
- `locks`: file lock queueing and release.
- `inbox` and `communication`: agent messaging.
- `workspace`: shared workspace context.
- `artifacts`: summaries, URLs, files, and output references.
- `debug`: workflow test runs, diagnostics, reports, and guarded patch flows.

Graph-mode agents must use exact `targetNodeId` values from task details or workflow graph data. Role-level handoffs are legacy compatibility behavior and should not be used for graph execution.

## CLI Adapter Boundary

CLI adapters are responsible for CLI-specific behavior:

- launch command construction,
- status and readiness detection,
- permission prompt detection,
- permission response formatting,
- completion detection,
- task prompt/follow-up signal formatting.

RuntimeManager is responsible for lifecycle sequencing and should call adapters instead of embedding CLI-specific parsing in UI components.

## Startup Boundary

The workspace/editor/terminal path should become usable before advanced workflow surfaces are opened. Runtime, workflow, MCP, and model-discovery initialization may still warm up in the background, but they should avoid blocking the default workspace surface when possible.

## Rust/Tauri Boundary

Rust should remain the native service layer:

- PTY lifecycle,
- shell/CLI process IO,
- SQLite command surface,
- workspace filesystem operations,
- MCP server lifecycle,
- native model detection,
- OS helpers such as reveal-in-explorer.

Do not move workflow graph routing or CLI-specific readiness parsing into Rust unless there is a strong native requirement.

## Testing Map

Use the scripts in `package.json`:

- `npm run test:graph`: graph compiler and workflow race coverage.
- `npm run test:mcp`: MCP graph-mode behavior.
- `npm run test:smoke`: mission flow smoke coverage.
- `npm run test:prompt-parity`: generated prompt/tool parity.
- `npm run test:runtime-adapters`: CLI adapter fixture tests.
- `npm run test:headless`: runtime adapters, readiness gate, launch hardening, and headless runtime.
- `npm run test:rust`: Rust workflow engine tests.
- `npm run test:workflow`: broad workflow regression suite.

For narrow documentation-only changes, inspect diffs. For runtime, workflow, MCP, or CLI adapter changes, run the smallest relevant script first and expand based on blast radius.

## Agent Work Rules

- Read `PRD.md` and this file before changing architecture.
- Treat old phase labels in comments as historical breadcrumbs unless the code path still enforces them.
- Prefer current TypeScript workflow/runtime modules over old docs when resolving conflicts.
- Do not mix runtime-only fields into persisted workflow definitions.
- Do not bypass RuntimeManager for workflow task injection.
- Do not route graph-mode handoffs by role name when exact node IDs are available.
- Preserve user changes in the working tree.
