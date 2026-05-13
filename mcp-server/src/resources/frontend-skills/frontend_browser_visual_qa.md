---
id: frontend_browser_visual_qa
title: Frontend Browser Visual QA
roles:
  - interaction_qa
  - accessibility_reviewer
  - visual_polish_reviewer
  - frontend_builder
categories:
  - marketing_site
  - admin_internal_tool
  - docs_portal
  - saas_dashboard
  - consumer_mobile_app
appliesTo:
  - visual_review
  - responsive_behavior
  - accessibility_review
  - implementation
status: draft_review
---

# Frontend Browser Visual QA

Use this skill when verifying frontend work in a real browser or rendered preview. Terminal success is not enough for UI work.

## Minimum Evidence

When feasible, collect:

- Desktop screenshot, around 1440x900.
- Mobile screenshot, around 390x844.
- Focus-state check.
- Reduced-motion check when animation exists.
- Build/test command result.

If browser evidence cannot be collected, say so explicitly and treat visual confidence as limited.

## First Viewport Check

For marketing or brand pages:

- Product/brand/category is obvious.
- Primary CTA is visible and dominant.
- Secondary CTA is clear but quieter.
- Required hero media, product object, screenshot, or scene is visible.
- Next section hint is visible when the page is scroll-based.
- Text is readable over media/effects.

For product UI:

- User lands in the working surface.
- Primary entities and state are visible.
- Main controls are reachable.
- Density matches the task.
- The UI does not look like a generic landing page.

## Responsive Check

Inspect at least mobile and desktop.

Block for:

- Text overlap.
- Clipped headings or buttons.
- Incoherent media crop.
- CTA below fold when the spec requires above-fold access.
- Horizontal overflow not intentionally used for tables.
- Fixed-height sections with blank or clipped content.
- Sticky header covering anchors or content.
- Touch targets that are too small.

Responsive behavior must preserve the concept. Do not accept a mobile view that removes all meaningful visual proof or product context.

## Visual Fidelity Check

Compare against accepted `DESIGN.md`:

- Colors match intended roles.
- Typography scale and tone match.
- Spacing rhythm is recognizable.
- Component recipes survived into code.
- Required visual ingredients are present.
- Pattern-library effects, if selected, are implemented with guardrails.

Block when a required visual ingredient was replaced by a generic gradient, placeholder card, or vague icon.

## Interaction State Check

Verify:

- Hover where applicable.
- Focus-visible.
- Active/pressed.
- Disabled.
- Loading.
- Error.
- Success.
- Empty.
- Selected/current.
- Mobile/touch alternative for hover-only controls.

Not every page needs every state, but every interactive pattern needs the states relevant to its behavior.

## Accessibility Check

At minimum:

- Keyboard can reach interactive controls.
- Focus ring is visible on the real background.
- Interactive controls have accessible names.
- Form controls have labels.
- Important imagery has useful alt text.
- Decorative effects are hidden from assistive tech.
- Color is not the only status signal.
- Motion respects `prefers-reduced-motion` when nontrivial.

## Asset and Effect Check

For images, canvas, SVG, video, and WebGL:

- Asset loads successfully.
- Subject is visible after crop.
- Text does not sit on busy imagery without a veil.
- Canvas/WebGL is nonblank.
- Effects do not block clicks, scrolling, or focus.
- Reduced-motion fallback is present.
- Performance feels acceptable on ordinary hardware.

## Fix Pass

If any material visual defect exists:

- Request or perform a fix pass.
- Re-check the affected viewport.
- Re-run the smallest relevant build/test command.

Do not approve with “looks mostly fine” when the first viewport, CTA, responsive layout, accessibility, or required design ingredient is materially wrong.

## Report Format

Use concise evidence:

```text
Checked:
- Desktop 1440x900
- Mobile 390x844
- Keyboard focus
- Reduced motion
- npm run build

Findings:
- Fix required: ...
```

If clean:

```text
No material visual, responsive, or accessibility blockers found. Remaining risk: ...
```
