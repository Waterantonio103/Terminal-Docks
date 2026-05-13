---
id: "neuform_dither-background"
title: "Dither Background"
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
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/dither-background"
  originId: "dither-background"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Dither Background

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Generate a dark ordered-dither background with coarse square pixels and soft wave falloff.

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

- Dither Background Skill
- Visual target:
- Create a dark monochrome procedural background made of enlarged square pixels with a visible Bayer-style dither matrix.
- Keep the palette restrained: near-black base, charcoal midtones, soft gray build-up, and occasional white highlights only.
- Shape the field into broad organic waves or cloud-like masses so it feels designed, not like random TV noise.
- Implementation guidance:
- Prefer a real canvas or WebGL shader background when motion or depth is needed.
- Quantize brightness through a 4x4 Bayer matrix or equivalent ordered dithering logic.
- Enlarge the dither cells so the square pattern is clearly legible from a distance.
- Add a vignette or falloff so the edges recede into black and the brighter mass sits more centrally or off-axis.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
