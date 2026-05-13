---
id: "neuform_blue-cloudy-clean-modern"
title: "Blue Cloudy Clean Modern"
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
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/blue-cloudy-clean-modern"
  originId: "blue-cloudy-clean-modern"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Blue Cloudy Clean Modern

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a clean modern design system with a luminous blue sky atmosphere, soft drifting cloud light, minimal white framing, and serene premium typography.

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

- Blue Cloudy Clean Modern Skill
- Apply this as a full design-system direction across background, framing, navigation, typography, CTAs, logo rows, and supporting motion.
- Use it when the interface should feel modern, calm, aspirational, and airy, with a sky-blue atmospheric field rather than a flat solid background.
- This is not generic SaaS blue and not a cartoon cloud theme. It should feel premium, serene, and highly controlled.
- Visual target:
- Build the page around a rich blue-to-pale-blue sky atmosphere with soft cloudy light drifting across the background.
- Use white typography and white or translucent white UI details so the composition feels clean and luminous against the blue field.
- Keep the structure minimal: thin container rails, subtle corner squares, restrained nav, and a few carefully framed pills or buttons.
- Let the mood feel weightless and modern, with soft gradients, open spacing, and elegant hero copy rather than dense dashboards or heavy card systems.
- If accent color is needed beyond white and blue, use a restrained darker neutral for buttons or a softened complementary accent very sparingly.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
