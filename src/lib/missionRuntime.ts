import { invoke } from '@tauri-apps/api/core';
import { notifyTaskCompleted } from './workers/bootstrap.js';
import type { WorkerAdapter, WorkerSession } from './workers/types.js';

async function captureTerminalOutput(terminalId: string): Promise<string> {
  try {
    return await invoke<string>('get_pty_recent_output', { id: terminalId, maxBytes: 16384 });
  } catch {
    return '';
  }
}

import type { ExecutionMode } from './workflow/WorkflowTypes.js';

export interface WorkflowNodeTriggeredPayload {
  missionId: string;
  nodeId: string;
  roleId: string;
  sessionId: string;
  agentId: string;
  terminalId: string;
  activatedAt: number;
  attempt: number;
  payload?: string | null;
  runId?: string;
  cliType?: string;
  modelId?: string | null;
  yolo?: boolean;
  executionMode?: ExecutionMode;
  goal?: string;
  workspaceDir?: string | null;
  frontendMode?: import('../store/workspace.js').FrontendWorkflowMode;
  frontendCategory?: import('../store/workspace.js').FrontendSpecCategory;
  frontendDirection?: import('./frontendDirection.js').FrontendDirectionSpec;
  specProfile?: import('../store/workspace.js').PresetSpecProfile;
  finalReadmeEnabled?: boolean;
  finalReadmeOwnerNodeId?: string | null;
  assignment?: RuntimeAssignmentPayload;
}

export interface RuntimeExpectedActionContract {
  signal: string;
  requiredFollowUp: string[];
  handoffContract: string;
}

export type AssignmentEdgeCondition = 'always' | 'on_success' | 'on_failure';
export type NodeCompletionStatus = 'success' | 'failure';

export interface RuntimeAssignmentLegalTarget {
  targetNodeId: string;
  targetRoleId: string;
  condition: AssignmentEdgeCondition;
  allowedOutcomes: NodeCompletionStatus[];
}

export interface RuntimeAssignmentPayload {
  roleInstructions: string;
  missionGoal: string;
  upstreamOutputs: unknown;
  workspaceContext: {
    workspaceDir: string | null;
    missionId: string;
    nodeId: string;
    runId: string;
    attempt: number;
    frontendMode?: import('../store/workspace.js').FrontendWorkflowMode;
    frontendCategory?: import('../store/workspace.js').FrontendSpecCategory;
    frontendDirection?: import('./frontendDirection.js').FrontendDirectionSpec;
    specProfile?: import('../store/workspace.js').PresetSpecProfile;
    finalReadmeEnabled?: boolean;
    finalReadmeOwnerNodeId?: string | null;
  };
  expectedDeliverable: {
    schema: 'completion_payload_v1';
    requiredFields: ['status', 'summary', 'artifactReferences', 'filesChanged', 'downstreamPayload'];
    statusOptions: NodeCompletionStatus[];
    notes: string;
  };
  handoff: {
    fromNodeIds: string[];
    legalTargets: RuntimeAssignmentLegalTarget[];
  };
}

export interface StructuredCompletionPayload {
  status: NodeCompletionStatus;
  summary: string;
  artifactReferences: string[];
  filesChanged: string[];
  downstreamPayload: unknown;
}

export interface RuntimeActivationPayload {
  activationId: string;
  missionId: string;
  runId: string;
  nodeId: string;
  role: string;
  profileId?: string | null;
  capabilities?: Array<{
    id: string;
    level?: number;
    verifiedBy?: string;
  }> | null;
  cliType: string;
  modelId?: string | null;
  yolo?: boolean;
  executionMode: ExecutionMode;
  terminalId: string;
  paneId?: string | null;
  sessionId: string;
  agentId: string;
  attempt: number;
  goal: string;
  workspaceDir?: string | null;
  frontendMode?: import('../store/workspace.js').FrontendWorkflowMode;
  frontendCategory?: import('../store/workspace.js').FrontendSpecCategory;
  frontendDirection?: import('./frontendDirection.js').FrontendDirectionSpec;
  specProfile?: import('../store/workspace.js').PresetSpecProfile;
  finalReadmeEnabled?: boolean;
  finalReadmeOwnerNodeId?: string | null;
  inputPayload?: string | null;
  assignment?: RuntimeAssignmentPayload;
  expectedNextAction: RuntimeExpectedActionContract;
  emittedAt: number;
}

export interface NewTaskSignalPayload {
  signal: 'NEW_TASK';
  missionId: string;
  nodeId: string;
  roleId: string;
  sessionId: string;
  agentId: string;
  terminalId: string;
  activatedAt: number;
  attempt: number;
  mcpUrl?: string;
  payloadPreview: string | null;
  handoffPayloadPreview: string | null;
  runId?: string;
  cliType?: string;
  modelId?: string | null;
  yolo?: boolean;
  executionMode?: ExecutionMode;
  goal?: string;
  workspaceDir?: string | null;
  frontendMode?: import('../store/workspace.js').FrontendWorkflowMode;
  frontendCategory?: import('../store/workspace.js').FrontendSpecCategory;
  frontendDirection?: import('./frontendDirection.js').FrontendDirectionSpec;
  specProfile?: import('../store/workspace.js').PresetSpecProfile;
  finalReadmeEnabled?: boolean;
  finalReadmeOwnerNodeId?: string | null;
  assignment: RuntimeAssignmentPayload;
}

const DEFAULT_PAYLOAD_PREVIEW_LENGTH = 280;

function normalizeString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function safeParseJson(value: string | null | undefined): unknown {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function collectFromNodeIds(upstreamOutputs: unknown): string[] {
  if (!Array.isArray(upstreamOutputs)) return [];
  const ids = new Set<string>();
  for (const entry of upstreamOutputs) {
    if (!entry || typeof entry !== 'object') continue;
    const candidate = normalizeString((entry as Record<string, unknown>).fromNodeId);
    if (candidate) ids.add(candidate);
  }
  return [...ids];
}

function defaultAssignment(payload: WorkflowNodeTriggeredPayload): RuntimeAssignmentPayload {
  const upstreamOutputs = safeParseJson(payload.payload);
  return {
    roleInstructions: '',
    missionGoal: payload.goal?.trim() || '',
    upstreamOutputs,
    workspaceContext: {
      workspaceDir: payload.workspaceDir ?? null,
      missionId: payload.missionId,
      nodeId: payload.nodeId,
      runId: payload.runId ?? '',
      attempt: payload.attempt,
      frontendMode: payload.frontendMode ?? 'off',
      frontendCategory: payload.frontendCategory ?? 'marketing_site',
      frontendDirection: payload.frontendDirection,
      specProfile: payload.specProfile ?? 'none',
      finalReadmeEnabled: Boolean(payload.finalReadmeEnabled),
      finalReadmeOwnerNodeId: payload.finalReadmeOwnerNodeId ?? null,
    },
    expectedDeliverable: {
      schema: 'completion_payload_v1',
      requiredFields: ['status', 'summary', 'artifactReferences', 'filesChanged', 'downstreamPayload'],
      statusOptions: ['success', 'failure'],
      notes: 'Return structured completion data and route downstream only through explicit graph targets.',
    },
    handoff: {
      fromNodeIds: collectFromNodeIds(upstreamOutputs),
      legalTargets: [],
    },
  };
}

export function summarizeHandoffPayload(
  payload?: string | null,
  maxLength = DEFAULT_PAYLOAD_PREVIEW_LENGTH
): string | null {
  if (typeof payload !== 'string') return null;

  const normalized = payload.replace(/\s+/g, ' ').trim();
  if (!normalized) return null;
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

export function buildNewTaskSignal(payload: WorkflowNodeTriggeredPayload, mcpUrl?: string): string {
  const payloadPreview = summarizeHandoffPayload(payload.payload);
  const assignment = payload.assignment ?? defaultAssignment(payload);

  const signal: NewTaskSignalPayload = {
    signal: 'NEW_TASK',
    missionId: payload.missionId,
    nodeId: payload.nodeId,
    roleId: payload.roleId,
    sessionId: payload.sessionId,
    agentId: payload.agentId,
    terminalId: payload.terminalId,
    activatedAt: payload.activatedAt,
    attempt: payload.attempt,
    mcpUrl,
    payloadPreview,
    handoffPayloadPreview: payloadPreview,
    runId: payload.runId,
    cliType: payload.cliType,
    modelId: payload.modelId ?? null,
    yolo: Boolean(payload.yolo),
    executionMode: payload.executionMode,
    goal: payload.goal,
    workspaceDir: payload.workspaceDir ?? null,
    frontendMode: payload.frontendMode ?? 'off',
    frontendCategory: payload.frontendCategory ?? 'marketing_site',
    frontendDirection: payload.frontendDirection,
    specProfile: payload.specProfile ?? 'none',
    finalReadmeEnabled: Boolean(payload.finalReadmeEnabled),
    finalReadmeOwnerNodeId: payload.finalReadmeOwnerNodeId ?? null,
    assignment,
  };

  const json = JSON.stringify(signal);
  
  // Return a structured task prompt that an AI CLI can parse or read naturally.
  // We include a clear marker and the JSON envelope.
  return `### MISSION_CONTROL_ACTIVATION_REQUEST ###
You have been assigned to a mission graph node. 
Call 'get_task_details({ missionId: "${payload.missionId}", nodeId: "${payload.nodeId}" })' to retrieve your full context, inbox, and legal next targets.
Then execute the actual task payload and call 'complete_task({ missionId: "${payload.missionId}", nodeId: "${payload.nodeId}", attempt: ${payload.attempt}, outcome, summary })' as your final MCP action. Do not stop after saying the task is ready.

--- ENVELOPE ---
${json}
--- END ENVELOPE ---
`;
}

function isAssignmentPayload(value: unknown): value is RuntimeAssignmentPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (typeof candidate.roleInstructions !== 'string') return false;
  if (typeof candidate.missionGoal !== 'string') return false;
  if (!candidate.workspaceContext || typeof candidate.workspaceContext !== 'object') return false;
  if (!candidate.expectedDeliverable || typeof candidate.expectedDeliverable !== 'object') return false;
  if (!candidate.handoff || typeof candidate.handoff !== 'object') return false;
  return true;
}

export function isNewTaskSignalPayload(value: unknown): value is NewTaskSignalPayload {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  if (candidate.signal !== 'NEW_TASK') return false;

  const requiredStringKeys = ['missionId', 'nodeId', 'roleId', 'sessionId', 'agentId', 'terminalId'] as const;
  for (const key of requiredStringKeys) {
    if (typeof candidate[key] !== 'string' || !String(candidate[key]).trim()) return false;
  }

  const attempt = candidate.attempt;
  if (typeof attempt !== 'number' || !Number.isInteger(attempt) || attempt < 1) return false;

  const activatedAt = candidate.activatedAt;
  if (typeof activatedAt !== 'number' || !Number.isFinite(activatedAt) || activatedAt <= 0) return false;

  const payloadPreview = candidate.payloadPreview;
  const handoffPayloadPreview = candidate.handoffPayloadPreview;
  const nullableString = (input: unknown) => input === null || typeof input === 'string';
  return (
    nullableString(payloadPreview) &&
    nullableString(handoffPayloadPreview) &&
    isAssignmentPayload(candidate.assignment)
  );
}

export function parseNewTaskSignal(raw: string): NewTaskSignalPayload | null {
  if (typeof raw !== 'string' || !raw.trim()) return null;
  try {
    const parsed = JSON.parse(raw);
    return isNewTaskSignalPayload(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Heuristic to analyze terminal output and determine outcome/summary.
 */
function analyzeOutput(text: string): { outcome: 'success' | 'failure'; summary: string } {
  const lines = text.split('\n').map(l => l.trim()).filter(l => l.length > 0);
  const lastLines = lines.slice(-20).join('\n').toLowerCase();
  
  // Basic failure heuristics
  const failureMarkers = [
    'error:',
    'failed',
    'exception',
    'stack trace',
    'command not found',
    'exit code 1',
  ];
  
  const isFailure = failureMarkers.some(marker => lastLines.includes(marker));
  
  // Extract summary: use the last few meaningful lines
  const summaryLines = lines.slice(-5);
  const summary = summaryLines.join('\n') || 'Agent process exited.';
  
  return {
    outcome: isFailure ? 'failure' : 'success',
    summary,
  };
}

/**
 * Orchestrator hook that monitors a worker for process exits and auto-completes the task.
 */
export function attachExitDetector(
  adapter: WorkerAdapter,
  session: WorkerSession,
  options: {
    missionId: string;
    nodeId: string;
    attempt: number;
  }
): () => void {
  return adapter.streamOutput(session, async (ev: any) => {
    if (ev.kind === 'process-exit') {
      try {
        const finalOutput = await captureTerminalOutput(session.terminalId);
        const { outcome, summary } = analyzeOutput(finalOutput);
        
        console.log(`[ExitDetector] Auto-completing ${options.nodeId} with outcome: ${outcome}`);
        
        await notifyTaskCompleted({
          sessionId: session.sessionId,
          missionId: options.missionId,
          nodeId: options.nodeId,
          attempt: options.attempt,
          outcome,
          summary,
          rawOutput: finalOutput,
        });
      } catch (err) {
        console.error('[ExitDetector] Failed to auto-complete task', err);
      }
    }
  });
}

