---
id: "neuform_atmospheric-webgl-field-system-8lvtag"
title: "Atmospheric WebGL Field System"
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
  - "style"
  - "webgl"
  - "shadow"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/atmospheric-webgl-field-system-8lvtag"
  originId: "atmospheric-webgl-field-system-8lvtag"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Atmospheric WebGL Field System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

An immersive background design system featuring interactive particle fields, breathing motion, and gradient-accented elevated UI components.

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

- *Composition:**
- **Layout:** grid
- **Content Width:** full-bleed
- **Framing:** open
- **Grid:** strong
- **Font Family:** Inter
- **Font Family Stack:** Inter, sans-serif
- **Font Class:** font-sans
- **Font Size:** 96px
- **Font Weight:** 400

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
