import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  buildCliReadinessDiagnostic,
  evaluateCliReadiness,
  isStatusSafeForManagedInjection,
  isStrictCliStatusGateEnabled,
} from '../.tmp-tests/lib/runtime/RuntimeReadinessGate.js';
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
    run(`${cliId} readiness gate ${fileName} ready=${expectedReady}`, () => {
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
      assert.equal(evaluation.status.status, expectedStatus);
      assert.equal(evaluation.ready, expectedReady);
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
