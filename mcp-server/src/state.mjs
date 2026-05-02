import { EventEmitter } from 'node:events';
import { db } from './db/index.mjs';

export const projects = [];
export const agents = [];

// Per-session message queues: sessionId -> [{ from, text, timestamp }]
export const messageQueues = {};

// File locks: filePath -> { agentId, sessionId, lockedAt }
export const fileLocks = {};

// wait queues. filePath -> [{ agentId, sessionId, queuedAt }].
export const fileWaitQueues = {};

// SSE clients for the /events feed
export const clients = new Set();
export const broadcastHistory = [];

export function broadcast(from, content, type = 'message') {
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
export const sessions = {};

export const agentEvents = new EventEmitter();
agentEvents.setMaxListeners(0);
export const AGENT_EVENT_HISTORY_CAP = 500;
export const recentAgentEvents = [];

export function emitAgentEvent(ev) {
  if (!ev || typeof ev !== 'object' || typeof ev.type !== 'string') return;
  if (typeof ev.sessionId !== 'string' || !ev.sessionId) return;
  if (typeof ev.at !== 'number') ev.at = Date.now();
  recentAgentEvents.push(ev);
  if (recentAgentEvents.length > AGENT_EVENT_HISTORY_CAP) recentAgentEvents.shift();
  agentEvents.emit('event', ev);
  agentEvents.emit(`sid:${ev.sessionId}`, ev);
}

export function resetInMemoryRuntime() {
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

export function ackTaskPush({ sessionId, missionId, nodeId, taskSeq }) {
  db.prepare(
    "UPDATE task_pushes SET acked_at = CURRENT_TIMESTAMP WHERE session_id = ? AND mission_id = ? AND node_id = ? AND task_seq = ?"
  ).run(sessionId, missionId, nodeId, taskSeq);
}
