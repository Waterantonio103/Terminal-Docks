# Test Map

Tests are Node scripts plus TypeScript compiled through `tsconfig.graph-tests.json`.

## Scripts

- `npm run test:graph`: graph compiler and workflow race coverage.
- `npm run test:mcp`: MCP graph-mode behavior.
- `npm run test:smoke`: mission flow smoke coverage.
- `npm run test:prompt-parity`: generated prompt/tool parity.
- `npm run test:runtime-adapters`: CLI adapter fixture tests.
- `npm run test:headless`: runtime adapters, readiness gate, launch hardening, and headless runtime.
- `npm run test:rust`: Rust workflow engine tests.
- `npm run test:workflow`: broad workflow regression suite.

## Files

- `fixtures/runtime-adapters/`: ANSI output fixtures for CLI status detection.
- `*RuntimeAdapter.test.mjs`: provider-specific status detection tests.
- `runtimeReadinessGate.test.mjs`: readiness gate diagnostics and decisions.
- `mcpGraphMode.test.mjs`: Starlink graph-mode tool behavior.
- `graphCompiler.test.mjs`: UI graph to mission compilation.
- `workflowOrchestratorRuntimeRace.test.mjs`: runtime/orchestrator race protection.

Use the smallest relevant script first, then expand when the touched path crosses subsystem boundaries.
