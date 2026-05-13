---
id: "neuform_chromatic-dispersion-webgl-system-40mkq2"
title: "Chromatic Dispersion WebGL System"
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
  url: "https://neuform.ai/skill/chromatic-dispersion-webgl-system-40mkq2"
  originId: "chromatic-dispersion-webgl-system-40mkq2"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Chromatic Dispersion WebGL System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Generative background system featuring warped light bands with chromatic aberration, noise overlays, and interactive shader parameters.

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

- Generate a high-fidelity, technical background field using WebGL and CSS layering. The system produces generative "chromatic dispersion" bands that feel meditative, retro-futurist, and precision-engineered.
- **Atmosphere:** Dark, technical, scientific telemetry.
- **Base Color:** Deep black (#000000) or near-black (#030305).
- **Core Visual:** Fluid, warped bands of light with distinct RGB color separation (chromatic aberration).
- **Surface Texture:** Layered composite of grain noise, diagonal hairline grids, and atmospheric gradients.
- Technical Layering Stack
- Implement the background as a fixed stack of layers to ensure depth and readability:
- 1. **Base:** Canvas element for Three.js/WebGL rendering.
- 2. **Layer 1 (Geometry):** Diagonal hairline grid using `repeating-linear-gradient(45deg, ...)` at low opacity (approx. 20%).
- 3. **Layer 2 (Texture):** SVG fractal noise filter applied via `mix-blend-overlay` at very low opacity (approx. 8%) to provide cinematic grain.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
