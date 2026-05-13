---
id: "neuform_atmospheric-laser-and-webgl-design-system-8ljti2"
title: "Atmospheric Laser & WebGL Design System"
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
  - "design system"
  - "webgl"
  - "animation"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/atmospheric-laser-and-webgl-design-system-8ljti2"
  originId: "atmospheric-laser-and-webgl-design-system-8ljti2"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Atmospheric Laser & WebGL Design System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Technical dark-mode aesthetic featuring high-fidelity WebGL laser backgrounds, halftone dithering, and tight grid-based typography.

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

- Generate a technical, meditative landing page characterized by a signature WebGL laser background, precision typography, and halftone-textured surfaces. The design should feel like a high-end terminal or futuristic archive.
- **Atmosphere:** Dark, technical, and atmospheric.
- **Surface:** Pure black backgrounds (#050505) layered with subtle 0.5px dot-grid patterns (radial-gradient, 6px spacing, 5% opacity).
- **Accents:** Neon Green (#22C55E) used for data points, UI labels, and the central WebGL feature.
- **Imagery:** Media should be treated with `mix-blend-luminosity` and wrapped in a "Gradient Border Shell" (0.75px padding, linear-gradient of greens) to create a hairline-thin glowing edge.
- WebGL Laser System
- **Core:** A high-precision vertical beam with an ultra-narrow white core (`exp(-abs(x) * 4000.0)`) and green exponential glows.
- **Volumetric Smoke:** Use Fractal Brownian Motion (FBM) to create tight, wispy smoke masks that cling to the laser beam.
- **Halftone Dither:** Implement a custom fragment shader pass that thresholds the light intensity into a sine-wave based dot matrix, particularly in the glow and smoke regions.
- **Motion:** A slow breathing pulse (sin wave on `u_time`) affecting glow intensity and smoke drift.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
