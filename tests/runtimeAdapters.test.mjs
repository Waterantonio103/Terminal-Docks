import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { claudeAdapter } from '../.tmp-tests/lib/runtime/adapters/claude.js';
import { codexAdapter } from '../.tmp-tests/lib/runtime/adapters/codex.js';
import { geminiAdapter } from '../.tmp-tests/lib/runtime/adapters/gemini.js';
import { opencodeAdapter } from '../.tmp-tests/lib/runtime/adapters/opencode.js';

const fixtureRoot = join(process.cwd(), 'tests', 'fixtures', 'runtime-adapters');
const adapters = {
  codex: codexAdapter,
  opencode: opencodeAdapter,
  claude: claudeAdapter,
  gemini: geminiAdapter,
};

const fixtureCases = [
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

for (const [cliId, adapter] of Object.entries(adapters)) {
  for (const [fileName, expectedStatus] of fixtureCases) {
    run(`${cliId} fixture ${fileName} maps to ${expectedStatus}`, () => {
      const fixture = readFileSync(join(fixtureRoot, cliId, fileName), 'utf8');
      const status = adapter.detectStatus(fixture);
      assert.equal(status.status, expectedStatus, status.detail);
      assert.equal(adapter.detectReady(fixture).ready, expectedStatus === 'idle');
    });
  }
}

run('permission prompt output maps to waiting_user_answer', () => {
  assert.equal(
    codexAdapter.detectStatus('Allow the terminal-docks MCP server to run tool "write_file"?\n1. Allow\nenter to submit').status,
    'waiting_user_answer',
  );
  assert.equal(codexAdapter.detectStatus('Proceed? (y)').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Approve edits manually?\nYes / No').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Do you trust this folder? (y/n)').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Do you want to trust the files in this folder?\nYes / No').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Enable admin sandbox? y/n').status, 'waiting_user_answer');
  assert.equal(codexAdapter.detectStatus('Allow admin sandbox for this session?\nProceed?').status, 'waiting_user_answer');
  assert.equal(opencodeAdapter.detectStatus('Approve command? [y/n]').status, 'waiting_user_answer');
  assert.equal(claudeAdapter.detectStatus('Permission request\nAllow Claude to edit this file? [y/n]').status, 'waiting_user_answer');
  assert.equal(geminiAdapter.detectStatus('Trust this folder?').status, 'waiting_user_answer');
});

run('codex startup permission prompts are categorized', () => {
  assert.equal(
    codexAdapter.detectPermissionRequest('Do you want to trust the files in this folder?\nYes / No')?.request.category,
    'file_read',
  );
  assert.equal(
    codexAdapter.detectPermissionRequest('Allow admin sandbox for this session?\nProceed?')?.request.category,
    'shell_execution',
  );
  assert.equal(
    codexAdapter.detectPermissionRequest('Allow the terminal-docks MCP server to run tool "read_file"?\n1. Allow\nenter to submit')?.request.category,
    'file_read',
  );
});

run('codex numbered approval prompts submit selected allow option', () => {
  const request = codexAdapter.detectPermissionRequest(
    'Allow the terminal-docks MCP server to run tool "read_file"?\n' +
      '  1. Allow\n' +
      '  2. Allow for this session\n' +
      'enter to submit | esc to cancel',
  );

  assert.equal(request?.detected, true);
  assert.equal(
    codexAdapter.buildPermissionResponse('approve', request.request).input,
    '\r',
  );
});

run('ANSI-wrapped permission prompt output maps to waiting_user_answer', () => {
  assert.equal(codexAdapter.detectStatus('Al\u001b[31mlow command? [y/n]').status, 'waiting_user_answer');
  assert.equal(opencodeAdapter.detectStatus('App\u001b[31mrove command? [y/n]').status, 'waiting_user_answer');
  assert.equal(claudeAdapter.detectStatus('Permission request\nAl\u001b[31mlow edit? [y/n]').status, 'waiting_user_answer');
  assert.equal(geminiAdapter.detectStatus('Tr\u001b[31must this folder?').status, 'waiting_user_answer');
});

run('completion marker output maps to completed', () => {
  assert.equal(codexAdapter.detectStatus('Worked for 12s').status, 'completed');
  assert.equal(opencodeAdapter.detectStatus('turn.completed').status, 'completed');
  assert.equal(claudeAdapter.detectStatus('Task completed').status, 'completed');
  assert.equal(geminiAdapter.detectStatus('Task completed').status, 'completed');
});

run('ordinary status/footer text does not trigger permission or completion', () => {
  const footer = 'gpt-5.5 high · ~ · gpt-5.5 · Context 94% left · Context 6% used · Fast off';
  assert.equal(codexAdapter.detectPermissionRequest(footer), null);
  assert.equal(codexAdapter.detectCompletion(footer), null);
  assert.notEqual(codexAdapter.detectStatus(footer).status, 'completed');
  assert.equal(codexAdapter.detectReady(footer).ready, false);
});

run('stale shell prompt after prior CLI UI maps to error', () => {
  assert.equal(codexAdapter.detectStatus('codex\nC:\\Users\\user>').status, 'error');
  assert.equal(opencodeAdapter.detectStatus('opencode\nC:\\Users\\user>').status, 'error');
  assert.equal(claudeAdapter.detectStatus('Claude Code\nC:\\Users\\user>').status, 'error');
  assert.equal(geminiAdapter.detectStatus('Gemini CLI\nC:\\Users\\user>').status, 'error');
});

run('TUI input prompt is not normalized as process exit', () => {
  for (const [cliId, adapter, output] of [
    ['opencode', opencodeAdapter, 'opencode\n> '],
    ['gemini', geminiAdapter, 'Gemini CLI\n> '],
  ]) {
    assert.equal(adapter.detectStatus(output).status, 'idle', cliId);
    assert.equal(
      adapter.normalizeOutput(output).some(event => event.kind === 'process_exit'),
      false,
      cliId,
    );
  }
});

run('OpenCode invalid flag/help output maps to error', () => {
  const help = 'opencode --yolo\nUnknown option: --yolo\nUsage: opencode [options]\nC:\\Users\\user>';
  assert.equal(opencodeAdapter.detectStatus(help).status, 'error');
  assert.equal(opencodeAdapter.detectReady(help).ready, false);
});

run('Claude banner-only startup output does not map to idle', () => {
  const bannerOnly = 'Claude Code v2.1.126\nSonnet 4.6 with medium effort\nC:\\Users\\user\n';
  assert.notEqual(claudeAdapter.detectStatus(bannerOnly).status, 'idle');
  assert.equal(claudeAdapter.detectReady(bannerOnly).ready, false);
});

run('Claude empty prompt line with footer chrome maps to idle', () => {
  const promptReady = [
    'Claude Code v2.1.131',
    'Sonnet 4.6 · Claude Pro',
    '❯\u00a0\u2588',
    '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n');
  assert.equal(claudeAdapter.detectStatus(promptReady).status, 'idle');
  assert.equal(claudeAdapter.detectReady(promptReady).ready, true);
});

run('Gemini trust/startup prompt output does not map to idle', () => {
  const prompt = '\u001b]0;Gemini CLI\u0007Trust this folder?';
  assert.equal(geminiAdapter.detectStatus(prompt).status, 'waiting_user_answer');
  assert.equal(geminiAdapter.detectReady(prompt).ready, false);
});

run('Gemini latest visible input prompt wins over stale auth spinner', () => {
  const fixture = readFileSync(join(fixtureRoot, 'gemini', 'auth_then_ready_prompt11.ansi.txt'), 'utf8');
  const status = geminiAdapter.detectStatus(fixture);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(geminiAdapter.detectReady(fixture).ready, true);
});
