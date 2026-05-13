---
id: frontend_data_visualization
title: Frontend Data Visualization
roles:
  - frontend_designer
  - frontend_builder
  - interaction_qa
  - accessibility_reviewer
  - visual_polish_reviewer
categories:
  - admin_internal_tool
  - saas_dashboard
  - docs_portal
  - marketing_site
appliesTo:
  - DESIGN.md
  - implementation
  - visual_review
  - accessibility_review
source:
  name: "Designer Skills Collection"
  url: "https://github.com/Owl-Listener/designer-skills"
  license: "MIT"
status: draft_review
---

# Frontend Data Visualization

Use this skill when a frontend includes charts, metrics, telemetry, dashboards, reports, status strips, comparison tables, or visual proof modules. It is not needed for purely static pages without data-like content.

## Start With The Question

Every visualization must answer a specific question.

Examples:

- Which queue item is most urgent?
- How has usage changed over time?
- Which team, plan, region, route, or model performs best?
- Is the current value above or below target?
- What changed since the last period?

If the question is unclear, use a table, stat row, or plain text until the product decision is clearer.

## Chart Selection

Choose the simplest form that answers the question:

- Comparison: bar chart, grouped bars, ranking table, bullet chart.
- Trend over time: line chart, area chart, sparkline.
- Part of whole: stacked bar for many categories, donut only for very few stable categories.
- Distribution: histogram, box plot, density strip.
- Relationship: scatter plot, bubble chart, heat map.
- Status or progress: meter, stepper, progress bar, compact status chip.
- Operational scanning: table, queue, list, timeline, or split detail panel is often better than a chart.

Avoid chart theater. A decorative chart that does not clarify a decision is visual noise.

## Data Design Rules

- Use real or realistic data, not idealized perfect samples.
- Provide labels, units, time ranges, and context.
- Use direct labels when possible instead of distant legends.
- Keep color encoding consistent across views.
- Start bar-chart y-axes at zero.
- Show benchmarks, targets, thresholds, or previous-period context when they matter.
- Annotate important changes instead of making users infer everything.
- Do not over-smooth volatile data when volatility is meaningful.

## Color and Encoding

Color needs a job:

- Sequential scale: ordered low-to-high values.
- Diverging scale: above/below midpoint or good/bad around a target.
- Categorical scale: unrelated groups.
- Semantic states: success, warning, danger, info.

Rules:

- Do not rely on red/green alone.
- Pair color with labels, icons, position, pattern, shape, or text.
- Reserve saturated colors for signals that need attention.
- Keep inactive gridlines and axes quiet.
- In dark mode, desaturate bright chart colors and test contrast against the actual surface.

## Accessibility

Charts must remain understandable without perfect color perception.

Check:

- Text labels and axis labels have readable contrast.
- Interactive charts are keyboard reachable when they expose details.
- Tooltips are not hover-only.
- Important values are available as text, table data, or accessible summaries.
- Color is not the only state indicator.
- Dense charts have enough spacing for touch or keyboard exploration.

For critical product data, provide a table or textual summary alongside the chart.

## Responsive Data Visualization

Do not just shrink a desktop chart.

Mobile strategies:

- Simplify the chart.
- Reduce visible series.
- Increase label size.
- Use horizontal scrolling only when scanning remains readable.
- Swap to a table, list, or stat stack when the chart becomes illegible.
- Put key insight text above the visualization.

Desktop strategies:

- Use available width for comparison, trend resolution, and labels.
- Keep important filters and legends close to the chart.
- Avoid oversized charts with sparse data.

## Product UI vs Marketing Proof

Product UI:

- Accuracy, scan speed, and state clarity matter most.
- Tables, queues, filters, and detail panels can be more useful than decorative charts.
- Include loading, empty, error, stale, selected, and filtered states.

Marketing or landing pages:

- Data-like modules should prove the product or world, not pretend to be functional analytics.
- Keep proof strips compact.
- Avoid fake awards, review scores, or unsupported platform claims.
- Use telemetry, stats, or comparison only when it supports the story.

## Review Checklist

Block or request fixes when:

- The chart type does not match the data question.
- Labels, units, or time range are missing.
- Color encoding changes meaning between sections.
- The chart is unreadable on mobile.
- Values are conveyed only by color.
- The visualization is decorative and does not support a decision or proof point.
- Data looks fake in a way that reduces trust.
- Empty, loading, error, or stale states are missing for product dashboards.
