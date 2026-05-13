---
id: frontend_pattern_selection
title: Frontend Pattern Selection
roles:
  - frontend_designer
  - frontend_builder
  - visual_polish_reviewer
categories:
  - marketing_site
  - admin_internal_tool
  - docs_portal
  - saas_dashboard
  - consumer_mobile_app
appliesTo:
  - DESIGN.md
  - implementation
  - visual_review
status: draft_review
---

# Frontend Pattern Selection

Use this skill to choose optional pattern-library resources responsibly. Patterns can elevate a page, but they can also create generic visual noise when overused.

## Source Of Truth

Patterns are subordinate to:

- Explicit user instructions.
- Accepted `PRD.md`.
- Accepted `DESIGN.md`.
- Accepted `structure.md`.
- Screenshots, brand files, and current code.

Never use a pattern to override the accepted product/design direction.

## Selection Limit

Load at most 1 to 3 patterns for a task.

Default:

- 0 patterns for straightforward product UI.
- 1 pattern for normal marketing/product pages.
- 2 patterns for visual-first landing pages.
- 3 patterns only for highly expressive pages that can support effect, layout, and surface choices.

If more than 3 patterns seem relevant, the design direction is probably not focused enough.

## Matching Criteria

A pattern is eligible only when:

- Its category matches the task.
- Its role matches the agent phase.
- Its `appliesTo` matches the work being done.
- Its visual move is explicitly called for or clearly implied by the specs.
- It improves product understanding or visual hierarchy.
- It can be implemented within project constraints.

Prefer pattern metadata:

- `effectPicker.group`
- `patternKind`
- `technicalComplexity`
- `intensity`
- `tags`
- `roles`
- `categories`

## Pattern Jobs

Choose patterns by job:

- Background effect: creates atmosphere behind content.
- Layout system: changes composition and section structure.
- Surface/material effect: defines card, panel, border, glass, shadow, or texture treatment.
- Motion effect: controls reveal, scroll, parallax, or interaction pacing.
- Typography effect: gives text a distinctive voice.
- Asset/media treatment: controls imagery, screenshots, illustrations, or product mockups.

Do not use two patterns for the same job unless one clearly refines the other.

## Good Combinations

Acceptable combinations:

- One layout system plus one surface style.
- One hero/background effect plus one typography treatment.
- One product showcase layout plus one restrained motion effect.
- One data/telemetry pattern plus one dense dashboard layout.

Risky combinations:

- WebGL background plus parallax plus heavy glass plus masked text reveal.
- Multiple neon/glow systems.
- Multiple layout systems.
- Multiple typography personalities.
- Decorative background plus no real product proof.

## DESIGN.md Translation

When a pattern is selected, `DESIGN.md` must translate it into exact decisions:

- Token values.
- Layout rules.
- Component recipes.
- Motion timing and reduced-motion behavior.
- Asset requirements.
- Responsive behavior.
- Browser verification requirements.

Do not write “use the Neuform pattern.” Builders need the actual ingredients.

## Builder Rules

Builders may implement a selected pattern only when:

- It is in accepted `DESIGN.md`, or
- The accepted `DESIGN.md` clearly implies it and the builder records the choice.

High-complexity patterns require:

- Reduced-motion fallback.
- Mobile behavior.
- Browser screenshot verification.
- Performance sanity check.
- Graceful failure if canvas/WebGL is unavailable.

## Rejection Rules

Reject a pattern when:

- It replaces product proof with decoration.
- It makes copy or CTAs harder to read.
- It conflicts with the user's requested tone.
- It increases implementation risk beyond the task budget.
- It would make an admin/product UI feel like a landing page.
- It makes the design less accessible.
- It is selected only because it looks impressive.

## Review Checklist

For selected patterns, reviewers should ask:

- Was the pattern appropriate?
- Was it translated into concrete implementation?
- Did it preserve product clarity?
- Did it preserve accessibility and responsive behavior?
- Did it improve the page compared with a simpler treatment?
