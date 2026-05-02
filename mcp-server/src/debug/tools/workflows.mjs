import { randomUUID } from 'crypto';
import { z } from 'zod';
import { db } from '../../db/index.mjs';
import { broadcast } from '../../state.mjs';
import { appendWorkflowEvent, makeToolText, parseJsonSafe } from '../../utils/index.mjs';
import { loadCompiledMissionRecord } from '../../utils/workflow.mjs';
import { addDebugRunMission, clearDebugRunMissions, getDebugRun, updateDebugRunStatus } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';

export const TEMPLATE_NAMES = [
  'simple_input_to_claude',
  'simple_input_to_codex',
  'simple_input_to_gemini',
  'simple_input_to_opencode',
  'input_agent_output',
  'input_agent_agent_output',
  'same_workflow_twice',
  'change_model_and_rerun',
  'mcp_handshake_smoke',
];

const CLI_BY_TEMPLATE = {
  simple_input_to_claude: 'claude',
  simple_input_to_codex: 'codex',
  simple_input_to_gemini: 'gemini',
  simple_input_to_opencode: 'opencode',
  input_agent_output: 'codex',
  input_agent_agent_output: 'codex',
  same_workflow_twice: 'codex',
  change_model_and_rerun: 'codex',
  mcp_handshake_smoke: 'codex',
};

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_TIMEOUT_MS = 120_000;
const POLL_MS = 100;

function jsonResponse(value) {
  return makeToolText(JSON.stringify(value, null, 2));
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function boundedTimeout(value, fallback = DEFAULT_TIMEOUT_MS) {
  if (!Number.isInteger(value) || value <= 0) return fallback;
  return Math.min(value, MAX_TIMEOUT_MS);
}

function requireDebugRun(debugRunId) {
  const debugRun = getDebugRun(debugRunId);
  if (!debugRun) {
    return { ok: false, response: makeToolText(`Debug run not found: ${debugRunId}`, true) };
  }
  return { ok: true, debugRun };
}

function requireDebugMission(debugRun, missionId, allowNonDebugMission = false) {
  const record = loadCompiledMissionRecord(missionId);
  if (!record) {
    return { ok: false, response: makeToolText(`Mission not found: ${missionId}`, true) };
  }

  const metadata = record.mission?.metadata ?? {};
  const isDebugMission = metadata.debug === true && metadata.debugRunId === debugRun.id;
  if (!isDebugMission && !allowNonDebugMission) {
    return {
      ok: false,
      response: makeToolText(
        `Mission ${missionId} is not owned by debug run ${debugRun.id}. Pass allowNonDebugMission=true only for explicit cross-checks.`,
        true,
      ),
    };
  }

  return { ok: true, record, isDebugMission };
}

function auditTool(debugRunId, toolName, sessionId, payload = {}) {
  writeDebugEvent(debugRunId, 'debug_tool_called', {
    toolName,
    sessionId: sessionId ?? null,
    ...payload,
  });
}

function normalizeCli(templateName, cliId) {
  const raw = typeof cliId === 'string' && cliId.trim() ? cliId.trim().toLowerCase() : CLI_BY_TEMPLATE[templateName];
  return ['claude', 'codex', 'gemini', 'opencode'].includes(raw) ? raw : CLI_BY_TEMPLATE[templateName];
}

function buildAgentNode({ id, roleId, cli, model, yolo, terminalId, title }) {
  return {
    id,
    roleId,
    instructionOverride: 'Debug workflow node. Complete the assigned smoke task and report status through MCP.',
    terminal: {
      terminalId,
      terminalTitle: title,
      cli,
      model: model || undefined,
      yolo: Boolean(yolo),
      executionMode: 'interactive_pty',
      paneId: `pane-${terminalId}`,
      reusedExisting: false,
    },
  };
}

export function buildMissionTemplate({ debugRun, templateName, cliId, model, yolo }) {
  const suffix = randomUUID().slice(0, 8);
  const missionId = `debug-mission-${suffix}`;
  const graphId = `debug-graph-${templateName}-${suffix}`;
  const cli = normalizeCli(templateName, cliId);
  const taskNodeId = 'debug-task';

  const primaryNode = buildAgentNode({
    id: 'debug-agent-a',
    roleId: templateName === 'mcp_handshake_smoke' ? 'mcp-smoke' : 'debug-agent',
    cli,
    model,
    yolo,
    terminalId: `debug-term-${suffix}-a`,
    title: `Debug ${cli} A`,
  });

  const nodes = [primaryNode];
  const edges = [];
  let startNodeIds = [primaryNode.id];
  let executionLayers = [[primaryNode.id]];

  if (templateName === 'input_agent_output' || templateName === 'input_agent_agent_output') {
    const secondNode = buildAgentNode({
      id: templateName === 'input_agent_agent_output' ? 'debug-agent-b' : 'debug-output-agent',
      roleId: templateName === 'input_agent_agent_output' ? 'debug-agent' : 'debug-output',
      cli,
      model,
      yolo,
      terminalId: `debug-term-${suffix}-b`,
      title: `Debug ${cli} B`,
    });
    nodes.push(secondNode);
    edges.push({
      id: `edge:${primaryNode.id}:always:${secondNode.id}`,
      fromNodeId: primaryNode.id,
      toNodeId: secondNode.id,
      condition: 'always',
    });
    executionLayers = [[primaryNode.id], [secondNode.id]];

    if (templateName === 'input_agent_agent_output') {
      const outputNode = buildAgentNode({
        id: 'debug-output-agent',
        roleId: 'debug-output',
        cli,
        model,
        yolo,
        terminalId: `debug-term-${suffix}-out`,
        title: `Debug ${cli} Output`,
      });
      nodes.push(outputNode);
      edges.push({
        id: `edge:${secondNode.id}:always:${outputNode.id}`,
        fromNodeId: secondNode.id,
        toNodeId: outputNode.id,
        condition: 'always',
      });
      executionLayers = [[primaryNode.id], [secondNode.id], [outputNode.id]];
    }
  }

  if (templateName === 'same_workflow_twice' || templateName === 'change_model_and_rerun') {
    nodes[0] = {
      ...primaryNode,
      instructionOverride: `${primaryNode.instructionOverride} This template is intended to be run repeatedly for cleanup checks.`,
    };
  }

  const mission = {
    missionId,
    graphId,
    task: {
      nodeId: taskNodeId,
      prompt: `Debug template ${templateName}: verify Terminal Docks workflow lifecycle without touching user missions.`,
      mode: 'build',
      workspaceDir: process.cwd(),
    },
    metadata: {
      compiledAt: Date.now(),
      sourceGraphId: graphId,
      startNodeIds,
      executionLayers,
      authoringMode: 'graph',
      presetId: `debug:${templateName}`,
      runVersion: 1,
      debug: true,
      debugRunId: debugRun.id,
      suiteName: debugRun.suiteName,
      templateName,
    },
    nodes,
    edges,
  };

  return {
    mission,
    nodeIds: nodes.map(node => node.id),
    terminalIds: nodes.map(node => node.terminal.terminalId),
  };
}

export function seedDebugMission(mission) {
  db.prepare(
    `INSERT INTO compiled_missions (mission_id, graph_id, mission_json, status, created_at, updated_at)
     VALUES (?, ?, ?, 'created', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(mission_id) DO UPDATE SET
       graph_id = excluded.graph_id,
       mission_json = excluded.mission_json,
       status = 'created',
       updated_at = CURRENT_TIMESTAMP`
  ).run(mission.missionId, mission.graphId, JSON.stringify(mission));

  for (const node of mission.nodes) {
    db.prepare(
      `INSERT INTO mission_node_runtime
         (mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome, last_payload, updated_at)
       VALUES (?, ?, ?, 'idle', 0, ?, NULL, NULL, CURRENT_TIMESTAMP)
       ON CONFLICT(mission_id, node_id) DO UPDATE SET
         role_id = excluded.role_id,
         status = 'idle',
         attempt = 0,
         current_wave_id = excluded.current_wave_id,
         last_outcome = NULL,
         last_payload = NULL,
         updated_at = CURRENT_TIMESTAMP`
    ).run(mission.missionId, node.id, node.roleId, `debug:${mission.metadata.debugRunId}`);

    appendWorkflowEvent({
      missionId: mission.missionId,
      nodeId: node.id,
      terminalId: node.terminal.terminalId,
      type: 'debug_node_created',
      message: `Debug node ${node.id} prepared for ${node.terminal.cli}.`,
      payload: {
        debug: true,
        debugRunId: mission.metadata.debugRunId,
        templateName: mission.metadata.templateName,
        cli: node.terminal.cli,
      },
    });
  }

  appendWorkflowEvent({
    missionId: mission.missionId,
    type: 'debug_workflow_created',
    message: `Debug workflow ${mission.metadata.templateName} created.`,
    payload: {
      debug: true,
      debugRunId: mission.metadata.debugRunId,
      suiteName: mission.metadata.suiteName,
      nodeIds: mission.nodes.map(node => node.id),
    },
  });
}

function nodeRuntime(missionId, nodeId) {
  return db.prepare(
    `SELECT mission_id, node_id, role_id, status, attempt, last_outcome, last_payload,
            datetime(updated_at, 'localtime') AS updated_at
       FROM mission_node_runtime
      WHERE mission_id = ? AND node_id = ?`
  ).get(missionId, nodeId) ?? null;
}

function latestEvent({ missionId, type, nodeId, terminalId, contains }) {
  const rows = db.prepare(
    `SELECT id, mission_id, node_id, session_id, terminal_id, type, severity, message, payload_json,
            datetime(created_at, 'localtime') AS created_at
       FROM workflow_events
      WHERE mission_id = ?
      ORDER BY id DESC
      LIMIT 500`
  ).all(missionId);

  return rows.find(row => {
    if (type && row.type !== type) return false;
    if (nodeId && row.node_id !== nodeId) return false;
    if (terminalId && row.terminal_id !== terminalId) return false;
    if (contains) {
      const haystack = `${row.message ?? ''}\n${row.payload_json ?? ''}`;
      if (!haystack.includes(contains)) return false;
    }
    return true;
  }) ?? null;
}

function mapEvent(row) {
  if (!row) return null;
  return {
    id: row.id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    sessionId: row.session_id,
    terminalId: row.terminal_id,
    type: row.type,
    severity: row.severity,
    message: row.message,
    payload: parseJsonSafe(row.payload_json, null),
    createdAt: row.created_at,
  };
}

export function runNodeRecord({ mission, nodeId, status = 'queued' }) {
  const node = mission.nodes.find(candidate => candidate.id === nodeId);
  if (!node) return { ok: false, message: `Node ${nodeId} not found in mission ${mission.missionId}.` };

  const current = nodeRuntime(mission.missionId, nodeId);
  const nextAttempt = Math.max(1, (current?.attempt ?? 0) + 1);
  db.prepare(
    `UPDATE mission_node_runtime
        SET status = ?,
            attempt = ?,
            current_wave_id = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE mission_id = ? AND node_id = ?`
  ).run(status, nextAttempt, `debug:${mission.metadata.debugRunId}:attempt:${nextAttempt}`, mission.missionId, nodeId);

  appendWorkflowEvent({
    missionId: mission.missionId,
    nodeId,
    terminalId: node.terminal.terminalId,
    type: 'debug_node_queued',
    message: `Debug node ${nodeId} queued for ${node.terminal.cli} attempt ${nextAttempt}.`,
    payload: {
      debug: true,
      debugRunId: mission.metadata.debugRunId,
      attempt: nextAttempt,
      cli: node.terminal.cli,
      model: node.terminal.model ?? null,
      yolo: Boolean(node.terminal.yolo),
    },
  });

  return { ok: true, node, attempt: nextAttempt, status };
}

export function registerDebugWorkflowTools(server, getSessionId) {
  server.registerTool('debug_create_test_workflow', {
    title: 'Debug Create Test Workflow',
    inputSchema: {
      debugRunId: z.string().min(1),
      templateName: z.enum(TEMPLATE_NAMES),
      cliId: z.string().optional(),
      model: z.string().optional(),
      yolo: z.boolean().optional(),
    },
  }, async ({ debugRunId, templateName, cliId, model, yolo = false }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;

    const { mission, nodeIds, terminalIds } = buildMissionTemplate({
      debugRun: checked.debugRun,
      templateName,
      cliId,
      model,
      yolo,
    });
    seedDebugMission(mission);
    addDebugRunMission(debugRunId, mission.missionId);
    updateDebugRunStatus(debugRunId, 'running');

    auditTool(debugRunId, 'debug_create_test_workflow', getSessionId?.(), { templateName, missionId: mission.missionId });
    writeDebugEvent(debugRunId, 'debug_workflow_created', {
      missionId: mission.missionId,
      templateName,
      nodeIds,
      terminalIds,
    });

    return jsonResponse({
      missionId: mission.missionId,
      workflowId: mission.graphId,
      nodeIds,
      terminalIds,
    });
  });

  server.registerTool('debug_run_workflow', {
    title: 'Debug Run Workflow',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
      allowNonDebugMission: z.boolean().optional(),
    },
  }, async ({ debugRunId, missionId, timeoutMs = DEFAULT_TIMEOUT_MS, allowNonDebugMission = false }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const missionCheck = requireDebugMission(checked.debugRun, missionId, allowNonDebugMission);
    if (!missionCheck.ok) return missionCheck.response;

    const { mission } = missionCheck.record;
    db.prepare(`UPDATE compiled_missions SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE mission_id = ?`).run(missionId);
    updateDebugRunStatus(debugRunId, 'running');

    appendWorkflowEvent({
      missionId,
      type: 'debug_workflow_run_requested',
      message: `Debug workflow run requested for ${missionId}.`,
      payload: {
        debug: true,
        debugRunId,
        timeoutMs: boundedTimeout(timeoutMs),
        startNodeIds: mission.metadata?.startNodeIds ?? [],
      },
    });

    for (const nodeId of mission.metadata?.startNodeIds ?? []) {
      runNodeRecord({ mission, nodeId, status: 'queued' });
    }

    broadcast('DebugMCP', JSON.stringify({ debugRunId, missionId }), 'debug_workflow_run_requested');
    auditTool(debugRunId, 'debug_run_workflow', getSessionId?.(), { missionId });
    writeDebugEvent(debugRunId, 'debug_test_started', { missionId, templateName: mission.metadata?.templateName ?? null });

    return jsonResponse({
      missionId,
      status: 'running',
      startedAt: new Date().toISOString(),
    });
  });

  server.registerTool('debug_run_node', {
    title: 'Debug Run Node',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      nodeId: z.string().min(1),
      allowNonDebugMission: z.boolean().optional(),
    },
  }, async ({ debugRunId, missionId, nodeId, allowNonDebugMission = false }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const missionCheck = requireDebugMission(checked.debugRun, missionId, allowNonDebugMission);
    if (!missionCheck.ok) return missionCheck.response;

    const result = runNodeRecord({ mission: missionCheck.record.mission, nodeId, status: 'queued' });
    if (!result.ok) return makeToolText(result.message, true);

    auditTool(debugRunId, 'debug_run_node', getSessionId?.(), { missionId, nodeId });
    return jsonResponse({
      missionId,
      nodeId,
      status: result.status,
      attempt: result.attempt,
      terminalId: result.node.terminal.terminalId,
    });
  });

  server.registerTool('debug_wait_for_status', {
    title: 'Debug Wait For Status',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      nodeId: z.string().min(1),
      status: z.string().min(1),
      timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
      allowNonDebugMission: z.boolean().optional(),
    },
  }, async ({ debugRunId, missionId, nodeId, status, timeoutMs = DEFAULT_TIMEOUT_MS, allowNonDebugMission = false }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const missionCheck = requireDebugMission(checked.debugRun, missionId, allowNonDebugMission);
    if (!missionCheck.ok) return missionCheck.response;

    const deadline = Date.now() + boundedTimeout(timeoutMs);
    let current = nodeRuntime(missionId, nodeId);
    while (Date.now() < deadline && current?.status !== status) {
      await sleep(POLL_MS);
      current = nodeRuntime(missionId, nodeId);
    }

    auditTool(debugRunId, 'debug_wait_for_status', getSessionId?.(), { missionId, nodeId, status });
    return jsonResponse({
      matched: current?.status === status,
      missionId,
      nodeId,
      expectedStatus: status,
      currentStatus: current?.status ?? null,
      runtime: current,
    });
  });

  server.registerTool('debug_wait_for_event', {
    title: 'Debug Wait For Event',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      eventType: z.string().min(1),
      nodeId: z.string().optional(),
      timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
      allowNonDebugMission: z.boolean().optional(),
    },
  }, async ({ debugRunId, missionId, eventType, nodeId, timeoutMs = DEFAULT_TIMEOUT_MS, allowNonDebugMission = false }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const missionCheck = requireDebugMission(checked.debugRun, missionId, allowNonDebugMission);
    if (!missionCheck.ok) return missionCheck.response;

    const deadline = Date.now() + boundedTimeout(timeoutMs);
    let event = latestEvent({ missionId, type: eventType, nodeId });
    while (Date.now() < deadline && !event) {
      await sleep(POLL_MS);
      event = latestEvent({ missionId, type: eventType, nodeId });
    }

    auditTool(debugRunId, 'debug_wait_for_event', getSessionId?.(), { missionId, eventType, nodeId: nodeId ?? null });
    return jsonResponse({
      matched: Boolean(event),
      missionId,
      eventType,
      event: mapEvent(event),
    });
  });

  server.registerTool('debug_wait_for_terminal_contains', {
    title: 'Debug Wait For Terminal Contains',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      terminalId: z.string().min(1),
      text: z.string().min(1),
      timeoutMs: z.number().int().positive().max(MAX_TIMEOUT_MS).optional(),
      allowNonDebugMission: z.boolean().optional(),
    },
  }, async ({ debugRunId, missionId, terminalId, text, timeoutMs = DEFAULT_TIMEOUT_MS, allowNonDebugMission = false }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const missionCheck = requireDebugMission(checked.debugRun, missionId, allowNonDebugMission);
    if (!missionCheck.ok) return missionCheck.response;

    const deadline = Date.now() + boundedTimeout(timeoutMs);
    let event = latestEvent({ missionId, terminalId, contains: text });
    while (Date.now() < deadline && !event) {
      await sleep(POLL_MS);
      event = latestEvent({ missionId, terminalId, contains: text });
    }

    auditTool(debugRunId, 'debug_wait_for_terminal_contains', getSessionId?.(), { missionId, terminalId, text });
    return jsonResponse({
      matched: Boolean(event),
      missionId,
      terminalId,
      text,
      event: mapEvent(event),
    });
  });

  server.registerTool('debug_reset_test_state', {
    title: 'Debug Reset Test State',
    inputSchema: {
      debugRunId: z.string().min(1),
    },
  }, async ({ debugRunId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;

    const missionIds = checked.debugRun.missionIds;
    const deleteMission = db.transaction((ids) => {
      for (const missionId of ids) {
        const missionCheck = requireDebugMission(checked.debugRun, missionId, false);
        if (!missionCheck.ok) continue;
        db.prepare(`DELETE FROM task_pushes WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM agent_runtime_sessions WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM adapter_registrations WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM mission_node_runtime WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM mission_timeline WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM workflow_events WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM session_log WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM artifacts WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM tasks WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM task_inbox WHERE mission_id = ?`).run(missionId);
        db.prepare(`DELETE FROM compiled_missions WHERE mission_id = ?`).run(missionId);
      }
    });
    deleteMission(missionIds);
    clearDebugRunMissions(debugRunId);

    auditTool(debugRunId, 'debug_reset_test_state', getSessionId?.(), { missionIds });
    writeDebugEvent(debugRunId, 'debug_test_state_reset', { missionIds });
    return jsonResponse({ reset: true, missionIds });
  });
}
