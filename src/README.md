# Frontend Source Map

This directory contains the React/TypeScript app shell and browser-side orchestration logic.

## Main Areas

- `App.tsx`: workspace-first app shell, mode rail, top-level panes, listeners, startup markers, and global layout.
- `store/workspace.ts`: persisted UI state, workflow graph data, compiled mission data, panes, and mission snapshots.
- `components/`: user-facing panes and controls.
- `components/AgentDock/`: global agent dock for active mission follow-up from the workspace shell.
- `components/ChangeReview/`: agent change review pane for unified diff artifacts, hunk accept/reject, and changed-file inspection.
- `components/Editor/`: CodeMirror editor panes, file previews, save/reload behavior, and language-aware editing basics.
- `components/Terminal/`: xterm panes and PTY integration.
- `components/MissionControl/`: mission progress and evidence for workflow runs.
- `lib/workflow/`: canonical workflow definition/run/orchestrator/state-machine logic.
- `lib/runtime/`: runtime session lifecycle, readiness gates, terminal runtime bridge, output bus, and CLI adapters.
- `lib/editorLanguage.ts`, `lib/editorLanguageExtensions.ts`, `lib/editorDiagnostics.ts`, `lib/languageService.ts`, and `lib/editorSessionCache.ts`: editor language detection, CodeMirror language loading, parser diagnostics, LSP client wiring, and session-local dirty buffer/view-state helpers.
- `lib/debug/workspaceQaHarness.ts`: dev-only live app harness used by `npm run test:workspace-qa`.
- `lib/node-system/`: node-system conversion and editor primitives.
- `lib/models/`: CLI model discovery and provider-specific model helpers.
- `hooks/`: shared React hooks for workflow and mission event state.
- `config/agents.json`: in-app agent role roster and core runtime instructions.

## Agent Notes

- Use `lib/workflow` for graph/run state questions.
- Use `lib/runtime` for CLI session lifecycle, task injection, terminal readiness, and permissions.
- Use `components/Editor`, `components/Terminal`, `components/Sidebar`, `components/AgentDock`, and `components/ChangeReview` for the default workspace surface.
- Use `components/NodeTree`, `components/MissionControl`, and `components/Runtime` for workflow builder, mission progress, and runtime monitor behavior.
- Keep runtime-only data out of persisted workflow definitions.
