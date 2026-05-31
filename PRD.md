# Comet-AI PRD

## Product Summary

Comet-AI is a local desktop AI coding workspace. It combines terminal sessions, file browsing, an IDE-like editor, local CLI agents, task inboxes, and advanced workflow automation in one Tauri app.

The product is local-first. The app should coordinate user-owned CLI agents and local files without requiring a hosted service, account, telemetry, or cloud control plane.

## Target Users

- Developers who want a fast local editor/terminal workspace with AI close at hand.
- Developers running local coding agents across real repositories.
- Power users who design repeatable multi-agent workflows as graphs.
- Maintainers debugging agent handoffs, terminal readiness, CLI adapters, and MCP coordination.

## Core User Outcomes

- Open the app into a usable workspace with file explorer, editor panes, and terminal sessions.
- Edit common project files with language-aware highlighting, search, bracket matching, line numbers, and cursor position.
- Ask local agents for help from the working context without treating Mission Control as the primary chat surface.
- Build a workflow graph with task, agent, barrier, frame, and reroute nodes when repeatable orchestration is needed.
- Compile a workflow into a mission with deterministic start nodes and execution layers.
- Launch one or more CLI-backed agent runtimes from the mission graph.
- Watch mission progress, runtime state, terminal output, handoffs, artifacts, retries, and failures.
- Keep file edits coordinated through locks and structured agent handoffs.
- Recover from CLI readiness failures, stale sessions, permission prompts, and manual takeover cases.

## Functional Requirements

### Workspace and Editor

- The default app surface must support file browsing, editor panes, terminal panes, and fast switching between them.
- The editor should detect common languages by file extension and provide IDE-like basics: line numbers, line/column status, bracket matching, active line highlighting, search, keyboard shortcuts, dirty state, reload, and save.
- Editor and terminal paths should stay responsive while workflow, runtime, MCP, or model-discovery services are warming up.

### Agent Dock

- The user should be able to send prompts for the active mission from the workspace context without opening Mission Control.
- The agent entry surface should preserve provider/model selection, context controls, attachments, clear/compact actions, queued/running state, and links to any active mission.
- Mission Control may open or reference agent sessions, but it should not be the only place to continue a conversation.

### Workflow Authoring

- The user can author workflows in the NodeTree view.
- Workflows support agent nodes, task context, edge conditions, execution modes, CLI selection, models, capabilities, requirements, and retry policy.
- The graph compiler must produce a compiled mission with normalized nodes, edges, start nodes, and execution layers.

### Mission Execution

- The workflow orchestrator is the canonical TypeScript owner of live workflow state.
- Runtime state must stay separate from persisted workflow definitions.
- Mission execution must activate legal start nodes, route completions and handoffs through graph edges, and reject illegal transitions.
- Retry and reroute behavior must be explicit and visible in run state.
- Mission Control should read primarily as progress and evidence: node status, handoffs, artifacts, changed files, blocked permissions, and final summary.

### Runtime Management

- RuntimeManager owns live RuntimeSession lifecycle.
- Workflow activation must go through RuntimeManager readiness paths instead of direct terminal injection.
- CLI adapters define launch, readiness, permission, completion, and prompt behavior for Claude, Codex, Gemini, OpenCode, and future CLIs.
- Runtime readiness must distinguish idle, processing, waiting for user input, completed, failed, stale, and disconnected states.

### Terminal and Native Services

- Tauri/Rust owns PTY process management, filesystem commands, SQLite access, MCP server lifecycle, and native OS integration.
- Terminal output must be available to runtime logic even when a terminal pane is not mounted.
- Manual terminal takeover must remain possible when automated runtime control cannot proceed safely.

### Starlink MCP Coordination

- The MCP server provides agent-facing tools for task details, handoff, completion, inbox, locks, artifacts, workspace context, quality checks, and debug workflows.
- Graph-mode agents must route by exact node IDs and include attempt data in handoff/completion calls.
- File locks should queue contending agents and notify them through inbox messages when locks become available.

### Observability and Debugging

- Runtime, mission, MCP, frontend error, and debug-run state must be inspectable.
- Debug MCP tools may run workflow test suites, collect reports, and propose or apply guarded patches.
- Reports should capture failures, evidence, verification, and remaining issues.

## Non-Goals

- Do not introduce a hosted backend as the orchestration source of truth.
- Do not depend on Docker, Kubernetes, Temporal, or a heavyweight workflow platform for local execution.
- Do not make MCP the sole workflow brain; MCP is an agent/tool gateway and coordination layer.
- Do not merge runtime state back into workflow design definitions.
- Do not remove interactive terminal control from users.

## Current Product Priorities

1. Make the workspace/editor/terminal flow feel like the primary daily surface.
2. Provide a global agent dock for workspace-context prompts.
3. Keep workflow graphs as advanced automation, not the first required mental model.
4. Make runtime delegation reliable across Claude, Codex, Gemini, and OpenCode.
5. Keep workflow state, runtime state, and persisted design state cleanly separated.
6. Reduce stale-session and busy-terminal task injection failures.
7. Improve agent-facing documentation so future agents start from current architecture, not old roadmaps.
8. Maintain focused regression coverage around editor/workspace, graph compilation, runtime adapters, readiness gates, MCP graph mode, and orchestrator routing.

## Quality Bar

- No behavior change should be hidden inside documentation or cleanup work.
- Workflow changes require tests covering graph/runtime/MCP paths proportional to the risk.
- CLI adapter changes require fixture-based status tests where possible.
- Runtime changes must consider stale terminals, duplicate launches, permission prompts, and incomplete MCP handshakes.
- UI changes must be verified in the app when they affect layout, terminal rendering, or mission visibility.
- Editor changes must be checked against representative file types and Windows paths.

## Acceptance Criteria

- A new agent can identify the product goal, architecture boundaries, and key files within five minutes.
- Current docs do not direct agents to obsolete string-trigger, mailbox-only, or legacy role-routing designs.
- The root architecture guide names the canonical owners for workflow state, runtime state, MCP tools, and native services.
- Agent-specific local files can exist without being accidentally committed.
