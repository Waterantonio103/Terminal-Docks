---
id: "neuform_atmospheric-technical-design-system-u1ciwi"
title: "Atmospheric Technical Design System"
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
  url: "https://neuform.ai/skill/atmospheric-technical-design-system-u1ciwi"
  originId: "atmospheric-technical-design-system-u1ciwi"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Atmospheric Technical Design System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

A high-contrast dark system featuring WebGL shader backgrounds, grain textures, and structured split-screen architectural layouts.

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

- Layout: Use a split-screen grid architecture with a flexible primary content area and a fixed-width sidebar (320px-400px) featuring backdrop-blur-sm and a 1px white/10% vertical border.
- Visual DNA: Establish a 'Technical HUD' aesthetic using ultra-thin 1px borders, corner L-bracket motifs (8px x 8px), and an SVG noise overlay with 0.08 opacity and mix-blend-mode: overlay.
- Color: Implement a deep dark theme (base #030305) with white text opacities (90% for primary, 40% for secondary) and electric blue/cyan accents (#00F0FF) for interactive elements.
- Typography: Set primary headings at 96px in light weights (300) with tight tracking (-0.05em); contrast with 12px uppercase labels using 0.15em tracking for category headers.
- WebGL Background: Integrate a full-bleed Three.js canvas using a ShaderMaterial with Simplex 2D noise to generate sweeping light beams and deep-space gradients in blue and purple.
- Code pattern: <div class='noise' style='position:absolute; inset:0; mix-blend-mode:overlay; opacity:0.08; background:url("data:image/svg+xml...feTurbulence")'></div><main class='flex h-screen'><section class='flex-1 p-24 border-r border-white/10'></section><aside class='w-[400px] backdrop-blur-md bg-black/10'></aside></main>
- Motion: Execute masked text reveals using GSAP where words are wrapped in 'overflow-hidden' spans and translated from y: 110% to 0% with power4.out easing.
- Button Anatomy: Design split-action buttons with a solid white primary block for labels and a dark #0A0A0A secondary block containing a linear icon, joined by a 1px border.
- Surfaces: Apply a 16px diagonal linear-gradient background pattern (2% opacity) to create a subtle tactical grid texture over the content areas.
- Materiality: Wrap primary surfaces in an outer shell with 0px padding and use a linear-gradient border shell to create a hairline frame effect that suggests depth rather than a flat stroke.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
