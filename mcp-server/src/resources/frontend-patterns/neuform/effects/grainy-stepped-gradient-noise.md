---
id: "neuform_grainy-stepped-gradient-noise-trdra9"
title: "Grainy Stepped Gradient Noise"
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
  url: "https://neuform.ai/skill/grainy-stepped-gradient-noise-trdra9"
  originId: "grainy-stepped-gradient-noise-trdra9"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Grainy Stepped Gradient Noise

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Technical WebGL background featuring an animated film-grain texture and column-based stepped gradients.

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

- Generate a high-fidelity, technical background using WebGL and Three.js.
- Recreate a "film grain" aesthetic combined with an animated, column-based gradient system.
- Visual System
- **Atmosphere:** Technical, meditative, and atmospheric with an intentional "low-fi" digital texture.
- **Surface:** A grainy background field that uses a custom fragment shader to simulate heavy film grain (intensity ~0.15).
- **Composition:** The background is divided into vertical columns (e.g., 11 bars) where gradient heights and colors transition across the x-axis.
- **Gradient Stops:** A vertical progression from dark tones at the base, through vibrant blues and pinks, reaching sand/off-white at the top.
- **Edges:** The top boundary of the gradient should read as a "stepped" or "jagged" horizon that subtly oscillates.
- Technical Setup
- **Stack:** Three.js with a `WebGLRenderer` (alpha: true).

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
