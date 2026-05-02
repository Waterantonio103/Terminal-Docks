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

function nodeRuntimeIsRunning(missionId, nodeId, attempt) {
  const runtime = getMissionNodeRuntime(missionId, nodeId);
  if (!runtime || runtime.status !== 'running') {
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

  if (targetNodeId && targetRole !== 'done') {
    const info = db.prepare(
      'INSERT INTO tasks (title, description, agent_id, parent_id, status, from_role, target_role, payload, mission_id, node_id) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)'
    ).run(title, description ?? null, targetRole, parentTaskId ?? null, 'todo', fromRole, targetRole, payloadStr, missionId, targetNodeId);
    taskId = info.lastInsertRowid;

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

export async function executeHandoffTask(args, sid) {
  let { fromRole, targetRole, title, description, payload, completion, parentTaskId, missionId, fromNodeId, targetNodeId, outcome, fromAttempt } = args;

  const normalizedOutcome = outcome?.trim().toLowerCase() ?? 'success';
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
    sessionId: sid,
    missionId,
    nodeId: fromNodeId,
    attempt: fromAttempt,
    outcome: normalizedOutcome,
    targetNodeId: targetNodeId ?? null,
    at: Date.now(),
    payload: structuredCompletion,
  });

  return makeToolText(JSON.stringify({ taskId, status: 'handoff_recorded', eventBody }, null, 2));
}

export async function executeCompleteTask(args, sid) {
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
    sessionId: sid,
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

  return makeToolText(JSON.stringify({ status: 'completed', routed }, null, 2));
}
