---
id: "neuform_procedural-mesh-network-background-txudfu"
title: "Procedural Mesh Network Background"
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
  url: "https://neuform.ai/skill/procedural-mesh-network-background-txudfu"
  originId: "procedural-mesh-network-background-txudfu"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Procedural Mesh Network Background

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

A meditative, dark blue procedural mesh gradient with technical overlays and reactive turbulence.

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

- Implement a full-bleed Three.js scene using a custom ShaderMaterial on a 2D plane geometry.
- Use procedural wave folding or CPPN logic to generate a fluid, warped mesh gradient in deep navy and cobalt.
- Map interaction variables like amplitude or progress to shader turbulence for reactive visual warping.
- Layer technical overlays including radial rings and structural calibration grids over the fluid shader.
- Apply a global radial vignette within the fragment shader to maintain central focus and edge blending.
- Integrate a slow, meditative 'breathing' pulse and orbital drift driven by a time uniform.
- Include an ambient scanline effect that moves vertically across the background field.
- Ensure the visual DNA remains retro-futurist with high-signal technical markers and sparse spacing.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
