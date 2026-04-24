# Cerebrum

## Key Learnings

- **MCP Transport**: Claude Code uses `--transport http` (Streamable HTTP, spec 2025-11-25). Legacy `--transport sse` is deprecated and will fail silently. All `claude mcp add` options must come BEFORE the server name.
- **StreamableHTTPServerTransport**: Available in `@modelcontextprotocol/sdk` v1.x at `@modelcontextprotocol/sdk/server/streamableHttp.js`. Single `/mcp` endpoint handles both POST (client→server) and GET (server→client SSE). Session tracked via `mcp-session-id` header.
- **activation_pending is the initial DB status**: `persist_runtime_session()` inserts rows with `activation_pending` before the activation event fires. Polling on this status resolves immediately — don't include it in handshake wait sets.
- **PTY launch heuristic**: Always check `get_pty_recent_output` before sending CLI launch command. Writing `\x15claude\r` to an active Claude TUI sends "claude" as a chat message, corrupting the session.
- **Token persistence**: auth token must be persisted to `app_local_data_dir/mcp_auth.token`. Regenerating on every startup breaks any already-running Claude instances.
- **Tauri path API**: Use `app.path().app_local_data_dir()` (not `app_data_dir()`).

## User Preferences

- Prefers layered bug analysis documents over ad-hoc fixes
- Wants all layers fixed in one session, not iteratively
- Values terse responses

## Do-Not-Repeat

- [2026-04-24] Never use `--transport sse` in `claude mcp add`. Use `--transport http`. The SSE transport is the old MCP spec and silently fails.
- [2026-04-24] Never include `activation_pending` in `waitForRuntimeActivationState` accepted sets for the `agent:ready` handshake event — it's the initial insert status and causes immediate false-positive resolution.
- [2026-04-24] Never call `invoke('mcp_store_mission', ...)` — this command is not registered. Use `start_mission_graph` instead.

## Decision Log

- [2026-04-24] Switched MCP transport from SSE to Streamable HTTP. Reason: SSE is spec 2024-11-05 (deprecated), Claude Code's current transport is spec 2025-11-25 (Streamable HTTP). Single endpoint model is more reliable on loopback.
- [2026-04-24] Token persistence strategy: write to app_local_data_dir, reuse across restarts. Avoids 401s from running Claude instances after app restart.
