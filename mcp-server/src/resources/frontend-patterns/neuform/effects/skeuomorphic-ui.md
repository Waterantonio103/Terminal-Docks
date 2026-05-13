---
id: "neuform_skeuomorphic-ui"
title: "Skeuomorphic UI"
provider: "neuform"
patternKind: "surface_style"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Surface and Material Effects"
  intensity: "restrained"
  technicalComplexity: "low_medium"
  requiresVisualQA: true
roles:
  - "frontend_designer"
  - "frontend_builder"
  - "visual_polish_reviewer"
categories:
  - "marketing_site"
  - "consumer_mobile_app"
appliesTo:
  - "DESIGN.md"
  - "implementation"
  - "visual_review"
tags:
  - "style"
  - "shadow"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/skeuomorphic-ui"
  originId: "skeuomorphic-ui"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Skeuomorphic UI

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a skeuomorphic surface style using layered gradients and shadows. Use soft vertical gradients (light top to darker bottom), multiple inset shadows to simulate carved or pressed surfaces, subtle outer shadows for elevation, fine highlights on top edges, darker lower edges, and rounded shapes with smooth transitions. Technique: stack inner and outer shadows to build depth, use micro-details like small dots or textures for realism, add gradient borders (1px wrapper) to simulate reflective edges, and use text shadows and icon shadows for an embossed feel.

## Use When

- The accepted DESIGN.md calls for this exact visual move or a close equivalent.
- A visual-first marketing or brand surface needs stronger art direction.
- The surface material should be a recognizable part of the design language.

## Avoid When

- It conflicts with user-provided PRD.md, DESIGN.md, structure.md, screenshots, or brand rules.
- It would replace real product proof with decoration.
- It makes text, controls, or CTAs harder to read or use.
- The requested surface is a restrained dense product UI and this effect would add noise.

## Pattern Guidance

- Create a skeuomorphic surface style using layered gradients and shadows.
- Use soft vertical gradients (light top to darker bottom), multiple inset shadows to simulate carved or pressed surfaces, subtle outer shadows for elevation, fine highlights on top edges, darker lower edges, and rounded shapes with smooth transitions.
- Technique: stack inner and outer shadows to build depth, use micro-details like small dots or textures for realism, add gradient borders (1px wrapper) to simulate reflective edges, and use text shadows and icon shadows for an embossed feel.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
