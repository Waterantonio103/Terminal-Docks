import { db } from '../db/index.mjs';
import { makeToolText, appendWorkflowEvent, logSession, parseJsonSafe } from '../utils/index.mjs';
import { broadcast, emitAgentEvent, sessions, ackTaskPush } from '../state.mjs';
import { loadCompiledMissionRecord, getMissionNode, getMissionNodeRuntime, allowedOutcomesForCondition, getRuntimeSessionByAttempt } from '../utils/workflow.mjs';

function normalizeCompletionStatus(value) {
  if (value === 'success' || value === 'failure') return value;
  if (typeof value !== 'string') return null;
  const normalized = value.trim().toLowerCase();
  return normalized === 'success' || normalized === 'failure' ? normalized : null;
}

function normalizeStringArray(input) {
  if (!Array.isArray(input)) return [];
  return input
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

function buildStructuredCompletionPayload({
  completion,
  payload,
  title,
  description,
  finalOutcome,
  keyFindings,
}) {
  const completionObj = completion && typeof completion === 'object' ? completion : {};
  const status = finalOutcome
    ?? normalizeCompletionStatus(completionObj.status)
    ?? 'success';
  const summary = typeof completionObj.summary === 'string' && completionObj.summary.trim()
    ? completionObj.summary.trim()
    : (typeof description === 'string' && description.trim() ? description.trim() : String(title ?? 'Handoff completed'));

  const resolvedFindings = normalizeStringArray(
    keyFindings ?? completionObj.keyFindings
  );

  return {
    status,
    summary,
    artifactReferences: normalizeStringArray(completionObj.artifactReferences),
    filesChanged: normalizeStringArray(completionObj.filesChanged),
    keyFindings: resolvedFindings,
    downstreamPayload: completionObj.downstreamPayload !== undefined ? completionObj.downstreamPayload : (payload ?? null),
  };
}

function requireRuntimeSessionForAttempt(missionId, nodeId, attempt) {
  const row = getRuntimeSessionByAttempt(missionId, nodeId, attempt);
  if (!row) {
    return { error: `No runtime session registration found for ${missionId}/${nodeId} attempt ${attempt}.` };
  }
  return { row };
}

const ACTIVE_RUNTIME_SESSION_STATUSES = new Set([
  'adapter_starting',
  'activation_pending',
  'registered',
  'activated',
  'ready',
  'activation_acked',
  'running',
  'dispatched',
]);

function nodeRuntimeIsRunning(missionId, nodeId, attempt) {
  const runtime = getMissionNodeRuntime(missionId, nodeId);
  if (!runtime) {
    return { error: `Node ${nodeId} is not currently running in mission ${missionId}.` };
  }
  if (runtime.attempt !== attempt) {
    return {
      error: `Stale attempt for ${nodeId}. attempt=${attempt}, currentAttempt=${runtime.attempt}.`,
    };
  }
  const sessionValidation = requireRuntimeSessionForAttempt(missionId, nodeId, attempt);
  if (sessionValidation.error) {
    return { error: `${sessionValidation.error} Activation drift detected.` };
  }
  if (runtime.status !== 'running') {
    const sessionStatus = String(sessionValidation.row.status ?? '').toLowerCase();
    if (!ACTIVE_RUNTIME_SESSION_STATUSES.has(sessionStatus)) {
      return { error: `Node ${nodeId} is not currently running in mission ${missionId}.` };
    }

    // Native activation updates can arrive out of order under chained live
    // workflows. If the registered runtime session is still active, complete
    // against that session and repair the node runtime status before routing.
    db.prepare(
      "UPDATE mission_node_runtime SET status = 'running', updated_at = CURRENT_TIMESTAMP WHERE mission_id = ? AND node_id = ? AND attempt = ?"
    ).run(missionId, nodeId, attempt);
    runtime.status = 'running';
  }
  return { runtime, runtimeSession: sessionValidation.row };
}

function matchingOutgoingTargets(mission, fromNodeId, outcome) {
  const nodeById = new Map((mission?.nodes ?? []).map(node => [node.id, node]));
  return (mission?.edges ?? [])
    .filter(edge => edge.fromNodeId === fromNodeId)
    .filter(edge => allowedOutcomesForCondition(edge.condition).includes(outcome))
    .map(edge => ({
      edge,
      targetNode: nodeById.get(edge.toNodeId) ?? null,
    }))
    .filter(entry => entry.targetNode);
}

function validateGraphHandoffArgs({
  missionId,
  fromNodeId,
  targetNodeId,
  fromAttempt,
  outcome,
}) {
  if (!missionId) return { ok: true };
  if (!fromNodeId || !Number.isInteger(fromAttempt) || fromAttempt < 1) {
    return {
      ok: false,
      error: 'Graph handoff requires missionId, fromNodeId, fromAttempt, and an exact targetNodeId when routing. Role-only handoffs do not complete graph nodes.',
    };
  }

  const record = loadCompiledMissionRecord(missionId);
  if (!record) return { ok: false, error: 'Mission not found.' };
  const fromNode = getMissionNode(record.mission, fromNodeId);
  if (!fromNode) return { ok: false, error: 'Node not found.' };

  const legalTargets = matchingOutgoingTargets(record.mission, fromNodeId, outcome);
  if (legalTargets.length > 0 && !targetNodeId) {
    return {
      ok: false,
      error: `Graph handoff from ${fromNodeId} requires an exact targetNodeId. Legal targets for outcome ${outcome}: ${legalTargets.map(entry => entry.targetNode.id).join(', ')}.`,
    };
  }
  if (targetNodeId && !legalTargets.some(entry => entry.targetNode.id === targetNodeId)) {
    return {
      ok: false,
      error: `Illegal graph handoff target ${targetNodeId} from ${fromNodeId} for outcome ${outcome}. Legal targets: ${legalTargets.map(entry => entry.targetNode.id).join(', ') || '(none)'}.`,
    };
  }

  return { ok: true, record, fromNode };
}

function markRuntimeCompletion({
  missionId,
  nodeId,
  attempt,
  outcome,
  structuredCompletion,
}) {
  const status = outcome === 'failure' ? 'failed' : 'completed';
  const payload = JSON.stringify(structuredCompletion ?? null);
  const sessionRows = db.prepare(
    `SELECT session_id FROM agent_runtime_sessions
      WHERE mission_id = ? AND node_id = ? AND attempt = ?`
  ).all(missionId, nodeId, attempt);

  db.prepare(
    `UPDATE mission_node_runtime
        SET status = ?,
            last_outcome = ?,
            last_payload = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE mission_id = ? AND node_id = ? AND attempt = ?`
  ).run(status, outcome, payload, missionId, nodeId, attempt);

  db.prepare(
    `UPDATE agent_runtime_sessions
        SET status = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE mission_id = ? AND node_id = ? AND attempt = ?`
  ).run(status, missionId, nodeId, attempt);

  for (const row of sessionRows) {
    if (sessions[row.session_id]) {
      sessions[row.session_id].status = status;
      sessions[row.session_id].updatedAt = Date.now();
    }
  }

  refreshMissionTerminalStatus(missionId);
}

function refreshMissionTerminalStatus(missionId) {
  const record = loadCompiledMissionRecord(missionId);
  const nodeIds = record?.mission?.nodes?.map(node => node.id) ?? [];
  if (nodeIds.length === 0) return;

  const rows = db.prepare(
    `SELECT node_id, status, last_outcome
       FROM mission_node_runtime
      WHERE mission_id = ?`
  ).all(missionId);
  if (rows.length < nodeIds.length) return;

  const runtimeByNode = new Map(rows.map(row => [row.node_id, row]));
  const terminalStatuses = new Set(['completed', 'failed', 'cancelled']);
  const allTerminal = nodeIds.every(nodeId => terminalStatuses.has(runtimeByNode.get(nodeId)?.status));
  if (!allTerminal) return;

  const hasFailure = nodeIds.some(nodeId => {
    const runtime = runtimeByNode.get(nodeId);
    return runtime?.status === 'failed' || runtime?.last_outcome === 'failure' || runtime?.status === 'cancelled';
  });
  const nextStatus = hasFailure ? 'failed' : 'completed';

  const current = db.prepare(
    `SELECT status
       FROM compiled_missions
      WHERE mission_id = ?`
  ).get(missionId);
  if (current?.status === nextStatus) return;

  db.prepare(
    `UPDATE compiled_missions
        SET status = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE mission_id = ?`
  ).run(nextStatus, missionId);

  appendWorkflowEvent({
    missionId,
    type: 'workflow_completed',
    severity: hasFailure ? 'warning' : 'info',
    message: `Workflow ${missionId} reached ${nextStatus} state.`,
    payload: {
      status: nextStatus,
      nodeCount: nodeIds.length,
    },
  });
}

function persistGraphHandoff({
  sid,
  missionId,
  fromNodeId,
  targetNodeId,
  fromRole,
  targetRole,
  title,
  description,
  parentTaskId,
  outcome,
  fromAttempt,
  structuredCompletion,
}) {
  const payloadStr = JSON.stringify(structuredCompletion);
  let taskId = null;

  if (targetRole && targetRole !== 'done') {
    const info = db.prepare(
      'INSERT INTO tasks (title, description, agent_id, parent_id, status, from_role, target_role, payload, mission_id, node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(title, description ?? null, targetRole, parentTaskId ?? null, 'todo', fromRole, targetRole, payloadStr, missionId ?? null, targetNodeId ?? null);
    taskId = info.lastInsertRowid;

    if (targetNodeId) {
      const handoffMessage = JSON.stringify({
        taskId,
        title,
        description: description ?? null,
        missionId,
        fromNodeId,
        targetNodeId,
        fromRole,
        targetRole,
        outcome,
        fromAttempt,
        payload: payloadStr,
        completion: structuredCompletion,
      });
      db.prepare(
        "INSERT INTO session_log (session_id, event_type, content, mission_id, node_id, recipient_node_id, is_read) VALUES (?, 'message', ?, ?, ?, ?, 0)"
      ).run(sid, handoffMessage, missionId, fromNodeId, targetNodeId);
    }

    broadcast(fromRole ?? 'graph', JSON.stringify({
      taskId,
      agentId: targetRole,
      parentTaskId: parentTaskId ?? null,
      status: 'todo',
      missionId,
      targetNodeId,
    }), 'task_update');
  }

  const eventBody = {
    taskId,
    fromRole,
    targetRole,
    title,
    description: description ?? null,
    payload: payloadStr,
    completion: structuredCompletion,
    missionId,
    fromNodeId,
    targetNodeId: targetNodeId ?? null,
    outcome,
    fromAttempt,
  };
  broadcast(fromRole ?? 'graph', JSON.stringify(eventBody), 'handoff');

  appendWorkflowEvent({
    missionId,
    nodeId: fromNodeId,
    sessionId: sid,
    type: 'handoff_task',
    message: targetNodeId
      ? `Node ${fromNodeId} handed off to ${targetNodeId}.`
      : `Node ${fromNodeId} completed without a downstream target.`,
    payload: eventBody,
  });

  return { taskId, eventBody };
}

export function executeHandoffTask(args, sid) {
  let { fromRole, targetRole, title, description, payload, completion, parentTaskId, missionId, fromNodeId, targetNodeId, outcome, fromAttempt } = args;
  let runtimeValidation = null;
  const normalizedOutcome = outcome?.trim().toLowerCase() ?? 'success';

  const graphValidation = validateGraphHandoffArgs({
    missionId,
    fromNodeId,
    targetNodeId,
    fromAttempt,
    outcome: normalizedOutcome,
  });
  if (!graphValidation.ok) return makeToolText(graphValidation.error, true);

  if (missionId && fromNodeId) {
    runtimeValidation = nodeRuntimeIsRunning(missionId, fromNodeId, fromAttempt);
    if (runtimeValidation.error) {
      // Return the specific error text the tests expect
      const errorText = runtimeValidation.error.replace('Stale attempt', 'Stale handoff attempt');
      return makeToolText(errorText, true);
    }

    if (!fromRole || (targetNodeId && !targetRole)) {
      const record = loadCompiledMissionRecord(missionId);
      if (record) {
        const fNode = getMissionNode(record.mission, fromNodeId);
        if (fNode && !fromRole) fromRole = fNode.roleId;
        if (targetNodeId && !targetRole) {
          const tNode = getMissionNode(record.mission, targetNodeId);
          if (tNode) targetRole = tNode.roleId;
        }
      }
    }
  }

  const structuredCompletion = buildStructuredCompletionPayload({
    completion,
    payload,
    title,
    description,
    finalOutcome: normalizedOutcome,
  });

  const { taskId, eventBody } = persistGraphHandoff({
    sid,
    missionId,
    fromNodeId,
    targetNodeId,
    fromRole,
    targetRole,
    title,
    description,
    parentTaskId,
    outcome: normalizedOutcome,
    fromAttempt,
    structuredCompletion,
  });

  emitAgentEvent({
    type: 'task:completed',
    sessionId: runtimeValidation?.runtimeSession?.session_id ?? sid,
    transportSessionId: sid,
    missionId,
    nodeId: fromNodeId,
    attempt: fromAttempt,
    outcome: normalizedOutcome,
    targetNodeId: targetNodeId ?? null,
    at: Date.now(),
    payload: structuredCompletion,
  });

  if (missionId && fromNodeId && Number.isInteger(fromAttempt)) {
    markRuntimeCompletion({
      missionId,
      nodeId: fromNodeId,
      attempt: fromAttempt,
      outcome: normalizedOutcome,
      structuredCompletion,
    });
  }

  return makeToolText(JSON.stringify({ taskId, status: 'handoff_recorded', eventBody }, null, 2));
}

export function executeCompleteTask(args, sid) {
  const {
    missionId,
    nodeId,
    attempt,
    outcome,
    title,
    summary,
    rawOutput,
    logRef,
    filesChanged,
    artifactReferences,
    keyFindings,
    downstreamPayload,
    parentTaskId,
  } = args;

  const normalizedOutcome = normalizeCompletionStatus(outcome);
  if (!missionId || !nodeId || !Number.isInteger(attempt) || attempt < 1 || !normalizedOutcome) {
    return makeToolText('Invalid completion parameters.', true);
  }

  const record = loadCompiledMissionRecord(missionId);
  if (!record) return makeToolText('Mission not found.', true);
  const node = getMissionNode(record.mission, nodeId);
  if (!node) return makeToolText('Node not found.', true);

  const runtimeCheck = nodeRuntimeIsRunning(missionId, nodeId, attempt);
  if (runtimeCheck.error) return makeToolText(runtimeCheck.error, true);

  const structuredCompletion = buildStructuredCompletionPayload({
    completion: { summary, filesChanged, artifactReferences, keyFindings },
    payload: downstreamPayload,
    title,
    description: summary,
    finalOutcome: normalizedOutcome,
  });
  structuredCompletion.rawOutput = rawOutput;
  structuredCompletion.logRef = logRef;

  const targets = matchingOutgoingTargets(record.mission, nodeId, normalizedOutcome);
  const routed = [];
  
  if (targets.length === 0) {
    persistGraphHandoff({
      sid, missionId, fromNodeId: nodeId, targetNodeId: null,
      fromRole: node.roleId, targetRole: 'done',
      title: title ?? summary, description: summary, parentTaskId,
      outcome: normalizedOutcome, fromAttempt: attempt,
      structuredCompletion,
    });
  } else {
    for (const { targetNode } of targets) {
      const { taskId } = persistGraphHandoff({
        sid, missionId, fromNodeId: nodeId, targetNodeId: targetNode.id,
        fromRole: node.roleId, targetRole: targetNode.roleId,
        title: title ?? summary, description: summary, parentTaskId,
        outcome: normalizedOutcome, fromAttempt: attempt,
        structuredCompletion,
      });
      routed.push({ targetNodeId: targetNode.id, taskId });
    }
  }

  emitAgentEvent({
    type: 'task:completed',
    sessionId: runtimeCheck.runtimeSession.session_id,
    transportSessionId: sid,
    missionId,
    nodeId,
    attempt,
    outcome: normalizedOutcome,
    summary: structuredCompletion.summary,
    at: Date.now(),
  });

  appendWorkflowEvent({
    missionId,
    nodeId,
    sessionId: sid,
    type: 'node_completed',
    severity: normalizedOutcome === 'failure' ? 'warning' : 'info',
    message: `Node ${nodeId} completed with outcome ${normalizedOutcome}.`,
    payload: { outcome: normalizedOutcome, routed }
  });

  markRuntimeCompletion({
    missionId,
    nodeId,
    attempt,
    outcome: normalizedOutcome,
    structuredCompletion,
  });

  return makeToolText(JSON.stringify({ status: 'completed', routed }, null, 2));
}
