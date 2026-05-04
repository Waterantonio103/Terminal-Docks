# Repository Map

This map is for agents and contributors who need to find the right layer before
editing code.

## Root

- `README.md`: current project overview and commands.
- `docs/AGENTS.md`: AI-agent operating rules and boundaries.
- `package.json`: frontend, Electron, MCP install, and test scripts.
- `vite.config.ts`: renderer build configuration.
- `tsconfig*.json`: TypeScript configurations for app and graph tests.

## Renderer App

- `src/main.tsx`: React entry point.
- `src/App.tsx`: app shell and top-level mode wiring.
- `src/App.css`: global UI styling.
- `src/components/`: UI panes and view adapters.
- `src/store/workspace.ts`: UI/workspace persistence state.
- `src/config/agents.ts` and `src/config/agents.json`: local agent profile data.

Component areas:

- `ActivityFeed/`: runtime/activity stream UI.
- `Diagnostics/`: error boundary and fatal overlay.
- `Editor/`: embedded editor pane.
- `Launcher/`: mission/workflow launch UI.
- `Layout/`: workspace grid.
- `MissionControl/`: mission lifecycle UI.
- `NodeTree/`: workflow graph editor UI.
- `Runtime/`: runtime visualization and UI bridge.
- `Sidebar/`: agents, settings, and file tree UI.
- `TaskBoard/`: local board UI.
- `Terminal/`: xterm pane UI.

## Renderer Domain Libraries

- `src/lib/workflow/`: graph workflow definitions, run state, events, state machine, orchestrator.
- `src/lib/runtime/`: runtime session lifecycle, terminal runtime wrapper, provider adapters.
- `src/lib/runtime/adapters/`: Claude, Codex, Gemini, OpenCode, generic CLI contracts.
- `src/lib/node-system/`: node declarations, editor operators, and graph-system types.
- `src/lib/graphCompiler.ts`: compiles graph authoring data into executable mission shape.
- `src/lib/graphUtils.ts`: graph helper logic.
- `src/lib/missionLauncher.ts` and `src/lib/missionRuntime.ts`: mission launch/runtime support.
- `src/lib/runtimeBootstrap.ts` and `src/lib/runtimeDispatcher.ts`: activation/bootstrap dispatch helpers.
- `src/lib/workers/`: legacy/worker adapter registry and MCP event bus.
- `src/lib/desktopApi.ts`: renderer wrapper around Electron preload APIs.

## Electron Shell

- `electron/main.ts`: desktop main process.
- `electron/preload.ts`: renderer bridge.
- `electron/tsconfig.json`: Electron TypeScript config.
- `dist-electron/`: compiled Electron output used by the current package entry.

## Rust Backend

- `backend/src/main.rs`: backend process entry point and JSON-RPC command loop.
- `backend/src/db.rs`: canonical database schema and migrations.
- `backend/src/pty.rs`: PTY/process management.
- `backend/src/workflow_engine.rs`: persisted workflow execution and activation dispatch.
- `backend/src/workflow.rs`: workflow data model helpers.
- `backend/src/workflow_log.rs`: workflow event logging.
- `backend/src/agent_run.rs`: agent run persistence/process records.
- `backend/src/mcp.rs`: MCP process registration and integration.
- `backend/src/workspace.rs`: workspace filesystem support.
- `backend/src/swarm.rs`: older coordination support.

## MCP Server

- `mcp-server/server.mjs`: MCP server and tool registration facade.
- `mcp-server/services.mjs`: Node-side service/store helpers.
- `mcp-server/persistence.mjs`: standalone compatibility persistence bootstrap.
- `mcp-server/examples/`: manual MCP examples.
- `mcp-server/test_*.mjs`, `manual_client.mjs`, `check_handshake.mjs`: manual/debug scripts.

## Scripts

- `scripts/tdctl.mjs`: scriptable control-plane CLI.
- `scripts/control-plane-client.mjs`: backend JSON-RPC client used by `tdctl`.

## Tests

- `tests/graphCompiler.test.mjs`: graph compiler coverage.
- `tests/headlessRuntime.test.mjs`: headless runtime command behavior.
- `tests/workflowRuntime.test.mjs`: workflow runtime behavior.
- `tests/missionFlow.smoke.mjs`: mission flow smoke test.
- `tests/mcp*.test.mjs`: MCP graph, event bus, contracts, and persistence ownership.
- `tests/runtimeManagerHeadless.test.mjs`: runtime manager core/headless behavior.
- `tests/runtimeProviderAdapters.test.mjs`: provider adapter parsing/contracts.
- `tests/controlPlane.test.mjs`: backend control-plane behavior.
- `tests/promptToolParity.test.mjs`: prompt/tool contract parity.

## Common Change Locations

- Add or change provider behavior: `src/lib/runtime/adapters/` plus `tests/runtimeProviderAdapters.test.mjs`.
- Change graph execution semantics: `src/lib/workflow/`, `backend/src/workflow_engine.rs`, and workflow tests.
- Change MCP tool contracts: `docs/mcp-tool-contracts.md`, `mcp-server/server.mjs`, `mcp-server/services.mjs`, and MCP tests.
- Change persistence schema: `backend/src/db.rs` first, then compatibility code/tests if needed.
- Change UI observation of runtime state: `src/components/Runtime/` and `src/store/workspace.ts`, without moving runtime ownership into UI.
