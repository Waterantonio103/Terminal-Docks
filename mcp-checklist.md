# MCP Toolbox Follow-Up Checklist

## Add MCP Sources

- [ ] Add authenticated remote MCP sources.
- [ ] Decide credential storage for bearer tokens, OAuth, and custom headers.
- [ ] Add an explicit trust review screen before enabling public internet MCP URLs.
- [ ] Support stdio MCP sources with supervised process lifecycle.
- [ ] Add managed local sources after a concrete integration is selected.
- [ ] Build a curated source catalog or marketplace for known integrations.
- [ ] Import existing MCP client configs with a read-only preview first.
- [ ] Support restore for archived MCP sources.
- [ ] Add hard purge only if source ID reuse is intentionally supported.

## Tool Configuration

- [ ] Enforce confirmation settings with a pending-call approval UI.
- [ ] Enforce risk settings once confirmation exists.
- [ ] Enforce allowed agent roles at `tools/call`.
- [ ] Decide whether display names should appear in MCP descriptions for agents.
- [ ] Define default arguments semantics before implementing them.
- [ ] Add source-level configuration UI for defaults and enablement.

## Proxy Hardening

- [ ] Add background refresh scheduling and stale-source age indicators.
- [ ] Add per-source call timeout controls.
- [ ] Add structured audit rows for proxied calls.
- [ ] Surface proxy collision details in the toolbox UI.
- [ ] Add support for upstream resources/images without flattening content.
- [ ] Add retry policy only for safe/idempotent discovery paths.

## UI

- [ ] Add source health details and last discovery timestamp.
- [ ] Add degraded-source repair flow.
- [ ] Add source restore/archive management view.
- [ ] Add per-source event filtering.
- [ ] Add empty states for no sources, degraded sources, and disabled sources.

## Testing

- [ ] Add end-to-end UI smoke coverage for Add MCP Source.
- [ ] Add tests for authenticated sources once auth lands.
- [ ] Add tests for stdio process supervision once stdio lands.
- [ ] Add tests for confirmation approval/rejection behavior.
- [ ] Add migration tests for legacy toolbox localStorage config.

