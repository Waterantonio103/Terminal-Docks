# Multi-Agent Workflow Improvement Plan

This document outlines a three-phase plan to drastically improve the multi-agent workflow architecture of Terminal Docks. The goal is to evolve the current basic explicit/event-based workflow (relying on string matching and manual task picking) into a robust, deterministic, and highly efficient orchestration system designed specifically for local development codebases. 

## AI Execution Instructions
1. **Context Gathering:** Read the core server logic (`mcp-server/server.mjs`), the existing agent definitions (`src/config/agents.json`), and the front-end agent UI (`src/components/Sidebar/AgentsTab.tsx`, `src/components/TaskBoard/TaskBoardPane.tsx`).
2. **Execution:** Implement this plan phase by phase. Do not proceed to the next phase until the current phase is fully functional, tested, and verified within the UI.
3. **Constraints:** Keep the architecture lightweight and local. Do not introduce heavy enterprise dependencies (like Temporal, Kubernetes, or Docker). Use the existing SQLite/MCP architecture and build native TypeScript/Rust coordination logic around it.

---

## Phase 1: Structured Handoffs & Tool-Calling Architecture
**Objective:** Replace string-based broadcast triggers ("INTELLIGENCE REPORT") with explicit, payload-driven handoffs and a Supervisor pattern.
* **Analysis:** Currently, agents rely on matching `triggerSignal` strings in a broadcast channel. The pasted guide highlights that "Handoff-based Communication" (destination + payload) is much cleaner and more efficient than shared scratchpads for sequential logic.
* **Implementation Steps:**
  1. **Deprecate String Triggers:** Remove `triggerSignal` and `completionSignal` from `agents.json`.
  2. **Implement `handoff_task` Tool:** Add a new MCP tool to `server.mjs` called `handoff_task(targetRole, payload, context)`. When an agent finishes a task, it explicitly hands off structured data to the next agent instead of just "announcing" it is done.
  3. **Supervisor Role (Coordinator):** Upgrade the Coordinator from just creating DB tasks to acting as a tool-calling router. The Coordinator should receive the Scout's payload, break it down, and directly assign tasks to specific Builder instances via a new `assign_task(agentId, taskId)` tool, managing the explicit flow.

## Phase 2: Lightweight Graph-Based State Management
**Objective:** Create predictable, visualizable control flow and dynamic routing without relying on agents "figuring out" what to do next.
* **Analysis:** The codebase currently uses a simple SQLite `tasks` table with `parent_id`. The guide emphasizes the power of Graph-Based State Management (like LangGraph) for tracking transitions, conditions, and explicit control flows.
* **Implementation Steps:**
  1. **Define Local Workflow Graph:** Create a state machine in `server.mjs` defining valid transitions (e.g., `Scout -> Coordinator -> Builder -> Reviewer -> (Pass ? Done : Builder)`).
  2. **Enforce Graph Edges:** Prevent agents from executing out of turn. The server should validate that a Builder cannot start until the Coordinator transitions the workflow state. 
  3. **Dynamic Rerouting (The Review Loop):** Implement dynamic control flow for the Reviewer. If the Reviewer fails a task, it must emit a structured `Command` routing the state back to the specific Builder, attaching the diff and failure reasons as the payload.

## Phase 3: Parallel Execution & Contextual Memory (Workspace State)
**Objective:** Optimize speed via true parallel processing and reduce context window bloat (noise).
* **Analysis:** The guide notes that multi-agent systems shine through parallel processing and reduced verbosity. The current "read all session logs" approach is too verbose and functions like a noisy shared scratchpad.
* **Implementation Steps:**
  1. **Parallel Specialists:** Expand the `agents.json` roster to include parallel actors (e.g., `TestingAgent`, `SecurityAgent`). The Coordinator should be able to trigger the `TestingAgent` to write unit tests *at the same time* the `Builder` writes implementation code.
  2. **Workspace Context Store:** Replace the reliance on `get_session_history` (which is noisy) with a `get_workspace_context` tool. The MCP server will maintain a running, synthesized JSON representation of the current architectural state, design decisions, and active dependencies. Agents will query this exact state instead of reading a timeline of events.
  3. **Automated Conflict Resolution:** Enhance the `lock_file` system. If a Builder and a TestingAgent need the same file, the server's graph engine should detect the contention and seamlessly queue the secondary agent, notifying it when the lock is released without the agent needing to manually poll or send direct messages.

---

## Appendix: Open-Source Inspiration & Reference Implementations
To guide the architectural choices during these phases, the AI should draw inspiration from the following high-quality open-source multi-agent frameworks. These examples successfully implement the supervisor pattern, graph-based execution, and role-based delegation for coding tasks:

1. **MetaGPT (geekan/MetaGPT)**
   * **Relevance:** Treats the entire software development lifecycle as a multi-agent system with strict SOPs.
   * **Key File to Study:** [`metagpt/roles/role.py`](https://github.com/geekan/MetaGPT/blob/main/metagpt/roles/role.py) - Look at how they define the `Role` class, specifically how agents manage their local state, memory, and react to specific message types before taking action.

2. **ChatDev (OpenBMB/ChatDev)**
   * **Relevance:** Simulates a virtual software company communicating through a "Chat Chain".
   * **Key File to Study:** Since the codebase has been heavily refactored, explore the [OpenBMB/ChatDev](https://github.com/OpenBMB/ChatDev) root and search for their `chat_chain` or `agent` abstractions. Observe how the "Reviewer" and "Tester" nodes dynamically loop back to the "Programmer" if code fails, which perfectly mirrors our goals for the Review Loop in Phase 2.

3. **LangGraphJS (langchain-ai/langgraphjs)**
   * **Relevance:** A framework specifically designed for creating stateful, cyclic, multi-agent workflows in TypeScript/JavaScript.
   * **Key File to Study:** [`libs/langgraph-core/src/graph/state.ts`](https://github.com/langchain-ai/langgraphjs/blob/main/libs/langgraph-core/src/graph/state.ts) - LangGraph's core concept of defining agents as "nodes" and handoffs as "edges". We want to build a lightweight, native TS version of this `StateGraph` concept in `server.mjs` without their heavier enterprise overhead.

4. **CrewAI (joaomdmoura/crewAI)**
   * **Relevance:** Role-based agent orchestration that allows for sequential or hierarchical processes.
   * **Key File to Study:** [`lib/crewai/src/crewai/process.py`](https://github.com/joaomdmoura/crewAI/blob/main/lib/crewai/src/crewai/process.py) and [`lib/crewai/src/crewai/crew.py`](https://github.com/joaomdmoura/crewAI/blob/main/lib/crewai/src/crewai/crew.py) - Focus on how the manager agent dynamically delegates sub-tasks to a "crew". This is highly relevant for the Coordinator's tool-calling routing in Phase 1 and 3.

5. **OpenAI Swarm (openai/swarm)**
   * **Relevance:** An educational framework demonstrating highly lightweight, scalable multi-agent patterns.
   * **Key File to Study:** [`swarm/core.py`](https://github.com/openai/swarm/blob/main/swarm/core.py) - Focuses entirely on explicit "handoffs". Look at the `run` loop and how an agent returns a `Result` that contains the `agent` to hand off to next. It is the purest distillation of the lightweight pattern we are trying to achieve.
