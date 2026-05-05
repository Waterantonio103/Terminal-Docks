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
