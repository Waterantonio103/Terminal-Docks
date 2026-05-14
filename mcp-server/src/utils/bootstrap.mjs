import { db } from '../db/index.mjs';
import { sessions, emitAgentEvent } from '../state.mjs';
import { appendWorkflowEvent, logSession } from './index.mjs';

export function executeRuntimeBootstrapRegistration({
  sessionId, missionId, nodeId, attempt, role, profileId, agentId, terminalId, cli, capabilities, workingDir
}) {
  // Logic for bootstrapping a runtime session
  db.prepare(
    `INSERT INTO agent_runtime_sessions (session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, started_at)
     VALUES (?, ?, ?, ?, ?, ?, 'registered', CURRENT_TIMESTAMP)
     ON CONFLICT(session_id) DO UPDATE SET
       status = 'registered',
       started_at = COALESCE(agent_runtime_sessions.started_at, CURRENT_TIMESTAMP),
       ended_at = NULL,
       failure_reason = NULL,
       updated_at = CURRENT_TIMESTAMP`
  ).run(sessionId, agentId ?? 'agent', missionId, nodeId, attempt, terminalId ?? '');

  appendWorkflowEvent({
    missionId, nodeId, sessionId, type: 'runtime_registered',
    message: `Runtime session ${sessionId} registered.`
  });

  return { ok: true, sessionId };
}

export function executeRuntimeDisconnect({ sessionId, missionId, nodeId, reason }) {
  db.prepare(
    `UPDATE agent_runtime_sessions
        SET status = 'disconnected',
            ended_at = COALESCE(ended_at, CURRENT_TIMESTAMP),
            failure_reason = COALESCE(failure_reason, ?),
            updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?`
  ).run(reason || 'disconnected', sessionId);

  appendWorkflowEvent({
    missionId, nodeId, sessionId, type: 'runtime_disconnected',
    message: `Runtime session ${sessionId} disconnected: ${reason || 'no reason'}`
  });

  return { ok: true, sessionId };
}
