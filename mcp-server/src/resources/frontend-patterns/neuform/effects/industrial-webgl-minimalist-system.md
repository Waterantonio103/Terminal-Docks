---
id: "neuform_industrial-webgl-minimalist-system-v9b1kp"
title: "Industrial WebGL Minimalist System"
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
  - "threejs"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/industrial-webgl-minimalist-system-v9b1kp"
  originId: "industrial-webgl-minimalist-system-v9b1kp"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Industrial WebGL Minimalist System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Monochromatic high-contrast aesthetic combining rigid architectural grids with fluid, shader-displaced geometric backgrounds.

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

- Visual DNA: Industrial minimalism characterized by monochromatic high-contrast, 1px architectural lines, and rigid geometry.
- Layout: Full-bleed vertical strokes at container edges anchored by 1.5px square corner nodes with 1px borders.
- Surface: Elevated dark-mode cards (#050507) featuring heavy multi-layered shadows with up to 100px blur for a floating effect.
- Typography: Technical Inter stack; headings at 300 weight with -0.025em tracking; labels in 12px uppercase with 0.15em letter-spacing.
- WebGL Scene: Three.js implementation with a 30-degree FOV perspective camera and ambient plus directional lighting.
- Geometry: Custom BufferGeometry generating stacked vertical planes displaced via cnoise/Perlin vertex shaders.
- Materials: Low-reflectivity MeshStandardMaterial (0.3 metalness/roughness) with fragment shader grain and dithering for texture.
- Motion: GSAP-driven staggered text reveals where words translate vertically from overflow-hidden containers on ScrollTrigger.
- UI Layers: Glass-like transparency using white alpha overlays (5% to 70%) to create depth and light-bleed effects.
- Interaction: WebGL motion should reflect a slow, breathing pulse or subtle pointer-reactive drift without breaking the technical grid.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
