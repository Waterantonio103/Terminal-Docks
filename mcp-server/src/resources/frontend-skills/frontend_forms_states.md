---
id: frontend_forms_states
title: Frontend Forms And States
roles:
  - frontend_product
  - frontend_designer
  - frontend_architect
  - frontend_builder
  - interaction_qa
  - accessibility_reviewer
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
  - accessibility_review
  - visual_review
status: draft_review
---

# Frontend Forms And States

Use this skill when a UI includes forms, onboarding, checkout, setup, filters, settings, creation flows, editable records, search, auth, or any async state.

## Required Form Decisions

Before build, specify:

- Who fills the form and why.
- Required and optional fields.
- Field order and grouping.
- Validation timing: on blur, on submit, on input, or server response.
- Error message tone and placement.
- Success confirmation behavior.
- Save, cancel, reset, and discard behavior.
- Draft, autosave, or unsaved changes behavior.
- Privacy, permission, and destructive-action constraints.
- Mobile keyboard/input type expectations.

Do not create a form from labels alone.

## Field Recipes

Each important field should define:

- Label.
- Help text when needed.
- Placeholder only when it adds an example, not as a label substitute.
- Default value.
- Empty state.
- Valid state.
- Invalid state.
- Disabled/read-only state.
- Loading/checking state when async validation exists.
- Character, file, or value limits when relevant.

Accessible labels are required. Placeholder-only fields fail.

## Error And Success States

Errors should:

- Say what happened.
- Say how to fix it.
- Sit near the relevant field when field-specific.
- Use a summary when multiple errors exist.
- Not rely on color alone.
- Preserve user input.
- Avoid blaming the user.

Success should:

- Confirm the saved or completed object.
- Make the next useful action visible.
- Avoid dead-end celebratory screens unless the product flow benefits from a pause.

## Async States

For async workflows, cover:

- Initial loading.
- Skeleton or spinner choice.
- Partial data.
- Empty result.
- Error with retry.
- Permission denied.
- Offline or reconnecting where relevant.
- Stale data and refresh where relevant.
- Optimistic update and rollback where relevant.

Avoid full-screen spinners when stable page chrome and partial content can remain visible.

## Multi-Step Flows

For onboarding, checkout, setup, or wizards:

- Show progress when users need orientation.
- Keep steps short and meaningful.
- Let users go back without losing input.
- Validate at the step boundary unless real-time validation is materially helpful.
- Make exit/cancel consequences explicit.
- Preserve context between steps.

Do not split a simple form into a wizard only to make it feel designed.

## DESIGN.md Requirements

`DESIGN.md` should include visual recipes for:

- Inputs.
- Labels.
- Help text.
- Validation messages.
- Focus-visible.
- Disabled/read-only.
- Required markers if used.
- Field groups.
- Form actions.
- Inline alerts.
- Toasts or banners only when they are part of the flow.

State colors must have accessible foreground/background pairings.

## QA Checklist

Verify:

- Keyboard reaches every control in logical order.
- Labels and accessible names exist.
- Focus ring is visible.
- Required fields and errors are announced or discoverable.
- Submit is not enabled/disabled in a confusing way.
- Input values survive validation errors.
- Mobile text does not clip inside fields or buttons.
- Touch targets are large enough.
- Loading and error states do not shift layout unnecessarily.
