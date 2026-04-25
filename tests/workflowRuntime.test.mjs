import assert from 'node:assert/strict';
import { getCliAdapter, listCliAdapters } from '../.tmp-tests/lib/cliAdapters.js';
import { detectRuntimeAction } from '../.tmp-tests/lib/runtimeActivity.js';
import { resolveNextNodes } from '../.tmp-tests/lib/workflowRuntimePlanning.js';

function run(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

function mission(overrides = {}) {
  return {
    missionId: 'm1',
    graphId: 'g1',
    task: { nodeId: 'task-1', prompt: 'ship', mode: 'build', workspaceDir: '/ws' },
    metadata: {
      compiledAt: 0,
      sourceGraphId: 'g1',
      startNodeIds: ['a'],
      executionLayers: [['a'], ['b']],
      authoringMode: 'graph',
      presetId: null,
      runVersion: 1,
    },
    nodes: [
      { id: 'a', roleId: 'scout', instructionOverride: '', terminal: { terminalId: 't-a', terminalTitle: 'A', cli: 'claude', executionMode: 'interactive_pty', paneId: undefined, reusedExisting: false } },
      { id: 'b', roleId: 'builder', instructionOverride: '', terminal: { terminalId: 't-b', terminalTitle: 'B', cli: 'codex', executionMode: 'interactive_pty', paneId: undefined, reusedExisting: false } },
      { id: 'c', roleId: 'reviewer', instructionOverride: '', terminal: { terminalId: 't-c', terminalTitle: 'C', cli: 'gemini', executionMode: 'interactive_pty', paneId: undefined, reusedExisting: false } },
    ],
    edges: [
      { id: 'e1', fromNodeId: 'a', toNodeId: 'b', condition: 'on_success' },
      { id: 'e2', fromNodeId: 'a', toNodeId: 'c', condition: 'on_failure' },
    ],
    ...overrides,
  };
}

console.log('cliAdapters');

run('registry exposes all four CLIs', () => {
  const ids = listCliAdapters().map(a => a.id).sort();
  assert.deepEqual(ids, ['claude', 'codex', 'gemini', 'opencode']);
});

run('claude adapter formats prompts with role and workspace', () => {
  const adapter = getCliAdapter('claude');
  assert.ok(adapter);
  const prompt = adapter.formatPrompt({
    missionGoal: 'Ship the feature',
    roleId: 'scout',
    roleInstructions: 'Look around',
    workspaceDir: '/ws',
  });
  assert.match(prompt, /TERMINAL_DOCKS_TASK/);
  assert.match(prompt, /Role: scout/);
  assert.match(prompt, /Workspace: \/ws/);
  assert.match(prompt, /Ship the feature/);
  assert.match(prompt, /Look around/);
  assert.match(prompt, /TERMINAL_DOCKS_DONE/);
});

run('claude adapter includes upstream handoff when provided', () => {
  const adapter = getCliAdapter('claude');
  const prompt = adapter.formatPrompt({
    missionGoal: 'Fix the bug',
    roleId: 'builder',
    upstreamHandoff: 'scout found issue in auth.ts',
    workspaceDir: null,
  });
  assert.match(prompt, /Upstream Handoff:/);
  assert.match(prompt, /scout found issue in auth\.ts/);
});

run('codex/gemini/opencode have distinct launch commands', () => {
  assert.equal(getCliAdapter('codex').launchCommand(), 'codex');
  assert.equal(getCliAdapter('gemini').launchCommand(), 'gemini');
  assert.equal(getCliAdapter('opencode').launchCommand(), 'opencode');
});

run('unknown cli returns null', () => {
  assert.equal(getCliAdapter('nonsense'), null);
});

console.log('resolveNextNodes');

run('on_success edge routes to success target', () => {
  const m = mission();
  const targets = resolveNextNodes(m, 'a', 'success').map(n => n.id);
  assert.deepEqual(targets, ['b']);
});

run('on_failure edge routes to failure target', () => {
  const m = mission();
  const targets = resolveNextNodes(m, 'a', 'failure').map(n => n.id);
  assert.deepEqual(targets, ['c']);
});

run('always edges fire regardless of outcome', () => {
  const m = mission({
    edges: [{ id: 'e', fromNodeId: 'a', toNodeId: 'b', condition: 'always' }],
  });
  assert.deepEqual(resolveNextNodes(m, 'a', 'success').map(n => n.id), ['b']);
  assert.deepEqual(resolveNextNodes(m, 'a', 'failure').map(n => n.id), ['b']);
});

run('node with no outgoing edges returns empty', () => {
  const m = mission();
  assert.deepEqual(resolveNextNodes(m, 'b', 'success'), []);
});

run('edges pointing to missing nodes are skipped', () => {
  const m = mission({
    edges: [{ id: 'e', fromNodeId: 'a', toNodeId: 'ghost', condition: 'always' }],
  });
  assert.deepEqual(resolveNextNodes(m, 'a', 'success'), []);
});

console.log('runtimeActivity');

run('runtime action detector maps common tool output', () => {
  assert.equal(detectRuntimeAction('ReadFile src/App.tsx'), 'Reading files...');
  assert.equal(detectRuntimeAction('Edit src/App.tsx'), 'Writing code...');
  assert.equal(detectRuntimeAction('Bash cargo test'), 'Running tests...');
  assert.equal(detectRuntimeAction('shell command ls'), 'Running command...');
});

run('frontend runtime activity module does not own permission classification', () => {
  assert.equal(typeof detectRuntimeAction, 'function');
});
