import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js';
import express from 'express';
import cors from 'cors';
import { z } from 'zod';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath, pathToFileURL } from 'url';
import { dirname, resolve } from 'path';
import Database from 'better-sqlite3';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ── SQLite ──────────────────────────────────────────────────────────────────
// Shared with the Rust process via MCP_DB_PATH env var so both read the same
// tasks.db. Falls back to a local file when running standalone.
const dbPath = process.env.MCP_DB_PATH || resolve(__dirname, '../.mcp/tasks.db');
try { mkdirSync(dirname(dbPath), { recursive: true }); } catch {}

const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

db.exec(`
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    parent_id INTEGER,
    agent_id TEXT,
    from_role TEXT,
    target_role TEXT,
    payload TEXT,
    mission_id TEXT,
    node_id TEXT,
    FOREIGN KEY(parent_id) REFERENCES tasks(id)
  );
  CREATE TABLE IF NOT EXISTS file_locks (
    file_path TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    locked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS session_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    mission_id TEXT,
    node_id TEXT,
    recipient_node_id TEXT,
    is_read BOOLEAN DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS workspace_context (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS compiled_missions (
    mission_id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL,
    mission_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS mission_node_runtime (
    mission_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    current_wave_id TEXT,
    last_outcome TEXT,
    last_payload TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (mission_id, node_id)
  );
`);

// Migrate existing DBs created before Phase 1 (handoff columns).
// SQLite lacks IF NOT EXISTS on ADD COLUMN, so we swallow duplicate-column errors.
for (const col of ['from_role TEXT', 'target_role TEXT', 'payload TEXT', 'mission_id TEXT', 'node_id TEXT']) {
  try { db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`); }
  catch (e) { if (!String(e).includes('duplicate column')) throw e; }
}

for (const col of ['mission_id TEXT', 'node_id TEXT', 'recipient_node_id TEXT', 'is_read BOOLEAN DEFAULT 0']) {
  try { db.exec(`ALTER TABLE session_log ADD COLUMN ${col}`); }
  catch (e) { if (!String(e).includes('duplicate column')) throw e; }
}

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
    db.prepare('INSERT INTO session_log (session_id, event_type, content) VALUES (?, ?, ?)').run(sessionId, eventType, content ?? null);
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

function allowedOutcomesForCondition(condition) {
  if (condition === 'on_success') return ['success'];
  if (condition === 'on_failure') return ['failure'];
  return ['success', 'failure'];
}

function loadCompiledMissionRecord(missionId) {
  const row = db.prepare(
    "SELECT mission_id, graph_id, mission_json, status, datetime(created_at, 'localtime') AS created_at, datetime(updated_at, 'localtime') AS updated_at FROM compiled_missions WHERE mission_id = ?"
  ).get(missionId);
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
  return db.prepare(
    "SELECT mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome, last_payload, datetime(updated_at, 'localtime') AS updated_at FROM mission_node_runtime WHERE mission_id = ? AND node_id = ?"
  ).get(missionId, nodeId) ?? null;
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

export function buildTaskDetails(missionId, nodeId) {
  const record = loadCompiledMissionRecord(missionId);
  if (!record) return null;

  const node = getMissionNode(record.mission, nodeId);
  if (!node) return null;

  const runtime = getMissionNodeRuntime(missionId, nodeId);
  const recentTasks = db.prepare(
    "SELECT id, title, description, status, datetime(created_at, 'localtime') AS created_at, parent_id, agent_id, from_role, target_role, payload, mission_id, node_id FROM tasks WHERE mission_id = ? AND node_id = ? ORDER BY id DESC LIMIT 10"
  ).all(missionId, nodeId).map(task => ({
    ...task,
    payload_json: parseJsonSafe(task.payload),
  }));

  const inbox = db.prepare(
    "SELECT id, session_id, event_type, content, datetime(created_at, 'localtime') AS created_at, is_read FROM session_log WHERE mission_id = ? AND recipient_node_id = ? ORDER BY id DESC LIMIT 20"
  ).all(missionId, nodeId).map(message => ({
    ...message,
    content_json: parseJsonSafe(message.content),
  }));

  return {
    missionId,
    graphId: record.graphId,
    missionStatus: record.status,
    objective: record.mission.task?.prompt ?? '',
    task: record.mission.task ?? null,
    node: {
      id: node.id,
      roleId: node.roleId,
      instructionOverride: node.instructionOverride ?? '',
      status: runtime?.status ?? 'idle',
      attempt: runtime?.attempt ?? 0,
      currentWaveId: runtime?.current_wave_id ?? null,
      lastOutcome: runtime?.last_outcome ?? null,
      lastPayload: runtime?.last_payload ?? null,
      updatedAt: runtime?.updated_at ?? null,
    },
    legalNextTargets: getLegalOutgoingTargets(record.mission, nodeId),
    latestTask: recentTasks[0] ?? null,
    recentTasks,
    inbox,
  };
}

export function validateGraphHandoff({ missionId, fromNodeId, targetNodeId, outcome, fromRole, targetRole }) {
  if (!missionId || !fromNodeId || !targetNodeId || !outcome) {
    return { error: 'Graph-mode handoff_task requires missionId, fromNodeId, targetNodeId, and outcome.' };
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
    outcome: normalizedOutcome,
  };
}

function makeToolText(text, isError = false) {
  return isError
    ? { isError: true, content: [{ type: 'text', text }] }
    : { content: [{ type: 'text', text }] };
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
}

export function resetBridgeState() {
  db.exec(`
    DELETE FROM tasks;
    DELETE FROM file_locks;
    DELETE FROM session_log;
    DELETE FROM workspace_context;
    DELETE FROM compiled_missions;
    DELETE FROM mission_node_runtime;
  `);
  resetInMemoryRuntime();
}

export function seedCompiledMission(mission, status = 'active') {
  db.prepare(
    `INSERT INTO compiled_missions (mission_id, graph_id, mission_json, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(mission_id) DO UPDATE SET
       graph_id = excluded.graph_id,
       mission_json = excluded.mission_json,
       status = excluded.status,
       updated_at = CURRENT_TIMESTAMP`
  ).run(mission.missionId, mission.graphId, JSON.stringify(mission), status);
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
  db.prepare(
    `INSERT INTO mission_node_runtime
       (mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome, last_payload, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(mission_id, node_id) DO UPDATE SET
       role_id = excluded.role_id,
       status = excluded.status,
       attempt = excluded.attempt,
       current_wave_id = excluded.current_wave_id,
       last_outcome = excluded.last_outcome,
       last_payload = excluded.last_payload,
       updated_at = CURRENT_TIMESTAMP`
  ).run(missionId, nodeId, roleId, status, attempt, currentWaveId, lastOutcome, lastPayload);
}

export function getBroadcastHistory() {
  return [...broadcastHistory];
}

export function executeConnectAgent({ role, agentId, terminalId, cli }, sessionId = 'unknown') {
  const sid = sessionId ?? 'unknown';
  const message = `Role: ${role}. Agent "${agentId}" is online and ready. (Session: ${sid})`;

  logSession(sid, 'connect', JSON.stringify({ agentId, role, terminalId: terminalId ?? null, cli: cli ?? null }));

  const targets = Object.keys(sessions).filter(id => id !== sid);
  const ts = Date.now();
  for (const targetSid of targets) {
    if (!messageQueues[targetSid]) messageQueues[targetSid] = [];
    messageQueues[targetSid].push({ from: agentId, text: `[BROADCAST] ${message}`, timestamp: ts });
  }

  broadcast('Bridge', JSON.stringify({
    sessionId: sid,
    agentId,
    role,
    terminalId: terminalId ?? null,
    cli: cli ?? null,
  }), 'agent_connected');

  broadcast('Bridge', `Agent "${agentId}" (${role}) connected via session ${sid}`);

  return makeToolText(`Successfully connected to terminal-docks bridge.\nSession ID: ${sid}\nStatus: Online`);
}

export function executeReceiveMessages({ nodeId }, sessionId) {
  const sid = sessionId;
  const queuedMessages = sid ? (messageQueues[sid] ?? []) : [];
  if (sid) {
    messageQueues[sid] = [];
  }

  let dbMessages = [];
  if (nodeId) {
    dbMessages = db.prepare(
      "SELECT * FROM session_log WHERE recipient_node_id = ? AND event_type = 'message' AND is_read = 0"
    ).all(nodeId);
    if (dbMessages.length > 0) {
      const ids = dbMessages.map(message => message.id);
      db.prepare(`UPDATE session_log SET is_read = 1 WHERE id IN (${ids.join(',')})`).run();
    }
  }

  if (queuedMessages.length === 0 && dbMessages.length === 0) {
    return makeToolText('No messages.');
  }

  let text = queuedMessages
    .map(message => `[${new Date(message.timestamp).toISOString()}] from ${message.from}:\n${message.text}`)
    .join('\n\n');
  if (dbMessages.length > 0) {
    if (text) text += '\n\n';
    text += dbMessages
      .map(message => `[${new Date(message.created_at).toISOString()}] from ${message.session_id}:\n${message.content}`)
      .join('\n\n');
  }

  return makeToolText(text);
}

export function executeHandoffTask(
  { fromRole: rawFrom, targetRole: rawTarget, title, description, payload, parentTaskId, missionId, fromNodeId, targetNodeId, outcome },
  sessionId = 'unknown',
) {
  const sid = sessionId ?? 'unknown';

  let fromRole = rawFrom?.trim().toLowerCase() ?? null;
  let targetRole = rawTarget?.trim().toLowerCase() ?? null;
  let validatedGraph = null;

  if (missionId || fromNodeId || targetNodeId || outcome) {
    validatedGraph = validateGraphHandoff({
      missionId,
      fromNodeId,
      targetNodeId,
      outcome,
      fromRole,
      targetRole,
    });
    if (validatedGraph.error) {
      return makeToolText(validatedGraph.error, true);
    }
    fromRole = String(validatedGraph.fromNode.roleId).trim().toLowerCase();
    targetRole = String(validatedGraph.targetNode.roleId).trim().toLowerCase();
  } else {
    if (!fromRole || !targetRole) {
      return makeToolText('Legacy handoff_task requires fromRole and targetRole.', true);
    }

    if (!isValidTransition(fromRole, targetRole)) {
      const allowed = WORKFLOW_GRAPH[fromRole]?.next ?? [];
      const message = WORKFLOW_GRAPH[fromRole]
        ? `Invalid transition: ${fromRole} → ${targetRole}. Allowed next roles: ${allowed.join(', ') || '(none; this is a terminal role)'}.`
        : `Unknown fromRole "${fromRole}". Valid roles: ${Object.keys(WORKFLOW_GRAPH).join(', ')}.`;
      return makeToolText(message, true);
    }
  }

  const payloadStr = payload === undefined ? null : (typeof payload === 'string' ? payload : JSON.stringify(payload));

  let taskId = null;
  if (targetRole !== 'done') {
    const info = db.prepare(
      'INSERT INTO tasks (title, description, agent_id, parent_id, status, from_role, target_role, payload, mission_id, node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(title, description ?? null, targetRole, parentTaskId ?? null, 'todo', fromRole, targetRole, payloadStr, missionId ?? null, targetNodeId ?? null);
    taskId = info.lastInsertRowid;
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
      outcome: validatedGraph?.outcome ?? outcome ?? null,
      payload: payloadStr,
    });
    db.prepare(
      "INSERT INTO session_log (session_id, event_type, content, mission_id, node_id, recipient_node_id, is_read) VALUES (?, 'message', ?, ?, ?, ?, 0)"
    ).run(sid, handoffMessage, missionId, fromNodeId ?? null, targetNodeId);
  }

  logSession(sid, 'handoff_task', JSON.stringify({
    taskId,
    fromRole,
    targetRole,
    title,
    missionId,
    fromNodeId,
    targetNodeId,
    outcome: validatedGraph?.outcome ?? outcome ?? null,
  }));

  const eventBody = {
    taskId,
    fromRole,
    targetRole,
    title,
    description: description ?? null,
    payload: payloadStr,
    missionId,
    fromNodeId,
    targetNodeId,
    outcome: validatedGraph?.outcome ?? outcome ?? null,
  };
  broadcast(fromRole ?? 'graph', JSON.stringify(eventBody), 'handoff');
  if (taskId !== null) {
    broadcast('Bridge', JSON.stringify({
      id: taskId,
      title,
      agentId: targetRole,
      parentTaskId: parentTaskId ?? null,
      status: 'todo',
      missionId,
      targetNodeId,
    }), 'task_update');
  }
  const suffix = validatedGraph?.outcome ? ` [${validatedGraph.outcome}]` : '';
  const taskSuffix = taskId ? ` (task ${taskId}: "${title}")` : '';
  broadcast(
    'Bridge',
    `Handoff: ${fromRole}${fromNodeId ? `(${fromNodeId})` : ''} → ${targetRole}${targetNodeId ? `(${targetNodeId})` : ''}${suffix}${taskSuffix}`,
  );

  const resultText = targetRole === 'done'
    ? 'Workflow marked complete. Call publish_result with your final summary if you have not already.'
    : `Handoff queued as task ${taskId}. The ${targetRole} stage will pick this up.`;
  return makeToolText(resultText);
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

// Sessions map: sessionId -> { transport, mcpServer }
const sessions = {};

// Factory: creates a McpServer with all tools registered.
function createMcpServer(getSessionId) {
  const server = new McpServer({ name: 'terminal-docks-bridge', version: '1.0.0' });
  const bc = (msg) => broadcast('Bridge', msg);

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
    let query = 'SELECT * FROM tasks';
    const conditions = [];
    const params = [];
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (agentId) { conditions.push('agent_id = ?'); params.push(agentId); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY id DESC';
    const tasks = db.prepare(query).all(...params);
    return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
  });

  server.registerTool('create_task', {
    title: 'Create Task',
    description: 'Create a new task',
    inputSchema: { title: z.string(), description: z.string().optional(), agentId: z.string().optional() }
  }, async ({ title, description, agentId }) => {
    const info = db.prepare('INSERT INTO tasks (title, description, agent_id) VALUES (?, ?, ?)').run(title, description ?? null, agentId ?? null);
    const taskId = info.lastInsertRowid;
    broadcast(getSessionId() ?? 'Agent', JSON.stringify({ id: taskId, title, agentId, status: 'todo' }), 'task_update');
    bc(`Created task ${taskId}`);
    return { content: [{ type: 'text', text: `Task created with id ${taskId}` }] };
  });

  server.registerTool('update_task', {
    title: 'Update Task',
    description: "Update a task's status",
    inputSchema: { taskId: z.number(), status: z.string() }
  }, async ({ taskId, status }) => {
    const info = db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
    if (info.changes === 0) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found` }] };
    broadcast(getSessionId() ?? 'Agent', JSON.stringify({ id: taskId, status }), 'task_update');
    bc(`Updated task ${taskId} (status: ${status})`);
    return { content: [{ type: 'text', text: `Task ${taskId} updated` }] };
  });

  // Phase 2: Hierarchical delegation
  server.registerTool('delegate_task', {
    title: 'Delegate Task',
    description: 'Create a subtask assigned to a specific agent role. The task appears in Mission Control\'s task tree under its parent. Coordinators use this to break down work for parallel Builders.',
    inputSchema: {
      title: z.string().min(1).describe('Short description of what this subtask must accomplish'),
      description: z.string().optional().describe('Detailed requirements or acceptance criteria'),
      agentId: z.string().optional().describe('Role to assign (e.g. "builder", "reviewer")'),
      parentTaskId: z.number().int().optional().describe('ID of the parent task this derives from'),
    }
  }, async ({ title, description, agentId, parentTaskId }) => {
    const sid = getSessionId() ?? 'unknown';
    const info = db.prepare(
      'INSERT INTO tasks (title, description, agent_id, parent_id, status) VALUES (?, ?, ?, ?, ?)'
    ).run(title, description ?? null, agentId ?? null, parentTaskId ?? null, 'todo');
    const taskId = info.lastInsertRowid;
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
    const allTasks = db.prepare(
      "SELECT id, title, description, status, agent_id, parent_id, from_role, target_role, payload, datetime(created_at, 'localtime') as created_at FROM tasks ORDER BY id"
    ).all();
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
    const events = db.prepare(
      "SELECT session_id, event_type, content, datetime(created_at, 'localtime') as created_at FROM session_log ORDER BY id DESC LIMIT ?"
    ).all(limit ?? 50);
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
  }, async ({ missionId, nodeId }) => {
    const details = buildTaskDetails(missionId, nodeId);
    if (!details) {
      return {
        isError: true,
        content: [{ type: 'text', text: `Mission ${missionId} or node ${nodeId} could not be found. Confirm the NEW_TASK payload and active mission.` }]
      };
    }
    return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
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
      parentTaskId: z.number().int().optional().describe('Parent task id if this is a subtask of an existing task'),
      missionId: z.string().optional().describe('The ID of the active mission graph'),
      fromNodeId: z.string().optional().describe('Your specific node ID in the graph'),
      targetNodeId: z.string().optional().describe('The target node ID in the graph'),
      outcome: z.enum(['success', 'failure']).optional().describe('Explicit result of the current node attempt. Required in graph mode.'),
    }
  }, async (args) => executeHandoffTask(args, getSessionId() ?? 'unknown'));

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
    db.prepare(
      'INSERT INTO workspace_context (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ' +
      'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at'
    ).run(key, serialized, updatedBy ?? sid);
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
    let rows;
    if (Array.isArray(keys) && keys.length > 0) {
      const placeholders = keys.map(() => '?').join(',');
      rows = db.prepare(
        `SELECT key, value, updated_by, datetime(updated_at, 'localtime') as updated_at FROM workspace_context WHERE key IN (${placeholders})`
      ).all(...keys);
    } else {
      rows = db.prepare(
        `SELECT key, value, updated_by, datetime(updated_at, 'localtime') as updated_at FROM workspace_context ORDER BY key`
      ).all();
    }
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
    description: "Supervisor routing: bind an existing task to a specific agent session. Coordinator uses this after delegate_task to give each Builder a concrete subtask. The target session receives a direct message; the task's agent_id is updated.",
    inputSchema: {
      taskId: z.number().int().describe('ID of the task to assign (from delegate_task or handoff_task)'),
      targetSessionId: z.string().min(1).describe('Session id of the agent instance that should own this task'),
      agentId: z.string().optional().describe('Optional friendly name of the assignee (role id or instance name)'),
    }
  }, async ({ taskId, targetSessionId, agentId }) => {
    const row = db.prepare('SELECT id, title, description, payload, status FROM tasks WHERE id = ?').get(taskId);
    if (!row) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found.` }] };
    if (!sessions[targetSessionId]) {
      return { isError: true, content: [{ type: 'text', text: `Session ${targetSessionId} is not connected. Call list_sessions for active ids.` }] };
    }

    const assignee = agentId ?? targetSessionId;
    db.prepare('UPDATE tasks SET agent_id = ? WHERE id = ?').run(assignee, taskId);

    // Deliver the assignment directly to the target session inbox.
    if (!messageQueues[targetSessionId]) messageQueues[targetSessionId] = [];
    messageQueues[targetSessionId].push({
      from: 'Supervisor',
      text: `[ASSIGNED] Task ${taskId}: ${row.title}\n${row.description ?? ''}\npayload: ${row.payload ?? '(none)'}`,
      timestamp: Date.now(),
    });

    const sid = getSessionId() ?? 'unknown';
    logSession(sid, 'assign_task', JSON.stringify({ taskId, targetSessionId, agentId: assignee }));
    broadcast(sid, JSON.stringify({ taskId, targetSessionId, agentId: assignee, title: row.title }), 'task_assigned');
    broadcast('Bridge', JSON.stringify({ id: taskId, agentId: assignee, status: row.status }), 'task_update');
    bc(`Assigned task ${taskId} → session ${targetSessionId} (${assignee})`);

    return { content: [{ type: 'text', text: `Task ${taskId} assigned to ${assignee} (session ${targetSessionId}).` }] };
  });

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
    inputSchema: { filePath: z.string().min(1), agentId: z.string().min(1) }
  }, async ({ filePath, agentId }) => {
    const sid = getSessionId();
    const existing = fileLocks[filePath];

    if (!existing) {
      fileLocks[filePath] = { agentId, sessionId: sid, lockedAt: Date.now() };
      try { db.prepare('INSERT INTO file_locks (file_path, agent_id) VALUES (?, ?)').run(filePath, agentId); } catch {}
      bc(`Lock acquired: ${filePath} by ${agentId}`);
      broadcast('Bridge', 'lock_update', 'lock_update');
      return { content: [{ type: 'text', text: `Lock acquired: ${filePath}` }] };
    }

    if (existing.agentId === agentId) {
      return { content: [{ type: 'text', text: `Lock already held by you: ${filePath}` }] };
    }

    // Contention — enqueue unless this session is already waiting.
    if (!fileWaitQueues[filePath]) fileWaitQueues[filePath] = [];
    const queue = fileWaitQueues[filePath];
    const alreadyQueued = queue.some(w => w.sessionId === sid);
    if (!alreadyQueued) {
      queue.push({ agentId, sessionId: sid, queuedAt: Date.now() });
    }
    const position = queue.findIndex(w => w.sessionId === sid) + 1;

    // Give the current owner visibility so they don't hold the lock longer than needed.
    if (existing.sessionId && sessions[existing.sessionId]) {
      if (!messageQueues[existing.sessionId]) messageQueues[existing.sessionId] = [];
      messageQueues[existing.sessionId].push({
        from: 'Bridge',
        text: `Agent "${agentId}" is queued for your lock on: ${filePath} (queue depth ${queue.length}). Release when done.`,
        timestamp: Date.now(),
      });
    }
    bc(`Lock queued: ${filePath} for ${agentId} (pos ${position})`);
    return { content: [{ type: 'text', text: `Locked by "${existing.agentId}". You are queued at position ${position} on ${filePath}. The lock will be granted automatically when released — do not poll. Watch your inbox for a [LOCK GRANTED] message.` }] };
  });

  server.registerTool('unlock_file', {
    title: 'Unlock File',
    description: 'Release a file lock. If any agents are queued, the next live waiter is auto-granted the lock and notified. Only the agent that owns the lock can unlock it.',
    inputSchema: { filePath: z.string().min(1), agentId: z.string().min(1) }
  }, async ({ filePath, agentId }) => {
    const existing = fileLocks[filePath];
    if (!existing) return { content: [{ type: 'text', text: `${filePath} was not locked.` }] };
    if (existing.agentId !== agentId) {
      return { isError: true, content: [{ type: 'text', text: `Cannot unlock: owned by "${existing.agentId}".` }] };
    }
    delete fileLocks[filePath];
    try { db.prepare('DELETE FROM file_locks WHERE file_path = ?').run(filePath); } catch {}
    bc(`Lock released: ${filePath} by ${agentId}`);

    // Auto-grant to the next live waiter. Skip waiters whose session has gone away.
    const queue = fileWaitQueues[filePath] ?? [];
    let granted = null;
    while (queue.length > 0) {
      const next = queue.shift();
      if (!sessions[next.sessionId]) continue;
      fileLocks[filePath] = { agentId: next.agentId, sessionId: next.sessionId, lockedAt: Date.now() };
      if (!messageQueues[next.sessionId]) messageQueues[next.sessionId] = [];
      messageQueues[next.sessionId].push({
        from: 'Bridge',
        text: `[LOCK GRANTED] You now hold the lock on ${filePath}. Proceed with your edits. Call unlock_file when done.`,
        timestamp: Date.now(),
      });
      granted = next;
      bc(`Lock auto-granted: ${filePath} → ${next.agentId}`);
      break;
    }
    if (queue.length === 0) delete fileWaitQueues[filePath];

    broadcast('Bridge', 'lock_update', 'lock_update');

    const tail = granted ? ` Auto-granted to "${granted.agentId}".` : '';
    return { content: [{ type: 'text', text: `Lock released: ${filePath}.${tail}` }] };
  });

  server.registerTool('get_file_locks', {
    title: 'Get File Locks',
    description: 'List all currently locked files, who holds them, and when they were locked.',
    inputSchema: {}
  }, async () => {
    const entries = Object.entries(fileLocks);
    if (entries.length === 0) return { content: [{ type: 'text', text: 'No files currently locked.' }] };
    const text = entries.map(([path, l]) =>
      `${path}\n  agent: ${l.agentId}\n  since: ${new Date(l.lockedAt).toISOString()}`
    ).join('\n\n');
    return { content: [{ type: 'text', text }] };
  });

  // ── Session / messaging ────────────────────────────────────────────────────
  server.registerTool('connect_agent', {
    title: 'Connect Agent',
    description: 'Initializes the agent session and announces presence to the team in one step.',
    inputSchema: {
      role: z.string().describe('Your assigned role (e.g. Coordinator, Scout, Builder, Reviewer)'),
      agentId: z.string().describe('A friendly name for your agent instance'),
      terminalId: z.string().optional().describe('Terminal pane ID in terminal-docks, if known'),
      cli: z.enum(['claude', 'gemini', 'opencode']).optional().describe('CLI running in that terminal'),
    }
  }, async ({ role, agentId, terminalId, cli }) =>
    executeConnectAgent({ role, agentId, terminalId, cli }, getSessionId() ?? 'unknown')
  );

  server.registerTool('get_collaboration_protocol', {
    title: 'Get Collaboration Protocol',
    description: 'Returns the standard operating procedure for multi-agent collaboration. All agents should call this first.',
    inputSchema: {}
  }, async () => {
    return {
      content: [{
        type: 'text',
        text: `# Team Collaboration Protocol

You are part of a multi-agent team (Claude, Gemini, OpenCode, or other CLIs) working on a shared codebase via the terminal-docks MCP bridge. Follow this protocol to avoid conflicts and collaborate effectively.

## On Session Start
1. Call \`get_file_locks()\` — see what files teammates currently own.
2. Call \`receive_messages()\` — read any updates sent while you were offline.
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
- In graph mode, when your stage is done, call \`handoff_task({ missionId, fromNodeId, targetNodeId, outcome, title, description?, payload?, parentTaskId? })\` with an explicit \`outcome\` of \`"success"\` or \`"failure"\`. Use the exact \`targetNodeId\` returned by \`get_task_details\`; do not guess from role names.
- In legacy role-mode, call \`handoff_task({ fromRole, targetRole, title, description?, payload?, parentTaskId? })\`.
- Do NOT announce literal phrases like "INTELLIGENCE REPORT" — Mission Control routes strictly on handoff_task events now.
- The payload field is free-form JSON: include whatever structured context the next stage needs (file paths, findings, decisions, error diffs, etc.). Keep it compact.

## Delegation (Coordinator role)
- Call \`get_task_tree()\` to see current workload before assigning new work.
- Call \`delegate_task({ title, description, agentId, parentTaskId })\` to create subtasks for Builders.
- For each subtask, call \`list_sessions()\` then \`assign_task({ taskId, targetSessionId, agentId })\` to bind the task to a specific Builder session. The Builder receives it in their inbox immediately.
- After routing is done, use the graph-mode or legacy handoff format above to release the next stage. In graph mode you must hand off to an exact target node, not just a role.
- Builders should call \`update_task({ taskId, status: "in-progress" })\` when starting and \`update_task({ taskId, status: "done" })\` when complete.
- All task changes appear in Mission Control's task tree in real time.

## Inter-Agent Communication
- \`list_sessions()\` — discover active session IDs.
- \`send_message({ targetSessionId, message })\` — direct message to one session.
- \`announce({ message, agentId })\` — broadcast to all sessions at once.
- \`receive_messages()\` — check your inbox (also shows lock-conflict auto-notifications).

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

  server.registerTool('list_sessions', {
    title: 'List Sessions',
    description: 'List all currently connected session IDs (excluding your own)',
    inputSchema: {}
  }, async () => {
    const mySid = getSessionId();
    const ids = Object.keys(sessions).filter(id => id !== mySid);
    if (ids.length === 0) return { content: [{ type: 'text', text: 'No other sessions connected.' }] };
    return { content: [{ type: 'text', text: ids.join('\n') }] };
  });

  server.registerTool('send_message', {
    title: 'Send Message',
    description: 'Send a message to another agent session or node.',
    inputSchema: { 
      targetSessionId: z.string().uuid().optional(), 
      targetNodeId: z.string().optional(),
      message: z.string() 
    }
  }, async ({ targetSessionId, targetNodeId, message }) => {
    if (!targetSessionId && !targetNodeId) {
      return { isError: true, content: [{ type: 'text', text: 'Must provide either targetSessionId or targetNodeId' }] };
    }
    const from = getSessionId() ?? 'unknown';

    if (targetNodeId) {
      db.prepare("INSERT INTO session_log (session_id, event_type, content, recipient_node_id) VALUES (?, 'message', ?, ?)").run(from, message, targetNodeId);
      bc(`Message queued: ${from} → node ${targetNodeId}`);
      return { content: [{ type: 'text', text: `Message delivered to node ${targetNodeId}.` }] };
    }

    if (targetSessionId) {
      if (!sessions[targetSessionId]) {
        return { isError: true, content: [{ type: 'text', text: `Session ${targetSessionId} not found. Use list_sessions to see active sessions.` }] };
      }
      if (!messageQueues[targetSessionId]) messageQueues[targetSessionId] = [];
      messageQueues[targetSessionId].push({ from, text: message, timestamp: Date.now() });
      bc(`Message queued: ${from} → session ${targetSessionId}`);
      return { content: [{ type: 'text', text: `Message delivered to session ${targetSessionId}.` }] };
    }
  });

  server.registerTool('receive_messages', {
    title: 'Receive Messages',
    description: 'Read all pending messages sent to your session or node. Marks them as read.',
    inputSchema: {
      nodeId: z.string().optional().describe('Your specific node ID in the graph, if applicable.')
    }
  }, async ({ nodeId }) => executeReceiveMessages({ nodeId }, getSessionId()));

  server.registerTool('publish_result', {
    title: 'Publish Result',
    description: 'Publish work output to the Mission Control result panel.',
    inputSchema: {
      content: z.string().min(1),
      type: z.enum(['markdown', 'url']).default('markdown'),
      agentId: z.string().optional(),
    }
  }, async ({ content, type, agentId }) => {
    broadcast(agentId ?? getSessionId() ?? 'Agent', content, `result:${type}`);
    return { content: [{ type: 'text', text: 'Result published to Mission Control.' }] };
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

app.use((req, res, next) => {
  if (req.path === '/health') return next();
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
  broadcast('Bridge', 'Client connected to activity feed', 'status');
  req.on('close', () => { clients.delete(res); });
});

// ── MCP transport ─────────────────────────────────────────────────────────────
app.get('/mcp', async (req, res) => {
  try {
    const transport = new SSEServerTransport('/mcp/message', res);
    const sid = transport.sessionId;
    
    sessions[sid] = sessions[sid] || {};
    sessions[sid].transport = transport;

    const mcpServer = createMcpServer(() => sid);
    sessions[sid].mcpServer = mcpServer;

    transport.onclose = () => {
      console.log(`Transport closed for session ${sid}`);
      logSession(sid, 'disconnect', null);
      delete sessions[sid];
      broadcast('Bridge', 'session_update', 'session_update');
    };

    // mcpServer.connect calls transport.start() automatically, which sends the SSE headers.
    await mcpServer.connect(transport);

    console.log(`Registered session ${sid}`);
    broadcast('Bridge', 'session_update', 'session_update');
  } catch (error) {
    console.error('Error starting SSE transport:', error);
    if (!res.headersSent) res.status(500).json({ error: 'Internal server error' });
  }
});

app.post('/mcp/message', async (req, res) => {
  try {
    const sessionId = req.query.sessionId;
    if (!sessionId || !sessions[sessionId] || !sessions[sessionId].transport) {
      return res.status(400).send('Invalid or missing session ID');
    }
    await sessions[sessionId].transport.handlePostMessage(req, res, req.body);
  } catch (error) {
    console.error('Error handling message POST:', error);
    if (!res.headersSent) res.status(500).send('Internal server error');
  }
});

app.post('/mcp', async (req, res) => {
  res.status(400).json({ error: 'Please use GET /mcp for SSE connections (SSEServerTransport).' });
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.query.sessionId;
  if (!sessionId || !sessions[sessionId] || !sessions[sessionId].transport) {
    return res.status(400).send('Invalid or missing session ID');
  }
  try {
    await sessions[sessionId].transport.close();
  } catch (err) {
    console.error('Error terminating session:', err);
    if (!res.headersSent) res.status(500).send('Error processing session termination');
  }
});

let httpServer = null;

export function startHttpServer(port = PORT) {
  if (httpServer) return httpServer;
  httpServer = app.listen(port, () => {
    mkdirSync('.mcp', { recursive: true });
    writeFileSync('.mcp/server.json', JSON.stringify({ url: `http://localhost:${port}/mcp`, port }, null, 2));
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

