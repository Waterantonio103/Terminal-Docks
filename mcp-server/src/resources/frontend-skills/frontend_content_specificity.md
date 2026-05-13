---
id: frontend_content_specificity
title: Frontend Content Specificity
roles:
  - frontend_product
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
  - PRD.md
  - DESIGN.md
  - structure.md
  - implementation
  - visual_review
status: draft_review
---

# Frontend Content Specificity

Use this skill when writing or reviewing visible UI copy, sample data, labels, headings, CTAs, empty states, product examples, testimonials, metrics, or placeholder content. Specific content makes generic layouts fail less often.

## Content Source Order

Prefer:

- User-provided copy.
- Existing product copy from the repo.
- Current website/app copy.
- PRD terminology.
- Realistic domain examples.
- Carefully invented examples that match the product, audience, and state.

Do not use filler such as lorem ipsum, "feature one," "powerful insights," "seamless workflow," or fake metrics without a stated job.

## Headings And CTAs

Headings should name the object, action, category, or outcome.

Weak:

```text
Build better workflows
```

Stronger:

```text
Resolve overnight dispatch exceptions before the morning route lock
```

CTAs should say what happens:

- Start free trial.
- Create workspace.
- Review failed imports.
- Open runbook.
- Compare plans.
- Save segment.

Avoid vague CTAs such as "Get started" when a more specific action is known.

## Product UI Copy

For apps and tools:

- Use exact entity names: ticket, invoice, shipment, deployment, dataset, workspace, member, incident.
- Use real statuses: queued, pending approval, syncing, failed, archived, overdue, blocked.
- Use realistic timestamps, owners, counts, and labels.
- Put action verbs on commands.
- Keep table headers short and scannable.
- Make empty states explain why the surface is empty and what to do next.
- Make errors actionable.

Do not make operational UIs feel like marketing pages.

## Marketing Copy

For public pages:

- Lead with the literal offer, product, person, place, or category.
- Use proof that belongs to the product: screenshots, examples, outcomes, customer types, integrations, before/after, process, pricing logic.
- Replace abstract benefits with concrete situations.
- Keep claims credible.
- Avoid unsupported "AI-powered," "revolutionary," "next-gen," and "all-in-one" language unless the product facts support them.

Marketing copy should clarify the visual hierarchy, not fill empty sections.

## Sample Data

Sample data should:

- Match the target user and domain.
- Exercise real layout constraints.
- Include long names, short names, empty values, and edge statuses.
- Include enough rows/items to make lists, tables, charts, and filters believable.
- Avoid joke data unless the product tone calls for it.

Use realistic-but-safe invented data when real data is unavailable.

## DESIGN.md And structure.md Requirements

`DESIGN.md` should record content tone and visible copy rules:

- Voice qualities.
- Heading style.
- CTA style.
- Error and empty-state tone.
- Label/case rules.
- Forbidden generic phrases.

`structure.md` should record content slots:

- Required sections.
- Required copy blocks.
- Required entities.
- Required sample data fields.
- Empty/loading/error copy surfaces.

## Reviewer Rules

Block or request a fix when:

- The page could fit any product in the category.
- Hero copy does not name the real offer.
- CTAs are vague despite known actions.
- Sample data is too thin to test layout.
- Empty/error/loading states use generic filler.
- Copy contradicts the PRD or accepted terminology.
- The UI uses visual polish to compensate for missing product specificity.
