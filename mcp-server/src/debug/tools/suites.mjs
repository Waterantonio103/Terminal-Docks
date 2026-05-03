import { z } from 'zod';
import { db } from '../../db/index.mjs';
import { appendWorkflowEvent } from '../../utils/index.mjs';
import { createDebugTestResult, updateDebugRunStatus } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';
import { addDebugRunMission } from '../state.mjs';
import { auditTool, jsonResponse, requireDebugRun } from './shared.mjs';
import { buildMissionTemplate, runNodeRecord, seedDebugMission } from './workflows.mjs';

const SUITES = {
  simple_workflows: [
    'simple_input_to_claude',
    'simple_input_to_codex',
    'simple_input_to_gemini',
    'simple_input_to_opencode',
    'input_agent_output',
    'input_agent_agent_output',
  ],
  consecutive_runs: [
    'same_workflow_twice',
    'change_model_and_rerun',
  ],
  mcp_handshake: [
    'mcp_handshake_smoke',
  ],
};

const HANDLER_HARNESS_WARNING =
  'debug_run_suite is a handler-level smoke harness. It seeds debug missions and durable lifecycle rows, but it does not exercise the live UI, NodeTree authoring, RuntimeManager, PTYs, or real CLI agents. Do not count these results as prompt-level UX/backend workflow success.';

function classifyFailure({ missionId, nodeIds }) {
  const events = db.prepare(
    `SELECT type, message, payload_json FROM workflow_events WHERE mission_id = ? ORDER BY id ASC LIMIT 500`
  ).all(missionId);
  const runtimes = nodeIds.map(nodeId => db.prepare(
    `SELECT status, attempt, last_outcome, last_payload FROM mission_node_runtime WHERE mission_id = ? AND node_id = ?`
  ).get(missionId, nodeId));
  if (!events.some(event => event.type === 'debug_workflow_run_requested')) return 'task_injection_failed';
  if (runtimes.some(runtime => runtime?.status === 'failed')) return 'node_status_not_updated';
  if (!events.some(event => event.type === 'debug_node_queued')) return 'task_ack_timeout';
  return null;
}

async function runTemplate(debugRun, templateName) {
  const { mission, nodeIds, terminalIds } = buildMissionTemplate({ debugRun, templateName, yolo: false });
  const sessions = mission.nodes.map(node => ({
    missionId: mission.missionId,
    nodeId: node.id,
    terminalId: node.terminal.terminalId,
    label: node.terminal.terminalTitle,
    cli: node.terminal.cli,
  }));
  seedDebugMission(mission);
  addDebugRunMission(debugRun.id, mission.missionId);
  db.prepare(`UPDATE compiled_missions SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE mission_id = ?`).run(mission.missionId);
  appendWorkflowEvent({
    missionId: mission.missionId,
    type: 'debug_workflow_run_requested',
    message: `Debug suite requested workflow run for ${templateName}.`,
    payload: {
      debug: true,
      debugRunId: debugRun.id,
      suiteName: debugRun.suiteName,
      startNodeIds: mission.metadata?.startNodeIds ?? [],
      runnerMode: 'handler_harness',
      liveRuntimeLaunched: false,
    },
  });
  for (const nodeId of mission.metadata?.startNodeIds ?? []) {
    runNodeRecord({ mission, nodeId, status: 'queued' });
  }
  appendWorkflowEvent({
    missionId: mission.missionId,
    type: 'debug_suite_assertions_collected',
    message: `Debug suite assertions collected for ${templateName}.`,
    payload: { debugRunId: debugRun.id, templateName, nodeIds, terminalIds },
  });
  const failureCategory = classifyFailure({ missionId: mission.missionId, nodeIds });
  const status = failureCategory ? 'failed' : 'passed';
  createDebugTestResult({
    debugRunId: debugRun.id,
    suiteName: debugRun.suiteName,
    testName: templateName,
    status,
    failureCategory,
    notes: status === 'passed'
      ? `Debug workflow was created, queued, and emitted durable lifecycle evidence. ${HANDLER_HARNESS_WARNING}`
      : `Lifecycle assertion failed: ${failureCategory}`,
    evidence: {
      missionId: mission.missionId,
      nodeIds,
      terminalIds,
      runnerMode: 'handler_harness',
      liveRuntimeLaunched: false,
      concreteRunnableOutputValidated: false,
      warning: HANDLER_HARNESS_WARNING,
    },
  });
  if (status === 'failed') {
    writeDebugEvent(debugRun.id, 'debug_test_failed', { templateName, missionId: mission.missionId, failureCategory });
  }
  return {
    testName: templateName,
    status,
    failureCategory,
    missionId: mission.missionId,
    nodeIds,
    terminalIds,
    sessions,
    runnerMode: 'handler_harness',
    liveRuntimeLaunched: false,
    concreteRunnableOutputValidated: false,
    warning: HANDLER_HARNESS_WARNING,
  };
}

export function registerDebugSuiteTools(server, getSessionId) {
  server.registerTool('debug_run_suite', {
    title: 'Debug Run Suite',
    inputSchema: {
      debugRunId: z.string().min(1),
      suiteName: z.enum(Object.keys(SUITES)).optional(),
      requireLiveRuntime: z.boolean().optional(),
    },
  }, async ({ debugRunId, suiteName, requireLiveRuntime = false }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const selectedSuite = suiteName ?? checked.debugRun.suiteName;
    const templates = SUITES[selectedSuite];
    if (!templates) return jsonResponse({ suiteName: selectedSuite, status: 'blocked', reason: `Unknown suite: ${selectedSuite}` });
    if (requireLiveRuntime) {
      const reason = 'debug_run_suite cannot satisfy requireLiveRuntime=true because it is a handler-level harness. Use the app UI or live workflow harness to create and run real RuntimeManager/PTY-backed workflows, then use Debug MCP observability tools to collect evidence.';
      writeDebugEvent(debugRunId, 'debug_guardrail_blocked_action', {
        action: 'debug_run_suite',
        reason,
        suiteName: selectedSuite,
      });
      return jsonResponse({
        debugRunId,
        suiteName: selectedSuite,
        status: 'blocked',
        reason,
        runnerMode: 'handler_harness',
        liveRuntimeLaunched: false,
      });
    }
    updateDebugRunStatus(debugRunId, 'running');
    const results = [];
    for (const templateName of templates) {
      writeDebugEvent(debugRunId, 'debug_test_started', { suiteName: selectedSuite, templateName });
      results.push(await runTemplate({ ...checked.debugRun, suiteName: selectedSuite }, templateName));
    }
    const status = results.some(result => result.status === 'failed') ? 'failed' : 'completed';
    updateDebugRunStatus(debugRunId, status, {
      lastFailure: results.find(result => result.status === 'failed')?.failureCategory ?? null,
    });
    auditTool(debugRunId, 'debug_run_suite', getSessionId?.(), { suiteName: selectedSuite, status });
    return jsonResponse({
      debugRunId,
      suiteName: selectedSuite,
      status,
      runnerMode: 'handler_harness',
      liveRuntimeLaunched: false,
      concreteRunnableOutputValidated: false,
      warning: HANDLER_HARNESS_WARNING,
      results,
    });
  });

  server.registerTool('debug_rerun_last_suite', {
    title: 'Debug Rerun Last Suite',
    inputSchema: { debugRunId: z.string().min(1) },
  }, async ({ debugRunId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    if (!server.callTool) return jsonResponse({ debugRunId, status: 'blocked', reason: 'debug_rerun_last_suite requires MCP server callTool support.' });
    return server.callTool('debug_run_suite', { debugRunId, suiteName: checked.debugRun.suiteName });
  });
}
