---
id: "neuform_technical-tactical-globe-ui-3zjv9a"
title: "Technical Tactical Globe UI"
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
  url: "https://neuform.ai/skill/technical-tactical-globe-ui-3zjv9a"
  originId: "technical-tactical-globe-ui-3zjv9a"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Technical Tactical Globe UI

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Sparse orthographic globe visualization with graticule lines, pulse-red data nodes, and technical framing brackets.

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

- Create a technical, high-contrast global visualization system using orthographic projections, sparse data point mapping, and architectural framing.
- **Aesthetic:** Tactical, sparse, high-fidelity data visualization.
- **Surface:** Deep charcoal/black backgrounds (#050505) with 1px hairline borders.
- **Accents:** High-saturation primary red (#FF0000) used strictly for data nodes and status indicators.
- **Framing:** Component-level "tactical brackets" (L-shaped corners) and premium gradient border shells (1px padding, subtle zinc-to-black transition).
- Component Anatomy: The Globe
- **Projection:** Orthographic (3D-sphere look on 2D plane).
- **Graticule:** Subtle grid lines at 20-degree intervals using `rgba(255,255,255,0.05)`.
- **Landmasses:** Outlines only; no solid fills. Use `rgba(255,255,255,0.15)` for coastal paths to maintain "blueprint" feel.
- **Data Nodes:** Sparse distribution of 1.5px circles in #FF0000. Nodes should represent a sampling of coordinates, not a solid fill.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
