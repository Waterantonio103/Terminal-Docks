---
id: frontend_visual_assets
title: Frontend Visual Assets
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

# Frontend Visual Assets

Use this skill when a page or app needs images, screenshots, media, icons, mockups, diagrams, generated bitmaps, or concrete visual references. Assets should prove the subject, clarify the product, or improve usability. They should not hide weak layout.

## Asset Ladder

Choose the highest available rung:

- User-provided brand, product, or content assets.
- Existing repository assets, screenshots, screenshots from the current product, or design files.
- Official public assets from the subject's website, documentation, app store page, press kit, or product pages.
- Curated UI references that show structure, density, treatment, or interaction expectations.
- Specific stock photos for generic subjects where a real subject asset does not exist.
- Generated bitmap assets when a stylized, fictional, or unavailable subject needs a real-looking visual.
- CSS, SVG, canvas, or WebGL visuals only when the subject is abstract, technical, or interaction-led.

Do not use generic decorative imagery when the user needs to inspect the real product, place, object, person, state, or workflow.

## When Assets Are Required

Require real or generated visual assets for:

- Product, venue, portfolio, ecommerce, food, travel, event, personal brand, editorial, campaign, game, object, or place-focused pages.
- Landing page heroes where the first viewport must communicate the actual offer.
- Case studies, galleries, testimonials with people, product showcases, before/after examples, and media-led narratives.
- Apps where data examples, screenshots, avatars, thumbnails, maps, charts, documents, or object previews are part of the workflow.

Images are usually optional for:

- Admin tools.
- Developer tools.
- IDE-like editors.
- Dense dashboards.
- Settings pages.
- Internal operations systems.

For product UI, prefer realistic UI references, mock data, icons, empty states, charts, status examples, and screenshots over decorative photography.

## Reference Types

Use references by job:

- Subject proof: product screenshots, venue photos, people, food, objects, maps, game scenes, app surfaces.
- Layout reference: page structure, density, first viewport composition, nav placement, section rhythm.
- Component reference: card treatment, pricing table, dashboard table, command palette, form stepper, media gallery.
- Asset treatment: crop style, mask, device frame, mockup angle, shadow, captioning, image grid, video treatment.
- Interaction reference: hover state, reveal, scroll behavior, carousel, filtering, drag/drop, split-pane behavior.
- Mood reference: color temperature, surface material, lighting, texture, illustration style.

A reference should guide measurable decisions. Do not tell builders to "copy this site."

## DESIGN.md Requirements

When assets matter, `DESIGN.md` must specify:

- Required asset types and their purpose.
- Source preference: user-provided, repo, official public, stock, generated, or code-native.
- Crop/aspect rules.
- Placement and first-viewport visibility.
- Background veil or contrast treatment for text over media.
- Alt text policy.
- Loading and fallback behavior.
- Responsive crop behavior for mobile and desktop.
- Do-not-use constraints for placeholder or generic imagery.

Example:

```text
Hero requires a visible product screenshot cluster, not an abstract gradient. Desktop crop keeps the left nav and primary chart visible. Mobile switches to one cropped screenshot below the headline. Use a 24px tinted shadow and 1px border; do not wrap the screenshot in a fake browser chrome unless the source app actually uses one.
```

## Builder Rules

Builders should:

- Use existing assets before fetching or generating new ones.
- Preserve aspect ratio and subject visibility.
- Avoid distorted, over-darkened, or overly blurred assets.
- Hide decorative assets from assistive tech.
- Give informative alt text to meaningful assets.
- Use stable dimensions so images do not cause layout shift.
- Verify that remote assets load or provide local fallbacks.
- Use generated bitmaps only when they match the brief and improve subject clarity.

Do not replace a required subject asset with an icon, gradient, or abstract blob.

## Reviewer Rules

Block or request a fix when:

- The first viewport lacks the required visual proof.
- The asset is generic stock that could belong to any site.
- Text sits on a busy image without sufficient contrast.
- The subject is cropped out on mobile.
- The page uses placeholder image boxes.
- The asset contradicts the product, audience, or tone.
- Decorative effects make the UI slower, less readable, or less accessible.

Accept a no-image solution only when the product surface is stronger as pure UI, typography, data, or interaction.
