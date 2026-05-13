---
id: "neuform_cursor-reactive-flashlight-glow-border-xa9a9z"
title: "Cursor-Reactive Flashlight Glow Border"
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
  url: "https://neuform.ai/skill/cursor-reactive-flashlight-glow-border-xa9a9z"
  originId: "cursor-reactive-flashlight-glow-border-xa9a9z"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Cursor-Reactive Flashlight Glow Border

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

Dynamic edge illumination using conic gradients and JS-driven cursor tracking for technical dark-mode interfaces.

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

- Use a bounded grid system for high-density technical modules featuring 24px rounded corners and an 8px base spacing rhythm.
- Establish a premium dark aesthetic using a primary background of #080808, neutral-800 surface strokes, and high-contrast #EDEDED typography.
- Implement a 'gradient border shell' material by wrapping a dark content surface in a 1px container that reveals a hidden animated background.
- Create a cursor-reactive 'flashlight' effect where an edge glow follows the pointer perimeter relative to the component's center point.
- Drive the glow mechanism using a conic-gradient with color stops at 0deg and 360deg, masked to appear only on the component border.
- Layer a secondary absolute element with 12px Gaussian blur behind the primary border to simulate light diffusion and depth.
- Use JavaScript pointermove events to calculate the cursor angle via Math.atan2(dy, dx) and map it to a --cursor-angle CSS variable.
- Calculate edge proximity as a normalized 0-1 value to drive opacity transitions, ensuring the light intensity peaks as the cursor approaches the edge.
- Set typography to Geist with light weights (300) and negative letter-spacing (-0.025em) for a refined, data-heavy dashboard feel.
- Code pattern: <div class='relative p-[1px] group'><div class='absolute inset-0 bg-[conic-gradient(from_var(--cursor-angle),#fff,transparent_60deg,transparent_300deg,#fff)] opacity-[calc(var(--proximity)/100)]'></div><div class='relative bg-[#080808] rounded-[23px]'>Content</div></div>

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
