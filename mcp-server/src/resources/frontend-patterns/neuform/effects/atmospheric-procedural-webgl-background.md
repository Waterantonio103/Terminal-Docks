---
id: "neuform_atmospheric-procedural-webgl-background-2zumzs"
title: "Atmospheric Procedural WebGL Background"
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
  url: "https://neuform.ai/skill/atmospheric-procedural-webgl-background-2zumzs"
  originId: "atmospheric-procedural-webgl-background-2zumzs"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Atmospheric Procedural WebGL Background

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Technical shader-based background system featuring noise-driven organic glows, mouse-responsive parallax drift, and a dark meditative atmosphere.

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

- Create a high-performance, full-bleed interactive background using Three.js and custom GLSL shaders.
- Establish a technical, meditative, and atmospheric "Aura" aesthetic through procedural noise and light fields.
- **Atmosphere:** Deep dark-mode field with sparse, organic light emissions.
- **Color System:** Dark base (#050505) with high-intensity amber/orange core (#F97316) transitioning through deep reds into black.
- **Texture:** Procedural Simplex noise creating soft, smoky, or cloud-like light density.
- **Composition:** Radial light source typically centered or slightly offset to the bottom, reacting to viewport and pointer.
- WebGL & Shader Technicals
- **Renderer:** Three.js WebGLRenderer with alpha: true, anti-alias: false (for performance), and DPR clamping.
- **Camera:** Orthographic projection covering the full viewport (-1 to 1 bounds).
- **Material:** Custom `ShaderMaterial` using vertex and fragment shaders.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
