import { useEffect, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { missionRepository } from '../lib/missionRepository.js';

export interface MissionSnapshotNode {
  nodeId: string;
  status: string;
  canonicalStatus: string;
  attempt: number;
  terminalId: string | null;
  lastOutcome: string | null;
  // Phase 2: structured node definition fields
  role: string | null;
  title: string | null;
  objective: string | null;
  executionPolicy: string | null;
  assignedCli: string | null;
  assignedModel: string | null;
  maxAttempts: number;
  dependencyNodeIds: string[];
}

export interface NodeEdgeRecord {
  id: string;
  missionId: string;
  fromNodeId: string;
  toNodeId: string;
  condition: string;
}

export interface RuntimeSessionRecord {
  sessionId: string;
  agentId: string;
  missionId: string;
  nodeId: string;
  attempt: number;
  terminalId: string;
  runId: string | null;
  status: string;
  canonicalStatus: string;
  model: string | null;
  executionMode: string | null;
  startedAt: string | null;
  endedAt: string | null;
  failureReason: string | null;
  createdAt: string | null;
}

export interface ArtifactRecord {
  id: string;
  missionId: string;
  nodeId: string | null;
  kind: string;
  title: string;
  contentUri: string | null;
  contentText: string | null;
  metadataJson: string | null;
  createdAt: string;
}

export interface FileLockRecord {
  filePath: string;
  agentId: string;
  lockedAt: string;
  missionId: string | null;
  mode: string | null;
  lockStatus: string | null;
  expiresAt: string | null;
}

export interface WorkflowEventRecord {
  id: number;
  missionId: string;
  nodeId: string | null;
  sessionId: string | null;
  terminalId: string | null;
  eventType: string;
  severity: string;
  message: string;
  payloadJson: string | null;
  createdAt: string;
}

export interface WorkflowStatusMappingRecord {
  rawStatus: string;
  canonicalStatus: string;
}

export interface MissionSnapshot {
  missionId: string;
  graphId: string;
  missionJson: string;
  status: string;
  nodes: MissionSnapshotNode[];
  // Phase 2: full state store fields
  edges: NodeEdgeRecord[];
  runtimeSessions: RuntimeSessionRecord[];
  artifacts: ArtifactRecord[];
  fileLocks: FileLockRecord[];
  recentEvents: WorkflowEventRecord[];
  statusMappings: WorkflowStatusMappingRecord[];
}

export function useMissionSnapshot(missionId: string | null) {
  const [snapshot, setSnapshot] = useState<MissionSnapshot | null>(null);

  useEffect(() => {
    if (!missionId) {
      setSnapshot(null);
      return;
    }

    let mounted = true;
    let unlistenUpdate: (() => void) | undefined;

    const fetchSnapshot = async () => {
      try {
        const data = await missionRepository.getMissionSnapshot(missionId);
        if (mounted) setSnapshot(data);
      } catch (err) {
        console.error('Failed to fetch mission snapshot:', err);
      }
    };

    fetchSnapshot();

    listen('workflow-node-update', (event: any) => {
      if (event.payload?.missionId === missionId || !event.payload?.missionId) {
        fetchSnapshot();
      }
    }).then(fn => {
      if (!mounted) fn();
      else unlistenUpdate = fn;
    });

    return () => {
      mounted = false;
      if (unlistenUpdate) unlistenUpdate();
    };
  }, [missionId]);

  return snapshot;
}
