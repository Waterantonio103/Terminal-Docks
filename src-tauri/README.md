# Tauri Native Layer

This directory contains Rust native services for the desktop app.

## Main Areas

- `src/lib.rs`: Tauri command registration and plugin setup.
- `src/pty.rs`: PTY spawn, write, resize, destroy, output capture, runtime metadata, and permission audit commands.
- `src/db.rs`: SQLite-backed app data commands.
- `src/mcp.rs`: local Starlink MCP server lifecycle and internal push bridge.
- `src/workspace.rs`: workspace filesystem commands.
- `src/model_detection.rs`: CLI/model discovery commands.
- `src/workflow_engine.rs`, `src/workflow.rs`, `src/workflow_log.rs`: workflow persistence, compatibility, retry, patch, activation, and export commands.
- `src/agent_run.rs`: headless/API agent-run support.
- `src/node_graph/`: Rust-side node graph types and runtime support.

## Agent Notes

- Keep Rust focused on native services and persistence boundaries.
- Do not move TypeScript workflow routing or CLI-specific parsing into Rust without a strong native reason.
- Build outputs belong under ignored `target*` directories.
