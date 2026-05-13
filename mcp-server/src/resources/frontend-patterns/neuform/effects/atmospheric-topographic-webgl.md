---
id: "neuform_atmospheric-topographic-webgl-u55nmy"
title: "Atmospheric Topographic WebGL"
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
  url: "https://neuform.ai/skill/atmospheric-topographic-webgl-u55nmy"
  originId: "atmospheric-topographic-webgl-u55nmy"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Atmospheric Topographic WebGL

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Meditative noise-driven shader background featuring sharp topographic light ridges and deep atmospheric layering.

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

- Create a technically sophisticated, meditative background layer using WebGL shaders. The effect should simulate flowing topographic ridges or abstract noise fields that provide depth and motion without distracting from foreground content.
- Visual System
- **Abstract Geometry:** Organic, flowing lines derived from 2D noise fields (Simplex or Perlin).
- **Ridge Treatment:** High-frequency "ridges" created by sharpening noise values using periodic functions and power exponents.
- **Atmospheric Depth:** Multi-layered color mixing with a strong vignette to focus attention on the center or specific content areas.
- **Blending:** Use screen or overlay mix-modes to allow the background texture to interact with underlying surface colors.
- Layout & Integration
- **Container:** `absolute inset-0` with `pointer-events-none` and `z-index: 0`.
- **Sizing:** Dynamic resize handling that syncs canvas resolution to parent container dimensions.
- **Opacity:** High opacity (80-90%) but utilizing `mix-blend-screen` or `mix-blend-lighten` for seamless integration.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
