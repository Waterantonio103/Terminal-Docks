---
id: "neuform_technical-framed-grid-design-system-tzckhr"
title: "Technical Framed Grid Design System"
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
  - "design system"
  - "webgl"
  - "layout"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/technical-framed-grid-design-system-tzckhr"
  originId: "technical-framed-grid-design-system-tzckhr"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Technical Framed Grid Design System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

A technical dark-mode system with framed grid layouts, tactical corner accents, and grain-textured WebGL shader backgrounds.

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

- Execute a full-bleed dark-mode interface centered around a max-width framed container with high-contrast hairline borders.
- Add tactical corner bracket decorations using absolute-positioned 3x3px L-shaped borders to frame the primary content area corners.
- Set typography in Inter, utilizing light weights (300) for large headers with -0.05em letter-spacing for a technical, precise aesthetic.
- Implement a persistent background grid using a 24px repeating 45-degree linear-gradient at 3% opacity to define the spatial rhythm.
- Use a gradient border shell technique: a 1px transparent border with a linear-gradient border-image to create premium hairline depth.
- Integrate a WebGL Three.js background rendering vertical stepped columns with grainy, noise-perturbed edges and dithered color mapping.
- Design buttons with a sharp 2px radius, employing solid light fills for primary actions and 'backdrop-blur' glass effects for headers.
- Animate text using GSAP to reveal content via translateY transitions within overflow-hidden masking spans for a clinical interface reveal.
- Utilize a high-chroma accent color (#FF0B0B) sparingly for icons and interactive states against a deep black (#000000) field.
- Maintain a strict spacing rhythm based on a 5.6px unit, with section padding typically set at 96px for breathing room.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
