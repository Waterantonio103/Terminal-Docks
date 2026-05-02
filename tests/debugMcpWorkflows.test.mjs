import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-debug-workflows-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');

function textPayload(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

try {
  const { initDb, db } = await import('../mcp-server/src/db/index.mjs');
  const { createDebugRun, getDebugRun, listDebugEvents } = await import('../mcp-server/src/debug/state.mjs');
  const { registerDebugWorkflowTools } = await import('../mcp-server/src/debug/tools/workflows.mjs');

  initDb();

  const created = createDebugRun({ suiteName: 'simple_workflows' });
  assert.equal(created.ok, true);
  const debugRunId = created.debugRun.id;

  const tools = new Map();
  const server = {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
  };
  registerDebugWorkflowTools(server, () => 'test-session');

  const workflow = textPayload(await tools.get('debug_create_test_workflow').handler({
    debugRunId,
    templateName: 'simple_input_to_codex',
    model: 'gpt-5',
    yolo: true,
  }));

  assert.match(workflow.missionId, /^debug-mission-/);
  assert.equal(workflow.nodeIds.length, 1);
  assert.equal(workflow.terminalIds.length, 1);

  const missionRow = db.prepare('SELECT mission_json, status FROM compiled_missions WHERE mission_id = ?').get(workflow.missionId);
  assert.equal(missionRow.status, 'created');
  const mission = JSON.parse(missionRow.mission_json);
  assert.equal(mission.metadata.debug, true);
  assert.equal(mission.metadata.debugRunId, debugRunId);
  assert.equal(mission.nodes[0].terminal.cli, 'codex');
  assert.equal(mission.nodes[0].terminal.model, 'gpt-5');
  assert.equal(mission.nodes[0].terminal.yolo, true);

  const run = textPayload(await tools.get('debug_run_workflow').handler({
    debugRunId,
    missionId: workflow.missionId,
    timeoutMs: 1000,
  }));
  assert.equal(run.status, 'running');

  const runtime = db.prepare('SELECT status, attempt FROM mission_node_runtime WHERE mission_id = ? AND node_id = ?')
    .get(workflow.missionId, workflow.nodeIds[0]);
  assert.equal(runtime.status, 'queued');
  assert.equal(runtime.attempt, 1);

  const status = textPayload(await tools.get('debug_wait_for_status').handler({
    debugRunId,
    missionId: workflow.missionId,
    nodeId: workflow.nodeIds[0],
    status: 'queued',
    timeoutMs: 1000,
  }));
  assert.equal(status.matched, true);

  const event = textPayload(await tools.get('debug_wait_for_event').handler({
    debugRunId,
    missionId: workflow.missionId,
    eventType: 'debug_node_queued',
    nodeId: workflow.nodeIds[0],
    timeoutMs: 1000,
  }));
  assert.equal(event.matched, true);

  const terminal = textPayload(await tools.get('debug_wait_for_terminal_contains').handler({
    debugRunId,
    missionId: workflow.missionId,
    terminalId: workflow.terminalIds[0],
    text: 'queued',
    timeoutMs: 1000,
  }));
  assert.equal(terminal.matched, true);

  const blocked = await tools.get('debug_run_workflow').handler({
    debugRunId,
    missionId: 'not-a-debug-mission',
    timeoutMs: 1000,
  });
  assert.equal(blocked.isError, true);

  const updatedRun = getDebugRun(debugRunId);
  assert.deepEqual(updatedRun.missionIds, [workflow.missionId]);

  const reset = textPayload(await tools.get('debug_reset_test_state').handler({ debugRunId }));
  assert.deepEqual(reset.missionIds, [workflow.missionId]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compiled_missions WHERE mission_id = ?').get(workflow.missionId).count, 0);
  assert.deepEqual(getDebugRun(debugRunId).missionIds, []);

  const events = listDebugEvents(debugRunId);
  assert.ok(events.some(item => item.eventType === 'debug_workflow_created'));
  assert.ok(events.some(item => item.eventType === 'debug_test_started'));

  console.log('PASS debug MCP workflow tools create, run, wait, and reset debug missions');
} finally {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
