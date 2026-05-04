# Agent Guide

This file is the first stop for AI coding agents working in Terminal Docks.

## Product Direction

Terminal Docks is a local-first multi-agent workflow app. CLI coding agents are
the execution interface; workflows are authored as graphs; runtime state is
observable by UI/control planes but owned by runtime services.

Target layering:

```text
Desktop UI / MCP / tdctl / future CLI
        |
Electron IPC / backend JSON-RPC / MCP protocol
        |
workflow orchestration + runtime services
        |
provider adapters + terminal runtime
        |
PTY/backend/persistence
        |
CLI agents
```

## Non-Negotiable Architecture Rules

- Keep workflow orchestration graph-first.
- Do not turn MCP into the orchestration brain. MCP should expose protocol tools over services/state.
- Do not make React components or Zustand the owner of runtime truth.
- Keep provider-specific behavior inside provider adapters.
- Keep PTY/process details below runtime services.
- Keep schema creation and migrations in the backend persistence owner.
- Preserve future desktop UI, MCP, and CLI/headless control planes.

## Where To Work

- UI shell and panes: `src/App.tsx`, `src/components/`.
- UI state only: `src/store/workspace.ts`.
- Workflow graph/run behavior: `src/lib/workflow/`.
- Graph compiler/helpers: `src/lib/graphCompiler.ts`, `src/lib/graphUtils.ts`, `src/lib/node-system/`.
- Runtime lifecycle: `src/lib/runtime/RuntimeManager.ts`, `src/lib/runtime/RuntimeSession.ts`.
- Provider behavior: `src/lib/runtime/adapters/`.
- Low-level terminal/backend IPC wrapper: `src/lib/runtime/TerminalRuntime.ts`.
- Desktop IPC bridge: `electron/`, `src/lib/desktopApi.ts`.
- Backend workflow, PTY, DB, MCP process: `backend/src/`.
- MCP facade/tools: `mcp-server/`.
- Scriptable control plane: `scripts/tdctl.mjs`, `scripts/control-plane-client.mjs`.
- Tests: `tests/`.

## Change Discipline

- Prefer small, boundary-preserving changes.
- Update imports when moving files; do not change runtime behavior during organization-only work.
- Do not introduce provider-specific checks in `RuntimeManager`; add adapter methods or capability metadata.
- Do not add schema creation to `mcp-server/server.mjs`; update `backend/src/db.rs` first.
- Do not add UI store imports to runtime or workflow core.
- Avoid broad refactors unless tests cover the affected behavior.

## Verification

Choose the narrowest relevant command first:

```bash
npm run build
npm run test:graph
npm run test:mcp
npm run test:runtime-core
npm run test:providers
npm run test:control-plane
npm run test:rust
```

For changes that affect orchestration across layers, run:

```bash
npm run test:workflow
```

If a command cannot run in the current environment, record the failure and the
reason in your handoff.
