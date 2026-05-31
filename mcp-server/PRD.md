# PRD: Harbor Grid Energy Site

## Product Context
- Product type: compact marketing website for a fictional neighborhood energy planning service.
- Working name: Harbor Grid.
- Core offer: help waterfront property managers compare solar, battery, and outage-readiness options before requesting a consultation.
- Delivery format: single-page browser app built with plain HTML, CSS, and JavaScript.
- Run context: Comet-AI Expanded App/Site preset, build mode, run 2.
- Primary page must be immediately openable from `index.html` without a build step.

## Source Material
- No external brand, customer, or legal source material was provided.
- Product facts must remain fictional and modest.
- Copy should avoid regulated utility claims, performance guarantees, and invented certifications.
- The final site may use lightweight CSS shapes or gradients as product-relevant energy/map visuals.
- No large embedded assets, remote media dependencies, or generated image files are required.

## Website or App Goal
- Present Harbor Grid as a practical planning service for resilient building energy upgrades.
- Let visitors understand the offer, compare planning priorities, and choose a consultation path.
- Demonstrate real interaction state through selectable priorities, a readiness checklist, or a simple estimate panel.
- Keep the experience compact enough for preset validation while feeling like a finished small site.

## Positioning
- First-viewport positioning: "Harbor Grid" must appear as the primary brand signal.
- First viewport should explain that the site helps teams plan solar, storage, and outage readiness for waterfront buildings.
- The hero must include one primary CTA for starting a readiness check and one secondary CTA for viewing proof or approach content.
- The bottom of the first viewport should hint at the next proof or planning section on both mobile and desktop.
- Tone: grounded, operational, specific, and calm.
- Avoid generic hype such as "revolutionary," "AI-powered," or unsupported savings claims.

## Target Users
- Small commercial property owners managing coastal or waterfront buildings.
- Facilities managers responsible for uptime, tenant comfort, and emergency planning.
- Local real-estate operators comparing upgrade options before engaging vendors.
- Sustainability coordinators who need a clear planning narrative for internal stakeholders.

## User Problems
- Users know they need better outage readiness but do not know which upgrades to sequence first.
- Users struggle to compare solar, battery storage, load priorities, and grant-readiness in one place.
- Users need a concise explanation they can share with owners or operations teams.
- Users want to avoid vendor-heavy sales language before they understand their own readiness gaps.

## Value Proposition
- Harbor Grid turns messy resilience planning into a short, understandable site experience.
- The page helps visitors identify priority loads, building constraints, and likely next planning steps.
- The app should make a consultation feel like the natural next action, not a hard sell.
- The user leaves with a clearer sense of readiness and why a planning call could be useful.

## Primary Outcomes
- Visitor understands the service category within five seconds.
- Visitor can interact with at least one control that changes visible page state.
- Visitor sees proof-style content describing methods, deliverables, or example outcomes.
- Visitor can reach a consultation CTA from the hero and final section.
- Reviewer can verify the app works from static files and passes the provided verifier script.

## Non-Goals
- Do not build an account system, payment flow, or real lead capture backend.
- Do not calculate real energy savings, incentives, financing, or engineering outputs.
- Do not claim utility approval, emergency compliance, or guaranteed uptime.
- Do not depend on frameworks, package installation, network APIs, or remote assets.
- Do not create unrelated documentation beyond the required preset files and role artifacts.

## Core Pages or Screens
- Single home page: brand header, hero, planning interaction, proof sections, process section, CTA footer.
- Optional in-page navigation anchors may target sections on the same page.
- No additional routes are required.
- Mobile layout must preserve all primary content and controls.

## Content Requirements
- Hero: brand name, category statement, short value copy, two CTAs, and product-relevant visual area.
- Planning interaction: at least three selectable priorities such as outage loads, roof readiness, and budget timing.
- Readiness output: visible state summary that updates when the user changes a selection.
- Proof content: three concise proof points about site survey, load mapping, and phased roadmap.
- Process content: three to four steps from intake through recommendation.
- Conversion content: final CTA inviting the visitor to request a resilience planning review.
- SEO metadata: page title and description should mention Harbor Grid and energy resilience planning.

## Feature Requirements
- Use semantic HTML landmarks: header, main, section, footer.
- Include keyboard-accessible buttons or form controls for the interaction.
- JavaScript must initialize a default state and update visible copy when controls change.
- Include at least one responsive navigation or CTA behavior appropriate for a small static page.
- Keep all app logic in `app.js`, styling in `styles.css`, and markup in `index.html`.
- `preset_manifest.json` must describe the preset, run number, graph shape, and expected files.
- `verify_preset.mjs` must check required file existence and JSON syntax, then print a short success line.

## UX Requirements
- The first viewport must clearly name the brand/product and leave a hint of the next section.
- The page should feel like a useful marketing site, not a documentation dump.
- CTAs must be easy to find and repeated at sensible moments.
- Interaction state changes must be visible without requiring page reloads.
- Section order should move from offer clarity to planning interaction to proof to conversion.
- Copy should stay concise enough for scanning on mobile.

## Accessibility Requirements
- Use real text for all critical content.
- Maintain visible focus states for interactive elements.
- Do not rely on color alone to communicate selected state.
- Provide sufficient color contrast for body copy, CTAs, and status text.
- Respect reduced-motion preferences if animation is used.
- Buttons must have clear accessible names.
- Page structure should follow a logical heading order.

## Privacy, SEO, or Platform Requirements
- No personal data should be collected in the MVP.
- CTA links may point to `mailto:` or in-page anchors only.
- No analytics scripts, cookies, or third-party embeds.
- Include viewport metadata for responsive behavior.
- The site must run locally by opening `index.html` or serving the folder with a simple static server.

## Success Metrics
- Static verifier passes with all expected final files once downstream nodes finish.
- First viewport passes the marketing-site rubric for brand clarity and next-section hint.
- At least one interaction updates content in response to user choice.
- Page remains readable and usable at mobile and desktop widths.
- README explains the preset, run number, graph shape, local open/run command, and output files.

## Open Questions
- Final visual direction is owned by `frontend_designer`.
- Section/component architecture is owned by `frontend_architect`.
- Exact copy and styling may be tightened by builders and reviewers if they preserve these product decisions.
- No real business owner, jurisdiction, or service area was supplied; keep location references general.

## MVP Acceptance Criteria
- `PRD.md` exists and defines product scope, audience, conversion path, proof needs, and acceptance criteria.
- `branch-artifacts/frontend_product.md` records product decisions and pending downstream work.
- Downstream agents can build a compact static marketing app from this brief without needing extra product discovery.
- Product requirements stay separate from visual design and implementation architecture.
- Missing downstream files are treated as pending context for this node, not as a product-node failure.
