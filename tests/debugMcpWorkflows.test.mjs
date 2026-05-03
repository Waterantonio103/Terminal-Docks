import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-debug-workflows-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
const concreteOutputRoot = join(process.cwd(), 'docks-testing', 'debug-validator-test');

function textPayload(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

try {
  const { initDb, db } = await import('../mcp-server/src/db/index.mjs');
  const { createDebugRun, getDebugRun, listDebugEvents } = await import('../mcp-server/src/debug/state.mjs');
  const { registerDebugWorkflowTools } = await import('../mcp-server/src/debug/tools/workflows.mjs');
  const { registerWorkflowTools } = await import('../mcp-server/src/tools/workflow.mjs');
  const { registerCommunicationTools } = await import('../mcp-server/src/tools/communication.mjs');

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
  registerWorkflowTools(server, () => 'test-session');
  registerCommunicationTools(server, () => 'test-session');

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

  const tripleWorkflow = textPayload(await tools.get('debug_create_test_workflow').handler({
    debugRunId,
    templateName: 'input_agent_agent_output',
    cliId: 'gemini',
    model: 'gemini-2.5-pro',
  }));
  assert.equal(tripleWorkflow.nodeIds.length, 3);
  assert.equal(tripleWorkflow.terminalIds.length, 3);

  const tripleMissionRow = db.prepare('SELECT mission_json FROM compiled_missions WHERE mission_id = ?').get(tripleWorkflow.missionId);
  const tripleMission = JSON.parse(tripleMissionRow.mission_json);
  assert.deepEqual(tripleMission.metadata.executionLayers, [
    ['debug-agent-a'],
    ['debug-agent-b'],
    ['debug-output-agent'],
  ]);
  assert.deepEqual(tripleMission.edges.map(edge => [edge.fromNodeId, edge.toNodeId]), [
    ['debug-agent-a', 'debug-agent-b'],
    ['debug-agent-b', 'debug-output-agent'],
  ]);
  assert.deepEqual(tripleMission.nodes.map(node => node.terminal.cli), ['gemini', 'gemini', 'gemini']);

  const blocked = await tools.get('debug_run_workflow').handler({
    debugRunId,
    missionId: 'not-a-debug-mission',
    timeoutMs: 1000,
  });
  assert.equal(blocked.isError, true);

  const updatedRun = getDebugRun(debugRunId);
  assert.deepEqual(updatedRun.missionIds, [workflow.missionId, tripleWorkflow.missionId]);

  const customWorkflow = textPayload(await tools.get('debug_create_custom_workflow').handler({
    debugRunId,
    workflowName: 'scout-builder-branch-smoke',
    taskPrompt: 'Scout the repo, then route to one Codex builder.',
    agents: [
      { id: 'scout', roleId: 'scout', title: 'Scout' },
      { id: 'builder', roleId: 'builder', title: 'Builder' },
    ],
    edges: [
      { fromNodeId: 'scout', toNodeId: 'builder', condition: 'on_success' },
    ],
  }));
  assert.deepEqual(customWorkflow.nodeIds, ['scout', 'builder']);
  assert.deepEqual(customWorkflow.startNodeIds, ['scout']);
  assert.deepEqual(customWorkflow.executionLayers, [['scout'], ['builder']]);

  const customMissionRow = db.prepare('SELECT mission_json FROM compiled_missions WHERE mission_id = ?').get(customWorkflow.missionId);
  const customMission = JSON.parse(customMissionRow.mission_json);
  assert.equal(customMission.metadata.customWorkflow, true);
  assert.equal(customMission.metadata.codexOnly, true);
  assert.deepEqual(customMission.nodes.map(node => node.terminal.cli), ['codex', 'codex']);

  textPayload(await tools.get('debug_run_workflow').handler({
    debugRunId,
    missionId: customWorkflow.missionId,
    timeoutMs: 1000,
  }));
  const scoutActivation = textPayload(await tools.get('debug_activate_node').handler({
    debugRunId,
    missionId: customWorkflow.missionId,
    nodeId: 'scout',
  }));
  assert.equal(scoutActivation.status, 'running');

  const scoutComplete = textPayload(await tools.get('complete_task').handler({
    missionId: customWorkflow.missionId,
    nodeId: 'scout',
    attempt: 1,
    outcome: 'success',
    title: 'Scout complete',
    summary: 'Repo inspection complete. Builder has enough context.',
    keyFindings: ['Custom workflow routed through Codex nodes.'],
  }));
  assert.deepEqual(scoutComplete.routed.map(route => route.targetNodeId), ['builder']);

  const builderRuntimeQueued = textPayload(await tools.get('debug_run_node').handler({
    debugRunId,
    missionId: customWorkflow.missionId,
    nodeId: 'builder',
  }));
  assert.equal(builderRuntimeQueued.status, 'queued');
  const builderActivation = textPayload(await tools.get('debug_activate_node').handler({
    debugRunId,
    missionId: customWorkflow.missionId,
    nodeId: 'builder',
  }));
  assert.equal(builderActivation.status, 'running');

  const inbox = JSON.parse((await tools.get('read_inbox').handler({
    missionId: customWorkflow.missionId,
    nodeId: 'builder',
    afterSeq: 0,
  })).content[0].text);
  assert.equal(inbox.messages.length, 1);
  assert.match(inbox.messages[0].content, /Scout complete/);

  textPayload(await tools.get('complete_task').handler({
    missionId: customWorkflow.missionId,
    nodeId: 'builder',
    attempt: 1,
    outcome: 'success',
    title: 'Builder complete',
    summary: 'Builder produced the requested output.',
  }));

  const customRuntimes = db.prepare('SELECT node_id, status, last_outcome FROM mission_node_runtime WHERE mission_id = ? ORDER BY node_id ASC')
    .all(customWorkflow.missionId);
  assert.deepEqual(customRuntimes.map(row => [row.node_id, row.status, row.last_outcome]), [
    ['builder', 'completed', 'success'],
    ['scout', 'completed', 'success'],
  ]);

  rmSync(concreteOutputRoot, { recursive: true, force: true });
  mkdirSync(concreteOutputRoot, { recursive: true });
  writeFileSync(join(concreteOutputRoot, 'index.html'), '<!doctype html><title>Runnable</title>');
  writeFileSync(join(concreteOutputRoot, 'README.md'), '# Runnable output\n\nOpen index.html.');
  const runnableValidation = textPayload(await tools.get('debug_validate_concrete_output').handler({
    debugRunId,
    missionId: customWorkflow.missionId,
    outputPath: 'docks-testing/debug-validator-test',
    expectedFiles: ['index.html', 'README.md'],
    mustBeRunnable: true,
    disallowMarkdownOnly: true,
    openFile: 'index.html',
  }));
  assert.equal(runnableValidation.ok, true);
  assert.deepEqual(runnableValidation.missingFiles, []);

  rmSync(concreteOutputRoot, { recursive: true, force: true });
  mkdirSync(concreteOutputRoot, { recursive: true });
  writeFileSync(join(concreteOutputRoot, 'result.md'), '# Only markdown');
  const markdownOnlyValidation = textPayload(await tools.get('debug_validate_concrete_output').handler({
    debugRunId,
    missionId: customWorkflow.missionId,
    outputPath: 'docks-testing/debug-validator-test',
    expectedFiles: ['result.md'],
    mustBeRunnable: true,
    disallowMarkdownOnly: true,
  }));
  assert.equal(markdownOnlyValidation.ok, false);
  assert.ok(markdownOnlyValidation.notes.some(note => /documentation-only|No runnable/i.test(note)));

  const reset = textPayload(await tools.get('debug_reset_test_state').handler({ debugRunId }));
  assert.deepEqual(reset.missionIds, [workflow.missionId, tripleWorkflow.missionId, customWorkflow.missionId]);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compiled_missions WHERE mission_id = ?').get(workflow.missionId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compiled_missions WHERE mission_id = ?').get(tripleWorkflow.missionId).count, 0);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compiled_missions WHERE mission_id = ?').get(customWorkflow.missionId).count, 0);
  assert.deepEqual(getDebugRun(debugRunId).missionIds, []);

  const events = listDebugEvents(debugRunId);
  assert.ok(events.some(item => item.eventType === 'debug_workflow_created'));
  assert.ok(events.some(item => item.eventType === 'debug_test_started'));

  console.log('PASS debug MCP workflow tools create, run, wait, and reset debug missions');
} finally {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  try { rmSync(concreteOutputRoot, { recursive: true, force: true }); } catch {}
}
