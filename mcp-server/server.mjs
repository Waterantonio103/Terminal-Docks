import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { EventEmitter } from 'node:events';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve } from 'path';
import { createMcpPersistence } from './persistence.mjs';
import { createMcpServiceStore } from './services.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── SQLite ──────────────────────────────────────────────────────────────────
// App mode shares the Rust-owned DB via MCP_DB_PATH and MCP_SCHEMA_OWNER=backend.
// Standalone tests/manual MCP runs use the compatibility bootstrap in persistence.mjs.
const { db, dbPath } = createMcpPersistence({ serverDir: __dirname });
const services = createMcpServiceStore(db);

// ── Helpers ──────────────────────────────────────────────────────────────────
function loadAgentRoster() {
  try {
    const p = resolve(__dirname, '../src/config/agents.json');
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { agents: [] };
  }
}

function logSession(sessionId, eventType, content) {
  try {
    services.logSession(sessionId, eventType, content);
  } catch {}
}

function parseJsonSafe(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

const WORKER_CAPABILITY_IDS = [
  'planning',
  'coding',
  'testing',
  'review',
  'security',
  'repo_analysis',
  'shell_execution',
];

const ROLE_CAPABILITY_PRESETS = {
  scout: [
    { id: 'repo_analysis', level: 3 },
    { id: 'planning', level: 2 },
    { id: 'shell_execution', level: 2 },
  ],
  coordinator: [
    { id: 'planning', level: 3 },
    { id: 'repo_analysis', level: 2 },
    { id: 'review', level: 2 },
  ],
  builder: [
    { id: 'coding', level: 3 },
    { id: 'shell_execution', level: 3 },
    { id: 'repo_analysis', level: 2 },
  ],
  tester: [
    { id: 'testing', level: 3 },
    { id: 'coding', level: 2 },
    { id: 'shell_execution', level: 2 },
  ],
  security: [
    { id: 'security', level: 3 },
    { id: 'review', level: 2 },
    { id: 'repo_analysis', level: 2 },
  ],
  reviewer: [
    { id: 'review', level: 3 },
    { id: 'testing', level: 2 },
    { id: 'security', level: 2 },
    { id: 'coding', level: 1 },
  ],
};

const normalizeCapabilityId = (value) => {
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return WORKER_CAPABILITY_IDS.includes(normalized) ? normalized : null;
};

function normalizeCapabilityEntry(entry) {
  if (typeof entry === 'string') {
    const id = normalizeCapabilityId(entry);
    return id ? { id, level: 2, verifiedBy: 'profile' } : null;
  }
  if (!entry || typeof entry !== 'object') return null;

  const id = normalizeCapabilityId(entry.id);
  if (!id) return null;
  const rawLevel = Number.isFinite(entry.level) ? Math.floor(Number(entry.level)) : 2;
  const level = Math.max(0, Math.min(3, rawLevel));
  const verifiedBy = entry.verifiedBy === 'runtime' ? 'runtime' : 'profile';
  return { id, level, verifiedBy };
}

function normalizeCapabilities(entries, fallback = []) {
  const byId = new Map();
  for (const entry of [...(Array.isArray(entries) ? entries : []), ...fallback]) {
    const normalized = normalizeCapabilityEntry(entry);
    if (!normalized) continue;
    const current = byId.get(normalized.id);
    if (!current || normalized.level > current.level) {
      byId.set(normalized.id, normalized);
    }
  }
  return Array.from(byId.values()).sort((left, right) => left.id.localeCompare(right.id));
}

function defaultCapabilitiesForRole(roleId) {
  return normalizeCapabilities(ROLE_CAPABILITY_PRESETS[roleId] ?? []);
}

function effectiveSessionCapabilities(session) {
  const explicit = normalizeCapabilities(session?.capabilities);
  if (explicit.length > 0) return explicit;
  return normalizeCapabilities(defaultCapabilitiesForRole(session?.role));
}

function summarizeSession(sessionId, session) {
  return {
    sessionId,
    role: session.role ?? null,
    profileId: session.profileId ?? session.role ?? null,
    agentId: session.agentId ?? null,
    terminalId: session.terminalId ?? null,
    cli: session.cli ?? null,
    status: session.status ?? 'idle',
    availability: session.availability ?? 'available',
    workingDir: session.workingDir ?? null,
    capabilities: effectiveSessionCapabilities(session),
    connectedAt: session.connectedAt ?? null,
    updatedAt: session.updatedAt ?? null,
  };
}

function sessionHasCapability(session, capabilityId) {
  const capabilities = effectiveSessionCapabilities(session);
  return capabilities.some(capability => capability.id === capabilityId);
}

function allowedOutcomesForCondition(condition) {
  if (condition === 'on_success') return ['success'];
  if (condition === 'on_failure') return ['failure'];
  return ['success', 'failure'];
}

function loadCompiledMissionRecord(missionId) {
  const row = services.loadCompiledMissionRecord(missionId);
  if (!row) return null;

  const mission = parseJsonSafe(row.mission_json);
  if (!mission) return null;

  return {
    missionId: row.mission_id,
    graphId: row.graph_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mission,
  };
}

function getMissionNode(mission, nodeId) {
  return mission?.nodes?.find(node => node.id === nodeId) ?? null;
}

function getMissionNodeRuntime(missionId, nodeId) {
  return services.getMissionNodeRuntime(missionId, nodeId);
}

function getRuntimeSessionByAttempt(missionId, nodeId, attempt) {
  return services.getRuntimeSessionByAttempt(missionId, nodeId, attempt);
}

function requireRuntimeSessionForAttempt(missionId, nodeId, attempt) {
  const row = getRuntimeSessionByAttempt(missionId, nodeId, attempt);
  if (!row) {
    return { error: `No runtime session registration found for ${missionId}/${nodeId} attempt ${attempt}.` };
  }
  return { row };
}

function getLegalOutgoingTargets(mission, fromNodeId) {
  const nodeById = new Map((mission?.nodes ?? []).map(node => [node.id, node]));

  return (mission?.edges ?? [])
    .filter(edge => edge.fromNodeId === fromNodeId)
    .map(edge => {
      const targetNode = nodeById.get(edge.toNodeId) ?? null;
      return {
        targetNodeId: edge.toNodeId,
        targetRoleId: targetNode?.roleId ?? null,
        condition: edge.condition,
        allowedOutcomes: allowedOutcomesForCondition(edge.condition),
      };
    });
}

function extractUpstreamContext(inboxMessages) {
  const findings = [];
  const summaries = [];
  const filesChanged = [];
  const artifactReferences = [];

  for (const msg of inboxMessages) {
    const parsed = msg.content_json ?? {};
    const completionStr = parsed.payload ?? parsed.completion;
    let completion = null;
    if (typeof completionStr === 'string') {
      try { completion = JSON.parse(completionStr); } catch { /* ignore */ }
    } else if (completionStr && typeof completionStr === 'object') {
      completion = completionStr;
    }
    if (!completion) continue;

    if (typeof completion.summary === 'string' && completion.summary.trim()) {
      summaries.push({ fromNodeId: parsed.fromNodeId ?? null, summary: completion.summary.trim() });
    }
    if (Array.isArray(completion.keyFindings)) {
      for (const f of completion.keyFindings) {
        if (typeof f === 'string' && f.trim()) findings.push(f.trim());
      }
    }
    if (Array.isArray(completion.filesChanged)) {
      for (const f of completion.filesChanged) {
        if (typeof f === 'string' && f.trim() && !filesChanged.includes(f.trim())) {
          filesChanged.push(f.trim());
        }
      }
    }
    if (Array.isArray(completion.artifactReferences)) {
      for (const a of completion.artifactReferences) {
        if (typeof a === 'string' && a.trim() && !artifactReferences.includes(a.trim())) {
          artifactReferences.push(a.trim());
        }
      }
    }
  }

  return { keyFindings: findings, summaries, filesChanged, artifactReferences };
}

export function buildTaskDetails(missionId, nodeId) {
  const record = loadCompiledMissionRecord(missionId);

  if (!record) {
    // Ad-hoc mission: no compiled graph. Return a minimal context from runtime tables.
    const runtime = getMissionNodeRuntime(missionId, nodeId);
    if (!runtime) return null;
    const runtimeSession = Number.isInteger(runtime.attempt) && runtime.attempt > 0
      ? getRuntimeSessionByAttempt(missionId, nodeId, runtime.attempt)
      : null;
    return {
      missionId,
      graphId: null,
      missionStatus: 'active',
      authoringMode: 'adhoc',
      presetId: null,
      runVersion: 1,
      objective: '',
      task: null,
      node: {
        id: nodeId,
        nodeId,
        roleId: runtime.role_id ?? 'agent',
        instructionOverride: '',
        status: runtime.status ?? 'running',
        attempt: runtime.attempt ?? 0,
        currentWaveId: null,
        lastOutcome: null,
        lastPayload: null,
        updatedAt: runtime.updated_at ?? null,
      },
      runtimeSession: runtimeSession ? {
        sessionId: runtimeSession.session_id,
        agentId: runtimeSession.agent_id,
        terminalId: runtimeSession.terminal_id,
        status: runtimeSession.status,
        createdAt: runtimeSession.created_at,
        updatedAt: runtimeSession.updated_at,
      } : null,
      legalNextTargets: [],
      latestTask: null,
      recentTasks: [],
      inbox: [],
      pendingPushes: [],
      upstreamContext: {},
    };
  }

  const node = getMissionNode(record.mission, nodeId);
  if (!node) return null;

  const runtime = getMissionNodeRuntime(missionId, nodeId);
  const runtimeSession =
    runtime && Number.isInteger(runtime.attempt) && runtime.attempt > 0
      ? getRuntimeSessionByAttempt(missionId, nodeId, runtime.attempt)
      : null;
  const recentTasks = services.listRecentTasksForNode({ missionId, nodeId }).map(task => ({
    ...task,
    payload_json: parseJsonSafe(task.payload),
  }));

  const inbox = services.listNodeInbox({ missionId, nodeId, limit: 20 }).map(message => ({
    ...message,
    content_json: parseJsonSafe(message.content),
  }));

  const pendingPushes = runtimeSession
    ? services.getPendingTaskPushes(runtimeSession.session_id)
        .filter(push => push.mission_id === missionId && push.node_id === nodeId)
    : [];

  const upstreamContext = extractUpstreamContext(inbox);

  return {
    missionId,
    graphId: record.graphId,
    missionStatus: record.status,
    authoringMode: record.mission.metadata?.authoringMode ?? null,
    presetId: record.mission.metadata?.presetId ?? null,
    runVersion: Number.isInteger(record.mission.metadata?.runVersion) ? record.mission.metadata.runVersion : 1,
    objective: record.mission.task?.prompt ?? '',
    task: record.mission.task ?? null,
    node: {
      id: node.id,
      nodeId: node.id,
      roleId: node.roleId,
      instructionOverride: node.instructionOverride ?? '',
      status: runtime?.status ?? 'idle',
      attempt: runtime?.attempt ?? 0,
      currentWaveId: runtime?.current_wave_id ?? null,
      lastOutcome: runtime?.last_outcome ?? null,
      lastPayload: runtime?.last_payload ?? null,
      updatedAt: runtime?.updated_at ?? null,
    },
    runtimeSession: runtimeSession
      ? {
          sessionId: runtimeSession.session_id,
          agentId: runtimeSession.agent_id,
          terminalId: runtimeSession.terminal_id,
          status: runtimeSession.status,
          createdAt: runtimeSession.created_at,
          updatedAt: runtimeSession.updated_at,
        }
      : null,
    legalNextTargets: getLegalOutgoingTargets(record.mission, nodeId),
    latestTask: recentTasks[0] ?? null,
    recentTasks,
    inbox,
    pendingPushes,
    upstreamContext,
  };
}

export function validateGraphHandoff({ missionId, fromNodeId, targetNodeId, outcome, fromRole, targetRole, fromAttempt }) {
  if (!missionId || !fromNodeId || !targetNodeId || !outcome) {
    return { error: 'Graph-mode handoff_task requires missionId, fromNodeId, targetNodeId, and outcome.' };
  }
  if (!Number.isInteger(fromAttempt) || fromAttempt < 1) {
    return { error: 'Graph-mode handoff_task requires fromAttempt as a positive integer.' };
  }

  const normalizedOutcome = outcome.trim().toLowerCase();
  if (!['success', 'failure'].includes(normalizedOutcome)) {
    return { error: `Invalid outcome "${outcome}". Use "success" or "failure".` };
  }

  const record = loadCompiledMissionRecord(missionId);
  if (!record || record.status !== 'active') {
    return { error: `Active compiled mission ${missionId} was not found.` };
  }

  const fromNode = getMissionNode(record.mission, fromNodeId);
  if (!fromNode) {
    return { error: `Node ${fromNodeId} is not part of mission ${missionId}.` };
  }

  const targetNode = getMissionNode(record.mission, targetNodeId);
  if (!targetNode) {
    return { error: `Target node ${targetNodeId} is not part of mission ${missionId}.` };
  }

  const runtime = getMissionNodeRuntime(missionId, fromNodeId);
  if (!runtime || runtime.status !== 'running') {
    return { error: `Node ${fromNodeId} is not currently running in mission ${missionId}. Query get_task_details first.` };
  }
  if (runtime.attempt !== fromAttempt) {
    return {
      error: `Stale handoff attempt for ${fromNodeId}. fromAttempt=${fromAttempt}, currentAttempt=${runtime.attempt}.`,
    };
  }
  const sessionValidation = requireRuntimeSessionForAttempt(missionId, fromNodeId, fromAttempt);
  if (sessionValidation.error) {
    return { error: `${sessionValidation.error} Activation drift detected; refresh with get_task_details.` };
  }

  const edge = (record.mission.edges ?? []).find(candidate =>
    candidate.fromNodeId === fromNodeId &&
    candidate.toNodeId === targetNodeId &&
    allowedOutcomesForCondition(candidate.condition).includes(normalizedOutcome)
  );
  if (!edge) {
    return {
      error:
        `Illegal graph handoff ${fromNodeId} -> ${targetNodeId} for outcome ${normalizedOutcome}. ` +
        'Query get_task_details to inspect the legal outgoing targets for your current node.'
    };
  }

  if (fromRole && fromRole.trim().toLowerCase() !== String(fromNode.roleId).trim().toLowerCase()) {
    return { error: `fromRole ${fromRole} does not match mission node ${fromNodeId} (${fromNode.roleId}).` };
  }

  if (targetRole && targetRole.trim().toLowerCase() !== String(targetNode.roleId).trim().toLowerCase()) {
    return { error: `targetRole ${targetRole} does not match mission node ${targetNodeId} (${targetNode.roleId}).` };
  }

  return {
    mission: record.mission,
    fromNode,
    targetNode,
    edge,
    runtime,
    runtimeSession: sessionValidation.row,
    outcome: normalizedOutcome,
    fromAttempt,
  };
}

function normalizeEdgeCondition(condition) {
  return condition === 'on_success' || condition === 'on_failure' ? condition : 'always';
}

function deriveExecutionLayers(nodes, edges) {
  if (!Array.isArray(nodes) || nodes.length === 0) return [];
  const nodeIds = new Set(nodes.map(node => node.id));
  const indegree = new Map(nodes.map(node => [node.id, 0]));
  const adjacency = new Map(nodes.map(node => [node.id, []]));

  for (const edge of edges ?? []) {
    if (normalizeEdgeCondition(edge.condition) === 'on_failure') {
      continue;
    }
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      throw new Error(`Patch contains edge with unknown node reference: ${edge.fromNodeId} -> ${edge.toNodeId}`);
    }
    adjacency.get(edge.fromNodeId).push(edge.toNodeId);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }

  const order = new Map(nodes.map((node, index) => [node.id, index]));
  let frontier = nodes
    .map(node => node.id)
    .filter(id => (indegree.get(id) ?? 0) === 0)
    .sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  let visited = 0;
  const layers = [];

  while (frontier.length > 0) {
    layers.push(frontier);
    visited += frontier.length;
    const next = new Set();
    for (const sourceId of frontier) {
      for (const targetId of adjacency.get(sourceId) ?? []) {
        indegree.set(targetId, (indegree.get(targetId) ?? 0) - 1);
        if ((indegree.get(targetId) ?? 0) === 0) {
          next.add(targetId);
        }
      }
    }
    frontier = Array.from(next).sort((left, right) => (order.get(left) ?? 0) - (order.get(right) ?? 0));
  }

  if (visited !== nodes.length) {
    throw new Error('Adaptive patch introduces a cycle. Append-only patches must keep the mission graph acyclic.');
  }

  return layers;
}

function deriveStartNodeIds(nodes, edges) {
  const incoming = new Set(
    (edges ?? [])
      .filter(edge => normalizeEdgeCondition(edge.condition) !== 'on_failure')
      .map(edge => edge.toNodeId)
  );
  return nodes.map(node => node.id).filter(nodeId => !incoming.has(nodeId));
}

export function appendAdaptivePatch({ missionId, runVersion, patch }) {
  if (!missionId) {
    return { error: 'submit_adaptive_patch requires missionId.' };
  }
  if (!Number.isInteger(runVersion) || runVersion < 1) {
    return { error: 'submit_adaptive_patch requires runVersion as a positive integer.' };
  }
  if (!patch || typeof patch !== 'object') {
    return { error: 'submit_adaptive_patch requires a patch object with nodes/edges arrays.' };
  }

  const record = loadCompiledMissionRecord(missionId);
  if (!record || record.status !== 'active') {
    return { error: `Active compiled mission ${missionId} was not found.` };
  }

  const currentVersion = Number.isInteger(record.mission?.metadata?.runVersion)
    ? Number(record.mission.metadata.runVersion)
    : 1;
  if (runVersion !== currentVersion) {
    return {
      error: `Stale adaptive patch runVersion=${runVersion}. Current runVersion is ${currentVersion}. Refresh with get_task_details or get_workflow_graph.`,
    };
  }

  const patchNodes = Array.isArray(patch.nodes) ? patch.nodes : [];
  const patchEdges = Array.isArray(patch.edges) ? patch.edges : [];
  if (patchNodes.length === 0 && patchEdges.length === 0) {
    return { error: 'Adaptive patch is empty. Provide at least one node or edge.' };
  }

  const existingNodeIds = new Set((record.mission.nodes ?? []).map(node => node.id));
  const patchNodeIds = new Set();
  for (const node of patchNodes) {
    if (!node || typeof node !== 'object') {
      return { error: 'Adaptive patch nodes must be objects.' };
    }
    if (typeof node.id !== 'string' || !node.id.trim()) {
      return { error: 'Adaptive patch nodes must include non-empty id.' };
    }
    if (patchNodeIds.has(node.id) || existingNodeIds.has(node.id)) {
      return { error: `Adaptive patch node id collision: ${node.id}.` };
    }
    if (typeof node.roleId !== 'string' || !node.roleId.trim()) {
      return { error: `Adaptive patch node ${node.id} is missing roleId.` };
    }
    if (!node.terminal || typeof node.terminal !== 'object') {
      return { error: `Adaptive patch node ${node.id} is missing terminal binding.` };
    }
    if (!node.terminal.terminalId || !node.terminal.terminalTitle) {
      return { error: `Adaptive patch node ${node.id} terminal requires terminalId and terminalTitle.` };
    }
    patchNodeIds.add(node.id);
  }

  const combinedNodeIds = new Set([...existingNodeIds, ...patchNodeIds]);
  const nextEdges = [...(record.mission.edges ?? [])];
  for (const edge of patchEdges) {
    if (!edge || typeof edge !== 'object') {
      return { error: 'Adaptive patch edges must be objects.' };
    }
    const fromNodeId = String(edge.fromNodeId ?? '').trim();
    const toNodeId = String(edge.toNodeId ?? '').trim();
    if (!fromNodeId || !toNodeId) {
      return { error: 'Adaptive patch edges must include fromNodeId and toNodeId.' };
    }
    if (!combinedNodeIds.has(fromNodeId) || !combinedNodeIds.has(toNodeId)) {
      return { error: `Adaptive patch edge references unknown node: ${fromNodeId} -> ${toNodeId}.` };
    }
    const condition = normalizeEdgeCondition(edge.condition);
    const id = edge.id && String(edge.id).trim().length > 0
      ? String(edge.id)
      : `edge:${fromNodeId}:${condition}:${toNodeId}:${nextEdges.length + 1}`;
    nextEdges.push({
      id,
      fromNodeId,
      toNodeId,
      condition,
    });
  }

  const nextNodes = [...(record.mission.nodes ?? []), ...patchNodes.map(node => ({
    id: String(node.id),
    roleId: String(node.roleId),
    instructionOverride: typeof node.instructionOverride === 'string' ? node.instructionOverride : '',
    terminal: {
      terminalId: String(node.terminal.terminalId),
      terminalTitle: String(node.terminal.terminalTitle),
      cli: node.terminal.cli ?? 'claude',
      paneId: node.terminal.paneId ?? null,
      reusedExisting: Boolean(node.terminal.reusedExisting),
    },
  }))];

  let executionLayers;
  try {
    executionLayers = deriveExecutionLayers(nextNodes, nextEdges);
  } catch (error) {
    return { error: error instanceof Error ? error.message : String(error) };
  }

  const nextVersion = currentVersion + 1;
  const nextMission = {
    ...record.mission,
    nodes: nextNodes,
    edges: nextEdges,
    metadata: {
      ...(record.mission.metadata ?? {}),
      runVersion: nextVersion,
      executionLayers,
      startNodeIds: deriveStartNodeIds(nextNodes, nextEdges),
      authoringMode: record.mission.metadata?.authoringMode ?? 'adaptive',
    },
  };

  services.upsertCompiledMission({
    missionId,
    graphId: record.graphId,
    mission: nextMission,
    status: 'active',
  });

  for (const node of patchNodes) {
    services.insertIdleMissionNodeRuntime({ missionId, nodeId: node.id, roleId: node.roleId });
  }

  services.insertMissionTimeline({
    missionId,
    eventType: 'patch_applied',
    payload: {
      appendedNodeIds: patchNodes.map(node => node.id),
      appendedEdgeIds: patchEdges.map(edge => edge.id ?? null),
      previousRunVersion: currentVersion,
      runVersion: nextVersion,
    },
    runVersion: nextVersion,
  });

  return {
    mission: nextMission,
    previousRunVersion: currentVersion,
    runVersion: nextVersion,
    appendedNodeIds: patchNodes.map(node => node.id),
    appendedEdgeCount: patchEdges.length,
  };
}

const TOOL_RESPONSE_SCHEMA = 'mcp_tool_response_v1';

const NonEmptyString = z.string().trim().min(1);
const CliName = z.enum(['claude', 'gemini', 'opencode', 'codex', 'custom', 'generic', 'ollama', 'lmstudio']);
const CapabilityEntry = z.union([
  z.enum(WORKER_CAPABILITY_IDS),
  z.object({
    id: z.enum(WORKER_CAPABILITY_IDS),
    level: z.number().int().min(0).max(3).optional(),
    verifiedBy: z.enum(['profile', 'runtime']).optional(),
  }).strict(),
]);

const ConnectAgentInput = {
  role: NonEmptyString,
  agentId: NonEmptyString,
  terminalId: NonEmptyString.optional(),
  cli: CliName.optional(),
  profileId: NonEmptyString.optional(),
  capabilities: z.array(CapabilityEntry).optional(),
  workingDir: NonEmptyString.optional(),
};

const GetTaskDetailsInput = {
  missionId: NonEmptyString,
  nodeId: NonEmptyString,
};

const CompletionPayloadInput = z.object({
  status: z.enum(['success', 'failure']).optional(),
  summary: z.string().optional(),
  artifactReferences: z.array(z.string()).optional(),
  filesChanged: z.array(z.string()).optional(),
  keyFindings: z.array(z.string()).optional(),
  downstreamPayload: z.any().optional(),
}).strict();

const HandoffTaskSchema = z.object({
  fromRole: NonEmptyString.optional(),
  targetRole: NonEmptyString.optional(),
  title: NonEmptyString,
  description: z.string().optional(),
  payload: z.any().optional(),
  completion: CompletionPayloadInput.optional(),
  parentTaskId: z.number().int().optional(),
  missionId: NonEmptyString.optional(),
  fromNodeId: NonEmptyString.optional(),
  fromAttempt: z.number().int().positive().optional(),
  targetNodeId: NonEmptyString.optional(),
  outcome: z.enum(['success', 'failure']).optional(),
}).strict().superRefine((args, ctx) => {
  const graphMode = Boolean(args.missionId || args.fromNodeId || args.fromAttempt || args.targetNodeId || args.outcome);
  if (graphMode) {
    for (const field of ['missionId', 'fromNodeId', 'fromAttempt', 'targetNodeId', 'outcome']) {
      if (args[field] === undefined) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required in graph mode` });
      }
    }
    return;
  }
  for (const field of ['fromRole', 'targetRole']) {
    if (args[field] === undefined) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: [field], message: `${field} is required in legacy role mode` });
    }
  }
});

const CompleteTaskInput = {
  missionId: NonEmptyString,
  nodeId: NonEmptyString,
  attempt: z.number().int().positive(),
  outcome: z.enum(['success', 'failure']),
  title: z.string().optional(),
  summary: z.string().optional(),
  rawOutput: z.string().optional(),
  logRef: z.string().optional(),
  filesChanged: z.array(z.string()).optional(),
  artifactReferences: z.array(z.string()).optional(),
  keyFindings: z.array(z.string()).optional(),
  downstreamPayload: z.any().optional(),
  parentTaskId: z.number().int().optional(),
};

const AssignTaskInput = {
  taskId: z.number().int(),
  targetSessionId: NonEmptyString,
  agentId: NonEmptyString.optional(),
};

const SendMessageSchema = z.object({
  targetSessionId: NonEmptyString.optional(),
  targetNodeId: NonEmptyString.optional(),
  missionId: NonEmptyString.optional(),
  message: NonEmptyString,
}).strict().superRefine((args, ctx) => {
  if (Boolean(args.targetSessionId) === Boolean(args.targetNodeId)) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['targetSessionId'],
      message: 'Provide exactly one target: targetSessionId or targetNodeId',
    });
  }
  if (args.targetNodeId && !args.missionId) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['missionId'],
      message: 'missionId is required when targetNodeId is provided',
    });
  }
});

export const BASELINE_TOOL_CONTRACTS = Object.freeze({
  connect_agent: z.object(ConnectAgentInput).strict(),
  get_task_details: z.object(GetTaskDetailsInput).strict(),
  handoff_task: HandoffTaskSchema,
  complete_task: z.object(CompleteTaskInput).strict(),
  assign_task: z.object(AssignTaskInput).strict(),
  send_message: SendMessageSchema,
});

function makeToolText(text, isError = false) {
  return isError
    ? { isError: true, content: [{ type: 'text', text }] }
    : { content: [{ type: 'text', text }] };
}

function makeToolJson(payload, isError = false) {
  return makeToolText(JSON.stringify(payload, null, 2), isError);
}

export function buildToolSuccess(tool, data, message = null) {
  return makeToolJson({
    schema: TOOL_RESPONSE_SCHEMA,
    ok: true,
    tool,
    message,
    data,
  });
}

export function buildToolError(tool, code, message, details = null) {
  return makeToolJson({
    schema: TOOL_RESPONSE_SCHEMA,
    ok: false,
    tool,
    error: {
      code,
      message,
      details,
    },
  }, true);
}

function formatZodIssues(error) {
  return error.issues.map(issue => ({
    path: issue.path.join('.'),
    message: issue.message,
    code: issue.code,
  }));
}

function validateToolArgs(tool, args) {
  const schema = BASELINE_TOOL_CONTRACTS[tool];
  const parsed = schema.safeParse(args ?? {});
  if (parsed.success) return { args: parsed.data };
  const details = formatZodIssues(parsed.error);
  const message = details
    .map(issue => issue.path ? `${issue.path}: ${issue.message}` : issue.message)
    .join('; ');
  return {
    error: buildToolError(tool, 'bad_input', `${tool} received invalid input: ${message}`, details),
  };
}

function resetInMemoryRuntime() {
  for (const bucket of [messageQueues, fileLocks, fileWaitQueues, sessions]) {
    for (const key of Object.keys(bucket)) {
      delete bucket[key];
    }
  }
  clients.clear();
  projects.length = 0;
  agents.length = 0;
  broadcastHistory.length = 0;
  recentAgentEvents.length = 0;
}

// ── Typed agent events (Phase C) ────────────────────────────────────────────
// Adapters subscribe per-session via /events/session?sid=<id>. Legacy /events
// SSE feed stays untouched for the UI.
export const agentEvents = new EventEmitter();
agentEvents.setMaxListeners(0);
const AGENT_EVENT_HISTORY_CAP = 500;
const recentAgentEvents = [];

export function emitAgentEvent(ev) {
  if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') return;
  if (typeof ev.sessionId !== 'string' || !ev.sessionId) return;
  if (typeof ev.at !== 'number') ev.at = Date.now();
  recentAgentEvents.push(ev);
  if (recentAgentEvents.length > AGENT_EVENT_HISTORY_CAP) recentAgentEvents.shift();
  agentEvents.emit('event', ev);
  agentEvents.emit(`sid:${ev.sessionId}`, ev);
}

export function getRecentAgentEvents(sessionId = null) {
  if (!sessionId) return [...recentAgentEvents];
  return recentAgentEvents.filter(ev => ev.sessionId === sessionId);
}

// Idempotent task push record. Returns true on first insert, false on replay.
// The registry side uses this as the choke point for duplicate sendTask calls;
// agents see new rows via the pending-pushes join in buildTaskDetails.
export function recordTaskPush({ sessionId, missionId, nodeId, taskSeq, attempt = null }) {
  if (typeof sessionId !== 'string' || !sessionId) return { inserted: false, reason: 'missing_session' };
  if (typeof missionId !== 'string' || !missionId) return { inserted: false, reason: 'missing_mission' };
  if (typeof nodeId !== 'string' || !nodeId) return { inserted: false, reason: 'missing_node' };
  if (!Number.isInteger(taskSeq) || taskSeq <= 0) return { inserted: false, reason: 'invalid_task_seq' };

  return services.recordTaskPush({ sessionId, missionId, nodeId, taskSeq, attempt });
}

export function getPendingTaskPushes(sessionId) {
  return services.getPendingTaskPushes(sessionId);
}

export function ackTaskPush({ sessionId, missionId, nodeId, taskSeq }) {
  return services.ackTaskPush({ sessionId, missionId, nodeId, taskSeq });
}

export function resetStarlinkState() {
  services.resetAll();
  resetInMemoryRuntime();
}

export function seedCompiledMission(mission, status = 'active') {
  services.upsertCompiledMission({
    missionId: mission.missionId,
    graphId: mission.graphId,
    mission,
    status,
  });
  return loadCompiledMissionRecord(mission.missionId);
}

export function seedMissionNodeRuntime({
  missionId,
  nodeId,
  roleId,
  status = 'idle',
  attempt = 0,
  currentWaveId = null,
  lastOutcome = null,
  lastPayload = null,
}) {
  services.upsertMissionNodeRuntime({
    missionId,
    nodeId,
    roleId,
    status,
    attempt,
    currentWaveId,
    lastOutcome,
    lastPayload,
  });
}

export function seedAgentRuntimeSession({
  sessionId,
  agentId,
  missionId,
  nodeId,
  attempt,
  terminalId,
  status = 'activated',
}) {
  services.upsertRuntimeSession({ sessionId, agentId, missionId, nodeId, attempt, terminalId, status });
}

export function seedAgentRun({
  runId,
  missionId,
  nodeId,
  attempt = 1,
  sessionId,
  agentId = 'agent',
  cli = 'codex',
  executionMode = 'headless',
  cwd = null,
  command = 'codex',
  args = [],
  env = {},
  promptPath = null,
  stdoutPath = null,
  stderrPath = null,
  transcriptPath = null,
  status = 'running',
  exitCode = null,
  error = null,
  startedAt = null,
  completedAt = null,
}) {
  services.upsertAgentRun({
    runId,
    missionId,
    nodeId,
    attempt,
    sessionId,
    agentId,
    cli,
    executionMode,
    cwd,
    command,
    args,
    env,
    promptPath,
    stdoutPath,
    stderrPath,
    transcriptPath,
    status,
    exitCode,
    error,
    startedAt,
    completedAt,
  });
}

export function getBroadcastHistory() {
  return [...broadcastHistory];
}

export function executeListAgentRuns({ missionId, status, limit = 50 } = {}) {
  const rows = services.listAgentRuns({ missionId, status, limit });
  return makeToolText(JSON.stringify(rows, null, 2));
}

export function executeInspectAgentRun({ runId } = {}) {
  if (typeof runId !== 'string' || !runId.trim()) {
    return makeToolText('inspect_agent_run requires runId.', true);
  }
  const row = services.inspectAgentRun(runId.trim());
  if (!row) return makeToolText(`Agent run ${runId.trim()} was not found.`, true);
  return makeToolText(JSON.stringify(row, null, 2));
}

export function executeListRuntimeSessions({ missionId, status, limit = 50 } = {}) {
  const rows = services.listRuntimeSessions({ missionId, status, limit });
  return makeToolText(JSON.stringify(rows, null, 2));
}

export function executeConnectAgent(
  input = {},
  sessionId = 'unknown',
  options = {},
) {
  const validation = validateToolArgs('connect_agent', input);
  if (validation.error) return validation.error;
  const { role, agentId, terminalId, cli, profileId, capabilities, workingDir } = validation.args;
  const {
    silent = false,
    source = 'connect',
    missionId = null,
    nodeId = null,
    attempt = null,
    activationId = null,
    runId = null,
  } = options;
  const sid = sessionId ?? 'unknown';
  const normalizedRole = typeof role === 'string' && role.trim() ? role.trim().toLowerCase() : null;
  const explicitCapabilities = normalizeCapabilities(capabilities);
  const normalizedCapabilities = explicitCapabilities.length > 0
    ? explicitCapabilities
    : normalizeCapabilities(defaultCapabilitiesForRole(normalizedRole));

  sessions[sid] = sessions[sid] ?? {};
  sessions[sid].role = normalizedRole;
  sessions[sid].profileId = typeof profileId === 'string' && profileId.trim()
    ? profileId.trim()
    : (sessions[sid].profileId ?? normalizedRole);
  sessions[sid].agentId = agentId;
  sessions[sid].terminalId = terminalId ?? null;
  sessions[sid].cli = cli ?? null;
  sessions[sid].capabilities = normalizedCapabilities;
  sessions[sid].status = 'idle';
  sessions[sid].availability = 'available';
  sessions[sid].workingDir = typeof workingDir === 'string' && workingDir.trim() ? workingDir.trim() : (sessions[sid].workingDir ?? null);
  sessions[sid].connectedAt = sessions[sid].connectedAt ?? Date.now();
  sessions[sid].updatedAt = Date.now();

  const message = `Role: ${role}. Agent "${agentId}" is online and ready. (Session: ${sid})`;

  logSession(sid, source, JSON.stringify({
    agentId,
    role,
    profileId: sessions[sid].profileId,
    terminalId: terminalId ?? null,
    cli: cli ?? null,
    capabilities: normalizedCapabilities,
    workingDir: sessions[sid].workingDir,
    missionId,
    nodeId,
    attempt,
    activationId,
    runId,
  }));

  if (!silent) {
    const targets = Object.keys(sessions).filter(id => id !== sid);
    const ts = Date.now();
    for (const targetSid of targets) {
      if (!messageQueues[targetSid]) messageQueues[targetSid] = [];
      messageQueues[targetSid].push({ from: agentId, text: `[BROADCAST] ${message}`, timestamp: ts });
    }

    broadcast('Starlink', JSON.stringify({
      sessionId: sid,
      agentId,
      role,
      profileId: sessions[sid].profileId,
      terminalId: terminalId ?? null,
      cli: cli ?? null,
      capabilities: normalizedCapabilities,
      workingDir: sessions[sid].workingDir,
    }), 'agent_connected');

    broadcast('Starlink', `Agent "${agentId}" (${role}) connected via session ${sid}`);
  } else {
    broadcast('Starlink', JSON.stringify({
      sessionId: sid,
      missionId,
      nodeId,
      attempt,
      role,
      profileId: sessions[sid].profileId,
      terminalId: terminalId ?? null,
      cli: cli ?? null,
    }), 'runtime_registration');
  }

  emitAgentEvent({
    type: 'agent:ready',
    sessionId: sid,
    agentId: agentId ?? null,
    profileId: sessions[sid].profileId ?? null,
    role: normalizedRole,
    missionId: missionId ?? undefined,
    nodeId: nodeId ?? undefined,
    attempt: Number.isInteger(attempt) ? attempt : undefined,
    at: Date.now(),
  });

  // Also emit for the explicit graph-mode session ID if it differs
  const graphSid = options.sessionId || null;
  if (graphSid && graphSid !== sid) {
    emitAgentEvent({
      type: 'agent:ready',
      sessionId: graphSid,
      agentId: agentId ?? null,
      profileId: sessions[sid].profileId ?? null,
      role: normalizedRole,
      missionId: missionId ?? undefined,
      nodeId: nodeId ?? undefined,
      attempt: Number.isInteger(attempt) ? attempt : undefined,
      at: Date.now(),
    });
  }

  return buildToolSuccess(
    'connect_agent',
    {
      sessionId: sid,
      status: 'online',
      session: summarizeSession(sid, sessions[sid] ?? {}),
    },
    `Successfully connected to CometAI Starlink. Session ID: ${sid}. Status: Online`,
  );
}

function validateRuntimeBootstrapRegistration({ sessionId, missionId, nodeId, attempt }) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return { ok: false, code: 'missing_session', message: 'Runtime bootstrap is missing sessionId.' };
  }
  if (typeof missionId !== 'string' || !missionId.trim()) {
    return { ok: false, code: 'missing_mission', message: 'Runtime bootstrap is missing missionId.' };
  }
  if (typeof nodeId !== 'string' || !nodeId.trim()) {
    return { ok: false, code: 'missing_node', message: 'Runtime bootstrap is missing nodeId.' };
  }
  if (!Number.isInteger(attempt) || attempt <= 0) {
    return { ok: false, code: 'invalid_attempt', message: 'Runtime bootstrap requires attempt >= 1.' };
  }

  let nodeRuntime = services.getMissionNodeRuntimeStatusAttempt(missionId, nodeId);

  if (!nodeRuntime) {
    // Ad-hoc mission: create runtime row on the fly and proceed permissively.
    services.upsertAdhocMissionNodeRuntime({ missionId, nodeId, attempt });
    nodeRuntime = { status: 'running', attempt };
  } else {
    const currentAttempt = Number(nodeRuntime.attempt ?? 0);
    if (currentAttempt !== attempt) {
      return {
        ok: false,
        code: 'stale_attempt',
        message: `Stale runtime bootstrap for ${missionId}/${nodeId}: got attempt ${attempt}, current attempt ${currentAttempt}.`,
      };
    }

    if (['done', 'failed', 'unbound'].includes(String(nodeRuntime.status ?? ''))) {
      return {
        ok: false,
        code: 'terminal_state',
        message: `Runtime bootstrap rejected because node is already ${nodeRuntime.status}.`,
      };
    }
  }

  const runtimeSession = services.getRuntimeSessionForBootstrap({ sessionId, missionId, nodeId });

  if (!runtimeSession) {
    // Ad-hoc mission: create the session row so the rest of the pipeline can proceed.
    services.upsertAdhocRuntimeSession({ sessionId, missionId, nodeId, attempt });
  } else {
    const recordedAttempt = Number(runtimeSession.attempt ?? 0);
    if (recordedAttempt !== attempt) {
      return {
        ok: false,
        code: 'stale_activation',
        message: `Runtime session ${sessionId} attempt mismatch: got ${attempt}, recorded ${recordedAttempt}.`,
      };
    }
  }

  return { ok: true };
}

export function executeRuntimeBootstrapRegistration({
  sessionId,
  missionId,
  nodeId,
  attempt,
  role,
  profileId,
  agentId,
  terminalId,
  cli,
  capabilities,
  workingDir,
  activationId = null,
  runId = null,
  executionMode = null,
}) {
  const validation = validateRuntimeBootstrapRegistration({ sessionId, missionId, nodeId, attempt });
  if (!validation.ok) {
    return validation;
  }

  executeConnectAgent(
    {
      role,
      agentId,
      terminalId,
      cli,
      profileId,
      capabilities,
      workingDir,
    },
    sessionId,
    {
      silent: true,
      source: 'runtime_bootstrap',
      missionId,
      nodeId,
      attempt,
      activationId,
      runId,
      executionMode,
    },
  );

  services.updateRuntimeSessionStatus({ sessionId, status: 'registered' });

  return {
    ok: true,
    sessionId,
    missionId,
    nodeId,
    attempt,
    connectedAt: Date.now(),
    session: summarizeSession(sessionId, sessions[sessionId] ?? {}),
  };
}

export function executeRuntimeDisconnect({
  sessionId,
  missionId = null,
  nodeId = null,
  attempt = null,
  reason = null,
}) {
  if (typeof sessionId !== 'string' || !sessionId.trim()) {
    return { ok: false, code: 'missing_session', message: 'runtime disconnect requires sessionId.' };
  }
  const sid = sessionId.trim();
  const existed = Boolean(sessions[sid]);
  if (existed) {
    delete sessions[sid];
  }

  services.updateRuntimeSessionStatus({ sessionId: sid, status: 'disconnected' });

  logSession(
    sid,
    'runtime_disconnected',
    JSON.stringify({ missionId, nodeId, attempt, reason }),
  );

  emitAgentEvent({
    type: 'agent:disconnected',
    sessionId: sid,
    missionId: missionId ?? undefined,
    nodeId: nodeId ?? undefined,
    attempt: Number.isInteger(attempt) ? attempt : undefined,
    reason: typeof reason === 'string' ? reason : undefined,
    at: Date.now(),
  });

  return { ok: true, sessionId: sid, disconnected: existed };
}

export function executeReceiveMessages({ missionId, nodeId, afterSeq, ackThroughSeq } = {}, sessionId) {
  if (typeof sessionId === 'string' && sessionId) {
    emitAgentEvent({ type: 'agent:heartbeat', sessionId, at: Date.now() });
  }
  if (missionId || nodeId || afterSeq !== undefined || ackThroughSeq !== undefined) {
    if (!missionId || !nodeId) {
      return makeToolText('Graph-mode receive_messages requires missionId and nodeId.', true);
    }
    if (!buildTaskDetails(missionId, nodeId)) {
      return makeToolText(`Mission ${missionId} or node ${nodeId} was not found.`, true);
    }

    const fromSeq = Number.isInteger(afterSeq) && afterSeq > 0 ? afterSeq : 0;
    const ackSeq = Number.isInteger(ackThroughSeq) && ackThroughSeq > 0 ? ackThroughSeq : null;
    if (ackSeq !== null) {
      services.ackNodeMessages({ missionId, nodeId, throughSeq: ackSeq });
    }

    const messages = services.listNodeMessagesAfter({ missionId, nodeId, afterSeq: fromSeq }).map(message => ({
      seq: message.id,
      sessionId: message.session_id,
      createdAt: message.created_at,
      isRead: Boolean(message.is_read),
      content: message.content,
      contentJson: parseJsonSafe(message.content),
    }));

    const nextSeq = messages.length > 0 ? messages[messages.length - 1].seq : fromSeq;
    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          missionId,
          nodeId,
          afterSeq: fromSeq,
          ackThroughSeq: ackSeq,
          nextSeq,
          messages,
        }, null, 2),
      }],
    };
  }

  const sid = sessionId;
  const queuedMessages = sid ? (messageQueues[sid] ?? []) : [];
  if (sid) {
    messageQueues[sid] = [];
  }
  if (queuedMessages.length === 0) {
    return makeToolText('No messages.');
  }
  const text = queuedMessages
    .map(message => `[${new Date(message.timestamp).toISOString()}] from ${message.from}:\n${message.text}`)
    .join('\n\n');
  return makeToolText(text);
}

export function executeGetTaskDetails(input = {}, sessionId) {
  const validation = validateToolArgs('get_task_details', input);
  if (validation.error) return validation.error;
  const { missionId, nodeId } = validation.args;

  const details = buildTaskDetails(missionId, nodeId);
  if (!details) {
    return buildToolError(
      'get_task_details',
      'not_found',
      `Mission ${missionId} or node ${nodeId} could not be found. Confirm the NEW_TASK payload and active mission.`,
    );
  }

  const sid = sessionId ?? null;
  if (sid) {
    const targetSid = details.runtimeSession?.sessionId ?? sid;
    const currentAttempt = Number(details.node?.attempt ?? 0);
    if (details.runtimeSession?.sessionId && Number.isInteger(currentAttempt) && currentAttempt > 0) {
      ackTaskPush({
        sessionId: details.runtimeSession.sessionId,
        missionId,
        nodeId,
        taskSeq: currentAttempt,
      });
    }
    emitAgentEvent({
      type: 'activation:acked',
      sessionId: targetSid,
      missionId,
      nodeId,
      attempt: currentAttempt,
      taskSeq: currentAttempt,
    });

    if (targetSid !== sid) {
      emitAgentEvent({
        type: 'activation:acked',
        sessionId: sid,
        missionId,
        nodeId,
        attempt: currentAttempt,
        taskSeq: currentAttempt,
      });
    }
  }

  return buildToolSuccess('get_task_details', details, 'Task details loaded.');
}

export function executeSendMessage(input = {}, sessionId) {
  const validation = validateToolArgs('send_message', input);
  if (validation.error) return validation.error;
  const { targetSessionId, targetNodeId, missionId, message } = validation.args;
  const hasTargetNode = typeof targetNodeId === 'string' && targetNodeId.trim();

  const from = sessionId ?? 'unknown';

  if (hasTargetNode) {
    services.insertNodeMessage({
      sessionId: from,
      content: message,
      missionId,
      recipientNodeId: targetNodeId,
    });
    broadcast('Starlink', `Message queued: ${from} -> node ${targetNodeId}`, 'message');
    return buildToolSuccess(
      'send_message',
      { delivered: true, targetType: 'node', missionId, targetNodeId },
      `Message delivered to node ${targetNodeId}.`,
    );
  }

  if (!sessions[targetSessionId]) {
    return buildToolError(
      'send_message',
      'not_found',
      `Session ${targetSessionId} not found. Use list_sessions to see active sessions.`,
    );
  }
  if (!messageQueues[targetSessionId]) messageQueues[targetSessionId] = [];
  messageQueues[targetSessionId].push({ from, text: message, timestamp: Date.now() });
  broadcast('Starlink', `Message queued: ${from} -> session ${targetSessionId}`, 'message');
  return buildToolSuccess(
    'send_message',
    { delivered: true, targetType: 'session', targetSessionId },
    `Message delivered to session ${targetSessionId}.`,
  );
}

function normalizeCompletionStatus(value) {
  if (value === 'success' || value === 'failure') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'success' || normalized === 'failure' ? normalized : null;
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

function buildStructuredCompletionPayload({
  completion,
  payload,
  title,
  description,
  finalOutcome,
  keyFindings,
}) {
  const completionObj = completion && typeof completion === 'object' ? completion : {};
  const status = finalOutcome
    ?? normalizeCompletionStatus(completionObj.status)
    ?? 'success';
  const summary = typeof completionObj.summary === 'string' && completionObj.summary.trim()
    ? completionObj.summary.trim()
    : (typeof description === 'string' && description.trim() ? description.trim() : String(title ?? 'Handoff completed'));

  const resolvedFindings = normalizeStringArray(
    keyFindings ?? completionObj.keyFindings
  );

  return {
    status,
    summary,
    artifactReferences: normalizeStringArray(completionObj.artifactReferences),
    filesChanged: normalizeStringArray(completionObj.filesChanged),
    keyFindings: resolvedFindings,
    downstreamPayload: completionObj.downstreamPayload !== undefined ? completionObj.downstreamPayload : (payload ?? null),
  };
}

function nodeRuntimeIsRunning(missionId, nodeId, attempt) {
  const runtime = getMissionNodeRuntime(missionId, nodeId);
  if (!runtime || runtime.status !== 'running') {
    return { error: `Node ${nodeId} is not currently running in mission ${missionId}. Query get_task_details first.` };
  }
  if (runtime.attempt !== attempt) {
    return {
      error: `Stale completion attempt for ${nodeId}. attempt=${attempt}, currentAttempt=${runtime.attempt}.`,
    };
  }
  const sessionValidation = requireRuntimeSessionForAttempt(missionId, nodeId, attempt);
  if (sessionValidation.error) {
    return { error: `${sessionValidation.error} Activation drift detected; refresh with get_task_details.` };
  }
  return { runtime, runtimeSession: sessionValidation.row };
}

function matchingOutgoingTargets(mission, fromNodeId, outcome) {
  const nodeById = new Map((mission?.nodes ?? []).map(node => [node.id, node]));
  return (mission?.edges ?? [])
    .filter(edge => edge.fromNodeId === fromNodeId)
    .filter(edge => allowedOutcomesForCondition(edge.condition).includes(outcome))
    .map(edge => ({
      edge,
      targetNode: nodeById.get(edge.toNodeId) ?? null,
    }))
    .filter(entry => entry.targetNode);
}

function persistGraphHandoff({
  sid,
  missionId,
  fromNodeId,
  targetNodeId,
  fromRole,
  targetRole,
  title,
  description,
  parentTaskId,
  outcome,
  fromAttempt,
  structuredCompletion,
}) {
  const payloadStr = JSON.stringify(structuredCompletion);
  let taskId = null;

  if (targetNodeId && targetRole !== 'done') {
    taskId = services.createTask({
      title,
      description: description ?? null,
      agentId: targetRole,
      parentTaskId: parentTaskId ?? null,
      status: 'todo',
      fromRole,
      targetRole,
      payload: payloadStr,
      missionId,
      nodeId: targetNodeId,
    });

    const handoffMessage = JSON.stringify({
      taskId,
      title,
      description: description ?? null,
      missionId,
      fromNodeId,
      targetNodeId,
      fromRole,
      targetRole,
      outcome,
      fromAttempt,
      payload: payloadStr,
      completion: structuredCompletion,
    });
    services.insertNodeMessage({
      sessionId: sid,
      content: handoffMessage,
      missionId,
      nodeId: fromNodeId,
      recipientNodeId: targetNodeId,
    });
  }

  const eventBody = {
    taskId,
    fromRole,
    targetRole,
    title,
    description: description ?? null,
    payload: payloadStr,
    completion: structuredCompletion,
    missionId,
    fromNodeId,
    targetNodeId: targetNodeId ?? null,
    outcome,
    fromAttempt,
  };
  broadcast(fromRole ?? 'graph', JSON.stringify(eventBody), 'handoff');

  if (taskId !== null) {
    broadcast('Starlink', JSON.stringify({
      id: taskId,
      title,
      agentId: targetRole,
      parentTaskId: parentTaskId ?? null,
      status: 'todo',
      missionId,
      targetNodeId,
    }), 'task_update');
  }

  return {
    taskId,
    eventBody,
    content: [{
      type: 'text',
      text: taskId === null
        ? 'Handoff recorded without creating a task.'
        : `Handoff recorded as task ${taskId}.`,
    }],
  };
}

export function executeHandoffTask(
  input = {},
  sessionId = 'unknown',
) {
  const inputValidation = validateToolArgs('handoff_task', input);
  if (inputValidation.error) return inputValidation.error;
  const {
    fromRole: rawFrom,
    targetRole: rawTarget,
    title,
    description,
    payload,
    completion,
    parentTaskId,
    missionId,
    fromNodeId,
    targetNodeId,
    outcome,
    fromAttempt,
  } = inputValidation.args;
  const sid = sessionId ?? 'unknown';
  const isGraphMode = Boolean(missionId || fromNodeId || targetNodeId);
  let graphValidation = null;
  if (isGraphMode) {
    const validation = validateGraphHandoff({
      missionId,
      fromNodeId,
      targetNodeId,
      outcome,
      fromRole: rawFrom,
      targetRole: rawTarget,
      fromAttempt,
    });
    if (validation.error) {
      return buildToolError('handoff_task', 'invalid_handoff', validation.error);
    }
    graphValidation = validation;
  }

  let fromRole = rawFrom?.trim().toLowerCase() ?? null;
  let targetRole = rawTarget?.trim().toLowerCase() ?? null;
  if (graphValidation) {
    fromRole ??= String(graphValidation.fromNode.roleId).trim().toLowerCase();
    targetRole ??= String(graphValidation.targetNode.roleId).trim().toLowerCase();
  }

  const normalizedOutcome = outcome?.trim().toLowerCase() ?? 'success';
  const structuredCompletion = buildStructuredCompletionPayload({
    completion,
    payload,
    title,
    description,
    finalOutcome: normalizedOutcome,
  });
  const payloadStr = JSON.stringify(structuredCompletion);

  let taskId = null;
  if (targetRole && targetRole !== 'done') {
    taskId = services.createTask({
      title,
      description: description ?? null,
      agentId: targetRole,
      parentTaskId: parentTaskId ?? null,
      status: 'todo',
      fromRole,
      targetRole,
      payload: payloadStr,
      missionId: missionId ?? null,
      nodeId: targetNodeId ?? null,
    });
  }

  if (missionId && targetNodeId) {
    const handoffMessage = JSON.stringify({
      taskId,
      title,
      description: description ?? null,
      missionId,
      fromNodeId: fromNodeId ?? null,
      targetNodeId,
      fromRole,
      targetRole,
      outcome: normalizedOutcome,
      fromAttempt,
      payload: payloadStr,
      completion: structuredCompletion,
    });
    services.insertNodeMessage({
      sessionId: sid,
      content: handoffMessage,
      missionId,
      nodeId: fromNodeId ?? null,
      recipientNodeId: targetNodeId,
    });
  }

  const eventBody = {
    taskId,
    fromRole,
    targetRole,
    title,
    description: description ?? null,
    payload: payloadStr,
    completion: structuredCompletion,
    missionId,
    fromNodeId,
    targetNodeId,
    outcome: normalizedOutcome,
    fromAttempt,
  };

  broadcast(fromRole ?? 'graph', JSON.stringify(eventBody), 'handoff');
  if (taskId !== null) {
    broadcast('Starlink', JSON.stringify({
      id: taskId,
      title,
      agentId: targetRole,
      parentTaskId: parentTaskId ?? null,
      status: 'todo',
      missionId,
      targetNodeId,
    }), 'task_update');
  }

  const handoffAt = Date.now();
  const handoffEvent = {
    type: 'task:completed',
    sessionId: sid,
    missionId,
    nodeId: fromNodeId,
    attempt: fromAttempt,
    outcome: normalizedOutcome,
    targetNodeId: targetNodeId ?? null,
    at: handoffAt,
    payload: structuredCompletion,
  };
  emitAgentEvent(handoffEvent);

  // Cross-emit on the pre-registered runtime session ID so the TS orchestrator's
  // mcpBus subscriber (which uses the runtime session ID, not the transport UUID) fires.
  if (missionId && fromNodeId && Number.isInteger(fromAttempt) && fromAttempt > 0) {
    const runtimeSessionRow = services.getRuntimeSessionIdByAttempt({ missionId, nodeId: fromNodeId, attempt: fromAttempt });
    if (runtimeSessionRow && runtimeSessionRow.session_id !== sid) {
      emitAgentEvent({ ...handoffEvent, sessionId: runtimeSessionRow.session_id });
    }
  }

  return buildToolSuccess(
    'handoff_task',
    { taskId, eventBody },
    taskId === null
      ? 'Handoff recorded without creating a task.'
      : `Handoff recorded as task ${taskId}.`,
  );
}


export function executeCompleteTask(
  input = {},
  sessionId = 'unknown',
) {
  const validation = validateToolArgs('complete_task', input);
  if (validation.error) return validation.error;
  const {
    missionId,
    nodeId,
    attempt,
    outcome,
    title,
    summary,
    rawOutput,
    logRef,
    filesChanged,
    artifactReferences,
    keyFindings,
    downstreamPayload,
    parentTaskId,
  } = validation.args;
  const sid = sessionId ?? 'unknown';
  const normalizedOutcome = normalizeCompletionStatus(outcome);

  const record = loadCompiledMissionRecord(missionId);
  if (!record || record.status !== 'active') {
    return buildToolError('complete_task', 'not_found', `Active compiled mission ${missionId} was not found.`);
  }
  const node = getMissionNode(record.mission, nodeId);
  if (!node) {
    return buildToolError('complete_task', 'invalid_node', `Node ${nodeId} is not part of mission ${missionId}.`);
  }
  const runtimeCheck = nodeRuntimeIsRunning(missionId, nodeId, attempt);
  if (runtimeCheck.error) {
    return buildToolError('complete_task', 'invalid_runtime', runtimeCheck.error);
  }

  const completion = {
    status: normalizedOutcome,
    summary: typeof summary === 'string' && summary.trim() ? summary.trim() : String(title ?? 'Task completed'),
    artifactReferences: normalizeStringArray(artifactReferences),
    filesChanged: normalizeStringArray(filesChanged),
    keyFindings: normalizeStringArray(keyFindings),
    downstreamPayload: downstreamPayload ?? null,
    rawOutput: typeof rawOutput === 'string' ? rawOutput : null,
    logRef: typeof logRef === 'string' ? logRef : null,
    completedAt: new Date().toISOString(),
  };
  const structuredCompletion = buildStructuredCompletionPayload({
    completion,
    payload: downstreamPayload ?? null,
    title: title ?? completion.summary,
    description: completion.summary,
    finalOutcome: normalizedOutcome,
    keyFindings: normalizeStringArray(keyFindings),
  });
  structuredCompletion.rawOutput = completion.rawOutput;
  structuredCompletion.logRef = completion.logRef;
  structuredCompletion.completedAt = completion.completedAt;

  const targets = matchingOutgoingTargets(record.mission, nodeId, normalizedOutcome);
  const routed = [];
  for (const { targetNode } of targets) {
    const result = persistGraphHandoff({
      sid,
      missionId,
      fromNodeId: nodeId,
      targetNodeId: targetNode.id,
      fromRole: String(node.roleId).trim().toLowerCase(),
      targetRole: String(targetNode.roleId).trim().toLowerCase(),
      title: title ?? completion.summary,
      description: summary ?? null,
      parentTaskId,
      outcome: normalizedOutcome,
      fromAttempt: attempt,
      structuredCompletion,
    });
    routed.push({ targetNodeId: targetNode.id, taskId: result.taskId });
  }

  if (routed.length === 0) {
    persistGraphHandoff({
      sid,
      missionId,
      fromNodeId: nodeId,
      targetNodeId: null,
      fromRole: String(node.roleId).trim().toLowerCase(),
      targetRole: 'done',
      title: title ?? completion.summary,
      description: summary ?? null,
      parentTaskId,
      outcome: normalizedOutcome,
      fromAttempt: attempt,
      structuredCompletion,
    });
  }

  logSession(sid, 'complete_task', JSON.stringify({
    missionId,
    nodeId,
    attempt,
    outcome: normalizedOutcome,
    summary: completion.summary,
    filesChanged: structuredCompletion.filesChanged,
    artifactReferences: structuredCompletion.artifactReferences,
    routed,
  }));

  const completedAt = Date.now();
  const completionEvent = {
    type: 'task:completed',
    sessionId: sid,
    missionId,
    nodeId,
    attempt,
    outcome: normalizedOutcome,
    summary: completion.summary,
    filesChanged: structuredCompletion.filesChanged,
    artifactReferences: structuredCompletion.artifactReferences,
    logRef: completion.logRef,
    at: completedAt,
  };
  emitAgentEvent(completionEvent);

  // The TS orchestrator subscribes via mcpBus using the pre-registered runtime session ID
  // (e.g. "claude:abc:xyz"), but getSessionId() returns the MCP transport UUID. Cross-emit
  // on the runtime session ID so the orchestrator's wireMcpForSession handler fires.
  const runtimeSessionRow = services.getRuntimeSessionIdByAttempt({ missionId, nodeId, attempt });
  if (runtimeSessionRow && runtimeSessionRow.session_id !== sid) {
    emitAgentEvent({ ...completionEvent, sessionId: runtimeSessionRow.session_id });
  }

  return buildToolSuccess('complete_task', {
    status: 'completed',
    missionId,
    nodeId,
    attempt,
    outcome: normalizedOutcome,
    routed,
    terminal: routed.length === 0,
  }, 'Task completion recorded.');
}

const PORT = parseInt(process.env.MCP_PORT || '3741');

// ── Phase 2: Workflow graph ─────────────────────────────────────────────────
// Lightweight state machine defining valid role transitions. handoff_task
// rejects any edge not listed here, preventing agents from executing out of
// turn. `done` is a terminal pseudo-role — reaching it completes the workflow.
const WORKFLOW_GRAPH = {
  scout:       { next: ['coordinator'] },
  // Coordinator fans out in parallel to implementation + test + security specialists.
  coordinator: { next: ['builder', 'tester', 'security'] },
  builder:     { next: ['reviewer'] },
  tester:      { next: ['reviewer'] },
  security:    { next: ['reviewer'] },
  // Reviewer branches: pass → done, fail → route to the specific specialist that
  // produced the defective output (payload carries verdict/reasons/diff).
  reviewer:    { next: ['builder', 'tester', 'security', 'done'] },
  done:        { next: [] },
};

function isValidTransition(fromRole, targetRole) {
  const node = WORKFLOW_GRAPH[fromRole];
  if (!node) return false;
  return node.next.includes(targetRole);
}

// In-memory simple stores
const projects = [];
const agents = [];

// Per-session message queues: sessionId -> [{ from, text, timestamp }]
const messageQueues = {};

// File locks: filePath -> { agentId, sessionId, lockedAt }
const fileLocks = {};

// Phase 3: wait queues. filePath -> [{ agentId, sessionId, queuedAt }].
// When a locked file is released the next live waiter is auto-granted the
// lock and notified via their message inbox — no polling required.
const fileWaitQueues = {};

// SSE clients for the /events feed
const clients = new Set();
const broadcastHistory = [];
function broadcast(from, content, type = 'message') {
  const msg = { id: Date.now(), from, content, type, timestamp: Date.now() };
  broadcastHistory.push(msg);
  if (broadcastHistory.length > 500) broadcastHistory.shift();
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  clients.forEach(res => res.write(data));
}

// Sessions map: sessionId -> {
//   transport, mcpServer, role, profileId, agentId, terminalId, cli,
//   capabilities, status, availability, workingDir, connectedAt, updatedAt
// }
const sessions = {};

function sessionLoadForAssignment(sessionId) {
  return services.countActiveTasksForAgent(sessionId);
}

function fileContentionForScope(fileScope, ownerSessionId) {
  const scope = Array.isArray(fileScope) ? fileScope.filter(value => typeof value === 'string' && value.trim()) : [];
  if (scope.length === 0) return { blocked: false, files: [] };

  const blockedFiles = [];
  for (const filePath of scope) {
    const lock = fileLocks[filePath];
    if (!lock) continue;
    const sameOwner = lock.sessionId === ownerSessionId || lock.agentId === ownerSessionId;
    if (!sameOwner) {
      blockedFiles.push({ filePath, owner: lock.agentId, ownerSessionId: lock.sessionId ?? null });
    }
  }
  return { blocked: blockedFiles.length > 0, files: blockedFiles };
}

function evaluateWorkerForRequirements(sessionId, session, options) {
  const {
    requiredCapabilities,
    preferredCapabilities,
    workingDir,
    fileScope,
    writeAccess,
    excludedSessionIds,
    previousSessionId,
  } = options;

  if (excludedSessionIds.has(sessionId)) {
    return { eligible: false, sessionId, reason: 'excluded' };
  }
  if ((session.availability ?? 'available') !== 'available') {
    return { eligible: false, sessionId, reason: 'unavailable' };
  }
  if (typeof workingDir === 'string' && workingDir.trim()) {
    const candidateDir = typeof session.workingDir === 'string' ? session.workingDir.trim().toLowerCase() : '';
    if (!candidateDir || candidateDir !== workingDir.trim().toLowerCase()) {
      return { eligible: false, sessionId, reason: 'working_dir_mismatch' };
    }
  }

  const capabilities = effectiveSessionCapabilities(session);
  const byCapability = new Map(capabilities.map(capability => [capability.id, capability]));

  const missing = requiredCapabilities.filter(capabilityId => !byCapability.has(capabilityId));
  if (missing.length > 0) {
    return { eligible: false, sessionId, reason: `missing_required:${missing.join(',')}` };
  }

  const contention = writeAccess ? fileContentionForScope(fileScope, sessionId) : { blocked: false, files: [] };
  if (contention.blocked) {
    return { eligible: false, sessionId, reason: 'file_contention', contention: contention.files };
  }

  const preferredMatches = preferredCapabilities.filter(capabilityId => byCapability.has(capabilityId));
  const requiredLevelScore = requiredCapabilities
    .map(capabilityId => byCapability.get(capabilityId)?.level ?? 0)
    .reduce((sum, value) => sum + value, 0);
  const preferredLevelScore = preferredMatches
    .map(capabilityId => byCapability.get(capabilityId)?.level ?? 0)
    .reduce((sum, value) => sum + value, 0);
  const load = sessionLoadForAssignment(sessionId);
  const retryPenalty = previousSessionId && previousSessionId === sessionId ? 15 : 0;

  const score = (requiredLevelScore * 8) + (preferredMatches.length * 6) + (preferredLevelScore * 2) - (load * 5) - retryPenalty;
  return {
    eligible: true,
    sessionId,
    capabilities,
    preferredMatches,
    load,
    score,
  };
}

export function executeRegisterWorkerCapabilities(
  {
    profileId,
    capabilities,
    availability,
    status,
    workingDir,
  },
  sessionId = 'unknown',
) {
  const sid = sessionId ?? 'unknown';
  if (!sessions[sid]) {
    return makeToolText(`Session ${sid} is not connected.`, true);
  }

  const session = sessions[sid];
  const explicitCapabilities = normalizeCapabilities(capabilities);
  const normalizedCapabilities = explicitCapabilities.length > 0
    ? explicitCapabilities
    : effectiveSessionCapabilities(session);
  session.profileId = typeof profileId === 'string' && profileId.trim() ? profileId.trim() : (session.profileId ?? session.role ?? null);
  session.capabilities = normalizedCapabilities;
  session.availability = availability === 'away' || availability === 'busy' ? availability : 'available';
  session.status = status === 'offline' || status === 'busy' ? status : 'idle';
  session.workingDir = typeof workingDir === 'string' && workingDir.trim() ? workingDir.trim() : (session.workingDir ?? null);
  session.updatedAt = Date.now();

  logSession(sid, 'register_worker_capabilities', JSON.stringify({
    profileId: session.profileId,
    capabilities: normalizedCapabilities,
    availability: session.availability,
    status: session.status,
    workingDir: session.workingDir,
  }));
  broadcast('Starlink', JSON.stringify({ sessionId: sid, profileId: session.profileId }), 'session_update');

  return makeToolText(JSON.stringify(summarizeSession(sid, session), null, 2));
}

export function executeAssignTask(input = {}, sessionId = 'unknown') {
  const validation = validateToolArgs('assign_task', input);
  if (validation.error) return validation.error;
  const { taskId, targetSessionId, agentId } = validation.args;

  const row = services.getTaskForAssignment(taskId);
  if (!row) return buildToolError('assign_task', 'not_found', `Task ${taskId} not found.`);
  if (!sessions[targetSessionId]) {
    return buildToolError(
      'assign_task',
      'not_connected',
      `Session ${targetSessionId} is not connected. Call list_sessions for active ids.`,
    );
  }

  const assignee = typeof agentId === 'string' && agentId.trim() ? agentId.trim() : targetSessionId;
  services.updateTaskAgent({ taskId, agentId: assignee });

  if (!messageQueues[targetSessionId]) messageQueues[targetSessionId] = [];
  messageQueues[targetSessionId].push({
    from: 'Supervisor',
    text: `[ASSIGNED] Task ${taskId}: ${row.title}\n${row.description ?? ''}\npayload: ${row.payload ?? '(none)'}`,
    timestamp: Date.now(),
  });

  const sid = sessionId ?? 'unknown';
  logSession(sid, 'assign_task', JSON.stringify({ taskId, targetSessionId, agentId: assignee }));
  broadcast(sid, JSON.stringify({ taskId, targetSessionId, agentId: assignee, title: row.title }), 'task_assigned');
  broadcast('Starlink', JSON.stringify({ id: taskId, agentId: assignee, status: row.status }), 'task_update');
  broadcast('Starlink', `Assigned task ${taskId} -> session ${targetSessionId} (${assignee})`);

  return buildToolSuccess(
    'assign_task',
    { status: 'assigned', taskId, targetSessionId, agentId: assignee },
    `Task ${taskId} assigned to ${assignee} (session ${targetSessionId}).`,
  );
}

export function executeAssignTaskByRequirements(
  {
    taskId,
    requiredCapabilities = [],
    preferredCapabilities = [],
    workingDir,
    fileScope = [],
    writeAccess = true,
    parallelSafe = true,
    excludeSessionIds = [],
    previousSessionId,
    agentId,
  },
  sessionId = 'unknown',
) {
  const sid = sessionId ?? 'unknown';
  const task = services.getTaskForAssignment(taskId);
  if (!task) return makeToolText(`Task ${taskId} not found.`, true);

  const required = Array.from(
    new Set(
      (Array.isArray(requiredCapabilities) ? requiredCapabilities : [])
        .map(normalizeCapabilityId)
        .filter(Boolean)
    )
  );
  if (required.length === 0) {
    return makeToolText('assign_task_by_requirements requires at least one valid required capability.', true);
  }
  const preferred = Array.from(
    new Set(
      (Array.isArray(preferredCapabilities) ? preferredCapabilities : [])
        .map(normalizeCapabilityId)
        .filter(Boolean)
        .filter(capability => !required.includes(capability))
    )
  );

  const excluded = new Set(
    (Array.isArray(excludeSessionIds) ? excludeSessionIds : [])
      .filter(value => typeof value === 'string' && value.trim())
  );

  const candidates = Object.entries(sessions)
    .filter(([candidateSessionId]) => candidateSessionId !== sid)
    .map(([candidateSessionId, session]) =>
      evaluateWorkerForRequirements(candidateSessionId, session, {
        requiredCapabilities: required,
        preferredCapabilities: preferred,
        workingDir,
        fileScope,
        writeAccess: Boolean(writeAccess),
        excludedSessionIds: excluded,
        previousSessionId: typeof previousSessionId === 'string' ? previousSessionId : null,
      })
    );

  const eligible = candidates
    .filter(candidate => candidate.eligible)
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      if (left.load !== right.load) return left.load - right.load;
      return left.sessionId.localeCompare(right.sessionId);
    });

  if (eligible.length === 0) {
    const blockedByContention = candidates.filter(candidate => candidate.reason === 'file_contention');
    if (blockedByContention.length > 0) {
      return makeToolText(
        JSON.stringify({
          status: 'queued',
          reason: 'file_contention',
          taskId,
          requiredCapabilities: required,
          blockedBy: blockedByContention.map(candidate => ({
            sessionId: candidate.sessionId,
            files: candidate.contention ?? [],
          })),
          parallelSafe: Boolean(parallelSafe),
        }, null, 2)
      );
    }

    const reasonCounts = candidates.reduce((acc, candidate) => {
      const reason = candidate.reason ?? 'unknown';
      acc[reason] = (acc[reason] ?? 0) + 1;
      return acc;
    }, {});
    return makeToolText(
      `No available worker can satisfy the assignment. Required capabilities: ${required.join(', ')}. Reason counts: ${JSON.stringify(reasonCounts)}.`,
      true
    );
  }

  const winner = eligible[0];
  const assignee = (typeof agentId === 'string' && agentId.trim()) ? agentId.trim() : winner.sessionId;
  services.updateTaskAgent({ taskId, agentId: assignee });

  if (!messageQueues[winner.sessionId]) messageQueues[winner.sessionId] = [];
  messageQueues[winner.sessionId].push({
    from: 'Supervisor',
    text:
      `[ASSIGNED] Task ${taskId}: ${task.title}\n` +
      `${task.description ?? ''}\n` +
      `requirements: ${JSON.stringify({ requiredCapabilities: required, preferredCapabilities: preferred, writeAccess: Boolean(writeAccess), fileScope, workingDir: workingDir ?? null })}\n` +
      `payload: ${task.payload ?? '(none)'}`,
    timestamp: Date.now(),
  });

  logSession(sid, 'assign_task_by_requirements', JSON.stringify({
    taskId,
    targetSessionId: winner.sessionId,
    assignee,
    requiredCapabilities: required,
    preferredCapabilities: preferred,
    writeAccess: Boolean(writeAccess),
    fileScope,
    parallelSafe: Boolean(parallelSafe),
    previousSessionId: previousSessionId ?? null,
  }));
  broadcast(sid, JSON.stringify({ taskId, targetSessionId: winner.sessionId, assignee }), 'task_assigned');
  broadcast('Starlink', JSON.stringify({ id: taskId, agentId: assignee, status: task.status }), 'task_update');

  return makeToolText(JSON.stringify({
    status: 'assigned',
    taskId,
    targetSessionId: winner.sessionId,
    assignee,
    score: winner.score,
    load: winner.load,
    matchedPreferredCapabilities: winner.preferredMatches,
    requiredCapabilities: required,
    preferredCapabilities: preferred,
  }, null, 2));
}

export function seedConnectedSession(sessionId, data = {}) {
  sessions[sessionId] = {
    ...(sessions[sessionId] ?? {}),
    ...data,
    connectedAt: sessions[sessionId]?.connectedAt ?? Date.now(),
    updatedAt: Date.now(),
  };
  return summarizeSession(sessionId, sessions[sessionId]);
}

export function seedFileLock({ filePath, agentId, sessionId = null }) {
  fileLocks[filePath] = {
    agentId,
    sessionId,
    lockedAt: Date.now(),
  };
  services.upsertFileLock({ filePath, agentId });
}

// Factory: creates a McpServer with all tools registered.
function createMcpServer(getSessionId) {
  const server = new McpServer({ name: 'starlink-mcp', version: '1.0.0' });
  const bc = (msg) => broadcast('Starlink', msg);

  // ── Project tools ──────────────────────────────────────────────────────────
  server.registerTool('list_projects', {
    title: 'List Projects',
    description: 'List all projects for the authenticated builder',
    inputSchema: {}
  }, async () => {
    bc('Listing projects');
    return { content: [{ type: 'text', text: JSON.stringify(projects.map(p => ({ id: p.id, name: p.name, description: p.description }))) }] };
  });

  server.registerTool('create_project', {
    title: 'Create Project',
    description: 'Create a new project container',
    inputSchema: { name: z.string().min(1).max(255), description: z.string().max(2000).optional() }
  }, async ({ name, description }) => {
    const project = { id: randomUUID(), name, description: description || '' };
    projects.push(project);
    bc(`Created project: ${name}`);
    return { content: [{ type: 'text', text: JSON.stringify(project) }] };
  });

  // ── Task tools ─────────────────────────────────────────────────────────────
  server.registerTool('list_tasks', {
    title: 'List Tasks',
    description: 'List all tasks. Filter by status or agent.',
    inputSchema: {
      status: z.string().optional(),
      agentId: z.string().optional(),
    }
  }, async ({ status, agentId } = {}) => {
    bc('Listing tasks');
    const tasks = services.listTasks({ status, agentId });
    return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
  });

  server.registerTool('create_task', {
    title: 'Create Task',
    description: 'Create a new task',
    inputSchema: { title: z.string(), description: z.string().optional(), agentId: z.string().optional() }
  }, async ({ title, description, agentId }) => {
    const taskId = services.createTask({ title, description: description ?? null, agentId: agentId ?? null });
    broadcast(getSessionId() ?? 'Agent', JSON.stringify({ id: taskId, title, agentId, status: 'todo' }), 'task_update');
    bc(`Created task ${taskId}`);
    return { content: [{ type: 'text', text: `Task created with id ${taskId}` }] };
  });

  server.registerTool('update_task', {
    title: 'Update Task',
    description: "Update a task's status",
    inputSchema: { taskId: z.number(), status: z.string() }
  }, async ({ taskId, status }) => {
    const info = services.updateTaskStatus({ taskId, status });
    if (info.changes === 0) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found` }] };
    broadcast(getSessionId() ?? 'Agent', JSON.stringify({ id: taskId, status }), 'task_update');
    bc(`Updated task ${taskId} (status: ${status})`);
    return { content: [{ type: 'text', text: `Task ${taskId} updated` }] };
  });

  // Phase 2: Hierarchical delegation
  server.registerTool('delegate_task', {
    title: 'Delegate Task',
    description: 'Create a subtask (optionally tagged with a semantic role). The task appears in Mission Control\'s task tree under its parent. Coordinators use this to break down work before assigning by capability requirements.',
    inputSchema: {
      title: z.string().min(1).describe('Short description of what this subtask must accomplish'),
      description: z.string().optional().describe('Detailed requirements or acceptance criteria'),
      agentId: z.string().optional().describe('Role to assign (e.g. "builder", "reviewer")'),
      parentTaskId: z.number().int().optional().describe('ID of the parent task this derives from'),
    }
  }, async ({ title, description, agentId, parentTaskId }) => {
    const sid = getSessionId() ?? 'unknown';
    const taskId = services.createTask({
      title,
      description: description ?? null,
      agentId: agentId ?? null,
      parentTaskId: parentTaskId ?? null,
      status: 'todo',
    });
    logSession(sid, 'delegate_task', JSON.stringify({ taskId, title, agentId, parentTaskId }));
    broadcast(agentId ?? sid, JSON.stringify({ id: taskId, title, agentId, parentTaskId, status: 'todo' }), 'task_update');
    bc(`Delegated task ${taskId}: "${title}" → ${agentId ?? 'unassigned'}`);
    return { content: [{ type: 'text', text: `Subtask created with id ${taskId}. Builders can claim it and call update_task when done.` }] };
  });

  server.registerTool('get_task_tree', {
    title: 'Get Task Tree',
    description: 'Returns all tasks as a nested tree showing parent→child delegation hierarchy. Call this to understand current workload and delegation status before planning.',
    inputSchema: {}
  }, async () => {
    const allTasks = services.listTaskTreeRows();
    const map = {};
    const roots = [];
    for (const t of allTasks) map[t.id] = { ...t, children: [] };
    for (const t of allTasks) {
      if (t.parent_id && map[t.parent_id]) {
        map[t.parent_id].children.push(map[t.id]);
      } else {
        roots.push(map[t.id]);
      }
    }
    return { content: [{ type: 'text', text: JSON.stringify(roots, null, 2) }] };
  });

  // Phase 1: Session history for crash recovery / reconnect continuity
  server.registerTool('get_session_history', {
    title: 'Get Session History',
    description: 'Returns recent coordination events persisted across sessions. Call this on reconnect after a crash or restart to understand what was happening — what tasks were delegated, who announced what, and which files were locked.',
    inputSchema: { limit: z.number().int().min(1).max(200).optional() }
  }, async ({ limit } = {}) => {
    const events = services.listSessionHistory({ limit: limit ?? 50 });
    if (events.length === 0) return { content: [{ type: 'text', text: 'No session history found.' }] };
    const text = events.reverse().map(e =>
      `[${e.created_at}] ${e.session_id.slice(0, 8)}… ${e.event_type}: ${e.content ?? ''}`
    ).join('\n');
    return { content: [{ type: 'text', text }] };
  });

  server.registerTool('get_task_details', {
    title: 'Get Task Details',
    description: 'Get the canonical runtime context for a mission node. Use this when you receive a NEW_TASK signal via your terminal and whenever you need the current attempt, inbox payloads, or legal next targets.',
    inputSchema: {
      missionId: z.string().describe('The active mission ID'),
      nodeId: z.string().describe('Your specific node ID in the graph')
    }
  }, async (args) => executeGetTaskDetails(args, getSessionId()));

  // ── Activation inspection ──────────────────────────────────────────────────
  // list_task_activations provides a unified view of all activation records for
  // a mission. It combines mission_node_runtime, agent_runtime_sessions, and
  // task_pushes so an adapter or coordinator can see exactly which nodes are
  // pending, acked, running, or complete without querying multiple tools.
  server.registerTool('list_task_activations', {
    title: 'List Task Activations',
    description: 'List all task activation records for a mission. Shows which nodes are pending (launched but not yet acked), acked, running, or completed. Use this to inspect the current execution state without calling get_task_details per node.',
    inputSchema: {
      missionId: z.string().describe('The mission ID to query'),
    }
  }, async ({ missionId }) => {
    const record = loadCompiledMissionRecord(missionId);
    if (!record) {
      return { isError: true, content: [{ type: 'text', text: `Mission ${missionId} not found.` }] };
    }

    const nodeRuntimes = services.listMissionNodeRuntimes(missionId);

    const activations = nodeRuntimes.map(runtime => {
      const session = runtime.attempt > 0
        ? getRuntimeSessionByAttempt(missionId, runtime.node_id, runtime.attempt)
        : null;

      const pushes = session
        ? services.listTaskPushesForSessionNode({
            sessionId: session.session_id,
            missionId,
            nodeId: runtime.node_id,
          })
        : [];

      const hasPendingPush = pushes.some(p => p.acked_at === null);

      return {
        nodeId: runtime.node_id,
        roleId: runtime.role_id,
        status: runtime.status,
        attempt: runtime.attempt,
        waveId: runtime.current_wave_id ?? null,
        lastOutcome: runtime.last_outcome ?? null,
        updatedAt: runtime.updated_at,
        mcpVisible: runtime.status !== 'idle' && runtime.status !== 'unbound',
        pendingAck: hasPendingPush,
        session: session
          ? {
              sessionId: session.session_id,
              agentId: session.agent_id,
              terminalId: session.terminal_id,
              status: session.status,
            }
          : null,
        taskPushes: pushes,
      };
    });

    const summary = {
      pending: activations.filter(a => a.status === 'launching' || a.status === 'connecting').length,
      ready: activations.filter(a => a.status === 'ready' || a.status === 'activated').length,
      running: activations.filter(a => a.status === 'running').length,
      completed: activations.filter(a => a.status === 'done' || a.status === 'completed').length,
      failed: activations.filter(a => a.status === 'failed').length,
      unbound: activations.filter(a => a.status === 'unbound').length,
    };

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          missionId,
          missionStatus: record.status,
          objective: record.mission?.task?.prompt ?? '',
          runVersion: record.mission?.metadata?.runVersion ?? 1,
          summary,
          activations,
        }, null, 2),
      }],
    };
  });

  // ── Handoff / supervisor routing ───────────────────────────────────────────
  // Phase 1: Replaces string-signal broadcasts ("INTELLIGENCE REPORT" etc.) with
  // explicit, payload-driven stage transitions. Mission Control listens for the
  // emitted 'handoff' event and advances the pipeline deterministically.
  server.registerTool('handoff_task', {
    title: 'Handoff Task',
    description: 'Hand off structured work to the next role or node in the pipeline. Creates a task row with a JSON payload and emits a handoff event that advances Mission Control. Use this when your stage is complete instead of announcing a literal phrase.',
    inputSchema: {
      fromRole: z.string().min(1).optional().describe('Your role id in legacy role-mode handoffs. Optional in graph mode if missionId/fromNodeId are provided.'),
      targetRole: z.string().min(1).optional().describe('Target role in legacy role-mode handoffs. Optional in graph mode if missionId/targetNodeId are provided.'),
      title: z.string().min(1).describe('Short summary of what is being handed off'),
      description: z.string().optional().describe('Longer notes for the receiving role'),
      payload: z.any().optional().describe('Structured data for the next role (any JSON value)'),
      completion: z.object({
        status: z.enum(['success', 'failure']).optional().describe('Structured completion status. In graph mode this is inferred from outcome when omitted.'),
        summary: z.string().optional().describe('Execution summary of this node outcome.'),
        artifactReferences: z.array(z.string()).optional().describe('Artifact references (URLs, ids, or generated outputs).'),
        filesChanged: z.array(z.string()).optional().describe('Files touched during this node execution.'),
        keyFindings: z.array(z.string()).optional().describe('Key discoveries, decisions, or facts that downstream agents should know — surfaces in upstreamContext of get_task_details.'),
        downstreamPayload: z.any().optional().describe('Explicit payload delivered to the downstream node.'),
      }).optional(),
      parentTaskId: z.number().int().optional().describe('Parent task id if this is a subtask of an existing task'),
      missionId: z.string().optional().describe('The ID of the active mission graph'),
      fromNodeId: z.string().optional().describe('Your specific node ID in the graph'),
      fromAttempt: z.number().int().positive().optional().describe('Current running attempt for fromNodeId. Required in graph mode.'),
      targetNodeId: z.string().optional().describe('The target node ID in the graph'),
      outcome: z.enum(['success', 'failure']).optional().describe('Explicit result of the current node attempt. Required in graph mode.'),
    }
  }, async (args) => executeHandoffTask(args, getSessionId() ?? 'unknown'));

  server.registerTool('complete_task', {
    title: 'Complete Task',
    description: 'Record this node completion, store structured result metadata, and activate every legal downstream node for the reported outcome. Use this when the graph should choose all matching next nodes instead of handoff_task selecting one target.',
    inputSchema: {
      missionId: z.string().describe('The active mission graph ID'),
      nodeId: z.string().describe('Your specific node ID in the graph'),
      attempt: z.number().int().positive().describe('Current running attempt for nodeId'),
      outcome: z.enum(['success', 'failure']).describe('The completed outcome for this attempt'),
      title: z.string().optional().describe('Short completion title'),
      summary: z.string().optional().describe('Result summary for Mission Control and downstream nodes'),
      rawOutput: z.string().optional().describe('Optional raw output or transcript excerpt'),
      logRef: z.string().optional().describe('Optional session log path, URL, or run id'),
      filesChanged: z.array(z.string()).optional().describe('Files touched during this node execution'),
      artifactReferences: z.array(z.string()).optional().describe('Artifact references such as URLs, ids, or generated outputs'),
      keyFindings: z.array(z.string()).optional().describe('Key discoveries, decisions, or facts from this node that downstream agents should know — surfaces in upstreamContext of get_task_details'),
      downstreamPayload: z.any().optional().describe('Payload delivered to all legal downstream nodes'),
      parentTaskId: z.number().int().optional().describe('Parent task id if this completion belongs to a delegated task'),
    }
  }, async (args) => executeCompleteTask(args, getSessionId() ?? 'unknown'));

  server.registerTool('submit_adaptive_patch', {
    title: 'Submit Adaptive Patch',
    description: 'Append new nodes/edges to an active adaptive mission graph. Patch application is append-only and guarded by runVersion.',
    inputSchema: {
      missionId: z.string().describe('Active mission ID'),
      runVersion: z.number().int().positive().describe('Expected current runVersion of the mission graph'),
      patch: z.object({
        nodes: z.array(z.object({
          id: z.string(),
          roleId: z.string(),
          instructionOverride: z.string().optional(),
          terminal: z.object({
            terminalId: z.string(),
            terminalTitle: z.string(),
            cli: z.enum(['claude', 'gemini', 'opencode', 'codex', 'custom', 'ollama', 'lmstudio']).optional(),
            paneId: z.string().optional(),
            reusedExisting: z.boolean().optional(),
          }),
        })).default([]),
        edges: z.array(z.object({
          id: z.string().optional(),
          fromNodeId: z.string(),
          toNodeId: z.string(),
          condition: z.enum(['always', 'on_success', 'on_failure']).optional(),
        })).default([]),
      }),
    }
  }, async ({ missionId, runVersion, patch }) => {
    const result = appendAdaptivePatch({ missionId, runVersion, patch });
    if (result.error) {
      return { isError: true, content: [{ type: 'text', text: result.error }] };
    }

    broadcast('adaptive', JSON.stringify({
      missionId,
      runVersion: result.runVersion,
      previousRunVersion: result.previousRunVersion,
      appendedNodeIds: result.appendedNodeIds,
      appendedEdgeCount: result.appendedEdgeCount,
      patch,
    }), 'adaptive_patch');

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          missionId,
          previousRunVersion: result.previousRunVersion,
          runVersion: result.runVersion,
          appendedNodeIds: result.appendedNodeIds,
          appendedEdgeCount: result.appendedEdgeCount,
        }, null, 2),
      }],
    };
  });

  server.registerTool('get_workflow_graph', {
    title: 'Get Workflow Graph',
    description: 'Return the workflow graph. With missionId, this returns the active compiled mission graph and, optionally, the exact legal next targets for one node. Without missionId, it returns the legacy role transition graph.',
    inputSchema: {
      missionId: z.string().optional().describe('Active mission ID for graph-mode inspection'),
      nodeId: z.string().optional().describe('Optional node ID to inspect within the active mission graph'),
    }
  }, async ({ missionId, nodeId }) => {
    if (!missionId) {
      return { content: [{ type: 'text', text: JSON.stringify(WORKFLOW_GRAPH, null, 2) }] };
    }

    const record = loadCompiledMissionRecord(missionId);
    if (!record) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Active compiled mission ${missionId} was not found.` }]
      };
    }

    const response = {
      missionId,
      graphId: record.graphId,
      status: record.status,
      nodes: record.mission.nodes,
      edges: record.mission.edges,
      task: record.mission.task,
      node: nodeId ? buildTaskDetails(missionId, nodeId)?.node ?? null : null,
      legalNextTargets: nodeId ? getLegalOutgoingTargets(record.mission, nodeId) : null,
    };
    return { content: [{ type: 'text', text: JSON.stringify(response, null, 2) }] };
  });

  // ── Phase 3: Workspace context store ───────────────────────────────────────
  // Structured key-value store shared across agents. Replaces the old pattern
  // of re-reading get_session_history on reconnect — agents write synthesized
  // facts (architecture, plan, security findings, etc.) under stable keys, and
  // downstream roles fetch exactly what they need.
  server.registerTool('update_workspace_context', {
    title: 'Update Workspace Context',
    description: 'Upsert a structured section of the shared workspace context. Use this to publish synthesized state (architecture overview, decomposed plan, security findings, test results) instead of noisy broadcasts. Value can be any JSON — object, array, or string.',
    inputSchema: {
      key: z.string().min(1).describe('Section key, e.g. "architecture", "plan", "securityReview", "testResults"'),
      value: z.any().describe('Section content. Objects/arrays are JSON-stringified server-side.'),
      updatedBy: z.string().optional().describe('Agent id / role of the writer (defaults to session id)'),
    }
  }, async ({ key, value, updatedBy }) => {
    const sid = getSessionId() ?? 'unknown';
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    services.upsertWorkspaceContext({ key, value: serialized, updatedBy: updatedBy ?? sid });
    broadcast(updatedBy ?? sid, JSON.stringify({ key }), 'workspace_context_update');
    bc(`Context updated: ${key}`);
    return { content: [{ type: 'text', text: `Workspace context[${key}] updated.` }] };
  });

  server.registerTool('get_workspace_context', {
    title: 'Get Workspace Context',
    description: 'Returns the synthesized workspace state as a JSON object keyed by section. Prefer this over get_session_history for onboarding into an in-progress workflow — it is denser and stays current.',
    inputSchema: {
      keys: z.array(z.string()).optional().describe('Optional subset of section keys to return. Omit for all.'),
    }
  }, async ({ keys } = {}) => {
    const rows = services.listWorkspaceContext(keys);
    if (rows.length === 0) return { content: [{ type: 'text', text: 'Workspace context is empty.' }] };
    const parsed = {};
    for (const r of rows) {
      let value = r.value;
      try { value = JSON.parse(r.value); } catch { /* leave as string */ }
      parsed[r.key] = { value, updatedBy: r.updated_by, updatedAt: r.updated_at };
    }
    return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
  });

  server.registerTool('assign_task', {
    title: 'Assign Task',
    description: "Explicit pinning path: bind an existing task to one specific agent session. Prefer assign_task_by_requirements for default capability-based routing; use this when exact ownership must be forced.",
    inputSchema: {
      taskId: z.number().int().describe('ID of the task to assign (from delegate_task or handoff_task)'),
      targetSessionId: z.string().min(1).describe('Session id of the agent instance that should own this task'),
      agentId: z.string().optional().describe('Optional friendly name of the assignee (role id or instance name)'),
    }
  }, async (args) => executeAssignTask(args, getSessionId() ?? 'unknown'));

  server.registerTool('assign_task_by_requirements', {
    title: 'Assign Task By Requirements',
    description: 'Capability-based assignment policy. Picks the best available worker by required/preferred capabilities, load, and file contention.',
    inputSchema: {
      taskId: z.number().int().describe('ID of the task to assign'),
      requiredCapabilities: z.array(z.enum(['planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution']))
        .min(1)
        .describe('Capabilities that must be present on the selected worker'),
      preferredCapabilities: z.array(z.enum(['planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution']))
        .optional()
        .describe('Optional capabilities used for tie-breaking'),
      workingDir: z.string().optional().describe('Optional required working directory affinity'),
      fileScope: z.array(z.string()).optional().describe('Paths relevant to this task; used for lock contention checks'),
      writeAccess: z.boolean().optional().describe('Whether write access is required (default true)'),
      parallelSafe: z.boolean().optional().describe('Whether this task may run in parallel with related tasks (default true)'),
      excludeSessionIds: z.array(z.string()).optional().describe('Sessions to exclude (retry/reassignment safety)'),
      previousSessionId: z.string().optional().describe('Prior assignee session to penalize on retry'),
      agentId: z.string().optional().describe('Optional display assignee id for tasks table'),
    }
  }, async (args) => executeAssignTaskByRequirements(args, getSessionId() ?? 'unknown'));

  // ── Agent tools ────────────────────────────────────────────────────────────
  server.registerTool('list_agents', {
    title: 'List Agents',
    description: 'List all agents configured for a project',
    inputSchema: { projectId: z.string().uuid() }
  }, async ({ projectId }) => {
    bc(`Listing agents for project ${projectId}`);
    const filteredAgents = agents.filter(a => a.projectId === projectId);
    return { content: [{ type: 'text', text: JSON.stringify(filteredAgents.map(a => ({ id: a.id, name: a.name, systemPrompt: a.systemPrompt }))) }] };
  });

  server.registerTool('create_agent', {
    title: 'Create Agent',
    description: 'Create a new agent with a custom system prompt, scoped to a project',
    inputSchema: { projectId: z.string().uuid(), name: z.string().min(1).max(255), systemPrompt: z.string().min(1).max(100000) }
  }, async ({ projectId, name, systemPrompt }) => {
    const agent = { id: randomUUID(), projectId, name, systemPrompt, createdAt: Date.now(), updatedAt: Date.now() };
    agents.push(agent);
    bc(`Created agent: ${name}`);
    return { content: [{ type: 'text', text: JSON.stringify(agent) }] };
  });

  server.registerTool('delete_agent', {
    title: 'Delete Agent',
    description: 'Delete an agent',
    inputSchema: { agentId: z.string().uuid() }
  }, async ({ agentId }) => {
    const index = agents.findIndex(a => a.id === agentId);
    if (index === -1) return { isError: true, content: [{ type: 'text', text: `Agent ${agentId} not found` }] };
    agents.splice(index, 1);
    bc(`Deleted agent ${agentId}`);
    return { content: [{ type: 'text', text: `Agent ${agentId} deleted` }] };
  });

  // ── File locking ───────────────────────────────────────────────────────────
  server.registerTool('lock_file', {
    title: 'Lock File',
    description: 'Claim exclusive write access to a file path. If another agent holds the lock, you are automatically placed in the wait queue — do NOT poll. When the lock is released the server grants it to you and delivers a [LOCK GRANTED] message to your inbox. While queued, work on other unlocked files. Always call unlock_file when done.',
    inputSchema: {
      filePath: z.string().min(1),
      missionId: z.string().optional().describe('Graph mode owner mission ID'),
      nodeId: z.string().optional().describe('Graph mode owner node ID'),
      agentId: z.string().min(1).optional().describe('Legacy owner identifier when mission/node is absent'),
    }
  }, async ({ filePath, missionId, nodeId, agentId }) => {
    const sid = getSessionId();
    const graphScoped = Boolean(missionId || nodeId);
    if (graphScoped && (!missionId || !nodeId)) {
      return { isError: true, content: [{ type: 'text', text: 'Graph-mode lock_file requires both missionId and nodeId.' }] };
    }
    const ownerId = graphScoped
      ? `mission:${missionId}:node:${nodeId}`
      : (agentId?.trim() ?? '');
    if (!ownerId) {
      return { isError: true, content: [{ type: 'text', text: 'lock_file requires missionId/nodeId in graph mode or agentId in legacy mode.' }] };
    }

    const persisted = services.getPersistedFileLock(filePath);
    if (persisted && !fileLocks[filePath]) {
      fileLocks[filePath] = { agentId: persisted.agent_id, sessionId: null, lockedAt: Date.now() };
    }
    const existing = fileLocks[filePath];

    if (!existing) {
      fileLocks[filePath] = { agentId: ownerId, sessionId: sid, lockedAt: Date.now() };
      services.upsertFileLock({ filePath, agentId: ownerId });
      bc(`Lock acquired: ${filePath} by ${ownerId}`);
      broadcast('Starlink', 'lock_update', 'lock_update');
      return { content: [{ type: 'text', text: `Lock acquired: ${filePath}` }] };
    }

    if (existing.agentId === ownerId) {
      return { content: [{ type: 'text', text: `Lock already held by you: ${filePath}` }] };
    }

    // Contention — enqueue unless this session is already waiting.
    if (!fileWaitQueues[filePath]) fileWaitQueues[filePath] = [];
    const queue = fileWaitQueues[filePath];
    const alreadyQueued = queue.some(w => w.sessionId === sid);
    if (!alreadyQueued) {
      queue.push({ ownerId, sessionId: sid, queuedAt: Date.now() });
    }
    const position = queue.findIndex(w => w.sessionId === sid) + 1;

    // Give the current owner visibility so they don't hold the lock longer than needed.
    if (existing.sessionId && sessions[existing.sessionId]) {
      if (!messageQueues[existing.sessionId]) messageQueues[existing.sessionId] = [];
      messageQueues[existing.sessionId].push({
        from: 'Starlink',
        text: `Agent "${ownerId}" is queued for your lock on: ${filePath} (queue depth ${queue.length}). Release when done.`,
        timestamp: Date.now(),
      });
    }
    bc(`Lock queued: ${filePath} for ${ownerId} (pos ${position})`);
    return { content: [{ type: 'text', text: `Locked by "${existing.agentId}". You are queued at position ${position} on ${filePath}. The lock will be granted automatically when released — do not poll. Watch your inbox for a [LOCK GRANTED] message.` }] };
  });

  server.registerTool('unlock_file', {
    title: 'Unlock File',
    description: 'Release a file lock. If any agents are queued, the next live waiter is auto-granted the lock and notified. Only the agent that owns the lock can unlock it.',
    inputSchema: {
      filePath: z.string().min(1),
      missionId: z.string().optional().describe('Graph mode owner mission ID'),
      nodeId: z.string().optional().describe('Graph mode owner node ID'),
      agentId: z.string().min(1).optional().describe('Legacy owner identifier when mission/node is absent'),
    }
  }, async ({ filePath, missionId, nodeId, agentId }) => {
    const graphScoped = Boolean(missionId || nodeId);
    if (graphScoped && (!missionId || !nodeId)) {
      return { isError: true, content: [{ type: 'text', text: 'Graph-mode unlock_file requires both missionId and nodeId.' }] };
    }
    const ownerId = graphScoped
      ? `mission:${missionId}:node:${nodeId}`
      : (agentId?.trim() ?? '');
    if (!ownerId) {
      return { isError: true, content: [{ type: 'text', text: 'unlock_file requires missionId/nodeId in graph mode or agentId in legacy mode.' }] };
    }

    const persisted = services.getPersistedFileLock(filePath);
    if (persisted && !fileLocks[filePath]) {
      fileLocks[filePath] = { agentId: persisted.agent_id, sessionId: null, lockedAt: Date.now() };
    }
    const existing = fileLocks[filePath];
    if (!existing) return { content: [{ type: 'text', text: `${filePath} was not locked.` }] };
    if (existing.agentId !== ownerId) {
      return { isError: true, content: [{ type: 'text', text: `Cannot unlock: owned by "${existing.agentId}".` }] };
    }
    delete fileLocks[filePath];
    services.deleteFileLock(filePath);
    bc(`Lock released: ${filePath} by ${ownerId}`);

    // Auto-grant to the next live waiter. Skip waiters whose session has gone away.
    const queue = fileWaitQueues[filePath] ?? [];
    let granted = null;
    while (queue.length > 0) {
      const next = queue.shift();
      if (!sessions[next.sessionId]) continue;
      fileLocks[filePath] = { agentId: next.ownerId, sessionId: next.sessionId, lockedAt: Date.now() };
      services.upsertFileLock({ filePath, agentId: next.ownerId });
      if (!messageQueues[next.sessionId]) messageQueues[next.sessionId] = [];
      messageQueues[next.sessionId].push({
        from: 'Starlink',
        text: `[LOCK GRANTED] You now hold the lock on ${filePath}. Proceed with your edits. Call unlock_file when done.`,
        timestamp: Date.now(),
      });
      granted = next;
      bc(`Lock auto-granted: ${filePath} → ${next.ownerId}`);
      break;
    }
    if (queue.length === 0) delete fileWaitQueues[filePath];

    broadcast('Starlink', 'lock_update', 'lock_update');

    const tail = granted ? ` Auto-granted to "${granted.ownerId}".` : '';
    return { content: [{ type: 'text', text: `Lock released: ${filePath}.${tail}` }] };
  });

  server.registerTool('get_file_locks', {
    title: 'Get File Locks',
    description: 'List all currently locked files, who holds them, and when they were locked.',
    inputSchema: {}
  }, async () => {
    const rows = services.listFileLocks();
    if (rows.length === 0) return { content: [{ type: 'text', text: 'No files currently locked.' }] };
    const text = rows.map(row =>
      `${row.file_path}\n  owner: ${row.agent_id}\n  since: ${row.locked_at}`
    ).join('\n\n');
    return { content: [{ type: 'text', text }] };
  });

  // ── Session / messaging ────────────────────────────────────────────────────
  server.registerTool('connect_agent', {
    title: 'Connect Agent',
    description: 'Legacy metadata tool. Announces presence to other sessions. Graph-mode activation no longer depends on this call.',
    inputSchema: {
      role: z.string().describe('Your assigned role (e.g. Coordinator, Scout, Builder, Reviewer)'),
      agentId: z.string().describe('A friendly name for your agent instance'),
      terminalId: z.string().optional().describe('Terminal pane ID in CometAI, if known'),
      cli: z.enum(['claude', 'gemini', 'opencode', 'codex', 'custom', 'ollama', 'lmstudio']).optional().describe('CLI running in that terminal'),
      profileId: z.string().optional().describe('Optional worker profile label (for example "reviewer_profile")'),
      capabilities: z.array(z.union([
        z.enum(['planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution']),
        z.object({
          id: z.enum(['planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution']),
          level: z.number().int().min(0).max(3).optional(),
          verifiedBy: z.enum(['profile', 'runtime']).optional(),
        }),
      ])).optional().describe('Optional explicit capability set for this worker session'),
      workingDir: z.string().optional().describe('Optional default working directory for assignment affinity'),
    }
  }, async ({ role, agentId, terminalId, cli, profileId, capabilities, workingDir }) =>
    executeConnectAgent({ role, agentId, terminalId, cli, profileId, capabilities, workingDir }, getSessionId() ?? 'unknown')
  );

  server.registerTool('register_worker_capabilities', {
    title: 'Register Worker Capabilities',
    description: 'Update your session capability profile for capability-based delegation.',
    inputSchema: {
      profileId: z.string().optional().describe('Optional profile id/label for this worker'),
      capabilities: z.array(z.union([
        z.enum(['planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution']),
        z.object({
          id: z.enum(['planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution']),
          level: z.number().int().min(0).max(3).optional(),
          verifiedBy: z.enum(['profile', 'runtime']).optional(),
        }),
      ])).optional().describe('Capability entries for this worker'),
      availability: z.enum(['available', 'busy', 'away']).optional().describe('Whether this worker can receive new assignments'),
      status: z.enum(['idle', 'busy', 'offline']).optional().describe('Current session status'),
      workingDir: z.string().optional().describe('Default working directory for assignment affinity'),
    }
  }, async (args) => executeRegisterWorkerCapabilities(args, getSessionId() ?? 'unknown'));

  // ── Adapter lifecycle ──────────────────────────────────────────────────────
  // These two tools are called by the Terminal Docks-owned runtime adapter,
  // NOT by the AI CLI. The adapter is the reliable worker; the CLI is just the
  // tool the adapter drives.

  server.registerTool('register_adapter', {
    title: 'Register Adapter',
    description: 'Called by the Terminal Docks runtime adapter to register itself with MCP. Must be called before ack_task_activation. The adapter (not the AI CLI) is the reliable worker from Mission Control\'s perspective.',
    inputSchema: {
      sessionId: z.string().min(1).describe('The adapter session ID (matches agent_runtime_sessions.session_id written by Mission Control)'),
      terminalId: z.string().min(1).describe('Terminal/pane ID the adapter is attached to'),
      nodeId: z.string().min(1).describe('Graph node ID this adapter is responsible for'),
      missionId: z.string().min(1).describe('Active mission ID'),
      role: z.string().min(1).describe('Role this adapter is fulfilling (e.g. builder, reviewer)'),
      cli: z.enum(['claude', 'gemini', 'opencode', 'codex', 'custom', 'generic', 'ollama', 'lmstudio']).describe('CLI type the adapter will drive'),
      cwd: z.string().optional().describe('Working directory for the CLI process'),
    }
  }, async ({ sessionId, terminalId, nodeId, missionId, role, cli, cwd }) => {
    const adapterId = `adapter:${missionId}:${nodeId}:${sessionId}`;

    services.upsertAdapterRegistration({ adapterId, sessionId, terminalId, nodeId, missionId, role, cli, cwd: cwd ?? null });

    // Update the runtime session status so Mission Control sees the adapter is live.
    services.updateRuntimeSessionStatus({ sessionId, status: 'registered' });

    emitAgentEvent({
      type: 'agent:ready',
      sessionId,
      at: Date.now(),
      missionId,
      nodeId,
      role,
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          adapterId,
          sessionId,
          missionId,
          nodeId,
          role,
          cli,
          lifecycle: 'registered',
          message: 'Adapter registered. Call ack_task_activation once the CLI is ready to receive the task.',
        }, null, 2),
      }],
    };
  });

  server.registerTool('ack_task_activation', {
    title: 'Acknowledge Task Activation',
    description: 'Called by the Terminal Docks runtime adapter to acknowledge receipt of a task activation before sending work to the CLI. This ACK is Terminal Docks-owned — it does NOT mean the AI model finished the task. It means the adapter received the activation and is about to drive the CLI.',
    inputSchema: {
      sessionId: z.string().min(1).describe('The adapter session ID'),
      missionId: z.string().min(1).describe('Active mission ID'),
      nodeId: z.string().min(1).describe('Graph node ID being acknowledged'),
      attempt: z.number().int().positive().describe('Current attempt number for this node'),
      taskSeq: z.number().int().positive().describe('Task sequence number from the activation push record'),
    }
  }, async ({ sessionId, missionId, nodeId, attempt, taskSeq }) => {
    const now = new Date().toISOString().replace('T', ' ').slice(0, 19);

    const acked = services.ackTaskPush({ sessionId, missionId, nodeId, taskSeq });

    const adapterId = `adapter:${missionId}:${nodeId}:${sessionId}`;
    services.updateAdapterLifecycle({ adapterId, lifecycle: 'task_acked' });

    services.updateRuntimeSessionStatus({ sessionId, status: 'activated', missionId, nodeId, attempt });

    emitAgentEvent({
      type: 'activation:acked',
      sessionId,
      missionId,
      nodeId,
      attempt,
      taskSeq,
      at: Date.now(),
    });

    return {
      content: [{
        type: 'text',
        text: JSON.stringify({
          acked,
          sessionId,
          missionId,
          nodeId,
          attempt,
          taskSeq,
          lifecycle: 'task_acked',
          message: acked
            ? 'Task activation acknowledged. The adapter may now send the task prompt to the CLI.'
            : 'Task push record was already acknowledged or not found. Proceeding.',
        }, null, 2),
      }],
    };
  });

  server.registerTool('get_collaboration_protocol', {
    title: 'Get Collaboration Protocol',
    description: 'Returns SOP guidance. In graph mode this is optional informational guidance, not a runtime prerequisite.',
    inputSchema: {}
  }, async () => {
    return {
      content: [{
        type: 'text',
        text: `# Team Collaboration Protocol

You are part of a multi-agent team (Claude, Gemini, OpenCode, or other CLIs) working on a shared codebase via the CometAI Starlink. Follow this protocol to avoid conflicts and collaborate effectively.

## On Session Start
1. Call \`get_file_locks()\` — see what files teammates currently own.
2. Call \`receive_messages({ missionId, nodeId })\` in graph mode, or \`receive_messages()\` in legacy mode.
3. Call \`get_session_history()\` — if reconnecting after a crash, see what was happening.
4. Call \`read_resource("roster://agents")\` — understand your team's roles.
5. Call \`announce({ message: "Online as <role>. Starting: <task>", agentId: "<your-id>" })\`.

## Before Editing Any File
1. Call \`lock_file({ filePath: "<path>", agentId: "<your-id>" })\`.
   - On conflict the server auto-queues you and returns "queued at position N". Do NOT poll. Work on other unlocked files and watch your inbox for a \`[LOCK GRANTED]\` message — when you receive it you already hold the lock, proceed immediately.
2. Make your changes using your CLI's native file tools.
3. Call \`unlock_file({ filePath: "<path>", agentId: "<your-id>" })\` — this auto-grants the lock to the next waiter in the queue.
4. Call \`announce({ message: "Done with <path>: <summary of changes>", agentId: "<your-id>" })\`.

## Shared Workspace Context (prefer over session history)
- Write synthesized state with \`update_workspace_context({ key, value })\` — e.g. "architecture", "plan", "securityReview", "testResults".
- Read it with \`get_workspace_context()\` or \`get_workspace_context({ keys: ["plan"] })\`. Prefer this to \`get_session_history\`; it is denser and stays current.

## Stage Handoffs (every role)
- In graph mode, treat \`get_task_details({ missionId, nodeId })\` as the canonical source of your current node context. It tells you your attempt number, inbox payloads, and the exact legal next targets for this node.
- In graph mode, when your stage is done, prefer \`complete_task({ missionId, nodeId, attempt, outcome, summary, filesChanged?, artifactReferences?, downstreamPayload? })\`. MCP records your completion and activates every legal downstream node for that outcome.
- Use \`handoff_task({ missionId, fromNodeId, fromAttempt, targetNodeId, outcome, title, description?, payload?, parentTaskId? })\` only when you intentionally need to route to one exact target node.
- In legacy role-mode, call \`handoff_task({ fromRole, targetRole, title, description?, payload?, parentTaskId? })\`.
- Do NOT announce literal phrases like "INTELLIGENCE REPORT" — Mission Control routes strictly on handoff_task events now.
- The payload field is free-form JSON: include whatever structured context the next stage needs (file paths, findings, decisions, error diffs, etc.). Keep it compact.

## Delegation (Coordinator role)
- Call \`get_task_tree()\` to see current workload before assigning new work.
- Call \`delegate_task({ title, description, parentTaskId })\` to create subtasks.
- Default assignment path: call \`assign_task_by_requirements({ taskId, requiredCapabilities, preferredCapabilities?, fileScope?, writeAccess? })\` so the scheduler picks the best available worker automatically.
- Use \`list_sessions({ detailed: true })\` to inspect live worker capability profiles and availability.
- Use explicit \`assign_task({ taskId, targetSessionId, agentId })\` only when you must pin ownership to one exact session.
- After routing is done, use the graph-mode or legacy handoff format above to release the next stage. In graph mode you must hand off to an exact target node, not just a role.
- Builders should call \`update_task({ taskId, status: "in-progress" })\` when starting and \`update_task({ taskId, status: "done" })\` when complete.
- All task changes appear in Mission Control's task tree in real time.

## Inter-Agent Communication
- \`list_sessions()\` — discover active session IDs.
- \`send_message({ targetSessionId, message })\` — direct message to one session.
- \`announce({ message, agentId })\` — broadcast to all sessions at once.
- \`receive_messages({ missionId, nodeId, afterSeq?, ackThroughSeq? })\` — deterministic node-scoped inbox reads in graph mode.

## Publishing Results
When your work produces something the user should see, call \`publish_result\`:
- Completed summaries, decisions, instructions → \`type: "markdown"\`
- A running web server the user can preview → \`type: "url", content: "http://localhost:5173"\`
The Mission Control panel displays published results in real time.

## General Rules
- Never edit a file without a lock.
- Always unlock promptly — don't hold locks while idle.
- Broadcast progress at meaningful milestones so teammates can plan around your work.
- If blocked on a lock, send a direct message to the owner rather than polling.`
      }]
    };
  });

  server.registerTool('get_session_id', {
    title: 'Get Session ID',
    description: 'Returns the session ID of this instance.',
    inputSchema: {}
  }, async () => {
    const sid = getSessionId() ?? 'unknown';
    return { content: [{ type: 'text', text: sid }] };
  });

  server.registerTool('list_runtime_sessions', {
    title: 'List Runtime Sessions',
    description: 'Supervisor control-plane query for persisted runtime sessions. Use list_sessions for currently connected MCP peers.',
    inputSchema: {
      missionId: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }
  }, async (args = {}) => executeListRuntimeSessions(args));

  server.registerTool('list_agent_runs', {
    title: 'List Agent Runs',
    description: 'Supervisor control-plane query for persisted headless/agent run records.',
    inputSchema: {
      missionId: z.string().optional(),
      status: z.string().optional(),
      limit: z.number().int().min(1).max(200).optional(),
    }
  }, async (args = {}) => executeListAgentRuns(args));

  server.registerTool('inspect_agent_run', {
    title: 'Inspect Agent Run',
    description: 'Supervisor control-plane query for one persisted headless/agent run record by runId.',
    inputSchema: {
      runId: z.string().min(1),
    }
  }, async (args = {}) => executeInspectAgentRun(args));

  server.registerTool('list_sessions', {
    title: 'List Sessions',
    description: 'List connected sessions. Use detailed=true to inspect profile/capability metadata.',
    inputSchema: {
      detailed: z.boolean().optional().describe('Return full session metadata instead of only IDs'),
      capability: z.enum(['planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution']).optional()
        .describe('Optional capability filter for detailed output'),
    }
  }, async ({ detailed, capability } = {}) => {
    const mySid = getSessionId();
    const ids = Object.keys(sessions).filter(id => id !== mySid);
    if (ids.length === 0) return { content: [{ type: 'text', text: 'No other sessions connected.' }] };
    if (!detailed) {
      return { content: [{ type: 'text', text: ids.join('\n') }] };
    }

    const rows = ids
      .map(id => summarizeSession(id, sessions[id]))
      .filter(entry => (capability ? entry.capabilities.some(item => item.id === capability) : true));
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });

  server.registerTool('send_message', {
    title: 'Send Message',
    description: 'Send a message to another agent session or node.',
    inputSchema: {
      targetSessionId: z.string().min(1).optional(),
      targetNodeId: z.string().optional(),
      missionId: z.string().optional().describe('Required when targetNodeId is provided.'),
      message: z.string().min(1)
    }
  }, async (args) => executeSendMessage(args, getSessionId() ?? 'unknown'));

  server.registerTool('receive_messages', {
    title: 'Receive Messages',
    description: 'Read pending messages. In graph mode use mission/node-scoped reads with sequence IDs and explicit acknowledgements.',
    inputSchema: {
      missionId: z.string().optional().describe('Active mission ID (required for graph-mode deterministic reads).'),
      nodeId: z.string().optional().describe('Your specific node ID in the graph (required with missionId).'),
      afterSeq: z.number().int().min(0).optional().describe('Only return messages with sequence id > afterSeq.'),
      ackThroughSeq: z.number().int().positive().optional().describe('Mark messages up to this sequence as read for mission/node.')
    }
  }, async ({ missionId, nodeId, afterSeq, ackThroughSeq }) =>
    executeReceiveMessages({ missionId, nodeId, afterSeq, ackThroughSeq }, getSessionId())
  );

  server.registerTool('publish_result', {
    title: 'Publish Result',
    description: 'Publish work output to the Mission Control result panel.',
    inputSchema: {
      content: z.string().min(1),
      type: z.enum(['markdown', 'url']).default('markdown'),
      agentId: z.string().optional(),
      missionId: z.string().optional(),
      nodeId: z.string().optional(),
      attempt: z.number().int().positive().optional(),
      outcome: z.enum(['success', 'failure']).optional(),
      label: z.string().optional().describe('Short label for the artifact list'),
    }
  }, async ({ content, type, agentId, missionId, nodeId, attempt, outcome, label }) => {
    const sid = getSessionId();
    broadcast(agentId ?? sid ?? 'Agent', content, `result:${type}`);
    
    if (sid && missionId && nodeId) {
      if (type === 'markdown') {
        emitAgentEvent({
          type: 'agent:artifact',
          sessionId: sid,
          at: Date.now(),
          missionId,
          nodeId,
          attempt: attempt ?? 1,
          artifactType: 'summary',
          label: label ?? 'Summary',
          content: content.slice(0, 200) + (content.length > 200 ? '...' : ''),
        });
      } else if (type === 'url') {
        emitAgentEvent({
          type: 'agent:artifact',
          sessionId: sid,
          at: Date.now(),
          missionId,
          nodeId,
          attempt: attempt ?? 1,
          artifactType: 'reference',
          label: label ?? 'Preview URL',
          content: content,
        });
      }

      emitAgentEvent({
        type: 'task:completed',
        sessionId: sid,
        missionId,
        nodeId,
        attempt: Number.isInteger(attempt) ? attempt : null,
        outcome: outcome ?? 'success',
        at: Date.now(),
      });
    }
    return { content: [{ type: 'text', text: 'Result published to Mission Control.' }] };
  });

  server.registerTool('report_artifact', {
    title: 'Report Artifact',
    description: 'Report a created or modified artifact (file, summary, or reference) during node execution for real-time progress surfacing.',
    inputSchema: {
      missionId: z.string().min(1),
      nodeId: z.string().min(1),
      attempt: z.number().int().positive(),
      artifactType: z.enum(['file_change', 'summary', 'reference']),
      label: z.string().min(1).describe('A short, descriptive label (e.g. filename or section title)'),
      content: z.string().optional().describe('Optional content for summaries or small files'),
      path: z.string().optional().describe('Optional file path for file_change artifacts'),
    }
  }, async ({ missionId, nodeId, attempt, artifactType, label, content, path }) => {
    const sid = getSessionId();
    const event = {
      type: 'agent:artifact',
      sessionId: sid ?? 'unknown',
      at: Date.now(),
      missionId,
      nodeId,
      attempt,
      artifactType,
      label,
      content,
      path,
    };
    
    emitAgentEvent(event);
    
    // Also broadcast so UI can pick it up via mcp-message event
    broadcast(nodeId, JSON.stringify(event), 'artifact');
    
    return { content: [{ type: 'text', text: `Artifact "${label}" reported.` }] };
  });

  server.registerTool('announce', {
    title: 'Announce',
    description: 'Broadcast a status message to all other connected sessions and the Mission Control orchestrator.',
    inputSchema: { message: z.string().min(1), agentId: z.string().optional() }
  }, async ({ message, agentId: rawAgentId }) => {
    const sid = getSessionId();
    const agentId = rawAgentId || sid || 'agent';
    logSession(sid ?? 'unknown', 'announce', `${agentId}: ${message}`);
    const targets = Object.keys(sessions).filter(id => id !== sid);
    const ts = Date.now();
    for (const targetSid of targets) {
      if (!messageQueues[targetSid]) messageQueues[targetSid] = [];
      messageQueues[targetSid].push({ from: agentId, text: `[BROADCAST] ${message}`, timestamp: ts });
    }
    bc(`Broadcast from ${agentId}: ${message}`);
    return { content: [{ type: 'text', text: `Broadcast sent to ${targets.length} session(s).` }] };
  });

  // ── MCP Prompt ─────────────────────────────────────────────────────────────
  server.registerPrompt('collaboration_protocol', {
    title: 'Team Collaboration Protocol',
    description: 'Standard operating procedure for multi-agent collaboration. Read this at the start of every session.',
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `# Team Collaboration Protocol\n\nCall get_collaboration_protocol() for the full SOP.`,
      },
    }],
  }));

  // ── MCP Resources ──────────────────────────────────────────────────────────
  server.registerResource('agent_roster', 'roster://agents', {
    title: 'Agent Roster',
    description: 'Team roster: defined agent roles, responsibilities, and prompt templates.',
    mimeType: 'application/json',
  }, async () => ({
    contents: [{
      uri: 'roster://agents',
      mimeType: 'application/json',
      text: JSON.stringify(loadAgentRoster(), null, 2),
    }],
  }));

  server.registerResource('active_sessions', 'sessions://live', {
    title: 'Active Sessions',
    description: 'Currently connected agent session IDs.',
    mimeType: 'application/json',
  }, async () => ({
    contents: [{
      uri: 'sessions://live',
      mimeType: 'application/json',
      text: JSON.stringify(Object.keys(sessions), null, 2),
    }],
  }));

  return server;
}

// ── Express app ───────────────────────────────────────────────────────────────
const app = express();
app.use(cors());
app.use(express.json());

const authToken = process.env.MCP_AUTH_TOKEN;
const internalPushToken = process.env.MCP_INTERNAL_PUSH_TOKEN;

app.use((req, res, next) => {
  if (req.path === '/health') return next();
  if (req.path === '/events/session') return next();
  // /internal/push uses its own token scheme — skip the general auth layer
  // so a missing MCP_AUTH_TOKEN doesn't accidentally gate local pushes.
  if (req.path.startsWith('/internal/')) return next();
  // Streamable HTTP MCP clients pass the token on the initial POST URL, then
  // use mcp-session-id for subsequent GET/POST/DELETE requests.
  if (req.path === '/mcp' && req.headers['mcp-session-id']) return next();
  const token = req.query.token || req.headers.authorization?.replace('Bearer ', '');
  if (authToken && token !== authToken) {
    return res.status(401).send('Unauthorized');
  }
  next();
});

app.get('/health', (_req, res) => res.json({ ok: true, port: PORT }));

app.get('/locks', (_req, res) => res.json(fileLocks));

app.get('/sessions', (_req, res) => res.json(Object.keys(sessions)));

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  broadcast('Starlink', 'Client connected to activity feed', 'status');
  req.on('close', () => { clients.delete(res); });
});

// Phase C: per-session typed event stream consumed by WorkerAdapters.
app.get('/events/session', (req, res) => {
  const sid = String(req.query.sid || '');
  if (!sid) return res.status(400).send('Missing sid');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const since = Number.parseInt(String(req.query.since || '0'), 10);
  if (Number.isFinite(since) && since > 0) {
    for (const ev of recentAgentEvents) {
      if (ev.sessionId === sid && (ev.at ?? 0) > since) {
        res.write(`data: ${JSON.stringify(ev)}\n\n`);
      }
    }
  }

  const send = ev => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  const channel = `sid:${sid}`;
  agentEvents.on(channel, send);

  const keepalive = setInterval(() => { res.write(': keepalive\n\n'); }, 15000);
  req.on('close', () => {
    agentEvents.off(channel, send);
    clearInterval(keepalive);
  });
});

// Phase C: privileged loopback endpoint used by the Tauri process to record
// task pushes with idempotency. Never called by agents; token passed via env.
app.post('/internal/push', async (req, res) => {
  const presented = req.headers['x-td-push-token'];
  if (!internalPushToken) {
    return res.status(503).json({ error: 'Internal push token not configured' });
  }
  if (presented !== internalPushToken) {
    return res.status(401).json({ error: 'Bad push token' });
  }

  const body = req.body ?? {};
  if (body.type === 'task_pushed') {
    const record = recordTaskPush({
      sessionId: body.sessionId,
      missionId: body.missionId,
      nodeId: body.nodeId,
      taskSeq: body.taskSeq,
      attempt: Number.isInteger(body.attempt) ? body.attempt : null,
    });
    if (record.inserted) {
      emitAgentEvent({
        type: 'task:pushed',
        sessionId: body.sessionId,
        missionId: body.missionId,
        nodeId: body.nodeId,
        taskSeq: body.taskSeq,
        attempt: Number.isInteger(body.attempt) ? body.attempt : null,
        at: Date.now(),
      });
    }
    return res.json({ recorded: record.inserted, reason: record.reason ?? null });
  }

  if (body.type === 'bootstrap') {
    emitAgentEvent({
      type: 'bootstrap:requested',
      sessionId: body.sessionId,
      at: Date.now(),
    });
    return res.json({ ok: true });
  }

  if (body.type === 'runtime_bootstrap') {
    emitAgentEvent({
      type: 'bootstrap:requested',
      sessionId: body.sessionId,
      missionId: body.missionId,
      nodeId: body.nodeId,
      attempt: Number.isInteger(body.attempt) ? body.attempt : null,
      at: Date.now(),
    });

    const result = executeRuntimeBootstrapRegistration({
      sessionId: body.sessionId,
      missionId: body.missionId,
      nodeId: body.nodeId,
      attempt: Number(body.attempt),
      role: body.role,
      profileId: body.profileId,
      agentId: body.agentId,
      terminalId: body.terminalId,
      cli: body.cli,
      capabilities: body.capabilities,
      workingDir: body.workingDir,
      activationId: body.activationId ?? null,
      runId: body.runId ?? null,
      executionMode: body.executionMode ?? null,
    });

    if (!result.ok) {
      return res.status(409).json(result);
    }
    return res.json(result);
  }

  if (body.type === 'runtime_task_acked') {
    const sessionId = String(body.sessionId ?? '');
    const missionId = String(body.missionId ?? '');
    const nodeId = String(body.nodeId ?? '');
    const attempt = Number(body.attempt);
    const taskSeq = Number(body.taskSeq ?? body.attempt);
    if (!sessionId || !missionId || !nodeId || !Number.isInteger(attempt) || attempt < 1 || !Number.isInteger(taskSeq) || taskSeq < 1) {
      return res.status(400).json({ error: 'runtime_task_acked requires sessionId, missionId, nodeId, positive attempt, and positive taskSeq' });
    }
    services.ackTaskPush({ sessionId, missionId, nodeId, taskSeq });
    services.updateRuntimeSessionStatus({ sessionId, status: 'activated', missionId, nodeId, attempt });
    emitAgentEvent({
      type: 'activation:acked',
      sessionId,
      missionId,
      nodeId,
      attempt,
      taskSeq,
      at: Date.now(),
    });
    return res.json({ ok: true, sessionId, missionId, nodeId, attempt, taskSeq });
  }

  if (body.type === 'runtime_task_completed') {
    const result = await executeCompleteTask({
      missionId: body.missionId,
      nodeId: body.nodeId,
      attempt: Number(body.attempt),
      outcome: body.outcome,
      title: body.title,
      summary: body.summary,
      rawOutput: body.rawOutput,
      logRef: body.logRef,
      filesChanged: Array.isArray(body.filesChanged) ? body.filesChanged : [],
      artifactReferences: Array.isArray(body.artifactReferences) ? body.artifactReferences : [],
      downstreamPayload: body.downstreamPayload ?? null,
    }, body.sessionId ?? 'local-http-runtime');
    if (result?.isError) {
      const text = result?.content?.[0]?.text ?? '';
      const parsed = parseJsonSafe(text, null);
      return res.status(400).json({ error: parsed?.error?.message ?? text });
    }
    return res.json({ ok: true, result });
  }

  if (body.type === 'runtime_disconnected') {
    const result = executeRuntimeDisconnect({
      sessionId: body.sessionId,
      missionId: body.missionId ?? null,
      nodeId: body.nodeId ?? null,
      attempt: Number.isInteger(body.attempt) ? body.attempt : null,
      reason: body.reason ?? null,
    });
    if (!result.ok) {
      return res.status(400).json(result);
    }
    return res.json(result);
  }

  return res.status(400).json({ error: 'Unsupported push type' });
});

app.get('/internal/events', (req, res) => {
  const presented = req.headers['x-td-push-token'];
  if (!internalPushToken || presented !== internalPushToken) {
    return res.status(401).send('Unauthorized');
  }
  const sid = req.query.sid ? String(req.query.sid) : null;
  res.json(getRecentAgentEvents(sid));
});

// ── MCP transport (Streamable HTTP) ──────────────────────────────────────────
// Handles both POST (client→server messages) and GET (server→client SSE stream)
// on the same /mcp endpoint, per the MCP 2025-11-25 spec.
app.post('/mcp', async (req, res) => {
  console.log(`[mcp] Incoming POST from ${req.ip}`);
  try {
    // Reuse existing transport for this session if the client sends a session ID
    const existingSessionId = req.headers['mcp-session-id'];
    let sid = existingSessionId;
    let transport;

    if (sid && sessions[sid]?.transport) {
      transport = sessions[sid].transport;
    } else {
      // New session
      let initializedSessionId = null;
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: (sessionId) => {
          initializedSessionId = sessionId;
          sid = sessionId;
          sessions[sessionId] = sessions[sessionId] || {};
          sessions[sessionId].transport = transport;
          sessions[sessionId].mcpServer = mcpServer;
          console.log(`[mcp] Registered session ${sessionId}`);
          broadcast('Starlink', 'session_update', 'session_update');
        },
      });

      const mcpServer = createMcpServer(() => sid ?? initializedSessionId);

      transport.onclose = () => {
        const closedSessionId = sid ?? initializedSessionId;
        console.log(`[mcp] Transport closed for session ${closedSessionId}`);
        if (closedSessionId) {
          logSession(closedSessionId, 'disconnect', null);
          delete sessions[closedSessionId];
        }
        broadcast('Starlink', 'session_update', 'session_update');
      };

      await mcpServer.connect(transport);
    }

    await transport.handleRequest(req, res, req.body);
  } catch (error) {
    console.error('[mcp] Error handling POST:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

app.get('/mcp', async (req, res) => {
  // GET /mcp opens the server→client SSE stream for an existing session
  const sid = req.headers['mcp-session-id'];
  if (!sid || !sessions[sid]?.transport) {
    return res.status(400).json({ error: 'Invalid or missing mcp-session-id header' });
  }
  try {
    await sessions[sid].transport.handleRequest(req, res);
  } catch (error) {
    console.error('[mcp] Error handling GET stream:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

app.delete('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'];
  if (!sid || !sessions[sid]?.transport) {
    return res.status(400).send('Invalid or missing mcp-session-id header');
  }
  try {
    await sessions[sid].transport.close();
    res.status(200).send('OK');
  } catch (err) {
    console.error('[mcp] Error terminating session:', err);
    if (!res.headersSent) res.status(500).send('Error processing session termination');
  }
});

let httpServer = null;

export function startHttpServer(port = PORT) {
  if (httpServer) return httpServer;
  httpServer = app.listen(port, () => {
    mkdirSync('.mcp', { recursive: true });
    writeFileSync('.mcp/server.json', JSON.stringify({ url: `http://127.0.0.1:${port}/mcp`, port }, null, 2));
    console.log(`MCP server listening on port ${port} — db: ${dbPath}`);
  });
  return httpServer;
}

export function stopHttpServer() {
  return new Promise((resolvePromise, rejectPromise) => {
    if (!httpServer) {
      resolvePromise();
      return;
    }
    httpServer.close((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }
      httpServer = null;
      resolvePromise();
    });
  });
}

const isMainModule = Boolean(process.argv[1]) &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url;

if (process.env.MCP_DISABLE_HTTP !== '1' && isMainModule) {
  startHttpServer();
}
