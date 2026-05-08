import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeAdapter } from '../.tmp-tests/lib/runtime/adapters/claude.js';

const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'runtime-adapters', 'claude');
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
  run(`claude status fixture ${fileName} maps to ${expectedStatus}`, () => {
    const fixture = readFileSync(join(fixtureDir, fileName), 'utf8');
    const status = claudeAdapter.detectStatus(fixture);
    assert.equal(status.status, expectedStatus, status.detail);
    assert.equal(claudeAdapter.detectReady(fixture).ready, expectedStatus === 'idle');
  });
}

run('claude banner-only startup output does not imply idle', () => {
  const bannerOnly = 'Claude Code v2.1.126\nSonnet 4.6 with medium effort\nC:\\Users\\user\n';
  const status = claudeAdapter.detectStatus(bannerOnly);
  assert.notEqual(status.status, 'idle');
  assert.equal(claudeAdapter.detectReady(bannerOnly).ready, false);
});

run('claude permission prompt maps to waiting_user_answer', () => {
  const prompt = 'Permission request\nAllow Claude to edit this file? [y/n]';
  assert.equal(claudeAdapter.detectStatus(prompt).status, 'waiting_user_answer');
  assert.equal(claudeAdapter.detectReady(prompt).ready, false);
});

run('claude invalid flag help maps to error', () => {
  const help = 'claude --bad-flag\nFatal error: unknown option --bad-flag\nUsage: claude [options]\nC:\\Users\\user>';
  assert.equal(claudeAdapter.detectStatus(help).status, 'error');
  assert.equal(claudeAdapter.detectReady(help).ready, false);
});

run('claude shell tool exit code during active turn is not task completion', () => {
  const activeToolFailure = [
    '● Error: Exit code 127',
    '/usr/bin/bash: line 1: Get-Content: command not found',
    '✢ Simmering... still thinking',
  ].join('\n');

  assert.equal(claudeAdapter.detectStatus(activeToolFailure).status, 'processing');
  assert.equal(claudeAdapter.detectCompletion(activeToolFailure), null);
});

run('claude visible input prompt wins over stale spinner glyphs', () => {
  const promptReady = [
    'Claude Code v2.1.131',
    'Haiku 4.5 · Claude Pro',
    '⠋',
    '────────────────────────────────────────────────────────',
    '❯ Try "how do I log an error?"',
  ].join('\n');

  const status = claudeAdapter.detectStatus(promptReady);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(claudeAdapter.detectReady(promptReady).ready, true);
});

run('claude empty visible prompt with footer chrome maps to idle', () => {
  const promptReady = [
    'Claude Code v2.1.131',
    'Sonnet 4.6 · Claude Pro',
    '────────────────────────────────────────────────────────',
    '❯\u00a0\u2588',
    '────────────────────────────────────────────────────────',
    '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n');

  const status = claudeAdapter.detectStatus(promptReady);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(claudeAdapter.detectReady(promptReady).ready, true);
});
