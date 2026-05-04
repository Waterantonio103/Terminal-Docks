# Claude Agent Notes

Claude agents working in Terminal Docks should follow the same repo guide as all
other coding agents:

- `AGENTS.md`
- `architecture.md`
- `repository-map.md`
- `provider-adapters.md`
- `mcp-tool-contracts.md`

Provider-specific Claude CLI behavior belongs in
`src/lib/runtime/adapters/claude.ts` and should be covered by
`tests/runtimeProviderAdapters.test.mjs`.

Do not add Claude-specific branching to workflow orchestration, UI components, or
MCP tool handlers when the behavior belongs in the provider adapter contract.
