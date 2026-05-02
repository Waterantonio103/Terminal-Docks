import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import cors from 'cors';
import { randomUUID } from 'crypto';
import { initDb } from './db/index.mjs';
import { sessions, broadcast, clients, agentEvents, recentAgentEvents, resetInMemoryRuntime } from './state.mjs';
import { logSession } from './utils/index.mjs';
import { registerTaskTools } from './tools/tasks.mjs';
import { registerArtifactTools } from './tools/artifacts.mjs';
import { registerLockTools } from './tools/locks.mjs';
import { registerCommunicationTools } from './tools/communication.mjs';
import { registerQualityTools } from './tools/quality.mjs';
import { registerWorkflowTools } from './tools/workflow.mjs';
import { registerAgentTools } from './tools/agents.mjs';
import { registerAdapterTools } from './tools/adapters.mjs';
import { registerInboxTools } from './tools/inbox.mjs';
import { registerResources } from './resources/index.mjs';
import { registerPrompts } from './prompts/index.mjs';

// Initialize DB
initDb();

function createMcpServer(getSessionId) {
  const server = new McpServer({ name: 'starlink-mcp', version: '2.0.0' });

  registerTaskTools(server, getSessionId);
  registerArtifactTools(server, getSessionId);
  registerLockTools(server, getSessionId);
  registerCommunicationTools(server, getSessionId);
  registerQualityTools(server, getSessionId);
  registerWorkflowTools(server, getSessionId);
  registerAgentTools(server, getSessionId);
  registerInboxTools(server, getSessionId);
  registerAdapterTools(server);
  registerResources(server);
  registerPrompts(server);

  return server;
}

const app = express();
app.use(cors());
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true }));

app.get('/events', (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.flushHeaders();
  clients.add(res);
  req.on('close', () => { clients.delete(res); });
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
  console.log(`MCP Server (Phase 9) listening on port ${PORT}`);
});
