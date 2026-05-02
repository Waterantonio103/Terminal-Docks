import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-debug-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');

try {
  const { initDb } = await import('../mcp-server/src/db/index.mjs');
  const { createDebugRun, getDebugRun, listDebugEvents } = await import('../mcp-server/src/debug/state.mjs');

  initDb();

  const created = createDebugRun({
    suiteName: 'simple_workflows',
    autonomyMode: 'autopatch',
    requireConfirmation: false,
    maxRepairAttempts: 2,
  });

  assert.equal(created.ok, true);
  assert.match(created.debugRun.id, /^debug_/);

  const run = getDebugRun(created.debugRun.id);
  assert.equal(run.suiteName, 'simple_workflows');
  assert.equal(run.autonomyMode, 'autopatch');
  assert.equal(run.requireConfirmation, false);
  assert.equal(run.maxRepairAttempts, 2);
  assert.deepEqual(run.missionIds, []);
  assert.deepEqual(run.changedFiles, []);
  assert.ok(run.allowedPaths.includes('mcp-server/**'));
  assert.ok(run.blockedPaths.includes('.env'));

  const events = listDebugEvents(run.id);
  assert.ok(events.some(event => event.eventType === 'debug_run_started'));

  const invalid = createDebugRun({ suiteName: '' });
  assert.equal(invalid.ok, false);
  assert.equal(invalid.code, 'missing_suite_name');

  console.log('PASS debug MCP skeleton persists guarded debug runs');
} finally {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
