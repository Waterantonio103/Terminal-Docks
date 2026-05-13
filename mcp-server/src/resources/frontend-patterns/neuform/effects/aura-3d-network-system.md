---
id: "neuform_aura-3d-network-system-i4oa3n"
title: "Aura 3D Network System"
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
  - "style"
  - "3d"
  - "animation"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/aura-3d-network-system-i4oa3n"
  originId: "aura-3d-network-system-i4oa3n"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Aura 3D Network System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Ethereal 3D network visualization with integrated glassmorphic data overlays and depth-aware animation.

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

- Generate an immersive "ethereal utility" visualization system featuring a central 3D network sphere (globe) rendered via Canvas 2D/WebGL, augmented by depth-aware floating data indicators and glassmorphic overlays.
- Visual System
- **Mood:** High-fidelity, data-centric, and atmospheric.
- **Atmosphere:** Deep-space backgrounds using dark radial gradients (#000000 to #18181b) with a central glowing "aura" behind the sphere.
- **Materiality:** High-translucency "glass" surfaces (bg-black/40, backdrop-blur-md) with ultra-thin borders (white/10).
- **Depth Logic:** Elements must feel spatially aware. Use alpha modulation and scale scaling based on Z-axis depth (z-norm) to simulate a focal plane.
- Globe Geometry & Rendering
- **Node Distribution:** Use spherical distribution (e.g., Fibonacci sphere algorithm) to place 100-150 nodes.
- **Connectivity:** Render lines between nodes based on a distance threshold. Line opacity should be a product of distance and the average depth of the two connected points.
- **Node Styling:** Small circular points with individual pulse animations (sine-wave driven size and opacity).

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
