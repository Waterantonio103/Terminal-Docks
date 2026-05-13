---
id: "neuform_cyber-kinetic-background-field-3yguj9"
title: "Cyber Kinetic Background Field"
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
  - "animation"
  - "webgl"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/cyber-kinetic-background-field-3yguj9"
  originId: "cyber-kinetic-background-field-3yguj9"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Cyber Kinetic Background Field

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Procedural canvas background featuring perspective-based wavy lines and technical grid overlays for a cyber-security aesthetic.

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

- Generate a technical, meditative background system using a full-bleed canvas and CSS-pattern overlays to create a cyber-industrial atmosphere.
- Visual System
- **Atmosphere:** Dark, high-contrast monochrome with synthetic emerald accents.
- **Base Background:** Deep black (#030303).
- **Primary Accent:** Synthetic Emerald (#2EE496) at low opacity for kinetic elements.
- **Overlays:** Technical 40px square grid and tight diagonal scanning lines using low-opacity linear gradients.
- **Framing:** Fixed corner brackets (4x4 border segments) in neutral-700/50 to define the viewport boundaries.
- Layout & Components
- **Canvas:** Fixed `inset-0` with `z-index: 0` and `pointer-events-none`.
- **Grid Layer:** CSS `repeating-linear-gradient` for a 40px mesh and a 45-degree micro-diagonal pattern.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
