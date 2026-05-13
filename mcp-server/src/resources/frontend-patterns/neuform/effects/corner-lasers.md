---
id: "neuform_corner-lasers"
title: "Corner Lasers"
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
appliesTo:
  - "DESIGN.md"
  - "implementation"
  - "visual_review"
tags:
  - "webgl"
  - "animation"
  - "style"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/corner-lasers"
  originId: "corner-lasers"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Corner Lasers

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a corner-anchored laser composition with thin beams, a bright emitter node, bloom, and atmospheric glow or fog.

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

- Corner Lasers Skill
- Apply this only to corner-based laser beam compositions, not to generic centered lasers, particle scenes, or unrelated motion systems.
- Use it when the design needs beams that originate from or converge at a corner or edge junction, with a strong cinematic emitter point.
- Visual target:
- Create two or three thin laser beams that meet at a bright corner emitter, then extend outward along different directions like a geometric room corner or portal seam.
- Keep the beam lines narrow and sharp with a white-hot center, a restrained halo, and strong bloom concentrated around the corner junction.
- Let the surrounding atmosphere glow softly from the emitter so the corner feels illuminated by volumetric haze rather than flat lines on a dark background.
- Use the design's primary color or strongest accent color for the halo and atmospheric tint instead of hardcoding blue, while keeping the brightest beam core near white.
- Implementation guidance:
- Prefer raw WebGL shader treatment or equivalent effect logic when the output supports it.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
