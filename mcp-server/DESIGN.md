---
title: DockPulse Design Specification
ownerNode: frontend_designer
missionId: live-workflow-presets-1-app-site-expanded-run-2-mpen9yvd
category: marketing_site
status: accepted
---

# Design Specification

## Overview
- Product: DockPulse.
- Page type: single-page static marketing app with embedded release-readiness interaction.
- Design intent: calm operational confidence, quick scanning, and visible release risk feedback.
- Primary audience: product, engineering, QA, and operations leads preparing a small software release.
- Visual tone: precise, steady, modern, and work-focused.
- The design must feel like a useful command page, not a generic SaaS hero or decorative landing page.
- First viewport must make DockPulse the dominant brand signal and expose part of the readiness workflow below the fold.
- The interaction surface should look production-grade enough to prove the app behavior without implying real integrations.
- Use only local HTML, CSS, and JavaScript; no external fonts, media, icon services, or tracking.

## Design Tokens
- Token naming should map directly to CSS custom properties in `:root`.
- `--color-ink: #17211d` for primary text.
- `--color-muted: #5d6b63` for secondary text.
- `--color-canvas: #f7f5ef` for page background.
- `--color-panel: #ffffff` for raised panels.
- `--color-line: #d9ded5` for borders and separators.
- `--color-primary: #16624f` for primary actions and strong active states.
- `--color-primary-hover: #0f4f40` for hover and pressed primary actions.
- `--color-accent: #d9872b` for score emphasis, warnings, and small highlights.
- `--color-accent-soft: #fff0d9` for warning chips and score backgrounds.
- `--color-success: #287a4d` for ready states.
- `--color-risk: #b54b3f` for blocker states.
- `--shadow-soft: 0 18px 45px rgba(23, 33, 29, 0.12)`.
- `--shadow-small: 0 8px 20px rgba(23, 33, 29, 0.08)`.
- `--radius-sm: 6px`.
- `--radius-md: 8px`.
- `--radius-lg: 14px` only for the main interactive panel and no larger.
- `--max-page: 1120px`.
- `--focus-ring: 0 0 0 3px rgba(22, 98, 79, 0.28)`.

## Colors
- Use a balanced palette: warm off-white canvas, deep green primary, amber emphasis, and neutral ink.
- Avoid a one-hue green-only interface by using amber only for limited score and warning moments.
- Body text must use `#17211d` on light backgrounds.
- Secondary text must maintain contrast and avoid pale gray.
- Primary buttons use green fill with white text.
- Secondary buttons use transparent or white fill with green text and border.
- Alert or blocker rows may use subtle amber or red accents, but never color alone to explain state.
- Section backgrounds should alternate between canvas and white bands, not stacked cards.
- Cards are reserved for repeated feature/proof items and the embedded app panel.

## Typography
- Font stack: system UI, `Segoe UI`, Roboto, Helvetica, Arial, sans-serif.
- H1: 52px desktop, 40px tablet, 34px mobile; line-height 1.02; font-weight 760.
- H2: 34px desktop, 30px tablet, 26px mobile; line-height 1.12; font-weight 720.
- H3: 20px; line-height 1.25; font-weight 700.
- Body: 16px; line-height 1.6; font-weight 400.
- Small labels: 13px; line-height 1.35; font-weight 700; text-transform uppercase only for compact metadata labels.
- Button text: 15px; line-height 1; font-weight 700.
- Do not use negative letter spacing.
- Do not scale typography with viewport units.
- Keep paragraphs under roughly 80 characters where possible.

## Layout
- Use one route: a single `index.html` page with anchored sections.
- Global wrapper max width is `1120px` with `24px` side padding desktop and `18px` mobile.
- Header is simple and sticky only if it does not cover section anchors; otherwise keep it static.
- Hero uses a two-column desktop grid: copy on the left, interactive readiness summary on the right.
- Mobile hero stacks copy first, then the summary panel.
- First viewport should include the hero and reveal the top of the checklist/proof section below.
- Avoid split marketing layouts with decorative empty media cards.
- The main visual asset is the generated-in-HTML readiness panel, using real app controls as the visual.
- Use full-width sections with constrained inner content; do not nest page sections inside cards.
- Recommended vertical rhythm: 72px desktop section padding, 48px tablet, 36px mobile.

## Spacing
- Base spacing unit: 4px.
- Use 8px gaps inside compact controls.
- Use 12px gaps between labels and values.
- Use 16px gaps inside card and checklist rows.
- Use 24px gaps between component groups.
- Use 32px gaps for grid columns and major content groups.
- Use 48px between section header blocks and content grids.
- Button padding: `14px 18px` desktop and `13px 16px` mobile.
- Card padding: 22px desktop and 18px mobile.
- Checklist row padding: 14px 16px.

## Elevation and Depth
- Keep depth quiet and functional.
- Hero app panel may use `--shadow-soft`.
- Repeated cards may use `--shadow-small` or a 1px border, not both heavily.
- Header may use a bottom border but should avoid heavy shadow.
- Hover states can lift cards by 2px only if reduced motion is respected.
- No gradient orb, bokeh, or unrelated abstract background decoration.

## Shapes
- Default radius is 8px or less.
- Use 6px radius for buttons, inputs, chips, and checklist rows.
- Use 8px radius for feature cards and proof cards.
- Use 14px radius only on the primary readiness panel to distinguish it as the product surface.
- Use circular indicators only for small status dots or checklist controls.
- Avoid pill-heavy layouts; chips should be compact and meaningful.

## Components
- Header: wordmark `DockPulse`, three text links, and one compact primary CTA.
- Hero copy: eyebrow, H1 naming DockPulse, focused value copy, primary CTA, secondary anchor link.
- Readiness summary panel: score, release phase selector, key risk status, and three mini metrics.
- Checklist module: 5 to 6 toggleable rows with label, category, and impact text.
- Focus selector: segmented control for `Launch`, `Support`, and `Handoff` or equivalent release phases.
- Feature cards: three cards for readiness score, priority focus, and team handoff.
- Proof section: concise evidence-style statements about signals, blockers, and go/no-go clarity.
- Final CTA: short copy plus button to return to or activate the readiness check.
- Buttons must show hover, active, and focus states.
- Checklist controls must show checked, unchecked, focus, and changed score states.
- Score state labels should include words such as `Ready`, `Watch`, or `Blocked` alongside numeric score.

## Iconography
- Use text, status dots, checkmarks, and simple CSS shapes only.
- No external icon font or SVG sprite is required.
- Checkmarks should be implemented as accessible checkbox states or lightweight inline characters.
- Status dots must be paired with text labels.
- Navigation and CTA labels should be textual because commands are few and clear.

## Motion
- Use motion sparingly for state feedback.
- Score changes may animate with a 160ms transform or color transition.
- Checklist rows may transition background and border color over 160ms.
- Anchor navigation may use smooth scroll only when `prefers-reduced-motion` allows it.
- Disable non-essential transitions in `@media (prefers-reduced-motion: reduce)`.
- No looping animation is needed.

## Responsive Behavior
- Desktop: hero two-column grid with the app panel at about 42 percent width.
- Tablet: keep two columns if width allows; reduce gaps and H1 size.
- Mobile: stack all grids to one column, keep CTAs visible, and use full-width buttons only where space demands it.
- Header links may wrap or collapse to a second row; do not implement a complex menu for this compact app.
- Checklist rows must keep controls tappable at 44px minimum height.
- Score panel metrics should become a two-column or stacked grid on small screens.
- No text may overlap cards, controls, or the viewport edge.

## Do's and Don'ts
- Do make the app panel the main visual proof in the hero.
- Do keep copy specific to release readiness, blocker visibility, and handoff quality.
- Do use exact tokens so downstream CSS is deterministic.
- Do keep the first viewport scannable and action-oriented.
- Do not use generic productivity claims or fake customer metrics.
- Do not add screenshots, large images, remote assets, analytics, or build tooling.
- Do not turn the page into a dense dashboard; it is a marketing app with one focused interaction.
- Do not overuse amber or red; reserve them for risk and score emphasis.

## Accessibility Notes
- Use semantic `header`, `main`, `section`, and `footer` landmarks.
- Every button and control must have a clear accessible name.
- Real checkboxes are preferred for checklist toggles.
- Visible focus states must use the focus ring token.
- Score changes must update visible text and should be placed in an `aria-live="polite"` region if practical.
- Contrast target is WCAG AA for all text and controls.
- Do not rely on color alone for ready, watch, or blocked states.
- Touch targets must be at least 44px tall for primary controls.

## Builder Handoff
- Build the page with `index.html`, `styles.css`, and `app.js` only.
- Keep all assets local and generated with HTML/CSS; no image files are required for this design.
- Implement CSS variables from this file at the top of `styles.css`.
- Use a static data array in `app.js` for checklist items and focus-phase copy.
- Compute readiness score from checked items and render the numeric score plus state label.
- Primary CTA should scroll to or activate the readiness checklist.
- Secondary CTA should scroll to proof content.
- Include HTML title and meta description aligned to DockPulse release readiness.
- Preserve PRD requirements and leave route architecture details for `structure.md`.
