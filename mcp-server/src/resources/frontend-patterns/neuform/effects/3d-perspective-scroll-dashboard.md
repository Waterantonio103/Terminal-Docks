---
id: "neuform_3d-perspective-scroll-dashboard-0hq031"
title: "3D Perspective Scroll Dashboard"
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
  - "3d"
  - "animation"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/3d-perspective-scroll-dashboard-0hq031"
  originId: "3d-perspective-scroll-dashboard-0hq031"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# 3D Perspective Scroll Dashboard

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Premium dark UI with 3D-transformed interface planes that straighten through scroll choreography and glassmorphism.

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

- Create a high-fidelity dark-mode dashboard using a primary accent of #FF5A1F against deep neutral surfaces (#18181B) and blurred glass backgrounds.
- Implement a 3D perspective system using a container with perspective: 2000px and transform-style: preserve-3d to host floating interface planes.
- Initialize the main dashboard plane with a complex initial state: rotateX(38deg) rotateY(-12deg) rotateZ(18deg) and scale(0.95).
- Direct a scroll-linked animation (scrub) that transitions the dashboard rotations to zero and scale to 1.0 as the container enters the viewport.
- Execute a 'Gradient Shell' material effect using absolute-positioned ::before pseudo-elements with a 1px inset and 135deg linear-gradient strokes for premium edge highlights.
- Use masked text reveals for headlines where individual words translate from translateY(100%) within overflow-hidden spans for a staged entrance.
- Add 'God Ray' ambient lighting using fixed, large-scale blurred circles (130px blur) with mix-blend-mode: screen and low-opacity orange fills (#FF5A1F/20).
- Style cards with a background of rgba(24, 24, 27, 0.6), 12px border-radius, and secondary orange glow shadows (rgba(255, 90, 31, 0.3) 0px 0px 30px).
- Set typography to a clean system-sans stack with headings at 500 weight, -0.025em letter-spacing, and tight line-heights (1.05).
- Incorporate a Three.js background layer rendering a subtle wireframe terrain or dot-matrix field with high transparency (40%) and slow orbital drift.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
