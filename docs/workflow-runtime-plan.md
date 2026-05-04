# Workflow Runtime Activation Plan

> Historical reference: this was a live implementation plan from the earlier
> Tauri-era architecture. Do not treat it as current setup or agent handoff
> instructions. Use `README.md`, `docs/architecture.md`, and
> `docs/control-planes.md` for current Electron + React + Rust backend guidance.

This document is an implementation plan for making Terminal Docks execute graph-defined multi-agent workflows reliably.

It is written so that an AI coding agent can pick up the repo, read this file, inspect the codebase, implement the earliest phase, verify it, and then edit this file before handing off.

## AI Execution Instructions

1. **Read first:** Read this file, then inspect the current implementation in at least these areas before making changes:
   - `src/components/NodeTree/NodeTreePane.tsx`
   - `src/components/MissionControl/MissionControlPane.tsx`
   - `src/components/Terminal/TerminalPane.tsx`
   - the historical Tauri backend entry point, now replaced by `electron/` and `backend/src/`
   - `mcp-server/server.mjs`
   - any mission graph / runtime / activation / session state modules referenced from those files
2. **Only implement the earliest phase.** Do not start work from later phases unless every item in the earliest phase is complete, working, and verified.
3. **After finishing a phase:**
   - delete the completed phase section from this file
   - rename the next phase so it becomes `Phase 1`
   - update any cross-references so the file always presents the next actionable phase as the first phase
   - keep the top-level title and execution instructions intact
4. **Do not mark a phase complete** unless the feature works from the UI, not just in isolated code.
5. **Keep the architecture local-first and lightweight.** Do not add heavy orchestration infrastructure. In the current app, build on the Electron + React + Rust backend + SQLite + MCP structure.
6. **Prefer explicit state and deterministic routing** over hidden heuristics or string-matching behavior.

## Definition of Success

A user should be able to:
- create or open a mission graph
- attach or choose a CLI runtime for each agent node
- press **Run** once
- see each node move through clear states such as `launching`, `connecting`, `ready`, `running`, `handoff`, `done`, or `failed`
- see terminal output and mission progress from inside the mission experience
- see outputs, files, and handoffs update without guessing whether anything happened

The user should **not** need to manually type a connection prompt, manually trigger MCP from inside the terminal, or guess whether a node is actually active.

---

## Notes for the Next Agent

- **Phase 1 (Completed):** Reliability, Recovery, and Re-Run Safety.
  - Mission attempts are now explicitly versioned.
  - Backend (Rust) guards against stale acknowledgments and handoffs by verifying attempt numbers.
  - Added `retry_mission_node` command to re-trigger activation for failed or completed nodes.
  - Added "Retry" UI in Mission Control `NodeCard`.
  - Improved diagnostic logging in the then-current Tauri backend for mission lifecycle events.
- **Current State:** The system is now resilient to retries and stale state.
- **Focus for Phase 2:** Adaptive Planning and Dynamic Graph Modification.
  - Currently, graphs are mostly static or appended to.
  - Next step is allowing agents to propose more complex modifications to the graph during execution.

The goal is that this file always reads like a live queue of remaining implementation work, with the first phase being the only phase the next agent should start.
