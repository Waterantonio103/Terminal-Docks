import { db } from '../db/index.mjs';
import { sessions, emitAgentEvent } from '../state.mjs';
import { appendWorkflowEvent, logSession } from './index.mjs';

export function executeRuntimeBootstrapRegistration({
  sessionId, missionId, nodeId, attempt, role, profileId, agentId, terminalId, cli, capabilities, workingDir
}) {
  // Logic for bootstrapping a runtime session
  db.prepare(
    `INSERT INTO agent_runtime_sessions (session_id, agent_id, mission_id, node_id, attempt, terminal_id, status)
     VALUES (?, ?, ?, ?, ?, ?, 'registered')
     ON CONFLICT(session_id) DO UPDATE SET status = 'registered', updated_at = CURRENT_TIMESTAMP`
  ).run(sessionId, agentId ?? 'agent', missionId, nodeId, attempt, terminalId ?? '');

  appendWorkflowEvent({
    missionId, nodeId, sessionId, type: 'runtime_registered',
    message: `Runtime session ${sessionId} registered.`
  });

  return { ok: true, sessionId };
}

export function executeRuntimeDisconnect({ sessionId, missionId, nodeId, reason }) {
  db.prepare(
    `UPDATE agent_runtime_sessions SET status = 'disconnected', updated_at = CURRENT_TIMESTAMP WHERE session_id = ?`
  ).run(sessionId);

  appendWorkflowEvent({
    missionId, nodeId, sessionId, type: 'runtime_disconnected',
    message: `Runtime session ${sessionId} disconnected: ${reason || 'no reason'}`
  });

  return { ok: true, sessionId };
}
