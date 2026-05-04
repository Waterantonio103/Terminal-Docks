# Starlink MCP Server

This package is the local MCP server used by Terminal Docks agents.

## Entry Points

- `server.mjs`: runtime entrypoint launched by Tauri with `node server.mjs`.
- `src/server.mjs`: modular server source used for direct development and reference.
- `src/tools/`: MCP tool registrations and execution helpers.
- `src/debug/`: debug MCP tools, guardrails, state, reports, and workflow suites.
- `src/db/`: SQLite initialization and database handle.
- `src/utils/`: shared helpers, workflow lookup, sessions, and test helpers.
- `src/resources/` and `src/prompts/`: MCP resources and prompts.

## Agent Notes

- Graph-mode agents should use exact node IDs for handoff/completion.
- The MCP server is the agent-facing tool gateway; it should not duplicate the TypeScript workflow orchestrator as a separate app brain.
- Tests import modular helpers from `mcp-server/src/*`.
- Runtime execution launches the root `server.mjs`.
