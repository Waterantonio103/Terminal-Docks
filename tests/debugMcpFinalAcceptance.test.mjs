import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-debug-final-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');

function textPayload(result) {
  assert.equal(result.isError, undefined);
  return JSON.parse(result.content[0].text);
}

try {
  const { initDb, db } = await import('../mcp-server/src/db/index.mjs');
  const { registerTaskTools } = await import('../mcp-server/src/tools/tasks.mjs');
  const { registerDebugTools } = await import('../mcp-server/src/debug/index.mjs');
  const { listDebugEvents } = await import('../mcp-server/src/debug/state.mjs');

  initDb();

  const tools = new Map();
  const server = {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
  };

  registerTaskTools(server, () => 'acceptance-session');
  registerDebugTools(server, () => 'acceptance-session');

  const expectedDebugTools = [
    'debug_start_run',
    'debug_get_run',
    'debug_get_recent_runtime_logs',
    'debug_get_terminal_tail',
    'debug_get_mission_snapshot',
    'debug_get_workflow_events',
    'debug_get_mcp_events',
    'debug_get_frontend_errors',
    'debug_get_active_sessions',
    'debug_get_active_ptys',
    'debug_get_node_state',
    'debug_search_logs',
    'debug_create_test_workflow',
    'debug_run_workflow',
    'debug_run_node',
    'debug_wait_for_status',
    'debug_wait_for_event',
    'debug_wait_for_terminal_contains',
    'debug_validate_concrete_output',
    'debug_create_custom_workflow',
    'debug_activate_node',
    'debug_reset_test_state',
    'debug_run_suite',
    'debug_rerun_last_suite',
    'debug_search_code',
    'debug_read_file',
    'debug_get_file_context',
    'debug_create_patch_proposal',
    'debug_list_patch_proposals',
    'debug_read_patch_proposal',
    'debug_apply_patch',
    'debug_revert_patch',
    'debug_run_check',
    'debug_run_typecheck',
    'debug_run_tests',
    'debug_write_report',
    'debug_get_report',
    'debug_export_diagnostics_bundle',
  ];

  for (const toolName of expectedDebugTools) {
    assert.ok(tools.has(toolName), `missing debug tool ${toolName}`);
  }
  assert.ok(tools.has('create_task'), 'normal task tool should remain registered');

  const taskResult = await tools.get('create_task').handler({ title: 'normal workflow task' });
  assert.equal(taskResult.isError, undefined);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM tasks').get().count, 1);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM debug_runs').get().count, 0);

  const diagnose = textPayload(await tools.get('debug_start_run').handler({
    suiteName: 'simple_workflows',
    autonomyMode: 'diagnose',
  }));
  assert.equal(diagnose.autonomyMode, 'diagnose');
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM compiled_missions').get().count, 0);

  const workflow = textPayload(await tools.get('debug_create_test_workflow').handler({
    debugRunId: diagnose.debugRunId,
    templateName: 'simple_input_to_codex',
  }));
  const missionRow = db.prepare('SELECT mission_json FROM compiled_missions WHERE mission_id = ?').get(workflow.missionId);
  assert.equal(JSON.parse(missionRow.mission_json).metadata.debug, true);

  const blockedNormal = await tools.get('debug_run_workflow').handler({
    debugRunId: diagnose.debugRunId,
    missionId: 'normal-mission',
  });
  assert.equal(blockedNormal.isError, true);

  const simpleSuite = textPayload(await tools.get('debug_run_suite').handler({
    debugRunId: diagnose.debugRunId,
    suiteName: 'simple_workflows',
  }));
  assert.equal(simpleSuite.status, 'completed');
  assert.equal(simpleSuite.results.length, 6);
  assert.equal(simpleSuite.runnerMode, 'handler_harness');
  assert.equal(simpleSuite.liveRuntimeLaunched, false);
  assert.match(simpleSuite.warning, /handler-level smoke harness/);

  const liveRequiredSuite = textPayload(await tools.get('debug_run_suite').handler({
    debugRunId: diagnose.debugRunId,
    suiteName: 'simple_workflows',
    requireLiveRuntime: true,
  }));
  assert.equal(liveRequiredSuite.status, 'blocked');
  assert.equal(liveRequiredSuite.liveRuntimeLaunched, false);
  assert.match(liveRequiredSuite.reason, /cannot satisfy requireLiveRuntime=true/);

  const consecutiveRun = textPayload(await tools.get('debug_start_run').handler({
    suiteName: 'consecutive_runs',
    autonomyMode: 'diagnose',
  }));
  const consecutiveSuite = textPayload(await tools.get('debug_run_suite').handler({
    debugRunId: consecutiveRun.debugRunId,
    suiteName: 'consecutive_runs',
  }));
  assert.equal(consecutiveSuite.status, 'completed');

  const handshakeRun = textPayload(await tools.get('debug_start_run').handler({
    suiteName: 'mcp_handshake',
    autonomyMode: 'diagnose',
  }));
  const handshakeSuite = textPayload(await tools.get('debug_run_suite').handler({
    debugRunId: handshakeRun.debugRunId,
    suiteName: 'mcp_handshake',
  }));
  assert.equal(handshakeSuite.status, 'completed');

  const proposeRun = textPayload(await tools.get('debug_start_run').handler({
    suiteName: 'mcp_handshake',
    autonomyMode: 'propose',
    allowedPaths: ['.tmp-tests/**', 'docs/debug-reports/**'],
  }));
  const diff = [
    'diff --git a/.tmp-tests/propose-only.txt b/.tmp-tests/propose-only.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/.tmp-tests/propose-only.txt',
    '@@ -0,0 +1 @@',
    '+proposal',
    '',
  ].join('\n');
  const proposal = textPayload(await tools.get('debug_create_patch_proposal').handler({
    debugRunId: proposeRun.debugRunId,
    title: 'Proposal only',
    diagnosis: 'Validate propose mode does not apply files.',
    diff,
    filesTouched: ['.tmp-tests/propose-only.txt'],
    expectedFix: 'Only stores a proposal.',
    testsToRun: [],
    riskLevel: 'low',
  }));
  assert.match(proposal.patchProposalId, /^debug_patch_/);
  assert.equal(existsSync(resolve('.tmp-tests/propose-only.txt')), false);

  const autopatchRun = textPayload(await tools.get('debug_start_run').handler({
    suiteName: 'mcp_handshake',
    autonomyMode: 'autopatch',
    requireConfirmation: false,
    maxRepairAttempts: 1,
    allowedPaths: ['.tmp-tests/**', 'docs/debug-reports/**'],
    blockedPaths: ['.env', '.env.*'],
    allowedCommands: ['node -e "process.exit(0)"'],
  }));
  const blockedEnv = await tools.get('debug_read_file').handler({
    debugRunId: autopatchRun.debugRunId,
    path: '.env',
  });
  assert.equal(blockedEnv.isError, true);

  const applyDiff = [
    'diff --git a/.tmp-tests/final-acceptance.txt b/.tmp-tests/final-acceptance.txt',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/.tmp-tests/final-acceptance.txt',
    '@@ -0,0 +1 @@',
    '+accepted',
    '',
  ].join('\n');
  const applied = textPayload(await tools.get('debug_apply_patch').handler({
    debugRunId: autopatchRun.debugRunId,
    diff: applyDiff,
    reason: 'Final acceptance autopatch scope check',
  }));
  assert.equal(applied.applied, true);
  assert.deepEqual(applied.changedFiles, ['.tmp-tests/final-acceptance.txt']);

  const overLimit = await tools.get('debug_apply_patch').handler({
    debugRunId: autopatchRun.debugRunId,
    diff: applyDiff,
    reason: 'Attempt after maxRepairAttempts',
  });
  assert.equal(overLimit.isError, true);

  const check = textPayload(await tools.get('debug_run_check').handler({
    debugRunId: autopatchRun.debugRunId,
    command: 'node -e "process.exit(0)"',
  }));
  assert.equal(check.status, 'passed');

  const disallowedCommand = await tools.get('debug_run_check').handler({
    debugRunId: autopatchRun.debugRunId,
    command: 'git status',
  });
  assert.equal(disallowedCommand.isError, true);

  const report = textPayload(await tools.get('debug_write_report').handler({
    debugRunId: autopatchRun.debugRunId,
    finalStatus: 'completed',
    diagnosis: 'Final acceptance path completed.',
  }));
  assert.equal(report.status, 'completed');
  assert.equal(existsSync(resolve(report.filePath)), true);

  const bundle = textPayload(await tools.get('debug_export_diagnostics_bundle').handler({
    debugRunId: autopatchRun.debugRunId,
  }));
  assert.equal(existsSync(resolve(bundle.filePath)), true);

  const events = listDebugEvents(autopatchRun.debugRunId, 500).map(event => event.eventType);
  for (const eventType of [
    'debug_run_started',
    'debug_tool_called',
    'debug_patch_applied',
    'debug_command_run',
    'debug_guardrail_blocked_action',
    'debug_report_written',
    'debug_run_completed',
  ]) {
    assert.ok(events.includes(eventType), `missing audit event ${eventType}`);
  }

  rmSync(resolve('.tmp-tests/final-acceptance.txt'), { force: true });
  rmSync(resolve(report.filePath), { force: true });
  rmSync(resolve(bundle.filePath), { force: true });

  console.log('PASS debug MCP final acceptance covers registration, isolation, suites, guardrails, patching, reports, and normal tools');
} finally {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
