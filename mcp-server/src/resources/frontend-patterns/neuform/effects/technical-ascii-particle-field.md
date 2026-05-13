---
id: "neuform_technical-ascii-particle-field-2zi2vw"
title: "Technical ASCII Particle Field"
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
  url: "https://neuform.ai/skill/technical-ascii-particle-field-2zi2vw"
  originId: "technical-ascii-particle-field-2zi2vw"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Technical ASCII Particle Field

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Implementation of an atmospheric data-flow background featuring interactive ASCII nodes and upward kinetic beams using HTML5 Canvas.

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

- Create a technical, meditative background system using a Canvas-based particle field that combines slow-drifting ASCII characters with rapid upward-moving light beams.
- Visual System
- **Background:** Deep neutral dark (#030509).
- **Primary Accent:** Blue-400 (#60A5FA) used for glows, hover states, and beam heads.
- **Secondary Accent:** Gray-400 (#9CA3AF) for low-opacity background elements.
- **Primitives:** Single ASCII characters (0-9, A-Z, symbols) and vertical line segments with gradient tails.
- **Atmosphere:** High-contrast technical "command line" aesthetic with soft depth-of-field simulation via opacity and blur.
- Motion & Interaction
- **Upward Beams:** Rapid vertical movement (speed 3-9px/frame) with linear gradient tails fading to transparent.
- **Ambient Drift:** Nodes drift slowly (0.1-0.5px/frame) with subtle horizontal variance.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
