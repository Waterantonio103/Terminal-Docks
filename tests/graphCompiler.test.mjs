import assert from 'node:assert/strict';
import { compileMission, validateGraph } from '../.tmp-tests/lib/graphCompiler.js';
import {
  buildPresetFlowGraph,
  getPresetSpecMetadata,
  getPresetReadmeDefault,
  getRecommendedWorkflowPreset,
  getWorkflowPreset,
  groupWorkflowPresetsByMode,
  groupWorkflowPresetsBySubMode,
  listWorkflowPresets,
  sortWorkflowPresets,
} from '../.tmp-tests/lib/workflowPresets.js';

function taskNode(id = 'task-1') {
  return {
    id,
    type: 'task',
    position: { x: 0, y: 0 },
    data: {
      roleId: 'task',
      status: 'idle',
      prompt: 'Ship the feature',
      mode: 'build',
      workspaceDir: 'C:/workspace',
    },
  };
}

function agentNode(id, roleId, overrides = {}) {
  return {
    id,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      roleId,
      status: 'idle',
      cli: overrides.cli ?? 'claude',
      instructionOverride: '',
      terminalId: overrides.terminalId ?? `term-${id}`,
      terminalTitle: overrides.terminalTitle ?? `Terminal ${id}`,
      autoLinked: false,
    },
  };
}

function barrierNode(id) {
  return {
    id,
    type: 'barrier',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      roleId: 'barrier',
      status: 'idle',
    },
  };
}

function edge(source, target, condition = 'always') {
  return {
    id: `${source}-${condition}-${target}`,
    source,
    target,
    data: { condition },
  };
}

function compileCase(nodes, edges) {
  return compileMission({
    graphId: 'graph-1',
    missionId: 'mission-1',
    nodes,
    edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
  });
}

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run('linear chain compiles into a single start node and edge', () => {
  const mission = compileCase(
    [taskNode(), agentNode('agent-a', 'scout'), agentNode('agent-b', 'reviewer')],
    [edge('task-1', 'agent-a'), edge('agent-a', 'agent-b')]
  );

  assert.deepEqual(mission.metadata.startNodeIds, ['agent-a']);
  assert.deepEqual(mission.metadata.executionLayers, [['agent-a'], ['agent-b']]);
  assert.deepEqual(
    mission.edges.map(entry => ({ from: entry.fromNodeId, to: entry.toNodeId, condition: entry.condition })),
    [{ from: 'agent-a', to: 'agent-b', condition: 'always' }]
  );
});

run('fan-out preserves multiple downstream targets', () => {
  const mission = compileCase(
    [taskNode(), agentNode('coord', 'coordinator'), agentNode('builder', 'builder'), agentNode('tester', 'tester')],
    [edge('task-1', 'coord'), edge('coord', 'builder'), edge('coord', 'tester', 'on_success')]
  );

  assert.deepEqual(mission.metadata.executionLayers, [['coord'], ['builder', 'tester']]);
  assert.deepEqual(
    mission.edges.map(entry => `${entry.fromNodeId}:${entry.condition}:${entry.toNodeId}`),
    ['coord:always:builder', 'coord:on_success:tester']
  );
});

run('fan-in through a barrier emits direct agent-to-agent edges', () => {
  const mission = compileCase(
    [
      taskNode(),
      agentNode('builder', 'builder'),
      agentNode('tester', 'tester'),
      barrierNode('gate'),
      agentNode('reviewer', 'reviewer'),
    ],
    [
      edge('task-1', 'builder'),
      edge('task-1', 'tester'),
      edge('builder', 'gate'),
      edge('tester', 'gate'),
      edge('gate', 'reviewer'),
    ]
  );

  assert.deepEqual(mission.metadata.startNodeIds, ['builder', 'tester']);
  assert.deepEqual(mission.metadata.executionLayers, [['builder', 'tester'], ['reviewer']]);
  assert.deepEqual(
    mission.edges.map(entry => `${entry.fromNodeId}:${entry.toNodeId}`),
    ['builder:reviewer', 'tester:reviewer']
  );
});

run('duplicate roles stay as distinct runtime nodes', () => {
  const mission = compileCase(
    [
      taskNode(),
      agentNode('builder-a', 'builder'),
      agentNode('builder-b', 'builder'),
      agentNode('reviewer', 'reviewer'),
    ],
    [
      edge('task-1', 'builder-a'),
      edge('task-1', 'builder-b'),
      edge('builder-a', 'reviewer'),
      edge('builder-b', 'reviewer'),
    ]
  );

  assert.deepEqual(mission.metadata.executionLayers, [['builder-a', 'builder-b'], ['reviewer']]);
  assert.equal(mission.nodes.filter(node => node.roleId === 'builder').length, 2);
});

run('same-role downstream nodes keep separate graph edges', () => {
  const mission = compileCase(
    [
      taskNode(),
      agentNode('builder', 'builder'),
      agentNode('reviewer-a', 'reviewer'),
      agentNode('reviewer-b', 'reviewer'),
    ],
    [
      edge('task-1', 'builder'),
      edge('builder', 'reviewer-a'),
      edge('builder', 'reviewer-b'),
    ]
  );

  assert.deepEqual(mission.metadata.executionLayers, [['builder'], ['reviewer-a', 'reviewer-b']]);
  assert.deepEqual(
    mission.edges.map(entry => entry.toNodeId),
    ['reviewer-a', 'reviewer-b']
  );
});

run('conditional paths survive helper-node compilation', () => {
  const mission = compileCase(
    [taskNode(), agentNode('builder', 'builder'), barrierNode('gate'), agentNode('reviewer', 'reviewer')],
    [edge('task-1', 'builder'), edge('builder', 'gate'), edge('gate', 'reviewer', 'on_failure')]
  );

  assert.deepEqual(
    mission.edges.map(entry => ({ from: entry.fromNodeId, to: entry.toNodeId, condition: entry.condition })),
    [{ from: 'builder', to: 'reviewer', condition: 'on_failure' }]
  );
});

run('cycles are rejected before runtime terminals are prepared', () => {
  assert.throws(
    () => validateGraph(
      [taskNode(), agentNode('builder', 'builder'), agentNode('reviewer', 'reviewer')],
      [edge('task-1', 'builder'), edge('builder', 'reviewer'), edge('reviewer', 'builder', 'on_failure')]
    ),
    /cycle/i
  );
});

run('agent nodes carry selected CLI into compiled runtime binding', () => {
  const mission = compileCase(
    [taskNode(), agentNode('builder', 'builder', { cli: 'codex' })],
    [edge('task-1', 'builder')]
  );

  assert.equal(mission.nodes[0].terminal.cli, 'codex');
});

run('preset-expanded graphs compile to explicit workflow layers', () => {
  const preset = getWorkflowPreset('parallel_delivery');
  assert.ok(preset, 'parallel_delivery preset must exist');

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'preset-mission',
    prompt: 'Ship feature',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    instructionOverrides: {},
    bindingsByRole: {
      coordinator: { terminalId: 'term-coordinator', terminalTitle: 'Coordinator' },
      builder: { terminalId: 'term-builder', terminalTitle: 'Builder' },
      tester: { terminalId: 'term-tester', terminalTitle: 'Tester' },
      security: { terminalId: 'term-security', terminalTitle: 'Security' },
      reviewer: { terminalId: 'term-reviewer', terminalTitle: 'Reviewer' },
    },
  });

  const mission = compileMission({
    graphId: 'preset:parallel_delivery',
    missionId: 'preset-mission',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'parallel_delivery',
    runVersion: 1,
  });

  assert.equal(mission.metadata.authoringMode, 'preset');
  assert.equal(mission.metadata.presetId, 'parallel_delivery');
  assert.equal(mission.metadata.runVersion, 1);
  assert.deepEqual(mission.metadata.executionLayers, [
    ['coordinator'],
    ['builder', 'tester', 'security'],
    ['reviewer'],
  ]);
});

run('workflow presets expose picker metadata and fixed size tiers', () => {
  const presets = listWorkflowPresets();
  assert.ok(presets.length >= 21, 'catalog should include curated presets beyond legacy defaults');

  const validModes = new Set(['build', 'research', 'plan', 'review', 'verify', 'secure', 'document']);
  const validSizes = new Set(['small', 'standard', 'expanded']);
  for (const preset of presets) {
    assert.ok(validModes.has(preset.mode), `${preset.id} has valid mode`);
    assert.ok(preset.subMode.trim(), `${preset.id} has sub-mode`);
    assert.ok(validSizes.has(preset.size), `${preset.id} has valid size`);
    assert.equal(preset.agentCount, preset.nodes.length, `${preset.id} agent count matches node count`);
    assert.ok(preset.agentCount >= 2 && preset.agentCount <= 15, `${preset.id} agent count is in picker range`);
    assert.ok(Array.isArray(preset.tags), `${preset.id} has tags`);
  }
});

run('workflow presets group by mode and sub-mode with standard recommendations', () => {
  const byMode = groupWorkflowPresetsByMode();
  assert.deepEqual([...byMode.keys()], ['build', 'research', 'plan', 'review', 'verify', 'secure', 'document']);
  assert.ok(byMode.get('build')?.some(preset => preset.subMode === 'App / Site'));

  for (const presets of byMode.values()) {
    const bySubMode = groupWorkflowPresetsBySubMode(presets);
    for (const values of bySubMode.values()) {
      assert.deepEqual(values.map(preset => preset.size), ['small', 'standard', 'expanded']);
      assert.equal(getRecommendedWorkflowPreset(values)?.size, 'standard');
    }
  }
});

run('workflow presets sort size tiers deterministically', () => {
  const unsorted = ['expanded', 'small', 'standard'].map(size =>
    listWorkflowPresets().find(preset => preset.subMode === 'Patch / Build' && preset.size === size)
  );
  assert.deepEqual(sortWorkflowPresets(unsorted).map(preset => preset.size), ['small', 'standard', 'expanded']);
});

run('preset-expanded graphs use evenly spaced layer layout', () => {
  const preset = getWorkflowPreset('scout_build_review');
  assert.ok(preset, 'scout_build_review preset must exist');

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'layout-mission',
    prompt: 'Patch and test the feature',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    instructionOverrides: {},
    bindingsByRole: {},
  });

  const byId = new Map(flow.nodes.map(node => [node.id, node]));
  assert.deepEqual(byId.get('scout')?.position, { x: 1120, y: 360 });
  assert.deepEqual(byId.get('builder')?.position, { x: 1680, y: 100 });
  assert.deepEqual(byId.get('tester')?.position, { x: 1680, y: 620 });
  assert.deepEqual(byId.get('reviewer')?.position, { x: 2240, y: 360 });
});

run('frontend preset compiles with explicit UI roles and metadata', () => {
  const preset = getWorkflowPreset('frontend_ui_delivery');
  assert.ok(preset, 'frontend_ui_delivery preset must exist');
  assert.deepEqual(getPresetSpecMetadata(preset), {
    specProfile: 'frontend_three_file',
    frontendMode: 'strict_ui',
  });

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'frontend-mission',
    prompt: 'Build a polished docs portal',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    frontendMode: 'strict_ui',
    instructionOverrides: {},
    bindingsByRole: {
      frontend_product: { terminalId: 'term-product', terminalTitle: 'Product Agent' },
      frontend_designer: { terminalId: 'term-designer', terminalTitle: 'Designer' },
      frontend_architect: { terminalId: 'term-architect', terminalTitle: 'Architecture Agent' },
      frontend_builder: { terminalId: 'term-builder', terminalTitle: 'Frontend Builder' },
      interaction_qa: { terminalId: 'term-qa', terminalTitle: 'Interaction QA' },
      accessibility_reviewer: { terminalId: 'term-accessibility', terminalTitle: 'Accessibility Reviewer' },
    },
  });

  const mission = compileMission({
    graphId: 'preset:frontend_ui_delivery',
    missionId: 'frontend-mission',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'frontend_ui_delivery',
    runVersion: 1,
  });

  assert.equal(mission.metadata.frontendMode, 'strict_ui');
  assert.equal(mission.metadata.frontendCategory, 'docs_portal');
  assert.equal(mission.metadata.specProfile, 'frontend_three_file');
  assert.equal(getPresetReadmeDefault(preset), true);
  assert.equal(mission.task.frontendMode, 'strict_ui');
  assert.equal(mission.task.frontendCategory, 'docs_portal');
  assert.equal(mission.task.specProfile, 'frontend_three_file');
  assert.equal(mission.task.finalReadmeEnabled, true);
  assert.equal(mission.task.finalReadmeOwnerNodeId, 'interaction_qa');
  assert.equal(mission.metadata.finalReadmeOwnerNodeId, 'interaction_qa');
  assert.deepEqual(mission.nodes.map(node => node.roleId), [
    'frontend_product',
    'frontend_designer',
    'frontend_architect',
    'frontend_builder',
    'interaction_qa',
    'accessibility_reviewer',
  ]);
  assert.deepEqual(mission.metadata.executionLayers, [
    ['frontend_product'],
    ['frontend_designer', 'frontend_architect'],
    ['frontend_builder'],
    ['interaction_qa', 'accessibility_reviewer'],
  ]);
});

run('preset final README can be disabled and defaults off for patch presets', () => {
  const patchPreset = getWorkflowPreset('rapid_patch');
  assert.ok(patchPreset, 'rapid_patch preset must exist');
  assert.equal(getPresetReadmeDefault(patchPreset), false);

  const frontendPreset = getWorkflowPreset('frontend_ui_delivery');
  assert.ok(frontendPreset, 'frontend_ui_delivery preset must exist');
  const flow = buildPresetFlowGraph({
    preset: frontendPreset,
    missionId: 'frontend-no-readme',
    prompt: 'Build a polished SaaS dashboard',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    finalReadmeEnabled: false,
    instructionOverrides: {},
    bindingsByRole: {
      frontend_product: { terminalId: 'term-product', terminalTitle: 'Product Agent' },
      frontend_designer: { terminalId: 'term-designer', terminalTitle: 'Designer' },
      frontend_architect: { terminalId: 'term-architect', terminalTitle: 'Architecture Agent' },
      frontend_builder: { terminalId: 'term-builder', terminalTitle: 'Frontend Builder' },
      interaction_qa: { terminalId: 'term-qa', terminalTitle: 'Interaction QA' },
      accessibility_reviewer: { terminalId: 'term-accessibility', terminalTitle: 'Accessibility Reviewer' },
    },
  });

  const mission = compileMission({
    graphId: 'preset:frontend_ui_delivery',
    missionId: 'frontend-no-readme',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'frontend_ui_delivery',
    runVersion: 1,
  });

  assert.equal(mission.metadata.finalReadmeEnabled, false);
  assert.equal(mission.metadata.finalReadmeOwnerNodeId, null);
});

run('frontend category is inferred from the task prompt without user selection', () => {
  const preset = getWorkflowPreset('frontend_ui_delivery');
  assert.ok(preset, 'frontend_ui_delivery preset must exist');

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'frontend-auto',
    prompt: 'Build a developer documentation portal with API reference, quickstart, migration guides, and changelog',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    frontendMode: 'aligned',
    instructionOverrides: {},
    bindingsByRole: {
      frontend_product: { terminalId: 'term-product', terminalTitle: 'Product Agent' },
      frontend_designer: { terminalId: 'term-designer', terminalTitle: 'Designer' },
      frontend_architect: { terminalId: 'term-architect', terminalTitle: 'Architecture Agent' },
      frontend_builder: { terminalId: 'term-builder', terminalTitle: 'Frontend Builder' },
      interaction_qa: { terminalId: 'term-qa', terminalTitle: 'Interaction QA' },
      accessibility_reviewer: { terminalId: 'term-accessibility', terminalTitle: 'Accessibility Reviewer' },
    },
  });

  const mission = compileMission({
    graphId: 'preset:frontend_ui_delivery',
    missionId: 'frontend-auto',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'frontend_ui_delivery',
    runVersion: 1,
  });

  assert.equal(mission.metadata.frontendMode, 'aligned');
  assert.equal(mission.metadata.frontendCategory, 'docs_portal');
});

run('task frontend preset metadata wins over stale off compile option', () => {
  const preset = getWorkflowPreset('frontend_ui_delivery');
  assert.ok(preset, 'frontend_ui_delivery preset must exist');

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'frontend-stale-ui',
    prompt: 'Build an internal admin dashboard with queue filters and audit history',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    frontendMode: 'strict_ui',
    instructionOverrides: {},
    bindingsByRole: {
      frontend_product: { terminalId: 'term-product', terminalTitle: 'Product Agent' },
      frontend_designer: { terminalId: 'term-designer', terminalTitle: 'Designer' },
      frontend_architect: { terminalId: 'term-architect', terminalTitle: 'Architecture Agent' },
      frontend_builder: { terminalId: 'term-builder', terminalTitle: 'Frontend Builder' },
      interaction_qa: { terminalId: 'term-qa', terminalTitle: 'Interaction QA' },
      accessibility_reviewer: { terminalId: 'term-accessibility', terminalTitle: 'Accessibility Reviewer' },
    },
  });

  const mission = compileMission({
    graphId: 'preset:frontend_ui_delivery',
    missionId: 'frontend-stale-ui',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'graph',
    frontendMode: 'off',
    specProfile: 'none',
  });

  assert.equal(mission.metadata.frontendMode, 'strict_ui');
  assert.equal(mission.metadata.frontendCategory, 'admin_internal_tool');
  assert.equal(mission.metadata.specProfile, 'frontend_three_file');
  assert.equal(mission.task.frontendMode, 'strict_ui');
  assert.equal(mission.task.frontendCategory, 'admin_internal_tool');
  assert.equal(mission.task.specProfile, 'frontend_three_file');
});

run('preset compile options repair stale task off and none metadata', () => {
  const preset = getWorkflowPreset('frontend_ui_delivery');
  assert.ok(preset, 'frontend_ui_delivery preset must exist');

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'frontend-stale-task',
    prompt: 'Build a cinematic space video game landing page with stars',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    frontendMode: 'strict_ui',
    instructionOverrides: {},
    bindingsByRole: {
      frontend_product: { terminalId: 'term-product', terminalTitle: 'Product Agent' },
      frontend_designer: { terminalId: 'term-designer', terminalTitle: 'Designer' },
      frontend_architect: { terminalId: 'term-architect', terminalTitle: 'Architecture Agent' },
      frontend_builder: { terminalId: 'term-builder', terminalTitle: 'Frontend Builder' },
      interaction_qa: { terminalId: 'term-qa', terminalTitle: 'Interaction QA' },
      accessibility_reviewer: { terminalId: 'term-accessibility', terminalTitle: 'Accessibility Reviewer' },
    },
  });
  const staleTask = flow.nodes.find(node => node.type === 'workflow.task' || node.data?.roleId === 'task');
  assert.ok(staleTask, 'preset flow should contain a task node');
  staleTask.data = {
    ...staleTask.data,
    frontendMode: 'off',
    specProfile: 'none',
    finalReadmeEnabled: undefined,
  };

  const mission = compileMission({
    graphId: 'preset:frontend_ui_delivery',
    missionId: 'frontend-stale-task',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'frontend_ui_delivery',
    runVersion: 1,
    frontendMode: 'strict_ui',
    specProfile: 'frontend_three_file',
  });

  assert.equal(mission.metadata.frontendMode, 'strict_ui');
  assert.equal(mission.metadata.specProfile, 'frontend_three_file');
  assert.equal(mission.metadata.finalReadmeEnabled, true);
  assert.equal(mission.task.frontendMode, 'strict_ui');
  assert.equal(mission.task.specProfile, 'frontend_three_file');
  assert.equal(mission.task.finalReadmeEnabled, true);
});

run('negated dashboard cue does not override landing page category', () => {
  const preset = getWorkflowPreset('frontend_ui_delivery');
  assert.ok(preset, 'frontend_ui_delivery preset must exist');

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'space-game-category',
    prompt: 'Create a space video game landing page, not a generic dashboard or placeholder.',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    frontendMode: 'strict_ui',
    instructionOverrides: {},
    bindingsByRole: {
      frontend_product: { terminalId: 'term-product', terminalTitle: 'Product Agent' },
      frontend_designer: { terminalId: 'term-designer', terminalTitle: 'Designer' },
      frontend_architect: { terminalId: 'term-architect', terminalTitle: 'Architecture Agent' },
      frontend_builder: { terminalId: 'term-builder', terminalTitle: 'Frontend Builder' },
      interaction_qa: { terminalId: 'term-qa', terminalTitle: 'Interaction QA' },
      accessibility_reviewer: { terminalId: 'term-accessibility', terminalTitle: 'Accessibility Reviewer' },
    },
  });

  const mission = compileMission({
    graphId: 'preset:frontend_ui_delivery',
    missionId: 'space-game-category',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'frontend_ui_delivery',
    runVersion: 1,
    frontendMode: 'strict_ui',
    specProfile: 'frontend_three_file',
  });

  assert.equal(mission.metadata.frontendCategory, 'marketing_site');
  assert.equal(mission.task.frontendCategory, 'marketing_site');
});
