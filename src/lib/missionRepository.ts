import { invoke } from '@tauri-apps/api/core';
import type {
  ArtifactRecord,
  MissionSnapshot,
  WorkflowEventRecord,
} from '../hooks/useMissionSnapshot.js';

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

async function readMcpResponse(response: Response): Promise<any> {
  const contentType = response.headers.get('content-type') ?? '';

  if (contentType.includes('text/event-stream')) {
    const reader = response.body?.getReader();
    if (!reader) return {};
    const decoder = new TextDecoder();
    let buffer = '';
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const events = buffer.split('\n\n');
        buffer = events.pop() ?? '';
        for (const event of events) {
          const dataLines = event
            .split(/\r?\n/)
            .filter(line => line.startsWith('data:'))
            .map(line => line.slice(5).trim());
          if (!dataLines.length) continue;
          return JSON.parse(dataLines.join('\n'));
        }
      }
    } finally {
      reader.cancel().catch(() => {});
    }
    return {};
  }

  const rawBody = await response.text();
  if (!rawBody) return {};
  try {
    return JSON.parse(rawBody);
  } catch {
    if (!response.ok) throw new Error(rawBody || `MCP request failed: HTTP ${response.status}`);
    throw new Error(rawBody || 'MCP returned a non-JSON response');
  }
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
        clientInfo: { name: 'Terminal Docks UI', version: '1.0.0' },
      },
    }),
  });

  const sessionId = response.headers.get('mcp-session-id');
  const body = await readMcpResponse(response);
  if (!response.ok || body.error) {
    throw new Error(body.error?.message || `MCP initialize failed: HTTP ${response.status}`);
  }
  if (!sessionId) throw new Error('MCP initialize did not return a session id');

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
    const body = await readMcpResponse(initialized);
    throw new Error(body.error?.message || `MCP initialized notification failed: HTTP ${initialized.status}`);
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
    let body = await readMcpResponse(response);
    const message = body.error?.message;
    if (!response.ok && typeof message === 'string' && /not initialized|invalid session/i.test(message)) {
      mcpSessionPromise = null;
      sessionId = await getMcpSession(baseUrl);
      response = await callTool();
      body = await readMcpResponse(response);
    }
    if (!response.ok) throw new Error(body.error?.message || `MCP request failed: HTTP ${response.status}`);
    if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    
    // Extract the text content from MCP result
    const text = body.result?.content?.[0]?.text;
    if (body.result?.isError) throw new Error(text || 'MCP Tool Error');
    
    return text || JSON.stringify(body.result);
  },
};
