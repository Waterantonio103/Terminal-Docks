import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { writeFileSync, mkdirSync, readFileSync } from 'fs';
import { randomUUID } from 'crypto';
import { isInitializeRequest } from '@modelcontextprotocol/sdk/types.js';
import { fileURLToPath } from 'url';
import { dirname, resolve } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

function loadAgentRoster() {
  try {
    const p = resolve(__dirname, '../src/config/agents.json');
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { agents: [] };
  }
}

const PORT = parseInt(process.env.MCP_PORT || '3741');

// In-memory simple stores used by tools
const projects = [];
const tasks = [];
const agents = [];

// Per-session message queues: sessionId -> [{ from, text, timestamp }]
const messageQueues = {};

// File locks: filePath -> { agentId, sessionId, lockedAt }
const fileLocks = {};

// Simple activity feed SSE clients
const clients = new Set();
function broadcast(from, content, type = 'message') {
  const msg = { id: Date.now(), from, content, type, timestamp: Date.now() };
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  clients.forEach(res => res.write(data));
}

// Sessions map: sessionId -> { transport, mcpServer }
const sessions = {};

// Factory to create a McpServer with tools registered.
// getSessionId is a closure that returns the assigned session ID once initialized.
function createMcpServer(getSessionId) {
  const server = new McpServer({ name: 'terminal-docks-bridge', version: '1.0.0' });

  // Helper to reuse broadcast in tools
  const bc = (msg) => broadcast('Bridge', msg);

  // Project Tools
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

  // Task Tools (simplified)
  server.registerTool('list_tasks', {
    title: 'List Tasks',
    description: 'List all tasks in a project',
    inputSchema: { projectId: z.string().uuid().optional() } // projectId unused for now
  }, async () => {
    bc(`Listing tasks`);
    const stmt = db.prepare('SELECT * FROM tasks');
    const filteredTasks = stmt.all();
    return { content: [{ type: 'text', text: JSON.stringify(filteredTasks) }] };
  });

  server.registerTool('create_task', {
    title: 'Create Task',
    description: 'Create a new task in a project',
    inputSchema: { title: z.string(), description: z.string().optional(), agentId: z.string().optional() }
  }, async ({ title, description, agentId }) => {
    const stmt = db.prepare('INSERT INTO tasks (title, description, agent_id) VALUES (?, ?, ?)');
    const info = stmt.run(title, description, agentId);
    bc(`Created task ${info.lastInsertRowid}`);
    return { content: [{ type: 'text', text: `Task created with id ${info.lastInsertRowid}` }] };
  });

  server.registerTool('update_task', {
    title: 'Update Task',
    description: "Update a task's status",
    inputSchema: { taskId: z.number(), status: z.string() }
  }, async ({ taskId, status }) => {
    const stmt = db.prepare('UPDATE tasks SET status = ? WHERE id = ?');
    const info = stmt.run(status, taskId);
    if (info.changes === 0) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found` }] };
    bc(`Updated task ${taskId} (status: ${status})`);
    return { content: [{ type: 'text', text: `Task ${taskId} updated` }] };
  });

  // Agent tools (simplified)
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

  server.registerTool('lock_file', {
    title: 'Lock File',
    description: 'Claim exclusive write access to a file path. Returns an error if already locked by another agent. Always unlock when done.',
    inputSchema: { filePath: z.string().min(1), agentId: z.string().min(1) }
  }, async ({ filePath, agentId }) => {
    const existing = fileLocks[filePath];
    if (existing && existing.agentId !== agentId) {
      // Auto-notify the lock owner that someone is waiting
      if (existing.sessionId && sessions[existing.sessionId]) {
        if (!messageQueues[existing.sessionId]) messageQueues[existing.sessionId] = [];
        messageQueues[existing.sessionId].push({
          from: 'Bridge',
          text: `Agent "${agentId}" (session ${getSessionId() ?? 'unknown'}) is waiting for your lock on: ${filePath}`,
          timestamp: Date.now(),
        });
      }
      return { isError: true, content: [{ type: 'text', text: `Locked by "${existing.agentId}" since ${new Date(existing.lockedAt).toISOString()}. The owner has been notified you are waiting.` }] };
    }
    fileLocks[filePath] = { agentId, sessionId: getSessionId(), lockedAt: Date.now() };
    bc(`Lock acquired: ${filePath} by ${agentId}`);
    return { content: [{ type: 'text', text: `Lock acquired: ${filePath}` }] };
  });

  server.registerTool('unlock_file', {
    title: 'Unlock File',
    description: 'Release a file lock. Only the agent that locked it can unlock it.',
    inputSchema: { filePath: z.string().min(1), agentId: z.string().min(1) }
  }, async ({ filePath, agentId }) => {
    const existing = fileLocks[filePath];
    if (!existing) return { content: [{ type: 'text', text: `${filePath} was not locked.` }] };
    if (existing.agentId !== agentId) {
      return { isError: true, content: [{ type: 'text', text: `Cannot unlock: owned by "${existing.agentId}".` }] };
    }
    delete fileLocks[filePath];
    bc(`Lock released: ${filePath} by ${agentId}`);
    return { content: [{ type: 'text', text: `Lock released: ${filePath}` }] };
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

  server.registerTool('get_session_id', {
    title: 'Get Session ID',
    description: 'Returns the session ID of this Claude instance. Share it with another instance so they can relay messages to you.',
    inputSchema: {}
  }, async () => {
    const sid = getSessionId() ?? 'unknown';
    return { content: [{ type: 'text', text: sid }] };
  });

  server.registerTool('list_sessions', {
    title: 'List Sessions',
    description: 'List all currently connected Claude session IDs (excluding your own)',
    inputSchema: {}
  }, async () => {
    const mySid = getSessionId();
    const ids = Object.keys(sessions).filter(id => id !== mySid);
    if (ids.length === 0) return { content: [{ type: 'text', text: 'No other sessions connected.' }] };
    return { content: [{ type: 'text', text: ids.join('\n') }] };
  });

  server.registerTool('send_message', {
    title: 'Send Message',
    description: 'Send a message to another Claude session. They call receive_messages to read it.',
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
    description: 'Publish work output to the Mission Control result panel. Use for completed summaries, instructions the user must follow, or a localhost URL to preview (e.g. http://localhost:5173).',
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
    description: 'Broadcast a status message to all other connected sessions. Use at task start/end so teammates stay informed.',
    inputSchema: { message: z.string().min(1), agentId: z.string().min(1) }
  }, async ({ message, agentId }) => {
    const mySid = getSessionId();
    const targets = Object.keys(sessions).filter(id => id !== mySid);
    const ts = Date.now();
    for (const sid of targets) {
      if (!messageQueues[sid]) messageQueues[sid] = [];
      messageQueues[sid].push({ from: agentId, text: `[BROADCAST] ${message}`, timestamp: ts });
    }
    bc(`Broadcast from ${agentId}: ${message}`);
    return { content: [{ type: 'text', text: `Broadcast sent to ${targets.length} session(s).` }] };
  });

  // MCP Prompt — collaboration protocol SOP all agents should read on startup
  server.registerPrompt('collaboration_protocol', {
    title: 'Team Collaboration Protocol',
    description: 'Standard operating procedure for multi-agent collaboration. Read this at the start of every session.',
  }, () => ({
    messages: [{
      role: 'user',
      content: {
        type: 'text',
        text: `# Team Collaboration Protocol

You are part of a multi-agent team (Claude, Gemini, OpenCode, or other CLIs) working on a shared codebase via the terminal-docks MCP bridge. Follow this protocol to avoid conflicts and collaborate effectively.

## On Session Start
1. Call \`get_file_locks()\` — see what files teammates currently own.
2. Call \`receive_messages()\` — read any updates sent while you were offline.
3. Call \`read_resource("roster://agents")\` — understand your team's roles.
4. Call \`announce({ message: "Online as <role>. Starting: <task>", agentId: "<your-id>" })\`.

## Before Editing Any File
1. Call \`lock_file({ filePath: "<path>", agentId: "<your-id>" })\`.
   - On conflict: another agent owns the file. Wait, coordinate via \`send_message\`, or pick a different task.
2. Make your changes using your CLI's native file tools.
3. Call \`unlock_file({ filePath: "<path>", agentId: "<your-id>" })\`.
4. Call \`announce({ message: "Done with <path>: <summary of changes>", agentId: "<your-id>" })\`.

## Inter-Agent Communication
- \`list_sessions()\` — discover active session IDs.
- \`send_message({ targetSessionId, message })\` — direct message to one session.
- \`announce({ message, agentId })\` — broadcast to all sessions at once.
- \`receive_messages()\` — check your inbox (also shows lock-conflict auto-notifications).

## Role Awareness
- Read \`roster://agents\` resource to see defined roles: Coordinator, Scout, Builder, Reviewer.
- Respect role boundaries. Builders implement; Reviewers review; Scouts map; Coordinators decompose.

## Publishing Results
When your work produces something the user should see, call \`publish_result\`:
- Completed summaries, decisions, instructions → \`type: "markdown"\`
- A running web server the user can preview → \`type: "url", content: "http://localhost:5173"\`
The Mission Control panel displays published results in real time.

## General Rules
- Never edit a file without a lock.
- Always unlock promptly — don't hold locks while idle.
- Broadcast progress at meaningful milestones so teammates can plan around your work.
- If blocked on a lock, send a direct message to the owner rather than polling.`,
      },
    }],
  }));

  // MCP Resource — static agent roster from src/config/agents.json
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

  // MCP Resource — live session list
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

const app = express();
app.use(express.json());

const authToken = process.env.MCP_AUTH_TOKEN;

// Auth middleware
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

// MCP POST handler: manages per-session transports and servers
app.post('/mcp', async (req, res) => {
  try {
    const sessionId = req.headers['mcp-session-id'];
    if (sessionId && sessions[sessionId]) {
      // Existing session transport
      await sessions[sessionId].transport.handleRequest(req, res, req.body);
      return;
    }

    // No session header: this may be an initialization request
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

      // Clean up on close
      transport.onclose = () => {
        const sid = sidFromCallback || transport.sessionId;
        if (sid && sessions[sid]) {
          console.log(`Transport closed for session ${sid}`);
          delete sessions[sid];
          broadcast('Bridge', 'session_update', 'session_update');
        }
      };

      const mcpServer = createMcpServer(() => sidFromCallback);
      await mcpServer.connect(transport);

      // Handle the initial request
      await transport.handleRequest(req, res, req.body);

      // After handleRequest, sidFromCallback should be set
      if (sidFromCallback) {
        sessions[sidFromCallback] = sessions[sidFromCallback] || {};
        sessions[sidFromCallback].mcpServer = mcpServer;
        sessions[sidFromCallback].transport = transport;
        console.log(`Registered session ${sidFromCallback}`);
        broadcast('Bridge', 'session_update', 'session_update');
      }

      return;
    }

    // Otherwise invalid
    res.status(400).json({ jsonrpc: '2.0', error: { code: -32000, message: 'Bad Request: No valid session ID provided' }, id: null });
  } catch (error) {
    console.error('Error handling MCP POST:', error);
    if (!res.headersSent) res.status(500).json({ jsonrpc: '2.0', error: { code: -32603, message: 'Internal server error' }, id: null });
  }
});

// SSE / GET endpoint needs session id header
app.get('/mcp', async (req, res) => {
  const sessionId = req.headers['mcp-session-id'];
  if (!sessionId || !sessions[sessionId] || !sessions[sessionId].transport) {
    res.status(400).send('Invalid or missing session ID');
    return;
  }
  await sessions[sessionId].transport.handleRequest(req, res);
});

// DELETE handler for session termination
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
  console.log(`MCP server listening on port ${PORT}`);
});
ion ID');
    return;
  }
  await sessions[sessionId].transport.handleRequest(req, res);
});

// DELETE handler for session termination
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
  console.log(`MCP server listening on port ${PORT}`);
});
