import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { db, initDb } from './src/db/index.mjs';
import { sessions, clients, agentEvents, recentAgentEvents, emitAgentEvent } from './src/state.mjs';
import { registerTaskTools } from './src/tools/tasks.mjs';
import { registerArtifactTools } from './src/tools/artifacts.mjs';
import { registerLockTools } from './src/tools/locks.mjs';
import { registerCommunicationTools } from './src/tools/communication.mjs';
import { registerQualityTools } from './src/tools/quality.mjs';
import { registerWorkflowTools } from './src/tools/workflow.mjs';
import { registerAgentTools } from './src/tools/agents.mjs';
import { registerAdapterTools } from './src/tools/adapters.mjs';
import { registerInboxTools } from './src/tools/inbox.mjs';
import { registerDebugTools } from './src/debug/index.mjs';
import { registerResources } from './src/resources/index.mjs';
import { registerPrompts } from './src/prompts/index.mjs';

// Initialize DB
initDb();

function createMcpServer(getSessionId) {
  const server = new McpServer({ 
    name: 'starlink-mcp', 
    version: '2.0.0' 
  });

  registerTaskTools(server, getSessionId);
  registerArtifactTools(server, getSessionId);
  registerLockTools(server, getSessionId);
  registerCommunicationTools(server, getSessionId);
  registerQualityTools(server, getSessionId);
  registerWorkflowTools(server, getSessionId);
  registerAgentTools(server, getSessionId);
  registerInboxTools(server, getSessionId);
  registerAdapterTools(server);
  registerDebugTools(server, getSessionId);
  registerResources(server);
  registerPrompts(server);

  return server;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, version: '2.0.0-phase9' }));

app.post('/internal/frontend-error', (req, res) => {
  const body = req.body ?? {};
  const message = String(body.message || '').trim();
  if (!message) return res.status(400).json({ ok: false, error: 'message is required' });

  const payload = {
    kind: body.kind ?? null,
    breadcrumbs: Array.isArray(body.breadcrumbs) ? body.breadcrumbs.slice(-50) : undefined,
  };

  db.prepare(
    `INSERT INTO debug_frontend_errors
       (timestamp, kind, name, message, stack, route, component, payload_json, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    body.timestamp != null ? String(body.timestamp) : null,
    body.kind != null ? String(body.kind) : null,
    body.name != null ? String(body.name) : null,
    message,
    body.stack != null ? String(body.stack) : null,
    body.route != null ? String(body.route) : null,
    body.component != null ? String(body.component) : null,
    JSON.stringify(payload),
  );

  res.json({ ok: true });
});

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);

  for (const ev of recentAgentEvents) {
    res.write(`data: ${JSON.stringify(ev)}\n\n`);
  }

  const sendAgentEvent = ev => res.write(`data: ${JSON.stringify(ev)}\n\n`);
  agentEvents.on('event', sendAgentEvent);

  req.on('close', () => {
    clients.delete(res);
    agentEvents.off('event', sendAgentEvent);
  });
});

app.get('/events/session', (req, res) => {
  const sid = String(req.query.sid || '');
  if (!sid) return res.status(400).send('Missing sid');

  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();

  const send = (ev) => {
    if (ev.sessionId === sid) {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    }
  };

  for (const ev of recentAgentEvents) {
    if (ev.sessionId === sid) send(ev);
  }

  agentEvents.on(`sid:${sid}`, send);

  req.on('close', () => {
    agentEvents.off(`sid:${sid}`, send);
  });
});

function recordTaskPush({ sessionId, missionId, nodeId, taskSeq, attempt = null }) {
  if (typeof sessionId !== 'string' || !sessionId) return { inserted: false, reason: 'missing_session' };
  if (typeof missionId !== 'string' || !missionId) return { inserted: false, reason: 'missing_mission' };
  if (typeof nodeId !== 'string' || !nodeId) return { inserted: false, reason: 'missing_node' };
  if (!Number.isInteger(taskSeq) || taskSeq <= 0) return { inserted: false, reason: 'invalid_task_seq' };

  const existing = db.prepare(
    'SELECT task_seq FROM task_pushes WHERE session_id = ? AND mission_id = ? AND node_id = ? AND task_seq = ?'
  ).get(sessionId, missionId, nodeId, taskSeq);
  if (existing) return { inserted: false, reason: 'duplicate' };

  db.prepare(
    `INSERT INTO task_pushes (session_id, mission_id, node_id, task_seq, attempt, pushed_at)
     VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(sessionId, missionId, nodeId, taskSeq, attempt);
  return { inserted: true };
}

function registerRuntimeBootstrap(body) {
  const sessionId = String(body.sessionId || '');
  const missionId = String(body.missionId || '');
  const nodeId = String(body.nodeId || '');
  const attempt = Number(body.attempt);
  if (!sessionId || !missionId || !nodeId || !Number.isInteger(attempt) || attempt < 1) {
    return { ok: false, code: 'invalid_runtime_bootstrap', message: 'runtime_bootstrap requires sessionId, missionId, nodeId, and positive attempt.' };
  }

  sessions[sessionId] = {
    ...sessions[sessionId],
    runtimeSessionId: sessionId,
    missionId,
    nodeId,
    attempt,
    role: body.role ?? null,
    profileId: body.profileId ?? null,
    agentId: body.agentId ?? sessionId,
    terminalId: body.terminalId ?? null,
    cli: body.cli ?? null,
    capabilities: Array.isArray(body.capabilities) ? body.capabilities : undefined,
    workingDir: body.workingDir ?? null,
    executionMode: body.executionMode ?? null,
    status: 'registered',
    connectedAt: sessions[sessionId]?.connectedAt ?? Date.now(),
    updatedAt: Date.now(),
  };

  db.prepare(
    `INSERT INTO agent_runtime_sessions
       (session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, run_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, 'registered', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
     ON CONFLICT(session_id) DO UPDATE SET
       agent_id = excluded.agent_id,
       mission_id = excluded.mission_id,
       node_id = excluded.node_id,
       attempt = excluded.attempt,
       terminal_id = excluded.terminal_id,
       status = 'registered',
       run_id = excluded.run_id,
       updated_at = CURRENT_TIMESTAMP`
  ).run(
    sessionId,
    body.agentId ?? sessionId,
    missionId,
    nodeId,
    attempt,
    body.terminalId ?? '',
    body.runId ?? null,
  );

  emitAgentEvent({
    type: 'agent:ready',
    sessionId,
    missionId,
    nodeId,
    attempt,
    role: body.role ?? null,
    agentId: body.agentId ?? null,
    at: Date.now(),
  });

  return { ok: true, sessionId };
}

app.post('/internal/push', (req, res) => {
  const expected = process.env.MCP_INTERNAL_PUSH_TOKEN;
  if (!expected) return res.status(503).json({ ok: false, error: 'Internal push token not configured' });
  if (req.headers['x-td-push-token'] !== expected) return res.status(401).json({ ok: false, error: 'Bad push token' });

  const body = req.body ?? {};

  if (body.type === 'runtime_bootstrap') {
    const result = registerRuntimeBootstrap(body);
    return result.ok ? res.json(result) : res.status(400).json(result);
  }

  if (body.type === 'task_pushed') {
    const taskSeq = Number(body.taskSeq);
    const attempt = Number(body.attempt);
    const record = recordTaskPush({
      sessionId: body.sessionId,
      missionId: body.missionId,
      nodeId: body.nodeId,
      taskSeq,
      attempt: Number.isInteger(attempt) ? attempt : null,
    });
    if (record.inserted) {
      emitAgentEvent({
        type: 'task:pushed',
        sessionId: body.sessionId,
        missionId: body.missionId,
        nodeId: body.nodeId,
        taskSeq,
        attempt: Number.isInteger(attempt) ? attempt : null,
        at: Date.now(),
      });
    }
    return res.json({ ok: true, recorded: record.inserted, reason: record.reason ?? null });
  }

  if (body.type === 'bootstrap') {
    emitAgentEvent({ type: 'bootstrap:requested', sessionId: body.sessionId, at: Date.now() });
    return res.json({ ok: true });
  }

  if (body.type === 'runtime_disconnected') {
    if (body.sessionId) {
      if (sessions[body.sessionId]) sessions[body.sessionId].status = 'disconnected';
      db.prepare(`UPDATE agent_runtime_sessions SET status = 'disconnected', updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`).run(body.sessionId);
      emitAgentEvent({
        type: 'agent:disconnected',
        sessionId: body.sessionId,
        missionId: body.missionId ?? undefined,
        nodeId: body.nodeId ?? undefined,
        attempt: Number.isInteger(Number(body.attempt)) ? Number(body.attempt) : undefined,
        reason: body.reason ?? undefined,
        at: Date.now(),
      });
    }
    return res.json({ ok: true });
  }

  if (body.type === 'runtime_task_completed') {
    emitAgentEvent({
      type: 'task:completed',
      sessionId: body.sessionId,
      missionId: body.missionId ?? undefined,
      nodeId: body.nodeId ?? undefined,
      attempt: Number.isInteger(Number(body.attempt)) ? Number(body.attempt) : undefined,
      outcome: body.outcome === 'failure' ? 'failure' : 'success',
      summary: body.summary ?? undefined,
      at: Date.now(),
    });
    return res.json({ ok: true });
  }

  return res.status(400).json({ ok: false, error: `Unsupported push type: ${body.type}` });
});

app.post('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'];
  if (sid && sessions[sid]?.transport) {
    await sessions[sid].transport.handleRequest(req, res, req.body);
  } else {
    let initializedSessionId = null;
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: () => randomUUID(),
      onsessioninitialized: (sessionId) => {
        initializedSessionId = sessionId;
        sessions[sessionId] = { transport };
      },
    });
    const mcpServer = createMcpServer(() => initializedSessionId);
    transport.onclose = () => { if (initializedSessionId) delete sessions[initializedSessionId]; };
    await mcpServer.connect(transport);
    await transport.handleRequest(req, res, req.body);
  }
});

app.get('/mcp', async (req, res) => {
  const sid = req.headers['mcp-session-id'];
  if (!sid || !sessions[sid]?.transport) return res.status(400).send('Invalid session');
  await sessions[sid].transport.handleRequest(req, res);
});

const PORT = parseInt(process.env.MCP_PORT || '3741');
app.listen(PORT, () => {
  console.log(`MCP Server (Phase 9 Modular) listening on port ${PORT}`);
});
