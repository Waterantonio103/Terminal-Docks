import { z } from 'zod';
import { db } from '../../db/index.mjs';
import { recentAgentEvents, sessions } from '../../state.mjs';
import { makeToolText, parseJsonSafe } from '../../utils/index.mjs';
import { loadCompiledMissionRecord } from '../../utils/workflow.mjs';
import { getDebugRun } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 500;
const DEFAULT_MAX_CHARS = 16_384;
const MAX_CHARS = 64_000;

function safeLimit(value, fallback = DEFAULT_LIMIT) {
  return Number.isInteger(value) && value > 0 && value <= MAX_LIMIT ? value : fallback;
}

function safeMaxChars(value, fallback = DEFAULT_MAX_CHARS) {
  return Number.isInteger(value) && value > 0 && value <= MAX_CHARS ? value : fallback;
}

function truncateText(value, maxChars = DEFAULT_MAX_CHARS) {
  const text = typeof value === 'string' ? value : '';
  if (text.length <= maxChars) return { text, truncated: false };
  return { text: text.slice(text.length - maxChars), truncated: true };
}

function requireDebugRun(debugRunId) {
  const debugRun = getDebugRun(debugRunId);
  if (!debugRun) {
    return { ok: false, response: makeToolText(`Debug run not found: ${debugRunId}`, true) };
  }
  return { ok: true, debugRun };
}

function auditRead(debugRunId, toolName, sessionId, payload = {}) {
  writeDebugEvent(debugRunId, 'debug_tool_called', {
    toolName,
    sessionId: sessionId ?? null,
    ...payload,
  });
  writeDebugEvent(debugRunId, 'debug_evidence_collected', {
    source: toolName,
    ...payload,
  });
}

function jsonResponse(value) {
  return makeToolText(JSON.stringify(value, null, 2));
}

function mapWorkflowEvent(row) {
  return {
    id: row.id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    sessionId: row.session_id,
    terminalId: row.terminal_id,
    type: row.type,
    severity: row.severity,
    message: row.message,
    payload: parseJsonSafe(row.payload_json, null),
    createdAt: row.created_at,
  };
}

function mapSessionLog(row) {
  return {
    id: row.id,
    sessionId: row.session_id,
    eventType: row.event_type,
    content: row.content,
    missionId: row.mission_id,
    nodeId: row.node_id,
    recipientNodeId: row.recipient_node_id,
    isRead: Boolean(row.is_read),
    createdAt: row.created_at,
  };
}

function mapRuntimeSession(row) {
  return {
    sessionId: row.session_id,
    agentId: row.agent_id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    attempt: row.attempt,
    terminalId: row.terminal_id,
    status: row.status,
    runId: row.run_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function getMissionSnapshot(missionId, eventLimit = 100) {
  const record = loadCompiledMissionRecord(missionId);
  if (!record) return null;

  const nodes = db.prepare(
    `SELECT mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome,
            last_payload, datetime(updated_at, 'localtime') AS updated_at
       FROM mission_node_runtime
      WHERE mission_id = ?
      ORDER BY node_id ASC`
  ).all(missionId).map(row => ({
    missionId: row.mission_id,
    nodeId: row.node_id,
    roleId: row.role_id,
    status: row.status,
    attempt: row.attempt,
    currentWaveId: row.current_wave_id,
    lastOutcome: row.last_outcome,
    lastPayload: parseJsonSafe(row.last_payload, row.last_payload),
    updatedAt: row.updated_at,
  }));

  const runtimeSessions = db.prepare(
    `SELECT session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, run_id,
            datetime(created_at, 'localtime') AS created_at,
            datetime(updated_at, 'localtime') AS updated_at
       FROM agent_runtime_sessions
      WHERE mission_id = ?
      ORDER BY updated_at DESC`
  ).all(missionId).map(mapRuntimeSession);

  const events = db.prepare(
    `SELECT id, mission_id, node_id, session_id, terminal_id, type, severity, message,
            payload_json, datetime(created_at, 'localtime') AS created_at
       FROM workflow_events
      WHERE mission_id = ?
      ORDER BY id DESC
      LIMIT ?`
  ).all(missionId, safeLimit(eventLimit, 100)).map(mapWorkflowEvent).reverse();

  const artifacts = db.prepare(
    `SELECT id, mission_id, node_id, session_id, kind, title, content_text, content_json,
            metadata_json, datetime(created_at, 'localtime') AS created_at,
            datetime(updated_at, 'localtime') AS updated_at
       FROM artifacts
      WHERE mission_id = ?
      ORDER BY created_at ASC`
  ).all(missionId).map(row => ({
    id: row.id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    sessionId: row.session_id,
    kind: row.kind,
    title: row.title,
    contentText: row.content_text,
    contentJson: parseJsonSafe(row.content_json, null),
    metadata: parseJsonSafe(row.metadata_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  }));

  const tasks = db.prepare(
    `SELECT id, title, description, status, parent_id, agent_id, from_role, target_role,
            payload, mission_id, node_id, datetime(created_at, 'localtime') AS created_at
       FROM tasks
      WHERE mission_id = ?
      ORDER BY id DESC
      LIMIT 100`
  ).all(missionId).map(row => ({
    ...row,
    payload: parseJsonSafe(row.payload, row.payload),
  }));

  const pendingPushes = db.prepare(
    `SELECT session_id, mission_id, node_id, task_seq, attempt,
            datetime(pushed_at, 'localtime') AS pushed_at,
            datetime(acked_at, 'localtime') AS acked_at
       FROM task_pushes
      WHERE mission_id = ?
      ORDER BY pushed_at DESC
      LIMIT 100`
  ).all(missionId);

  return {
    mission: {
      missionId: record.missionId,
      graphId: record.graphId,
      status: record.status,
      createdAt: record.createdAt,
      updatedAt: record.updatedAt,
      definition: record.mission,
    },
    nodes,
    runtimeSessions,
    events,
    artifacts,
    tasks,
    pendingPushes,
  };
}

export function registerDebugObservabilityTools(server, getSessionId) {
  server.registerTool('debug_get_recent_runtime_logs', {
    title: 'Debug Get Recent Runtime Logs',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().optional(),
      limit: z.number().int().positive().max(MAX_LIMIT).optional(),
    },
  }, async ({ debugRunId, missionId, limit = DEFAULT_LIMIT }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const boundedLimit = safeLimit(limit);

    const workflowRows = missionId
      ? db.prepare(
          `SELECT id, mission_id, node_id, session_id, terminal_id, type, severity, message,
                  payload_json, datetime(created_at, 'localtime') AS created_at
             FROM workflow_events
            WHERE mission_id = ?
            ORDER BY id DESC
            LIMIT ?`
        ).all(missionId, boundedLimit)
      : db.prepare(
          `SELECT id, mission_id, node_id, session_id, terminal_id, type, severity, message,
                  payload_json, datetime(created_at, 'localtime') AS created_at
             FROM workflow_events
            ORDER BY id DESC
            LIMIT ?`
        ).all(boundedLimit);

    const sessionRows = missionId
      ? db.prepare(
          `SELECT id, session_id, event_type, content, mission_id, node_id, recipient_node_id,
                  is_read, datetime(created_at, 'localtime') AS created_at
             FROM session_log
            WHERE mission_id = ?
            ORDER BY id DESC
            LIMIT ?`
        ).all(missionId, boundedLimit)
      : db.prepare(
          `SELECT id, session_id, event_type, content, mission_id, node_id, recipient_node_id,
                  is_read, datetime(created_at, 'localtime') AS created_at
             FROM session_log
            ORDER BY id DESC
            LIMIT ?`
        ).all(boundedLimit);

    auditRead(debugRunId, 'debug_get_recent_runtime_logs', getSessionId?.(), { missionId: missionId ?? null });
    return jsonResponse({
      workflowEvents: workflowRows.map(mapWorkflowEvent).reverse(),
      sessionLogs: sessionRows.map(mapSessionLog).reverse(),
    });
  });

  server.registerTool('debug_get_terminal_tail', {
    title: 'Debug Get Terminal Tail',
    inputSchema: {
      debugRunId: z.string().min(1),
      terminalId: z.string().min(1),
      maxChars: z.number().int().positive().max(MAX_CHARS).optional(),
    },
  }, async ({ debugRunId, terminalId, maxChars = DEFAULT_MAX_CHARS }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const boundedMaxChars = safeMaxChars(maxChars);

    const eventRows = db.prepare(
      `SELECT message, payload_json, datetime(created_at, 'localtime') AS created_at
         FROM workflow_events
        WHERE terminal_id = ?
        ORDER BY id ASC
        LIMIT 500`
    ).all(terminalId);

    const runtimeRows = db.prepare(
      `SELECT session_id, mission_id, node_id, attempt, terminal_id, status,
              datetime(updated_at, 'localtime') AS updated_at
         FROM agent_runtime_sessions
        WHERE terminal_id = ?
        ORDER BY updated_at ASC
        LIMIT 50`
    ).all(terminalId);

    const raw = [
      ...runtimeRows.map(row => `[${row.updated_at}] runtime ${row.session_id} ${row.mission_id}/${row.node_id} attempt=${row.attempt} status=${row.status}`),
      ...eventRows.map(row => {
        const payload = parseJsonSafe(row.payload_json, null);
        const payloadText = payload == null ? '' : ` ${JSON.stringify(payload)}`;
        return `[${row.created_at}] ${row.message}${payloadText}`;
      }),
    ].join('\n');

    const { text, truncated } = truncateText(raw, boundedMaxChars);
    auditRead(debugRunId, 'debug_get_terminal_tail', getSessionId?.(), { terminalId });
    return jsonResponse({
      terminalId,
      tail: text,
      truncated,
      source: 'workflow_events_and_runtime_sessions',
      note: 'Direct PTY ring-buffer tails live in the Tauri process; this MCP tool returns durable terminal-linked runtime evidence.',
    });
  });

  server.registerTool('debug_get_mission_snapshot', {
    title: 'Debug Get Mission Snapshot',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      eventLimit: z.number().int().positive().max(MAX_LIMIT).optional(),
    },
  }, async ({ debugRunId, missionId, eventLimit = 100 }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const snapshot = getMissionSnapshot(missionId, eventLimit);
    if (!snapshot) return makeToolText(`Mission not found: ${missionId}`, true);

    auditRead(debugRunId, 'debug_get_mission_snapshot', getSessionId?.(), { missionId });
    return jsonResponse(snapshot);
  });

  server.registerTool('debug_get_workflow_events', {
    title: 'Debug Get Workflow Events',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      nodeId: z.string().optional(),
      limit: z.number().int().positive().max(MAX_LIMIT).optional(),
    },
  }, async ({ debugRunId, missionId, nodeId, limit = DEFAULT_LIMIT }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const rows = nodeId
      ? db.prepare(
          `SELECT id, mission_id, node_id, session_id, terminal_id, type, severity, message,
                  payload_json, datetime(created_at, 'localtime') AS created_at
             FROM workflow_events
            WHERE mission_id = ? AND node_id = ?
            ORDER BY id DESC
            LIMIT ?`
        ).all(missionId, nodeId, safeLimit(limit))
      : db.prepare(
          `SELECT id, mission_id, node_id, session_id, terminal_id, type, severity, message,
                  payload_json, datetime(created_at, 'localtime') AS created_at
             FROM workflow_events
            WHERE mission_id = ?
            ORDER BY id DESC
            LIMIT ?`
        ).all(missionId, safeLimit(limit));

    auditRead(debugRunId, 'debug_get_workflow_events', getSessionId?.(), { missionId, nodeId: nodeId ?? null });
    return jsonResponse({ events: rows.map(mapWorkflowEvent).reverse() });
  });

  server.registerTool('debug_get_mcp_events', {
    title: 'Debug Get MCP Events',
    inputSchema: {
      debugRunId: z.string().min(1),
      sessionId: z.string().optional(),
      limit: z.number().int().positive().max(MAX_LIMIT).optional(),
    },
  }, async ({ debugRunId, sessionId, limit = DEFAULT_LIMIT }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const boundedLimit = safeLimit(limit);
    const memoryEvents = recentAgentEvents
      .filter(event => !sessionId || event.sessionId === sessionId)
      .slice(-boundedLimit);
    const sessionLogs = sessionId
      ? db.prepare(
          `SELECT id, session_id, event_type, content, mission_id, node_id, recipient_node_id,
                  is_read, datetime(created_at, 'localtime') AS created_at
             FROM session_log
            WHERE session_id = ?
            ORDER BY id DESC
            LIMIT ?`
        ).all(sessionId, boundedLimit)
      : db.prepare(
          `SELECT id, session_id, event_type, content, mission_id, node_id, recipient_node_id,
                  is_read, datetime(created_at, 'localtime') AS created_at
             FROM session_log
            ORDER BY id DESC
            LIMIT ?`
        ).all(boundedLimit);

    auditRead(debugRunId, 'debug_get_mcp_events', getSessionId?.(), { sessionId: sessionId ?? null });
    return jsonResponse({
      recentAgentEvents: memoryEvents,
      sessionLogs: sessionLogs.map(mapSessionLog).reverse(),
    });
  });

  server.registerTool('debug_get_frontend_errors', {
    title: 'Debug Get Frontend Errors',
    inputSchema: {
      debugRunId: z.string().min(1),
      limit: z.number().int().positive().max(MAX_LIMIT).optional(),
    },
  }, async ({ debugRunId, limit = DEFAULT_LIMIT }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const rows = db.prepare(
      `SELECT id, timestamp, kind, name, message, stack, route, component, payload_json,
              datetime(created_at, 'localtime') AS created_at
         FROM debug_frontend_errors
        ORDER BY id DESC
        LIMIT ?`
    ).all(safeLimit(limit)).map(row => ({
      id: row.id,
      timestamp: row.timestamp ?? row.created_at,
      kind: row.kind,
      name: row.name,
      message: row.message,
      stack: row.stack,
      route: row.route,
      component: row.component,
      payload: parseJsonSafe(row.payload_json, null),
      createdAt: row.created_at,
    })).reverse();

    auditRead(debugRunId, 'debug_get_frontend_errors', getSessionId?.());
    return jsonResponse({ errors: rows });
  });

  server.registerTool('debug_get_active_sessions', {
    title: 'Debug Get Active Sessions',
    inputSchema: {
      debugRunId: z.string().min(1),
      includeMemorySessions: z.boolean().optional(),
    },
  }, async ({ debugRunId, includeMemorySessions = true }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const runtimeSessions = db.prepare(
      `SELECT session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, run_id,
              datetime(created_at, 'localtime') AS created_at,
              datetime(updated_at, 'localtime') AS updated_at
         FROM agent_runtime_sessions
        WHERE status NOT IN ('completed', 'failed', 'cancelled', 'disconnected')
        ORDER BY updated_at DESC
        LIMIT 200`
    ).all().map(mapRuntimeSession);

    const memorySessions = includeMemorySessions
      ? Object.entries(sessions).map(([sessionId, value]) => ({
          sessionId,
          role: value.role ?? null,
          profileId: value.profileId ?? null,
          agentId: value.agentId ?? null,
          terminalId: value.terminalId ?? null,
          cli: value.cli ?? null,
          missionId: value.missionId ?? null,
          nodeId: value.nodeId ?? null,
          status: value.status ?? null,
          connectedAt: value.connectedAt ?? null,
          updatedAt: value.updatedAt ?? null,
        }))
      : undefined;

    auditRead(debugRunId, 'debug_get_active_sessions', getSessionId?.());
    return jsonResponse({ runtimeSessions, memorySessions });
  });

  server.registerTool('debug_get_active_ptys', {
    title: 'Debug Get Active PTYs',
    inputSchema: {
      debugRunId: z.string().min(1),
    },
  }, async ({ debugRunId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const rows = db.prepare(
      `SELECT session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, run_id,
              datetime(created_at, 'localtime') AS created_at,
              datetime(updated_at, 'localtime') AS updated_at
         FROM agent_runtime_sessions
        WHERE terminal_id IS NOT NULL
          AND terminal_id != ''
          AND status NOT IN ('completed', 'failed', 'cancelled', 'disconnected')
        ORDER BY updated_at DESC
        LIMIT 200`
    ).all().map(mapRuntimeSession);

    auditRead(debugRunId, 'debug_get_active_ptys', getSessionId?.());
    return jsonResponse({
      ptys: rows.map(row => ({
        terminalId: row.terminalId,
        sessionId: row.sessionId,
        missionId: row.missionId,
        nodeId: row.nodeId,
        status: row.status,
        updatedAt: row.updatedAt,
      })),
      source: 'agent_runtime_sessions',
      note: 'This lists runtime sessions with active-looking terminal bindings; direct PTY liveness is owned by Tauri.',
    });
  });

  server.registerTool('debug_get_node_state', {
    title: 'Debug Get Node State',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().min(1),
      nodeId: z.string().min(1),
    },
  }, async ({ debugRunId, missionId, nodeId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const snapshot = getMissionSnapshot(missionId, 100);
    if (!snapshot) return makeToolText(`Mission not found: ${missionId}`, true);
    const definitionNode = snapshot.mission.definition?.nodes?.find(node => node.id === nodeId) ?? null;
    const runtime = snapshot.nodes.find(node => node.nodeId === nodeId) ?? null;
    const runtimeSessions = snapshot.runtimeSessions.filter(session => session.nodeId === nodeId);
    const events = snapshot.events.filter(event => event.nodeId === nodeId);
    const artifacts = snapshot.artifacts.filter(artifact => artifact.nodeId === nodeId);

    auditRead(debugRunId, 'debug_get_node_state', getSessionId?.(), { missionId, nodeId });
    return jsonResponse({ missionId, nodeId, definitionNode, runtime, runtimeSessions, events, artifacts });
  });

  server.registerTool('debug_search_logs', {
    title: 'Debug Search Logs',
    inputSchema: {
      debugRunId: z.string().min(1),
      query: z.string().min(1),
      missionId: z.string().optional(),
      limit: z.number().int().positive().max(MAX_LIMIT).optional(),
    },
  }, async ({ debugRunId, query, missionId, limit = DEFAULT_LIMIT }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const like = `%${query}%`;
    const boundedLimit = safeLimit(limit);
    const workflowEvents = missionId
      ? db.prepare(
          `SELECT id, mission_id, node_id, session_id, terminal_id, type, severity, message,
                  payload_json, datetime(created_at, 'localtime') AS created_at
             FROM workflow_events
            WHERE mission_id = ? AND (message LIKE ? OR type LIKE ? OR payload_json LIKE ?)
            ORDER BY id DESC
            LIMIT ?`
        ).all(missionId, like, like, like, boundedLimit)
      : db.prepare(
          `SELECT id, mission_id, node_id, session_id, terminal_id, type, severity, message,
                  payload_json, datetime(created_at, 'localtime') AS created_at
             FROM workflow_events
            WHERE message LIKE ? OR type LIKE ? OR payload_json LIKE ?
            ORDER BY id DESC
            LIMIT ?`
        ).all(like, like, like, boundedLimit);

    const sessionLogs = missionId
      ? db.prepare(
          `SELECT id, session_id, event_type, content, mission_id, node_id, recipient_node_id,
                  is_read, datetime(created_at, 'localtime') AS created_at
             FROM session_log
            WHERE mission_id = ? AND (event_type LIKE ? OR content LIKE ?)
            ORDER BY id DESC
            LIMIT ?`
        ).all(missionId, like, like, boundedLimit)
      : db.prepare(
          `SELECT id, session_id, event_type, content, mission_id, node_id, recipient_node_id,
                  is_read, datetime(created_at, 'localtime') AS created_at
             FROM session_log
            WHERE event_type LIKE ? OR content LIKE ?
            ORDER BY id DESC
            LIMIT ?`
        ).all(like, like, boundedLimit);

    auditRead(debugRunId, 'debug_search_logs', getSessionId?.(), { missionId: missionId ?? null, query });
    return jsonResponse({
      query,
      workflowEvents: workflowEvents.map(mapWorkflowEvent).reverse(),
      sessionLogs: sessionLogs.map(mapSessionLog).reverse(),
    });
  });
}
