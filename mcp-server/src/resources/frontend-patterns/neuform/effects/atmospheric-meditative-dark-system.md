---
id: "neuform_atmospheric-meditative-dark-system-wr0bj8"
title: "Atmospheric Meditative Dark System"
provider: "neuform"
patternKind: "motion_effect"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Motion Effects"
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
  - "design system"
  - "animation"
  - "style"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/atmospheric-meditative-dark-system-wr0bj8"
  originId: "atmospheric-meditative-dark-system-wr0bj8"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Atmospheric Meditative Dark System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Technical dark-mode system with premium gradient-border shells, noise textures, and cinematic GSAP-driven text masking.

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

- Dual-pane immersive layout using a 50/50 split flex-row on desktop and flex-col on mobile for high-density content delivery.
- Minimalist Inter-driven typography utilizing light weights (300), tight letter-spacing (-0.025em), and scale-down metadata at 10px.
- Atmospheric dark-mode palette grounded in absolute black (#050505) with surface-elevated grays (#121212) and muted sage accents (#C3CEB5).
- Premium material depth via 'gradient-border shells' using an outer p-[1px] wrapper with a linear-gradient stroke (white/20 to transparent).
- Layered visual texture through a global noise-haze overlay (0.015 opacity) with mix-blend-mode: overlay to break flat surfaces.
- Cinematic motion choreography using GSAP-driven masked text reveals (translateY: 100% to 0%) for display headings and staggered entry.
- Interactive container-level parallax: apply mouse-reactive transforms (x/y drift) and slight rotations to hero imagery sections.
- Component anatomy: inputs and buttons feature 12px border-radius, solar-linear icons, and focus-triggered glow/blur effects.
- Soft multi-layered shadow stack (6+ layers) for cards to create high-elevation depth against pure black backgrounds.
- Controlled timing system favoring 300ms durations and power3.out easings for all interface transitions and text reveals.

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
