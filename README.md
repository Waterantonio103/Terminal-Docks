# CometAI

WORK IN PROGRESS — this repository is under active development. Expect incomplete features, API churn and unfinished documentation.

A local, desktop Agentic Development Environment that combines a multi-pane terminal workspace, AI agent orchestration, a task board and an embedded editor. It is implemented with Tauri (Rust) for the backend and React + TypeScript for the frontend.

Core ideas
- Graph-first authoring: design workflows as a node graph (Workflow mode).
- Runtime / Machine View: observe and interact with live agent sessions (Runtime mode).
- Workspace: file explorer and editors for code and artifacts (Workspace mode).

What this repo contains (high level)
- Frontend: React + TypeScript under `src/` (mode switch, node-graph editor, runtime view, panes).
- Store: single zustand store at `src/store/workspace.ts` that persists UI state.
- Terminal: xterm-based PTY panes (`src/components/Terminal/TerminalPane.tsx`) talking to the Rust PTY via Tauri commands/events.
- Graph & runtime: Node graph editor (`src/components/NodeTree/NodeTreePane.tsx`), runtime view (`src/components/Runtime/RuntimeView.tsx`), and Mission Control (`src/components/MissionControl/MissionControlPane.tsx`) for orchestration.
- Backend glue: Tauri commands invoked from the frontend (spawn/resize/write PTY, mission APIs) and local runtime adapters in `src-tauri/`.
- MCP Server: A standalone Node.js MCP server (Starlink) under `mcp-server/` that provides the multi-agent Starlink coordination layer.

Current functionality (summary)
- Mode system implemented (workflow / runtime / workspace).
- Node graph editor: build and edit workflow graphs, compile missions.
- Terminal panes: PTY spawn, resize, write, and stream output to the frontend (xterm + addons: fit, webgl, search, web-links).
- Runtime view: renders live runtime nodes (one node = an agent session) and embeds terminal panes for active sessions.
- Mission control: compiles missions, stages prompts, launches start nodes and drives basic activation lifecycle.
- Starlink MCP: Multi-agent coordination via Starlink, providing file locking, message passing, and task delegation.
- Action detection and a basic permission-request signal: PTY output is parsed for activity and permission prompts; UI receives permission requests and can forward decisions to the backend.

Not yet finished / areas to expect changes
- Permission handling, audit trail and CLI-specific keystroke adapters are present but being refined.
- UI and UX are actively iterated (see `docs/ui-change.md` for the design direction).

Development
- Install deps: `npm install`
- Run frontend only: `npm run dev`
- Run full app (Tauri + Vite): `npm run tauri dev`
- Build production bundle: `npm run build` then `npm run tauri build` (or use `npm run tauri` commands directly)
- Tests: several project test scripts are available (`npm run test:workflow`, `npm run test:rust`, etc.). See `package.json` for details.

Where to look first
- `src/App.tsx` — app shell, mode rail and top-level wiring
- `src/store/workspace.ts` — global state, persistence and pane management
- `src/components/NodeTree/NodeTreePane.tsx` — graph editor and run logic
- `src/components/Runtime/RuntimeView.tsx` — runtime node rendering and permission popups
- `src/components/Terminal/TerminalPane.tsx` — xterm integration and PTY wiring
- `src/components/MissionControl/MissionControlPane.tsx` — mission lifecycle and MCP interactions
- `mcp-server/server.mjs` — Starlink coordination layer





<!-- macOS branch update -->
