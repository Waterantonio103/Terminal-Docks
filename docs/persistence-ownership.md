# Persistence Ownership

Phase 2 of the CAO-quality refactor makes backend state authority explicit.

## Canonical Owner

`backend/src/db.rs` owns app schema creation and migrations for runtime, mission, task, and MCP coordination state.

The Rust backend initializes this database before spawning the Node MCP server. When Rust starts MCP it sets:

- `MCP_DB_PATH`: path to the shared SQLite database.
- `MCP_SCHEMA_OWNER=backend`: tells MCP to verify the schema instead of creating it.

## MCP Compatibility Layer

`mcp-server/server.mjs` is a protocol facade. It must not create or migrate tables inline.

`mcp-server/persistence.mjs` is the only Node-side compatibility bootstrap. It exists for standalone MCP tests and manual MCP runs where the Rust backend is not running. In backend-owned mode it only verifies that the canonical tables already exist.

## Table Inventory

| Table | Canonical owner | Used by |
| --- | --- | --- |
| `tasks` | `backend/src/db.rs` | task board, handoff/delegation tools |
| `file_locks` | `backend/src/db.rs` | MCP file lock tools |
| `session_log` | `backend/src/db.rs` | MCP inbox/history and runtime events |
| `workspace_context` | `backend/src/db.rs` | shared agent context tools |
| `compiled_missions` | `backend/src/db.rs` | graph mission details and adaptive patches |
| `mission_node_runtime` | `backend/src/db.rs` | node activation state |
| `agent_runtime_sessions` | `backend/src/db.rs` | runtime session registration and activation |
| `agent_runs` | `backend/src/db.rs` | headless/streaming agent run records |
| `mission_timeline` | `backend/src/db.rs` | graph patch and mission timeline events |
| `task_pushes` | `backend/src/db.rs` | idempotent adapter activation delivery |
| `adapter_registrations` | `backend/src/db.rs` | MCP adapter lifecycle tools |

## Rules For New Persistence Work

- Add schema changes to `backend/src/db.rs` first.
- Update `mcp-server/persistence.mjs` only if standalone MCP compatibility needs the same table or column.
- Do not add `CREATE TABLE`, `ALTER TABLE`, or `better-sqlite3` imports to `mcp-server/server.mjs`.
- Add or update `tests/mcpPersistenceOwnership.test.mjs` when table ownership changes.
