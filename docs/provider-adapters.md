# Provider Adapter Guide

Runtime providers are implemented under `src/lib/runtime/adapters`. The runtime manager owns lifecycle orchestration; each provider adapter owns provider-specific launch, readiness, permission, completion, and input behavior.

## Required Contract

Every adapter implements `CliAdapter` from `src/lib/runtime/adapters/CliAdapter.ts`:

- `id` and `label`
- `capabilities`
- `buildLaunchCommand`
- `detectReady`
- `buildInitialPrompt`
- `detectPermissionRequest`
- `buildPermissionResponse`
- `detectCompletion`
- `normalizeOutput`
- `buildActivationInput`

Provider-specific timing, prompt shortening, bracketed paste behavior, permission key presses, trust prompts, and completion detection belong in the adapter. `RuntimeManager` should only call adapter methods and read adapter metadata.

## Capability Metadata

`capabilities` documents what the runtime can depend on:

- `supportsHeadless`: provider has a supported non-interactive launch path.
- `supportsMcpConfig`: provider can consume MCP config and call MCP tools.
- `supportsHardToolRestrictions`: provider can enforce a native allow/deny tool policy at launch.
- `supportsPermissions`: provider permission prompts can be detected and answered.
- `requiresTrustPromptHandling`: provider may block on workspace trust prompts.
- `completionAuthority`: `mcp_tool` when graph completion must come from MCP tools, or `process_exit` when a process exit can resolve the activation.

Keep the metadata conservative. Unknown support should be `false`.

## Adding A Provider

1. Create `src/lib/runtime/adapters/<provider>.ts`.
2. Export a single `<provider>Adapter: CliAdapter`.
3. Add it to `src/lib/runtime/adapters/index.ts`.
4. Add readiness, permission, completion, and input-format fixtures under `tests/fixtures/providers/<provider>/`.
5. If the provider also supports headless runs, add or update command-builder coverage in `tests/headlessRuntime.test.mjs`.

Do not add provider-specific conditionals to `RuntimeManager`. Add a capability or adapter method when the provider needs different behavior.

## Transcript Fixtures

Provider parser changes must be backed by transcript fixtures. Keep Codex and Claude fixtures under:

- `tests/fixtures/providers/codex/`
- `tests/fixtures/providers/claude/`

Each primary provider should keep representative transcripts for idle/ready, running, completed, failed, permission prompt, trust prompt, and interrupted states. Fixtures should be multi-line terminal-shaped samples, not one-line strings. Synthetic transcripts are acceptable when real output contains private data, but preserve the important prompt words, status markers, ANSI-adjacent layout, and line ordering that the adapter parses.

When changing `detectReady`, `detectPermissionRequest`, `detectCompletion`, `normalizeOutput`, or `buildActivationInput`, update or add a fixture in the same change and run:

```bash
npm run test:providers
```

Known regression fixtures cover Codex bootstrap prompt shortening and bracketed-paste newline flattening for Codex and Claude. Keep those fixtures in place when refactoring input delivery because they protect against prompt truncation and accidental newline submission in interactive PTYs.
