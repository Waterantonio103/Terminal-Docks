---
id: "neuform_dither-laser-dark-mode"
title: "Dither Laser Dark Mode"
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
  - "style"
  - "webgl"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/dither-laser-dark-mode"
  originId: "dither-laser-dark-mode"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Dither Laser Dark Mode

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a dark premium design system that combines near-black surfaces, subtle ordered-dither texture, and a thin accent-colored laser atmosphere.

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

- Dither Laser Dark Mode Skill
- Apply this as a full design-system direction across background, surfaces, panels, controls, spacing, borders, and motion.
- Use it when the interface should feel premium, technical, atmospheric, and dark, with a restrained laser motif and subtle dither texture.
- This is not just a background effect. The whole UI should feel unified around dark-mode depth, precise framing, and luminous accent restraint.
- Visual target:
- Build the interface on a near-black or charcoal foundation with premium dark surfaces layered above it.
- Introduce a subtle ordered-dither, coarse pixel, or soft digital grain texture in the background or low-priority surface layers so the darkness feels material instead of flat.
- Use a thin laser beam or scanning-line atmosphere as a focused visual motif, tinted with the design's primary or strongest accent color rather than a hardcoded blue.
- Keep the laser cinematic and restrained: a narrow white-hot core, soft accent halo, and light volumetric haze or bloom around it, not a thick neon bar.
- Pair the atmospheric background with crisp panels, glass-dark cards, muted strokes, border gradients, and selective glow so the UI feels like a polished command surface.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
