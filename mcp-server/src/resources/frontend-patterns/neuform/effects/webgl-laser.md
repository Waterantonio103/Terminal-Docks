---
id: "neuform_webgl-laser"
title: "WebGL Laser"
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
  - "webgl"
  - "animation"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/webgl-laser"
  originId: "webgl-laser"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# WebGL Laser

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Add a focused WebGL laser beam background that uses the design's primary color, with a thin beam, smoky volumetric fog, glow, and a fixed full-screen canvas behind the UI.

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

- WebGL Laser Skill
- Apply this only to the laser background effect, not to the full page layout, copy, or unrelated motion systems.
- Use a fixed full-screen canvas behind the DOM with `pointer-events: none` and keep content in a higher stacking context.
- Visual target:
- Render a thin vertical laser with a crisp white-hot inner core, a restrained colored halo, and soft smoky fog drifting around the beam.
- Match the beam glow and smoke tint to the design's primary color or strongest accent color instead of defaulting to blue. Use a softened variant of that color for the halo and smoke while keeping the hottest inner core near white.
- Keep the beam narrow and precise like a light blade or scanning line, not a thick neon pillar. The smoke should feel atmospheric and volumetric, with soft cloudy breakup around the beam.
- Keep the composition cinematic and restrained, with the chosen brand color integrated cleanly into a dark atmospheric background and a soft pulse.
- Implementation guidance:
- Prefer raw WebGL with a full-screen quad, pass-through vertex shader, and fragment shader-driven visuals unless the active file already uses another WebGL renderer.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
