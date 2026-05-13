---
id: frontend_build_craft
title: Frontend Build Craft
roles:
  - frontend_builder
  - frontend_architect
  - interaction_qa
categories:
  - marketing_site
  - admin_internal_tool
  - docs_portal
  - saas_dashboard
  - consumer_mobile_app
appliesTo:
  - implementation
  - responsive_behavior
  - interaction_states
source:
  name: "Impeccable; Designer Skills Collection"
  url: "https://github.com/pbakaus/impeccable; https://github.com/Owl-Listener/designer-skills"
  license: "Apache-2.0; MIT"
status: draft_review
---

# Frontend Build Craft

Use this skill when implementing a frontend experience from accepted specs. It should raise implementation quality without replacing the specs.

## Required Context

Before editing implementation files:

- Read accepted `PRD.md`.
- Read accepted `DESIGN.md`.
- Read accepted `structure.md` or accepted alias.
- Confirm required routes, sections, states, visual ingredients, and verification commands.
- In `strict_ui` mode, do not invent missing product, design, or structure decisions. Route back to intake/alignment.

The build must trace to the accepted specs. If the design file says the first viewport needs a ship silhouette, app screenshot, table, map, product object, media frame, or dense queue, the implementation must include that visible ingredient or explicitly record why it is omitted.

## Optional Pattern Library

If the accepted `DESIGN.md` names or clearly implies a specialized visual effect, consult `mcp-server/src/resources/frontend-patterns/neuform/index.json` and load only the matching pattern file.

Rules:

- Use at most 1 to 3 pattern files.
- Implement patterns only when they support accepted specs.
- Treat `effectPicker.technicalComplexity` as a risk signal: high-complexity effects require browser/screenshot verification and reduced-motion fallback.
- Do not add WebGL, 3D, parallax, heavy blur, or atmospheric backgrounds just because a pattern exists.
- Remove or simplify a pattern if it harms readability, performance, accessibility, or product clarity.

## Build In Passes

Do not try to polish by accident. Build in deliberate passes:

1. Semantic structure: landmarks, headings, sections, nav, controls, data, and copy.
2. Layout system: grids, content widths, responsive structure, section rhythm, panel relationships.
3. Visual system: colors, typography, radii, surfaces, borders, shadows, icons, media.
4. States: hover, focus-visible, active, disabled, loading, empty, error, success, selected.
5. Motion and media: transitions, reduced-motion behavior, image handling, video or canvas behavior.
6. Responsive pass: mobile, tablet or small laptop, desktop wide.
7. Browser critique and fix pass.

## Production Bar

The first implementation pass is not done until:

- Real or realistic content replaces lorem ipsum and scaffolding.
- The primary user path works.
- Navigation and CTAs have correct destinations.
- Interactive elements are real buttons, links, inputs, or semantic controls.
- Visual hierarchy matches `DESIGN.md`.
- The first viewport communicates the product/category without relying on body copy alone.
- Long text, short text, and mobile wrapping do not break the layout.
- There are no obvious console errors or broken asset paths.
- The project build or smallest relevant verification command passes when available.

## Visual Fidelity

Preserve the design's major visible ingredients.

Blocking downgrades:

- Replacing a required hero object with an abstract gradient.
- Replacing real product proof with generic cards.
- Changing the section sequence without a reason.
- Flattening distinct sections into identical panels.
- Dropping visible media or screenshots when the design depends on them.
- Using a different CTA hierarchy than the spec.
- Reducing a dense work surface into a sparse marketing layout.
- Turning a marketing surface into an app dashboard.

When exact assets are unavailable:

- Use generated bitmap assets if the workflow allows it.
- Use real stock/product imagery when appropriate and license-safe.
- Use code-native CSS/SVG/canvas scenes when they can credibly carry the subject.
- Use a clear placeholder only when the spec allows it, and make it visually intentional.

Do not rasterize core UI text. Text, nav, forms, buttons, and primary content must stay semantic and editable.

## Semantic Implementation

Use semantic HTML and framework-native patterns:

- One clear `h1`.
- Logical heading order.
- `header`, `main`, `section`, `nav`, `footer` where appropriate.
- Real labels for form controls.
- Buttons for actions, links for navigation.
- Useful alt text for meaningful images.
- Decorative visuals hidden from assistive tech.
- Accessible names for icon-only controls.
- No hover-only functionality.

## Layout Quality

Calibrate spacing and alignment deliberately:

- Use stable layout primitives: grid, flex, aspect-ratio, minmax, clamp for containers when appropriate.
- Do not rely on arbitrary margins to patch alignment.
- Avoid accidental whitespace cliffs between sections.
- Avoid text overlapping media or previous/next content.
- Do not allow buttons or pills to resize the surrounding layout on hover.
- Product UI should preserve dense scan paths.
- Brand pages should vary rhythm between immersive and structured sections.

Cards:

- Use cards for repeated items, modules, or framed content.
- Do not put cards inside cards.
- Do not make every section a floating card.
- If a row of cards is required, vary hierarchy through span, media, content, or section context rather than repeating the same tile forever.

## Typography Implementation

- Load only fonts that are actually used.
- Provide stable fallbacks.
- Use the exact tokens from `DESIGN.md`.
- Avoid viewport-width font sizing for ordinary UI.
- Tune line-height for dark backgrounds and dense product UI.
- Ensure long words, labels, and CTA text fit on mobile.
- Keep display type out of product labels, form controls, and dense data.

## Interaction States

Every interactive component should have visible states:

- Default.
- Hover where hover exists.
- Focus-visible.
- Active or pressed.
- Disabled when relevant.
- Loading when work is in progress.
- Error and success when user input or async work can fail or complete.
- Selected/current when navigation, rows, filters, tabs, or chips can be active.

Focus indicators must be visible over the actual background, including glows, images, dark panels, and busy media.

## Motion

Use motion as state communication or atmospheric support, not decoration.

- Avoid animating layout properties.
- Keep product UI transitions short.
- Disable nonessential motion under `prefers-reduced-motion`.
- Do not let entrance animations hide content needed for first understanding.
- Verify canvas, SVG, and CSS visual effects render nonblank in the browser.

## Responsive Behavior

Minimum review viewports:

- Mobile narrow.
- Tablet or small laptop.
- Desktop wide.

Check:

- First viewport still communicates the product/category.
- Primary CTA remains visible or quickly reachable.
- No text overlaps, clips, or overflows.
- Navigation works without hover.
- Tables either reflow intentionally or scroll with readable minimum widths.
- Media crops preserve the subject, not just atmosphere.
- Touch targets are comfortable.
- Spacing remains purposeful, not cramped or empty.

Choose the responsive strategy deliberately:

- Fluid: flexible widths within sensible min/max bounds.
- Adaptive: distinct layouts at meaningful breakpoints.
- Mobile-first: smallest layout is complete, larger layouts enhance.
- Content-first: breakpoints appear where content breaks, not only at standard device widths.

Input methods matter:

- Touch targets should be at least 44px when practical.
- Hover affordances need keyboard and touch equivalents.
- Focus order should follow visual order after responsive reflow.
- Responsive images need dimensions, useful crops, and appropriate loading behavior.

## Browser Critique Loop

Do not stop at terminal success.

After building:

- Open the page or app in a browser when possible.
- Inspect screenshots or rendered output, not just DOM.
- Write a short private critique against the specs.
- Patch material defects.
- Re-run the relevant build/test command.

Material defects include:

- Weak first viewport.
- Generic visual identity.
- Missing required asset or motif.
- Broken responsive layout.
- Hidden or unclear CTA.
- Inaccessible focus or contrast.
- Missing required states.
- Misaligned spacing or optical imbalance.

## Handoff

Completion should state:

- Files changed.
- Which accepted spec sections were implemented.
- Verification command run.
- Any known spec item not implemented and why.
- Browser/screenshot evidence if available in the workflow.
