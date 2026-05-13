---
id: "neuform_interactive-border-gradient-glow-wnu6m4"
title: "Interactive Border Gradient Glow"
provider: "neuform"
patternKind: "motion_effect"
recommendationStrength: "heavy_recommend_optional"
themePickerReady: true
effectPicker:
  group: "Motion Effects"
  intensity: "restrained"
  technicalComplexity: "low_medium"
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
  - "animation"
source:
  name: "Neuform prompt skill catalog"
  url: "https://neuform.ai/skill/interactive-border-gradient-glow-wnu6m4"
  originId: "interactive-border-gradient-glow-wnu6m4"
  license: "unknown-public-web-catalog"
status: "draft_review"
---

# Interactive Border Gradient Glow

Use this Neuform-derived pattern only when it strengthens the accepted product/design direction. It is a heavy recommendation when matched, but never mandatory and never a replacement for accepted specs.

## Intent

High-precision card border system with cursor-tracked conic-gradient glows and soft blurred auras.

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

- Structure components with a multi-layered shell: an outer 1px padding container for the border and a nested content surface.
- Apply a static base border using a linear-gradient(to bottom, #262626, transparent) on the padding container.
- Implement a dynamic 'flashlight' edge effect using a conic-gradient tied to a CSS variable for rotation angle.
- Use a secondary absolute layer with inset-[-12px] and 12px blur to create a soft glow aura that follows the border focus.
- Map cursor proximity to the card edge to a 0-1 scale variable to drive the opacity of the glow layers.
- Calculate the rotation angle of the conic-gradient using Math.atan2 based on the cursor position relative to the card center.
- Ensure all glow layers use rounded-[inherit] to maintain a perfect 24px (3xl) corner radius alignment.
- Transition the glow opacity over 300ms to ensure smooth entry/exit when the pointer interacts with the card surface.
- Keep the inner content background solid and dark to provide maximum contrast for the hairline border glow.
- Code pattern: <div class="relative p-[1px] rounded-3xl bg-gradient-to-b from-neutral-800 to-transparent group"><div class="absolute inset-0 rounded-[inherit] transition-opacity" style="background: conic-gradient(from var(--cursor-angle), #fff, transparent 50deg, transparent 310deg, #fff); opacity: var(--glow-opacity);"></div><div class="relative z-10 bg-black rounded-[inherit] p-8"></div></div>

## DESIGN.md Translation

When selected, translate this pattern into exact DESIGN.md fields: colors, typography, layout, spacing, surfaces, component recipes, motion, responsive behavior, asset requirements, and builder handoff. Do not merely name the effect.

## Implementation Guardrails

- Preserve semantic HTML for content and controls.
- Keep text and CTAs readable over the effect.
- Add reduced-motion behavior for animated effects.
- Verify desktop and mobile screenshots before approval.
- Remove or simplify the pattern if it causes performance, accessibility, or product-clarity problems.
