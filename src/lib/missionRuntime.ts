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
  payloadPreview: string | null;
  handoffPayloadPreview: string | null;
}

const DEFAULT_PAYLOAD_PREVIEW_LENGTH = 280;

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

export function buildNewTaskSignal(payload: WorkflowNodeTriggeredPayload): string {
  const payloadPreview = summarizeHandoffPayload(payload.payload);

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
    payloadPreview,
    handoffPayloadPreview: payloadPreview,
  };

  return JSON.stringify(signal);
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
  return nullableString(payloadPreview) && nullableString(handoffPayloadPreview);
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
