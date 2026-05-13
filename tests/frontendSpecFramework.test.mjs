import assert from 'node:assert/strict';

const {
  FRONTEND_CATEGORY_OVERLAYS,
  FRONTEND_SPEC_SCHEMAS,
  buildFrontendSpecFramework,
  classifyFrontendCategory,
  evaluateFrontendSpecCoverage,
} = await import('../mcp-server/src/utils/frontend-spec-framework.mjs');

function run(name, fn) {
  try {
    fn();
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
  assert.ok(framework.schemas['PRD.md'].requiredSections.includes('Target Users'));
  assert.ok(framework.schemas['DESIGN.md'].requiredSections.includes('Design Tokens'));
  assert.ok(framework.schemas['structure.md'].aliases.includes('architecture.md'));
  assert.ok(framework.intakeSteps.some(step => step.includes('Preserve strong user files')));
  assert.ok(framework.alignmentChecks.some(check => check.includes('Product type matches')));
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
  assert.ok(result.nextActions.some(action => action.includes('Patch PRD.md')));
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
