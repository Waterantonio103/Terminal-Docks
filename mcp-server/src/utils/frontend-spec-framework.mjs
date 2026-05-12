export const FRONTEND_SPEC_MODES = {
  fast: {
    label: 'Fast mode',
    intent: 'Infer reasonable specs from the prompt and ask only when blocked.',
    requiredArtifacts: ['PRD.md', 'DESIGN.md', 'structure.md'],
    gateLevel: 'warn',
  },
  aligned: {
    label: 'Aligned mode',
    intent: 'Inspect supplied artifacts, patch or generate missing specs, then build from accepted files.',
    requiredArtifacts: ['PRD.md', 'DESIGN.md', 'structure.md'],
    gateLevel: 'block_on_missing_required',
  },
  strict_ui: {
    label: 'Strict UI mode',
    intent: 'Require accepted specs, category rubric, screenshot review, accessibility checks, and a fix pass.',
    requiredArtifacts: ['PRD.md', 'DESIGN.md', 'structure.md', 'visual-qa-evidence'],
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
    structuredBlock: 'Prefer frontmatter or a machine-readable token block for palette, typography, spacing, radii, surfaces, and components.',
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
    ],
    fillInPrompts: [
      'What visual tone fits this product category and target user?',
      'Which palette roles, semantic state colors, and contrast constraints apply?',
      'Which typography direction supports the content density and brand?',
      'What spacing rhythm, content width, grid, and section behavior should be used?',
      'Which component treatments, states, icons, and motion patterns are required?',
      'What visual mistakes must agents avoid for this category?',
    ],
    qualityChecks: [
      'Defines decisions agents must implement instead of copying one generic style.',
      'Includes enough token detail to make CSS/component implementation deterministic.',
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
      'Where should files live in the target project?',
      'Which launch and verification steps must run before completion?',
    ],
    qualityChecks: [
      'Routes/screens match the PRD and are implementation-ready.',
      'Sections are ordered by user value, not by generic page templates.',
      'Names reusable components and data objects clearly.',
      'Includes a file structure that can be adapted to the target framework.',
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
  'Classify the frontend category before writing specs.',
  'Collect user-supplied PRD, DESIGN, structure/architecture, screenshots, brand files, content, and repository context.',
  'Grade supplied files for coverage, specificity, contradictions, freshness, and buildability.',
  'Preserve strong user files as accepted artifacts.',
  'Patch or append missing sections with provenance instead of overwriting user files.',
  'Ask at most a few targeted questions when product type, audience, visual tone, core states, or hard constraints materially affect quality.',
  'Run an alignment check across PRD.md, DESIGN.md, and structure.md before implementation starts.',
  'Treat accepted spec paths and sections as binding handoff references for builders and reviewers.',
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
    const score = overlay.cues.filter(cue => text.includes(cue)).length;
    if (score > best.score) best = { id, score };
  }
  return {
    categoryId: best.id,
    category: FRONTEND_CATEGORY_OVERLAYS[best.id],
    confidence: best.score > 0 ? 'medium' : 'low',
  };
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

  return {
    categoryId: FRONTEND_CATEGORY_OVERLAYS[categoryId] ? categoryId : 'marketing_site',
    categoryLabel: category.label,
    status: missingFiles.length === 0 && weakFiles.length === 0 ? 'ready' : 'needs_spec_work',
    files: results,
    alignmentRisks,
    nextActions: [
      ...missingFiles.map(file => `Generate ${file} from the framework schema or ask for the user's existing file.`),
      ...weakFiles.map(file => `Patch ${file} by appending missing sections with provenance.`),
      'Run alignment checks before implementation starts.',
    ],
  };
}
