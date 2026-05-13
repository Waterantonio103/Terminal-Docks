---
id: "neuform_d3-interactive-point-cloud-globe-3zkwpn"
title: "D3 Interactive Point-Cloud Globe"
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
  - "animation"
  - "3d"
  - "design system"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/d3-interactive-point-cloud-globe-3zkwpn"
  originId: "d3-interactive-point-cloud-globe-3zkwpn"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# D3 Interactive Point-Cloud Globe

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Technical implementation of a canvas-based interactive globe using orthographic projection and point-cloud landmasses.

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

- Create a high-fidelity, interactive 3D globe visualization rendered to a 2D canvas using orthographic projection and a point-cloud aesthetic.
- Visual System
- **Projection:** Orthographic (`d3.geoOrthographic`) with a 90-degree clip angle to hide the back-face.
- **Landmass Rendering:** Rendered as a dense grid of discrete dots (point cloud) rather than solid polygons.
- **Atmosphere:** A single-pixel circular stroke defining the earth's silhouette.
- **Graticule:** Subtle longitudinal and latitudinal grid lines rendered behind landmasses.
- **Depth Cues:** Implement a radial glow background behind the canvas (`bg-[#ef233c]/20` with `blur-[100px]`) to create a "halo" effect.
- Layout & Components
- **Container:** Full-bleed or fixed-aspect ratio container (`aspect-square`) with `cursor-grab`.
- **Overlay Labels:** Monospace instructional text (e.g., "DRAG TO ROTATE") centered at the bottom using `tracking-widest`.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
