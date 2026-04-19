import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
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
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS workspace_context (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
`);

// Migrate existing DBs created before Phase 1 (handoff columns).
// SQLite lacks IF NOT EXISTS on ADD COLUMN, so we swallow duplicate-column errors.
for (const col of ['from_role TEXT', 'target_role TEXT', 'payload TEXT']) {
  try { db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`); }
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
function broadcast(from, content, type = 'message') {
  const msg = { id: Date.now(), from, content, type, timestamp: Date.now() };
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
      'SELECT id, title, description, status, agent_id, parent_id, from_role, target_role, payload, datetime(created_at, "localtime") as created_at FROM tasks ORDER BY id'
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
      'SELECT session_id, event_type, content, datetime(created_at, "localtime") as created_at FROM session_log ORDER BY id DESC LIMIT ?'
    ).all(limit ?? 50);
    if (events.length === 0) return { content: [{ type: 'text', text: 'No session history found.' }] };
    const text = events.reverse().map(e =>
      `[${e.created_at}] ${e.session_id.slice(0, 8)}… ${e.event_type}: ${e.content ?? ''}`
    ).join('\n');
    return { content: [{ type: 'text', text }] };
  });

  // ── Handoff / supervisor routing ───────────────────────────────────────────
  // Phase 1: Replaces string-signal broadcasts ("INTELLIGENCE REPORT" etc.) with
  // explicit, payload-driven stage transitions. Mission Control listens for the
  // emitted 'handoff' event and advances the pipeline deterministically.
  server.registerTool('handoff_task', {
    title: 'Handoff Task',
    description: 'Hand off structured work to the next role in the pipeline. Creates a task row with a JSON payload and emits a handoff event that advances Mission Control. Use this when your stage is complete instead of announcing a literal phrase.',
    inputSchema: {
      fromRole: z.string().min(1).describe('Your role id (e.g. "scout", "coordinator", "builder")'),
      targetRole: z.string().min(1).describe('Role id that should run next (e.g. "coordinator", "builder", "reviewer")'),
      title: z.string().min(1).describe('Short summary of what is being handed off'),
      description: z.string().optional().describe('Longer notes for the receiving role'),
      payload: z.any().optional().describe('Structured data for the next role (any JSON value)'),
      parentTaskId: z.number().int().optional().describe('Parent task id if this is a subtask of an existing task'),
    }
  }, async ({ fromRole: rawFrom, targetRole: rawTarget, title, description, payload, parentTaskId }) => {
    const sid = getSessionId() ?? 'unknown';

    const fromRole = rawFrom.trim().toLowerCase();
    const targetRole = rawTarget.trim().toLowerCase();

    // Phase 2: enforce graph edges. Reject transitions that are not allowed
    // by WORKFLOW_GRAPH so agents cannot jump stages or hand off backwards
    // except along sanctioned edges (e.g. reviewer → builder for retry).
    if (!isValidTransition(fromRole, targetRole)) {
      const allowed = WORKFLOW_GRAPH[fromRole]?.next ?? [];
      const msg = WORKFLOW_GRAPH[fromRole]
        ? `Invalid transition: ${fromRole} → ${targetRole}. Allowed next roles: ${allowed.join(', ') || '(none; this is a terminal role)'}.`
        : `Unknown fromRole "${fromRole}". Valid roles: ${Object.keys(WORKFLOW_GRAPH).join(', ')}.`;
      return { isError: true, content: [{ type: 'text', text: msg }] };
    }

    const payloadStr = payload === undefined ? null : (typeof payload === 'string' ? payload : JSON.stringify(payload));

    // `done` is a terminal pseudo-role — we still log the handoff so the UI
    // can close out the workflow, but we don't create a task row for it to
    // avoid polluting the task tree with phantom "done" entries.
    let taskId = null;
    if (targetRole !== 'done') {
      const info = db.prepare(
        'INSERT INTO tasks (title, description, agent_id, parent_id, status, from_role, target_role, payload) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(title, description ?? null, targetRole, parentTaskId ?? null, 'todo', fromRole, targetRole, payloadStr);
      taskId = info.lastInsertRowid;
    }

    logSession(sid, 'handoff_task', JSON.stringify({ taskId, fromRole, targetRole, title }));

    // Broadcast the handoff to the UI orchestrator and peers. The JSON content
    // lets MissionControlPane advance the pipeline without string scraping.
    const eventBody = { taskId, fromRole, targetRole, title, description: description ?? null, payload: payloadStr };
    broadcast(fromRole, JSON.stringify(eventBody), 'handoff');
    if (taskId !== null) {
      broadcast('Bridge', JSON.stringify({ id: taskId, title, agentId: targetRole, parentTaskId: parentTaskId ?? null, status: 'todo' }), 'task_update');
    }
    bc(`Handoff: ${fromRole} → ${targetRole}${taskId ? ` (task ${taskId}: "${title}")` : ' (workflow complete)'}`);

    const resultText = targetRole === 'done'
      ? 'Workflow marked complete. Call publish_result with your final summary if you have not already.'
      : `Handoff queued as task ${taskId}. The ${targetRole} stage will pick this up.`;
    return { content: [{ type: 'text', text: resultText }] };
  });

  server.registerTool('get_workflow_graph', {
    title: 'Get Workflow Graph',
    description: 'Returns the role transition graph. Use this to discover which roles you can hand off to from your current role. Reviewer has two outgoing edges: "done" (pass) and "builder|tester|security" (fail — retry loop with diff/reasons in payload).',
    inputSchema: {}
  }, async () => {
    return { content: [{ type: 'text', text: JSON.stringify(WORKFLOW_GRAPH, null, 2) }] };
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
      bc(`Lock acquired: ${filePath} by ${agentId}`);
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
      agentId: z.string().describe('A friendly name for your agent instance')
    }
  }, async ({ role, agentId }) => {
    const sid = getSessionId() ?? 'unknown';
    const message = `Role: ${role}. Agent "${agentId}" is online and ready. (Session: ${sid})`;

    logSession(sid, 'connect', JSON.stringify({ agentId, role }));

    const targets = Object.keys(sessions).filter(id => id !== sid);
    const ts = Date.now();
    for (const targetSid of targets) {
      if (!messageQueues[targetSid]) messageQueues[targetSid] = [];
      messageQueues[targetSid].push({ from: agentId, text: `[BROADCAST] ${message}`, timestamp: ts });
    }

    broadcast('Bridge', `Agent "${agentId}" (${role}) connected via session ${sid}`);

    return {
      content: [{
        type: 'text',
        text: `Successfully connected to terminal-docks bridge.\nSession ID: ${sid}\nStatus: Online`
      }]
    };
  });

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
- When your stage is done, call \`handoff_task({ fromRole, targetRole, title, description?, payload?, parentTaskId? })\` with a STRUCTURED payload for the next role.
- Do NOT announce literal phrases like "INTELLIGENCE REPORT" — Mission Control routes strictly on handoff_task events now.
- The payload field is free-form JSON: include whatever structured context the next stage needs (file paths, findings, decisions, error diffs, etc.). Keep it compact.

## Delegation (Coordinator role)
- Call \`get_task_tree()\` to see current workload before assigning new work.
- Call \`delegate_task({ title, description, agentId, parentTaskId })\` to create subtasks for Builders.
- For each subtask, call \`list_sessions()\` then \`assign_task({ taskId, targetSessionId, agentId })\` to bind the task to a specific Builder session. The Builder receives it in their inbox immediately.
- After routing is done, call \`handoff_task({ fromRole: "coordinator", targetRole: "builder", ... })\` once to release the Builder stage.
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
    description: 'Send a message to another agent session.',
    inputSchema: { targetSessionId: z.string().uuid(), message: z.string() }
  }, async ({ targetSessionId, message }) => {
    if (!sessions[targetSessionId]) {
      return { isError: true, content: [{ type: 'text', text: `Session ${targetSessionId} not found. Use list_sessions to see active sessions.` }] };
    }
    if (!messageQueues[targetSessionId]) messageQueues[targetSessionId] = [];
    const from = getSessionId() ?? 'unknown';
    messageQueues[targetSessionId].push({ from, text: message, timestamp: Date.now() });
    bc(`Message queued: ${from} → ${targetSessionId}`);
    return { content: [{ type: 'text', text: `Message delivered to session ${targetSessionId}.` }] };
  });

  server.registerTool('receive_messages', {
    title: 'Receive Messages',
    description: 'Read all pending messages sent to your session. Clears the queue after reading.',
    inputSchema: {}
  }, async () => {
    const sid = getSessionId();
    const msgs = messageQueues[sid] ?? [];
    messageQueues[sid] = [];
    if (msgs.length === 0) return { content: [{ type: 'text', text: 'No messages.' }] };
    const text = msgs.map(m => `[${new Date(m.timestamp).toISOString()}] from ${m.from}:\n${m.text}`).join('\n\n');
    return { content: [{ type: 'text', text }] };
  });

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

app.get('/locks', (_req, res) => {
  const locks = db.prepare('SELECT * FROM file_locks').all();
  const locksObj = {};
  locks.forEach(l => {
    locksObj[l.file_path] = { agentId: l.agent_id, lockedAt: l.locked_at };
  });
  res.json(locksObj);
});

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
app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions[sessionId]) {
      await sessions[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }

    if (!sessionId && isInitializeRequest(req.body)) {
      let sidFromCallback;
      const transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: () => randomUUID(),
        onsessioninitialized: sid => {
          sidFromCallback = sid;
          sessions[sid] = sessions[sid] || {};
          sessions[sid].transport = transport;
          console.log(`Session initialized: ${sid}`);
        }
      });

      transport.onclose = () => {
        const sid = sidFromCallback || transport.sessionId;
        if (sid && sessions[sid]) {
          console.log(`Transport closed for session ${sid}`);
          logSession(sid, 'disconnect', null);
          delete sessions[sid];
          broadcast('Bridge', 'session_update', 'session_update');
        }
      };

      const mcpServer = createMcpServer(() => sidFromCallback);
      await mcpServer.connect(transport);
      await transport.handleRequest(req, res, req.body);

      if (sidFromCallback) {
        sessions[sidFromCallback] = sessions[sidFromCallback] || {};
        sessions[sidFromCallback].mcpServer = mcpServer;
        sessions[sidFromCallback].transport = transport;
        console.log(`Registered session ${sidFromCallback}`);
        broadcast('Bridge', 'session_update', 'session_update');
      }
      return;
    }

    res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
  } catch (error) {
    console.error('Error handling MCP POST:', error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});

app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !sessions[sessionId] || !sessions[sessionId].transport) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await sessions[sessionId].transport.handleRequest(req, res);
});

app.delete('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !sessions[sessionId] || !sessions[sessionId].transport) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  try {
    await sessions[sessionId].transport.handleRequest(req, res);
  } catch (err) {
    console.error('Error terminating session:', err);
    if (!res.headersSent) res.status(500).send('Error processing session termination');
  }
});

app.listen(PORT, () => {
  mkdirSync('.mcp', { recursive: true });
  writeFileSync('.mcp/server.json', JSON.stringify({ url: `http://localhost:${PORT}/mcp`, port: PORT }, null, 2));
  console.log(`MCP server listening on port ${PORT} — db: ${dbPath}`);
});
