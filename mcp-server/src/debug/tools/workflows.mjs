import { randomUUID } from 'crypto';
import { existsSync, readdirSync, statSync } from 'fs';
import { extname, isAbsolute, relative, resolve } from 'path';
import { z } from 'zod';
import { db } from '../../db/index.mjs';
import { broadcast, emitAgentEvent, sessions } from '../../state.mjs';
import { appendWorkflowEvent, makeToolText, parseJsonSafe } from '../../utils/index.mjs';
import { loadCompiledMissionRecord } from '../../utils/workflow.mjs';
import { addDebugRunMission, clearDebugRunMissions, createDebugTestResult, getDebugRun, updateDebugRunStatus } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';
import { REPO_ROOT } from './shared.mjs';

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

const CUSTOM_AGENT_SCHEMA = z.object({
  id: z.string().min(1),
  roleId: z.string().min(1),
  title: z.string().optional(),
  instruction: z.string().optional(),
  model: z.string().optional(),
  yolo: z.boolean().optional(),
  terminalId: z.string().optional(),
});

const CUSTOM_EDGE_SCHEMA = z.object({
  fromNodeId: z.string().min(1),
  toNodeId: z.string().min(1),
  condition: z.enum(['always', 'on_success', 'on_failure']).optional(),
});

const OUTPUT_CONTRACT_SCHEMA = z.object({
  outputPath: z.string().optional(),
  outputType: z.string().optional(),
  expectedFiles: z.array(z.string().min(1)).optional(),
  mustBeRunnable: z.boolean().optional(),
  disallowMarkdownOnly: z.boolean().optional(),
  runCommand: z.string().optional(),
  openFile: z.string().optional(),
  openUrl: z.string().optional(),
});

function uniqueValues(values) {
  return new Set(values).size === values.length;
}

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

function inferStartNodeIds(nodes, edges) {
  const incoming = new Set(edges.map(edge => edge.toNodeId));
  return nodes.map(node => node.id).filter(nodeId => !incoming.has(nodeId));
}

function inferExecutionLayers(nodes, edges, startNodeIds) {
  const nodeIds = new Set(nodes.map(node => node.id));
  const remaining = new Set(nodeIds);
  const completed = new Set();
  const layers = [];
  let currentLayer = startNodeIds.filter(nodeId => remaining.has(nodeId));

  while (currentLayer.length > 0) {
    layers.push(currentLayer);
    for (const nodeId of currentLayer) {
      remaining.delete(nodeId);
      completed.add(nodeId);
    }

    currentLayer = [...remaining].filter(nodeId => {
      const incoming = edges.filter(edge => edge.toNodeId === nodeId);
      return incoming.length > 0 && incoming.every(edge => completed.has(edge.fromNodeId));
    });
  }

  if (remaining.size > 0) {
    layers.push([...remaining]);
  }

  return layers;
}

function validateCustomWorkflow({ agents, edges, startNodeIds, executionLayers }) {
  const agentIds = agents.map(agent => agent.id);
  if (!uniqueValues(agentIds)) return 'Custom workflow agent IDs must be unique.';

  const nodeIdSet = new Set(agentIds);
  for (const edge of edges) {
    if (!nodeIdSet.has(edge.fromNodeId)) return `Edge source node does not exist: ${edge.fromNodeId}`;
    if (!nodeIdSet.has(edge.toNodeId)) return `Edge target node does not exist: ${edge.toNodeId}`;
  }

  if (startNodeIds && startNodeIds.some(nodeId => !nodeIdSet.has(nodeId))) {
    return 'startNodeIds contains a node that does not exist.';
  }

  if (executionLayers) {
    const flattened = executionLayers.flat();
    if (flattened.some(nodeId => !nodeIdSet.has(nodeId))) {
      return 'executionLayers contains a node that does not exist.';
    }
  }

  return null;
}

function buildCustomMissionTemplate({
  debugRun,
  workflowName,
  taskPrompt,
  agents,
  edges,
  startNodeIds,
  executionLayers,
  workspaceDir,
  outputContract,
}) {
  const suffix = randomUUID().slice(0, 8);
  const safeName = workflowName.replace(/[^a-zA-Z0-9_-]+/g, '-').slice(0, 48) || 'custom';
  const missionId = `debug-mission-${suffix}`;
  const graphId = `debug-graph-custom-${safeName}-${suffix}`;
  const normalizedEdges = edges.map((edge, index) => ({
    id: `edge:${edge.fromNodeId}:${edge.condition ?? 'always'}:${edge.toNodeId}:${index}`,
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    condition: edge.condition ?? 'always',
  }));

  const nodes = agents.map((agent, index) => {
    const node = buildAgentNode({
      id: agent.id,
      roleId: agent.roleId,
      cli: 'codex',
      model: agent.model,
      yolo: agent.yolo,
      terminalId: agent.terminalId || `debug-term-${suffix}-${index + 1}`,
      title: agent.title || `Debug Codex ${agent.roleId}`,
    });
    if (typeof agent.instruction === 'string' && agent.instruction.trim()) {
      node.instructionOverride = agent.instruction.trim();
    }
    return node;
  });

  const resolvedStartNodeIds = startNodeIds?.length ? startNodeIds : inferStartNodeIds(nodes, normalizedEdges);
  const resolvedExecutionLayers = executionLayers?.length
    ? executionLayers
    : inferExecutionLayers(nodes, normalizedEdges, resolvedStartNodeIds);

  const mission = {
    missionId,
    graphId,
    task: {
      nodeId: 'debug-task',
      prompt: taskPrompt || `Debug custom workflow ${workflowName}: verify Codex-only routing and MCP handoffs.`,
      mode: 'build',
      workspaceDir: workspaceDir || process.cwd(),
    },
    metadata: {
      compiledAt: Date.now(),
      sourceGraphId: graphId,
      startNodeIds: resolvedStartNodeIds,
      executionLayers: resolvedExecutionLayers,
      authoringMode: 'graph',
      presetId: `debug:custom:${safeName}`,
      runVersion: 1,
      debug: true,
      debugRunId: debugRun.id,
      suiteName: debugRun.suiteName,
      templateName: `custom:${workflowName}`,
      customWorkflow: true,
      codexOnly: true,
      runnerMode: 'handler_harness',
      outputContract: outputContract ?? null,
    },
    nodes,
    edges: normalizedEdges,
  };

  return {
    mission,
    nodeIds: nodes.map(node => node.id),
    terminalIds: nodes.map(node => node.terminal.terminalId),
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
      runnerMode: 'handler_harness',
      outputContract: null,
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

const DOC_ONLY_EXTENSIONS = new Set(['.md', '.markdown', '.txt', '.json', '.log']);

function isSubpath(parent, child) {
  const rel = relative(parent, child);
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}

function resolveOutputPath(outputPath) {
  const resolved = isAbsolute(outputPath) ? resolve(outputPath) : resolve(REPO_ROOT, outputPath);
  const docksTestingRoot = resolve(REPO_ROOT, 'docks-testing');
  if (!isSubpath(docksTestingRoot, resolved)) {
    return {
      error: `Concrete workflow output must live under docks-testing/. Received: ${outputPath}`,
      resolved,
    };
  }
  return { resolved };
}

function collectFiles(root) {
  if (!existsSync(root)) return [];
  const entries = [];
  const visit = (dir) => {
    for (const item of readdirSync(dir, { withFileTypes: true })) {
      const full = resolve(dir, item.name);
      if (item.isDirectory()) visit(full);
      else if (item.isFile()) entries.push(full);
    }
  };
  visit(root);
  return entries;
}

function isNonEmptyFile(path) {
  try {
    return statSync(path).isFile() && statSync(path).size > 0;
  } catch {
    return false;
  }
}

function validateConcreteOutput({
  outputPath,
  expectedFiles = [],
  mustBeRunnable = true,
  disallowMarkdownOnly = true,
  runCommand,
  openFile,
  openUrl,
}) {
  const resolvedPath = resolveOutputPath(outputPath);
  if (resolvedPath.error) {
    return {
      ok: false,
      outputPath,
      resolvedPath: resolvedPath.resolved,
      existingFiles: [],
      missingFiles: expectedFiles,
      allFiles: [],
      runnableEvidence: null,
      notes: [resolvedPath.error],
    };
  }

  const root = resolvedPath.resolved;
  const notes = [];
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    notes.push(`Output path does not exist or is not a directory: ${outputPath}`);
  }

  const existingFiles = [];
  const missingFiles = [];
  for (const file of expectedFiles) {
    const full = resolve(root, file);
    if (isSubpath(root, full) && isNonEmptyFile(full)) existingFiles.push(file);
    else missingFiles.push(file);
  }
  if (missingFiles.length) notes.push(`Missing or empty expected files: ${missingFiles.join(', ')}`);

  const allFiles = collectFiles(root);
  const repoFiles = allFiles.map(file => relative(REPO_ROOT, file).replaceAll('\\', '/'));
  const hasNonDocFile = allFiles.some(file => !DOC_ONLY_EXTENSIONS.has(extname(file).toLowerCase()));
  if (disallowMarkdownOnly && allFiles.length > 0 && !hasNonDocFile) {
    notes.push('Output is documentation-only; runnable/openable project output requires at least one non-document source or asset file.');
  }

  const openFilePath = openFile ? resolve(root, openFile) : null;
  const openFileExists = openFilePath ? isSubpath(root, openFilePath) && isNonEmptyFile(openFilePath) : false;
  const runnableEvidence = {
    runCommand: runCommand || null,
    openFile: openFile || null,
    openFileExists,
    openUrl: openUrl || null,
    inferredOpenableHtml: expectedFiles.some(file => file.toLowerCase().endsWith('.html') && isNonEmptyFile(resolve(root, file))),
    inferredPythonEntry: expectedFiles.some(file => file.toLowerCase().endsWith('.py') && isNonEmptyFile(resolve(root, file))),
    inferredPackageEntry: expectedFiles.some(file => file.toLowerCase() === 'package.json' && isNonEmptyFile(resolve(root, file))),
  };
  const hasRunnableEvidence = Boolean(
    runnableEvidence.runCommand ||
    runnableEvidence.openUrl ||
    runnableEvidence.openFileExists ||
    runnableEvidence.inferredOpenableHtml ||
    runnableEvidence.inferredPythonEntry ||
    runnableEvidence.inferredPackageEntry
  );
  if (mustBeRunnable && !hasRunnableEvidence) {
    notes.push('No runnable/openable evidence found. Provide a runCommand, openUrl, openFile, index.html, Python entry point, or package.json.');
  }

  return {
    ok: notes.length === 0,
    outputPath,
    resolvedPath: root,
    existingFiles,
    missingFiles,
    allFiles: repoFiles,
    runnableEvidence,
    notes: notes.length ? notes : ['Concrete output validation passed.'],
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

  server.registerTool('debug_create_custom_workflow', {
    title: 'Debug Create Custom Workflow',
    inputSchema: {
      debugRunId: z.string().min(1),
      workflowName: z.string().min(1),
      taskPrompt: z.string().optional(),
      agents: z.array(CUSTOM_AGENT_SCHEMA).min(1).max(32),
      edges: z.array(CUSTOM_EDGE_SCHEMA).max(128).optional(),
      startNodeIds: z.array(z.string().min(1)).optional(),
      executionLayers: z.array(z.array(z.string().min(1)).min(1)).optional(),
      workspaceDir: z.string().optional(),
      outputContract: OUTPUT_CONTRACT_SCHEMA.optional(),
    },
  }, async ({ debugRunId, workflowName, taskPrompt, agents, edges = [], startNodeIds, executionLayers, workspaceDir, outputContract }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;

    const validationError = validateCustomWorkflow({ agents, edges, startNodeIds, executionLayers });
    if (validationError) return makeToolText(validationError, true);

    const { mission, nodeIds, terminalIds } = buildCustomMissionTemplate({
      debugRun: checked.debugRun,
      workflowName,
      taskPrompt,
      agents,
      edges,
      startNodeIds,
      executionLayers,
      workspaceDir,
      outputContract,
    });
    seedDebugMission(mission);
    addDebugRunMission(debugRunId, mission.missionId);
    updateDebugRunStatus(debugRunId, 'running');

    auditTool(debugRunId, 'debug_create_custom_workflow', getSessionId?.(), {
      workflowName,
      missionId: mission.missionId,
      nodeCount: nodeIds.length,
      edgeCount: mission.edges.length,
    });
    writeDebugEvent(debugRunId, 'debug_custom_workflow_created', {
      missionId: mission.missionId,
      workflowName,
      nodeIds,
      terminalIds,
      edgeCount: mission.edges.length,
      outputContract: outputContract ?? null,
    });

    return jsonResponse({
      missionId: mission.missionId,
      workflowId: mission.graphId,
      nodeIds,
      terminalIds,
      startNodeIds: mission.metadata.startNodeIds,
      executionLayers: mission.metadata.executionLayers,
      runnerMode: mission.metadata.runnerMode,
      outputContract: mission.metadata.outputContract,
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
    db.prepare(
      `UPDATE mission_node_runtime
          SET status = 'idle',
              last_outcome = NULL,
              last_payload = NULL,
              updated_at = CURRENT_TIMESTAMP
        WHERE mission_id = ?`
    ).run(missionId);
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

    appendWorkflowEvent({
      missionId,
      type: 'debug_workflow_state_reset',
      message: `Debug workflow state reset before run for ${missionId}.`,
      payload: {
        debug: true,
        debugRunId,
        nodeIds: mission.nodes.map(node => node.id),
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
      runnerMode: mission.metadata?.runnerMode ?? 'handler_harness',
      simulationWarning: 'debug_run_workflow queues handler-level debug nodes only. It does not launch the live app UI, NodeTree, RuntimeManager, or PTY-backed CLI sessions.',
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

  server.registerTool('debug_activate_node', {
    title: 'Debug Activate Node',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      nodeId: z.string().min(1),
      sessionId: z.string().optional(),
      allowNonDebugMission: z.boolean().optional(),
    },
  }, async ({ debugRunId, missionId, nodeId, sessionId, allowNonDebugMission = false }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const missionCheck = requireDebugMission(checked.debugRun, missionId, allowNonDebugMission);
    if (!missionCheck.ok) return missionCheck.response;

    const node = missionCheck.record.mission.nodes.find(candidate => candidate.id === nodeId);
    if (!node) return makeToolText(`Node ${nodeId} not found in mission ${missionId}.`, true);

    const runtime = nodeRuntime(missionId, nodeId);
    if (!runtime || runtime.attempt < 1) {
      return makeToolText(`Node ${nodeId} must be queued with debug_run_node or debug_run_workflow before activation.`, true);
    }

    const sid = sessionId || `debug-session:${missionId}:${nodeId}:${runtime.attempt}`;
    const agentId = `debug-agent:${missionId}:${nodeId}`;
    db.prepare(
      `INSERT INTO agent_runtime_sessions
         (session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, run_id, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, 'running', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(session_id) DO UPDATE SET
         agent_id = excluded.agent_id,
         mission_id = excluded.mission_id,
         node_id = excluded.node_id,
         attempt = excluded.attempt,
         terminal_id = excluded.terminal_id,
         status = 'running',
         run_id = excluded.run_id,
         updated_at = CURRENT_TIMESTAMP`
    ).run(sid, agentId, missionId, nodeId, runtime.attempt, node.terminal?.terminalId ?? '', `debug:${debugRunId}`);

    db.prepare(
      `UPDATE mission_node_runtime
          SET status = 'running',
              updated_at = CURRENT_TIMESTAMP
        WHERE mission_id = ? AND node_id = ?`
    ).run(missionId, nodeId);

    db.prepare(
      `INSERT INTO task_pushes (session_id, mission_id, node_id, task_seq, attempt, pushed_at, acked_at)
       VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
       ON CONFLICT(session_id, mission_id, node_id, task_seq) DO UPDATE SET
         attempt = excluded.attempt,
         acked_at = CURRENT_TIMESTAMP`
    ).run(sid, missionId, nodeId, runtime.attempt, runtime.attempt);

    sessions[sid] = {
      ...(sessions[sid] ?? {}),
      runtimeSessionId: sid,
      missionId,
      nodeId,
      attempt: runtime.attempt,
      role: node.roleId,
      profileId: node.roleId,
      agentId,
      terminalId: node.terminal?.terminalId ?? null,
      cli: node.terminal?.cli ?? null,
      executionMode: node.terminal?.executionMode ?? null,
      status: 'running',
      connectedAt: sessions[sid]?.connectedAt ?? Date.now(),
      updatedAt: Date.now(),
    };

    appendWorkflowEvent({
      missionId,
      nodeId,
      sessionId: sid,
      terminalId: node.terminal?.terminalId,
      type: 'debug_node_activated',
      message: `Debug node ${nodeId} activated as ${node.terminal?.cli ?? 'unknown'} attempt ${runtime.attempt}.`,
      payload: {
        debug: true,
        debugRunId,
        attempt: runtime.attempt,
        cli: node.terminal?.cli ?? null,
      },
    });

    emitAgentEvent({
      type: 'agent:ready',
      sessionId: sid,
      missionId,
      nodeId,
      attempt: runtime.attempt,
      role: node.roleId,
      agentId,
      at: Date.now(),
    });
    emitAgentEvent({
      type: 'task:pushed',
      sessionId: sid,
      missionId,
      nodeId,
      attempt: runtime.attempt,
      taskSeq: runtime.attempt,
      at: Date.now(),
    });
    emitAgentEvent({
      type: 'activation:acked',
      sessionId: sid,
      missionId,
      nodeId,
      attempt: runtime.attempt,
      taskSeq: runtime.attempt,
      at: Date.now(),
    });

    auditTool(debugRunId, 'debug_activate_node', getSessionId?.(), { missionId, nodeId, sessionId: sid });
    return jsonResponse({
      missionId,
      nodeId,
      status: 'running',
      attempt: runtime.attempt,
      sessionId: sid,
      terminalId: node.terminal?.terminalId ?? null,
      cli: node.terminal?.cli ?? null,
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

  server.registerTool('debug_validate_concrete_output', {
    title: 'Debug Validate Concrete Output',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().optional(),
      outputPath: z.string().min(1),
      expectedFiles: z.array(z.string().min(1)).optional(),
      outputType: z.string().optional(),
      mustBeRunnable: z.boolean().optional(),
      disallowMarkdownOnly: z.boolean().optional(),
      runCommand: z.string().optional(),
      openFile: z.string().optional(),
      openUrl: z.string().optional(),
    },
  }, async ({
    debugRunId,
    missionId,
    outputPath,
    expectedFiles = [],
    outputType,
    mustBeRunnable = true,
    disallowMarkdownOnly = true,
    runCommand,
    openFile,
    openUrl,
  }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;

    const validation = validateConcreteOutput({
      outputPath,
      expectedFiles,
      mustBeRunnable,
      disallowMarkdownOnly,
      runCommand,
      openFile,
      openUrl,
    });

    if (missionId) {
      appendWorkflowEvent({
        missionId,
        type: validation.ok ? 'debug_concrete_output_validated' : 'debug_concrete_output_invalid',
        severity: validation.ok ? 'info' : 'warning',
        message: validation.ok
          ? `Concrete output validated at ${outputPath}.`
          : `Concrete output validation failed at ${outputPath}.`,
        payload: {
          debug: true,
          debugRunId,
          outputType: outputType ?? null,
          validation,
        },
      });
    }

    createDebugTestResult({
      debugRunId,
      suiteName: checked.debugRun.suiteName,
      testName: `concrete_output:${outputPath}`,
      status: validation.ok ? 'passed' : 'failed',
      failureCategory: validation.ok ? null : 'concrete_output_validation',
      notes: validation.notes.join(' '),
      evidence: {
        missionId: missionId ?? null,
        outputType: outputType ?? null,
        validation,
      },
    });

    auditTool(debugRunId, 'debug_validate_concrete_output', getSessionId?.(), {
      missionId: missionId ?? null,
      outputPath,
      ok: validation.ok,
    });

    return jsonResponse(validation);
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
