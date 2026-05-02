import { db } from '../db/index.mjs';

export function writeDebugEvent(debugRunId, eventType, payload = null) {
  if (!eventType) return null;
  const payloadJson = payload == null ? null : JSON.stringify(payload);
  const result = db.prepare(
    `INSERT INTO debug_events (debug_run_id, event_type, payload_json, created_at)
     VALUES (?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(debugRunId ?? null, eventType, payloadJson);
  return result.lastInsertRowid;
}
