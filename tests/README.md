# Test Map

Tests are Node scripts plus TypeScript compiled through `tsconfig.graph-tests.json`.

## Scripts

- `npm run test:graph`: graph compiler, workflow race, mission progress, preset sweep, editor language mapping, CodeMirror language extension loading, and editor session cache coverage.
- `npm run test:mcp`: MCP graph-mode behavior.
- `npm run test:smoke`: mission flow smoke coverage.
- `npm run test:prompt-parity`: generated prompt/tool parity.
- `npm run test:runtime-adapters`: CLI adapter fixture tests.
- `npm run test:headless`: runtime adapters, readiness gate, launch hardening, and headless runtime.
- `npm run test:workspace-qa`: live Tauri dev-window editor QA with JSON, Markdown, and a large TSX file.
- `npm run test:terminal-qa`: local ignored Rust/ConPTY terminal QA with Windows shell and common CLIs.
- `npm run test:rust`: Rust workflow engine tests.
- `npm run test:workflow`: broad workflow regression suite.

## Files

- `fixtures/runtime-adapters/`: ANSI output fixtures for CLI status detection.
- `*RuntimeAdapter.test.mjs`: provider-specific status detection tests.
- `runtimeReadinessGate.test.mjs`: readiness gate diagnostics and decisions.
- `mcpGraphMode.test.mjs`: Starlink graph-mode tool behavior.
- `sourceNaming.test.mjs`: source guard for Comet-AI and Starlink terminology.
- `graphCompiler.test.mjs`: UI graph to mission compilation.
- `workflowOrchestratorRuntimeRace.test.mjs`: runtime/orchestrator race protection.
- `editorLanguage.test.mjs`: editor file-extension language labels and mode selection.
- `editorLanguageExtensions.test.mjs`: CodeMirror language package loading for supported editor modes.
- `editorSessionCache.test.mjs`: editor dirty-content and view-state cache behavior, including a large file buffer.

Use the smallest relevant script first, then expand when the touched path crosses subsystem boundaries.

## UI Verification

Editor/workspace changes can use `npm run test:workspace-qa` for a live app harness, plus `npm run build` for production bundling. Change-review UI still needs manual app verification unless helper logic is extracted into focused tests.
