---
id: frontend_product_ui_patterns
title: Frontend Product UI Patterns
roles:
  - frontend_product
  - frontend_architect
  - frontend_builder
  - interaction_qa
  - visual_polish_reviewer
categories:
  - admin_internal_tool
  - saas_dashboard
  - docs_portal
  - consumer_mobile_app
appliesTo:
  - PRD.md
  - structure.md
  - implementation
  - visual_review
status: draft_review
---

# Frontend Product UI Patterns

Use this skill when the work is an app, dashboard, console, editor, portal, settings surface, or task workflow. Product UI should feel useful before it feels impressive.

## Pattern Selection

Choose familiar patterns when they match the task:

- Sidebar plus top bar for multi-area authenticated apps.
- Top nav for shallow apps or docs portals.
- Split pane for preview/detail, inbox/detail, editor/preview, map/list, or source/result workflows.
- Master/detail for lists, queues, records, tickets, documents, users, orders, or alerts.
- Tabs for sibling views within the same object.
- Filters and saved views for repeat analysis or queue triage.
- Data table for comparison, bulk actions, sorting, and scanning.
- Cards for repeated objects with heterogeneous content, not dense tabular comparison.
- Command palette for power-user actions.
- Drawer for contextual edit or detail without losing list position.
- Modal only for focused confirmation, short creation, destructive action, or blocking decision.

Do not make a product workflow look like a marketing landing page.

## Information Density

Density should match work pressure:

- High density: operations consoles, monitoring, support queues, admin lists, financial or logistics tools.
- Medium density: SaaS dashboards, project management, CRM, analytics, docs portals.
- Low density: onboarding, consumer mobile, guided setup, visual creation tools.

Use whitespace to group and scan. Do not make every object a large decorative card.

## Navigation Rules

Navigation should answer:

- Where am I?
- What object or workspace am I in?
- What can I do next?
- How do I return to the previous level?
- Which filters, modes, or saved views are active?

Use breadcrumbs for deep object hierarchy. Use persistent side nav for repeated area switching. Use tabs only when the tabs are peers within the same context.

## Data And State Surfaces

For product UI, specify and implement:

- Loading state.
- Empty state.
- Error state.
- Permission or locked state.
- Unsaved changes state when editing exists.
- Selected/current state.
- Bulk action state when lists allow selection.
- Stale, syncing, offline, or realtime state when relevant.
- Audit/history surface when decisions need traceability.

If a workflow has only the happy path, the UI is underspecified.

## Component Fit

Use controls that users already understand:

- Button for commands.
- Link for navigation.
- Checkbox for multi-select.
- Radio or segmented control for mutually exclusive short choices.
- Select/menu for long option sets.
- Switch for immediate binary setting changes.
- Input/textarea for editable text.
- Slider/stepper only for numeric ranges where precision expectations are clear.
- Table when comparison matters.
- List when sequence, queue, or reading order matters.

Do not invent custom controls when native or common patterns would be clearer.

## structure.md Requirements

`structure.md` should name:

- Routes or screens.
- Persistent shell layout.
- Navigation model.
- Primary entities and data shape.
- Component boundaries.
- State surfaces.
- Responsive behavior for tables, panes, nav, and filters.
- Test or launch checklist.

Do not leave builders to infer product architecture from visual mockups alone.

## Reviewer Rules

Block or request a fix when:

- A working app starts with a marketing hero instead of the working surface.
- Navigation does not show location or current context.
- Controls are decorative or unfamiliar without benefit.
- Required empty, loading, error, selected, or disabled states are missing.
- Mobile removes core workflow access.
- Tables, filters, or detail panes collapse into unreadable stacks.
- The UI is too sparse for repeated operational work.
