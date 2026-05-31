# Structure

## Purpose
- Define the implementation plan for a compact browser app delivered as static files.
- Preserve the binding App/Site direction: dashboard layout, compact density, navy cyan palette, slight radii, data visualization assets, filtering/search, realtime state, basic navigation, and developer-tool tone.
- Keep the architecture small enough for `index.html`, `styles.css`, and `app.js` without build tooling.
- Treat `PRD.md` and `DESIGN.md` as optional upstream context if later nodes add them; this file is the current implementation source for builder and QA.

## Recommended Route or Screen Map
- Single static route: `index.html`.
- In-page navigation targets:
- `#overview`: first viewport dashboard summary and primary conversion action.
- `#signals`: searchable and filterable live activity table/list.
- `#insights`: compact data visualization panels.
- `#handoff`: implementation proof, expected files, and local verification path.
- No router, server, bundler, cookies, authentication, or external API calls.

## Global Layout
- Use an app-shell dashboard composition rather than a marketing hero layout.
- Desktop layout: fixed-width left rail, top status strip, main two-column content grid.
- Tablet layout: horizontal nav row above the main content; cards remain dense.
- Mobile layout: single-column stack with sticky compact top navigation.
- First viewport must name the product/category clearly and show the dashboard surface immediately, while leaving a visible hint of the next section.
- Background layer owns the WebGL grid canvas; semantic content remains above it in normal HTML.

## Page or Screen Structure
- `body`
- `canvas#grid-bg` for Background Grid WebGL effect.
- `.app-shell` wrapper with skip link and readable foreground contrast.
- `.side-nav` with product name, section links, and run metadata.
- `.topbar` with search input, environment filter, and live status indicator.
- `main`
- `section#overview` with KPI cards, compact CTA buttons, and system health summary.
- `section#signals` with filter chips, search results, and live activity feed.
- `section#insights` with lightweight charts built from CSS/HTML or canvas-free SVG-free div bars.
- `section#handoff` with expected file checklist and verifier command.
- `footer` with local-only notice and preset metadata.

## Home Sections
- First viewport combines `#overview` dashboard status, primary CTA, and compact proof metrics in the same app shell.
- Next-section hint is provided by the top of `#signals` remaining visible below the first viewport on common desktop and mobile heights.
- Sections stay operational: no oversized hero block, no decorative split media panel, and no route change.

## CTA Placement
- Primary CTA appears in `#overview` and anchors to `#signals`.
- Secondary CTA appears beside it and references `node verify_preset.mjs`.
- Repeated contextual CTA appears in `#handoff` as a command/checklist row, not a marketing banner.

## Proof and Content Sections
- `#overview` proof: KPI cards for validation health, active checks, response latency, and generated signal volume.
- `#signals` proof: filterable realtime activity rows showing browser-only state changes.
- `#insights` proof: compact data visualization panels rendered from local arrays.
- `#handoff` proof: expected output file checklist and verifier command.

## Recommended Content Components
- `NavItem`: anchor link with active state driven by hash or click.
- `StatusPill`: small live/offline/warning indicators with accessible text.
- `MetricCard`: label, value, delta, and tiny data strip.
- `FilterChip`: toggles selected signal category.
- `SearchBox`: filters activity and metric rows in client state.
- `ActivityRow`: timestamp, service, event type, status, and severity marker.
- `MiniChart`: small bar/spark display from local arrays.
- `FileChecklist`: static acceptance list for output files.
- `GridBackground`: WebGL canvas setup with CSS fallback.

## Recommended File Structure
- `index.html`: semantic document, app regions, accessible controls, and static markup shell.
- `styles.css`: design tokens, responsive dashboard layout, component states, focus rings, reduced-motion fallback styles.
- `app.js`: local dataset, filtering/search state, live activity timer, nav state, WebGL grid initialization, fallback checks.
- `preset_manifest.json`: preset metadata, run number, graph shape, expected files, and theme direction summary.
- `verify_preset.mjs`: Node verifier using `import.meta.url` for base directory resolution.
- `README.md`: preset name, run number, graph shape, open/run command, output file list.
- `branch-artifacts/frontend_architect.md`: this node evidence.
- `branch-artifacts/frontend_builder.md`: downstream builder evidence.
- `branch-artifacts/interaction_qa.md`: downstream QA evidence.

## Content Data Model
- `state.searchQuery`: string from the topbar search input.
- `state.activeFilter`: one of `all`, `build`, `runtime`, `deploy`, `alert`.
- `state.activeSection`: one of `overview`, `signals`, `insights`, `handoff`.
- `state.liveTick`: integer incremented by interval to simulate realtime updates.
- `metrics[]`: `{ id, label, value, delta, trend[], status }`.
- `activities[]`: `{ id, time, service, category, severity, message }`.
- `charts[]`: `{ id, label, values[], colorToken }`.
- `expectedFiles[]`: strings matching the workflow acceptance list.

## Suggested Initial Copy Blocks
- Product/category name: `SignalDeck Ops Console`.
- First viewport headline: `SignalDeck Ops Console`.
- Supporting copy: `A compact browser dashboard for tracking build, runtime, and deploy signals during a preset validation run.`
- Primary action: `Inspect live signals`.
- Secondary action: `Run verifier`.
- Empty search state: `No signals match the current query.`
- Local-only note: `Demo data is generated in the browser; no network calls are required.`

## Implementation Notes
- Use plain HTML/CSS/JavaScript only; no package install is required.
- WebGL grid: initialize a canvas behind content, draw perspective grid lines with slow forward drift and subtle particles using the cyan accent sparingly.
- WebGL fallback: if `getContext('webgl')` fails, use layered CSS grid backgrounds and set a visible fallback class.
- Reduced motion: respect `prefers-reduced-motion: reduce` by disabling animation loops, staggered list transitions, and live row pulse effects.
- Nonblank check: builder should expose a `data-grid-ready` or `data-grid-fallback` attribute on `body` after initializing the background.
- Mobile framing: keep the canvas fixed/full-viewport and avoid horizontal overflow from the shell or chart rows.
- Motion staggered lists: apply only to activity rows on first render/filter change, 120-220ms stagger window, `cubic-bezier(.2,.8,.2,1)`, no motion under reduced motion.
- Feedback focus rings: all links, buttons, chips, and inputs use visible cyan rings with at least 2px offset.
- Data live activity: use a local interval to update timestamps, rotate one activity row, and refresh counters without layout shift.
- Filtering/search: derive visible rows from `activities` using selected chip and normalized query; update counts and empty state.
- Basic navigation: section links scroll to anchors and update active nav state without a router.
- Keep files compact; avoid base64 assets, screenshots, generated media, and large data dumps.

## Launch or Test Checklist
- Open locally with `start index.html` on Windows or by opening the file in a browser.
- Run `node verify_preset.mjs` from the output directory.
- Also run `node C:\VSCODE\comet-ai\comet-testing\live-workflow-presets\workflow-07-app-site-small-run-1-7-app-site-small-run-1-mpfavoat\verify_preset.mjs` from another current directory to prove `import.meta.url` base resolution.
- Verify all expected files are present and `preset_manifest.json` parses as JSON.
- Verify search changes the activity rows and shows the empty state when no rows match.
- Verify filter chips update visible rows and active styling.
- Verify live state changes without layout jump.
- Verify keyboard focus is visible on navigation, controls, and CTA buttons.
- Verify reduced-motion mode disables grid/list/live animations while retaining content.
- Verify desktop, tablet, and mobile layouts remain readable and do not overlap.

## Metadata and Launch Checklist
- `index.html` should include title, description, viewport, stylesheet link, and deferred script link.
- `preset_manifest.json` should include preset ID, run number, graph shape, node IDs, theme picker summary, and expected file list.
- `README.md` should name the preset, run number, graph shape, local open/run command, verifier command, and output files.
- `verify_preset.mjs` should resolve its base directory with `fileURLToPath(import.meta.url)` and validate expected files plus JSON syntax.
- Launch is file-based: no dev server is required for the static browser app.
