import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { geminiAdapter } from '../.tmp-tests/lib/runtime/adapters/gemini.js';

const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'runtime-adapters', 'gemini');
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
  run(`gemini status fixture ${fileName} maps to ${expectedStatus}`, () => {
    const fixture = readFileSync(join(fixtureDir, fileName), 'utf8');
    const status = geminiAdapter.detectStatus(fixture);
    assert.equal(status.status, expectedStatus, status.detail);
    assert.equal(geminiAdapter.detectReady(fixture).ready, expectedStatus === 'idle');
  });
}

run('gemini trust startup prompt maps to waiting_user_answer', () => {
  const prompt = '\u001b]0;Gemini CLI\u0007Trust this folder?';
  assert.equal(geminiAdapter.detectStatus(prompt).status, 'waiting_user_answer');
  assert.equal(geminiAdapter.detectReady(prompt).ready, false);
});

run('gemini authentication startup flow maps to waiting_auth', () => {
  const prompt = '\u001b]0;◇  Ready (james)\u0007Gemini CLI v0.40.1\nSigned in with Google /auth\n╭──╮\n│ ⠙ Waiting for authentication... (Press Esc or Ctrl+C to cancel) │\n╰──╯';
  const status = geminiAdapter.detectStatus(prompt);
  assert.equal(status.status, 'waiting_auth', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(geminiAdapter.detectReady(prompt).ready, false);
});

run('gemini prompt 11 stale auth followed by input prompt maps to idle', () => {
  const fixture = readFileSync(join(fixtureDir, 'auth_then_ready_prompt11.ansi.txt'), 'utf8');
  const status = geminiAdapter.detectStatus(fixture);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(geminiAdapter.detectReady(fixture).ready, true);
});

run('gemini package update after prompt keeps readiness blocked until a fresh prompt', () => {
  const updating = [
    'Gemini CLI v0.40.1',
    '*   Type your message or @path/to/file',
    'Gemini CLI update available! 0.40.1 -> 0.41.1',
    'Installed with npm. Attempting to automatically update now...',
  ].join('\n');
  const status = geminiAdapter.detectStatus(updating);
  assert.equal(status.status, 'processing', status.detail);
  assert.match(status.detail, /update/i);
  assert.equal(geminiAdapter.detectReady(updating).ready, false);

  const settled = `${updating}\nUpdate successful! The new version will be used on your next run.\n*   Type your message or @path/to/file`;
  assert.equal(geminiAdapter.detectStatus(settled).status, 'idle');
  assert.equal(geminiAdapter.detectReady(settled).ready, true);
});

run('gemini pending pasted text does not look ready for another managed injection', () => {
  const prompt = [
    'Gemini CLI v0.41.1',
    '* [Pasted Text: 6166 chars]',
  ].join('\n');
  const status = geminiAdapter.detectStatus(prompt);
  assert.equal(status.status, 'processing', status.detail);
  assert.match(status.detail, /pasted text/i);
  assert.equal(geminiAdapter.detectReady(prompt).ready, false);
});

run('gemini activation input uses raw single-line input instead of bracketed paste', () => {
  const input = geminiAdapter.buildActivationInput('NEW_TASK.\ncall get_task_details.');
  assert.equal(input.preClear, '\x15');
  assert.equal(input.paste, 'NEW_TASK. call get_task_details.');
  assert.equal(input.submit, '\x1b[13u');
  assert.doesNotMatch(input.paste, /\x1b\[200~/);
});

run('gemini shell prompt alone does not imply idle', () => {
  const shell = 'C:\\Users\\user>';
  const status = geminiAdapter.detectStatus(shell);
  assert.equal(status.status, 'error');
  assert.equal(geminiAdapter.detectReady(shell).ready, false);
});

run('gemini prompt-like text without confirmed UI does not imply idle', () => {
  const promptLike = 'Type your message below';
  const status = geminiAdapter.detectStatus(promptLike);
  assert.notEqual(status.status, 'idle');
  assert.equal(geminiAdapter.detectReady(promptLike).ready, false);
});
