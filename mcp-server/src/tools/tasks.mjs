import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText, logSession } from '../utils/index.mjs';
import { broadcast, sessions, emitAgentEvent, messageQueues, projects } from '../state.mjs';
import { buildTaskDetails, ackAndEmitTaskFetch } from './task-details.mjs';
import { summarizeSession, normalizeCapabilityId, evaluateWorkerForRequirements } from '../utils/sessions.mjs';

export function registerTaskTools(server, getSessionId) {
  // Project tools
  server.registerTool('list_projects', {
    title: 'List Projects',
    inputSchema: {}
  }, async () => {
    return { content: [{ type: 'text', text: JSON.stringify(projects.map(p => ({ id: p.id, name: p.name, description: p.description }))) }] };
  });

  server.registerTool('create_project', {
    title: 'Create Project',
    inputSchema: { name: z.string().min(1), description: z.string().optional() }
  }, async ({ name, description }) => {
    const project = { id: crypto.randomUUID(), name, description: description || '' };
    projects.push(project);
    return { content: [{ type: 'text', text: JSON.stringify(project) }] };
  });

  // Existing Task tools
  server.registerTool('list_tasks', {
    title: 'List Tasks',
    inputSchema: { status: z.string().optional(), agentId: z.string().optional() }
  }, async ({ status, agentId } = {}) => {
    let query = 'SELECT * FROM tasks';
    const params = [];
    if (status || agentId) query += ' WHERE ' + [status && 'status = ?', agentId && 'agent_id = ?'].filter(Boolean).join(' AND ');
    if (status) params.push(status);
    if (agentId) params.push(agentId);
    const tasks = db.prepare(query + ' ORDER BY id DESC').all(...params);
    return { content: [{ type: 'text', text: JSON.stringify(tasks) }] };
  });

  server.registerTool('create_task', {
    title: 'Create Task',
    inputSchema: { title: z.string(), description: z.string().optional(), agentId: z.string().optional() }
  }, async ({ title, description, agentId }) => {
    const info = db.prepare('INSERT INTO tasks (title, description, agent_id) VALUES (?, ?, ?)').run(title, description ?? null, agentId ?? null);
    broadcast(getSessionId() ?? 'Agent', JSON.stringify({ id: info.lastInsertRowid, title, agentId, status: 'todo' }), 'task_update');
    return { content: [{ type: 'text', text: `Task created with id ${info.lastInsertRowid}` }] };
  });

  server.registerTool('update_task_status', {
    title: 'Update Task Status',
    inputSchema: { taskId: z.number(), status: z.string() }
  }, async ({ taskId, status }) => {
    const info = db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
    if (info.changes === 0) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found` }] };
    broadcast(getSessionId() ?? 'Agent', JSON.stringify({ id: taskId, status }), 'task_update');
    return { content: [{ type: 'text', text: `Task ${taskId} updated` }] };
  });

  server.registerTool('assign_task', {
    title: 'Assign Task',
    inputSchema: {
      taskId: z.number().int(),
      targetSessionId: z.string().min(1),
      agentId: z.string().optional(),
    }
  }, async ({ taskId, targetSessionId, agentId }) => {
    const row = db.prepare('SELECT id, title, description FROM tasks WHERE id = ?').get(taskId);
    if (!row) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found.` }] };
    if (!sessions[targetSessionId]) return { isError: true, content: [{ type: 'text', text: `Session ${targetSessionId} not connected.` }] };

    const assignee = agentId ?? targetSessionId;
    db.prepare('UPDATE tasks SET agent_id = ? WHERE id = ?').run(assignee, taskId);
    if (!messageQueues[targetSessionId]) messageQueues[targetSessionId] = [];
    messageQueues[targetSessionId].push({ from: 'Supervisor', text: `[ASSIGNED] Task ${taskId}: ${row.title}`, timestamp: Date.now() });
    broadcast(getSessionId() ?? 'unknown', JSON.stringify({ taskId, targetSessionId, assignee }), 'task_assigned');
    return { content: [{ type: 'text', text: `Task ${taskId} assigned to ${assignee}.` }] };
  });

  server.registerTool('assign_task_by_requirements', {
    title: 'Assign Task By Requirements',
    inputSchema: {
      taskId: z.number().int(),
      requiredCapabilities: z.array(z.string()).min(1),
      preferredCapabilities: z.array(z.string()).optional(),
      workingDir: z.string().optional(),
      fileScope: z.array(z.string()).optional(),
    }
  }, async ({ taskId, requiredCapabilities, preferredCapabilities = [], workingDir, fileScope }) => {
    const sid = getSessionId() ?? 'unknown';
    const task = db.prepare('SELECT id, title FROM tasks WHERE id = ?').get(taskId);
    if (!task) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found.` }] };

    const candidates = Object.entries(sessions)
      .filter(([id]) => id !== sid)
      .map(([id, s]) => evaluateWorkerForRequirements(id, s, {
        requiredCapabilities: requiredCapabilities.map(normalizeCapabilityId).filter(Boolean),
        preferredCapabilities: preferredCapabilities.map(normalizeCapabilityId).filter(Boolean),
        workingDir,
        fileScope,
        writeAccess: true,
        excludedSessionIds: new Set(),
      }));

    const eligible = candidates.filter(c => c.eligible).sort((a, b) => b.score - a.score);
    if (eligible.length === 0) return { isError: true, content: [{ type: 'text', text: 'No eligible workers found.' }] };

    const winner = eligible[0];
    db.prepare('UPDATE tasks SET agent_id = ? WHERE id = ?').run(winner.sessionId, taskId);
    return { content: [{ type: 'text', text: `Task ${taskId} assigned to ${winner.sessionId}.` }] };
  });

  // Re-add missing tools
  server.registerTool('delegate_task', {
    title: 'Delegate Task',
    description: 'Delegate work to another role or create a subtask. If roleId or nodeId is provided, it may go to the task inbox for approval.',
    inputSchema: {
      title: z.string().min(1),
      description: z.string().optional(),
      agentId: z.string().optional(),
      parentTaskId: z.number().int().optional(),
      missionId: z.string().optional(),
      roleId: z.string().optional(),
      nodeId: z.string().optional(),
    }
  }, async ({ title, description, agentId, parentTaskId, missionId, roleId, nodeId }) => {
    const sid = getSessionId() ?? 'unknown';

    // If it's a cross-node or cross-role delegation, put it in the inbox first
    if (missionId && (roleId || nodeId)) {
      const inboxInfo = db.prepare(
        'INSERT INTO task_inbox (mission_id, from_session_id, recipient_node_id, role_id, title, objective, status) VALUES (?, ?, ?, ?, ?, ?, ?)'
      ).run(missionId, sid, nodeId ?? null, roleId ?? null, title, description ?? '', 'pending');
      
      const itemId = inboxInfo.lastInsertRowid;
      logSession(sid, 'delegate_inbox', JSON.stringify({ itemId, title, roleId, nodeId }));
      broadcast(sid, JSON.stringify({ itemId, title, roleId, nodeId, status: 'pending' }), 'inbox_update');
      
      return { content: [{ type: 'text', text: `Task proposed to inbox with id ${itemId}. Awaiting approval.` }] };
    }

    // Default: internal subtask or direct assignment
    const info = db.prepare(
      'INSERT INTO tasks (title, description, agent_id, parent_id, status) VALUES (?, ?, ?, ?, ?)'
    ).run(title, description ?? null, agentId ?? null, parentTaskId ?? null, 'todo');
    const taskId = info.lastInsertRowid;
    logSession(sid, 'delegate_task', JSON.stringify({ taskId, title, agentId, parentTaskId }));
    broadcast(agentId ?? sid, JSON.stringify({ id: taskId, title, agentId, parentTaskId, status: 'todo' }), 'task_update');
    return { content: [{ type: 'text', text: `Subtask created with id ${taskId}.` }] };
  });

  server.registerTool('get_task_tree', {
    title: 'Get Task Tree',
    inputSchema: {}
  }, async () => {
    const tasks = db.prepare("SELECT * FROM tasks ORDER BY id").all();
    const map = {}; const roots = [];
    tasks.forEach(t => map[t.id] = { ...t, children: [] });
    tasks.forEach(t => t.parent_id ? map[t.parent_id]?.children.push(map[t.id]) : roots.push(map[t.id]));
    return { content: [{ type: 'text', text: JSON.stringify(roots, null, 2) }] };
  });

  server.registerTool('get_task_details', {
    title: 'Get Task Details',
    inputSchema: { missionId: z.string(), nodeId: z.string() }
  }, async ({ missionId, nodeId }) => {
    const details = buildTaskDetails(missionId, nodeId);
    if (!details) return { isError: true, content: [{ type: 'text', text: 'Task details not found.' }] };
    ackAndEmitTaskFetch(details, getSessionId());
    return { content: [{ type: 'text', text: JSON.stringify(details, null, 2) }] };
  });
}
