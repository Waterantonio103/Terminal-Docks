import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { codexAdapter } from '../.tmp-tests/lib/runtime/adapters/codex.js';

const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'runtime-adapters', 'codex');
const cases = [
  ['idle.ansi.txt', 'idle'],
  ['processing.ansi.txt', 'processing'],
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
    '  gpt-5.4 default · C:\\VSCODE\\docks-testing\\app-test2 · Context 86% left',
  ].join('\n');
  const status = codexAdapter.detectStatus(`${staleActive}\n${'\n'.repeat(30)}${idleTail}`);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(codexAdapter.detectReady(`${staleActive}\n${'\n'.repeat(30)}${idleTail}`).ready, true);
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
