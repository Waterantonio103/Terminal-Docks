# Typed MCP Tool Contracts

Phase 8 defines the baseline tools that agents and runtime adapters can rely on. These tools are the stable orchestration surface; internal graph tables and runtime bookkeeping remain implementation details.

All baseline tools return the same MCP text payload shape:

```json
{
  "schema": "mcp_tool_response_v1",
  "ok": true,
  "tool": "get_task_details",
  "message": "Task details loaded.",
  "data": {}
}
```

Errors use the same envelope and set the MCP tool result `isError` flag:

```json
{
  "schema": "mcp_tool_response_v1",
  "ok": false,
  "tool": "get_task_details",
  "error": {
    "code": "bad_input",
    "message": "get_task_details received invalid input: nodeId: Required",
    "details": [{ "path": "nodeId", "message": "Required", "code": "invalid_type" }]
  }
}
```

## Baseline Tools

### `connect_agent`

Purpose: announce a legacy or interactive worker session and record its capabilities.

Request:

```json
{
  "role": "builder",
  "agentId": "builder-agent",
  "terminalId": "term-builder",
  "cli": "claude",
  "profileId": "builder_profile",
  "capabilities": ["coding", "shell_execution"],
  "workingDir": "/workspace"
}
```

Response `data`:

```json
{
  "sessionId": "session-reviewer",
  "status": "online",
  "session": {
    "sessionId": "session-reviewer",
    "role": "builder",
    "agentId": "builder-agent",
    "capabilities": []
  }
}
```

### `get_task_details`

Purpose: return the canonical graph-mode runtime context for one mission node.

Request:

```json
{
  "missionId": "mission-123",
  "nodeId": "builder"
}
```

Response `data`:

```json
{
  "missionId": "mission-123",
  "missionStatus": "active",
  "node": {
    "nodeId": "builder",
    "roleId": "builder",
    "status": "running",
    "attempt": 1
  },
  "runtimeSession": {
    "sessionId": "runtime:mission-123:builder:1",
    "agentId": "agent:mission-123:builder",
    "terminalId": "term-builder",
    "status": "running"
  },
  "legalNextTargets": [
    {
      "targetNodeId": "reviewer",
      "targetRoleId": "reviewer",
      "allowedOutcomes": ["success"]
    }
  ],
  "inbox": [],
  "latestTask": null,
  "upstreamContext": {}
}
```

### `complete_task`

Purpose: record a node completion and activate every legal downstream node for the reported outcome.

Request:

```json
{
  "missionId": "mission-123",
  "nodeId": "builder",
  "attempt": 1,
  "outcome": "success",
  "summary": "Implementation is ready for review.",
  "filesChanged": ["src/example.ts"],
  "artifactReferences": [],
  "keyFindings": ["The interface is stable."],
  "downstreamPayload": { "reviewFocus": "contracts" }
}
```

Response `data`:

```json
{
  "status": "completed",
  "missionId": "mission-123",
  "nodeId": "builder",
  "attempt": 1,
  "outcome": "success",
  "routed": [
    { "targetNodeId": "reviewer", "taskId": 42 }
  ],
  "terminal": false
}
```

### `handoff_task`

Purpose: route work to one exact downstream target. Prefer `complete_task` when all legal downstream targets should be activated.

Graph-mode request:

```json
{
  "missionId": "mission-123",
  "fromNodeId": "builder",
  "fromAttempt": 1,
  "targetNodeId": "reviewer",
  "outcome": "success",
  "title": "Review implementation",
  "description": "Focus on exported contracts.",
  "payload": { "filesChanged": ["src/example.ts"] }
}
```

Legacy role-mode request:

```json
{
  "fromRole": "coordinator",
  "targetRole": "builder",
  "title": "Implement task",
  "description": "Build the requested change.",
  "payload": { "scope": ["src/example.ts"] }
}
```

Response `data` contains `taskId` and `eventBody`. `message` contains the human-readable routing confirmation.

### `assign_task`

Purpose: explicitly pin an existing task to a known live session.

Request:

```json
{
  "taskId": 42,
  "targetSessionId": "session-reviewer",
  "agentId": "reviewer-agent"
}
```

Response `data`:

```json
{
  "status": "assigned",
  "taskId": 42,
  "targetSessionId": "session-reviewer",
  "agentId": "reviewer-agent"
}
```

Use `assign_task_by_requirements` for capability-based scheduling.

### `send_message`

Purpose: send a direct session message or a deterministic graph node inbox message.

Session request:

```json
{
  "targetSessionId": "session-reviewer",
  "message": "Please check the latest task."
}
```

Node request:

```json
{
  "missionId": "mission-123",
  "targetNodeId": "reviewer",
  "message": "Please verify the exported executor contracts."
}
```

Node-targeted messages require `missionId` so `receive_messages({ missionId, nodeId })` can read them deterministically.

Response `data`:

```json
{
  "delivered": true,
  "targetType": "node",
  "missionId": "mission-123",
  "targetNodeId": "reviewer"
}
```

## Contract Rules

- Baseline tool names are stable: `connect_agent`, `get_task_details`, `complete_task`, `handoff_task`, `assign_task`, and `send_message`.
- Graph-mode requests use `missionId`, `nodeId`, `attempt`, and `targetNodeId` consistently.
- Errors return MCP tool results with `isError: true` and an `mcp_tool_response_v1` envelope naming the missing or invalid field.
- Registered MCP handlers delegate to exported executor functions in `mcp-server/server.mjs`; tests call those executors directly for smoke coverage.
- Agents should not depend on internal graph fields, table names, or runtime state transitions outside these response shapes.

## Exposed Graph Fields

`get_task_details.data` intentionally exposes only the fields needed by an agent to execute the current node:

- `missionId`, `graphId`, `missionStatus`, `authoringMode`, `presetId`, `runVersion`, and `objective` identify the active assignment.
- `task` exposes the compiled top-level task prompt and workspace metadata.
- `node` exposes the current node id, role, instruction override, status, attempt, wave id, last outcome, last payload, and update timestamp.
- `runtimeSession` exposes the session id, agent id, terminal id, status, and timestamps for the current attempt.
- `legalNextTargets` exposes exact downstream node ids, target roles, edge conditions, and allowed outcomes.
- `latestTask`, `recentTasks`, `inbox`, `pendingPushes`, and `upstreamContext` expose delivery context needed for handoffs and deterministic inbox reads.

The following remain internal and are not part of the agent-facing contract:

- SQLite table names, row ids outside task/message sequence ids, SQL schema, migrations, and ownership boundaries.
- Full mission timeline records, adapter registrations, runtime lifecycle internals, task-push acknowledgement internals, and file-lock wait queue internals.
- UI layout state, terminal pane configuration beyond the exposed terminal id, graph compiler intermediate structures, and backend JSON-RPC implementation details.
