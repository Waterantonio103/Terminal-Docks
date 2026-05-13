---
id: "neuform_background-grid-webgl"
title: "Background Grid WebGL"
provider: "neuform"
patternKind: "webgl_background"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Background Effects"
  intensity: "expressive"
  technicalComplexity: "high"
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
  - "webgl"
  - "threejs"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/background-grid-webgl"
  originId: "background-grid-webgl"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Background Grid WebGL

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a perspective WebGL background grid with fading lines, subtle particle haze, slow forward drift, and gentle camera parallax.

## Use When

- The accepted DESIGN.md calls for this exact visual move or a close equivalent.
- A visual-first marketing or brand surface needs stronger art direction.
- The project can support canvas/WebGL implementation and reduced-motion fallback.

## Avoid When

- It conflicts with user-provided PRD.md, DESIGN.md, structure.md, screenshots, or brand rules.
- It would replace real product proof with decoration.
- It makes text, controls, or CTAs harder to read or use.
- The project cannot support a reduced-motion fallback or visual QA pass.
- The requested surface is a restrained dense product UI and this effect would add noise.

## Pattern Guidance

- Background Grid WebGL Skill
- Apply this only to the immersive background grid layer, not to the full page layout, copy, or unrelated particle or laser systems.
- Use it when the design needs a perspective tech grid receding into space with subtle motion and depth.
- Visual target:
- Create a large perspective ground-plane grid viewed from an elevated camera angle so the lines recede toward the horizon.
- Keep the grid understated and atmospheric: thin lines, soft fade with distance, dark background, and restrained glow rather than a loud retro neon floor.
- Add a light field of floating particles or dust to give the scene depth without overpowering the grid.
- Use the design's primary color or strongest accent color sparingly for glow, particles, or secondary emphasis. If the design is neutral, a white or cool gray grid is acceptable.
- Implementation guidance:
- Prefer Three.js or equivalent real WebGL rendering for this effect.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
