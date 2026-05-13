---
id: "neuform_agency-grid-layout-minimal"
title: "Agency Grid Layout Minimal"
provider: "neuform"
patternKind: "motion_effect"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Motion Effects"
  intensity: "expressive"
  technicalComplexity: "medium"
  requiresVisualQA: true
roles:
  - "frontend_designer"
  - "frontend_builder"
  - "visual_polish_reviewer"
categories:
  - "marketing_site"
  - "saas_dashboard"
  - "docs_portal"
appliesTo:
  - "DESIGN.md"
  - "implementation"
  - "visual_review"
tags:
  - "design system"
  - "layout"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/agency-grid-layout-minimal"
  originId: "agency-grid-layout-minimal"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Agency Grid Layout Minimal

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a minimal agency design system with a disciplined editorial grid, oversized typography, quiet uppercase utility labels, restrained image blocks, and subtle structural detail.

## Use When

- The accepted DESIGN.md calls for this exact visual move or a close equivalent.
- A visual-first marketing or brand surface needs stronger art direction.
- Motion improves hierarchy, pacing, or atmosphere without hiding content.

## Avoid When

- It conflicts with user-provided PRD.md, DESIGN.md, structure.md, screenshots, or brand rules.
- It would replace real product proof with decoration.
- It makes text, controls, or CTAs harder to read or use.
- The project cannot support a reduced-motion fallback or visual QA pass.
- The requested surface is a restrained dense product UI and this effect would add noise.

## Pattern Guidance

- Agency Grid Layout Minimal Skill
- Apply this as a full design-system direction across page layout, typography, image framing, service rows, labels, CTAs, and supporting motion.
- Use it when the design should feel like a refined architecture, design, or strategy agency site built on a strict grid and minimal visual language.
- This is not a generic startup landing page and not a heavily containerized dashboard. The layout should feel editorial, spacious, and precisely structured.
- Visual target:
- Build the page on a disciplined multi-column grid with large open spans, careful alignment, and generous negative space.
- Use oversized headlines with tight tracking and strong line breaks as the primary visual anchor.
- Pair the hero typography with very small uppercase utility labels, timestamps, section markers, or descriptive copy blocks placed in adjacent grid columns.
- Keep surfaces minimal: light neutral backgrounds, subtle tonal shifts, thin separators, quiet image frames, and very restrained accent use.
- Let imagery feel architectural and premium, usually as large panoramic or facade-like blocks rather than card-heavy galleries.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
