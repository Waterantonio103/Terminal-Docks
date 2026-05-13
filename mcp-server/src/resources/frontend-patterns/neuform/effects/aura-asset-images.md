---
id: "neuform_aura-asset-images"
title: "Aura Asset Images"
provider: "neuform"
patternKind: "layout_system"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Layout Systems"
  intensity: "expressive"
  technicalComplexity: "medium_high"
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
  - "asset"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/aura-asset-images"
  originId: "aura-asset-images"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Aura Asset Images

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Search Aura assets like Unsplash, curate 5 strong direct image URLs, and prefer higher-res variants when available.

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

- Aura Asset Images (Unsplash-style)
- Aura has a big searchable asset library at:
- Use it like Unsplash: search by tag, pick 5 strong candidates, and return direct image URLs.
- How to search (fast):
- Open: https://www.aura.build/assets
- Use the search box or URL query:
- Tags that work well: background, abstract, architecture, portrait, headshot
- URL formats (what to return):
- Return direct image URLs, not just asset page URLs.
- Aura thumbnails commonly look like:

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
