import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-debug-observability-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');

function textPayload(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

try {
  const { initDb, db } = await import('../mcp-server/src/db/index.mjs');
  const { createDebugRun, listDebugEvents } = await import('../mcp-server/src/debug/state.mjs');
  const { registerDebugObservabilityTools } = await import('../mcp-server/src/debug/tools/observability.mjs');
  const { registerDebugScreenwatchTools } = await import('../mcp-server/src/debug/tools/screenwatch.mjs');

  initDb();

  const created = createDebugRun({ suiteName: 'simple_workflows' });
  assert.equal(created.ok, true);
  const debugRunId = created.debugRun.id;

  const mission = {
    metadata: { debug: true, suiteName: 'simple_workflows' },
    task: { prompt: 'debug smoke' },
    nodes: [{ id: 'node-a', roleId: 'builder', terminal: { terminalId: 'term-a' } }],
    edges: [],
  };

  db.prepare(
    `INSERT INTO compiled_missions (mission_id, graph_id, mission_json, status)
     VALUES (?, ?, ?, ?)`
  ).run('mission-a', 'graph-a', JSON.stringify(mission), 'active');
  db.prepare(
    `INSERT INTO mission_node_runtime (mission_id, node_id, role_id, status, attempt, last_outcome, last_payload)
     VALUES (?, ?, ?, ?, ?, ?, ?)`
  ).run('mission-a', 'node-a', 'builder', 'running', 1, null, null);
  db.prepare(
    `INSERT INTO agent_runtime_sessions (session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, run_id)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('session-a', 'agent-a', 'mission-a', 'node-a', 1, 'term-a', 'ready', 'run-a');
  db.prepare(
    `INSERT INTO workflow_events (mission_id, node_id, session_id, terminal_id, type, severity, message, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('mission-a', 'node-a', 'session-a', 'term-a', 'cli_ready', 'info', 'CLI ready detected', JSON.stringify({ marker: 'ready' }));
  db.prepare(
    `INSERT INTO session_log (session_id, event_type, content, mission_id, node_id)
     VALUES (?, ?, ?, ?, ?)`
  ).run('session-a', 'message', 'runtime log content', 'mission-a', 'node-a');
  db.prepare(
    `INSERT INTO debug_frontend_errors (timestamp, kind, name, message, stack, route, component, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).run('2026-05-02T10:00:00.000Z', 'react', 'AppRoot', 'boom', 'stack', '/workflow', 'NodeTree', '{}');

  const tools = new Map();
  const server = {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
  };
  registerDebugObservabilityTools(server, () => 'test-session');
  registerDebugScreenwatchTools(server, () => 'test-session');

  const snapshot = textPayload(await tools.get('debug_get_mission_snapshot').handler({ debugRunId, missionId: 'mission-a' }));
  assert.equal(snapshot.mission.missionId, 'mission-a');
  assert.equal(snapshot.nodes[0].nodeId, 'node-a');
  assert.equal(snapshot.runtimeSessions[0].terminalId, 'term-a');
  assert.equal(snapshot.events[0].type, 'cli_ready');

  const tail = textPayload(await tools.get('debug_get_terminal_tail').handler({ debugRunId, terminalId: 'term-a', maxChars: 10 }));
  assert.equal(tail.terminalId, 'term-a');
  assert.equal(tail.truncated, true);
  assert.match(tail.tail, /ready/);

  const errors = textPayload(await tools.get('debug_get_frontend_errors').handler({ debugRunId }));
  assert.equal(errors.errors.length, 1);
  assert.equal(errors.errors[0].message, 'boom');

  const activePtys = textPayload(await tools.get('debug_get_active_ptys').handler({ debugRunId }));
  assert.equal(activePtys.ptys[0].terminalId, 'term-a');

  const search = textPayload(await tools.get('debug_search_logs').handler({ debugRunId, query: 'ready' }));
  assert.equal(search.workflowEvents.length, 1);

  const screenwatchRoot = resolve('.tmp-tests/debug-observability-ui-screenwatch');
  const missionScreenwatchDir = join(screenwatchRoot, 'mission-a');
  mkdirSync(missionScreenwatchDir, { recursive: true });
  const screenwatchPath = join(missionScreenwatchDir, '001-completed.json');
  writeFileSync(screenwatchPath, JSON.stringify({
    schemaVersion: 1,
    capturedAt: '2026-05-02T10:00:01.000Z',
    label: 'completed',
    missionId: 'mission-a',
    issues: ['blank_terminal_0'],
    terminals: [{ index: 0, looksBlank: true }],
  }));

  const capture = textPayload(await tools.get('debug_capture_app_screenshot').handler({
    debugRunId,
    label: 'metadata only',
    outputDir: '.tmp-tests/debug-observability-screenshots',
    mode: 'metadata_only',
  }));
  assert.equal(capture.ok, true);
  assert.match(capture.metadataPath, /\.json$/);
  assert.equal(capture.pngPath, null);
  assert.equal(capture.visualAnalysisRequired, false);
  assert.equal(capture.captureContract.captureTarget, 'matched_app_window_handle');
  assert.equal(capture.captureContract.occlusionIndependent, true);
  assert.equal(capture.captureContract.foregroundWindowRequired, false);
  assert.equal(capture.captureContract.capturesDesktop, false);
  assert.match(capture.analysisInstruction, /mode="window"/);
  assert.match(capture.analysisInstruction, /window handle|foreground desktop/i);

  const snapshots = textPayload(await tools.get('debug_list_ui_screenwatch_snapshots').handler({
    debugRunId,
    missionId: 'mission-a',
    rootDir: '.tmp-tests/debug-observability-ui-screenwatch',
  }));
  assert.equal(snapshots.snapshots.length, 1);
  assert.deepEqual(snapshots.snapshots[0].issues, ['blank_terminal_0']);
  assert.equal(snapshots.snapshots[0].visualReviewRequired, true);
  assert.equal(snapshots.visualReview.required, true);
  assert.equal(snapshots.visualReview.screenshotTool, 'debug_capture_app_screenshot');
  assert.equal(snapshots.visualReview.screenshotContract.occlusionIndependent, true);
  assert.equal(snapshots.visualReview.screenshotContract.capturesDesktop, false);
  assert.match(snapshots.visualReview.instruction, /analyze the PNG/);
  assert.match(snapshots.visualReview.instruction, /window handle/);

  const uiSnapshot = textPayload(await tools.get('debug_read_ui_screenwatch_snapshot').handler({
    debugRunId,
    path: snapshots.snapshots[0].path,
  }));
  assert.equal(uiSnapshot.snapshot.missionId, 'mission-a');
  assert.equal(uiSnapshot.visualReview.required, true);
  assert.match(uiSnapshot.visualReview.reason, /heuristics only/);
  assert.equal(uiSnapshot.visualReview.screenshotContract.foregroundWindowRequired, false);

  const events = listDebugEvents(debugRunId);
  assert.ok(events.some(event => event.eventType === 'debug_evidence_collected'));
  assert.ok(events.some(event => event.eventType === 'debug_screenshot_captured'));
  assert.ok(events.some(event => event.eventType === 'debug_ui_screenwatch_listed'));

  console.log('PASS debug MCP observability tools return durable runtime evidence');
} finally {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
  try { rmSync(resolve('.tmp-tests/debug-observability-ui-screenwatch'), { recursive: true, force: true }); } catch {}
  try { rmSync(resolve('.tmp-tests/debug-observability-screenshots'), { recursive: true, force: true }); } catch {}
}
