# Frontend Source Map

This directory contains the React/TypeScript app shell and browser-side orchestration logic.

## Main Areas

- `App.tsx`: app shell, mode rail, top-level panes, listeners, and global layout.
- `store/workspace.ts`: persisted UI state, workflow graph data, compiled mission data, panes, and mission snapshots.
- `components/`: user-facing panes and controls.
- `lib/workflow/`: canonical workflow definition/run/orchestrator/state-machine logic.
- `lib/runtime/`: runtime session lifecycle, readiness gates, terminal runtime bridge, output bus, and CLI adapters.
- `lib/node-system/`: node-system conversion and editor primitives.
- `lib/models/`: CLI model discovery and provider-specific model helpers.
- `hooks/`: shared React hooks for workflow and mission event state.
- `config/agents.json`: in-app agent role roster and core runtime instructions.

## Agent Notes

- Use `lib/workflow` for graph/run state questions.
- Use `lib/runtime` for CLI session lifecycle, task injection, terminal readiness, and permissions.
- Use `components/NodeTree`, `components/MissionControl`, and `components/Runtime` for workflow UI behavior.
- Keep runtime-only data out of persisted workflow definitions.
