import { z } from 'zod';
import { db } from '../db/index.mjs';
import { broadcast, sessions } from '../state.mjs';

const GLOBAL_CONTEXT_MISSION_ID = '__global__';

function sessionForCaller(sessionId) {
  if (!sessionId) return null;
  const session = sessions[sessionId] ?? null;
  if (session?.runtimeSessionId && sessions[session.runtimeSessionId]) {
    return sessions[session.runtimeSessionId];
  }
  if (session?.aliasOf && sessions[session.aliasOf]) {
    return sessions[session.aliasOf];
  }
  return session;
}

function contextMissionId(explicitMissionId, callerSessionId) {
  const explicit = typeof explicitMissionId === 'string' ? explicitMissionId.trim() : '';
  if (explicit) return explicit;
  const session = sessionForCaller(callerSessionId);
  return session?.missionId || GLOBAL_CONTEXT_MISSION_ID;
}

export function registerWorkspaceTools(server, getSessionId) {
  server.registerTool('update_workspace_context', {
    title: 'Update Workspace Context',
    description: 'Upsert a structured section of the shared workspace context.',
    inputSchema: {
      missionId: z.string().optional(),
      key: z.string().min(1),
      value: z.any(),
      updatedBy: z.string().optional(),
    }
  }, async ({ missionId, key, value, updatedBy }) => {
    const sid = getSessionId() ?? 'unknown';
    const scopedMissionId = contextMissionId(missionId, sid);
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    db.prepare(
      'INSERT INTO workspace_context (mission_id, key, value, updated_by, updated_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP) ' +
      'ON CONFLICT(mission_id, key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at'
    ).run(scopedMissionId, key, serialized, updatedBy ?? sid);
    broadcast(updatedBy ?? sid, JSON.stringify({ missionId: scopedMissionId, key }), 'workspace_context_update');
    return { content: [{ type: 'text', text: `Workspace context[${scopedMissionId}:${key}] updated.` }] };
  });

  server.registerTool('get_workspace_context', {
    title: 'Get Workspace Context',
    description: 'Returns the synthesized workspace state.',
    inputSchema: {
      missionId: z.string().optional(),
      keys: z.array(z.string()).optional(),
      includeGlobal: z.boolean().optional(),
    }
  }, async ({ missionId, keys, includeGlobal } = {}) => {
    const sid = getSessionId() ?? null;
    const scopedMissionId = contextMissionId(missionId, sid);
    const missionIds = includeGlobal && scopedMissionId !== GLOBAL_CONTEXT_MISSION_ID
      ? [GLOBAL_CONTEXT_MISSION_ID, scopedMissionId]
      : [scopedMissionId];
    let rows;
    if (Array.isArray(keys) && keys.length > 0) {
      const placeholders = keys.map(() => '?').join(',');
      const missionPlaceholders = missionIds.map(() => '?').join(',');
      rows = db.prepare(
        `SELECT mission_id, key, value, updated_by, datetime(updated_at, 'localtime') as updated_at
           FROM workspace_context
          WHERE mission_id IN (${missionPlaceholders}) AND key IN (${placeholders})
          ORDER BY mission_id, key`
      ).all(...missionIds, ...keys);
    } else {
      rows = db.prepare(
        `SELECT mission_id, key, value, updated_by, datetime(updated_at, 'localtime') as updated_at
           FROM workspace_context
          WHERE mission_id IN (${missionIds.map(() => '?').join(',')})
          ORDER BY mission_id, key`
      ).all(...missionIds);
    }
    const parsed = {};
    for (const r of rows) {
      let value = r.value;
      try { value = JSON.parse(r.value); } catch { /* leave as string */ }
      parsed[r.key] = { value, updatedBy: r.updated_by, updatedAt: r.updated_at, missionId: r.mission_id };
    }
    return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
  });
}
