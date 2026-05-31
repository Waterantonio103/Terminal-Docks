import { normalizeTerminalId } from './terminalIds.js';

export interface NormalizedMcpMessage {
  id: number;
  from: string;
  content: string;
  type: string;
  timestamp: number;
}

export interface AgentConnectedPayload {
  terminalId: string;
  cli?: string;
  role?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return '';
  }
}

function textOrFallback(value: unknown, fallback: string): string {
  if (typeof value !== 'string') return fallback;
  const trimmed = value
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return trimmed || fallback;
}

function positiveIntegerOrFallback(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) return fallback;
  const normalized = Math.trunc(value);
  return normalized > 0 ? normalized : fallback;
}

export function normalizeMcpMessage(value: unknown, now = Date.now()): NormalizedMcpMessage | null {
  if (!isRecord(value)) return null;
  const type = textOrFallback(value.type, '');
  if (!type) return null;

  const id = positiveIntegerOrFallback(value.id, now);
  const timestamp = positiveIntegerOrFallback(value.timestamp, now);
  const content = typeof value.content === 'string'
    ? value.content
    : value.content === undefined || value.content === null
      ? ''
      : safeStringify(value.content);

  return {
    id,
    from: textOrFallback(value.from, 'starlink'),
    content,
    type,
    timestamp,
  };
}

export function normalizeAgentConnectedPayload(content: string): AgentConnectedPayload | null {
  try {
    const parsed = JSON.parse(content);
    if (!isRecord(parsed)) return null;
    const terminalId = normalizeTerminalId(parsed.terminalId);
    if (!terminalId) return null;
    return {
      terminalId,
      cli: textOrFallback(parsed.cli, '') || undefined,
      role: textOrFallback(parsed.role, '') || undefined,
    };
  } catch {
    return null;
  }
}

export function isMcpMessageType(value: unknown, type: string): boolean {
  const message = normalizeMcpMessage(value);
  const expectedType = textOrFallback(type, '');
  return Boolean(expectedType && message?.type === expectedType);
}
