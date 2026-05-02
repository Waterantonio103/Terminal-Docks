import { z } from 'zod';
import { db } from '../db/index.mjs';
import { broadcast } from '../state.mjs';

export function registerWorkspaceTools(server, getSessionId) {
  server.registerTool('update_workspace_context', {
    title: 'Update Workspace Context',
    description: 'Upsert a structured section of the shared workspace context.',
    inputSchema: {
      key: z.string().min(1),
      value: z.any(),
      updatedBy: z.string().optional(),
    }
  }, async ({ key, value, updatedBy }) => {
    const sid = getSessionId() ?? 'unknown';
    const serialized = typeof value === 'string' ? value : JSON.stringify(value);
    db.prepare(
      'INSERT INTO workspace_context (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ' +
      'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at'
    ).run(key, serialized, updatedBy ?? sid);
    broadcast(updatedBy ?? sid, JSON.stringify({ key }), 'workspace_context_update');
    return { content: [{ type: 'text', text: `Workspace context[${key}] updated.` }] };
  });

  server.registerTool('get_workspace_context', {
    title: 'Get Workspace Context',
    description: 'Returns the synthesized workspace state.',
    inputSchema: {
      keys: z.array(z.string()).optional(),
    }
  }, async ({ keys } = {}) => {
    let rows;
    if (Array.isArray(keys) && keys.length > 0) {
      const placeholders = keys.map(() => '?').join(',');
      rows = db.prepare(
        `SELECT key, value, updated_by, datetime(updated_at, 'localtime') as updated_at FROM workspace_context WHERE key IN (${placeholders})`
      ).all(...keys);
    } else {
      rows = db.prepare(
        `SELECT key, value, updated_by, datetime(updated_at, 'localtime') as updated_at FROM workspace_context ORDER BY key`
      ).all();
    }
    const parsed = {};
    for (const r of rows) {
      let value = r.value;
      try { value = JSON.parse(r.value); } catch { /* leave as string */ }
      parsed[r.key] = { value, updatedBy: r.updated_by, updatedAt: r.updated_at };
    }
    return { content: [{ type: 'text', text: JSON.stringify(parsed, null, 2) }] };
  });
}
