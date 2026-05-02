import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText, logSession } from '../utils/index.mjs';
import { sessions, messageQueues, broadcast, emitAgentEvent } from '../state.mjs';
import { buildTaskDetails } from './task-details.mjs';
import { parseJsonSafe } from '../utils/index.mjs';

export function registerCommunicationTools(server, getSessionId) {
  server.registerTool('send_message', {
    title: 'Send Message',
    description: 'Send a message to another agent session or node.',
    inputSchema: { 
      targetSessionId: z.string().uuid().optional(), 
      targetNodeId: z.string().optional(),
      message: z.string() 
    }
  }, async ({ targetSessionId, targetNodeId, message }) => {
    const from = getSessionId() ?? 'unknown';
    if (targetNodeId) {
      db.prepare("INSERT INTO session_log (session_id, event_type, content, recipient_node_id) VALUES (?, 'message', ?, ?)").run(from, message, targetNodeId);
      return { content: [{ type: 'text', text: `Message delivered to node ${targetNodeId}.` }] };
    }
    if (targetSessionId) {
      if (!sessions[targetSessionId]) return { isError: true, content: [{ type: 'text', text: `Session ${targetSessionId} not found.` }] };
      if (!messageQueues[targetSessionId]) messageQueues[targetSessionId] = [];
      messageQueues[targetSessionId].push({ from, text: message, timestamp: Date.now() });
      return { content: [{ type: 'text', text: `Message delivered to session ${targetSessionId}.` }] };
    }
    return { isError: true, content: [{ type: 'text', text: 'Must provide either targetSessionId or targetNodeId' }] };
  });

  server.registerTool('read_inbox', {
    title: 'Read Inbox',
    description: 'Read pending messages for your node or session.',
    inputSchema: {
      missionId: z.string().optional(),
      nodeId: z.string().optional(),
      afterSeq: z.number().int().min(0).optional(),
      ackThroughSeq: z.number().int().positive().optional(),
    }
  }, async ({ missionId, nodeId, afterSeq, ackThroughSeq }) => {
    const sid = getSessionId() ?? 'unknown';
    emitAgentEvent({ type: 'agent:heartbeat', sessionId: sid, at: Date.now() });

    if (missionId && nodeId) {
      const fromSeq = afterSeq ?? 0;
      const ackSeq = ackThroughSeq ?? null;
      if (ackSeq !== null) {
        db.prepare(
          "UPDATE session_log SET is_read = 1 WHERE mission_id = ? AND recipient_node_id = ? AND event_type = 'message' AND id <= ?"
        ).run(missionId, nodeId, ackSeq);
      }
      const messages = db.prepare(
        "SELECT id, session_id, event_type, content, datetime(created_at, 'localtime') AS created_at FROM session_log WHERE mission_id = ? AND recipient_node_id = ? AND event_type = 'message' AND id > ? ORDER BY id ASC LIMIT 100"
      ).all(missionId, nodeId, fromSeq).map(m => ({
        seq: m.id,
        from: m.session_id,
        content: m.content,
        contentJson: parseJsonSafe(m.content),
        createdAt: m.created_at,
      }));
      return { content: [{ type: 'text', text: JSON.stringify({ messages, nextSeq: messages.length > 0 ? messages[messages.length-1].seq : fromSeq }) }] };
    }

    const queued = messageQueues[sid] ?? [];
    messageQueues[sid] = [];
    if (queued.length === 0) return { content: [{ type: 'text', text: 'No new messages.' }] };
    return { content: [{ type: 'text', text: queued.map(m => `[${new Date(m.timestamp).toISOString()}] from ${m.from}: ${m.text}`).join('\n') }] };
  });

  server.registerTool('broadcast_status', {
    title: 'Broadcast Status',
    description: 'Broadcast a status message to all agents.',
    inputSchema: { message: z.string().min(1), agentId: z.string().optional() }
  }, async ({ message, agentId }) => {
    const sid = getSessionId();
    const from = agentId || sid || 'agent';
    logSession(sid ?? 'unknown', 'announce', `${from}: ${message}`);
    const targets = Object.keys(sessions).filter(id => id !== sid);
    const ts = Date.now();
    for (const targetSid of targets) {
      if (!messageQueues[targetSid]) messageQueues[targetSid] = [];
      messageQueues[targetSid].push({ from, text: `[BROADCAST] ${message}`, timestamp: ts });
    }
    broadcast(from, message);
    return { content: [{ type: 'text', text: `Broadcast sent to ${targets.length} session(s).` }] };
  });

  server.registerTool('request_human_input', {
    title: 'Request Human Input',
    description: 'Ask the human for guidance, approval, or clarification.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string(),
      question: z.string().min(1),
    }
  }, async ({ missionId, nodeId, question }) => {
    const sid = getSessionId() ?? 'unknown';
    appendWorkflowEvent({
      missionId,
      nodeId,
      sessionId: sid,
      type: 'human_input_requested',
      severity: 'warning',
      message: `Agent requested human input: ${question}`,
      payload: { question }
    });
    // This will be picked up by the UI which listens for workflow events.
    return { content: [{ type: 'text', text: 'Human input requested. Watch your inbox for a response.' }] };
  });
}
