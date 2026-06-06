import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexAdapter } from '../.tmp-tests/lib/runtime/adapters/codex.js';
import { parseCodexContextUsage, parseCodexContextUsagePercent } from '../.tmp-tests/lib/codexContextUsage.js';

const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'runtime-adapters', 'codex');
const cases = [
  ['idle.ansi.txt', 'idle'],
  ['processing.ansi.txt', 'idle'],
  ['completed.ansi.txt', 'completed'],
  ['waiting_user_answer.ansi.txt', 'waiting_user_answer'],
  ['error_or_stale.ansi.txt', 'error'],
];

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

for (const [fileName, expectedStatus] of cases) {
  run(`codex status fixture ${fileName} maps to ${expectedStatus}`, () => {
    const fixture = readFileSync(join(fixtureDir, fileName), 'utf8');
    const status = codexAdapter.detectStatus(fixture);
    assert.equal(status.status, expectedStatus, status.detail);
    assert.equal(codexAdapter.detectReady(fixture).ready, expectedStatus === 'idle');
  });
}

run('codex ordinary footer does not imply permission or completion', () => {
  const footer = 'gpt-5.5 high · ~ · gpt-5.5 · Context 94% left · Context 6% used · Fast off';
  assert.equal(codexAdapter.detectPermissionRequest(footer), null);
  assert.equal(codexAdapter.detectCompletion(footer), null);
  assert.notEqual(codexAdapter.detectStatus(footer).status, 'completed');
  assert.equal(codexAdapter.detectReady(footer).ready, false);
});

run('codex update prompt requires user choice and maps actions to menu entries', () => {
  const prompt = [
    'Update available! 0.136.0 -> 0.137.0',
    '› 1. Update now (runs npm install -g @openai/codex)',
    '  2. Skip',
    '  3. Skip until next version',
    'Press enter to continue',
  ].join('\n');
  const permission = codexAdapter.detectPermissionRequest(prompt)?.request;

  assert.equal(codexAdapter.detectStatus(prompt).status, 'waiting_user_answer');
  assert.equal(permission?.category, 'package_install');
  assert.match(permission?.detail ?? '', /update available/i);
  assert.equal(codexAdapter.buildPermissionResponse('approve', permission).input, '1\r');
  assert.equal(codexAdapter.buildPermissionResponse('deny', permission).input, '2\r');
});

run('codex context parser prefers exact CLI used percentage', () => {
  assert.equal(
    parseCodexContextUsagePercent('gpt-5.5 high · ~ · gpt-5.5 · Context 94% left · Context 6% used · Fast off'),
    6,
  );
  assert.equal(parseCodexContextUsagePercent('gpt-5.4 default · C:\\repo · Context 86% left'), 14);
  assert.equal(parseCodexContextUsagePercent('Context used: 7%'), 7);
  assert.equal(parseCodexContextUsagePercent('7% context used'), 7);
  assert.deepEqual(parseCodexContextUsage('Context 125k/1M tokens · Context 13% used'), {
    usedPercent: 13,
    usedTokens: 125000,
    totalTokens: 1000000,
  });
});

run('codex stale active work does not hide visible idle prompt', () => {
  const staleActive = [
    '• Pasted Content',
    'Working (esc to interrupt)',
    'calling tool "apply_patch"',
    'updated PRD.md',
  ].join('\n');
  const idleTail = [
    '■ Conversation interrupted - tell the model what to do differently.',
    '',
    '› Implement {feature}',
    '',
    '  gpt-5.4 default · C:\\VSCODE\\comet-testing\\app-test2 · Context 86% left',
  ].join('\n');
  const status = codexAdapter.detectStatus(`${staleActive}\n${'\n'.repeat(30)}${idleTail}`);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(codexAdapter.detectReady(`${staleActive}\n${'\n'.repeat(30)}${idleTail}`).ready, true);
});

run('codex spark footer with prompt is ready for managed injection', () => {
  const readyFrame = [
    '╭─ OpenAI Codex (v0.136.0)',
    '› read the codebase',
    'gpt-5.3-codex-spark low · C:\\VSCODE\\file-type-zoo · gpt-5.3-codex-spark · Context 100% left',
  ].join('\n');

  const status = codexAdapter.detectStatus(readyFrame);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(codexAdapter.detectReady(readyFrame).ready, true);
});

run('codex compact spark footer with truncated context is ready for managed injection', () => {
  const readyFrame = [
    '╭───────────────────────────────────────────────────────╮',
    '│ >_ OpenAI Codex (v0.136.0)                            │',
    '│                                                       │',
    '│ model:     gpt-5.3-codex-spark low   /model to change │',
    '│ directory: C:\\VSCODE\\file-type-zoo                    │',
    '╰───────────────────────────────────────────────────────╯',
    '  Tip: New Use /fast to enable our fastest inference with increased plan usage.',
    '',
    '› Improve documentation in @filename',
    '  gpt-5.3-codex-spark low · C:\\VSCODE\\file-type-zoo · gpt-5.3-codex-spark · Con…',
  ].join('\n');

  const status = codexAdapter.detectStatus(readyFrame);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(codexAdapter.detectReady(readyFrame).ready, true);
});

run('codex inline prompt is blocked while model is loading', () => {
  const loadingFrame = ']0;C:\\WINDOWS\\system32\\cmd.exe\u0007 ╭───────────────────────────────────────╮ │ >_ OpenAI Codex (v0.136.0) │ │ model: loading /model to change │ │ directory: C:\\VSCODE\\file-type-zoo │ ╰───────────────────────────────────────╯ › Implement {feature} gpt-5.3-codex-spark default · C:\\VSCODE\\file-type-zoo · gpt-5.3-codex-spark · Context 100% left · Context 0% used · Fast off';

  const status = codexAdapter.detectStatus(loadingFrame);
  assert.equal(status.status, 'processing', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(codexAdapter.detectReady(loadingFrame).ready, false);
});

run('codex inline prompt and loaded model frame is ready for managed injection', () => {
  const readyFrame = ']0;C:\\WINDOWS\\system32\\cmd.exe\u0007 ╭───────────────────────────────────────╮ │ >_ OpenAI Codex (v0.136.0) │ │ model: loading /model to change │ │ directory: C:\\VSCODE\\file-type-zoo │ ╰───────────────────────────────────────╯ › Implement {feature} gpt-5.3-codex-spark default · C:\\VSCODE\\file-type-zoo · gpt-5.3-codex-spark · Context 100% left · Context 0% used · Fast off ╭───────────────────────────────────────────────────────╮ │ >_ OpenAI Codex (v0.136.0) │ │ model: gpt-5.3-codex-spark low /model to change │ │ directory: C:\\VSCODE\\file-type-zoo │ ╰───────────────────────────────────────────────────────╯ › Implement {feature} gpt-5.3-codex-spark low · C:\\VSCODE\\file-type-zoo · gpt-5.3-codex-spark · Context 100% left · Context 0% used · Fast off';

  const status = codexAdapter.detectStatus(readyFrame);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(codexAdapter.detectReady(readyFrame).ready, true);
});

run('codex MCP startup before latest prompt does not block readiness', () => {
  const readyFrame = [
    '• Starting MCP servers (4/5): codex_apps (0s • esc to interrupt)',
    'MCP startup incomplete (failed: excalidraw)',
    '› read the codebase',
    'gpt-5.3-codex-spark low · C:\\VSCODE\\file-type-zoo · gpt-5.3-codex-spark · Context 100% left',
  ].join('\n');

  const status = codexAdapter.detectStatus(readyFrame);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(codexAdapter.detectReady(readyFrame).ready, true);
});

run('codex MCP startup after prompt frame blocks managed injection readiness', () => {
  const startupFrame = [
    '╭─ OpenAI Codex (v0.136.0)',
    '› Run /review on my current changes',
    'gpt-5.5 medium · C:\\VSCODE\\file-type-zoo\\code · gpt-5.5 · Context 100% left',
    '• Starting MCP servers (2/5): codex_apps, excalidraw, terminal-docks (0s • esc to interrupt)',
  ].join('\n');

  const status = codexAdapter.detectStatus(startupFrame);
  assert.equal(status.status, 'processing', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(codexAdapter.detectReady(startupFrame).ready, false);
  assert.equal(codexAdapter.normalizeOutput(startupFrame).some(event => event.kind === 'ready'), false);
});

run('codex confirmation prompts require user action', () => {
  assert.equal(codexAdapter.detectStatus('Proceed? (y)').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Approve edits manually?\nYes / No').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Do you trust this folder? (y/n)').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Do you want to trust the files in this folder?\nYes / No').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Enable admin sandbox? y/n').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Allow admin sandbox for this session?\nProceed?').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectPermissionRequest('Do you want to trust the files in this folder?\nYes / No')?.request.category, 'file_read');
  assert.equal(codexAdapter.detectPermissionRequest('Allow admin sandbox for this session?\nProceed?')?.request.category, 'shell_execution');
});

run('codex activation input submits with enter', () => {
  const input = codexAdapter.buildActivationInput('You are the workspace agent.\nUser: hello');

  assert.equal(input.preClear, '\x15');
  assert.equal(input.paste, 'You are the workspace agent. User: hello');
  assert.equal(input.submit, '\r');
});
