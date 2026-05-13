---
id: "neuform_atmospheric-grain-webgl-background-y6jnkl"
title: "Atmospheric Grain WebGL Background"
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
  - "design system"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/atmospheric-grain-webgl-background-y6jnkl"
  originId: "atmospheric-grain-webgl-background-y6jnkl"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Atmospheric Grain WebGL Background

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

A technical, meditative background field using GLSL shaders for granular noise and morphing geometric primitives.

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

- Reconstruct a full-bleed atmospheric background using a fixed WebGL canvas with -z-10 index and pointer-events-none to prevent interaction interference.
- Visual DNA: Generate a dense, meditative particle field or grain texture using fragment-level randomization and a custom noise function in GLSL.
- Geometry: Implement raymarching within the fragment shader to render soft-edged geometric primitives such as anisotropic octahedrons that drift through the field.
- Color System: Use a dark earth-tone palette centered around #5C3822 and #2E3A2F, mapped via luminance and hue rotation matrices within the shader code.
- Technical Note: Use a tanh activation function or sigmoid mapping in the shader to normalize high-intensity color values for a soft, cinematic glow.
- Motion: Drive the scene with a slow, breathing pulse and rotational drift controlled by a u_time uniform and matrix transforms (wobble/rotation).
- Surface Material: Combine the grain effect with a soft depth fade and opacity layers (e.g., 40%) to ensure the background remains subtle and non-distracting.
- Rendering: Incorporate a luminance-based saturation boost and sepia-toned hue rotation to integrate the graphics with an organic, archival design aesthetic.
- Code pattern: <canvas id="bg-canvas" class="fixed top-0 left-0 w-screen h-screen -z-10 pointer-events-none opacity-40"></canvas> using uniform float u_time and vec2 u_resolution.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
