---
id: "neuform_stepped-neon-v-curve-glass-system-xy0g97"
title: "Stepped Neon V-Curve Glass System"
provider: "neuform"
patternKind: "motion_effect"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Motion Effects"
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
  - "style"
  - "animation"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/stepped-neon-v-curve-glass-system-xy0g97"
  originId: "stepped-neon-v-curve-glass-system-xy0g97"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Stepped Neon V-Curve Glass System

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

High-contrast dark system featuring dynamic vertical bar animations and pill-shaped glassy interfaces with white glow accents.

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

- Composition: Center-aligned flex layout with bounded content widths (max-w-2xl for navigation, max-w-4xl for hero) and absolute-layered background environments.
- Visual DNA: High-contrast dark mode using a deep neutral base (#030303) paired with electric blue (#3B82F6) and pure white accents.
- Background System: An animated background of 20+ vertical bars forming a V-shape, where height is calculated by distance from the center (origin-bottom).
- Background Gradient: Vertical bars use a complex linear-gradient(to top, #020617 0%, #1e3a8a 22%, #ffffff 42%, #3b82f6 65%, transparent 95%).
- Typography: Inter sans-serif stack; headings at 48px-64px with 600 weight and -0.025em letter-spacing; body text in neutral gray (#888888) at 14px-16px.
- Component Materials: Pill-shaped elements (9999px radius) with backdrop-blur-xl, border-white/10, and semi-transparent backgrounds (#18181b/70).
- Primary Actions: High-visibility white buttons with intense 24px white outer glows and 1.02x scale transitions on hover.
- Motion Dynamics: Implement a vertical breathing wave using a sine function (Math.sin) to oscillate bar heights and opacities via requestAnimationFrame.
- Interactive Effects: Use blue blur-2xl layers (opacity 40-70%) as background glow behind primary focal points to create depth.
- Technical Layers: Strict z-index separation between dynamic background (z-0) and glassy UI foreground (z-10) with backdrop-filter: blur(24px).

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
