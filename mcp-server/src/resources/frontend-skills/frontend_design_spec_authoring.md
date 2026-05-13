---
id: frontend_design_spec_authoring
title: Frontend Design Spec Authoring
roles:
  - frontend_designer
  - frontend_product
  - frontend_architect
  - visual_polish_reviewer
categories:
  - marketing_site
  - admin_internal_tool
  - docs_portal
  - saas_dashboard
  - consumer_mobile_app
appliesTo:
  - DESIGN.md
  - spec_intake
  - visual_review
status: draft_review
---

# Frontend Design Spec Authoring

Use this skill when creating, patching, or reviewing `DESIGN.md`. The goal is to produce a builder-enforceable visual source of truth, not a mood board.

## Source Order

Before writing:

- Prefer user-provided screenshots, brand files, existing `DESIGN.md`, style guides, and live reference pages.
- Use `PRD.md` for product intent and audience.
- Use `structure.md` for routes, sections, components, and data shape.
- Use repository code only to detect existing design tokens and implementation constraints.
- If facts conflict, prefer current code and user-provided visual artifacts over stale roadmap text.

Do not invent a new visual system when a strong one already exists.

## Required Shape

`DESIGN.md` should feel like an extracted design system even when it is newly generated.

It must include:

- Structured frontmatter or a machine-readable token block.
- Exact colors with roles.
- Exact typography tokens.
- Exact spacing, radius, content-width, and layout rules.
- Exact component recipes.
- State recipes for interaction and async UI.
- Responsive behavior.
- Asset/media requirements.
- Do and don't rules.
- Builder handoff.

Do not write a loose document that only says “cinematic,” “premium,” “modern,” or “clean.”

## Token Requirements

Define exact values:

- Colors: primary, secondary, tertiary, neutral, background, surface, raised surface, text primary, text secondary, border, accent, success, warning, danger.
- Typography: display, heading, body, label, and mono where relevant. Include family, size, weight, line-height, letter-spacing, and case.
- Radius: small, medium, large, full, plus any special structural radii.
- Spacing: base unit, common gaps, card padding, section padding, content max width, layout gutters.
- Effects: borders, shadows, blur, overlay opacity, gradients, texture, focus rings.

Every token should have a job. Remove decorative tokens that do not map to implementation.

## Component Recipes

For each relevant component, specify:

- Visual role.
- Default state.
- Hover state.
- Focus-visible state.
- Active/pressed state.
- Disabled state.
- Loading, empty, error, success, selected, stale, or current states where relevant.
- Responsive behavior.

Common components:

- Header/nav.
- Primary and secondary buttons.
- Cards/surfaces.
- Hero/media.
- Forms.
- Tables/lists/queues.
- Tabs/filters/chips.
- Charts/proof strips.
- Modals/drawers only when required.

## Reference Extraction

When deriving from a reference:

- Extract structure, not brand identity unless the user owns or explicitly wants that identity.
- Capture exact measurable traits: layout type, spacing rhythm, radius family, type scale, surface materials, shadows, and motion.
- Describe how the system behaves, not just what it looks like.
- Avoid copying names, logos, copy, proprietary assets, or distinctive protected brand elements.

Good extraction:

```text
Uses a full-bleed dark editorial grid, cream accent, thin glass border shell, serif display type, compact sans labels, and restrained 4px spacing rhythm.
```

Bad extraction:

```text
Make it look like [reference brand].
```

## Generated Design Rules

When no visual source exists:

- Choose a visual system that supports the product's audience and task.
- Make one or two strong choices; do not combine every attractive style.
- Use exact values immediately.
- Include negative constraints to prevent drift.
- Specify required first-viewport visual proof.
- Specify the asset strategy: real screenshot, generated bitmap, stock photo, CSS/SVG/canvas scene, iconographic system, or no media.

## Builder Handoff

End with a concrete handoff:

- Required visible ingredients.
- Required components and states.
- Required responsive checks.
- Pattern resources selected, if any.
- Things the builder must not simplify away.

Example:

```text
Builder must preserve the full-bleed hero, product screenshot cluster, muted graphite palette, amber action color, 12-column grid, sticky glass header, compact proof strip, and focus-visible ring recipes.
```

## Review Checklist

Reject or patch `DESIGN.md` when:

- It lacks exact token values.
- It lacks component recipes.
- It lacks first-viewport composition.
- It uses generic style words without implementation details.
- It contradicts `PRD.md` or `structure.md`.
- It would let three builders produce three unrelated pages.
- It accepts a reference style without extracting reusable rules.
