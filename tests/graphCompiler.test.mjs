import assert from 'node:assert/strict';
import { compileMission, validateGraph } from '../.tmp-tests/lib/graphCompiler.js';
import {
  buildPresetFlowGraph,
  getPresetNodeTerminalTitle,
  getPresetSpecMetadata,
  getPresetReadmeDefault,
  getRecommendedWorkflowPreset,
  getWorkflowPreset,
  groupWorkflowPresetsByMode,
  groupWorkflowPresetsBySubMode,
  listWorkflowPresets,
  sortWorkflowPresets,
} from '../.tmp-tests/lib/workflowPresets.js';
import { detectRoleForPane, detectRoleFromText } from '../.tmp-tests/lib/cliDetection.js';

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

run('docs preset mission titles ignore stale frontend terminal pane names', () => {
  const preset = getWorkflowPreset('docs_refresh_small');
  assert.ok(preset, 'docs_refresh_small preset must exist');

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'docs-title-mission',
    prompt: 'Refresh the agent documentation',
    mode: 'edit',
    workspaceDir: 'C:/workspace',
    instructionOverrides: {},
    bindingsByRole: {
      scout: { terminalId: 'term-scout', terminalTitle: 'Product Agent' },
      builder: { terminalId: 'term-builder', terminalTitle: 'Product Agent' },
      reviewer: { terminalId: 'term-reviewer', terminalTitle: 'Product Agent' },
    },
  });

  const mission = compileMission({
    graphId: 'preset:docs_refresh_small',
    missionId: 'docs-title-mission',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'docs_refresh_small',
    runVersion: 1,
  });

  assert.deepEqual(mission.nodes.map(node => node.roleId), ['scout', 'builder', 'reviewer']);
  assert.deepEqual(mission.nodes.map(node => node.terminal.terminalTitle), ['Scout', 'Builder', 'Reviewer']);
});

run('all non-frontend preset modes use role-correct titles even with stale product pane names', () => {
  const staleBindings = {
    scout: { terminalId: 'term-scout', terminalTitle: 'Product Agent' },
    coordinator: { terminalId: 'term-coordinator', terminalTitle: 'Product Agent' },
    builder: { terminalId: 'term-builder', terminalTitle: 'Product Agent' },
    tester: { terminalId: 'term-tester', terminalTitle: 'Product Agent' },
    security: { terminalId: 'term-security', terminalTitle: 'Product Agent' },
    reviewer: { terminalId: 'term-reviewer', terminalTitle: 'Product Agent' },
    interaction_qa: { terminalId: 'term-interaction', terminalTitle: 'Product Agent' },
    accessibility_reviewer: { terminalId: 'term-accessibility', terminalTitle: 'Product Agent' },
  };
  const coveredModes = new Set();

  for (const preset of listWorkflowPresets()) {
    if (preset.specProfile === 'frontend_three_file' || preset.frontendMode) continue;
    coveredModes.add(preset.mode);
    const flow = buildPresetFlowGraph({
      preset,
      missionId: `mode-title-${preset.id}`,
      prompt: `Run ${preset.name}`,
      mode: 'edit',
      workspaceDir: 'C:/workspace',
      instructionOverrides: {},
      bindingsByRole: staleBindings,
    });
    const mission = compileMission({
      graphId: `preset:${preset.id}`,
      missionId: `mode-title-${preset.id}`,
      nodes: flow.nodes,
      edges: flow.edges,
      workspaceDirFallback: 'C:/workspace',
      compiledAt: 123,
      authoringMode: 'preset',
      presetId: preset.id,
      runVersion: 1,
    });

    for (const node of mission.nodes) {
      const presetNode = preset.nodes.find(entry => entry.id === node.id);
      assert.ok(presetNode, `${preset.id}: preset node exists for ${node.id}`);
      assert.equal(node.terminal.terminalTitle, getPresetNodeTerminalTitle(presetNode), `${preset.id}: title for ${node.id}`);
      assert.notEqual(node.terminal.terminalTitle, 'Product Agent', `${preset.id}: stale Product Agent title not reused for ${node.id}`);
    }
  }

  assert.deepEqual([...coveredModes].sort(), ['build', 'document', 'plan', 'research', 'review', 'secure', 'verify']);
});

run('role detection recognizes every preset role name instead of falling back to stale generic roles', () => {
  const allPresetRoleIds = new Set(listWorkflowPresets().flatMap(preset => preset.nodes.map(node => node.roleId)));
  for (const roleId of allPresetRoleIds) {
    const title = getPresetNodeTerminalTitle({ id: roleId, roleId });
    assert.equal(detectRoleFromText(title), roleId, `detect text title ${title}`);
    assert.equal(detectRoleForPane({ title, data: {} }), roleId, `detect pane title ${title}`);
    assert.equal(detectRoleForPane({ title: 'Stale Product Agent', data: { roleId } }), roleId, `detect data role ${roleId}`);
  }
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

run('expanded app site preset keeps repeated frontend builder terminal bindings distinct', () => {
  const preset = getWorkflowPreset('app_site_expanded');
  assert.ok(preset, 'app_site_expanded preset must exist');

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'expanded-frontend',
    prompt: 'Build a hospital incident triage dashboard',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    frontendMode: 'strict_ui',
    instructionOverrides: {},
    bindingsByRole: {
      frontend_product: { terminalId: 'term-product', terminalTitle: 'Product Agent' },
      frontend_designer: { terminalId: 'term-designer', terminalTitle: 'Designer' },
      frontend_architect: { terminalId: 'term-architect', terminalTitle: 'Architecture Agent' },
      frontend_builder: [
        { terminalId: 'term-builder-core', terminalTitle: 'Core Builder', cli: 'codex' },
        { terminalId: 'term-builder-states', terminalTitle: 'States Builder', cli: 'claude' },
        { terminalId: 'term-builder-responsive', terminalTitle: 'Responsive Builder', cli: 'codex' },
      ],
      interaction_qa: { terminalId: 'term-qa', terminalTitle: 'Interaction QA' },
      accessibility_reviewer: { terminalId: 'term-accessibility', terminalTitle: 'Accessibility Reviewer' },
      visual_polish_reviewer: { terminalId: 'term-polish', terminalTitle: 'Visual Polish Reviewer' },
      reviewer: { terminalId: 'term-final', terminalTitle: 'Final Reviewer' },
    },
  });

  const mission = compileMission({
    graphId: 'preset:app_site_expanded',
    missionId: 'expanded-frontend',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'app_site_expanded',
    runVersion: 1,
  });

  const builders = mission.nodes.filter(node => node.roleId === 'frontend_builder');
  assert.deepEqual(builders.map(node => node.id), [
    'frontend_builder_core',
    'frontend_builder_states',
    'frontend_builder_responsive',
  ]);
  assert.deepEqual(builders.map(node => node.terminal.terminalId), [
    'term-builder-core',
    'term-builder-states',
    'term-builder-responsive',
  ]);
  assert.deepEqual(builders.map(node => node.terminal.cli), ['codex', 'claude', 'codex']);
  assert.deepEqual(mission.metadata.executionLayers, [
    ['frontend_product'],
    ['frontend_designer'],
    ['frontend_architect'],
    ['frontend_builder_core'],
    ['frontend_builder_states'],
    ['frontend_builder_responsive'],
    ['interaction_qa'],
    ['accessibility_reviewer', 'visual_polish_reviewer'],
    ['reviewer_final'],
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

run('frontend App/Site preset preserves theme picker direction metadata', () => {
  const preset = getWorkflowPreset('frontend_ui_delivery');
  assert.ok(preset, 'frontend_ui_delivery preset must exist');

  const frontendDirection = {
    kind: 'app_site_frontend_direction',
    version: 1,
    layout: 'dashboard',
    density: 'compact',
    palette: {
      kind: 'custom',
      id: 'custom_palette',
      label: 'Custom palette',
      colors: ['#2563EB', '#14B8A6', '#F97316'],
    },
    shape: 'slightly_rounded',
    effects: ['subtle_hover_motion'],
    assets: 'data_visualization',
    interaction: ['filtering_and_search'],
    tone: 'technical',
    delegatedSections: [],
    summary: 'Layout: Dashboard; Density: Compact; Palette: Custom palette (#2563EB, #14B8A6, #F97316)',
    agentGuidance: {
      do: ['Use the picker direction.'],
      avoid: ['Do not drift into a landing page.'],
    },
    preview: {
      label: 'Dashboard low-fidelity preview',
      note: 'Preview is broad layout reference only.',
      lowFidelity: true,
      nonAuthoritative: true,
    },
  };

  const flow = buildPresetFlowGraph({
    preset,
    missionId: 'frontend-themed',
    prompt: 'Build an operations dashboard',
    mode: 'build',
    workspaceDir: 'C:/workspace',
    frontendMode: 'strict_ui',
    frontendDirection,
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
    missionId: 'frontend-themed',
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
    authoringMode: 'preset',
    presetId: 'frontend_ui_delivery',
    runVersion: 1,
  });

  assert.equal(mission.metadata.frontendDirection.layout, 'dashboard');
  assert.deepEqual(mission.task.frontendDirection.palette.colors, ['#2563EB', '#14B8A6', '#F97316']);
  assert.deepEqual(mission.metadata.frontendDirection.delegatedSections, []);
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
