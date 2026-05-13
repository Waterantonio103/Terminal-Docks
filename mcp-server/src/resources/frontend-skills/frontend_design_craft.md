---
id: frontend_design_craft
title: Frontend Design Craft
roles:
  - frontend_designer
  - frontend_architect
  - visual_polish_reviewer
categories:
  - marketing_site
  - admin_internal_tool
  - docs_portal
  - saas_dashboard
  - consumer_mobile_app
appliesTo:
  - DESIGN.md
  - structure.md
  - visual_review
source:
  name: "Impeccable; Designer Skills Collection"
  url: "https://github.com/pbakaus/impeccable; https://github.com/Owl-Listener/designer-skills"
  license: "Apache-2.0; MIT"
status: draft_review
---

# Frontend Design Craft

Use this skill when a frontend agent is creating, patching, or reviewing visual direction. It is guidance, not the source of truth. User instructions, screenshots, accepted `PRD.md`, accepted `DESIGN.md`, and accepted `structure.md` override this skill.

## Required Context

Before making design decisions:

- Read the accepted product source: usually `PRD.md`.
- Read the accepted visual source: usually `DESIGN.md`, or the strongest supplied alias.
- Read the accepted structure source: usually `structure.md` or `architecture.md`.
- Identify whether the surface is brand or product.

Brand surfaces: landing pages, marketing sites, portfolios, campaign pages, launch pages, editorial pages. The design is part of the product promise.

Product surfaces: dashboards, tools, app shells, settings, admin systems, forms, docs tools, authenticated workflows. The design serves task completion.

Do not let a generic category choose the visual direction. Write a concrete scene sentence first:

```text
Who is using this, where, under what ambient conditions, with what level of urgency, and what should the interface feel like in their hands?
```

Weak: `This is an observability dashboard.`

Stronger: `An on-call SRE checks incident severity on a large monitor at 2am, needing low-glare density and immediate priority scanning.`

The scene sentence should justify theme, density, contrast, typography, and motion.

## Anti-Slop Standard

If the result looks like an average AI-generated landing page or dashboard, it fails.

Check for these failure modes:

- The category predicts the palette, such as healthcare equals teal, finance equals navy and gold, developer tool equals dark terminal, AI product equals cream editorial.
- The design avoids the first obvious trope but lands in the second obvious trope.
- Every section is a centered stack with the same max-width and spacing.
- Every feature is an identical icon card.
- The interface uses decoration to hide weak hierarchy.
- The hero looks good as a thumbnail but does not explain the product.
- Product UI invents weird controls where users expect familiar affordances.

Specificity beats taste words. Replace `modern`, `clean`, `premium`, and `sleek` with physical qualities:

- compressed
- low-glare
- broadcast-like
- pressure-glass
- printed-manual
- instrument-panel
- editorial poster
- field-console
- tactile
- clinical
- luminous

## Color

Pick a color strategy before picking colors.

- Restrained: tinted neutrals plus one accent used sparingly. Good default for product tools and dense workflows.
- Committed: one strong color owns a substantial part of the surface. Useful when brand memory matters.
- Full palette: three or four named roles with clear jobs. Useful for campaigns, games, data-heavy UI, and expressive brands.
- Drenched: the page is carried by color. Appropriate only when the brand or campaign can absorb that much identity.

Rules:

- Do not use raw `#000000` or `#ffffff` as lazy defaults. Tint neutrals toward the palette unless the existing brand requires pure black or white.
- Do not use long-form text in saturated accent colors.
- Semantic colors must have jobs: success, warning, danger, info, selected, disabled.
- State-rich product UI needs separate color recipes for hover, focus, active, selected, loading, error, warning, success, and disabled.
- For dark UI, raise text contrast through surface control, not through neon everywhere.
- If the palette is predictable from the product category alone, revise it.

`DESIGN.md` must define exact color values, not just palette adjectives.

When the surface needs a reusable color system, define layers rather than isolated swatches:

- Brand palette: primary, secondary, accent, and any expressive campaign colors.
- Neutral palette: backgrounds, raised surfaces, borders, dividers, text, muted text.
- Semantic palette: success, warning, danger, info, selected, disabled.
- Data or illustration palette only when charts, maps, diagrams, or illustrations exist.

For each important color role, specify foreground/background pairings that meet contrast requirements. Do not leave contrast validation to the builder.

## Typography

Choose typography from the product voice, not from default model taste.

For brand surfaces:

- Name three concrete voice words before choosing fonts.
- Avoid reflexive font choices just because they look designed.
- A single strong family can work if weight, width, case, and scale are deliberate.
- Display/body pairings should earn their place through voice, not habit.
- Use fluid display sizes only where the layout benefits from it.

For product surfaces:

- System fonts and familiar sans families are valid.
- One well-tuned UI family is often stronger than a decorative pair.
- Prefer fixed rem scales over fluid hero-scale type inside working surfaces.
- Data, forms, tables, nav, buttons, and labels should not use display fonts.

Rules:

- Body prose should usually stay around 65 to 75 characters per line.
- Sustained reading, docs, and article-like pages usually want 55 to 70 characters.
- UI descriptions and card copy usually want 45 to 65 characters.
- Captions, helper text, and callouts usually want shorter measures.
- Type scale needs real contrast. Flat type scales look accidental.
- Uppercase is for short labels, nav, metadata, and compact headings, not body copy.
- Letter spacing must be intentional. Do not track body copy.
- `DESIGN.md` must define exact typography tokens: family, size, weight, line-height, letter-spacing, and case.

## Layout

The structure should feel chosen, not defaulted.

Brand layout:

- Use a clear visual stance: cinematic, editorial, strict grid, asymmetric, poster-like, product-led, image-led, object-led, or immersive.
- Do not center every section unless centeredness is the concept.
- Let the first viewport carry the strongest signal: product, place, object, visual world, or working UI.
- Show a hint of the next section when the page is a landing page.
- Use imagery, generated visuals, product screenshots, or code-native scenes when the subject needs visual proof.

Product layout:

- Familiar patterns are a feature: sidebars, top bars, tabs, filters, breadcrumbs, split panes, command palettes, tables.
- Density is allowed when the work demands it.
- Consistency is an affordance. Same controls should look and behave the same.
- Responsive behavior is structural: collapse sidebars, stack panels, preserve tables through overflow or alternate layouts.

Rules:

- Same padding everywhere creates monotony.
- Nested cards are almost always wrong.
- Do not wrap every section in a decorative card.
- Do not use cards as the only composition idea.
- `DESIGN.md` must define exact content width, grid behavior, section rhythm, and first-viewport composition.

Use grouping signals deliberately:

- Proximity first: related things sit closer together than unrelated things.
- Common region second: containers, panels, cards, and section backgrounds are for groups that need a visible boundary.
- Avoid redundant grouping. A tight cluster inside a heavy card inside another panel usually adds noise.
- Use the weakest grouping that makes the relationship clear: spacing before background, background before border, border before elevated card.

Reserve strong visual differentiation for the few things that need attention: primary CTA, selected row, active nav item, recommended option, or critical warning. If everything is highlighted, nothing is.

## Components

Every component recipe should include:

- Purpose.
- Default state.
- Hover state where hover exists.
- Focus-visible state.
- Active or pressed state.
- Disabled state when relevant.
- Loading, empty, error, and success states when relevant.
- Responsive behavior.

Product components must preserve familiar affordances. Do not reinvent native-feeling controls for flavor.

Brand components can take more visual risk, but the CTA hierarchy must stay obvious.

## Motion

Motion must have a job.

Good jobs:

- Show state change.
- Reinforce navigation.
- Reveal hierarchy.
- Give feedback.
- Support atmosphere on brand surfaces.

Bad jobs:

- Distract from reading.
- Hide weak layout.
- Make users wait.
- Animate layout properties casually.

Guidelines:

- Product UI transitions should usually sit around 150 to 250ms.
- Brand pages can use more ambitious choreography only when the concept earns it.
- Respect reduced motion.
- Prefer transform, opacity, mask, and background-position over layout-property animation.

## Absolute Bans

Before using any of these, redesign the element:

- Thick colored side-stripe borders on cards, list items, callouts, or alerts.
- Gradient text used as decoration.
- Glassmorphism as the default material.
- Hero metric blocks that are just big numbers plus tiny labels.
- Repeating identical icon cards as the main page body.
- Modal as the first solution to a flow problem.
- Generic dark gradient with no subject-specific visual proof.
- Placeholder imagery where the brief clearly needs real, generated, or code-native visuals.

## DESIGN.md Expectations

When creating or patching `DESIGN.md`, make it mechanically useful for builders:

- Use a structured token block or frontmatter.
- Define exact colors.
- Define exact typography.
- Define exact spacing and radius scale.
- Define exact component recipes.
- Define exact hero or first-screen composition.
- Define asset requirements.
- Define do and don't rules specific enough for reviewers.
- Add a builder handoff that lists the visible ingredients that must survive into code.

Do not write only mood, tone, and inspiration. Builders need numbers, recipes, states, and composition constraints.

## Optional Pattern Library

For visual-first work, consult the optional pattern index at `mcp-server/src/resources/frontend-patterns/neuform/index.json`.

Use patterns as heavy recommendations when they match the task:

- Load at most 1 to 3 relevant patterns.
- Prefer patterns whose `categories`, `roles`, `appliesTo`, and `effectPicker.group` match the task.
- Translate selected patterns into exact `DESIGN.md` tokens and component recipes.
- Do not mention a pattern by name without turning it into concrete color, typography, layout, surface, motion, responsive, and asset requirements.
- Do not use a pattern that conflicts with accepted specs, screenshots, brand rules, accessibility, or product clarity.

These resources are prepared for a future theme-picker `Effects` section, but they are not a picker implementation and should not be treated as mandatory defaults.
