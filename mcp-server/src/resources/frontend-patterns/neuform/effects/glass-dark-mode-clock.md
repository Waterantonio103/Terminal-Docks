---
id: "neuform_glass-dark-mode-clock"
title: "Glass Dark Mode Clock"
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
appliesTo:
  - "DESIGN.md"
  - "implementation"
  - "visual_review"
tags:
  - "design system"
  - "style"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/glass-dark-mode-clock"
  originId: "glass-dark-mode-clock"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Glass Dark Mode Clock

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Create a dark glass design system with frosted shells, soft beam grids, circular clock-like calibration dials, and precise sci-fi instrument framing.

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

- Glass Dark Mode Clock Skill
- Apply this as a full design-system direction across background, shells, navigation, hero layout, controls, circular focal components, and motion.
- Use it when the interface should feel like a premium dark instrument panel with glassy surfaces and a clock, dial, or calibration-device centerpiece.
- This is not generic glassmorphism and not just a standalone radial widget. The full interface should support the clock-like system aesthetic.
- Visual target:
- Build the page on a black or near-black base with very subtle grid lines, vertical and horizontal beam guides, and faint structural crosshairs.
- Use dark glass or frosted-black surfaces for nav bars, pills, and controls, with blur, thin white edge gradients, and restrained reflection.
- Introduce a dominant circular focal element that feels like a clock, calibration dial, or resonance instrument with rings, ticks, degrees, or rotating text paths.
- Keep the palette mostly monochrome: black, white, zinc, and smoky gray. Accent brightness should come from glass highlights and soft white glow rather than saturated color.
- Let the result feel precise, scientific, and slightly cinematic, with the circular dial anchoring the page like a timekeeping or calibration device.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
