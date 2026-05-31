import type { WorkflowEventRecord } from '../hooks/useMissionSnapshot.js';
import { normalizeTerminalId } from './terminalIds.js';

const DEFAULT_CREATED_AT = new Date(0).toISOString();

function normalizedNullableString(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'string') return null;
  const normalized = value.trim();
  return normalized || null;
}

function normalizedString(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

function normalizedCreatedAt(value: unknown): string {
  if (typeof value !== 'string') return DEFAULT_CREATED_AT;
  const normalized = value.trim();
  if (!normalized) return DEFAULT_CREATED_AT;
  return Number.isFinite(Date.parse(normalized)) ? normalized : DEFAULT_CREATED_AT;
}

export function normalizeWorkflowEventRecord(value: unknown, expectedMissionId?: string | null): WorkflowEventRecord | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  const id = typeof record.id === 'number' && Number.isFinite(record.id) ? Math.trunc(record.id) : null;
  const missionId = normalizedString(record.missionId) || normalizedString(expectedMissionId);
  const eventType = normalizedString(record.eventType);
  if (id === null || id <= 0 || !missionId || !eventType) return null;

  const message = normalizedString(record.message) || eventType;
  return {
    id,
    missionId,
    nodeId: normalizedNullableString(record.nodeId),
    sessionId: normalizedNullableString(record.sessionId),
    terminalId: normalizeTerminalId(record.terminalId),
    eventType,
    severity: normalizedString(record.severity) || 'info',
    message,
    payloadJson: normalizedNullableString(record.payloadJson),
    createdAt: normalizedCreatedAt(record.createdAt),
  };
}

export function normalizeWorkflowEventRecords(values: unknown, expectedMissionId?: string | null): WorkflowEventRecord[] {
  if (!Array.isArray(values)) return [];
  const records: WorkflowEventRecord[] = [];
  const seenIds = new Set<number>();
  for (const value of values) {
    const record = normalizeWorkflowEventRecord(value, expectedMissionId);
    if (!record || seenIds.has(record.id)) continue;
    seenIds.add(record.id);
    records.push(record);
  }
  return records;
}
