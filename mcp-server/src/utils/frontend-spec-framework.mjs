export const FRONTEND_SPEC_MODES = {
  fast: {
    label: 'Fast mode',
    intent: 'Infer reasonable specs from the prompt and ask only when blocked.',
    requiredContext: ['product decisions', 'visual decisions', 'implementation plan'],
    durableArtifacts: ['README.md'],
    gateLevel: 'warn',
  },
  aligned: {
    label: 'Aligned mode',
    intent: 'Inspect supplied artifacts, record missing product/structure decisions in workspace context, create DESIGN.md only when durable UI guidance is needed, then build from accepted context.',
    requiredContext: ['product decisions', 'visual decisions', 'implementation plan'],
    durableArtifacts: ['DESIGN.md', 'README.md'],
    gateLevel: 'block_on_missing_required',
  },
  strict_ui: {
    label: 'Strict UI mode',
    intent: 'Require accepted product, design, and structure decisions, category rubric, screenshot review, accessibility checks, and a fix pass.',
    requiredContext: ['product decisions', 'visual decisions', 'implementation plan', 'visual-qa-evidence'],
    durableArtifacts: ['DESIGN.md', 'README.md'],
    gateLevel: 'block_on_missing_required',
  },
};

export const FRONTEND_SPEC_SCHEMAS = {
  'PRD.md': {
    purpose: 'Product intent and acceptance criteria. Do not use it for visual styling or implementation structure.',
    requiredSections: [
      'Product Context',
      'Source Material',
      'Website or App Goal',
      'Positioning',
      'Target Users',
      'User Problems',
      'Value Proposition',
      'Primary Outcomes',
      'Non-Goals',
      'Core Pages or Screens',
      'Content Requirements',
      'Feature Requirements',
      'UX Requirements',
      'Accessibility Requirements',
      'Privacy, SEO, or Platform Requirements',
      'Success Metrics',
      'Open Questions',
      'MVP Acceptance Criteria',
    ],
    fillInPrompts: [
      'What product, brand, or feature is being built?',
      'Who uses it, and what concrete job are they trying to complete?',
      'What must the first viewport or first screen communicate?',
      'Which claims, capabilities, integrations, or data freshness promises are unsupported?',
      'Which pages, routes, flows, or states are required for the first useful version?',
      'What exact acceptance criteria will reviewers use to approve or reject the build?',
    ],
    qualityChecks: [
      'Names the product type and audience without relying on generic marketing language.',
      'Lists concrete user workflows and content requirements.',
      'Separates required behavior from non-goals and open questions.',
      'Includes accessibility and privacy/platform requirements when relevant.',
      'Provides testable acceptance criteria.',
    ],
  },
  'DESIGN.md': {
    purpose: 'Visual decisions and design constraints. Do not use it for product scope or route architecture.',
    structuredBlock: 'Use the canonical design-system frontmatter/template shape. Fill every field with exact, product-specific values; do not copy sample values or leave broad adjectives where tokens, measurements, or component recipes are required.',
    canonicalTemplate: {
      frontmatter: {
        version: 'A short spec version string such as "alpha".',
        name: 'Exact product/page/screen name.',
        description: 'One compact paragraph naming product type, audience, and UI purpose.',
        colors: {
          primary: 'Exact hex.',
          secondary: 'Exact hex.',
          tertiary: 'Exact hex or null if intentionally unused.',
          neutral: 'Exact hex.',
          background: 'Exact hex or CSS color.',
          surface: 'Exact hex or rgba.',
          'surface-raised': 'Exact hex or rgba.',
          'text-primary': 'Exact hex.',
          'text-secondary': 'Exact hex.',
          border: 'Exact hex or rgba.',
          accent: 'Exact hex.',
          success: 'Exact hex when states exist.',
          warning: 'Exact hex when states exist.',
          danger: 'Exact hex when states exist.',
        },
        typography: {
          'display-lg': 'Exact family, size, weight, line-height, letter-spacing.',
          'heading-md': 'Exact family, size, weight, line-height, letter-spacing.',
          'body-md': 'Exact family, size, weight, line-height.',
          'label-md': 'Exact family, size, weight, line-height, letter-spacing, transform.',
          'mono-sm': 'Exact family, size, weight, line-height when technical labels/data exist.',
        },
        rounded: {
          sm: 'Exact px/rem.',
          md: 'Exact px/rem.',
          lg: 'Exact px/rem.',
          full: 'Exact px/rem.',
        },
        spacing: {
          base: 'Exact base unit.',
          sm: 'Exact step.',
          md: 'Exact step.',
          lg: 'Exact step.',
          xl: 'Exact step.',
          gap: 'Exact common gap.',
          'card-padding': 'Exact padding.',
          'section-padding': 'Exact desktop/tablet/mobile values when responsive.',
          'content-max': 'Exact max width.',
        },
        components: {
          'button-primary': 'Exact background, text, border, radius, padding/min-height, typography, hover, focus.',
          'button-secondary': 'Exact background, text, border, radius, padding/min-height, typography, hover, focus.',
          card: 'Exact background, border, radius, padding, shadow/blur, hover/focus when interactive.',
          'nav/header': 'Exact surface, height/padding, behavior, link style, responsive behavior.',
          'hero/media': 'Exact first-viewport media composition, asset motifs, overlays, and crop rules when applicable.',
        },
      },
      bodySections: [
        'Overview',
        'Colors',
        'Typography',
        'Layout',
        'Spacing',
        'Elevation and Depth',
        'Shapes',
        'Components',
        'Iconography',
        'Motion',
        'Responsive Behavior',
        "Do's and Don'ts",
        'Accessibility Notes',
        'Builder Handoff',
      ],
    },
    requiredSections: [
      'Overview',
      'Design Tokens',
      'Colors',
      'Typography',
      'Layout',
      'Spacing',
      'Elevation and Depth',
      'Shapes',
      'Components',
      'Iconography',
      'Motion',
      'Responsive Behavior',
      "Do's and Don'ts",
      'Accessibility Notes',
      'Builder Handoff',
    ],
    fillInPrompts: [
      'What visual tone fits this product category and target user?',
      'Define an exact color system: primary, secondary, tertiary, neutral, background, surface, raised surface, text, border, accent, and semantic state colors using hex/rgba values.',
      'Define an exact typography system: named display, heading, body, label, and optional mono styles with family, size, weight, line-height, and letter-spacing.',
      'Define exact spacing, radius, content-width, grid, first-viewport, and section rhythm rules.',
      'Define exact component recipes for primary button, secondary button, card/surface, nav/header, hero/media, form/table/media modules as relevant, including default, hover, focus, active, disabled, and responsive states.',
      'What visual mistakes must agents avoid for this category?',
    ],
    qualityChecks: [
      'Defines decisions agents must implement instead of copying one generic style.',
      'Includes enough token detail to make CSS/component implementation deterministic.',
      'Uses the canonical frontmatter/template structure with exact values for colors, typography, spacing, radii, and component recipes.',
      'Describes responsive behavior and interaction states.',
      'Avoids unsupported fonts, colors, or animation intensity unless justified.',
      'Includes concrete do/don\'t rules that reviewers can enforce.',
    ],
  },
  'structure.md': {
    purpose: 'Information architecture and implementation structure. Do not use it for visual taste or product positioning.',
    aliases: ['architecture.md'],
    requiredSections: [
      'Purpose',
      'Recommended Route or Screen Map',
      'Global Layout',
      'Page or Screen Structure',
      'Recommended Content Components',
      'Recommended File Structure',
      'Content Data Model',
      'Suggested Initial Copy Blocks',
      'Implementation Notes',
      'Launch or Test Checklist',
    ],
    fillInPrompts: [
      'Which routes, screens, sections, or flows are required?',
      'What shared layout and navigation patterns should every page or screen use?',
      'Which reusable components should be built?',
      'What data models or mock data are needed to make visuals credible?',
      'What generated app folder and subfolders should own source, assets, styles, scripts, docs, and tests?',
      'Which launch and verification steps must run before completion?',
    ],
    qualityChecks: [
      'Routes/screens match the PRD and are implementation-ready.',
      'Sections are ordered by user value, not by generic page templates.',
      'Names reusable components and data objects clearly.',
      'Includes a tidy generated project structure with conventional subfolders instead of placing every file at the workspace root.',
      'Lists concrete verification steps for navigation, states, responsiveness, and launch.',
    ],
  },
};

export const FRONTEND_CATEGORY_OVERLAYS = {
  admin_internal_tool: {
    label: 'Admin or internal operations tool',
    cues: ['admin', 'internal', 'operations console', 'dispatch', 'moderation', 'back office', 'queue', 'audit'],
    requiredAdditions: {
      'PRD.md': ['Operational entities', 'Roles and permissions', 'Status taxonomy', 'Auditability requirements', 'Realistic operational data'],
      'DESIGN.md': ['Dense scanning layout', 'Severity/status states', 'Table and filter behavior', 'Quiet utilitarian tone'],
      'structure.md': ['Entity detail screens', 'Queue/list views', 'Filters and bulk actions', 'Audit/history panels'],
    },
    rubric: [
      'Prioritizes dense, scannable information over marketing-style hero layouts.',
      'Shows realistic entities, statuses, filters, timestamps, owners, and next actions.',
      'Makes severity and state visible without relying only on color.',
      'Includes audit/history, permissions, empty/loading/error states, and operational handoffs.',
    ],
  },
  docs_portal: {
    label: 'Documentation or content portal',
    cues: ['docs', 'documentation', 'api reference', 'quickstart', 'migration', 'changelog', 'developer portal'],
    requiredAdditions: {
      'PRD.md': ['Quickstart path', 'API/reference scope', 'Versioning', 'Security notes', 'Contribution or source links'],
      'DESIGN.md': ['Readable docs layout', 'Code block treatment', 'Search/version UI states', 'Subtle technical visual system'],
      'structure.md': ['Sidebar and table of contents', 'Search flow', 'API symbol pages', 'Migration/changelog pages'],
    },
    rubric: [
      'Makes quickstart, API reference, integrations, examples, migration, changelog, and security easy to reach.',
      'Includes searchable, copyable, labeled code blocks and deep-linkable headings.',
      'Shows version awareness and flags deprecated or experimental content.',
      'Keeps reading and search performance ahead of decoration.',
    ],
  },
  saas_dashboard: {
    label: 'SaaS dashboard or product site',
    cues: ['saas', 'dashboard', 'analytics', 'platform', 'workspace', 'subscription', 'integrations'],
    requiredAdditions: {
      'PRD.md': ['Dashboard modules', 'Metric definitions', 'Integrations', 'Pricing or evaluation path', 'Security/trust expectations'],
      'DESIGN.md': ['Metric cards and charts', 'Integration visual language', 'CTA hierarchy', 'Dashboard mockup constraints'],
      'structure.md': ['Product overview sections', 'Dashboard modules', 'Pricing/demo path', 'Integration/security routes'],
    },
    rubric: [
      'Defines metrics and dashboard modules with realistic labels and data.',
      'Balances conversion CTAs with credible product depth.',
      'Includes integrations, security/trust, and evaluation path content.',
      'Avoids vague analytics panels that do not prove the product workflow.',
    ],
  },
  consumer_mobile_app: {
    label: 'Consumer or mobile app',
    cues: ['mobile app', 'consumer', 'onboarding', 'habit', 'fitness', 'finance app', 'social', 'account'],
    requiredAdditions: {
      'PRD.md': ['Onboarding', 'Core user loop', 'Account/privacy needs', 'Progress and notification states', 'Safety constraints'],
      'DESIGN.md': ['Touch targets', 'Mobile-first layout', 'Progress states', 'Friendly but task-specific tone'],
      'structure.md': ['Onboarding flow', 'Core tabs/screens', 'Settings/account', 'Empty/loading/error/success states'],
    },
    rubric: [
      'Defines the first-run path and repeated core loop.',
      'Includes privacy, safety, account, notification, and progress states where relevant.',
      'Uses mobile-safe touch targets and responsive constraints.',
      'Shows concrete user examples rather than placeholder lifestyle copy.',
    ],
  },
  marketing_site: {
    label: 'Marketing or brand website',
    cues: ['landing page', 'marketing site', 'website', 'brand site', 'portfolio', 'venue', 'product page'],
    requiredAdditions: {
      'PRD.md': ['First-viewport positioning', 'Conversion path', 'Proof sections', 'Content and SEO requirements'],
      'DESIGN.md': ['Hero media direction', 'CTA hierarchy', 'Section rhythm', 'Visual asset requirements'],
      'structure.md': ['Home sections', 'CTA placement', 'Proof/content sections', 'Metadata and launch checklist'],
    },
    rubric: [
      'First viewport clearly names the brand/product/category and leaves a hint of the next section.',
      'Uses real or generated relevant visuals instead of decorative placeholders.',
      'Includes a clear conversion path and proof content.',
      'Keeps copy specific to the product and avoids unsupported claims.',
    ],
  },
};

export const FRONTEND_INTAKE_STEPS = [
  'Classify the frontend category before writing or accepting specs.',
  'Collect user-supplied PRD, DESIGN, structure/architecture, screenshots, brand files, content, and repository context.',
  'Grade supplied files for coverage, specificity, contradictions, freshness, and buildability.',
  'Preserve strong user files as accepted artifacts.',
  'Patch or append missing sections with provenance instead of overwriting user files when the file already exists.',
  'When PRD.md or structure.md is missing, record the required product or implementation decisions in workspace context instead of creating a new planning file by default.',
  'Create or patch DESIGN.md for UI work when durable visual tokens, component recipes, or builder handoff rules are needed.',
  'Ask at most a few targeted questions when product type, audience, visual tone, core states, or hard constraints materially affect quality.',
  'Run an alignment check across accepted product, design, and structure decisions before implementation starts, including the generated app folder and subfolder layout.',
  'Treat accepted spec paths and workspace-context sections as binding handoff references for builders and reviewers.',
];

export const FRONTEND_ALIGNMENT_CHECKS = [
  'Product type matches across all accepted specs.',
  'Audience and primary user problem match across PRD and structure.',
  'Visual tone in DESIGN supports the product type and content density in PRD.',
  'Routes/screens in structure cover the required experiences in PRD.',
  'Core states, constraints, accessibility requirements, and acceptance criteria are represented in implementation notes.',
  'Open questions are either answered, explicitly deferred, or called out as build risks.',
];

export function classifyFrontendCategory(input = '') {
  const text = String(input).toLowerCase();
  let best = { id: 'marketing_site', score: 0 };
  for (const [id, overlay] of Object.entries(FRONTEND_CATEGORY_OVERLAYS)) {
    const score = overlay.cues.filter(cue => matchesCue(text, cue)).length;
    if (score > best.score) best = { id, score };
  }
  return {
    categoryId: best.id,
    category: FRONTEND_CATEGORY_OVERLAYS[best.id],
    confidence: best.score > 0 ? 'medium' : 'low',
  };
}

function isNegatedCue(text, cue) {
  let index = text.indexOf(cue);
  while (index >= 0) {
    const before = text.slice(Math.max(0, index - 32), index);
    if (/(?:\bnot\b|\bavoid\b|\bno\b|\bwithout\b|instead of)\W+(?:\w+\W+){0,3}$/.test(before)) {
      return true;
    }
    index = text.indexOf(cue, index + cue.length);
  }
  return false;
}

function matchesCue(text, cue) {
  return text.includes(cue) && !isNegatedCue(text, cue);
}

export function buildFrontendSpecFramework({ categoryId, mode = 'aligned' } = {}) {
  const selectedCategory = categoryId && FRONTEND_CATEGORY_OVERLAYS[categoryId]
    ? categoryId
    : 'marketing_site';
  return {
    version: '2026-05-10',
    mode: FRONTEND_SPEC_MODES[mode] ? mode : 'aligned',
    modeConfig: FRONTEND_SPEC_MODES[FRONTEND_SPEC_MODES[mode] ? mode : 'aligned'],
    categoryId: selectedCategory,
    category: FRONTEND_CATEGORY_OVERLAYS[selectedCategory],
    schemas: FRONTEND_SPEC_SCHEMAS,
    intakeSteps: FRONTEND_INTAKE_STEPS,
    alignmentChecks: FRONTEND_ALIGNMENT_CHECKS,
  };
}

function normalizeText(value) {
  return String(value || '').toLowerCase();
}

function sectionPattern(section) {
  const escaped = section.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(`(^|\\n)#{1,6}\\s+${escaped}\\s*(\\n|$)`, 'i');
}

export function evaluateFrontendSpecCoverage({ categoryId = 'marketing_site', suppliedFiles = {} } = {}) {
  const category = FRONTEND_CATEGORY_OVERLAYS[categoryId] ?? FRONTEND_CATEGORY_OVERLAYS.marketing_site;
  const files = ['PRD.md', 'DESIGN.md', 'structure.md'];
  const results = {};
  const missingFiles = [];
  const weakFiles = [];

  for (const fileName of files) {
    const aliases = FRONTEND_SPEC_SCHEMAS[fileName].aliases ?? [];
    const providedName = [fileName, ...aliases].find(name => typeof suppliedFiles[name] === 'string' && suppliedFiles[name].trim());
    const content = providedName ? suppliedFiles[providedName] : '';
    if (!content) {
      missingFiles.push(fileName);
      results[fileName] = {
        providedAs: null,
        coverage: 0,
        status: 'missing',
        missingRequiredSections: FRONTEND_SPEC_SCHEMAS[fileName].requiredSections,
        missingCategoryAdditions: category.requiredAdditions[fileName] ?? [],
      };
      continue;
    }

    const requiredSections = FRONTEND_SPEC_SCHEMAS[fileName].requiredSections;
    const missingRequiredSections = requiredSections.filter(section => !sectionPattern(section).test(content));
    const normalized = normalizeText(content);
    const missingCategoryAdditions = (category.requiredAdditions[fileName] ?? [])
      .filter(addition => !normalized.includes(addition.toLowerCase()));
    const totalChecks = requiredSections.length + (category.requiredAdditions[fileName] ?? []).length;
    const misses = missingRequiredSections.length + missingCategoryAdditions.length;
    const coverage = totalChecks === 0 ? 1 : Number(((totalChecks - misses) / totalChecks).toFixed(2));
    const status = coverage >= 0.8 ? 'accepted' : coverage >= 0.55 ? 'needs_patch' : 'weak';
    if (status !== 'accepted') weakFiles.push(fileName);

    results[fileName] = {
      providedAs: providedName,
      coverage,
      status,
      missingRequiredSections,
      missingCategoryAdditions,
    };
  }

  const alignmentRisks = [];
  const combined = normalizeText(Object.values(suppliedFiles).join('\n'));
  if (combined && !Object.keys(FRONTEND_CATEGORY_OVERLAYS).some(id => id === categoryId)) {
    alignmentRisks.push(`Unknown category '${categoryId}', used marketing_site rubric.`);
  }
  if (missingFiles.length > 0) alignmentRisks.push(`Missing files: ${missingFiles.join(', ')}.`);
  if (weakFiles.length > 0) alignmentRisks.push(`Files need patching before build: ${weakFiles.join(', ')}.`);

  const actionForMissingFile = file => {
    if (file === 'DESIGN.md') return 'Generate DESIGN.md from the framework schema when durable UI guidance is needed.';
    if (file === 'PRD.md') return 'Record product decisions in frontendSpecs workspace context unless the user explicitly wants PRD.md created.';
    if (file === 'structure.md') return 'Record route/component/file ownership decisions in frontendPlan workspace context unless the user explicitly wants structure.md created.';
    return `Resolve missing ${file}.`;
  };
  const actionForWeakFile = file => {
    if (file === 'DESIGN.md') return 'Patch DESIGN.md by appending missing sections with provenance.';
    return `Patch the supplied ${file} only if the user provided it as a durable source; otherwise record the missing decisions in workspace context.`;
  };

  return {
    categoryId: FRONTEND_CATEGORY_OVERLAYS[categoryId] ? categoryId : 'marketing_site',
    categoryLabel: category.label,
    status: missingFiles.length === 0 && weakFiles.length === 0 ? 'ready' : 'needs_spec_work',
    files: results,
    alignmentRisks,
    nextActions: [
      ...missingFiles.map(actionForMissingFile),
      ...weakFiles.map(actionForWeakFile),
      'Run alignment checks before implementation starts.',
    ],
  };
}
