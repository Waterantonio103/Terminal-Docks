import { db } from '../db/index.mjs';
import { parseJsonSafe } from '../utils/index.mjs';
import { getMissionNode, getMissionNodeRuntime, getRuntimeSessionByAttempt, getLegalOutgoingTargets, loadCompiledMissionRecord } from '../utils/workflow.mjs';
import { ackTaskPush, emitAgentEvent } from '../state.mjs';
import { buildFrontendSpecFramework } from '../utils/frontend-spec-framework.mjs';

const FINAL_README_INSTRUCTION =
  'Final README instruction: before completing, create one very short human guidance file for the work produced by this workflow. Prefer the generated app/target folder, and make the run commands start by changing into that folder. If README.md does not exist there, create README.md. If README.md already exists, do not overwrite or append to it by default; create INSTRUCTIONS.md instead. If both files already exist, update workspace context or the completion payload instead of creating another markdown file. Keep it concise: summarize the files and folders created or changed, note the main entry points, and include only the concrete run/test commands the user needs, such as cd into the created app folder and npm run dev. Do not write a long architecture rundown.';

const APP_SITE_PRESET_IDS = new Set(['app_site_small', 'frontend_ui_delivery', 'app_site_expanded']);

function isAppSiteMission(mission) {
  const presetId = mission?.metadata?.presetId ?? mission?.task?.presetId;
  return typeof presetId === 'string' && APP_SITE_PRESET_IDS.has(presetId);
}

function getFrontendDirection(mission) {
  if (!isAppSiteMission(mission)) return null;
  const candidate = mission?.metadata?.frontendDirection ?? mission?.task?.frontendDirection;
  if (!candidate || typeof candidate !== 'object') return null;
  if (candidate.kind !== 'app_site_frontend_direction' || candidate.version !== 1) return null;
  return candidate;
}

function buildFrontendDirectionInstruction(frontendDirection) {
  if (!frontendDirection) return '';
  const delegated = Array.isArray(frontendDirection.delegatedSections) && frontendDirection.delegatedSections.length > 0
    ? ` Delegated sections: ${frontendDirection.delegatedSections.join(', ')}. For those sections, choose a fitting concrete decision and record a one-sentence reason in shared context or completion payload so the final README can include a numbered Agent Decisions section.`
    : '';
  return `App/Site theme picker direction: treat this as binding user intent for PRD.md, DESIGN.md, structure.md, frontendSpecs/frontendPlan, implementation, and review. ${frontendDirection.summary ?? ''}.${delegated} The preview is low-fidelity and non-authoritative; use it only for broad layout, density, and composition.`;
}

function buildFrontendDirectionReviewChecklist(frontendDirection) {
  if (!frontendDirection) return null;
  return {
    expectation: 'Review generated output against every App/Site theme picker section.',
    sections: ['layout', 'density', 'palette', 'shape', 'effects', 'assets', 'interaction', 'tone'],
    allowedResults: ['pass', 'fail', 'delegated'],
    failConcreteMismatches: true,
    flagDelegatedWithoutReason: true,
    previewUse: 'secondary_only',
  };
}

const GENERIC_README_ROLE_PRIORITY = [
  'visual_polish_reviewer',
  'interaction_qa',
  'accessibility_reviewer',
  'reviewer',
  'tester',
  'security',
  'builder',
  'frontend_builder',
  'frontend_architect',
  'frontend_designer',
  'frontend_product',
  'coordinator',
  'scout',
];

const README_ROLE_PRIORITY_BY_PRESET = {
  app_site_small: [
    'interaction_qa',
    'accessibility_reviewer',
    'reviewer',
    'frontend_builder',
    'frontend_architect',
    'frontend_designer',
    'frontend_product',
  ],
  frontend_ui_delivery: [
    'interaction_qa',
    'accessibility_reviewer',
    'reviewer',
    'frontend_builder',
    'frontend_architect',
    'frontend_designer',
    'frontend_product',
  ],
  app_site_expanded: [
    'reviewer',
    'visual_polish_reviewer',
    'interaction_qa',
    'accessibility_reviewer',
    'frontend_builder',
    'frontend_architect',
    'frontend_designer',
    'frontend_product',
  ],
};

function joinInstructionParts(...parts) {
  return parts
    .map(part => (typeof part === 'string' ? part.trim() : ''))
    .filter(Boolean)
    .join('\n\n');
}

function isFinalReadmeEnabled(mission) {
  return Boolean(mission?.metadata?.finalReadmeEnabled ?? mission?.task?.finalReadmeEnabled);
}

function selectFinalReadmeOwner(mission) {
  const explicitOwner = mission?.metadata?.finalReadmeOwnerNodeId ?? mission?.task?.finalReadmeOwnerNodeId;
  if (typeof explicitOwner === 'string' && explicitOwner.trim()) return explicitOwner.trim();

  const nodes = Array.isArray(mission?.nodes) ? mission.nodes : [];
  const outgoing = new Set((mission?.edges ?? []).map(edge => edge?.fromNodeId).filter(Boolean));
  const finalNodes = nodes.filter(node => node?.id && !outgoing.has(node.id));
  if (finalNodes.length === 0) return null;
  if (finalNodes.length === 1) return finalNodes[0].id;

  const presetId = mission?.metadata?.presetId;
  const priority = README_ROLE_PRIORITY_BY_PRESET[presetId] ?? GENERIC_README_ROLE_PRIORITY;
  const priorityByRole = new Map(priority.map((roleId, index) => [roleId, index]));
  const orderByNode = new Map(nodes.map((node, index) => [node.id, index]));

  return [...finalNodes].sort((left, right) => {
    const leftPriority = priorityByRole.get(left.roleId) ?? Number.MAX_SAFE_INTEGER;
    const rightPriority = priorityByRole.get(right.roleId) ?? Number.MAX_SAFE_INTEGER;
    if (leftPriority !== rightPriority) return leftPriority - rightPriority;

    const leftOrder = orderByNode.get(left.id) ?? Number.MAX_SAFE_INTEGER;
    const rightOrder = orderByNode.get(right.id) ?? Number.MAX_SAFE_INTEGER;
    if (leftOrder !== rightOrder) return leftOrder - rightOrder;

    return String(left.id).localeCompare(String(right.id));
  })[0]?.id ?? null;
}

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
  const frontendDirection = getFrontendDirection(record.mission);
  const frontendDirectionInstruction = buildFrontendDirectionInstruction(frontendDirection);
  const frontendDirectionReview = buildFrontendDirectionReviewChecklist(frontendDirection);
  const frontendFramework = frontendMode !== 'off' || specProfile === 'frontend_three_file'
    ? buildFrontendSpecFramework({ categoryId: frontendCategory, mode: frontendMode === 'off' ? 'aligned' : frontendMode })
    : null;
  const finalReadmeEnabled = isFinalReadmeEnabled(record.mission);
  const finalReadmeOwnerNodeId = finalReadmeEnabled ? selectFinalReadmeOwner(record.mission) : null;
  const isFinalReadmeOwner = Boolean(finalReadmeEnabled && finalReadmeOwnerNodeId === nodeId);
  const nodeInstructionOverride = joinInstructionParts(
    node.instructionOverride ?? '',
    frontendDirectionInstruction,
    isFinalReadmeOwner ? FINAL_README_INSTRUCTION : '',
  );

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
    finalReadmeEnabled,
    finalReadmeOwnerNodeId,
    frontendDirection,
    frontendDirectionReview,
    frontendFramework,
    goal: record.mission.task?.prompt ?? '',
    objective: nodeInstructionOverride || record.mission.task?.prompt || '',
    acceptanceCriteria: node.acceptanceCriteria || [],
    outputContract: node.outputContract || '',
    relevantArtifacts: artifacts,
    relevantEvents: events,
    task: record.mission.task ?? null,
    node: {
      id: node.id,
      roleId: node.roleId,
      instructionOverride: nodeInstructionOverride,
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
      instructionOverride: nodeInstructionOverride,
      roleInstructions: nodeInstructionOverride,
      goal: record.mission.task?.prompt ?? '',
      workspaceDir: record.mission.task?.workspaceDir ?? null,
      terminalId: node.terminal?.terminalId ?? runtimeSession?.terminal_id ?? null,
      modelId: node.terminal?.model ?? null,
      yolo: Boolean(node.terminal?.yolo),
      frontendMode,
      frontendCategory,
      specProfile,
      finalReadmeEnabled,
      finalReadmeOwnerNodeId,
      frontendDirection,
      frontendDirectionReview,
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
