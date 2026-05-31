# Current Plan

## Purpose

This document replaces the previous roadmap content. It describes the current product and engineering plan for Comet-AI.

## Current Priorities

1. Make Workspace the primary app surface: file explorer, editor, terminal, and preview should feel like the daily home.
2. Upgrade the editor toward IDE-like behavior while keeping the implementation pragmatic and CodeMirror-based.
3. Keep improving the global workspace-context agent dock; Mission Control should stay focused on progress and evidence.
4. Keep workflow graphs as advanced automation and preserve the separation between workflow definitions, workflow runs, runtime sessions, and native services.
5. Make runtime delegation reliable across Claude, Codex, Gemini, and OpenCode.
6. Harden readiness detection so tasks are injected only into compatible, ready runtimes.
7. Keep Starlink MCP as the agent-facing tool gateway, not a competing workflow orchestrator.
8. Keep agent-facing documentation short, current, and aligned with the implemented code.

## Documentation Ownership

- `PRD.md`: product requirements, non-goals, current priorities, and quality bar.
- `architecture.md`: repo map, subsystem ownership, runtime flow, boundaries, and tests.
- `plan.md`: this current plan summary.
- `docs/product-focus-roadmap.md`: local roadmap for the workspace-first refocus. This folder is ignored by git.
- Local root `AGENTS.md`: user preferences and general coding-agent context.
- Local root `CLAUDE.md`: Claude-specific workspace context.

## Engineering Guardrails

- Do not change app behavior as part of documentation cleanup.
- Do not mix runtime-only data into workflow definitions.
- Do not bypass RuntimeManager for workflow task injection.
- Do not route graph-mode handoffs by role name when exact node IDs are available.
- Do not treat phase labels in old comments as authoritative unless current code confirms them.
- Do not describe planned agent-dock behavior as implemented unless the code path exists and is wired into the app shell.

## Verification Expectations

- Documentation-only changes require diff review.
- Runtime adapter changes require fixture-based adapter tests.
- Workflow graph or orchestrator changes require graph/workflow tests.
- MCP handoff/completion changes require MCP graph-mode tests.
- Rust native changes require the relevant Rust test target.
- Editor/workspace changes require at least a frontend build and, when layout changes are visible, manual app verification.
