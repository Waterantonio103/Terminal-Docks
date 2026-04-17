# terminal-docks

## Project Overview

A fully local, subscription-free **Agentic Development Environment** — a desktop app that combines a multi-pane terminal workspace, AI agent orchestration, a task board, and a built-in code editor in one native window. Inspired by BridgeSpace (bridgemind.ai) but runs 100% offline with no accounts, no API keys to a hosted service, and no telemetry.

## Tech Stack

| Layer | Choice | Reason |
|---|---|---|
| Desktop shell | **Tauri v2** | Native OS integration, small binary, not Electron |
| Frontend | **React 19** + TypeScript | Component model, concurrent features |
| Terminal rendering | **`@xterm/xterm`** + `@xterm/addon-webgl` + `@xterm/addon-fit` | GPU-accelerated, widely used; scoped packages (old `xterm` pkg unmaintained) |
| Shell spawning | **`portable-pty`** (Rust crate, in `src-tauri/`) | Native PTY in Rust — no Node.js sidecar, keeps binary self-contained |
| State management | **Zustand** | Lightweight, no boilerplate |
| Styling | **Tailwind CSS** | Utility-first, easy theming via CSS variables |
| Local task storage | **SQLite** via `rusqlite` (Rust, direct) | Full query control, no plugin abstraction layer |
| AI agent runner | **Local CLI** (Claude Code, Aider, Continue, etc.) | User-supplied, no hosted dependency |

## Core Features

### 1. Workspace Grid
- Configurable split layouts: 1-pane, 2-side-by-side, 2×2, 3×4, 4×4 (up to 16 terminals)
- Drag-and-drop panel resizing and reordering
- Each pane can be: Terminal, Editor, Task Board, or Agent Activity Feed
- Workspace configs saved and restored on relaunch
- Quick Open (`Ctrl+P`) to open any file directly into an editor pane

### 2. Terminal Panes
- Full PTY terminal backed by `@xterm/xterm` (frontend) + `portable-pty` (Rust backend via Tauri commands/events IPC)
- Respects user shell (bash, zsh, fish, PowerShell) and dotfiles
- **OSC 133 command blocks** — shell integration marks command start/end for collapsible, clickable output blocks (Warp-style)
- Command history with block-level navigation
- Per-pane working directory and env overrides
- **IPC bridge**: PTY stdout streamed to frontend via Tauri `emit()` events; keystrokes sent backend via `invoke()` commands

### 3. AI Agent Integration
- One-click **Run Task** button: spawns a terminal pane with the user's chosen AI CLI agent pre-loaded (`claude`, `aider`, `continue`, custom script)
- Automatic context injection: task description, file paths, and prompt template injected as the agent's initial input
- Agent sessions are just terminal sessions — full interactivity preserved
- Configurable agent profiles (binary path, args, prompt template, working dir)
- Simultaneous multi-agent spawn across panes on workspace open

### 4. Task Board (Local Kanban)
- Kanban board stored in local SQLite — no cloud sync, no account
- Columns: **Backlog → In Progress → Review → Done**
- Each task: title, description, agent profile, file context, tags
- "Run Task" from any card instantly opens an agent-loaded terminal pane
- Keyboard-driven: add, move, archive cards without mouse

### 5. Built-in Editor Pane
- **CodeMirror 6**-based editor embedded as a pane type (`@codemirror/state` + `@codemirror/view` + language packs)
- ~200KB vs Monaco's ~10MB — appropriate for an embedded pane in a WebView
- Read, edit, save files without leaving the app
- Syntax highlighting via CodeMirror language packages; no LSP required
- Opened via Quick Open or by clicking a file path in a terminal block

### 6. Multi-Agent Orchestration ("Swarm Mode")
- Define agent teams with roles: **builder**, **reviewer**, **scout**, **coordinator**
- Each agent runs in its own terminal pane
- **Local mailbox**: agents write to a shared local directory (`.swarm/mailbox/`) and read each other's outputs; coordinator agent drives sequencing
- Real-time **Activity Feed** pane: aggregated live log of all agent stdout, tagged by agent name and role
- Scales from 2 to 16 concurrent agents
- Swarm config stored as a local JSON file (shareable, version-controllable)

### 7. Themes
- 20+ built-in themes covering: terminal colors, app chrome, scrollbars, syntax highlighting
- Theme stored as a CSS variable set — easy to add custom themes via JSON
- Live theme switching without restart

## Layout & UI Structure

```
┌─────────────────────────────────────────────────────────┐
│  [Logo] terminal-docks    [Layout Picker] [Theme] [⚙]  │  ← App chrome / titlebar
├──────────┬──────────────────────────────────────────────┤
│          │  Pane 1 (Terminal / Editor / Board)          │
│  Sidebar │──────────────────────────────────────────────│
│          │  Pane 2 (Terminal / Editor / Board)          │
│  • Tasks │──────────────────────────────────────────────│
│  • Swarm │  Pane 3                  │  Pane 4           │
│  • Files │                          │                   │
│  • Agents│                          │                   │
└──────────┴──────────────────────────┴───────────────────┘
```

- **Sidebar**: collapsible, contains Task Board nav, Swarm status, file tree, agent profiles
- **Pane area**: drag-and-drop grid, each pane has a tab bar for type switching
- **Pane header**: shows pane type icon, current path or task name, Run Task button
- **Activity Feed**: optional overlay or dedicated pane showing real-time agent output log

## Local-First Principles

- All data (tasks, workspace configs, swarm configs, themes) stored in `~/.terminal-docks/` or beside the binary
- No network requests except those the user's own AI CLI makes
- No telemetry, no analytics, no crash reporting unless user explicitly opts in
- Zero account/login required — install and run

## Development Commands

```bash
# Install dependencies
npm install

# Run in dev mode (Tauri + Vite)
npm run tauri dev

# Build production binary
npm run tauri build

# Run frontend only (for UI work)
npm run dev
```

## Project Structure

```
terminal-docks/
├── src/                    # React frontend
│   ├── components/
│   │   ├── Terminal/       # xterm.js pane wrapper
│   │   ├── Editor/         # CodeMirror 6 editor pane
│   │   ├── TaskBoard/      # Kanban board
│   │   ├── ActivityFeed/   # Swarm log aggregator
│   │   ├── Sidebar/        # Nav, file tree, agent profiles
│   │   └── Layout/         # Grid, drag-drop, pane management
│   ├── store/              # Zustand stores
│   ├── hooks/              # Custom React hooks
│   └── themes/             # Theme definitions (CSS vars)
├── src-tauri/              # Rust/Tauri backend
│   ├── src/
│   │   ├── pty.rs          # PTY spawning
│   │   ├── db.rs           # SQLite task storage
│   │   └── swarm.rs        # Mailbox file watcher
│   └── tauri.conf.json
├── CLAUDE.md               # This file
└── agents.md               # Agent orchestration design
```