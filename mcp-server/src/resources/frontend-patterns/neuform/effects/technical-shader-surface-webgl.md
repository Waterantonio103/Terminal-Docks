---
id: "neuform_technical-shader-surface-webgl-2zrur1"
title: "Technical Shader Surface (WebGL)"
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
  url: "https://neuform.ai/skill/technical-shader-surface-webgl-2zrur1"
  originId: "technical-shader-surface-webgl-2zrur1"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Technical Shader Surface (WebGL)

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Procedural deep-navy mesh gradient with technical overlays, meditative breathing motion, and shader-driven calibration grids.

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

- Generate a high-fidelity, meditative WebGL background layer using Three.js and custom GLSL shaders. The effect should read as a retro-futurist "technical fluid" with deep spatial depth and precision overlays.
- Visual System
- **Palette:** Deep Navy (#030712) base, Cobalt (#1e3a8a) mid-tones, and Electric Blue (#3b82f6) highlights.
- **Composition:** Procedural mesh gradient with organic wave folding and high-contrast technical overlays.
- **Atmosphere:** Dark, technical, and spatial.
- **Overlays:**
- **Calibration Grid:** Fine-line 30x30 grid with low opacity (0.06).
- **Radial Rings:** Sparse, pulsing concentric rings driven by distance from center.
- **Ambient Scanlines:** Rapid, subtle horizontal lines simulating a CRT or high-tech display.
- **Vignette:** Soft radial falloff to pure black at the edges.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
