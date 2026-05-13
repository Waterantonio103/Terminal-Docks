---
id: "neuform_corner-diagonals"
title: "Corner Diagonals"
provider: "neuform"
patternKind: "motion_effect"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Motion Effects"
  intensity: "restrained"
  technicalComplexity: "medium"
  requiresVisualQA: true
roles:
  - "frontend_designer"
  - "frontend_builder"
  - "visual_polish_reviewer"
categories:
  - "marketing_site"
  - "saas_dashboard"
appliesTo:
  - "DESIGN.md"
  - "implementation"
  - "visual_review"
tags:
  - "layout"
  - "style"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/corner-diagonals"
  originId: "corner-diagonals"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Corner Diagonals

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Add diagonal cut corners to buttons and containers using chamfered silhouettes, clipped edges, and framed geometric shells.

## Use When

- The accepted DESIGN.md calls for this exact visual move or a close equivalent.
- A visual-first marketing or brand surface needs stronger art direction.
- Motion improves hierarchy, pacing, or atmosphere without hiding content.

## Avoid When

- It conflicts with user-provided PRD.md, DESIGN.md, structure.md, screenshots, or brand rules.
- It would replace real product proof with decoration.
- It makes text, controls, or CTAs harder to read or use.
- The project cannot support a reduced-motion fallback or visual QA pass.
- The requested surface is a restrained dense product UI and this effect would add noise.

## Pattern Guidance

- Corner Diagonals Skill
- Apply this only to buttons, cards, panels, and container shells that need diagonal-cut corners or chamfered edges.
- Use it when the design calls for precise geometric framing, sci-fi UI surfaces, or clipped-corner controls rather than rounded pills or plain rectangles.
- Visual target:
- Give buttons and framed containers diagonal corner cuts so they feel engineered, sharp, and intentional.
- Keep the cuts subtle and consistent: one or more corners can be chamfered, but the shape should still read cleanly at a glance.
- Use diagonal corners as a structural motif across multiple surfaces so the interface feels like a coherent system, not a one-off decorative trick.
- Implementation guidance:
- Prefer `clip-path: polygon(...)` or equivalent shape logic for the main silhouette when true diagonal corners are needed.
- For bordered shells, use wrapper layers, pseudo-elements, or gradient-border techniques so the outer frame follows the same diagonal geometry as the inner surface.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
