# Runtime + UI + MCP Integration Plan

> This file is **phase-driven and self-mutating**.  
> The executing agent MUST:
> 1. Only implement **Phase 1**
> 2. When complete, **delete Phase 1**
> 3. Rename the next phase to **Phase 1**
> 4. Repeat until file is empty

---

# OVERALL GOAL

Unify:
- **Agent Nodes (graph)**
- **Terminal runtimes**
- **MCP connection layer**

Into one system where:

> **Agent Node = runtime + terminal + MCP session + execution state**

---

# PHASE 1 — OUTPUT NODE + ARTIFACT STREAM

## Goal
Show real progress

---

## TASKS

### 1. Capture file changes

### 2. Stream updates to UI

### 3. Display in output node

---

## COMPLETION CHECK
- User sees files appear in real time

---

# FINAL RULE (IMPORTANT)

After completing a phase:

1. Delete it entirely
2. Rename next phase → Phase 1
3. Commit changes

---

# SIMPLE MENTAL MODEL (FOR AGENTS)

- Node = worker
- Terminal = worker body
- MCP = communication line
- Graph = workflow plan
