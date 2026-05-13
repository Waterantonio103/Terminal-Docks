---
id: "neuform_container-lines"
title: "Container Lines"
provider: "neuform"
patternKind: "layout_system"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Layout Systems"
  intensity: "balanced"
  technicalComplexity: "low_medium"
  requiresVisualQA: true
roles:
  - "frontend_designer"
  - "frontend_builder"
  - "visual_polish_reviewer"
categories:
  - "marketing_site"
  - "saas_dashboard"
  - "admin_internal_tool"
appliesTo:
  - "DESIGN.md"
  - "implementation"
  - "visual_review"
tags:
  - "layout"
  - "style"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/container-lines"
  originId: "container-lines"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Container Lines

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Add vertical container-size lines with mini corner squares.

## Use When

- The accepted DESIGN.md calls for this exact visual move or a close equivalent.
- A visual-first marketing or brand surface needs stronger art direction.
- The page needs a stronger composition pattern than repeated centered sections.

## Avoid When

- It conflicts with user-provided PRD.md, DESIGN.md, structure.md, screenshots, or brand rules.
- It would replace real product proof with decoration.
- It makes text, controls, or CTAs harder to read or use.
- The requested surface is a restrained dense product UI and this effect would add noise.

## Pattern Guidance

- Add vertical container-size lines with mini corner squares.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
