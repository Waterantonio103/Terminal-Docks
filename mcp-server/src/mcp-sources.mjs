import { randomUUID } from 'crypto';
import { setTimeout as delay } from 'timers/promises';
import { db } from './db/index.mjs';

const MCP_PROTOCOL_VERSION = '2025-11-25';
const SOURCE_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const DISCOVERY_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;

function nowIso() {
  return new Date().toISOString();
}

function parseJson(value, fallback) {
  if (typeof value !== 'string' || !value.trim()) return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function stringifyJson(value) {
  return JSON.stringify(value ?? null);
}

function isObject(value) {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function validateSourceId(sourceId) {
  return SOURCE_ID_RE.test(String(sourceId || ''));
}

export function normalizeToolSegment(name) {
  return String(name || '')
    .trim()
    .replace(/[^a-zA-Z0-9_]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_+|_+$/g, '') || 'tool';
}

export function proxiedToolName(sourceId, toolName) {
  return `${sourceId}_${normalizeToolSegment(toolName)}`;
}

function isPrivateAddress(hostname) {
  const host = String(hostname || '').toLowerCase();
  if (host === 'localhost' || host === '127.0.0.1' || host === '::1' || host === '[::1]') return true;
  if (host.startsWith('127.')) return true;
  if (host.startsWith('10.')) return true;
  if (host.startsWith('192.168.')) return true;
  const parts = host.split('.').map(part => Number(part));
  if (parts.length === 4 && parts.every(Number.isInteger)) {
    return parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31;
  }
  return false;
}

export function validateRemoteSourceUrl(url) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return { ok: false, error: 'Enter a valid HTTP MCP URL.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Only HTTP/S MCP endpoints are supported in this slice.' };
  }
  if (!isPrivateAddress(parsed.hostname)) {
    return { ok: false, error: 'Only localhost and private-network MCP URLs are supported until auth/trust handling lands.' };
  }
  return { ok: true, url: parsed.toString() };
}

export function initMcpSourceRegistry() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS mcp_sources (
      id TEXT PRIMARY KEY,
      display_name TEXT NOT NULL,
      type TEXT NOT NULL,
      transport TEXT NOT NULL,
      url TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      archived INTEGER NOT NULL DEFAULT 0,
      status TEXT NOT NULL DEFAULT 'connected',
      status_message TEXT,
      confirmation TEXT NOT NULL DEFAULT 'inherit',
      risk TEXT NOT NULL DEFAULT 'medium',
      allowed_roles_json TEXT NOT NULL DEFAULT '[]',
      auth_json TEXT,
      last_discovered_at TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      archived_at TEXT
    );
    CREATE TABLE IF NOT EXISTS mcp_source_tools (
      source_id TEXT NOT NULL,
      original_name TEXT NOT NULL,
      proxied_name TEXT NOT NULL,
      title TEXT,
      description TEXT,
      input_schema_json TEXT,
      enabled INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'available',
      status_message TEXT,
      confirmation TEXT,
      risk TEXT,
      allowed_roles_json TEXT,
      discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_id, original_name),
      FOREIGN KEY(source_id) REFERENCES mcp_sources(id)
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_source_tools_proxied_name ON mcp_source_tools(proxied_name);
  `);

  db.prepare(`
    INSERT INTO mcp_sources
      (id, display_name, type, transport, enabled, archived, status, confirmation, risk, allowed_roles_json, created_at, updated_at)
    VALUES
      ('starlink', 'Starlink', 'builtin', 'internal', 1, 0, 'connected', 'inherit', 'medium', '[]', ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      display_name = 'Starlink',
      type = 'builtin',
      transport = 'internal',
      archived = 0,
      status = 'connected',
      updated_at = excluded.updated_at
  `).run(nowIso(), nowIso());
}

function rowToSource(row, tools = []) {
  return {
    id: row.id,
    displayName: row.display_name,
    type: row.type,
    transport: row.transport,
    url: row.url ?? null,
    enabled: !!row.enabled,
    archived: !!row.archived,
    status: row.status,
    statusMessage: row.status_message ?? null,
    confirmation: row.confirmation,
    risk: row.risk,
    allowedRoles: parseJson(row.allowed_roles_json, []),
    lastDiscoveredAt: row.last_discovered_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    tools,
  };
}

function rowToTool(row) {
  return {
    sourceId: row.source_id,
    originalName: row.original_name,
    proxiedName: row.proxied_name,
    title: row.title ?? row.original_name,
    description: row.description ?? '',
    inputSchema: parseJson(row.input_schema_json, { type: 'object', properties: {} }),
    enabled: !!row.enabled,
    status: row.status,
    statusMessage: row.status_message ?? null,
    confirmation: row.confirmation ?? 'inherit',
    risk: row.risk ?? 'inherit',
    allowedRoles: parseJson(row.allowed_roles_json, []),
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at,
  };
}

export function listMcpSources({ includeArchived = false } = {}) {
  initMcpSourceRegistry();
  const sources = db.prepare(`
    SELECT * FROM mcp_sources
    ${includeArchived ? '' : 'WHERE archived = 0'}
    ORDER BY CASE id WHEN 'starlink' THEN 0 ELSE 1 END, display_name COLLATE NOCASE
  `).all();
  const toolRows = db.prepare('SELECT * FROM mcp_source_tools ORDER BY source_id, original_name COLLATE NOCASE').all();
  const toolsBySource = new Map();
  for (const row of toolRows) {
    if (!toolsBySource.has(row.source_id)) toolsBySource.set(row.source_id, []);
    toolsBySource.get(row.source_id).push(rowToTool(row));
  }
  return sources.map(source => rowToSource(source, toolsBySource.get(source.id) ?? []));
}

export function getMcpSource(sourceId) {
  initMcpSourceRegistry();
  const row = db.prepare('SELECT * FROM mcp_sources WHERE id = ?').get(sourceId);
  return row ? rowToSource(row, db.prepare('SELECT * FROM mcp_source_tools WHERE source_id = ? ORDER BY original_name').all(sourceId).map(rowToTool)) : null;
}

function upsertDiscoveredTools(sourceId, tools) {
  const discoveredAt = nowIso();
  const seen = new Set();
  const insert = db.prepare(`
    INSERT INTO mcp_source_tools
      (source_id, original_name, proxied_name, title, description, input_schema_json, enabled, status, discovered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 1, 'available', ?, ?)
    ON CONFLICT(source_id, original_name) DO UPDATE SET
      proxied_name = excluded.proxied_name,
      title = excluded.title,
      description = excluded.description,
      input_schema_json = excluded.input_schema_json,
      status = 'available',
      status_message = NULL,
      discovered_at = excluded.discovered_at,
      updated_at = excluded.updated_at
  `);

  const txn = db.transaction(() => {
    for (const tool of tools) {
      if (!tool?.name || seen.has(tool.name)) continue;
      seen.add(tool.name);
      insert.run(
        sourceId,
        tool.name,
        proxiedToolName(sourceId, tool.name),
        tool.title ?? tool.name,
        tool.description ?? '',
        stringifyJson(tool.inputSchema ?? { type: 'object', properties: {} }),
        discoveredAt,
        discoveredAt,
      );
    }
    if (seen.size > 0) {
      const placeholders = Array.from(seen).map(() => '?').join(',');
      db.prepare(`
        UPDATE mcp_source_tools
           SET status = 'stale', status_message = 'Tool was not returned by the latest discovery.', updated_at = ?
         WHERE source_id = ? AND original_name NOT IN (${placeholders})
      `).run(discoveredAt, sourceId, ...seen);
    }
  });
  txn();
  return discoveredAt;
}

function normalizeDiscoveredTools(payload) {
  const tools = isObject(payload?.result) && Array.isArray(payload.result.tools) ? payload.result.tools : [];
  return tools
    .filter(tool => isObject(tool) && typeof tool.name === 'string' && tool.name.trim())
    .map(tool => ({
      name: tool.name.trim(),
      title: typeof tool.title === 'string' ? tool.title : undefined,
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: isObject(tool.inputSchema) ? tool.inputSchema : { type: 'object', properties: {} },
    }));
}

export function parseRpcPayload(text) {
  const trimmed = String(text || '').trim();
  if (!trimmed) return {};
  const lines = trimmed.split(/\r?\n/);
  if (!lines.some(line => line.startsWith('data:'))) return JSON.parse(trimmed);
  for (const frame of trimmed.split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') continue;
    return JSON.parse(data);
  }
  return {};
}

async function postMcpRpc(url, body, sessionId, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
      },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const text = await response.text();
    if (!response.ok) throw new Error(text || `HTTP ${response.status}`);
    return {
      data: parseRpcPayload(text),
      sessionId: response.headers.get('mcp-session-id') ?? sessionId,
    };
  } finally {
    clearTimeout(timeout);
  }
}

async function initializeRemoteSession(url, timeoutMs) {
  const initialized = await postMcpRpc(url, {
    jsonrpc: '2.0',
    id: `td-init-${randomUUID()}`,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'terminal-docks-starlink-proxy', version: '0.1.0' },
    },
  }, undefined, timeoutMs);
  if (!initialized.sessionId) throw new Error('MCP initialize did not return a session id.');
  await postMcpRpc(url, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, initialized.sessionId, timeoutMs);
  return initialized.sessionId;
}

export async function discoverRemoteMcpSource(url, { timeoutMs = DISCOVERY_TIMEOUT_MS } = {}) {
  const validation = validateRemoteSourceUrl(url);
  if (!validation.ok) throw new Error(validation.error);
  const sessionId = await initializeRemoteSession(validation.url, timeoutMs);
  const listed = await postMcpRpc(validation.url, {
    jsonrpc: '2.0',
    id: `td-list-${randomUUID()}`,
    method: 'tools/list',
    params: {},
  }, sessionId, timeoutMs);
  return normalizeDiscoveredTools(listed.data);
}

export async function createRemoteMcpSource(input) {
  initMcpSourceRegistry();
  const id = String(input.id || '').trim();
  if (!validateSourceId(id)) throw new Error('Source ID must match lowercase snake format, e.g. excalidraw or github_tools.');
  const existing = db.prepare('SELECT id FROM mcp_sources WHERE id = ?').get(id);
  if (existing) throw new Error(`MCP source id "${id}" is already reserved.`);
  const validation = validateRemoteSourceUrl(input.url);
  if (!validation.ok) throw new Error(validation.error);

  let tools = [];
  let status = 'degraded';
  let statusMessage = null;
  try {
    tools = await discoverRemoteMcpSource(validation.url);
    status = 'connected';
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : String(error);
    if (!input.saveDegraded) throw error;
  }
  const enabled = status === 'connected' && input.enabled !== false;
  const timestamp = nowIso();
  db.prepare(`
    INSERT INTO mcp_sources
      (id, display_name, type, transport, url, enabled, archived, status, status_message, confirmation, risk, allowed_roles_json, auth_json, last_discovered_at, created_at, updated_at)
    VALUES (?, ?, 'remote', 'http', ?, ?, 0, ?, ?, ?, ?, ?, NULL, ?, ?, ?)
  `).run(
    id,
    String(input.displayName || id),
    validation.url,
    enabled ? 1 : 0,
    status,
    statusMessage,
    input.confirmation ?? 'inherit',
    input.risk ?? 'medium',
    stringifyJson(Array.isArray(input.allowedRoles) ? input.allowedRoles : []),
    tools.length ? timestamp : null,
    timestamp,
    timestamp,
  );
  if (tools.length) upsertDiscoveredTools(id, tools);
  return getMcpSource(id);
}

export async function refreshMcpSource(sourceId) {
  const source = getMcpSource(sourceId);
  if (!source) throw new Error(`MCP source "${sourceId}" not found.`);
  if (source.type === 'builtin') return source;
  if (source.archived) throw new Error(`MCP source "${sourceId}" is archived.`);
  if (!source.url) throw new Error(`MCP source "${sourceId}" has no URL.`);
  try {
    const tools = await discoverRemoteMcpSource(source.url);
    const discoveredAt = upsertDiscoveredTools(source.id, tools);
    db.prepare(`
      UPDATE mcp_sources
         SET status = 'connected', status_message = NULL, last_discovered_at = ?, updated_at = ?
       WHERE id = ?
    `).run(discoveredAt, discoveredAt, source.id);
  } catch (error) {
    const timestamp = nowIso();
    db.prepare(`
      UPDATE mcp_sources
         SET status = 'degraded', status_message = ?, updated_at = ?
       WHERE id = ?
    `).run(error instanceof Error ? error.message : String(error), timestamp, source.id);
  }
  return getMcpSource(sourceId);
}

export function updateMcpSource(sourceId, patch) {
  const source = getMcpSource(sourceId);
  if (!source) throw new Error(`MCP source "${sourceId}" not found.`);
  const updates = [];
  const params = [];
  const fields = {
    displayName: 'display_name',
    enabled: 'enabled',
    confirmation: 'confirmation',
    risk: 'risk',
  };
  for (const [key, column] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      updates.push(`${column} = ?`);
      params.push(typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : String(patch[key]));
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'allowedRoles')) {
    updates.push('allowed_roles_json = ?');
    params.push(stringifyJson(Array.isArray(patch.allowedRoles) ? patch.allowedRoles : []));
  }
  if (!updates.length) return source;
  updates.push('updated_at = ?');
  params.push(nowIso(), sourceId);
  db.prepare(`UPDATE mcp_sources SET ${updates.join(', ')} WHERE id = ?`).run(...params);
  return getMcpSource(sourceId);
}

export function updateMcpSourceTool(sourceId, originalName, patch) {
  const source = getMcpSource(sourceId);
  if (!source) throw new Error(`MCP source "${sourceId}" not found.`);
  const tool = source.tools.find(candidate => candidate.originalName === originalName);
  if (!tool && sourceId === 'starlink') {
    const timestamp = nowIso();
    db.prepare(`
      INSERT INTO mcp_source_tools
        (source_id, original_name, proxied_name, title, description, input_schema_json, enabled, status, discovered_at, updated_at)
      VALUES ('starlink', ?, ?, ?, ?, '{"type":"object","properties":{}}', 1, 'available', ?, ?)
    `).run(
      originalName,
      originalName,
      typeof patch.title === 'string' && patch.title.trim() ? patch.title.trim() : originalName,
      typeof patch.description === 'string' ? patch.description : '',
      timestamp,
      timestamp,
    );
  } else if (!tool) {
    throw new Error(`MCP tool "${originalName}" not found for source "${sourceId}".`);
  }
  const updates = [];
  const params = [];
  const fields = {
    title: 'title',
    description: 'description',
    enabled: 'enabled',
    confirmation: 'confirmation',
    risk: 'risk',
  };
  for (const [key, column] of Object.entries(fields)) {
    if (Object.prototype.hasOwnProperty.call(patch, key)) {
      updates.push(`${column} = ?`);
      params.push(typeof patch[key] === 'boolean' ? (patch[key] ? 1 : 0) : String(patch[key]));
    }
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'allowedRoles')) {
    updates.push('allowed_roles_json = ?');
    params.push(stringifyJson(Array.isArray(patch.allowedRoles) ? patch.allowedRoles : []));
  }
  if (!updates.length) return getMcpSource(sourceId);
  updates.push('updated_at = ?');
  params.push(nowIso(), sourceId, originalName);
  db.prepare(`UPDATE mcp_source_tools SET ${updates.join(', ')} WHERE source_id = ? AND original_name = ?`).run(...params);
  return getMcpSource(sourceId);
}

export function archiveMcpSource(sourceId) {
  if (sourceId === 'starlink') throw new Error('The built-in Starlink source cannot be archived.');
  const timestamp = nowIso();
  db.prepare(`
    UPDATE mcp_sources
       SET archived = 1, enabled = 0, status = 'archived', archived_at = ?, updated_at = ?
     WHERE id = ?
  `).run(timestamp, timestamp, sourceId);
  return getMcpSource(sourceId);
}

export function migrateStarlinkToolConfig(configByTool) {
  initMcpSourceRegistry();
  if (!isObject(configByTool)) return { migrated: 0 };
  let migrated = 0;
  const timestamp = nowIso();
  const upsert = db.prepare(`
    INSERT INTO mcp_source_tools
      (source_id, original_name, proxied_name, title, description, input_schema_json, enabled, status, confirmation, risk, allowed_roles_json, discovered_at, updated_at)
    VALUES ('starlink', ?, ?, ?, '', '{"type":"object","properties":{}}', ?, 'available', ?, ?, ?, ?, ?)
    ON CONFLICT(source_id, original_name) DO UPDATE SET
      title = excluded.title,
      enabled = excluded.enabled,
      confirmation = excluded.confirmation,
      risk = excluded.risk,
      allowed_roles_json = excluded.allowed_roles_json,
      updated_at = excluded.updated_at
  `);
  const txn = db.transaction(() => {
    for (const [name, config] of Object.entries(configByTool)) {
      if (!isObject(config)) continue;
      upsert.run(
        name,
        name,
        typeof config.displayName === 'string' && config.displayName.trim() ? config.displayName.trim() : name,
        config.enabled === false ? 0 : 1,
        typeof config.confirmation === 'string' ? config.confirmation : 'inherit',
        typeof config.risk === 'string' ? config.risk : 'medium',
        stringifyJson(Array.isArray(config.allowedRoles) ? config.allowedRoles : []),
        timestamp,
        timestamp,
      );
      migrated += 1;
    }
  });
  txn();
  return { migrated };
}

export function getExternalProxyEntries() {
  initMcpSourceRegistry();
  const rows = db.prepare(`
    SELECT
      s.id AS source_id,
      s.display_name AS source_display_name,
      s.url AS source_url,
      s.enabled AS source_enabled,
      s.archived AS source_archived,
      s.status AS source_status,
      t.original_name,
      t.proxied_name,
      t.title,
      t.description,
      t.input_schema_json,
      t.enabled AS tool_enabled,
      t.status AS tool_status
    FROM mcp_source_tools t
    JOIN mcp_sources s ON s.id = t.source_id
    WHERE s.type = 'remote' AND s.archived = 0
    ORDER BY s.id, t.original_name
  `).all();
  const counts = new Map();
  for (const row of rows) {
    if (row.source_enabled && row.source_status === 'connected' && row.tool_enabled && row.tool_status === 'available') {
      counts.set(row.proxied_name, (counts.get(row.proxied_name) ?? 0) + 1);
    }
  }
  return rows.map(row => ({
    sourceId: row.source_id,
    sourceDisplayName: row.source_display_name,
    sourceUrl: row.source_url,
    sourceEnabled: !!row.source_enabled,
    sourceArchived: !!row.source_archived,
    sourceStatus: row.source_status,
    originalName: row.original_name,
    proxiedName: row.proxied_name,
    title: row.title ?? row.original_name,
    description: row.description ?? '',
    inputSchema: parseJson(row.input_schema_json, { type: 'object', properties: {} }),
    toolEnabled: !!row.tool_enabled,
    toolStatus: row.tool_status,
    collision: (counts.get(row.proxied_name) ?? 0) > 1,
  }));
}

export function listAgentVisibleProxyTools() {
  return getExternalProxyEntries()
    .filter(entry => entry.sourceEnabled && entry.sourceStatus === 'connected' && entry.toolEnabled && entry.toolStatus === 'available' && !entry.collision)
    .map(entry => ({
      name: entry.proxiedName,
      title: entry.title,
      description: `[${entry.sourceDisplayName}] ${entry.description || entry.originalName}`,
      inputSchema: entry.inputSchema,
      _meta: {
        sourceId: entry.sourceId,
        originalName: entry.originalName,
      },
    }));
}

export function resolveProxyTool(proxiedName) {
  const candidates = getExternalProxyEntries().filter(entry => entry.proxiedName === proxiedName);
  if (candidates.length === 0) return { ok: false, reason: 'not_found' };
  const active = candidates.filter(entry => entry.sourceEnabled && entry.sourceStatus === 'connected' && entry.toolEnabled && entry.toolStatus === 'available');
  if (active.length > 1) return { ok: false, reason: 'collision', entry: active[0] };
  const entry = active[0] ?? candidates[0];
  if (entry.collision) return { ok: false, reason: 'collision', entry };
  if (!entry.sourceEnabled || entry.sourceArchived) return { ok: false, reason: 'disabled', entry };
  if (entry.sourceStatus !== 'connected') return { ok: false, reason: 'unavailable', entry };
  if (!entry.toolEnabled || entry.toolStatus !== 'available') return { ok: false, reason: 'disabled', entry };
  return { ok: true, entry };
}

export async function callProxyTool(proxiedName, args = {}) {
  const resolved = resolveProxyTool(proxiedName);
  if (!resolved.ok) {
    const source = resolved.entry?.sourceId ?? 'unknown';
    throw new Error(`MCP source ${source} cannot run ${proxiedName}: ${resolved.reason}.`);
  }
  const { entry } = resolved;
  const sessionId = await initializeRemoteSession(entry.sourceUrl, CALL_TIMEOUT_MS);
  const response = await postMcpRpc(entry.sourceUrl, {
    jsonrpc: '2.0',
    id: `td-call-${randomUUID()}`,
    method: 'tools/call',
    params: {
      name: entry.originalName,
      arguments: isObject(args) ? args : {},
    },
  }, sessionId, CALL_TIMEOUT_MS);
  if (response.data?.error) {
    const message = response.data.error.message ?? 'upstream error';
    throw new Error(`MCP source ${entry.sourceId} returned upstream error: ${message}`);
  }
  if (!Object.prototype.hasOwnProperty.call(response.data ?? {}, 'result')) {
    throw new Error(`MCP source ${entry.sourceId} returned an invalid tool result shape.`);
  }
  return response.data.result;
}

export function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function jsonRpcError(id, message, code = -32000, data = undefined) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

export async function refreshEnabledSourcesInBackground() {
  const sources = listMcpSources().filter(source => source.type === 'remote' && source.enabled && !source.archived);
  for (const source of sources) {
    void refreshMcpSource(source.id).catch(() => {});
    await delay(10);
  }
}

function sendRouteError(res, error, status = 400) {
  res.status(status).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

export function registerMcpSourceRoutes(app) {
  app.get('/internal/mcp-sources', (_req, res) => {
    res.json({ ok: true, sources: listMcpSources() });
  });

  app.post('/internal/mcp-sources/discover', async (req, res) => {
    try {
      const tools = await discoverRemoteMcpSource(req.body?.url);
      res.json({ ok: true, tools });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post('/internal/mcp-sources', async (req, res) => {
    try {
      const source = await createRemoteMcpSource(req.body ?? {});
      res.json({ ok: true, source });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post('/internal/mcp-sources/migrate-starlink-config', (req, res) => {
    try {
      res.json({ ok: true, ...migrateStarlinkToolConfig(req.body?.configByTool ?? {}) });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post('/internal/mcp-sources/:sourceId/refresh', async (req, res) => {
    try {
      const source = await refreshMcpSource(req.params.sourceId);
      res.json({ ok: true, source });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.patch('/internal/mcp-sources/:sourceId', (req, res) => {
    try {
      const source = updateMcpSource(req.params.sourceId, req.body ?? {});
      res.json({ ok: true, source });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.patch('/internal/mcp-sources/:sourceId/tools/:toolName', (req, res) => {
    try {
      const source = updateMcpSourceTool(req.params.sourceId, decodeURIComponent(req.params.toolName), req.body ?? {});
      res.json({ ok: true, source });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.delete('/internal/mcp-sources/:sourceId', (req, res) => {
    try {
      const source = archiveMcpSource(req.params.sourceId);
      res.json({ ok: true, source });
    } catch (error) {
      sendRouteError(res, error);
    }
  });
}
