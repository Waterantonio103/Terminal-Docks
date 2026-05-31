---
id: frontend_negatives
title: Frontend Negative Patterns
roles:
  - frontend_designer
  - frontend_architect
  - frontend_builder
  - interaction_qa
  - accessibility_reviewer
  - visual_polish_reviewer
  - reviewer
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
  - final_review
status: required
---

# Frontend Negative Patterns

Read this before designing, building, or approving frontend UI. This is the shared rejection list for generic AI-looking output. Accepted user specs still win, but these patterns require an explicit product-specific reason or a redesign.

## Hard Failures

- The first screen looks like a template instead of the requested product, app, place, game, or workflow.
- The UI is mostly decoration with weak product proof, weak content, or no realistic task state.
- A product tool opens with a marketing hero instead of the working surface.
- A marketing page opens with a fake dashboard when the user asked for brand/product positioning.
- Effects, gradients, WebGL, glass, glow, or motion are used to distract from missing hierarchy, missing states, or generic copy.
- The result would still make sense if every product-specific noun were swapped for another product in the same category.

## Layout Patterns To Avoid

- Same centered max-width section repeated down the page.
- Icon, heading, paragraph cards as the default answer to every section.
- Cards inside cards, panels inside cards, or every section wrapped in a floating surface.
- Big empty hero or metric strip with little product proof.
- Decorative side stripes on every card, row, alert, or callout.
- Dense dashboards that are just boxes of numbers without scannable entities, filters, statuses, timestamps, owners, or actions.
- Tables squeezed until columns become unreadable instead of using an intentional mobile or overflow strategy.
- Mobile layouts that hide the actual workflow and keep only summary cards.

## Visual Tropes To Reject

- Generic dark blue, slate, or purple SaaS dashboard.
- Beige editorial AI landing page without a subject-specific reason.
- Healthcare equals teal by default, finance equals navy/gold by default, developer tool equals terminal-green by default.
- Glassmorphism as the base material.
- Gradient text for polish.
- Decorative orbs, bokeh blobs, mesh blobs, random wave backgrounds, and abstract shapes that do not represent the product.
- Fake app screenshots made of smooth meaningless cards.
- Unmotivated WebGL, particles, lasers, liquid blobs, or 3D objects that compete with content.
- One-hue palettes where every surface, border, and accent is the same color family.

## Copy And Content Smells

- Vague claims: seamless, powerful, next-gen, intuitive, revolutionary, magical, effortless.
- Section text that restates the heading.
- Feature names that could belong to any product in the category.
- Unsupported metrics, testimonials, customer logos, integrations, savings, health, security, or compliance claims.
- Placeholder labels like Analytics, Insights, Workflow, Growth, Performance without domain-specific data.
- CTA labels that do not say what the user is doing.

## Product UI Rejection Checks

For dashboards, admin tools, editors, settings, forms, and internal tools, reject unless the implementation has:

- Realistic entities with domain-specific names and fields.
- Current, selected, empty, loading, error, success, disabled, hover, focus, and active states where relevant.
- Familiar controls for the job: tables, lists, filters, tabs, segmented controls, menus, forms, drawers, detail panes, command bars.
- Clear information density appropriate to the user's urgency and repetition.
- Status and severity indicators that use text or shape, not color alone.
- Actions placed near the objects they affect.

Do not add visual spectacle to compensate for missing workflow depth.

## Brand Or Marketing Rejection Checks

For landing pages, websites, launch pages, portfolios, and campaign pages, reject unless the first viewport has:

- Product, brand, place, person, or category as the main signal.
- A real visual anchor: product media, generated bitmap, real image, screenshot, code-native scene, or object tied to the offer.
- Specific proof content, not generic feature cards.
- Clear CTA hierarchy and a visible path to conversion or exploration.
- Section rhythm that changes based on content, not a repeated template.

Do not use a dashboard mockup as a crutch when the product is not dashboard-led.

## Effect Rules

Effects are allowed only when they support the accepted design direction.

- Keep effects behind content, never in place of content.
- Match the effect to the subject, not to a trend.
- Provide reduced-motion behavior for substantial animation.
- Verify the effect in a browser or screenshot when the workflow supports it.
- Remove the effect when readability, performance, contrast, or responsive layout suffers.

## Approval Standard

Before completing, answer yes to all:

- Could a target user recognize the exact product/workflow without reading a long paragraph?
- Are the major UI decisions traceable to PRD.md, DESIGN.md, structure.md, user references, or current app conventions?
- Are the states and controls complete enough to feel usable, not decorative?
- Does the mobile layout preserve the core value of the desktop layout?
- Is there at least one product-specific visual or content decision that a generic template would not have made?

If any answer is no, request or perform a fix pass.
