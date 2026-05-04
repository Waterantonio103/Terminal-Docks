# Current Plan

## Purpose

This document replaces the previous roadmap content. It describes the current documentation and engineering plan for Terminal Docks.

## Current Priorities

1. Keep the workflow brain in TypeScript and preserve the separation between workflow definitions, workflow runs, runtime sessions, and native services.
2. Make runtime delegation reliable across Claude, Codex, Gemini, and OpenCode.
3. Harden readiness detection so tasks are injected only into compatible, ready runtimes.
4. Keep Starlink MCP as the agent-facing tool gateway, not a competing workflow orchestrator.
5. Keep agent-facing documentation short, current, and aligned with the implemented code.

## Documentation Ownership

- `PRD.md`: product requirements, non-goals, current priorities, and quality bar.
- `architecture.md`: repo map, subsystem ownership, runtime flow, boundaries, and tests.
- `plan.md`: this current plan summary.
- Local root `AGENTS.md`: user preferences and general coding-agent context.
- Local root `CLAUDE.md`: Claude-specific workspace context.

## Engineering Guardrails

- Do not change app behavior as part of documentation cleanup.
- Do not mix runtime-only data into workflow definitions.
- Do not bypass RuntimeManager for workflow task injection.
- Do not route graph-mode handoffs by role name when exact node IDs are available.
- Do not treat phase labels in old comments as authoritative unless current code confirms them.

## Verification Expectations

- Documentation-only changes require diff review.
- Runtime adapter changes require fixture-based adapter tests.
- Workflow graph or orchestrator changes require graph/workflow tests.
- MCP handoff/completion changes require MCP graph-mode tests.
- Rust native changes require the relevant Rust test target.
