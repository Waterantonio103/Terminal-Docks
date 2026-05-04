# Terminal Docks Control Planes

This app has three control planes. Keep them thin: each one should call the same backend/runtime service layer instead of reimplementing orchestration rules.

## Desktop UI

The desktop UI observes workflow/runtime state and sends user actions through `desktopApi.invoke`. Runtime ownership stays in `RuntimeManager`, `WorkflowOrchestrator`, and the Rust backend.

Use the UI for interactive PTY workflows, graph authoring, permission review, runtime visualization, and day-to-day mission control.

## Backend JSON-RPC

The Electron host and CLI control plane speak newline-delimited JSON-RPC to the Rust backend process:

```json
{"id":"1","cmd":"list_agent_runs","payload":{"missionId":"mission-1"}}
```

Important commands:

- `start_mission_graph`: launch a compiled mission graph.
- `start_agent_run`: launch a headless or streaming headless CLI run.
- `list_agent_runs`: list persisted agent/headless run records.
- `get_agent_run`: inspect one run by `runId`.
- `cancel_agent_run`: kill an active backend-owned agent process.

## CLI Wrapper

`scripts/tdctl.mjs` is the scriptable entry point. It delegates to `scripts/control-plane-client.mjs`, which delegates to the backend JSON-RPC commands above.

Examples:

```bash
node scripts/tdctl.mjs workflow launch --mission compiled-mission.json
node scripts/tdctl.mjs run headless --request start-agent-run.json
node scripts/tdctl.mjs sessions list --mission-id mission-1
node scripts/tdctl.mjs sessions inspect run:mission-1:builder:1
node scripts/tdctl.mjs sessions kill run:mission-1:builder:1 --reason cancelled_by_operator
```

Repeatable manual requests live under `scripts/control-plane-samples/`:

```bash
node scripts/tdctl.mjs workflow launch --mission scripts/control-plane-samples/compiled-mission.json
node scripts/tdctl.mjs run headless --request scripts/control-plane-samples/start-agent-run.json
node scripts/tdctl.mjs run headless --request scripts/control-plane-samples/failing-agent-run.json
```

`TD_BACKEND_BIN` can point at a packaged backend binary. By default the CLI expects `backend/target/debug/backend`, so run `cargo build --manifest-path backend/Cargo.toml` first in development. `TD_BACKEND_CWD` can point the backend at an isolated working directory for repeatable tests; its SQLite database will be created under that directory's `.mcp/`.

## MCP Supervisor Ops

MCP remains the agent-facing coordination surface. Supervisor-oriented MCP tools expose read-only runtime/run state backed by the same SQLite tables as the backend:

- `list_runtime_sessions`
- `list_agent_runs`
- `inspect_agent_run`

Use backend JSON-RPC or `tdctl` for destructive process control. MCP tools should not kill backend-owned child processes directly unless they go through the same backend service.
