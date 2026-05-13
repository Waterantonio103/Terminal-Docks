---
id: "neuform_progressive-blur"
title: "Progressive Blur"
provider: "neuform"
patternKind: "surface_style"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Surface and Material Effects"
  intensity: "balanced"
  technicalComplexity: "low_medium"
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
  url: "https://neuform.ai/skill/progressive-blur"
  originId: "progressive-blur"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Progressive Blur

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Use layered edge blur overlays for depth, with top and bottom reference snippets plus tuning guidance.

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

- Progressive Blur Skill
- Confirm placement (top or bottom), height, and z-index relative to UI.
- Provide the matching snippet and a short usage checklist.
- Offer only targeted tweaks (height, blur steps, direction, opacity stops).
- Usage checklist:
- Insert the HTML inside <body>.
- Keep the .gradient-blur element near the top of the DOM.
- Ensure the background behind it exists (backdrop-filter blurs what is behind).
- Adjust z-index to sit above content but below modals.
- Treat the following code as reference samples and adapt them to the active output constraints when needed.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
