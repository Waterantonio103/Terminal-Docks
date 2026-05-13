---
id: frontend_polish_review
title: Frontend Polish Review
roles:
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
  - visual_review
  - accessibility_review
  - interaction_qa
  - final_review
source:
  name: "Impeccable; Designer Skills Collection"
  url: "https://github.com/pbakaus/impeccable; https://github.com/Owl-Listener/designer-skills"
  license: "Apache-2.0; MIT"
status: draft_review
---

# Frontend Polish Review

Use this skill when reviewing a built frontend experience. It is a high-bar craft checklist for visual quality, UX, states, accessibility, and responsive behavior.

## Review Inputs

Read before judging:

- Accepted `PRD.md`.
- Accepted `DESIGN.md`.
- Accepted `structure.md` or accepted alias.
- Builder handoff.
- Test or build output.
- Browser screenshots or visible-output evidence when available.

Review against the accepted specs first. Use this skill to catch quality failures the specs may not spell out.

## Optional Pattern Library

If the build uses a Neuform-derived pattern from `mcp-server/src/resources/frontend-patterns/neuform/index.json`, review against that pattern's guardrails as well as the accepted specs.

Check:

- The selected pattern was appropriate for the category and role.
- The implementation translated the pattern into concrete UI, not just a decorative layer.
- Required fallbacks, especially reduced motion for animated effects, are present.
- The effect supports product proof, CTA clarity, and readability.
- The result still passes accessibility and responsive checks.

Do not require a Neuform pattern when the accepted specs do not call for one.

## Verdict Levels

Use a clear verdict:

- Pass: no material defects.
- Pass with notes: minor issues that do not block the requested outcome.
- Fix required: material defects in spec compliance, accessibility, responsiveness, interaction states, or visual quality.
- Rework required: the implementation misses the product category, visual direction, or core user experience.

Lead with findings. Do not bury blocking issues after praise.

## First Viewport Test

The first viewport must answer:

- What is this?
- Who is it for?
- What can the user do next?
- What visual world or working context is this in?

For brand and marketing pages:

- Product/brand/category must be obvious within seconds.
- The primary CTA must be visible and visually dominant.
- There must be a real visual anchor: product, place, person, object, screenshot, game scene, artifact, media, or code-native scene.
- A hint of the next section should be visible when the page is a scroll experience.

For product UI:

- The user should land in the working surface, not a decorative welcome page unless onboarding is the task.
- Primary entities, filters, actions, and current state should be scannable.
- The UI should feel usable by someone fluent in the category.

Blocking failures:

- Generic gradient hero.
- Product only appears as tiny nav text.
- No clear CTA.
- Missing required screenshot/media/object.
- Product tool looks like a marketing page.
- Marketing page looks like a dashboard.

## AI Slop Review

Flag these patterns:

- Same centered section repeated from top to bottom.
- Icon plus heading plus paragraph cards as the default section body.
- Generic dark blue/purple SaaS palette.
- Beige editorial page without a subject-specific reason.
- Glass cards everywhere.
- Gradient text.
- Big metric hero strip with no product proof.
- Decorative orbs, bokeh blobs, or meaningless abstract shapes.
- Section copy that could apply to any app in the category.
- Overly smooth but content-empty product screenshots.

Ask: could someone guess the palette and layout from the category alone? If yes, the design lacks specific direction.

## Visual Hierarchy

Check:

- One dominant idea per viewport or work area.
- Clear primary, secondary, and tertiary actions.
- Headings fit their containers and context.
- Body copy has readable measure and contrast.
- Section rhythm varies where appropriate.
- Dense UI still has scan lanes.
- Important information is not hidden behind decoration.
- Visual treatments are consistent enough to feel designed.

Common defects:

- Everything has the same weight.
- Cards compete with CTAs.
- Hero text sits on busy media without a readable veil.
- Supporting stats overpower the headline.
- Product UI labels are too large or too decorative.
- Empty space appears accidental.
- Related elements are separated while unrelated elements are visually grouped.
- Too many elements are highlighted, so the primary action or selected state no longer stands out.
- Containers are doing work that spacing could have done more quietly.

## Layout and Responsive Review

Inspect at least:

- Mobile narrow.
- Tablet or small laptop.
- Desktop wide.

Look for:

- Text overlap.
- Clipping.
- Unintended horizontal scrolling.
- Buttons that wrap poorly.
- Cards with uneven height because content was not planned.
- Hero media cropping away the actual subject.
- Tables squeezed until columns are useless.
- Nav that requires hover on touch devices.
- Large blank zones caused by fixed heights.
- Sticky/fixed elements covering content.

Responsive fixes should preserve the concept. Do not accept a mobile layout that removes all meaningful atmosphere, product proof, or task context.

Use a quick grouping audit:

- Squint at the page. Groups should be legible before reading text.
- Labels should be closer to their controls than to neighboring fields.
- Actions should sit near the content they affect.
- Section headings should feel attached to their section, not the previous one.
- Borders, panels, and card surfaces should clarify grouping, not decorate every cluster.

## Interaction Review

Every interactive element should be understandable and operable.

Check:

- Keyboard tab order.
- Focus-visible styles.
- Hover and active feedback.
- Disabled states.
- Loading states.
- Empty states.
- Error and success states where relevant.
- Selected/current states for nav, filters, tabs, rows, or chips.
- No hover-only functionality.
- Touch target size on mobile.

Product UI must not ship half-defined components. If a form, table, filter, queue, editor, or media control exists, its states need to be designed.

## Accessibility Review

Block for:

- Missing semantic labels on inputs.
- Icon-only controls without accessible names.
- Meaningful images without useful alt text.
- Decorative visuals exposed as noisy content.
- Poor contrast for body text, labels, or controls.
- Focus ring invisible on the real background.
- Motion that ignores reduced-motion preferences when it is substantial.
- Incorrect heading order that harms navigation.
- Color-only status communication.

Prefer specific findings:

```text
Fix required: the selected queue row is indicated only by cyan color. Add text, icon, or aria-current/selected state plus non-color visual treatment.
```

## Copy Review

Good UI copy is specific and short.

Flag:

- Restating the heading in the paragraph.
- Vague hype such as revolutionary, seamless, next-gen, powerful, magic.
- CTA labels that do not describe the action.
- Error copy that does not say how to recover.
- Fictional claims that sound factual without support.
- Marketing claims that exceed the PRD.

For landing pages, copy should move from hook to proof to conversion. For product UI, copy should reduce cognitive load.

## Performance and Implementation Smell

Review visible performance where possible:

- Avoid large unoptimized images above the fold.
- No broken asset paths.
- No layout shift from late-loading media without dimensions.
- No expensive effects covering the entire viewport without need.
- No needless dependency for a small visual effect.
- No rasterized UI text.

If browser evidence is unavailable, note the gap rather than pretending the visual review is complete.

## Finding Format

Use this format for material issues:

```text
Fix required: [specific problem]
Where: [file/section/screenshot/viewport]
Why it matters: [spec, accessibility, UX, or visual impact]
Expected fix: [concrete correction]
```

Keep review actionable. Do not say "make it better" without naming the defect and expected direction.

## Approval Bar

Approve only when:

- The build satisfies accepted PRD, DESIGN, and structure requirements.
- The first viewport/product surface communicates the right thing.
- Required visual ingredients survived into code.
- Responsive layouts work without overlap or incoherent cropping.
- Interaction states are present.
- Accessibility basics are covered.
- The result does not look like generic AI output for its category.
