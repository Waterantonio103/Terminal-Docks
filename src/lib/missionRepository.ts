import { invoke } from '@tauri-apps/api/core';
import type {
  ArtifactRecord,
  MissionSnapshot,
  WorkflowEventRecord,
} from '../hooks/useMissionSnapshot.js';
import { readMcpJsonResponse } from './mcpResponse.js';

export interface WorkflowRunHistorySummary {
  missionId: string;
  graphId: string | null;
  goal: string | null;
  status: string;
  workspaceDir: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  totalDurationMs: number | null;
  nodeCount: number;
  eventCount: number;
}

export interface AgentRunHistoryRecord {
  runId: string;
  sessionId: string;
  cli: string;
  executionMode: string;
  cwd: string | null;
  command: string;
  args: string[];
  promptPath: string | null;
  stdoutPath: string | null;
  stderrPath: string | null;
  transcriptPath: string | null;
  status: string;
  exitCode: number | null;
  startedAt: string | null;
  completedAt: string | null;
  durationMs: number | null;
  error: string | null;
  stdoutText: string | null;
  stderrText: string | null;
  transcriptText: string | null;
}

export interface WorkflowNodeRunHistory {
  nodeId: string;
  role: string | null;
  title: string | null;
  status: string;
  attempt: number;
  terminalId: string | null;
  sessionId: string | null;
  startedAt: string | null;
  endedAt: string | null;
  durationMs: number | null;
  fullOutput: string;
  agentRuns: AgentRunHistoryRecord[];
}

export interface WorkflowRunHistory {
  summary: WorkflowRunHistorySummary;
  missionJson: string | null;
  nodes: WorkflowNodeRunHistory[];
  events: WorkflowEventRecord[];
  artifacts: ArtifactRecord[];
}

export interface UpsertMissionInput {
  missionId: string;
  goal?: string | null;
  status: string;
  workspaceDir?: string | null;
}

export interface UpdateMissionStatusInput {
  missionId: string;
  status: string;
  finalSummary?: string | null;
}

export interface WriteArtifactInput {
  id: string;
  missionId: string;
  nodeId?: string | null;
  kind: string;
  title: string;
  contentUri?: string | null;
  contentText?: string | null;
  metadataJson?: string | null;
}

export interface AppendWorkflowEventInput {
  missionId: string;
  nodeId?: string | null;
  sessionId?: string | null;
  terminalId?: string | null;
  eventType: string;
  severity: 'debug' | 'info' | 'warning' | 'error' | string;
  message: string;
  payloadJson?: string | null;
}

export interface FollowUpMessageRecord {
  id: string;
  missionId: string;
  threadId: string;
  runId?: string | null;
  role: string;
  cli?: string | null;
  model?: string | null;
  runtimeSessionId?: string | null;
  content: string;
  attachmentsJson?: string | null;
  artifactIdsJson?: string | null;
  filePathsJson?: string | null;
  status?: string | null;
  createdAt: number;
  completedAt?: number | null;
}

export interface UpsertFollowUpMessageInput {
  id: string;
  missionId: string;
  threadId: string;
  runId?: string | null;
  role: string;
  cli?: string | null;
  model?: string | null;
  runtimeSessionId?: string | null;
  content: string;
  attachmentsJson?: string | null;
  artifactIdsJson?: string | null;
  filePathsJson?: string | null;
  status?: string | null;
  createdAt: number;
  completedAt?: number | null;
}

export interface TaskInboxInput {
  id: string;
  missionId: string;
  fromNodeId?: string | null;
  toNodeId: string;
  kind: string;
  payloadJson?: string | null;
}

export interface NodeEdgeInput {
  id: string;
  missionId: string;
  fromNodeId: string;
  toNodeId: string;
  condition: string;
}

let mcpSessionPromise: Promise<string> | null = null;
let mcpRequestSeq = 0;

function nextMcpRequestId(): string {
  mcpRequestSeq += 1;
  return `ui-${Date.now()}-${mcpRequestSeq}`;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function getMcpErrorMessage(body: Record<string, unknown>): string | null {
  const error = asRecord(body.error);
  const message = error?.message;
  return typeof message === 'string' && message.trim() ? message : null;
}

function getMcpResult(body: Record<string, unknown>): Record<string, unknown> | null {
  return asRecord(body.result);
}

function getMcpToolText(result: Record<string, unknown> | null): string | null {
  const content = result?.content;
  if (!Array.isArray(content)) return null;
  const first = asRecord(content[0]);
  const text = first?.text;
  return typeof text === 'string' ? text : null;
}

async function resolveMcpBaseUrl(): Promise<string> {
  try {
    return await invoke<string>('get_mcp_base_url');
  } catch {
    return 'http://localhost:3741';
  }
}

async function initializeMcpSession(baseUrl: string): Promise<string> {
  const response = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: nextMcpRequestId(),
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'Comet-AI UI', version: '1.0.0' },
      },
    }),
  });

  const sessionId = response.headers.get('mcp-session-id');
  const body = await readMcpJsonResponse(response);
  const errorMessage = getMcpErrorMessage(body);
  if (!response.ok || errorMessage) {
    throw new Error(errorMessage || `Starlink handshake failed: HTTP ${response.status}`);
  }
  if (!sessionId) throw new Error('Starlink handshake did not return a session id');

  const initialized = await fetch(`${baseUrl}/mcp`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId,
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      method: 'notifications/initialized',
    }),
  });
  if (!initialized.ok) {
    const body = await readMcpJsonResponse(initialized);
    throw new Error(getMcpErrorMessage(body) || `Starlink initialized notification failed: HTTP ${initialized.status}`);
  }

  return sessionId;
}

function getMcpSession(baseUrl: string): Promise<string> {
  if (!mcpSessionPromise) {
    mcpSessionPromise = initializeMcpSession(baseUrl).catch(err => {
      mcpSessionPromise = null;
      throw err;
    });
  }
  return mcpSessionPromise;
}

export const missionRepository = {
  getMissionSnapshot(missionId: string): Promise<MissionSnapshot> {
    return invoke<MissionSnapshot>('get_mission_snapshot', { missionId });
  },

  upsertMission(input: UpsertMissionInput): Promise<void> {
    return invoke('upsert_mission_record', { ...input });
  },

  updateMissionStatus(input: UpdateMissionStatusInput): Promise<void> {
    return invoke('update_mission_status', { ...input });
  },

  writeArtifact(input: WriteArtifactInput): Promise<void> {
    return invoke('write_artifact', { ...input });
  },

  listArtifacts(missionId: string): Promise<ArtifactRecord[]> {
    return invoke<ArtifactRecord[]>('list_artifacts', { missionId });
  },

  appendWorkflowEvent(input: AppendWorkflowEventInput): Promise<number> {
    return invoke<number>('append_workflow_event', { ...input });
  },

  getWorkflowEvents(missionId: string, limit = 100): Promise<WorkflowEventRecord[]> {
    return invoke<WorkflowEventRecord[]>('get_workflow_events', { missionId, limit });
  },

  upsertFollowUpMessage(input: UpsertFollowUpMessageInput): Promise<void> {
    return invoke('upsert_follow_up_message', { ...input });
  },

  listFollowUpMessages(missionId: string, threadId?: string | null, limit = 200): Promise<FollowUpMessageRecord[]> {
    return invoke<FollowUpMessageRecord[]>('list_follow_up_messages', { missionId, threadId, limit });
  },

  listWorkflowRunHistory(limit = 25): Promise<WorkflowRunHistorySummary[]> {
    return invoke<WorkflowRunHistorySummary[]>('list_workflow_run_history', { limit });
  },

  getWorkflowRunHistory(missionId: string): Promise<WorkflowRunHistory> {
    return invoke<WorkflowRunHistory>('get_workflow_run_history', { missionId });
  },

  createTaskInboxItem(input: TaskInboxInput): Promise<void> {
    return invoke('create_task_inbox_item', { ...input });
  },

  updateTaskInboxItemStatus(id: string, status: string): Promise<void> {
    return invoke('update_task_inbox_item_status', { id, status });
  },

  upsertNodeEdge(input: NodeEdgeInput): Promise<void> {
    return invoke('upsert_node_edge', { ...input });
  },

  async invokeMcp(method: string, params: any): Promise<string> {
    const baseUrl = await resolveMcpBaseUrl();
    let sessionId = await getMcpSession(baseUrl);

    const callTool = () => fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Accept': 'application/json, text/event-stream',
        'mcp-session-id': sessionId,
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: nextMcpRequestId(),
        method: 'tools/call',
        params: {
          name: method,
          arguments: params,
        },
      }),
    });

    let response = await callTool();
    let body = await readMcpJsonResponse(response);
    const message = getMcpErrorMessage(body);
    if (!response.ok && typeof message === 'string' && /not initialized|invalid session/i.test(message)) {
      mcpSessionPromise = null;
      sessionId = await getMcpSession(baseUrl);
      response = await callTool();
      body = await readMcpJsonResponse(response);
    }
    const errorMessage = getMcpErrorMessage(body);
    if (!response.ok) throw new Error(errorMessage || `Starlink request failed: HTTP ${response.status}`);
    if (errorMessage) throw new Error(errorMessage);
    
    // Extract the text content from MCP result
    const result = getMcpResult(body);
    const text = getMcpToolText(result);
    if (result?.isError) throw new Error(text || 'Starlink tool error');
    
    return text || (result ? JSON.stringify(result) : '{}');
  },
};
