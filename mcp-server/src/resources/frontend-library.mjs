import { existsSync, readdirSync, readFileSync, statSync } from 'fs';
import { basename, dirname, extname, join, relative } from 'path';
import { fileURLToPath } from 'url';

const RESOURCES_DIR = dirname(fileURLToPath(import.meta.url));
const SKILLS_DIR = join(RESOURCES_DIR, 'frontend-skills');
const NEUFORM_DIR = join(RESOURCES_DIR, 'frontend-patterns', 'neuform');
const REFERENCES_DIR = join(RESOURCES_DIR, 'frontend-references', 'ui');

const IMAGE_MIME_TYPES = new Map([
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
]);

const REFERENCE_GROUPS = {
  'marketing-landing-pages': {
    title: 'Marketing Landing Pages',
    categoryIds: ['marketing_site'],
    useWhen: 'Brand, launch, portfolio, campaign, SaaS marketing, and homepage work.',
    quality: 'strong',
  },
  'saas-dashboards-product-apps': {
    title: 'SaaS Dashboards Product Apps',
    categoryIds: ['saas_dashboard', 'admin_internal_tool'],
    useWhen: 'Authenticated product surfaces, dashboards, tables, settings, app shells, and operational views.',
    quality: 'mixed_but_useful',
    caution: 'Airtable and Retool lean explainer/docs; use them for layout ideas, not product UI fidelity.',
  },
  'docs-developer-portals': {
    title: 'Docs Developer Portals',
    categoryIds: ['docs_portal'],
    useWhen: 'Documentation, API reference, changelog, developer onboarding, quickstart, and CLI/API education.',
    quality: 'strong',
  },
  'forms-onboarding-checkout': {
    title: 'Forms Onboarding Checkout',
    categoryIds: ['consumer_mobile_app', 'saas_dashboard', 'admin_internal_tool'],
    useWhen: 'Auth, onboarding, checkout, checkout-like setup flows, settings forms, and validation-heavy workflows.',
    quality: 'thin_but_useful',
    caution: 'Clerk and Shopify are the strongest examples; Typeform is weaker and more marketing-oriented.',
  },
  'visual-asset-heavy-sites': {
    title: 'Visual Asset Heavy Sites',
    categoryIds: ['marketing_site', 'consumer_mobile_app'],
    useWhen: 'Pages where real imagery, product media, editorial composition, or portfolio assets carry the experience.',
    quality: 'strong',
  },
  'high-polish-experimental-sites': {
    title: 'High Polish Experimental Sites',
    categoryIds: ['marketing_site'],
    useWhen: 'Optional inspiration for motion, WebGL, immersive effects, unusual navigation, or premium campaign polish.',
    quality: 'strong_but_guardrailed',
    caution: 'Use as effect inspiration only when the task can support it. Do not copy experimental density into task UIs.',
  },
};

const ROLE_SKILL_RECOMMENDATIONS = {
  frontend_product: ['frontend_content_specificity'],
  frontend_designer: [
    'frontend_design_spec_authoring',
    'frontend_design_craft',
    'frontend_visual_assets',
    'frontend_pattern_selection',
  ],
  frontend_architect: ['frontend_product_ui_patterns', 'frontend_forms_states', 'frontend_data_visualization'],
  frontend_builder: [
    'frontend_build_craft',
    'frontend_product_ui_patterns',
    'frontend_forms_states',
    'frontend_data_visualization',
    'frontend_pattern_selection',
  ],
  interaction_qa: ['frontend_browser_visual_qa', 'frontend_forms_states'],
  accessibility_reviewer: ['frontend_polish_review', 'frontend_browser_visual_qa'],
  visual_polish_reviewer: [
    'frontend_polish_review',
    'frontend_design_craft',
    'frontend_visual_assets',
    'frontend_pattern_selection',
  ],
};

function listFiles(root, predicate = () => true) {
  if (!existsSync(root)) return [];
  const output = [];
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      output.push(...listFiles(path, predicate));
    } else if (entry.isFile() && predicate(path)) {
      output.push(path);
    }
  }
  return output.sort((a, b) => a.localeCompare(b));
}

function parseFrontmatter(text) {
  if (!text.startsWith('---')) return {};
  const end = text.indexOf('\n---', 3);
  if (end === -1) return {};
  const frontmatter = text.slice(3, end).trim().split(/\r?\n/);
  const metadata = {};
  let currentKey = null;
  for (const rawLine of frontmatter) {
    const line = rawLine.replace(/\r$/, '');
    const keyValue = /^([A-Za-z0-9_-]+):\s*(.*)$/.exec(line);
    if (keyValue) {
      currentKey = keyValue[1];
      const value = keyValue[2].trim();
      metadata[currentKey] = value ? value.replace(/^"|"$/g, '') : [];
      continue;
    }
    const listValue = /^\s*-\s*(.*)$/.exec(line);
    if (listValue && currentKey) {
      if (!Array.isArray(metadata[currentKey])) metadata[currentKey] = [];
      metadata[currentKey].push(listValue[1].trim().replace(/^"|"$/g, ''));
    }
  }
  return metadata;
}

function imageDimensions(path) {
  const ext = extname(path).toLowerCase();
  if (ext !== '.png') return {};
  const buffer = readFileSync(path);
  if (buffer.length < 24 || buffer.toString('ascii', 1, 4) !== 'PNG') return {};
  return {
    width: buffer.readUInt32BE(16),
    height: buffer.readUInt32BE(20),
  };
}

function pathToSlug(path) {
  return basename(path, extname(path));
}

function buildSkillEntries() {
  return listFiles(SKILLS_DIR, path => extname(path).toLowerCase() === '.md').map(path => {
    const text = readFileSync(path, 'utf8');
    const frontmatter = parseFrontmatter(text);
    const id = frontmatter.id || pathToSlug(path);
    return {
      id,
      title: frontmatter.title || id,
      uri: `frontend-skill://${id}`,
      file: relative(RESOURCES_DIR, path).replaceAll('\\', '/'),
      roles: Array.isArray(frontmatter.roles) ? frontmatter.roles : [],
      categories: Array.isArray(frontmatter.categories) ? frontmatter.categories : [],
      appliesTo: Array.isArray(frontmatter.appliesTo) ? frontmatter.appliesTo : [],
      status: frontmatter.status || 'unknown',
    };
  });
}

function buildNeuformIndex() {
  const indexPath = join(NEUFORM_DIR, 'index.json');
  if (!existsSync(indexPath)) return { entries: [] };
  const parsed = JSON.parse(readFileSync(indexPath, 'utf8'));
  return {
    ...parsed,
    uri: 'frontend-patterns://neuform/index',
    entries: (parsed.entries || []).map(entry => ({
      ...entry,
      uri: `frontend-pattern://neuform/${basename(entry.path, '.md')}`,
    })),
  };
}

function buildReferenceEntries() {
  const files = listFiles(REFERENCES_DIR, path => IMAGE_MIME_TYPES.has(extname(path).toLowerCase()));
  return files.map(path => {
    const category = relative(REFERENCES_DIR, dirname(path)).split(/[\\/]/)[0];
    const fileName = basename(path);
    const group = REFERENCE_GROUPS[category] || {
      title: category,
      categoryIds: [],
      useWhen: 'Use only when this category directly matches the frontend task.',
      quality: 'unrated',
    };
    return {
      id: `${category}/${fileName}`,
      title: `${group.title}: ${basename(fileName, extname(fileName))}`,
      uri: `frontend-reference://ui/${category}/${fileName}`,
      category,
      categoryTitle: group.title,
      fileName,
      mimeType: IMAGE_MIME_TYPES.get(extname(path).toLowerCase()),
      bytes: statSync(path).size,
      ...imageDimensions(path),
    };
  });
}

export function buildFrontendReferenceIndex() {
  const entries = buildReferenceEntries();
  const groups = Object.entries(REFERENCE_GROUPS).map(([id, group]) => ({
    id,
    ...group,
    uri: `frontend-reference://ui/${id}/index`,
    references: entries.filter(entry => entry.category === id),
  }));
  return {
    version: '2026-05-14',
    purpose: 'Curated UI screenshot references for frontend agents. Use for visual calibration, not direct copying.',
    usagePolicy: {
      mandatory: false,
      recommendedSelection: 'Pick 1 to 4 relevant references only when the category, product type, or visual goal matches.',
      sourceOfTruth: 'Explicit user instructions, accepted PRD.md, accepted DESIGN.md, structure.md, brand files, and current code override screenshots.',
      doNotUseFor: 'Hardcoding layouts, copying brands, replacing exact design tokens, or overriding supplied user references.',
    },
    groups,
    totalReferences: entries.length,
  };
}

export function buildFrontendLibraryIndex() {
  const skills = buildSkillEntries();
  const neuform = buildNeuformIndex();
  const references = buildFrontendReferenceIndex();
  return {
    version: '2026-05-14',
    uri: 'frontend-library://index',
    purpose: 'Agent-facing map for optional frontend craft skills, visual effects, and screenshot references.',
    workflow: [
      'Read accepted PRD.md, DESIGN.md, structure.md/architecture.md, user screenshots, brand files, and current code first.',
      'Read this library index to identify relevant skill docs, effects, and reference image groups.',
      'Load only the skill docs needed for your role and task. Do not bulk-load the whole library.',
      'For visual elevation, strongly consider 1 to 3 Neuform effect resources, but only when they fit the product and DESIGN.md.',
      'For calibration, inspect 1 to 4 UI reference images from the matching group when the task benefits from screenshots.',
      'Translate selected skills/effects/references into exact tokens, component recipes, states, responsive rules, and verification steps.',
      'Record which resources influenced the decision in frontendSpecs/frontendPlan or the review artifact.',
    ],
    guardrails: [
      'The library is advisory. Explicit user instructions and accepted spec files are the source of truth.',
      'Do not copy brand-specific layouts, copy, trademarks, or visual identity from reference screenshots.',
      'Do not use effects to hide weak product structure, missing states, poor hierarchy, or generic copy.',
      'Do not select more resources just because they are available. Relevance beats volume.',
      'Theme-picker compatibility must preserve stable ids, groups, intensity, and technical complexity metadata.',
    ],
    roleSkillRecommendations: ROLE_SKILL_RECOMMENDATIONS,
    skills,
    patterns: {
      provider: 'neuform',
      indexUri: 'frontend-patterns://neuform/index',
      totalPatterns: neuform.entries.length,
      recommendationStrength: neuform.usagePolicy?.recommendationStrength || 'heavy_recommend_optional',
      maxPatternsPerTask: neuform.usagePolicy?.maxPatternsPerTask || 3,
      futurePickerSurface: neuform.usagePolicy?.futurePickerSurface || 'Effects',
      pickerGroups: [...new Set(neuform.entries.map(entry => entry.pickerGroup).filter(Boolean))].sort(),
    },
    references: {
      indexUri: 'frontend-reference://ui/index',
      totalReferences: references.totalReferences,
      groups: references.groups.map(group => ({
        id: group.id,
        title: group.title,
        uri: group.uri,
        quality: group.quality,
        count: group.references.length,
        categoryIds: group.categoryIds,
        useWhen: group.useWhen,
        caution: group.caution,
      })),
    },
  };
}

export function registerFrontendLibraryResources(server) {
  server.registerResource('frontend_library_index', 'frontend-library://index', {
    title: 'Frontend Library Index',
    description: 'Overall map for frontend skills, Neuform patterns, and UI reference images.',
    mimeType: 'application/json',
  }, async () => ({
    contents: [{
      uri: 'frontend-library://index',
      mimeType: 'application/json',
      text: JSON.stringify(buildFrontendLibraryIndex(), null, 2),
    }],
  }));

  for (const skill of buildSkillEntries()) {
    const path = join(RESOURCES_DIR, skill.file);
    server.registerResource(`frontend_skill_${skill.id}`, skill.uri, {
      title: skill.title,
      description: `Frontend skill guidance for ${skill.roles.join(', ') || 'frontend agents'}.`,
      mimeType: 'text/markdown',
    }, async () => ({
      contents: [{ uri: skill.uri, mimeType: 'text/markdown', text: readFileSync(path, 'utf8') }],
    }));
  }

  server.registerResource('frontend_patterns_neuform_index', 'frontend-patterns://neuform/index', {
    title: 'Neuform Frontend Pattern Index',
    description: 'Optional visual effect and layout pattern catalog for frontend elevation and future Effects picker.',
    mimeType: 'application/json',
  }, async () => ({
    contents: [{
      uri: 'frontend-patterns://neuform/index',
      mimeType: 'application/json',
      text: JSON.stringify(buildNeuformIndex(), null, 2),
    }],
  }));

  for (const entry of buildNeuformIndex().entries) {
    const path = join(NEUFORM_DIR, entry.path);
    server.registerResource(`frontend_pattern_${entry.id}`, entry.uri, {
      title: entry.title,
      description: `Neuform optional pattern: ${entry.pickerGroup || entry.patternKind || 'frontend effect'}.`,
      mimeType: 'text/markdown',
    }, async () => ({
      contents: [{ uri: entry.uri, mimeType: 'text/markdown', text: readFileSync(path, 'utf8') }],
    }));
  }

  server.registerResource('frontend_reference_ui_index', 'frontend-reference://ui/index', {
    title: 'Frontend UI Reference Index',
    description: 'Curated screenshot groups for frontend visual calibration.',
    mimeType: 'application/json',
  }, async () => ({
    contents: [{
      uri: 'frontend-reference://ui/index',
      mimeType: 'application/json',
      text: JSON.stringify(buildFrontendReferenceIndex(), null, 2),
    }],
  }));

  for (const group of buildFrontendReferenceIndex().groups) {
    server.registerResource(`frontend_reference_group_${group.id}`, group.uri, {
      title: `${group.title} References`,
      description: group.useWhen,
      mimeType: 'application/json',
    }, async () => ({
      contents: [{
        uri: group.uri,
        mimeType: 'application/json',
        text: JSON.stringify(group, null, 2),
      }],
    }));
  }

  for (const reference of buildReferenceEntries()) {
    const path = join(REFERENCES_DIR, reference.category, reference.fileName);
    server.registerResource(`frontend_reference_${reference.category}_${reference.fileName}`, reference.uri, {
      title: reference.title,
      description: `UI screenshot reference in ${reference.categoryTitle}.`,
      mimeType: reference.mimeType,
    }, async () => ({
      contents: [{
        uri: reference.uri,
        mimeType: reference.mimeType,
        blob: readFileSync(path).toString('base64'),
      }],
    }));
  }
}
