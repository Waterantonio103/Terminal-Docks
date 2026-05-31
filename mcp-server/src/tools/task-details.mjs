import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { db } from '../db/index.mjs';
import { parseJsonSafe } from '../utils/index.mjs';
import { getMissionNode, getMissionNodeRuntime, getRuntimeSessionByAttempt, getLegalOutgoingTargets, loadCompiledMissionRecord } from '../utils/workflow.mjs';
import { ackTaskPush, emitAgentEvent } from '../state.mjs';
import { buildFrontendSpecFramework } from '../utils/frontend-spec-framework.mjs';
import { buildWorkflowPresetFramework, buildWorkflowPresetToolHints } from '../utils/workflow-preset-framework.mjs';

const FINAL_README_INSTRUCTION =
  'Final README instruction: before completing, create one very short human guidance file for the work produced by this workflow. Prefer the generated app/target folder, and make the run commands start by changing into that folder. If README.md does not exist there, create README.md. If README.md already exists, do not overwrite or append to it by default; create INSTRUCTIONS.md instead. If both files already exist, update workspace context or the completion payload instead of creating another markdown file. Keep it concise: summarize the files and folders created or changed, note the main entry points, and include only the concrete run/test commands the user needs, such as cd into the created app folder and npm run dev. Do not write a long architecture rundown.';

const APP_SITE_PRESET_IDS = new Set(['app_site_small', 'frontend_ui_delivery', 'app_site_expanded']);
const __dirname = dirname(fileURLToPath(import.meta.url));
const NEUFORM_INDEX_PATH = join(__dirname, '..', 'resources', 'frontend-patterns', 'neuform', 'index.json');

let neuformEffectCache = null;

function pathSlug(path) {
  return String(path ?? '').split('/').pop()?.replace(/\.md$/, '') ?? String(path ?? '');
}

function unsuffixedSlug(id) {
  return String(id ?? '').replace(/-[a-z0-9]{6}$/, '');
}

function getNeuformEffectMap() {
  if (neuformEffectCache) return neuformEffectCache;
  const map = new Map();
  try {
    const index = JSON.parse(readFileSync(NEUFORM_INDEX_PATH, 'utf8'));
    for (const entry of Array.isArray(index?.entries) ? index.entries : []) {
      if (!entry?.themePickerReady || !entry?.path) continue;
      const originId = entry?.source?.originId ?? pathSlug(entry.path);
      const metadata = {
        id: entry.id ?? `neuform_${originId}`,
        title: entry.title ?? originId,
        path: entry.path,
        resourceUri: `frontend-patterns://neuform/${pathSlug(entry.path)}`,
        group: entry?.effectPicker?.group ?? entry?.pickerGroup ?? 'Effects',
        intensity: entry?.effectPicker?.intensity ?? 'balanced',
        technicalComplexity: entry?.effectPicker?.technicalComplexity ?? 'medium',
      };
      for (const alias of [metadata.id, metadata.id.replace(/^neuform_/, ''), originId, pathSlug(entry.path), unsuffixedSlug(originId), unsuffixedSlug(pathSlug(entry.path))]) {
        map.set(alias, metadata);
        map.set(alias.replace(/_/g, '-'), metadata);
      }
    }
  } catch {
    // Keep task details available even if optional frontend resources are missing.
  }
  neuformEffectCache = map;
  return neuformEffectCache;
}

function selectedNeuformEffects(effectIds) {
  const effectMap = getNeuformEffectMap();
  const selected = [];
  const seen = new Set();
  for (const rawId of Array.isArray(effectIds) ? effectIds : []) {
    const effect = effectMap.get(String(rawId)) ?? effectMap.get(String(rawId).replace(/_/g, '-'));
    if (!effect || seen.has(effect.id)) continue;
    selected.push(effect);
    seen.add(effect.id);
  }
  return selected;
}

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

function buildFrontendDirectionInstruction(frontendDirection, selectedEffects = selectedNeuformEffects(frontendDirection?.effects)) {
  if (!frontendDirection) return '';
  const delegated = Array.isArray(frontendDirection.delegatedSections) && frontendDirection.delegatedSections.length > 0
    ? ` Delegated sections: ${frontendDirection.delegatedSections.join(', ')}. For those sections, choose a fitting concrete decision and record a one-sentence reason in shared context or completion payload so the final README can include a numbered Agent Decisions section.`
    : '';
  const doGuidance = Array.isArray(frontendDirection.agentGuidance?.do) && frontendDirection.agentGuidance.do.length > 0
    ? ` Do: ${frontendDirection.agentGuidance.do.join(' ')}`
    : '';
  const avoidGuidance = Array.isArray(frontendDirection.agentGuidance?.avoid) && frontendDirection.agentGuidance.avoid.length > 0
    ? ` Avoid: ${frontendDirection.agentGuidance.avoid.join(' ')}`
    : '';
  const effectResources = selectedEffects.length > 0
    ? ` Selected Neuform effect resources: ${selectedEffects.map(effect => `${effect.title} (${effect.resourceUri}; group: ${effect.group}; intensity: ${effect.intensity}; complexity: ${effect.technicalComplexity})`).join('; ')}. Load only these selected effect docs and implement their Intent, Pattern Guidance, DESIGN.md Translation, and Implementation Guardrails.`
    : '';
  return `App/Site theme picker direction: treat this as binding user intent for PRD.md, DESIGN.md, structure.md, frontendSpecs/frontendPlan, implementation, and review. ${frontendDirection.summary ?? ''}.${delegated}${effectResources}${doGuidance}${avoidGuidance} The preview is low-fidelity and non-authoritative; use it only for broad layout, density, and composition.`;
}

function buildFrontendDirectionReviewChecklist(frontendDirection, selectedEffects = selectedNeuformEffects(frontendDirection?.effects)) {
  if (!frontendDirection) return null;
  return {
    expectation: 'Review generated output against every App/Site theme picker section.',
    sections: ['layout', 'density', 'palette', 'shape', 'effects', 'assets', 'interaction', 'tone'],
    allowedResults: ['pass', 'fail', 'delegated'],
    selectedEffects: Array.isArray(frontendDirection.effects) ? frontendDirection.effects : [],
    selectedEffectResources: selectedEffects,
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

function readWorkspaceContext(missionId, keys = null) {
  const scopedMissionId = typeof missionId === 'string' && missionId.trim() ? missionId.trim() : '__global__';
  const rows = Array.isArray(keys) && keys.length > 0
    ? db.prepare(
        `SELECT mission_id, key, value, updated_by, datetime(updated_at, 'localtime') AS updated_at
           FROM workspace_context
          WHERE mission_id = ? AND key IN (${keys.map(() => '?').join(',')})
          ORDER BY key`
      ).all(scopedMissionId, ...keys)
    : db.prepare(
        `SELECT mission_id, key, value, updated_by, datetime(updated_at, 'localtime') AS updated_at
           FROM workspace_context
          WHERE mission_id = ?
          ORDER BY key`
      ).all(scopedMissionId);

  const context = {};
  for (const row of rows) {
    context[row.key] = {
      value: parseJsonSafe(row.value, row.value),
      updatedBy: row.updated_by,
      updatedAt: row.updated_at,
      missionId: row.mission_id,
    };
  }
  return context;
}

function buildFrontendRuntimeGuidance(node, mission) {
  const roleId = node?.roleId ?? '';
  const nodeId = node?.id ?? '';
  const presetId = mission?.metadata?.presetId ?? mission?.task?.presetId ?? null;
  const parts = [
    'Runtime efficiency: use get_task_details as the primary source of truth. Use get_workspace_context only for keys you still need; do not search .comet-ai caches for tool/resource names.',
    'For strict UI spec files, keep durable handoffs concise and complete: PRD.md about 90-140 lines, DESIGN.md about 110-170 lines, structure.md about 90-150 lines. Validate once after writing, then make only narrow patches.',
    'Use update_workspace_context for frontendSpecs/frontendPlan summaries and write_artifact only when a durable artifact is useful; submit_summary is optional.',
  ];

  if (roleId === 'frontend_product') {
    parts.push('Product lane: write only product decisions in PRD.md. Prefer a compact, reviewer-usable brief over a long narrative.');
  } else if (roleId === 'frontend_designer') {
    parts.push('Design lane: write exact tokens and component recipes without a large inspiration essay. Pick at most two optional pattern/reference resources.');
  } else if (roleId === 'frontend_architect') {
    parts.push('Architecture lane: write implementation structure, file ownership, data model, and verification commands only. Do not include product or visual-spec prose already owned upstream.');
  } else if (roleId === 'frontend_builder' && presetId === 'app_site_expanded') {
    if (nodeId.includes('frontend_builder_core')) {
      parts.push('Expanded builder lane: CORE owns the initial generated app folder and first complete runnable implementation. Create one app folder and complete after a focused desktop/mobile smoke check. Do not wait for other builders.');
    } else if (nodeId.includes('frontend_builder_states')) {
      parts.push('Expanded builder lane: STATES is a follow-up patch pass on the existing app from CORE. Do not create a second app folder. Add or improve interactions, empty/loading/error/success states, focus states, and stateful copy, then complete.');
    } else if (nodeId.includes('frontend_builder_responsive')) {
      parts.push('Expanded builder lane: RESPONSIVE is a follow-up patch pass on the same app after STATES. Do not create a second app folder. Focus responsive layout, first-viewport fit, text overflow, reduced motion, and final screenshot evidence, then complete.');
    }
  }

  return parts.join(' ');
}

function buildFrontendToolHints(frontendFramework, selectedFrontendEffects) {
  if (!frontendFramework) return null;
  return {
    exactTools: [
      'get_task_details',
      'read_inbox',
      'get_workspace_context',
      'update_workspace_context',
      'get_frontend_spec_framework',
      'evaluate_frontend_spec_intake',
      'request_file_lock',
      'validated_write',
      'validated_patch',
      'release_file_lock',
      'write_artifact',
      'complete_task',
    ],
    resourceUris: [
      'frontend-library://index',
      'frontend-patterns://neuform/index',
      'frontend-reference://ui/index',
      ...selectedFrontendEffects.map(effect => effect.resourceUri),
    ],
    outputBudgets: {
      'PRD.md': '90-140 lines',
      'DESIGN.md': '110-170 lines',
      'structure.md': '90-150 lines',
      builderCompletion: 'concise payload listing generated app folder and changed files',
    },
    validationPolicy: 'Validate once after writing required spec files; if accepted, do not re-run the same full-text validation.',
  };
}

function buildPresetRuntimeGuidance(node, presetFramework) {
  if (!presetFramework) return '';
  const roleId = node?.roleId ?? '';
  const lane = presetFramework.framework?.laneGuidance?.[roleId];
  const requiredOutputs = (presetFramework.framework?.requiredOutputs ?? []).join(' ');
  const rubric = (presetFramework.framework?.qualityRubric ?? []).join(' ');
  return [
    `Preset framework: ${presetFramework.mode} / ${presetFramework.subMode}. Focus: ${presetFramework.framework?.focus ?? 'role-specific workflow output'}.`,
    lane ? `Your lane: ${lane}` : '',
    requiredOutputs ? `Success requires: ${requiredOutputs}` : '',
    rubric ? `Quality bar: ${rubric}` : '',
    'Keep durable details in workspace context or downstreamPayload; create markdown artifacts only when they are genuinely useful to Mission Control or the user.',
  ].filter(Boolean).join(' ');
}

function buildProgressReportingContract(record, node) {
  return {
    requiredTool: 'record_progress',
    eventShape: {
      missionId: record.mission.missionId,
      nodeId: node.id,
      phaseId: 'optional framework phase id',
      status: ['started', 'progress', 'completed', 'blocked', 'failed'],
      title: 'short human-readable title, 8 words max',
      detail: 'optional plain-language sentence describing what is happening now',
      artifactIds: [],
      filePaths: [],
      percentHint: 'optional advisory number 0-100',
    },
    rules: [
      'Post when starting a meaningful subtask, finishing it, producing an artifact, or becoming blocked.',
      'Use the exact graph node ID, but write for a human watching Mission Control.',
      'Keep title short, usually 2-5 words and never more than 8 words.',
      'Write detail as a natural status sentence, such as "Researching matrix calculation methods..." or "Checking the responsive layout...".',
      'Avoid internal tool names, node IDs, attempt numbers, JSON-shaped prose, and long task descriptions in title/detail.',
      'Do not send token-by-token, command-by-command, or noisy heartbeat updates.',
    ],
  };
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
  const selectedFrontendEffects = frontendDirection ? selectedNeuformEffects(frontendDirection.effects) : [];
  const frontendDirectionInstruction = buildFrontendDirectionInstruction(frontendDirection, selectedFrontendEffects);
  const frontendDirectionReview = buildFrontendDirectionReviewChecklist(frontendDirection, selectedFrontendEffects);
  const frontendFramework = frontendMode !== 'off' || specProfile === 'frontend_three_file'
    ? buildFrontendSpecFramework({ categoryId: frontendCategory, mode: frontendMode === 'off' ? 'aligned' : frontendMode })
    : null;
  const presetFramework = buildWorkflowPresetFramework({
    presetId: record.mission.metadata?.presetId ?? null,
  });
  const finalReadmeEnabled = isFinalReadmeEnabled(record.mission);
  const finalReadmeOwnerNodeId = finalReadmeEnabled ? selectFinalReadmeOwner(record.mission) : null;
  const isFinalReadmeOwner = Boolean(finalReadmeEnabled && finalReadmeOwnerNodeId === nodeId);
  const nodeInstructionOverride = joinInstructionParts(
    node.instructionOverride ?? '',
    buildPresetRuntimeGuidance(node, presetFramework),
    'Progress reporting: use record_progress for meaningful starts, completions, artifacts, and blockers. Use the exact graph node ID. Write human-readable Mission Control updates: title is a short label of 8 words or fewer, and detail is a natural sentence like "Researching matrix calculation methods..." Avoid node IDs, tool names, attempt numbers, and long task descriptions in user-visible wording.',
    frontendDirectionInstruction,
    buildFrontendRuntimeGuidance(node, record.mission),
    isFinalReadmeOwner ? FINAL_README_INSTRUCTION : '',
  );
  const workspaceContext = readWorkspaceContext(missionId);
  const frontendToolHints = buildFrontendToolHints(frontendFramework, selectedFrontendEffects);
  const presetToolHints = buildWorkflowPresetToolHints(presetFramework);
  const progressReportingContract = buildProgressReportingContract(record, node);

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
    presetFramework,
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
    workspaceContext,
    frontendToolHints,
    presetToolHints,
    progressReportingContract,
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
      frontendToolHints,
      presetFramework,
      presetToolHints,
      progressReportingContract,
      workspaceContext,
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
