import { invoke } from '@tauri-apps/api/core';
import type {
  ArtifactRecord,
  MissionSnapshot,
  WorkflowEventRecord,
} from '../hooks/useMissionSnapshot.js';

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
    let baseUrl = 'http://localhost:3741';
    try {
      baseUrl = await invoke<string>('get_mcp_base_url');
    } catch {}

    const response = await fetch(`${baseUrl}/mcp`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'mcp-session-id': 'ui-session', // Constant ID for UI-triggered tools
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'tools/call',
        params: {
          name: method,
          arguments: params,
        },
      }),
    });

    const body = await response.json();
    if (body.error) throw new Error(body.error.message || JSON.stringify(body.error));
    
    // Extract the text content from MCP result
    const text = body.result?.content?.[0]?.text;
    if (body.result?.isError) throw new Error(text || 'MCP Tool Error');
    
    return text || JSON.stringify(body.result);
  },
};
