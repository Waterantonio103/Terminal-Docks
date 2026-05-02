import { db } from '../db/index.mjs';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const __dirname = dirname(fileURLToPath(import.meta.url));

export function loadAgentRoster() {
  try {
    const p = resolve(__dirname, '../../../src/config/agents.json');
    return JSON.parse(readFileSync(p, 'utf8'));
  } catch {
    return { agents: [] };
  }
}

export function logSession(sessionId, eventType, content) {
  try {
    db.prepare('INSERT INTO session_log (session_id, event_type, content) VALUES (?, ?, ?)').run(sessionId, eventType, content ?? null);
  } catch {}
}

export function appendWorkflowEvent({
  missionId,
  nodeId = null,
  sessionId = null,
  terminalId = null,
  type,
  severity = 'info',
  message,
  payload = null,
}) {
  if (!missionId || !type || !message) return;
  const payloadJson = payload == null
    ? null
    : (typeof payload === 'string' ? payload : JSON.stringify(payload));
  try {
    db.prepare(
      `INSERT INTO workflow_events
         (mission_id, node_id, session_id, terminal_id, type, severity, message, payload_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
    ).run(missionId, nodeId, sessionId, terminalId, type, severity, message, payloadJson);
  } catch {}
}

export function parseJsonSafe(value, fallback = null) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

export function makeToolText(text, isError = false) {
  return isError
    ? { isError: true, content: [{ type: 'text', text }] }
    : { content: [{ type: 'text', text }] };
}
