---
id: "neuform_organic-aetherial-webgl-background-316jwq"
title: "Organic Aetherial WebGL Background"
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
  - "threejs"
  - "animation"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/organic-aetherial-webgl-background-316jwq"
  originId: "organic-aetherial-webgl-background-316jwq"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Organic Aetherial WebGL Background

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Technical retro-futurist Three.js background with noise-displaced organic geometry, iridescent Fresnel shaders, and scroll-synced depth.

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

- Recreate a full-bleed, technical WebGL background layer featuring a morphing organic entity. The effect uses noise-driven vertex displacement and iridescence to create a "synthetic flora" or "aetherial" aesthetic that feels meditative and high-end.
- **Scene:** Full-bleed background field with a dark, low-light atmosphere (#020202).
- **Subject:** A central or offset organic mesh (derived from a sphere) that feels liquid or biological.
- **Material:** High-contrast iridescence. Dark cores with luminous edges (greens, teals, and soft blues) driven by Fresnel logic.
- **Lighting:** Ambient-focused with fog for depth falloff; no hard directional shadows.
- WebGL & Three.js Technical Specs
- **Renderer:** `THREE.WebGLRenderer` with `antialias: true`, `alpha: true`, and `setPixelRatio` clamped to 2.
- **Camera:** `PerspectiveCamera` (FOV ~45) positioned at `z: 5` to allow for mesh volume.
- **Environment:** `THREE.Fog` matching the background color (#020202) with a tight range (e.g., 3 to 10) to pull the mesh into the darkness.
- **Geometry:** `SphereGeometry` with high segment density (128x128) to ensure smooth noise displacement.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
