---
id: "neuform_atmospheric-ambient-ray-and-particle-system-3yx90f"
title: "Atmospheric Ambient Ray & Particle System"
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
  - "webgl"
  - "style"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/atmospheric-ambient-ray-and-particle-system-3yx90f"
  originId: "atmospheric-ambient-ray-and-particle-system-3yx90f"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Atmospheric Ambient Ray & Particle System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

A layered background system combining animated CSS gradient rays with a technical canvas-backed particle field.

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

- Generate a deep, atmospheric background system that uses layered CSS gradient "rays" and a subtle canvas particle field to create a meditative, technical environment.
- Visual System
- **Tone:** Dark, premium, and cinematic with high-contrast light accents.
- 1. **Base:** Solid dark hex (e.g., #050505).
- 2. **CSS Ambient Rays:** Large, blurred radial and linear gradients positioned off-screen to cast "light" across the viewport.
- 3. **Particle Field:** High-performance 2D canvas overlay with sparse, small particles (0.5px to 2px).
- 4. **Simulated Beams:** Rotated, high-blur linear gradients acting as fixed light shafts.
- **Color Palette:** Deep blues (#1D4ED8, #0A1B49), Indigo-400, and White overlays with low opacity (0.03 to 0.1).
- **Motion:** Asynchronous "breathing" pulses and sweeping rotations to avoid static compositions.
- Layout & Components

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
