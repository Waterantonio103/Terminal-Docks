export interface WorkflowNodeTriggeredPayload {
  missionId: string;
  nodeId: string;
  roleId: string;
  attempt: number;
  payload?: string | null;
}

export interface NewTaskSignalPayload {
  signal: 'NEW_TASK';
  missionId: string;
  nodeId: string;
  roleId: string;
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
    attempt: payload.attempt,
    payloadPreview,
    handoffPayloadPreview: payloadPreview,
  };

  return JSON.stringify(signal);
}
