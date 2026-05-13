---
id: "neuform_technical-terminal-and-webgl-grid-system-v9lmbm"
title: "Technical Terminal & WebGL Grid System"
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
  - "saas_dashboard"
appliesTo:
  - "DESIGN.md"
  - "implementation"
  - "visual_review"
tags:
  - "design system"
  - "layout"
  - "webgl"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/technical-terminal-and-webgl-grid-system-v9lmbm"
  originId: "technical-terminal-and-webgl-grid-system-v9lmbm"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Technical Terminal & WebGL Grid System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

A high-precision industrial design system featuring infinite grid lines, terminal-style shaders, and masked GSAP typography.

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

- High-precision industrial aesthetic using a technical grayscale palette centered on #050507 and #FFFFFF.
- Structural layout defined by infinite vertical 1px lines extending 100vh beyond the container boundaries.
- Visual DNA includes 6px square corner nodes with neutral-300 borders and thin 16px frame brackets at container vertices.
- Central card implementation uses a 2.3:1 aspect ratio with a deep multi-layered shadow stack and an inset 1px border glow.
- Typography uses Inter: Headings at 300 weight with -0.025em tracking; labels at 12px 500 weight, uppercase, 0.15em tracking.
- Motion system features a GSAP-driven masked word reveal, animating translateY from 100% to 0% with power4.out easing.
- WebGL background layer utilizing a fragment shader for a dot-matrix pattern with radial symmetry and a slow breathing pulse.
- Shader-based post-processing effects including barrel curvature (0.2), digital scanlines, and randomized flicker/glitch logic.
- Interactive pointer drift affecting shader variables (uMouse) to create subtle parallax within the WebGL field.
- Code pattern: .container { position: relative; max-width: 1100px; } .v-line { position: absolute; top: -100vh; bottom: -100vh; width: 1px; background: rgba(0,0,0,0.1); } .node { position: absolute; width: 6px; height: 6px; background: white; border: 1px solid #d4d4d4; z-index: 20; }

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
