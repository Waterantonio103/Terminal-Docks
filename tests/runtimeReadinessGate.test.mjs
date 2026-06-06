import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCliReadinessDiagnostic,
  evaluateCliReadiness,
  isStatusSafeForManagedInjection,
  isStrictCliStatusGateEnabled,
} from '../.tmp-tests/lib/runtime/RuntimeReadinessGate.js';
import { RuntimeSession } from '../.tmp-tests/lib/runtime/RuntimeSession.js';
import { claudeAdapter } from '../.tmp-tests/lib/runtime/adapters/claude.js';
import { codexAdapter } from '../.tmp-tests/lib/runtime/adapters/codex.js';
import { geminiAdapter } from '../.tmp-tests/lib/runtime/adapters/gemini.js';
import { opencodeAdapter } from '../.tmp-tests/lib/runtime/adapters/opencode.js';

const adapters = {
  codex: codexAdapter,
  opencode: opencodeAdapter,
  claude: claudeAdapter,
  gemini: geminiAdapter,
};

const cases = [
  ['idle.ansi.txt', 'idle', true],
  ['processing.ansi.txt', 'processing', false],
  ['completed.ansi.txt', 'completed', false],
  ['waiting_user_answer.ansi.txt', 'waiting_user_answer', false],
  ['error_or_stale.ansi.txt', 'error', false],
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
  run(`${cliId} strict gate is enabled`, () => {
    assert.equal(isStrictCliStatusGateEnabled(cliId), true);
  });

  for (const [fileName, expectedStatus, expectedReady] of cases) {
    const cliExpectedStatus = cliId === 'codex' && fileName === 'processing.ansi.txt'
      ? 'idle'
      : expectedStatus;
    const cliExpectedReady = cliId === 'codex' && fileName === 'processing.ansi.txt'
      ? true
      : expectedReady;
    run(`${cliId} readiness gate ${fileName} ready=${cliExpectedReady}`, () => {
      const fixture = readFileSync(
        join(process.cwd(), 'tests', 'fixtures', 'runtime-adapters', cliId, fileName),
        'utf8',
      );
      const evaluation = evaluateCliReadiness(
        cliId,
        fixture,
        output => adapter.detectStatus(output),
        output => adapter.detectReady(output),
      );

      assert.equal(evaluation.strictGateEnabled, true);
      assert.equal(evaluation.status.status, cliExpectedStatus);
      assert.equal(evaluation.ready, cliExpectedReady);
    });
  }
}

run('low-confidence idle is blocked for managed injection', () => {
  assert.equal(
    isStatusSafeForManagedInjection({
      status: 'idle',
      confidence: 'low',
      detail: 'uncertain prompt-like output',
    }),
    false,
  );
});

run('opencode strict gate accepts visible input prompt despite stale spinner glyphs', () => {
  const output = [
    '\u001b]0;OpenCode\u0007OpenCode',
    '\u001b[?25l⠧\u001b[?25h',
    '┃  Ask anything... "What should I build next?"',
    '┃  Build · GLM-5.1 · medium',
    '~:master ⊙ 2 MCP/status',
  ].join('\n');
  const evaluation = evaluateCliReadiness(
    'opencode',
    output,
    text => opencodeAdapter.detectStatus(text),
    text => opencodeAdapter.detectReady(text),
  );

  assert.equal(evaluation.strictGateEnabled, true);
  assert.equal(evaluation.status.status, 'idle', evaluation.status.detail);
  assert.equal(evaluation.ready, true);
});

run('claude strict gate accepts empty visible input prompt with footer chrome', () => {
  const output = [
    'Claude Code v2.1.131',
    'Sonnet 4.6 · Claude Pro',
    '⠋',
    '❯\u00a0\u2588',
    '-- INSERT -- ⏵⏵ bypass permissions on (shift+tab to cycle)',
  ].join('\n');
  const evaluation = evaluateCliReadiness(
    'claude',
    output,
    text => claudeAdapter.detectStatus(text),
    text => claudeAdapter.detectReady(text),
  );

  assert.equal(evaluation.strictGateEnabled, true);
  assert.equal(evaluation.status.status, 'idle', evaluation.status.detail);
  assert.equal(evaluation.ready, true);
});

run('readiness diagnostics include status, gate state, ids, and redacted tail', () => {
  const diagnostic = buildCliReadinessDiagnostic({
    cliId: 'codex',
    terminalId: 'term-1',
    nodeId: 'node-1',
    sessionId: 'session-1',
    timeoutMs: 1234,
    strictGateEnabled: true,
    status: {
      status: 'waiting_user_answer',
      confidence: 'high',
      detail: 'permission prompt detected',
    },
    recentOutput: 'Allow tool? http://127.0.0.1/mcp?token=secret-value Authorization: Bearer abc123',
  });

  assert.match(diagnostic, /cli=codex/);
  assert.match(diagnostic, /terminalId=term-1/);
  assert.match(diagnostic, /nodeId=node-1/);
  assert.match(diagnostic, /sessionId=session-1/);
  assert.match(diagnostic, /status=waiting_user_answer/);
  assert.match(diagnostic, /confidence=high/);
  assert.match(diagnostic, /strictGateEnabled=true/);
  assert.match(diagnostic, /timeoutMs=1234/);
  assert.doesNotMatch(diagnostic, /secret-value/);
  assert.doesNotMatch(diagnostic, /Bearer abc123/);
});

run('readiness diagnostics redact detail secrets and URL credentials', () => {
  const diagnostic = buildCliReadinessDiagnostic({
    cliId: 'codex',
    terminalId: 'term-secret',
    nodeId: 'node-secret',
    strictGateEnabled: true,
    status: {
      status: 'error',
      confidence: 'high',
      detail: 'Failed for API_KEY=abc123\nat http://user:pass@127.0.0.1:11434',
    },
    recentOutput: 'retry http://me:secret@localhost:3000/?secret=tail-value',
  });

  assert.match(diagnostic, /detail="Failed for API_KEY=<redacted> at http:\/\/<redacted>@127\.0\.0\.1:11434"/);
  assert.match(diagnostic, /recentTail="retry http:\/\/<redacted>@localhost:3000\/\?secret=<redacted>"/);
  assert.doesNotMatch(diagnostic, /abc123/);
  assert.doesNotMatch(diagnostic, /tail-value/);
  assert.doesNotMatch(diagnostic, /user:pass/);
  assert.doesNotMatch(diagnostic, /me:secret/);
  assert.doesNotMatch(diagnostic, /\n/);
});

run('waiting_auth is blocked for managed injection with explicit diagnostics', () => {
  const diagnostic = buildCliReadinessDiagnostic({
    cliId: 'gemini',
    terminalId: 'term-auth',
    nodeId: 'node-auth',
    sessionId: 'session-auth',
    timeoutMs: 20000,
    strictGateEnabled: true,
    status: {
      status: 'waiting_auth',
      confidence: 'high',
      detail: 'Gemini authentication flow detected',
    },
    recentOutput: 'Waiting for authentication... (Press Esc or Ctrl+C to cancel)',
  });

  assert.equal(
    isStatusSafeForManagedInjection({
      status: 'waiting_auth',
      confidence: 'high',
      detail: 'Gemini authentication flow detected',
    }),
    false,
  );
  assert.match(diagnostic, /status=waiting_auth/);
  assert.match(diagnostic, /Gemini authentication flow detected/);
});

run('runtime session permissions resume the state that requested them', () => {
  const session = new RuntimeSession(codexAdapter, {
    missionId: 'mission-1',
    nodeId: 'node-1',
    attempt: 1,
    role: 'builder',
    agentId: 'agent-1',
    cliId: 'codex',
    executionMode: 'interactive_pty',
    terminalId: 'terminal-1',
    workspaceDir: 'C:/repo',
  });

  session.transitionTo('awaiting_cli_ready');
  session.setPermission({
    permissionId: 'codex-update-1',
    category: 'package_install',
    rawPrompt: 'Update available! 0.136.0 -> 0.137.0\n1. Update now\n2. Skip\nPress enter to continue',
    detail: 'Codex CLI update available. Update now?',
    detectedAt: Date.now(),
    sessionId: session.sessionId,
    nodeId: session.nodeId,
  });
  assert.equal(session.state, 'awaiting_permission');
  session.clearPermission();
  assert.equal(session.state, 'awaiting_cli_ready');

  session.transitionTo('running');
  session.setPermission({
    permissionId: 'perm-1',
    category: 'file_edit',
    rawPrompt: 'Allow edit?',
    detail: 'Allow edit?',
    detectedAt: Date.now(),
    sessionId: session.sessionId,
    nodeId: session.nodeId,
  });
  session.clearPermission();
  assert.equal(session.state, 'running');
});
