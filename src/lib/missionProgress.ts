import type { CompiledMission, MissionAgent } from '../store/workspace.js';
import type { ArtifactRecord, MissionSnapshot, WorkflowEventRecord } from '../hooks/useMissionSnapshot.js';

export type MissionProgressStatus =
  | 'pending'
  | 'active'
  | 'evidence_partial'
  | 'completed'
  | 'blocked'
  | 'failed';

export interface MissionProgressEventPayload {
  missionId: string;
  runId?: string | null;
  nodeId: string;
  phaseId?: string | null;
  status: 'started' | 'progress' | 'completed' | 'blocked' | 'failed';
  title: string;
  detail?: string | null;
  artifactIds?: string[];
  filePaths?: string[];
  percentHint?: number | null;
  timestamp: number;
}

export interface MissionProgressRow {
  id: string;
  label: string;
  nodeIds: string[];
  status: MissionProgressStatus;
  detail: string | null;
  percent: number;
  artifacts: Array<{ id: string; title: string; kind: string; path?: string | null }>;
  files: string[];
  updatedAt: number | null;
  attention: string | null;
}

function parsePayload(value: string | null): Record<string, unknown> | null {
  if (!value) return null;
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : null;
  } catch {
    return null;
  }
}

function eventTime(value: string | null | undefined): number {
  if (!value) return 0;
  const ts = Date.parse(value);
  return Number.isFinite(ts) ? ts : 0;
}

function normalizeProgressStatus(value: unknown): MissionProgressEventPayload['status'] | null {
  if (value === 'started' || value === 'progress' || value === 'completed' || value === 'blocked' || value === 'failed') return value;
  return null;
}

function normalizedStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  const items = new Set<string>();
  for (const item of value) {
    if (typeof item !== 'string') continue;
    const normalized = item.trim();
    if (normalized) items.add(normalized);
  }
  return [...items];
}

function normalizedPercentHint(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(95, Math.round(value)));
}

function normalizedEventTimestamp(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback;
}

export function parseMissionProgressEvent(event: WorkflowEventRecord): MissionProgressEventPayload | null {
  if (event.eventType !== 'agent_progress') return null;
  const payload = parsePayload(event.payloadJson);
  if (!payload) return null;
  const nodeId = typeof payload.nodeId === 'string' ? payload.nodeId.trim() : event.nodeId?.trim() ?? '';
  const status = normalizeProgressStatus(payload.status);
  const title = typeof payload.title === 'string' ? payload.title.trim() : '';
  if (!nodeId || !status || !title) return null;
  const fallbackTimestamp = eventTime(event.createdAt);
  return {
    missionId: typeof payload.missionId === 'string' && payload.missionId.trim() ? payload.missionId.trim() : event.missionId,
    runId: typeof payload.runId === 'string' && payload.runId.trim() ? payload.runId.trim() : null,
    nodeId,
    phaseId: typeof payload.phaseId === 'string' && payload.phaseId.trim() ? payload.phaseId.trim() : null,
    status,
    title,
    detail: typeof payload.detail === 'string' && payload.detail.trim() ? payload.detail.trim() : null,
    artifactIds: normalizedStringArray(payload.artifactIds),
    filePaths: normalizedStringArray(payload.filePaths),
    percentHint: normalizedPercentHint(payload.percentHint),
    timestamp: normalizedEventTimestamp(payload.timestamp, fallbackTimestamp),
  };
}

function statusFromNode(rawStatus: string | undefined | null): MissionProgressStatus {
  const status = String(rawStatus ?? '').toLowerCase();
  if (status === 'failed' || status === 'disconnected') return 'failed';
  if (status === 'manual_takeover' || status === 'waiting' || status === 'awaiting_permission') return 'blocked';
  if (status === 'done' || status === 'completed') return 'completed';
  if ([
    'launching', 'connecting', 'spawning', 'waiting_auth', 'terminal_started', 'adapter_starting',
    'mcp_connecting', 'registered', 'ready', 'activation_pending', 'activation_acked', 'activated',
    'running', 'handoff_pending',
  ].includes(status)) return 'active';
  return 'pending';
}

function mergeStatus(left: MissionProgressStatus, right: MissionProgressStatus): MissionProgressStatus {
  const rank: Record<MissionProgressStatus, number> = {
    failed: 6,
    blocked: 5,
    active: 4,
    evidence_partial: 3,
    completed: 2,
    pending: 1,
  };
  return rank[right] > rank[left] ? right : left;
}

function percentForStatus(status: MissionProgressStatus, evidenceCount: number): number {
  if (status === 'completed') return 100;
  if (status === 'failed' || status === 'blocked') return evidenceCount > 0 ? 70 : 35;
  if (status === 'active') return evidenceCount > 0 ? 65 : 35;
  if (status === 'evidence_partial') return 80;
  return 0;
}

function missionPhaseRows(mission: CompiledMission | null, agents: MissionAgent[]): MissionProgressRow[] {
  const layers = mission?.metadata?.executionLayers ?? [];
  const agentByNode = new Map(agents.filter(agent => agent.nodeId).map(agent => [agent.nodeId as string, agent]));
  if (layers.length > 0) {
    return layers.flatMap(nodeIds => nodeIds.map(nodeId => {
      const node = mission?.nodes.find(candidate => candidate.id === nodeId);
      const agent = agentByNode.get(nodeId);
      return {
        id: `node:${nodeId}`,
        label: agent?.title || node?.roleId || nodeId,
        nodeIds: [nodeId],
        status: statusFromNode(agent?.status),
        detail: agent?.currentAction ?? null,
        percent: 0,
        artifacts: [],
        files: [],
        updatedAt: agent?.completedAt ?? agent?.startedAt ?? null,
        attention: agent?.lastError ?? null,
      };
    }));
  }

  return agents
    .filter(agent => agent.nodeId)
    .map(agent => ({
      id: `node:${agent.nodeId}`,
      label: agent.title || agent.nodeId!,
      nodeIds: [agent.nodeId!],
      status: statusFromNode(agent.status),
      detail: agent.currentAction ?? agent.lastError ?? null,
      percent: 0,
      artifacts: [],
      files: [],
      updatedAt: agent.completedAt ?? agent.startedAt ?? null,
      attention: agent.lastError ?? null,
    }));
}

export function deriveMissionProgressRows(args: {
  mission: CompiledMission | null;
  agents: MissionAgent[];
  snapshot: MissionSnapshot | null;
  events: WorkflowEventRecord[];
}): MissionProgressRow[] {
  const rows = missionPhaseRows(args.mission, args.agents);
  const rowByNode = new Map<string, MissionProgressRow>();
  for (const row of rows) {
    for (const nodeId of row.nodeIds) rowByNode.set(nodeId, row);
  }

  const artifactsByNode = new Map<string, ArtifactRecord[]>();
  const artifactsById = new Map<string, ArtifactRecord>();
  for (const artifact of args.snapshot?.artifacts ?? []) {
    artifactsById.set(artifact.id, artifact);
    if (!artifact.nodeId) continue;
    artifactsByNode.set(artifact.nodeId, [...(artifactsByNode.get(artifact.nodeId) ?? []), artifact]);
  }

  for (const agent of args.agents) {
    if (!agent.nodeId) continue;
    const row = rowByNode.get(agent.nodeId);
    if (!row) continue;
    row.status = mergeStatus(row.status, statusFromNode(agent.status));
    row.updatedAt = Math.max(row.updatedAt ?? 0, agent.completedAt ?? agent.startedAt ?? 0) || row.updatedAt;
    if (agent.lastError) row.attention = agent.lastError;
    for (const artifact of agent.artifacts ?? []) {
      if (!row.artifacts.some(item => item.id === artifact.id)) {
        row.artifacts.push({ id: artifact.id, title: artifact.label, kind: artifact.type, path: artifact.path ?? null });
      }
      if (artifact.path && !row.files.includes(artifact.path)) row.files.push(artifact.path);
    }
  }

  for (const [nodeId, artifacts] of artifactsByNode) {
    const row = rowByNode.get(nodeId);
    if (!row) continue;
    for (const artifact of artifacts) {
      if (!row.artifacts.some(item => item.id === artifact.id)) {
        row.artifacts.push({ id: artifact.id, title: artifact.title, kind: artifact.kind, path: artifact.contentUri });
      }
    }
  }

  const progressEvents = args.events
    .map(parseMissionProgressEvent)
    .filter((event): event is MissionProgressEventPayload => Boolean(event))
    .sort((left, right) => left.timestamp - right.timestamp);

  for (const event of progressEvents) {
    const row = rowByNode.get(event.nodeId);
    if (!row) continue;
    row.label = event.title;
    row.detail = event.detail || event.title;
    row.updatedAt = Math.max(row.updatedAt ?? 0, event.timestamp);
    if (event.status === 'failed') row.status = 'failed';
    else if (event.status === 'blocked') row.status = 'blocked';
    else if (event.status === 'completed') row.status = mergeStatus(row.status, 'completed');
    else row.status = mergeStatus(row.status, 'active');
    if (event.status === 'blocked' || event.status === 'failed') row.attention = event.detail || event.title;
    for (const file of event.filePaths ?? []) {
      if (!row.files.includes(file)) row.files.push(file);
    }
    for (const artifactId of event.artifactIds ?? []) {
      const artifact = artifactsById.get(artifactId);
      if (!artifact) continue;
      if (!row.artifacts.some(item => item.id === artifact.id)) {
        row.artifacts.push({ id: artifact.id, title: artifact.title, kind: artifact.kind, path: artifact.contentUri });
      }
      if (artifact.contentUri && !row.files.includes(artifact.contentUri)) row.files.push(artifact.contentUri);
    }
    if (typeof event.percentHint === 'number') {
      row.percent = Math.max(row.percent, event.percentHint);
    }
  }

  for (const row of rows) {
    if (row.status === 'pending' && row.artifacts.length > 0) row.status = 'evidence_partial';
    row.percent = Math.max(row.percent, percentForStatus(row.status, row.artifacts.length + row.files.length));
  }

  return rows;
}
