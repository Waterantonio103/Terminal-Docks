# Terminal Docks

Terminal Docks is a local-first multi-agent workflow app that uses CLI coding
agents as the execution interface.

The product direction is graph-first workflow authoring: users design a workflow
as a graph, the app launches CLI agents in PTY/runtime sessions, and control
planes such as the desktop UI, MCP, and future CLI/headless entry points observe
and command the same runtime services.

## Architecture Shape

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

Core rules:

- Workflow orchestration stays graph-first.
- Runtime state is observable by the UI, but not owned by the UI.
- Provider adapters encapsulate Claude, Codex, Gemini, OpenCode, and other CLI behavior.
- MCP is a protocol/control-plane facade, not the orchestration brain.
- Desktop UI, MCP, `tdctl`, and future CLI/headless control planes should converge on the same backend/service boundary.

## What Is In This Repo

- `src/`: React + TypeScript desktop renderer.
- `src/components/`: UI panes and UI-facing bridges.
- `src/lib/workflow/`: graph workflow definitions, run state, state machine, and orchestrator.
- `src/lib/runtime/`: runtime manager, runtime sessions, terminal runtime wrapper, and provider adapters.
- `src/lib/node-system/`: graph node declarations and editor helpers.
- `src/store/`: Zustand UI/workspace state.
- `electron/`: Electron main/preload bridge for the desktop shell.
- `backend/`: Rust backend for PTY/process, workflow, persistence, MCP registration, and JSON-RPC control.
- `mcp-server/`: Node MCP server exposing agent-facing coordination tools.
- `scripts/`: scriptable control-plane helpers such as `tdctl`.
- `tests/`: graph, runtime, MCP, provider, and control-plane tests.
- `docs/`: architecture notes, plans, and protocol contracts.

For a more detailed map, see `docs/repository-map.md`.

## Development

Install dependencies:

```bash
npm install
npm run mcp:install
```

Run the renderer only:

```bash
npm run dev
```

Run the Electron desktop app in development:

```bash
npm run electron:dev
```

Build:

```bash
npm run build
npm run electron:build
```

Run the workflow-oriented test suite:

```bash
npm run test:workflow
```

Focused test scripts are available in `package.json`:

```bash
npm run test:graph
npm run test:mcp
npm run test:runtime-core
npm run test:providers
npm run test:control-plane
npm run test:rust
```

Build and test the Rust backend directly:

```bash
cargo build --manifest-path backend/Cargo.toml
cargo test --manifest-path backend/Cargo.toml
```

Use the scriptable control plane:

```bash
npm run tdctl -- --help
npm run tdctl -- workflow launch --mission scripts/control-plane-samples/compiled-mission.json
npm run tdctl -- sessions list
```

## Where Agents Should Start

Read these first:

- `docs/AGENTS.md`: repo-specific rules for AI coding agents.
- `docs/architecture.md`: layer ownership and boundary rules.
- `docs/repository-map.md`: where core concepts live.
- `docs/control-planes.md`: desktop, backend JSON-RPC, CLI, and MCP control planes.
- `docs/provider-adapters.md`: provider adapter contract.
- `docs/persistence-ownership.md`: database/schema ownership.
- `docs/mcp-tool-contracts.md`: stable MCP tool response contracts.

High-value source entry points:

- `src/App.tsx`: desktop renderer shell.
- `src/lib/workflow/WorkflowOrchestrator.ts`: graph orchestration layer.
- `src/lib/runtime/RuntimeManager.ts`: runtime lifecycle owner.
- `src/lib/runtime/adapters/CliAdapter.ts`: provider adapter interface.
- `src/lib/runtime/TerminalRuntime.ts`: low-level desktop/backend runtime IPC wrapper.
- `backend/src/workflow_engine.rs`: backend workflow execution and activation dispatch.
- `backend/src/db.rs`: canonical SQLite schema ownership.
- `mcp-server/server.mjs`: MCP protocol facade and tool registration.
