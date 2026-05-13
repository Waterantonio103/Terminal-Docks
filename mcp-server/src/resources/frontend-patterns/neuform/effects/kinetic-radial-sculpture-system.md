---
id: "neuform_kinetic-radial-sculpture-system-0gv4e7"
title: "Kinetic Radial Sculpture System"
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
  url: "https://neuform.ai/skill/kinetic-radial-sculpture-system-0gv4e7"
  originId: "kinetic-radial-sculpture-system-0gv4e7"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Kinetic Radial Sculpture System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

An animated background generator creating layered, light-reactive blades with cinematic lighting and procedural motion.

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

- Construct a 3D radial sculpture of ~40 absolute-positioned DIV blades anchored to a right-side pivot point (origin-right) spreading across a -85 to 85 degree arc.
- Implement blade geometry using an asymmetric border-radius (100% 0 0 100% / 50% 0 0 50%) to create a tapered, feather-like silhouette.
- Materialize surfaces with dual-layer backgrounds: a vertical specular highlight (white-to-transparent) and a horizontal color ramp (peach to deep mahogany).
- Add physical thickness via box-shadows: a heavy outer shadow for depth and a 2px white inset highlight for the rim light effect.
- Set the environment with deep, dark radial gradients and a subtle 5% opacity SVG fractal noise grain overlay using mix-blend-mode: overlay.
- Use oversized semi-bold headings (128px) with wide-tracked (0.8rem) thin sub-labels; headings should use high-intensity multi-layered glow text-shadows.
- Apply a clip-path polygon mask to text containers to allow for staggered Y-axis reveal animations while preserving text-shadow overflow.
- Orchestrate motion with GSAP: stagger the initial unfurling of blades from the center, then loop a subtle sine-wave sway on rotation and scale.
- Maintain responsive scale by adjusting blade width from 90vw on mobile to 65vw on desktop while preserving the fixed right-aligned transform origin.
- Code pattern: .sculpture-blade { border-radius: 100% 0 0 100% / 50% 0 0 50%; box-shadow: 0 18px 45px -8px #000, inset 0 2px 4px rgba(255,255,255,0.3); background: linear-gradient(to bottom, #ffffff66, transparent 10%), linear-gradient(to right, #ffedcc, #a11b00); transform-origin: right; }

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
