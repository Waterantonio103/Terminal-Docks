---
id: "neuform_globe-particles"
title: "Globe Particles"
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
  - "3d"
  - "webgl"
  - "threejs"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/globe-particles"
  originId: "globe-particles"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Globe Particles

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a 3D globe made from luminous particles, with a dense spherical core, orbital ring, additive glow, and subtle motion.

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

- Globe Particles Skill
- Apply this to a globe-like 3D particle visualization only, not to the full page layout, copy, or unrelated motion systems.
- Use it when the design needs a planetary, orbital, or synthesized data-globe effect rendered as particles.
- Visual target:
- Create a luminous particle globe with a dense spherical core of points and a thinner outer orbital ring or flattened disc surrounding it.
- Keep the center mostly neutral or white-hot, then use the design's primary color or strongest accent color for the outer ring, highlights, or glow instead of hardcoding a specific lime or neon hue.
- The silhouette should read clearly as a globe or planetary object with visible tilt, depth, and layered particle density.
- Keep it premium and atmospheric rather than playful: dark background, restrained glow, clean structure, and subtle sci-fi depth.
- Implementation guidance:
- Prefer real WebGL/Three.js particles using `THREE.Points`, `BufferGeometry`, and custom point shaders for circular luminous particles.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
