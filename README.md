# Comet-AI

WORK IN PROGRESS. This repository is under active development; expect incomplete features, API churn, and active runtime hardening.

Comet-AI is a local desktop AI coding workspace. It combines terminal sessions, file browsing, an embedded editor, local CLI agents, task inboxes, and advanced workflow automation in one Tauri app.

## Start Here

- `PRD.md`: product requirements, current priorities, non-goals, and quality bar.
- `architecture.md`: current architecture, ownership boundaries, runtime flow, and test map.
- `plan.md`: current engineering/documentation plan.
- `src/README.md`: frontend and TypeScript source map.
- `src/lib/workflow/README.md`: workflow layer map.
- `src/lib/runtime/README.md`: runtime layer map.
- `mcp-server/README.md`: Starlink server map.
- `src-tauri/README.md`: Rust/Tauri native layer map.
- `tests/README.md`: test suite map.

Local root `AGENTS.md` and `CLAUDE.md` may exist for workspace-specific agent preferences. They are intentionally ignored by git.

## Core Ideas

- Workspace-first flow: browse files, edit code, and use terminals from the default app surface.
- Editor/terminal core: keep daily coding work in the app instead of treating files as secondary artifacts.
- Workflow Builder: design repeatable multi-agent jobs as node graphs when a task needs orchestration.
- Runtime Monitor: inspect live agent sessions and readiness details when needed.
- Local-first execution: user-owned CLIs, local PTYs, local SQLite, and local Starlink server.
- Structured agent coordination: graph-mode handoffs, exact node IDs, file locks, inbox messages, artifacts, and workspace context.

## High-Level Structure

- `src/`: React/TypeScript frontend, graph compiler, workflow orchestration, runtime lifecycle, CLI adapters, and UI panes.
- `src-tauri/`: Rust/Tauri native services for PTY, SQLite, workspace filesystem, Starlink lifecycle, model detection, and OS integration.
- `mcp-server/`: Starlink server exposed to local agents over MCP-compatible transports.
- `tests/`: graph, workflow, Starlink/MCP protocol, runtime adapter, readiness, and debug regression tests.
- `public/`: static frontend assets.
- `references/`: local visual/reference material.

## Development

- Install deps: `npm install`
- Install MCP deps: `npm run mcp:install`
- Run frontend only: `npm run dev`
- Run full app: `npm run tauri dev`
- Build frontend: `npm run build`
- Build app: `npm run tauri build`
- Report build artifact sizes: `npm run report:size`
- Measure Windows Tauri dev startup: `powershell -NoProfile -ExecutionPolicy Bypass -File scripts\measure-tauri-dev-startup.ps1`

## Tests

- `npm run test:graph`
- `npm run test:mcp`
- `npm run test:smoke`
- `npm run test:prompt-parity`
- `npm run test:runtime-adapters`
- `npm run test:headless`
- `npm run test:workspace-qa`
- `npm run test:terminal-qa`
- `npm run test:rust`
- `npm run test:workflow`

Use the smallest relevant script first, then expand when the touched path crosses subsystem boundaries.

## Architecture Rules

- TypeScript workflow modules own graph/run state and routing.
- RuntimeManager owns live CLI runtime sessions and task injection.
- CLI-specific parsing belongs in runtime adapters.
- Rust/Tauri owns native services and persistence command boundaries.
- Starlink is the agent-facing tool gateway, not a competing app orchestrator.
- Runtime-only fields must not be persisted in workflow definitions.
