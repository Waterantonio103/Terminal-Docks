# Frontend Framework And Library Status

Last updated: 2026-05-14

## Implemented

- Tightened the frontend spec framework so generated `DESIGN.md` files use a canonical, fill-in design-system structure instead of loose art direction.
- Added exact `DESIGN.md` expectations for colors, typography, spacing, radii, layout, surfaces, component recipes, responsive behavior, accessibility notes, and builder handoff.
- Added MCP frontend library resources:
  - `frontend-library://index` as the top-level map.
  - `frontend-skill://...` resources for 11 frontend skill documents.
  - `frontend-patterns://neuform/index` plus 69 optional Neuform effect/pattern resources.
  - `frontend-reference://ui/index` plus 50 curated screenshot reference resources grouped by UI category.
- Moved curated UI screenshots into `mcp-server/src/resources/frontend-references/ui`.
- Updated frontend agent instructions so agents read the library index, choose only relevant skills/patterns/references, and record selected resource URIs in handoff context.
- Added tests for the frontend spec framework and library index counts.

## Current State

The frontend workflow now has an agent-facing spec framework plus an optional craft library. The intended flow is:

1. Read accepted user artifacts and specs first.
2. Read `frontend-library://index`.
3. Load role-relevant skill docs only.
4. Strongly consider 1 to 3 fitting Neuform patterns.
5. Inspect 1 to 4 fitting UI reference images when screenshots would improve visual calibration.
6. Translate selected resources into concrete `DESIGN.md`, implementation, or review decisions.

The library is advisory. User instructions, accepted `PRD.md`, accepted `DESIGN.md`, accepted `structure.md` or `architecture.md`, supplied screenshots, brand files, and current code remain the source of truth.

## Still Needed

- Theme picker UI and workflow integration:
  - Expose layout/style/effects choices to the user before `DESIGN.md` generation.
  - Reuse the current stable skill, pattern, and reference metadata instead of creating a parallel picker catalog.
  - Persist selected picker values into frontend spec context so agents can generate exact `DESIGN.md` fields from them.
- Frameworks for non-frontend workflow types:
  - Define the equivalent artifact schemas, intake gates, quality rubrics, and agent handoff rules for other workflow categories.
  - Keep the same pattern as frontend: fill-in frameworks, not hardcoded outputs.
  - Add tests that assert each workflow type exposes required artifacts, role guidance, and acceptance checks.
