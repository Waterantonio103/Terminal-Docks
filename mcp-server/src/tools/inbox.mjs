import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText, appendWorkflowEvent } from '../utils/index.mjs';
import { broadcast, sessions, emitAgentEvent } from '../state.mjs';

export function registerInboxTools(server, getSessionId) {
  server.registerTool('list_inbox', {
    title: 'List Inbox',
    description: 'List all items in the task inbox for a mission or role.',
    inputSchema: {
      missionId: z.string().optional(),
      roleId: z.string().optional(),
      status: z.string().optional(),
    }
  }, async ({ missionId, roleId, status } = {}) => {
    let query = 'SELECT * FROM task_inbox';
    const conditions = [];
    const params = [];
    if (missionId) { conditions.push('mission_id = ?'); params.push(missionId); }
    if (roleId) { conditions.push('role_id = ?'); params.push(roleId); }
    if (status) { conditions.push('status = ?'); params.push(status); }
    if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
    query += ' ORDER BY created_at DESC';
    const items = db.prepare(query).all(...params);
    return { content: [{ type: 'text', text: JSON.stringify(items) }] };
  });

  server.registerTool('claim_inbox_item', {
    title: 'Claim Inbox Item',
    description: 'Claim a pending inbox item for yourself.',
    inputSchema: {
      itemId: z.number().int(),
    }
  }, async ({ itemId }) => {
    const sid = getSessionId() ?? 'unknown';
    const item = db.prepare('SELECT * FROM task_inbox WHERE id = ?').get(itemId);
    if (!item) return { isError: true, content: [{ type: 'text', text: `Inbox item ${itemId} not found.` }] };
    if (item.status !== 'pending' && item.status !== 'approved') {
       return { isError: true, content: [{ type: 'text', text: `Inbox item ${itemId} is in status ${item.status} and cannot be claimed.` }] };
    }

    db.prepare('UPDATE task_inbox SET status = "claimed", recipient_session_id = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(sid, itemId);
    
    // Convert to a formal task
    const taskInfo = db.prepare(
      'INSERT INTO tasks (title, description, agent_id, mission_id, node_id, from_role, target_role, status) VALUES (?, ?, ?, ?, ?, ?, ?, "in-progress")'
    ).run(item.title, item.objective, sid, item.mission_id, item.recipient_node_id, 'inbox', item.role_id);
    
    const taskId = taskInfo.lastInsertRowid;
    db.prepare('UPDATE task_inbox SET result_task_id = ? WHERE id = ?').run(taskId, itemId);

    broadcast(sid, JSON.stringify({ itemId, taskId, status: 'claimed' }), 'inbox_update');
    
    return { content: [{ type: 'text', text: `Inbox item ${itemId} claimed and converted to task ${taskId}.` }] };
  });

  server.registerTool('approve_inbox_item', {
    title: 'Approve Inbox Item',
    description: 'Orchestrator tool to approve a proposed task.',
    inputSchema: {
      itemId: z.number().int(),
    }
  }, async ({ itemId }) => {
    const sid = getSessionId() ?? 'orchestrator';
    const info = db.prepare('UPDATE task_inbox SET status = "approved", updated_at = CURRENT_TIMESTAMP WHERE id = ? AND status = "pending"').run(itemId);
    if (info.changes === 0) return { isError: true, content: [{ type: 'text', text: `Inbox item ${itemId} not found or not pending.` }] };
    
    broadcast(sid, JSON.stringify({ itemId, status: 'approved' }), 'inbox_update');
    return { content: [{ type: 'text', text: `Inbox item ${itemId} approved.` }] };
  });

  server.registerTool('reject_inbox_item', {
    title: 'Reject Inbox Item',
    description: 'Orchestrator tool to reject a proposed task.',
    inputSchema: {
      itemId: z.number().int(),
      reason: z.string(),
    }
  }, async ({ itemId, reason }) => {
    const sid = getSessionId() ?? 'orchestrator';
    const info = db.prepare('UPDATE task_inbox SET status = "rejected", objective = objective || ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?').run(`\n\nREJECTION REASON: ${reason}`, itemId);
    if (info.changes === 0) return { isError: true, content: [{ type: 'text', text: `Inbox item ${itemId} not found.` }] };
    
    broadcast(sid, JSON.stringify({ itemId, status: 'rejected' }), 'inbox_update');
    return { content: [{ type: 'text', text: `Inbox item ${itemId} rejected.` }] };
  });
}
