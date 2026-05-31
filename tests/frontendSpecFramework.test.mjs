import assert from 'node:assert/strict';

const {
  FRONTEND_CATEGORY_OVERLAYS,
  FRONTEND_SPEC_SCHEMAS,
  buildFrontendSpecFramework,
  classifyFrontendCategory,
  evaluateFrontendSpecCoverage,
} = await import('../mcp-server/src/utils/frontend-spec-framework.mjs');

const {
  buildFrontendLibraryIndex,
  buildFrontendReferenceIndex,
  registerFrontendLibraryResources,
} = await import('../mcp-server/src/resources/frontend-library.mjs');
const {
  buildWorkflowPresetFramework,
  evaluateWorkflowPresetOutput,
} = await import('../mcp-server/src/utils/workflow-preset-framework.mjs');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

async function runAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run('framework exposes fill-in forms for PRD, DESIGN, and structure', () => {
  const framework = buildFrontendSpecFramework({
    categoryId: 'docs_portal',
    mode: 'strict_ui',
  });

  assert.equal(framework.categoryId, 'docs_portal');
  assert.equal(framework.mode, 'strict_ui');
  assert.deepEqual(framework.modeConfig.durableArtifacts, ['PRD.md', 'DESIGN.md', 'structure.md', 'README.md']);
  assert.ok(framework.modeConfig.requiredContext.includes('implementation plan'));
  assert.ok(framework.schemas['PRD.md'].requiredSections.includes('Target Users'));
  assert.ok(framework.schemas['DESIGN.md'].requiredSections.includes('Design Tokens'));
  assert.ok(framework.schemas['DESIGN.md'].requiredSections.includes('Builder Handoff'));
  assert.ok(framework.schemas['DESIGN.md'].canonicalTemplate.frontmatter.colors.primary.includes('Exact hex'));
  assert.ok(framework.schemas['DESIGN.md'].canonicalTemplate.frontmatter.typography['display-lg'].includes('family'));
  assert.ok(framework.schemas['structure.md'].aliases.includes('architecture.md'));
  assert.ok(framework.intakeSteps.some(step => step.includes('Preserve strong user files')));
  assert.ok(framework.intakeSteps.some(step => step.includes('three-file workflows')));
  assert.ok(framework.alignmentChecks.some(check => check.includes('Product type matches')));
});

run('frontend library index exposes skills, patterns, and references', () => {
  const library = buildFrontendLibraryIndex();
  const references = buildFrontendReferenceIndex();

  assert.equal(library.uri, 'frontend-library://index');
  assert.equal(library.skills.length, 12);
  assert.ok(library.skills.some(skill => skill.id === 'frontend_negatives'));
  assert.ok(library.roleSkillRecommendations.frontend_builder.includes('frontend_negatives'));
  assert.ok(library.workflow.some(step => step.includes('frontend-skill://frontend_negatives')));
  assert.equal(library.patterns.indexUri, 'frontend-patterns://neuform/index');
  assert.equal(library.patterns.totalPatterns, 69);
  assert.equal(library.references.indexUri, 'frontend-reference://ui/index');
  assert.equal(references.totalReferences, 50);
  assert.ok(library.workflow.some(step => step.includes('Load only the skill docs needed')));
  assert.ok(library.guardrails.some(rule => rule.includes('source of truth')));
});

await runAsync('Neuform pattern entries advertise plural URIs and register compatibility aliases', async () => {
  const resources = new Map();
  registerFrontendLibraryResources({
    registerResource(name, uri, metadata, handler) {
      resources.set(uri, { name, metadata, handler });
    },
  });

  const indexResource = await resources.get('frontend-patterns://neuform/index').handler();
  const index = JSON.parse(indexResource.contents[0].text);
  const beautifulShadows = index.entries.find(entry => entry.id === 'neuform_beautiful-shadows');

  assert.equal(beautifulShadows.uri, 'frontend-patterns://neuform/effects/beautiful-shadows.md');
  assert.ok(beautifulShadows.uriAliases.includes('frontend-patterns://neuform/beautiful-shadows'));
  assert.ok(beautifulShadows.uriAliases.includes('frontend-pattern://neuform/beautiful-shadows'));
  assert.ok(beautifulShadows.uriAliases.includes('frontend-pattern://neuform/effects/beautiful-shadows.md'));
  assert.ok(resources.has('frontend-patterns://neuform/beautiful-shadows'));
  assert.ok(resources.has('frontend-patterns://neuform/effects/beautiful-shadows.md'));
  assert.ok(resources.has('frontend-pattern://neuform/beautiful-shadows'));
  assert.ok(resources.has('frontend-pattern://neuform/effects/beautiful-shadows.md'));
});

run('all category overlays define required additions and reviewer rubrics', () => {
  for (const [id, overlay] of Object.entries(FRONTEND_CATEGORY_OVERLAYS)) {
    assert.ok(overlay.label, `${id} has a label`);
    assert.ok(overlay.cues.length > 0, `${id} has classification cues`);
    assert.ok(overlay.requiredAdditions['PRD.md'].length > 0, `${id} extends PRD`);
    assert.ok(overlay.requiredAdditions['DESIGN.md'].length > 0, `${id} extends DESIGN`);
    assert.ok(overlay.requiredAdditions['structure.md'].length > 0, `${id} extends structure`);
    assert.ok(overlay.rubric.length > 0, `${id} has a rubric`);
  }

  for (const [fileName, schema] of Object.entries(FRONTEND_SPEC_SCHEMAS)) {
    assert.ok(schema.purpose.includes('Do not use it'), `${fileName} states ownership boundary`);
    assert.ok(schema.fillInPrompts.length >= 5, `${fileName} has fill-in prompts`);
    assert.ok(schema.qualityChecks.length >= 5, `${fileName} has quality checks`);
  }

  assert.ok(
    FRONTEND_SPEC_SCHEMAS['DESIGN.md'].qualityChecks.some(check => check.includes('canonical frontmatter')),
    'DESIGN schema requires canonical structure',
  );
});

run('classifier selects category-specific overlays from frontend prompts', () => {
  assert.equal(
    classifyFrontendCategory('Build a developer documentation portal with API reference, quickstart, migration guides, and changelog').categoryId,
    'docs_portal',
  );
  assert.equal(
    classifyFrontendCategory('Create an operations console for dispatch admins with queues, audit trail, filters, and status states').categoryId,
    'admin_internal_tool',
  );
  assert.equal(
    classifyFrontendCategory('Design a consumer mobile app onboarding flow with progress and account privacy controls').categoryId,
    'consumer_mobile_app',
  );
  assert.equal(
    classifyFrontendCategory('Create a space video game landing page, not a generic dashboard or placeholder').categoryId,
    'marketing_site',
  );
});

run('intake gate preserves user files and reports missing sections instead of overwriting', () => {
  const result = evaluateFrontendSpecCoverage({
    categoryId: 'docs_portal',
    suppliedFiles: {
      'PRD.md': '# Product Context\nA docs portal.\n\n## Target Users\nDevelopers.\n',
      'DESIGN.md': '# Overview\nLight docs UI.\n\n## Colors\nPurple accent.\n',
      'architecture.md': '# Purpose\nDocs site IA.\n\n## Recommended Route or Screen Map\n/docs\n',
    },
  });

  assert.equal(result.status, 'needs_spec_work');
  assert.equal(result.files['structure.md'].providedAs, 'architecture.md');
  assert.equal(result.files['PRD.md'].status, 'weak');
  assert.ok(result.files['PRD.md'].missingRequiredSections.includes('Open Questions'));
  assert.ok(result.files['DESIGN.md'].missingCategoryAdditions.includes('Code block treatment'));
  assert.ok(result.nextActions.some(action => action.includes('Patch the supplied PRD.md')));
});

run('missing planning docs become durable App/Site handoff actions', () => {
  const result = evaluateFrontendSpecCoverage({
    categoryId: 'marketing_site',
    suppliedFiles: {},
  });

  assert.equal(result.status, 'needs_spec_work');
  assert.ok(result.nextActions.some(action => action.includes('Generate PRD.md')));
  assert.ok(result.nextActions.some(action => action.includes('Generate structure.md')));
  assert.ok(result.nextActions.some(action => action.includes('Generate DESIGN.md')));
});

run('complete category specs pass the intake gate', () => {
  const suppliedFiles = {};
  for (const fileName of ['PRD.md', 'DESIGN.md', 'structure.md']) {
    const required = FRONTEND_SPEC_SCHEMAS[fileName].requiredSections
      .map(section => `## ${section}\nComplete ${section} details.`)
      .join('\n\n');
    const additions = FRONTEND_CATEGORY_OVERLAYS.admin_internal_tool.requiredAdditions[fileName]
      .map(addition => `\n${addition}: covered with specific operational guidance.`)
      .join('');
    suppliedFiles[fileName] = `${required}\n${additions}`;
  }

  const result = evaluateFrontendSpecCoverage({
    categoryId: 'admin_internal_tool',
    suppliedFiles,
  });

  assert.equal(result.status, 'ready');
  assert.equal(result.files['PRD.md'].status, 'accepted');
  assert.equal(result.files['DESIGN.md'].status, 'accepted');
  assert.equal(result.files['structure.md'].status, 'accepted');
  assert.deepEqual(result.alignmentRisks, []);
});

run('workflow preset framework exposes build, research, plan, review, verify, secure, and document contracts', () => {
  const patchBuild = buildWorkflowPresetFramework({ presetId: 'patch_build_expanded' });
  const delivery = buildWorkflowPresetFramework({ presetId: 'parallel_delivery' });
  const research = buildWorkflowPresetFramework({ presetId: 'research_scout_expanded' });
  const plan = buildWorkflowPresetFramework({ presetId: 'architecture_plan_standard' });
  const review = buildWorkflowPresetFramework({ presetId: 'code_review_expanded' });
  const verify = buildWorkflowPresetFramework({ presetId: 'regression_sweep_expanded' });
  const secure = buildWorkflowPresetFramework({ presetId: 'security_review_expanded' });
  const docs = buildWorkflowPresetFramework({ presetId: 'docs_refresh_expanded' });

  assert.equal(patchBuild.mode, 'build');
  assert.equal(patchBuild.subMode, 'Patch / Build');
  assert.equal(patchBuild.modeConfig.gateLevel, 'block_on_missing_build_evidence');
  assert.ok(patchBuild.framework.laneGuidance.builder.includes('smallest coherent code change'));
  assert.ok(patchBuild.framework.requiredOutputs.some(item => item.includes('Patch summary')));

  assert.equal(delivery.mode, 'build');
  assert.equal(delivery.subMode, 'Delivery');
  assert.ok(delivery.framework.laneGuidance.coordinator.includes('acceptance criteria'));
  assert.ok(delivery.framework.requiredOutputs.some(item => item.includes('Delivery summary')));

  assert.equal(research.mode, 'research');
  assert.equal(research.subMode, 'Research Scout');
  assert.ok(research.framework.laneGuidance.scout.includes('current implementation'));
  assert.ok(research.completionContract.successRequires.some(item => item.includes('Key findings')));

  assert.equal(plan.modeConfig.gateLevel, 'block_on_missing_plan');
  assert.ok(plan.framework.requiredOutputs.some(item => item.includes('File/module ownership map')));
  assert.ok(plan.framework.qualityRubric.some(item => item.includes('architecture boundaries')));

  assert.equal(review.mode, 'review');
  assert.ok(review.framework.laneGuidance.reviewer.includes('severity'));
  assert.ok(review.completionContract.downstreamPayloadShape.evidence.length > 0);

  assert.equal(verify.mode, 'verify');
  assert.equal(verify.subMode, 'Regression Sweep');
  assert.ok(verify.framework.laneGuidance.interaction_qa.includes('visible behavior'));
  assert.ok(verify.framework.requiredOutputs.some(item => item.includes('Verification matrix')));

  assert.equal(secure.mode, 'secure');
  assert.equal(secure.subMode, 'Security Review');
  assert.ok(secure.framework.laneGuidance.security.includes('source-to-sink attack paths'));
  assert.ok(secure.framework.qualityRubric.some(item => item.includes('Severity')));

  assert.equal(docs.mode, 'document');
  assert.equal(docs.subMode, 'Docs Refresh');
  assert.ok(docs.framework.laneGuidance.builder.includes('obsolete guidance'));
  assert.ok(docs.framework.requiredOutputs.some(item => item.includes('Documentation change summary')));
});

run('workflow preset output evaluation flags weak payloads and accepts evidence-backed output', () => {
  const weak = evaluateWorkflowPresetOutput({
    presetId: 'code_review_standard',
    output: { summary: 'Looks fine.' },
  });
  assert.equal(weak.status, 'needs_work');
  assert.ok(weak.missing.length > 0);

  const strong = evaluateWorkflowPresetOutput({
    presetId: 'code_review_standard',
    output: {
      summary: 'Review completed.',
      evidence: ['Checked src/lib/workflowPresets.ts and ran npm run test:graph.'],
      keyFindings: ['Findings ordered by severity with file/line references: no blocking findings.'],
      gaps: ['Test gaps: live CLI agent behavior was not exercised.'],
      verdict: 'Final verdict: pass with residual risk.',
    },
  });
  assert.equal(strong.status, 'ready');

  assert.equal(
    evaluateWorkflowPresetOutput({
      presetId: 'patch_build_expanded',
      output: {
        summary: 'Patch completed.',
        evidence: ['Changed src/lib/workflowPresets.ts and ran npm run test:graph.'],
        keyFindings: [
          'Patch summary: changed files and behavior impact are scoped to preset framework mapping.',
          'Verification evidence: exact command passed and skipped live CLI checks are noted.',
          'Review verdict: pass with residual risk limited to untested live agent output.',
        ],
      },
    }).status,
    'ready',
  );

  assert.equal(
    evaluateWorkflowPresetOutput({
      presetId: 'parallel_delivery',
      output: {
        summary: 'Delivery completed.',
        evidence: ['Ran npm run test:graph and inspected preset framework output.'],
        keyFindings: [
          'Delivery summary: acceptance criteria and changed artifacts are documented.',
          'Validation evidence: smoke checks and manual workflow proof are recorded.',
          'Handoff notes: run commands, residual risks, and follow-up actions are ready.',
        ],
      },
    }).status,
    'ready',
  );

  assert.equal(
    evaluateWorkflowPresetOutput({
      presetId: 'regression_sweep_standard',
      output: {
        summary: 'Verification completed.',
        evidence: ['Ran npm run test:graph and inspected Mission Control workflow behavior.'],
        keyFindings: [
          'Verification matrix: smoke and regression commands passed.',
          'Regression findings: no blocking behavior changes found in tested paths.',
          'Release verdict: pass with untested live CLI scope noted.',
        ],
      },
    }).status,
    'ready',
  );

  assert.equal(
    evaluateWorkflowPresetOutput({
      presetId: 'security_review_standard',
      output: {
        summary: 'Security review completed.',
        evidence: ['Checked mcp-server/src/tools and src/lib/runtime paths.'],
        keyFindings: [
          'Threat model: MCP tools, runtime task injection, filesystem writes, and dependency boundaries inspected.',
          'Validated findings: no exploitable issue found in reviewed scope; severity and exploit preconditions documented.',
          'Remediation plan: keep validation tests and residual risk notes tied to concrete commands.',
        ],
      },
    }).status,
    'ready',
  );

  assert.equal(
    evaluateWorkflowPresetOutput({
      presetId: 'docs_refresh_standard',
      output: {
        summary: 'Docs refresh completed.',
        evidence: ['Checked package.json scripts, PRD.md, architecture.md, and updated docs.'],
        keyFindings: [
          'Documentation change summary: refreshed current architecture and test command guidance.',
          'Verified commands: npm run test:graph and documented paths checked.',
          'Reader-focused final note: current behavior, remaining stale areas, and next doc work recorded.',
        ],
      },
    }).status,
    'ready',
  );
});
