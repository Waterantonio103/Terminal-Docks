---
id: "neuform_split-layout-technical"
title: "Split Layout Technical"
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
  url: "https://neuform.ai/skill/split-layout-technical"
  originId: "split-layout-technical"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Split Layout Technical

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a technical split-screen design system with dual panels, fine frame lines, mono metadata, quiet editorial typography, and premium inset surfaces.

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

- Split Layout Technical Skill
- Apply this as a full-page layout and design-system direction when the interface should be organized into two clear panels or halves.
- Use it for product pages, showcases, portfolios, editorial-tech layouts, or concept presentations that benefit from a disciplined split-screen structure.
- This is a layout system first: it should control framing, spacing, typography, metadata treatment, and panel behavior, not just add a vertical divider.
- Visual target:
- Build the page around a strong split layout, usually two equal or near-equal vertical panels on desktop, with each side carrying a distinct role.
- One side should act as the hero or immersive focal panel, while the other side handles explanation, specs, metadata, supporting content, or navigation.
- Use thin frame lines, inset boundary rules, tiny corner markers, and precise spacing so each panel feels like a technical display surface.
- Pair quiet editorial typography with mono utility labeling so the system feels intelligent, architectural, and controlled.
- Keep the palette restrained, with neutral surfaces and one selective accent color derived from the design rather than a hardcoded hue.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
