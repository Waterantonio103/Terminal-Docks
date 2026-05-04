# Runtime Layer

The runtime layer owns live CLI session lifecycle for workflow nodes.

## Files

- `RuntimeManager.ts`: central lifecycle owner for runtime sessions.
- `RuntimeSession.ts`: per-session descriptor and state transitions.
- `RuntimeTypes.ts`: shared runtime contracts and event types.
- `RuntimeReadinessGate.ts`: readiness diagnostics and gating.
- `TerminalRuntime.ts`: frontend facade over Tauri PTY/MCP/headless commands.
- `TerminalOutputBus.ts`: output capture that does not depend on mounted terminal panes.
- `adapters/`: CLI-specific behavior for Claude, Codex, Gemini, OpenCode, and streaming runtimes.

## Rules

- Workflow activation should go through `RuntimeManager`.
- CLI-specific parsing belongs in adapters, not UI components.
- Readiness must account for stale output, permission prompts, busy CLIs, startup banners, completed screens, and disconnected sessions.
- If adapter behavior changes, update fixture tests under `tests/fixtures/runtime-adapters`.
