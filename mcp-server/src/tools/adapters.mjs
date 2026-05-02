import { z } from 'zod';
import { db } from '../db/index.mjs';
import { emitAgentEvent } from '../state.mjs';

export function registerAdapterTools(server) {
  server.registerTool('register_adapter', {
    title: 'Register Adapter',
    inputSchema: {
      sessionId: z.string().min(1),
      terminalId: z.string().min(1),
      nodeId: z.string().min(1),
      missionId: z.string().min(1),
      role: z.string().min(1),
      cli: z.string().min(1),
      cwd: z.string().optional(),
    }
  }, async (args) => {
    const adapterId = `adapter:${args.missionId}:${args.nodeId}:${args.sessionId}`;
    db.prepare(
      `INSERT INTO adapter_registrations (adapter_id, session_id, terminal_id, node_id, mission_id, role, cli, cwd, lifecycle)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'registered')
       ON CONFLICT(adapter_id) DO UPDATE SET lifecycle = 'registered', updated_at = CURRENT_TIMESTAMP`
    ).run(adapterId, args.sessionId, args.terminalId, args.nodeId, args.missionId, args.role, args.cli, args.cwd ?? null);

    db.prepare(
      `UPDATE agent_runtime_sessions
       SET status = CASE
         WHEN status IN ('running', 'completed', 'failed', 'cancelled') THEN status
         ELSE 'registered'
       END,
       updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(args.sessionId);
    emitAgentEvent({ type: 'agent:ready', sessionId: args.sessionId, missionId: args.missionId, nodeId: args.nodeId });

    return { content: [{ type: 'text', text: 'Adapter registered.' }] };
  });

  server.registerTool('ack_task_activation', {
    title: 'Acknowledge Task Activation',
    inputSchema: {
      sessionId: z.string().min(1),
      missionId: z.string().min(1),
      nodeId: z.string().min(1),
      attempt: z.number().int(),
      taskSeq: z.number().int(),
    }
  }, async (args) => {
    db.prepare(`UPDATE task_pushes SET acked_at = CURRENT_TIMESTAMP WHERE session_id = ? AND mission_id = ? AND node_id = ? AND task_seq = ?`).run(args.sessionId, args.missionId, args.nodeId, args.taskSeq);
    db.prepare(
      `UPDATE agent_runtime_sessions
       SET status = CASE
         WHEN status IN ('running', 'completed', 'failed', 'cancelled') THEN status
         ELSE 'activated'
       END,
       updated_at = CURRENT_TIMESTAMP
       WHERE session_id = ?`
    ).run(args.sessionId);
    emitAgentEvent({ type: 'activation:acked', sessionId: args.sessionId, missionId: args.missionId, nodeId: args.nodeId });

    return { content: [{ type: 'text', text: 'Activation acknowledged.' }] };
  });
}
