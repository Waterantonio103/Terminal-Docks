import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText, logSession } from '../utils/index.mjs';
import { sessions, emitAgentEvent, agents, broadcast, messageQueues } from '../state.mjs';
import { summarizeSession, normalizeCapabilities, defaultCapabilitiesForRole } from '../utils/sessions.mjs';

export function registerAgentTools(server, getSessionId) {
  server.registerTool('connect_agent', {
    title: 'Connect Agent',
    inputSchema: {
      role: z.string(),
      agentId: z.string(),
      capabilities: z.array(z.any()).optional(),
      workingDir: z.string().optional(),
    }
  }, async ({ role, agentId, capabilities, workingDir }) => {
    const sid = getSessionId() ?? 'unknown';
    const normalizedRole = role.toLowerCase();
    const normalizedCapabilities = normalizeCapabilities(capabilities, defaultCapabilitiesForRole(normalizedRole));

    sessions[sid] = {
      ...sessions[sid],
      role: normalizedRole,
      agentId,
      capabilities: normalizedCapabilities,
      workingDir,
      status: 'idle',
      connectedAt: Date.now(),
      updatedAt: Date.now(),
    };

    logSession(sid, 'connect', JSON.stringify({ role, agentId, capabilities }));
    broadcast('Starlink', `Agent "${agentId}" (${role}) connected via session ${sid}`);
    emitAgentEvent({ type: 'agent:ready', sessionId: sid, role: normalizedRole, agentId });

    return { content: [{ type: 'text', text: `Successfully connected. Session ID: ${sid}` }] };
  });

  server.registerTool('list_sessions', {
    title: 'List Sessions',
    inputSchema: { detailed: z.boolean().optional() }
  }, async ({ detailed } = {}) => {
    const mySid = getSessionId();
    const ids = Object.keys(sessions).filter(id => id !== mySid);
    if (!detailed) return { content: [{ type: 'text', text: ids.join('\n') }] };
    const rows = ids.map(id => summarizeSession(id, sessions[id]));
    return { content: [{ type: 'text', text: JSON.stringify(rows, null, 2) }] };
  });

  server.registerTool('list_agents', {
    title: 'List Agents',
    inputSchema: { projectId: z.string().uuid() }
  }, async ({ projectId }) => {
    const filtered = agents.filter(a => a.projectId === projectId);
    return { content: [{ type: 'text', text: JSON.stringify(filtered) }] };
  });

  server.registerTool('create_agent', {
    title: 'Create Agent',
    inputSchema: { projectId: z.string().uuid(), name: z.string(), systemPrompt: z.string() }
  }, async (args) => {
    const agent = { id: crypto.randomUUID(), ...args, createdAt: Date.now() };
    agents.push(agent);
    return { content: [{ type: 'text', text: JSON.stringify(agent) }] };
  });

  server.registerTool('delete_agent', {
    title: 'Delete Agent',
    inputSchema: { agentId: z.string().uuid() }
  }, async ({ agentId }) => {
    const idx = agents.findIndex(a => a.id === agentId);
    if (idx === -1) return { isError: true, content: [{ type: 'text', text: 'Agent not found.' }] };
    agents.splice(idx, 1);
    return { content: [{ type: 'text', text: 'Agent deleted.' }] };
  });
}
