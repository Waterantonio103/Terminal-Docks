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

