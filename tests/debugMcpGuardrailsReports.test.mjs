import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-debug-guardrails-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');

function textPayload(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

try {
  const { initDb } = await import('../mcp-server/src/db/index.mjs');
  const { createDebugRun, getDebugRun, listDebugEvents } = await import('../mcp-server/src/debug/state.mjs');
  const { registerDebugSuiteTools } = await import('../mcp-server/src/debug/tools/suites.mjs');
  const { registerDebugPatchTools } = await import('../mcp-server/src/debug/tools/patches.mjs');
  const { registerDebugCommandTools } = await import('../mcp-server/src/debug/tools/commands.mjs');
  const { registerDebugReportTools } = await import('../mcp-server/src/debug/tools/reports.mjs');

  initDb();

  const tools = new Map();
  const server = {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
  };
  registerDebugSuiteTools(server, () => 'test-session');
  registerDebugPatchTools(server, () => 'test-session');
  registerDebugCommandTools(server, () => 'test-session');
  registerDebugReportTools(server, () => 'test-session');

  const created = createDebugRun({
    suiteName: 'mcp_handshake',
    autonomyMode: 'autopatch',
    requireConfirmation: false,
    allowedPaths: ['.tmp-tests/**', 'docs/debug-reports/**'],
    blockedPaths: ['.env', '.env.*'],
    allowedCommands: ['node -e "process.exit(0)"'],
  });
  assert.equal(created.ok, true);
  const debugRunId = created.debugRun.id;

  const suite = textPayload(await tools.get('debug_run_suite').handler({ debugRunId, suiteName: 'mcp_handshake' }));
  assert.equal(suite.status, 'completed');
  assert.equal(suite.results.length, 1);

  const blocked = await tools.get('debug_read_file').handler({ debugRunId, path: '.env' });
  assert.equal(blocked.isError, true);

  const tmpDir = resolve('.tmp-tests');
  mkdirSync(tmpDir, { recursive: true });
  const patchPath = resolve(tmpDir, 'debug-apply-test.txt');
  writeFileSync(patchPath, 'before\n', 'utf8');

  const diff = [
    'diff --git a/.tmp-tests/debug-apply-test.txt b/.tmp-tests/debug-apply-test.txt',
    '--- a/.tmp-tests/debug-apply-test.txt',
    '+++ b/.tmp-tests/debug-apply-test.txt',
    '@@ -1 +1 @@',
    '-before',
    '+after',
    '',
  ].join('\n');

  const proposal = textPayload(await tools.get('debug_create_patch_proposal').handler({
    debugRunId,
    title: 'Change temp debug file',
    diagnosis: 'Temp file proves patch validation.',
    diff,
    filesTouched: ['.tmp-tests/debug-apply-test.txt'],
    expectedFix: 'Temp file changes from before to after.',
    testsToRun: ['node -e "process.exit(0)"'],
    riskLevel: 'low',
  }));
  assert.match(proposal.patchProposalId, /^debug_patch_/);

  const applied = textPayload(await tools.get('debug_apply_patch').handler({
    debugRunId,
    diff,
    reason: 'Apply temp debug file change',
  }));
  assert.equal(applied.applied, true);
  assert.equal(readFileSync(patchPath, 'utf8').trim(), 'after');
  assert.equal(getDebugRun(debugRunId).repairAttempt, 1);

  const check = textPayload(await tools.get('debug_run_check').handler({
    debugRunId,
    command: 'node -e "process.exit(0)"',
    timeoutMs: 10_000,
  }));
  assert.equal(check.status, 'passed');

  const report = textPayload(await tools.get('debug_write_report').handler({
    debugRunId,
    finalStatus: 'completed',
    diagnosis: 'Debug guardrails, suite, autopatch, command, and report tools passed.',
  }));
  assert.equal(report.status, 'completed');
  assert.equal(existsSync(resolve(report.filePath)), true);

  const events = listDebugEvents(debugRunId, 200);
  assert.ok(events.some(event => event.eventType === 'debug_guardrail_blocked_action'));
  assert.ok(events.some(event => event.eventType === 'debug_patch_proposed'));
  assert.ok(events.some(event => event.eventType === 'debug_patch_applied'));
  assert.ok(events.some(event => event.eventType === 'debug_command_run'));
  assert.ok(events.some(event => event.eventType === 'debug_report_written'));

  rmSync(patchPath, { force: true });
  rmSync(resolve(report.filePath), { force: true });
  rmSync(resolve('docs/debug-reports', `${debugRunId}-bundle.json`), { force: true });

  console.log('PASS debug MCP guardrails, suite, autopatch, command, and report tools');
} finally {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
