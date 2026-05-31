import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText, logSession, appendWorkflowEvent } from '../utils/index.mjs';
import { broadcast, sessions, emitAgentEvent, messageQueues, projects } from '../state.mjs';
import { buildTaskDetails, ackAndEmitTaskFetch } from './task-details.mjs';
import { summarizeSession, normalizeCapabilityId, evaluateWorkerForRequirements } from '../utils/sessions.mjs';

function normalizeSessionId(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function addSessionCandidate(candidates, value) {
  const normalized = normalizeSessionId(value);
  if (normalized && !candidates.includes(normalized)) candidates.push(normalized);
}

function resolveCurrentTaskBinding(requestedSessionId, callerSessionId) {
  const candidates = [];
  addSessionCandidate(candidates, requestedSessionId);
  addSessionCandidate(candidates, callerSessionId);

  for (let index = 0; index < candidates.length; index += 1) {
    const candidate = candidates[index];
    const session = sessions[candidate];
    if (session) {
      addSessionCandidate(candidates, session.runtimeSessionId);
      addSessionCandidate(candidates, session.aliasOf);
      if (session.missionId && session.nodeId) {
        return {
          sessionId: normalizeSessionId(session.runtimeSessionId) ?? candidate,
          missionId: session.missionId,
          nodeId: session.nodeId,
        };
      }
    }

    const row = db.prepare(
      `SELECT session_id, mission_id, node_id
         FROM agent_runtime_sessions
        WHERE session_id = ?
        ORDER BY updated_at DESC
        LIMIT 1`
    ).get(candidate);
    if (row?.mission_id && row?.node_id) {
      return {
        sessionId: row.session_id,
        missionId: row.mission_id,
        nodeId: row.node_id,
      };
    }
  }

  return null;
}

function compactFrontendFramework(framework) {
  if (!framework) return framework;
  const schemas = {};
  for (const [fileName, schema] of Object.entries(framework.schemas ?? {})) {
    schemas[fileName] = {
      purpose: schema.purpose,
      outputBudget: schema.outputBudget,
      aliases: schema.aliases,
      requiredSections: schema.requiredSections,
      qualityChecks: schema.qualityChecks,
    };
  }
  return {
    version: framework.version,
    mode: framework.mode,
    modeConfig: framework.modeConfig,
    categoryId: framework.categoryId,
    category: framework.category
      ? {
          label: framework.category.label,
          requiredAdditions: framework.category.requiredAdditions,
          rubric: framework.category.rubric,
        }
      : null,
    schemas,
    intakeSteps: [
      'Use accepted files and workspace context as binding source of truth.',
      'Create or patch only the durable handoff owned by this role.',
      'Run one focused alignment check before completing.',
    ],
    alignmentChecks: framework.alignmentChecks,
  };
}

function compactPresetFramework(framework) {
  if (!framework) return framework;
  return {
    version: framework.version,
    presetId: framework.presetId,
    mode: framework.mode,
    modeConfig: framework.modeConfig,
    subMode: framework.subMode,
    framework: framework.framework
      ? {
          focus: framework.framework.focus,
          laneGuidance: framework.framework.laneGuidance,
          requiredOutputs: framework.framework.requiredOutputs,
          qualityRubric: framework.framework.qualityRubric,
        }
      : null,
    sharedWorkflow: framework.sharedWorkflow,
    completionContract: framework.completionContract,
  };
}

function compactTaskForCurrentTask(task, frontendFramework, presetFramework) {
  if (!task || typeof task !== 'object') return task;
  return {
    prompt: task.prompt,
    mode: task.mode,
    workspaceDir: task.workspaceDir,
    presetId: task.presetId,
    frontendMode: task.frontendMode,
    frontendCategory: task.frontendCategory,
    specProfile: task.specProfile,
    finalReadmeEnabled: task.finalReadmeEnabled,
    finalReadmeOwnerNodeId: task.finalReadmeOwnerNodeId,
    frontendDirection: task.frontendDirection ?? null,
    frontendDirectionReview: task.frontendDirectionReview ?? null,
    frontendFramework,
    presetFramework,
    outputContract: task.outputContract,
  };
}

function compactCompletionPayload(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    outcome: value.outcome ?? null,
    summary: value.summary ?? null,
    filesChanged: Array.isArray(value.filesChanged) ? value.filesChanged.slice(0, 20) : [],
    artifactReferences: Array.isArray(value.artifactReferences) ? value.artifactReferences.slice(0, 20) : [],
    keyFindings: Array.isArray(value.keyFindings) ? value.keyFindings.slice(0, 12) : [],
  };
}

function compactInboxMessages(messages) {
  return (Array.isArray(messages) ? messages : []).map(message => {
    const parsed = message.content_json && typeof message.content_json === 'object'
      ? message.content_json
      : {};
    const rawCompletion = parsed.payload ?? parsed.completion;
    const completion = typeof rawCompletion === 'string'
      ? (() => { try { return JSON.parse(rawCompletion); } catch { return null; } })()
      : rawCompletion;
    return {
      id: message.id,
      sessionId: message.session_id,
      eventType: message.event_type,
      createdAt: message.created_at,
      isRead: Boolean(message.is_read),
      fromNodeId: parsed.fromNodeId ?? null,
      targetNodeId: parsed.targetNodeId ?? null,
      outcome: parsed.outcome ?? completion?.outcome ?? null,
      completion: compactCompletionPayload(completion),
    };
  });
}

function compactArtifacts(artifacts) {
  return (Array.isArray(artifacts) ? artifacts : []).map(artifact => ({
    id: artifact.id,
    kind: artifact.kind,
    title: artifact.title,
    createdAt: artifact.created_at,
  }));
}

function compactTaskDetails(details) {
  if (!details?.frontendFramework && !details?.presetFramework) return details;
  const frontendFramework = compactFrontendFramework(details.frontendFramework);
  const presetFramework = compactPresetFramework(details.presetFramework);
  return {
    missionId: details.missionId,
    nodeId: details.nodeId,
    graphId: details.graphId,
    missionStatus: details.missionStatus,
    authoringMode: details.authoringMode,
    presetId: details.presetId,
    runVersion: details.runVersion,
    frontendMode: details.frontendMode,
    frontendCategory: details.frontendCategory,
    specProfile: details.specProfile,
    finalReadmeEnabled: details.finalReadmeEnabled,
    finalReadmeOwnerNodeId: details.finalReadmeOwnerNodeId,
    frontendDirection: details.frontendDirection,
    frontendDirectionReview: details.frontendDirectionReview,
    frontendFramework,
    presetFramework,
    goal: details.goal,
    objective: details.objective,
    acceptanceCriteria: details.acceptanceCriteria ?? [],
    outputContract: details.outputContract ?? '',
    relevantArtifacts: compactArtifacts(details.relevantArtifacts),
    task: compactTaskForCurrentTask(details.task, frontendFramework, presetFramework),
    node: details.node,
    runtimeSession: details.runtimeSession,
    legalNextTargets: details.legalNextTargets ?? [],
    inbox: compactInboxMessages(details.inbox),
    pendingPushes: details.pendingPushes ?? [],
    upstreamContext: details.upstreamContext ?? {},
    workspaceContext: details.workspaceContext ?? {},
    frontendToolHints: details.frontendToolHints,
    presetToolHints: details.presetToolHints,
    progressReportingContract: details.progressReportingContract,
    completionContract: details.completionContract,
    workspaceDir: details.workspaceDir,
    assignment: details.assignment
      ? {
          missionId: details.assignment.missionId,
          nodeId: details.assignment.nodeId,
          roleId: details.assignment.roleId,
          instructionOverride: details.assignment.instructionOverride,
          roleInstructions: details.assignment.roleInstructions,
          goal: details.assignment.goal,
          workspaceDir: details.assignment.workspaceDir,
          terminalId: details.assignment.terminalId,
          modelId: details.assignment.modelId,
          yolo: details.assignment.yolo,
          frontendMode: details.assignment.frontendMode,
          frontendCategory: details.assignment.frontendCategory,
          specProfile: details.assignment.specProfile,
          finalReadmeEnabled: details.assignment.finalReadmeEnabled,
          finalReadmeOwnerNodeId: details.assignment.finalReadmeOwnerNodeId,
          frontendDirection: details.assignment.frontendDirection,
          frontendDirectionReview: details.assignment.frontendDirectionReview,
          frontendFramework,
          frontendToolHints: details.assignment.frontendToolHints,
          presetFramework,
          presetToolHints: details.assignment.presetToolHints,
          progressReportingContract: details.assignment.progressReportingContract,
          workspaceContext: details.assignment.workspaceContext ?? {},
        }
      : details.assignment,
  };
}

export function executeGetCurrentTask(args = {}, callerSessionId = 'unknown') {
  const binding = resolveCurrentTaskBinding(args.sessionId, callerSessionId);
  if (!binding) {
    return makeToolText(
      'No current runtime session is bound. Use get_task_details({ missionId, nodeId }) instead.',
      true,
    );
  }

  const details = buildTaskDetails(binding.missionId, binding.nodeId);
  if (!details) {
    return makeToolText(
      `Task details not found for runtime session ${binding.sessionId}. Use get_task_details({ missionId, nodeId }) with explicit IDs.`,
      true,
    );
  }

  ackAndEmitTaskFetch(details, callerSessionId);
  const responseDetails = compactTaskDetails(details);
  return { content: [{ type: 'text', text: JSON.stringify(responseDetails, null, 2) }] };
}

export function executeGetTaskDetails(args = {}, callerSessionId = 'unknown') {
  const { missionId, nodeId, includeFullFramework = false } = args;
  const details = buildTaskDetails(missionId, nodeId);
  if (!details) return { isError: true, content: [{ type: 'text', text: 'Task details not found.' }] };
  ackAndEmitTaskFetch(details, callerSessionId);
  const responseDetails = includeFullFramework ? details : compactTaskDetails(details);
  return { content: [{ type: 'text', text: JSON.stringify(responseDetails, null, 2) }] };
}

export function executeRecordProgress(args = {}, callerSessionId = 'unknown') {
  const mission = db.prepare('SELECT mission_json FROM compiled_missions WHERE mission_id = ?').get(args.missionId);
  if (!mission) return makeToolText(`Mission ${args.missionId} not found.`, true);

  let nodeExists = false;
  try {
    const parsed = JSON.parse(mission.mission_json);
    nodeExists = Array.isArray(parsed.nodes) && parsed.nodes.some(node => node?.id === args.nodeId);
  } catch {
    nodeExists = false;
  }
  if (!nodeExists) {
    return makeToolText(`Node ${args.nodeId} is not part of mission ${args.missionId}. Use the exact graph node ID.`, true);
  }

  const timestamp = Date.now();
  const payload = {
    missionId: args.missionId,
    runId: args.runId ?? null,
    nodeId: args.nodeId,
    phaseId: args.phaseId ?? null,
    status: args.status,
    title: args.title,
    detail: args.detail ?? null,
    artifactIds: Array.isArray(args.artifactIds) ? args.artifactIds.slice(0, 20) : [],
    filePaths: Array.isArray(args.filePaths) ? args.filePaths.slice(0, 20) : [],
    percentHint: typeof args.percentHint === 'number' ? Math.max(0, Math.min(100, args.percentHint)) : null,
    timestamp,
  };

  appendWorkflowEvent({
    missionId: args.missionId,
    nodeId: args.nodeId,
    sessionId: callerSessionId,
    type: 'agent_progress',
    severity: args.status === 'failed' ? 'error' : args.status === 'blocked' ? 'warning' : 'info',
    message: args.title,
    payload,
  });
  logSession(callerSessionId, 'agent_progress', JSON.stringify(payload), args.missionId, args.nodeId);
  emitAgentEvent({
    type: 'agent:progress',
    sessionId: callerSessionId,
    missionId: args.missionId,
    nodeId: args.nodeId,
    phaseId: args.phaseId ?? undefined,
    status: args.status,
    title: args.title,
    detail: args.detail ?? undefined,
    artifactIds: payload.artifactIds,
    filePaths: payload.filePaths,
    percentHint: payload.percentHint ?? undefined,
    at: timestamp,
  });
  return { content: [{ type: 'text', text: `Progress recorded for ${args.nodeId}: ${args.title}` }] };
}

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
    description: 'Return compact graph task details by default. Set includeFullFramework=true only when debugging Comet-AI framework/template internals.',
    inputSchema: { missionId: z.string(), nodeId: z.string(), includeFullFramework: z.boolean().optional() }
  }, async (args) => executeGetTaskDetails(args, getSessionId() ?? 'unknown'));

  server.registerTool('get_current_task', {
    title: 'Get Current Task',
    description: 'Compatibility alias for runtime-launched agents. Resolves the current mission/node from the bound runtime session, then returns compact task details and acknowledges the task activation.',
    inputSchema: { sessionId: z.string().optional() }
  }, async (args = {}) => executeGetCurrentTask(args, getSessionId() ?? 'unknown'));

  server.registerTool('record_progress', {
    title: 'Record Workflow Progress',
    description: 'Record a concise structured progress update for the current mission/node. Use exact graph node IDs in graph-mode runs.',
    inputSchema: {
      missionId: z.string().min(1),
      runId: z.string().optional(),
      nodeId: z.string().min(1),
      phaseId: z.string().optional(),
      status: z.enum(['started', 'progress', 'completed', 'blocked', 'failed']),
      title: z.string().min(1).max(120),
      detail: z.string().max(500).optional(),
      artifactIds: z.array(z.string()).optional(),
      filePaths: z.array(z.string()).optional(),
      percentHint: z.number().min(0).max(100).optional(),
    }
  }, async (args) => executeRecordProgress(args, getSessionId() ?? 'unknown'));
}
