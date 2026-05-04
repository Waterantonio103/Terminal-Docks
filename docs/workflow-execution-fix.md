# Workflow Execution Fix Plan

> Historical reference: this document records a completed investigation from
> the earlier Tauri-era implementation. Paths and command names mentioning
> `src-tauri` or Tauri are preserved as historical context, not current
> contributor instructions. For current architecture and commands, use
> `README.md`, `docs/architecture.md`, and `docs/control-planes.md`.

**Status**: Implemented (all layers)
**Priority**: Critical — all workflow execution is currently non-functional
**Scope**: MCP transport, activation handshake, PTY launch logic, Launcher command

---

## Problem Summary

A simple Input Node → Agent Node workflow with Claude CLI bound to a terminal never executes. The node status stays IDLE in Mission Control. The only observable symptom is Claude CLI showing "1 MCP server failed" in its TUI.

The root cause is layered: the MCP server's SSE transport fails when Claude CLI starts, which breaks the entire handshake chain. Secondary bugs in the activation flow amplify and obscure the failure.

---

## Execution Layers (in order)

---

### Layer 1 — MCP Transport Failure (BLOCKING — fix first)

**Importance**: Critical. Nothing works until this is resolved. All other layers are downstream.

**What's happening:**

`mcp.rs::register_claude()` runs on every app startup. It calls:
```
claude mcp remove terminal-docks --scope user
claude mcp add --transport sse terminal-docks <url> --scope user
```

The URL is `http://127.0.0.1:3741/mcp?token=<token>` where `token` is a fresh random string generated each startup via `generate_push_token()`.

When Claude CLI starts in the PTY, it reads its MCP config and tries to open an SSE connection to that URL. It reports **"1 MCP server failed"**, meaning the connection attempt fails before any tool calls can happen. Without MCP tools, `get_task_details` can never be called, the task ACK never arrives, and Mission Control times out after 30 seconds.

**Root causes (in order of likelihood):**

1. **Token churn**: A new auth token is generated each app launch. If Claude was already running in the terminal when the app started (or the app restarted), that Claude instance initialized with the old token. The server now expects the new token, so Claude's connection is rejected as `401`. Only a freshly started Claude picks up the new token from the updated config.

2. **SSE transport instability**: The `@modelcontextprotocol/sdk` `SSEServerTransport` is the older MCP transport. Claude Code has since moved to `streamable-http` as its preferred transport. SSE connections require persistent HTTP keep-alive and are more fragile under local loopback conditions. Any unhandled error in `server.mjs` during the MCP handshake crashes the SSE stream silently, and Claude logs it as a server failure.

3. **MCP server process crash**: `server.mjs` is spawned as a child process. If it crashes (e.g. SQLite WAL issue, missing `node_modules`, port already bound), `init_mcp_server` won't know — it only polls `/health`, which would fail if the process died after the initial ready check.

**Files involved:**
- `src-tauri/src/mcp.rs` — `register_claude()`, `init_mcp_server()`
- `mcp-server/server.mjs` — SSE transport setup, `/mcp` endpoint

**Fix plan:**

**1a. Switch Claude CLI registration to `http` (streamable-http) transport**

In `mcp.rs`, change `register_claude()`:
```rust
// Before
let args = vec!["mcp", "add", "--transport", "sse", "terminal-docks", mcp_url, "--scope", "user"];

// After — use streamable-http (Claude Code's preferred modern transport)
let args = vec!["mcp", "add", "terminal-docks", mcp_url, "--scope", "user"];
// Note: omit --transport flag entirely — Claude Code defaults to streamable-http
// OR if explicit flag required:
let args = vec!["mcp", "add", "--transport", "http", "terminal-docks", mcp_url, "--scope", "user"];
```

The MCP server `server.mjs` already runs a standard Express HTTP server. Streamable-HTTP MCP works over POST to a single endpoint rather than a persistent SSE connection, making it far more reliable for loopback.

> **⚠️ Documentation needed here**: Confirm the exact `claude mcp add` flag for streamable-http transport. Check Claude Code docs: is it `--transport http`, `--transport streamable-http`, or no flag (default)? The MCP endpoint URL format may also differ (`/mcp` vs `/mcp/stream`).

**1b. Persist the auth token across restarts**

Instead of regenerating the token every app start, write it to a file (e.g. `.mcp/auth.token`) on first run and reuse it on subsequent starts. This means Claude instances that were running before a restart can still connect.

In `mcp.rs::init_mcp_server()`:
```rust
// Load from file, or generate and save if missing
let auth_token = load_or_generate_token(&app)?;
```

**1c. Add visible error logging from the MCP server process**

Currently `server.mjs` inherits stdout/stderr. Unhandled errors in the MCP SSE stream handler crash silently. Add a top-level `process.on('uncaughtException')` and log with timestamps so failures are visible in the Tauri dev console.

**1d. Add MCP server restart detection**

In `init_mcp_server()`, start a watchdog thread that polls `/health` every 10 seconds. If the health check fails after startup, emit a `mcp-server-crashed` Tauri event so the UI can surface it. Right now a crashed MCP server is invisible.

---

### Layer 2 — `agent:ready` Handshake Is Bypassed (HIGH — fix second)

**Importance**: High. Even if the MCP transport is fixed, this bug means the flow proceeds without confirming the agent is actually connected and ready.

**What's happening:**

In `MissionControlPane.tsx`, `processActivation()` sets up `readyEvent` before calling `mcp_register_runtime_session`:

```typescript
// Line ~1151
const readyEvent = waitForRuntimeActivationState({
  sessionId: payload.sessionId,
  eventType: contract.handshakeEvent,  // 'agent:ready'
  acceptedStatuses: new Set([
    'registered', 'ready',
    'activation_pending',   // <-- BUG: this is the initial status
    'activation_acked', 'running', 'completed', 'done'
  ]),
  timeoutMs: BOOTSTRAP_EVENT_TIMEOUT_MS,  // 8 seconds
  ...
});
```

`waitForRuntimeActivationState` has a polling fallback that calls `get_runtime_activation` every 250ms. The backend inserts the session row with status `activation_pending` in `persist_runtime_session()` **before** the activation event is emitted. So by the time this poll runs for the first time (250ms), the DB already has `activation_pending` — which IS in the accepted set.

**Result**: `readyEvent` resolves within 250ms. The `agent:ready` MCP handshake is never actually waited for. NEW_TASK is injected before MCP is confirmed connected.

**File involved:**
- `src/components/MissionControl/MissionControlPane.tsx` — line ~1151

**Fix:**

Remove `activation_pending` from the accepted statuses in the `readyEvent` call:

```typescript
// Correct: only resolve when MCP registration is confirmed
acceptedStatuses: new Set(['registered', 'ready', 'activation_acked', 'running', 'completed', 'done']),
```

The intended flow is:
1. `mcp_register_runtime_session` sends `runtime_bootstrap` to MCP server
2. MCP server's `executeConnectAgent()` fires and emits `agent:ready` on `agentEvents`
3. The `EventSource` at `/events/session?sid=<sessionId>` receives the event
4. `readyEvent` resolves
5. THEN inject NEW_TASK

With this fix, if MCP is broken, the 8-second timeout fires and `failActivation` is called with a meaningful error, rather than proceeding blindly.

**Secondary: EventSource race condition**

`mcpBus.openConnection()` opens the `EventSource` asynchronously inside a `getBaseUrl().then(...)` callback. If `mcp_register_runtime_session` resolves extremely fast (loopback), `agent:ready` could be emitted before the `EventSource` is connected. The polling fallback handles this correctly once Layer 1 is fixed (poll will see `registered` in DB after `executeRuntimeBootstrapRegistration` runs). No code change needed here, but worth noting.

---

### Layer 3 — PTY "Launch Claude" Step Is Wrong (MEDIUM — fix third)

**Importance**: Medium. Directly causes wrong behavior when Claude is already running.

**What's happening:**

In `processActivation()` (line ~1135), when execution mode is interactive PTY:
```typescript
if (!isHeadlessExecutionMode(payload.executionMode)) {
  await new Promise(r => setTimeout(r, 2000));
  await invoke('write_to_pty', {
    id: terminalId,
    data: `\x15${payload.cliType}\r`   // ctrl-u + "claude" + Enter
  });
}
```

`\x15` is `ctrl-u` (clear line). In a **shell**, this clears any partial input and the `claude\r` runs the `claude` binary. In an **already-running Claude TUI**, `ctrl-u` clears Claude's input line and `claude\r` sends the word "claude" as a user message. Claude responds to it as a chat message, doesn't re-initialize MCP, and the session stays in whatever broken state it was in.

The user's terminal has Claude already running. This step actively corrupts the Claude session.

**File involved:**
- `src/components/MissionControl/MissionControlPane.tsx` — line ~1135

**Fix:**

Before writing the launch command, check if Claude (or the target CLI) is already the foreground process in the PTY. The `get_pty_recent_output` command can be used to detect this:

```typescript
if (!isHeadlessExecutionMode(payload.executionMode)) {
  // Check if the CLI is already running
  const recentOutput = await invoke<string>('get_pty_recent_output', {
    id: terminalId,
    maxBytes: 512,
  }).catch(() => '');

  const claudeAlreadyRunning = /claude|>/.test(recentOutput);  // heuristic

  if (!claudeAlreadyRunning) {
    // Terminal is at a shell prompt — launch the CLI
    await new Promise(r => setTimeout(r, 500));
    await invoke('write_to_pty', {
      id: terminalId,
      data: `\x15${payload.cliType}\r`
    });
    // Wait for CLI to start
    await new Promise(r => setTimeout(r, 2000));
  }
  // If already running: skip launch, go straight to MCP registration
}
```

A more robust approach: expose whether the PTY's current process is the target CLI (e.g. via `pty::get_pty_foreground_pid` in Rust + process name check). But the heuristic above is sufficient for unblocking.

---

### Layer 4 — Spurious `activation_pending` Write After NEW_TASK Inject (MEDIUM)

**Importance**: Medium. Creates a confusing status regression and re-triggers the poll race.

**What's happening:**

In `processActivation()` (line ~1300), after injecting the NEW_TASK signal into the PTY:
```typescript
await invoke('acknowledge_runtime_activation', {
  missionId, nodeId, attempt,
  status: 'activation_pending',   // <-- writes activation_pending BACK
  reason: null,
});
```

At this point the node is in `ready` state. This call writes `activation_pending` back to both the DB and in-memory state. This:
1. Regresses the visible status in Mission Control UI
2. Re-trips the Layer 2 poll race for `ackEvent` (though `ackEvent` doesn't include `activation_pending` in its accepted set, so this doesn't cause a false resolve there)
3. Causes confusing status history

**File involved:**
- `src/components/MissionControl/MissionControlPane.tsx` — line ~1300

**Fix:**

Remove this call entirely. The status should remain `ready` after NEW_TASK is injected, until Claude ACKs via `get_task_details` which transitions to `activation_acked` → `running`.

---

### Layer 5 — `mcp_store_mission` Is Not a Registered Tauri Command (LOW — separate path)

**Importance**: Low for the NodeTree path (which works). Blocks the Launcher pane's "Confirm" button entirely.

**What's happening:**

`LauncherPane.tsx:548` calls `invoke('mcp_store_mission', ...)` but this command does not exist in `lib.rs`. Tauri rejects the invoke with an error. The error is caught by the try/catch at line ~565, which sets `status: 'Error: ...'` and returns. The `addPane('missioncontrol', ...)` call is never reached. **The Launcher pane's Confirm button always silently fails.**

The NodeTree pane correctly calls `start_mission_graph` and works independently.

**Files involved:**
- `src/components/Launcher/LauncherPane.tsx` — line 548
- `src-tauri/src/lib.rs` — command registry

**Fix (two options):**

**Option A**: `start_mission_graph` (called inside Rust by NodeTree) already calls `persist_compiled_mission()` which writes to the `compiled_missions` table — the same table the MCP server reads. So `mcp_store_mission` may be redundant. Remove it from `LauncherPane.tsx` and call `start_mission_graph` directly instead:

```typescript
// Replace:
await invoke('mcp_store_mission', { missionId: pendingLaunch.missionId, graph: pendingLaunch.mission });

// With:
await invoke('start_mission_graph', { missionId: pendingLaunch.missionId, graph: pendingLaunch.mission });
```

**Option B**: If `mcp_store_mission` is intended to pre-register the mission in the MCP DB WITHOUT starting execution (e.g. for staging), implement it in `lib.rs` as a simple `persist_compiled_mission` wrapper that does NOT call `start_mission()`.

---

### Layer 6 — `run_id` Not Written to `agent_runtime_sessions` (LOW)

**Importance**: Low. Cosmetic/diagnostic gap, doesn't block execution.

**What's happening:**

`persist_runtime_session()` in `workflow_engine.rs` inserts rows into `agent_runtime_sessions` but doesn't include `run_id`. The MCP server migrates this column in via `ALTER TABLE ... ADD COLUMN run_id TEXT`. The `buildTaskDetails()` function returns `runtimeSession.run_id` as null to Claude, which means Claude's MCP tools show no `runId` in task context.

**Fix**: Add `run_id` as a parameter to `persist_runtime_session()` and pass `payload.run_id` when calling it from `request_node_activation_locked()`.

---

## Execution Order

| # | Layer | What | Blocks |
|---|-------|------|--------|
| 1 | L1a | Switch MCP transport from SSE → http | Everything |
| 2 | L1b | Persist auth token across restarts | Claude reconnect on app restart |
| 3 | L1c | MCP server error logging | Diagnosability |
| 4 | L2 | Remove `activation_pending` from readyEvent accepted set | False-positive handshake |
| 5 | L4 | Remove spurious `activation_pending` write post-inject | Status regression |
| 6 | L3 | PTY launch heuristic for already-running CLI | Wrong launch behavior |
| 7 | L5 | Fix `mcp_store_mission` in Launcher | Launcher path |
| 8 | L6 | `run_id` in runtime sessions | Diagnostic completeness |
| 9 | L1d | MCP server watchdog | Crash detection |

---

## Do You Need External Documentation?

**Yes — for one specific item**: the exact Claude Code CLI flag for streamable-HTTP MCP transport (Layer 1a).

The current code uses `--transport sse` which is confirmed broken. You need to verify:

1. **What is the correct `claude mcp add` flag?** Options seen in the wild:
   - `--transport http`
   - `--transport streamable-http`
   - No `--transport` flag at all (if `http` is the default)

2. **Does the endpoint path change?** SSE uses `/mcp`. Streamable-HTTP may use a different path or the same one.

3. **Does the `@modelcontextprotocol/sdk` `McpServer` need any changes to support streamable-HTTP**, or does it work with the existing `SSEServerTransport` setup in `server.mjs`?

The MCP SDK v1.x ships `StreamableHTTPServerTransport` as a separate export. `server.mjs` would need to add that transport alongside (or instead of) the SSE one.

**Recommended docs to pull:**
- Claude Code MCP server configuration reference (specifically `mcp add` transport options)
- `@modelcontextprotocol/sdk` changelog / transport migration guide (SSE → streamable-http)
- Any Claude Code release notes mentioning SSE deprecation

Everything else in this plan can be executed with the information already in the codebase.

---

## What Success Looks Like

After all layers are fixed, the happy path for Input Node → Agent Node with Claude interactive PTY:

1. App starts → MCP server starts → token persisted/registered with Claude CLI
2. User has Claude running in terminal (with `terminal-docks` MCP tools available, no failure)
3. User runs mission from NodeTree → `start_mission_graph` called → backend emits `workflow-runtime-activation-requested`
4. MissionControlPane receives event → `processActivation()` starts
5. MCP health check passes
6. Claude already running → skip re-launch
7. `mcp_register_runtime_session` → MCP server registers session → emits `agent:ready`
8. `readyEvent` resolves (via EventSource or poll seeing `registered`)
9. NEW_TASK signal injected into PTY via bracketed paste
10. Claude receives signal → calls `get_task_details` → MCP server emits `activation:acked`
11. `mcpEventBus.ts` receives `activation:acked` → calls `acknowledge_runtime_activation(activation_acked)`
12. `ackEvent` resolves → `acknowledge_runtime_activation(running)` called
13. Node shows RUNNING in Mission Control
14. Claude works the task → calls `handoff_task` → backend advances graph
