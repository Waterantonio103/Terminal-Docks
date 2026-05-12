import { db } from '../db/index.mjs';
import { parseJsonSafe } from '../utils/index.mjs';
import { getMissionNode, getMissionNodeRuntime, getRuntimeSessionByAttempt, getLegalOutgoingTargets, loadCompiledMissionRecord } from '../utils/workflow.mjs';
import { ackTaskPush, emitAgentEvent } from '../state.mjs';
import { buildFrontendSpecFramework } from '../utils/frontend-spec-framework.mjs';

export function extractUpstreamContext(inboxMessages) {
  const findings = [];
  const summaries = [];
  const filesChanged = [];
  const artifactReferences = [];

  for (const msg of inboxMessages) {
    const parsed = msg.content_json ?? {};
    const completionStr = parsed.payload ?? parsed.completion;
    let completion = null;
    if (typeof completionStr === 'string') {
      try { completion = JSON.parse(completionStr); } catch { /* ignore */ }
    } else if (completionStr && typeof completionStr === 'object') {
      completion = completionStr;
    }
    if (!completion) continue;

    if (typeof completion.summary === 'string' && completion.summary.trim()) {
      summaries.push({ fromNodeId: parsed.fromNodeId ?? null, summary: completion.summary.trim() });
    }
    if (Array.isArray(completion.keyFindings)) {
      for (const f of completion.keyFindings) {
        if (typeof f === 'string' && f.trim()) findings.push(f.trim());
      }
    }
    if (Array.isArray(completion.filesChanged)) {
      for (const f of completion.filesChanged) {
        if (typeof f === 'string' && f.trim() && !filesChanged.includes(f.trim())) {
          filesChanged.push(f.trim());
        }
      }
    }
    if (Array.isArray(completion.artifactReferences)) {
      for (const a of completion.artifactReferences) {
        if (typeof a === 'string' && a.trim() && !artifactReferences.includes(a.trim())) {
          artifactReferences.push(a.trim());
        }
      }
    }
  }

  return { keyFindings: findings, summaries, filesChanged, artifactReferences };
}

export function buildTaskDetails(missionId, nodeId) {
  const record = loadCompiledMissionRecord(missionId);

  if (!record) {
    const runtime = getMissionNodeRuntime(missionId, nodeId);
    if (!runtime) return null;
    const runtimeSession = Number.isInteger(runtime.attempt) && runtime.attempt > 0
      ? getRuntimeSessionByAttempt(missionId, nodeId, runtime.attempt)
      : null;
    return {
      missionId,
      nodeId,
      goal: '',
      graphId: null,
      missionStatus: 'active',
      authoringMode: 'adhoc',
      presetId: null,
      runVersion: 1,
      frontendMode: 'off',
      frontendCategory: 'marketing_site',
      specProfile: 'none',
      objective: '',
      task: null,
      node: {
        id: nodeId,
        roleId: runtime.role_id ?? 'agent',
        instructionOverride: '',
        status: runtime.status ?? 'running',
        attempt: runtime.attempt ?? 0,
        currentWaveId: null,
        lastOutcome: null,
        lastPayload: null,
        updatedAt: runtime.updated_at ?? null,
      },
      runtimeSession: runtimeSession ? {
        sessionId: runtimeSession.session_id,
        agentId: runtimeSession.agent_id,
        terminalId: runtimeSession.terminal_id,
        status: runtimeSession.status,
        createdAt: runtimeSession.created_at,
        updatedAt: runtimeSession.updated_at,
      } : null,
      legalNextTargets: [],
      latestTask: null,
      recentTasks: [],
      inbox: [],
      pendingPushes: [],
      upstreamContext: {},
      completionContract: {
        requiredTool: 'complete_task',
        authority: 'MCP task:completed event',
        note: 'Natural-language final answers do not complete a graph node. Call complete_task with missionId, nodeId, attempt, outcome, and summary as the final MCP action.',
      },
      workspaceDir: null,
      assignment: null,
    };
  }

  const node = getMissionNode(record.mission, nodeId);
  if (!node) return null;

  const runtime = getMissionNodeRuntime(missionId, nodeId);
  const runtimeSession =
    runtime && Number.isInteger(runtime.attempt) && runtime.attempt > 0
      ? getRuntimeSessionByAttempt(missionId, nodeId, runtime.attempt)
      : null;
  const recentTasks = db.prepare(
    "SELECT id, title, description, status, datetime(created_at, 'localtime') AS created_at, parent_id, agent_id, from_role, target_role, payload, mission_id, node_id FROM tasks WHERE mission_id = ? AND node_id = ? ORDER BY id DESC LIMIT 10"
  ).all(missionId, nodeId).map(task => ({
    ...task,
    payload_json: parseJsonSafe(task.payload),
  }));

  const inbox = db.prepare(
    "SELECT id, session_id, event_type, content, datetime(created_at, 'localtime') AS created_at, is_read FROM session_log WHERE mission_id = ? AND recipient_node_id = ? ORDER BY id DESC LIMIT 20"
  ).all(missionId, nodeId).map(message => ({
    ...message,
    content_json: parseJsonSafe(message.content),
  }));

  const pendingPushes = runtimeSession
    ? db.prepare(
        `SELECT mission_id, node_id, task_seq, attempt, datetime(pushed_at, 'localtime') AS pushed_at
           FROM task_pushes
          WHERE session_id = ? AND mission_id = ? AND node_id = ? AND acked_at IS NULL
          ORDER BY task_seq ASC`
      ).all(runtimeSession.session_id, missionId, nodeId)
    : [];

  const upstreamContext = extractUpstreamContext(inbox);

  const artifacts = db.prepare(
    "SELECT id, kind, title, content_text, created_at FROM artifacts WHERE mission_id = ? ORDER BY created_at ASC"
  ).all(missionId);

  const events = db.prepare(
    "SELECT id, type, severity, message, created_at FROM workflow_events WHERE mission_id = ? ORDER BY id ASC"
  ).all(missionId);
  const frontendMode = record.mission.metadata?.frontendMode ?? 'off';
  const frontendCategory = record.mission.metadata?.frontendCategory ?? 'marketing_site';
  const specProfile = record.mission.metadata?.specProfile ?? 'none';
  const frontendFramework = frontendMode !== 'off' || specProfile === 'frontend_three_file'
    ? buildFrontendSpecFramework({ categoryId: frontendCategory, mode: frontendMode === 'off' ? 'aligned' : frontendMode })
    : null;

  return {
    missionId,
    nodeId,
    graphId: record.graphId,
    missionStatus: record.status,
    authoringMode: record.mission.metadata?.authoringMode ?? null,
    presetId: record.mission.metadata?.presetId ?? null,
    runVersion: Number.isInteger(record.mission.metadata?.runVersion) ? record.mission.metadata.runVersion : 1,
    frontendMode,
    frontendCategory,
    specProfile,
    frontendFramework,
    goal: record.mission.task?.prompt ?? '',
    objective: node.instructionOverride || record.mission.task?.prompt || '',
    acceptanceCriteria: node.acceptanceCriteria || [],
    outputContract: node.outputContract || '',
    relevantArtifacts: artifacts,
    relevantEvents: events,
    task: record.mission.task ?? null,
    node: {
      id: node.id,
      roleId: node.roleId,
      instructionOverride: node.instructionOverride ?? '',
      status: runtime?.status ?? 'idle',
      attempt: runtime?.attempt ?? 0,
      currentWaveId: runtime?.current_wave_id ?? null,
      lastOutcome: runtime?.last_outcome ?? null,
      lastPayload: runtime?.last_payload ?? null,
      updatedAt: runtime?.updated_at ?? null,
    },
    runtimeSession: runtimeSession
      ? {
          sessionId: runtimeSession.session_id,
          agentId: runtimeSession.agent_id,
          terminalId: runtimeSession.terminal_id,
          status: runtimeSession.status,
          createdAt: runtimeSession.created_at,
          updatedAt: runtimeSession.updated_at,
        }
      : null,
    legalNextTargets: getLegalOutgoingTargets(record.mission, nodeId),
    latestTask: recentTasks[0] ?? null,
    recentTasks,
    inbox,
    pendingPushes,
    upstreamContext,
    completionContract: {
      requiredTool: 'complete_task',
      authority: 'MCP task:completed event',
      note: 'Natural-language final answers do not complete a graph node. Role-only handoffs also do not complete graph nodes. Prefer complete_task with missionId, nodeId, attempt, outcome, and summary. If you intentionally use handoff_task, include missionId, fromNodeId, fromAttempt, and an exact legal targetNodeId.',
    },
    workspaceDir: record.mission.task?.workspaceDir ?? null,
    assignment: {
      missionId,
      nodeId,
      roleId: node.roleId,
      instructionOverride: node.instructionOverride ?? '',
      goal: record.mission.task?.prompt ?? '',
      workspaceDir: record.mission.task?.workspaceDir ?? null,
      terminalId: node.terminal?.terminalId ?? runtimeSession?.terminal_id ?? null,
      modelId: node.terminal?.model ?? null,
      yolo: Boolean(node.terminal?.yolo),
      frontendMode,
      frontendCategory,
      specProfile,
      frontendFramework,
    },
  };
}

export function ackAndEmitTaskFetch(details, callerSessionId) {
  if (!details) return;
  const targetSid = details.runtimeSession?.sessionId ?? callerSessionId ?? null;
  const currentAttempt = Number(details.node?.attempt ?? 0);
  if (!targetSid || !Number.isInteger(currentAttempt) || currentAttempt < 1) return;
  const nodeId = details.nodeId ?? details.node?.id;
  if (!nodeId) return;

  ackTaskPush({
    sessionId: targetSid,
    missionId: details.missionId,
    nodeId,
    taskSeq: currentAttempt,
  });

  const ackableStatuses = [
    'adapter_starting',
    'mcp_connecting',
    'registered',
    'ready',
    'activation_pending',
    'activated',
    'dispatched',
  ];
  db.prepare(
    `UPDATE agent_runtime_sessions
        SET status = 'activation_acked', updated_at = CURRENT_TIMESTAMP
      WHERE session_id = ?
        AND mission_id = ?
        AND node_id = ?
        AND attempt = ?
        AND status IN (${ackableStatuses.map(() => '?').join(',')})`
  ).run(targetSid, details.missionId, nodeId, currentAttempt, ...ackableStatuses);
  db.prepare(
    `UPDATE mission_node_runtime
        SET status = 'activation_acked', updated_at = CURRENT_TIMESTAMP
      WHERE mission_id = ?
        AND node_id = ?
        AND attempt = ?
        AND status IN (${ackableStatuses.map(() => '?').join(',')})`
  ).run(details.missionId, nodeId, currentAttempt, ...ackableStatuses);

  emitAgentEvent({
    type: 'activation:acked',
    sessionId: targetSid,
    missionId: details.missionId,
    nodeId,
    attempt: currentAttempt,
    taskSeq: currentAttempt,
    at: Date.now(),
  });

  if (callerSessionId && callerSessionId !== targetSid) {
    emitAgentEvent({
      type: 'activation:acked',
      sessionId: callerSessionId,
      missionId: details.missionId,
      nodeId,
      attempt: currentAttempt,
      taskSeq: currentAttempt,
      at: Date.now(),
    });
  }
}
