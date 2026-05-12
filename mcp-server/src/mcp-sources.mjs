import { randomUUID } from 'crypto';
import { spawn } from 'child_process';
import { setTimeout as delay } from 'timers/promises';
import { db } from './db/index.mjs';

const MCP_PROTOCOL_VERSION = '2025-11-25';
const SOURCE_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const DISCOVERY_TIMEOUT_MS = 10_000;
const CALL_TIMEOUT_MS = 30_000;
const STALE_AFTER_MS = 60 * 60 * 1000;
const APPROVAL_REQUIRED_MESSAGE = 'approval_required: this MCP tool call is waiting for approval in the MCP Toolbox.';
const PROBE_PATHS = ['/mcp', '/sse', '/message', '/messages', '/'];

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

function normalizePositiveInt(value, fallback, min = 1000, max = 300_000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.min(max, Math.max(min, Math.round(parsed)));
}

function normalizeProbeHost(host) {
  const raw = String(host || '127.0.0.1').trim();
  if (!raw) return '127.0.0.1';
  if (/^https?:\/\//i.test(raw)) {
    const parsed = new URL(raw);
    return parsed.hostname;
  }
  if (raw.includes('/') || raw.includes('\\') || raw.includes('@')) throw new Error('Probe host must be a hostname or IP address.');
  if (!/^[a-zA-Z0-9.:[\]-]+$/.test(raw)) throw new Error('Probe host contains unsupported characters.');
  return raw.replace(/^\[(.*)\]$/, '$1');
}

function normalizeProbePorts(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  const ports = [];
  for (const item of values) {
    const text = String(item || '').trim();
    if (!text) continue;
    const range = text.match(/^(\d+)\s*-\s*(\d+)$/);
    if (range) {
      const start = Number(range[1]);
      const end = Number(range[2]);
      if (!Number.isInteger(start) || !Number.isInteger(end) || start < 1 || end > 65535 || end < start || end - start > 15) {
        throw new Error('Probe port ranges must be valid and no wider than 16 ports.');
      }
      for (let port = start; port <= end; port += 1) ports.push(port);
      continue;
    }
    const port = Number(text);
    if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Probe ports must be between 1 and 65535.');
    ports.push(port);
  }
  const unique = [...new Set(ports)].slice(0, 16);
  if (!unique.length) throw new Error('Enter at least one port to probe.');
  return unique;
}

function normalizeProbePaths(paths) {
  const values = Array.isArray(paths) && paths.length ? paths : PROBE_PATHS;
  return [...new Set(values
    .map(path => String(path || '').trim())
    .filter(path => path.startsWith('/') && path.length <= 80))]
    .slice(0, 8);
}

function addColumnIfMissing(table, column, definition) {
  const columns = db.prepare(`PRAGMA table_info(${table})`).all().map(row => row.name);
  if (!columns.includes(column)) db.exec(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
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

export function validateRemoteSourceUrl(url, { allowPublic = false } = {}) {
  let parsed;
  try {
    parsed = new URL(String(url || ''));
  } catch {
    return { ok: false, error: 'Enter a valid HTTP MCP URL.' };
  }
  if (!['http:', 'https:'].includes(parsed.protocol)) {
    return { ok: false, error: 'Only HTTP/S MCP endpoints are supported for remote sources.' };
  }
  if (!allowPublic && !isPrivateAddress(parsed.hostname)) {
    return { ok: false, error: 'Only localhost and private-network MCP URLs are supported until the source trust review is accepted.' };
  }
  return { ok: true, url: parsed.toString(), publicInternet: !isPrivateAddress(parsed.hostname) };
}

function normalizeHeaderMap(headers) {
  const output = {};
  if (!isObject(headers)) return output;
  for (const [key, value] of Object.entries(headers)) {
    const name = String(key || '').trim();
    if (!name || /^(accept|content-type|mcp-session-id|content-length)$/i.test(name)) continue;
    if (typeof value === 'string' && value) output[name] = value;
  }
  return output;
}

export function normalizeAuthConfig(auth) {
  if (!isObject(auth) || auth.type === 'none' || !auth.type) return { type: 'none' };
  if (auth.type === 'bearer') {
    const bearerToken = String(auth.bearerToken || auth.token || '').trim();
    if (!bearerToken) return { type: 'none' };
    return { type: 'bearer', bearerToken };
  }
  if (auth.type === 'headers') {
    const headers = normalizeHeaderMap(auth.headers);
    return Object.keys(headers).length ? { type: 'headers', headers } : { type: 'none' };
  }
  return { type: 'none' };
}

function authHeaders(auth) {
  if (auth?.type === 'bearer' && auth.bearerToken) return { Authorization: `Bearer ${auth.bearerToken}` };
  if (auth?.type === 'headers') return normalizeHeaderMap(auth.headers);
  return {};
}

function redactAuthConfig(auth) {
  if (auth?.type === 'bearer') return { type: 'bearer', hasBearerToken: !!auth.bearerToken, headerNames: ['Authorization'] };
  if (auth?.type === 'headers') return { type: 'headers', hasBearerToken: false, headerNames: Object.keys(normalizeHeaderMap(auth.headers)) };
  return { type: 'none', hasBearerToken: false, headerNames: [] };
}

function normalizeDefaultArgs(defaultArgs) {
  return isObject(defaultArgs) ? defaultArgs : {};
}

function normalizeStdioConfig(input) {
  const config = isObject(input?.config) ? input.config : input;
  const command = String(config.command || '').trim();
  if (!command) throw new Error('Stdio MCP sources require a command.');
  return {
    command,
    args: Array.isArray(config.args) ? config.args.map(String) : [],
    env: normalizeHeaderMap(config.env),
    cwd: typeof config.cwd === 'string' && config.cwd.trim() ? config.cwd.trim() : undefined,
  };
}

function normalizeManagedConfig(input) {
  const integration = String(input.integration || input.managedIntegration || '').trim();
  if (!integration) throw new Error('Managed MCP sources require an integration id.');
  if (integration === 'node-stdio') return { integration, ...normalizeStdioConfig(input) };
  throw new Error(`Managed MCP integration "${integration}" is not available in this build.`);
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
      config_json TEXT,
      default_args_json TEXT NOT NULL DEFAULT '{}',
      call_timeout_ms INTEGER NOT NULL DEFAULT 30000,
      stale_after_ms INTEGER NOT NULL DEFAULT 3600000,
      trust_accepted INTEGER NOT NULL DEFAULT 0,
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
      default_args_json TEXT NOT NULL DEFAULT '{}',
      discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_id, original_name),
      FOREIGN KEY(source_id) REFERENCES mcp_sources(id)
    );
    CREATE TABLE IF NOT EXISTS mcp_source_resources (
      source_id TEXT NOT NULL,
      original_uri TEXT NOT NULL,
      proxied_uri TEXT NOT NULL,
      name TEXT,
      description TEXT,
      mime_type TEXT,
      status TEXT NOT NULL DEFAULT 'available',
      discovered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (source_id, original_uri),
      FOREIGN KEY(source_id) REFERENCES mcp_sources(id)
    );
    CREATE TABLE IF NOT EXISTS mcp_proxy_audit (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      source_id TEXT,
      proxied_name TEXT,
      original_name TEXT,
      session_id TEXT,
      role TEXT,
      status TEXT NOT NULL,
      message TEXT,
      args_json TEXT,
      result_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS mcp_tool_approvals (
      id TEXT PRIMARY KEY,
      source_id TEXT NOT NULL,
      proxied_name TEXT NOT NULL,
      original_name TEXT NOT NULL,
      session_id TEXT,
      role TEXT,
      risk TEXT,
      confirmation TEXT,
      args_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'pending',
      requested_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      resolved_at TEXT,
      resolved_by TEXT,
      reason TEXT
    );
    CREATE INDEX IF NOT EXISTS idx_mcp_source_tools_proxied_name ON mcp_source_tools(proxied_name);
    CREATE INDEX IF NOT EXISTS idx_mcp_source_resources_proxied_uri ON mcp_source_resources(proxied_uri);
    CREATE INDEX IF NOT EXISTS idx_mcp_proxy_audit_created_at ON mcp_proxy_audit(created_at, id);
    CREATE INDEX IF NOT EXISTS idx_mcp_tool_approvals_status ON mcp_tool_approvals(status, requested_at);
  `);

  for (const [column, definition] of [
    ['config_json', 'TEXT'],
    ['default_args_json', "TEXT NOT NULL DEFAULT '{}'"],
    ['call_timeout_ms', 'INTEGER NOT NULL DEFAULT 30000'],
    ['stale_after_ms', 'INTEGER NOT NULL DEFAULT 3600000'],
    ['trust_accepted', 'INTEGER NOT NULL DEFAULT 0'],
  ]) {
    addColumnIfMissing('mcp_sources', column, definition);
  }
  addColumnIfMissing('mcp_source_tools', 'default_args_json', "TEXT NOT NULL DEFAULT '{}'");

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
    defaultArgs: parseJson(row.default_args_json, {}),
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at,
  };
}

function rowToResource(row) {
  return {
    sourceId: row.source_id,
    originalUri: row.original_uri,
    proxiedUri: row.proxied_uri,
    name: row.name ?? row.original_uri,
    description: row.description ?? '',
    mimeType: row.mime_type ?? null,
    status: row.status,
    discoveredAt: row.discovered_at,
    updatedAt: row.updated_at,
  };
}

function rowToSource(row, tools = [], resources = []) {
  const auth = parseJson(row.auth_json, { type: 'none' });
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
    auth: redactAuthConfig(auth),
    config: parseJson(row.config_json, null),
    defaultArgs: parseJson(row.default_args_json, {}),
    callTimeoutMs: row.call_timeout_ms ?? CALL_TIMEOUT_MS,
    staleAfterMs: row.stale_after_ms ?? STALE_AFTER_MS,
    trustAccepted: !!row.trust_accepted,
    lastDiscoveredAt: row.last_discovered_at ?? null,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    archivedAt: row.archived_at ?? null,
    tools,
    resources,
  };
}

function getSourceRow(sourceId) {
  initMcpSourceRegistry();
  return db.prepare('SELECT * FROM mcp_sources WHERE id = ?').get(sourceId) ?? null;
}

function rowRuntimeConfig(row) {
  return {
    auth: parseJson(row?.auth_json, { type: 'none' }),
    config: parseJson(row?.config_json, null),
    defaultArgs: parseJson(row?.default_args_json, {}),
    callTimeoutMs: normalizePositiveInt(row?.call_timeout_ms, CALL_TIMEOUT_MS),
    trustAccepted: !!row?.trust_accepted,
  };
}

export function listMcpSources({ includeArchived = false } = {}) {
  initMcpSourceRegistry();
  const sources = db.prepare(`
    SELECT * FROM mcp_sources
    ${includeArchived ? '' : 'WHERE archived = 0'}
    ORDER BY CASE id WHEN 'starlink' THEN 0 ELSE 1 END, archived, display_name COLLATE NOCASE
  `).all();
  const toolRows = db.prepare('SELECT * FROM mcp_source_tools ORDER BY source_id, original_name COLLATE NOCASE').all();
  const resourceRows = db.prepare('SELECT * FROM mcp_source_resources ORDER BY source_id, name COLLATE NOCASE').all();
  const toolsBySource = new Map();
  const resourcesBySource = new Map();
  for (const row of toolRows) {
    if (!toolsBySource.has(row.source_id)) toolsBySource.set(row.source_id, []);
    toolsBySource.get(row.source_id).push(rowToTool(row));
  }
  for (const row of resourceRows) {
    if (!resourcesBySource.has(row.source_id)) resourcesBySource.set(row.source_id, []);
    resourcesBySource.get(row.source_id).push(rowToResource(row));
  }
  return sources.map(source => rowToSource(source, toolsBySource.get(source.id) ?? [], resourcesBySource.get(source.id) ?? []));
}

export function getMcpSource(sourceId) {
  initMcpSourceRegistry();
  const row = getSourceRow(sourceId);
  if (!row) return null;
  const tools = db.prepare('SELECT * FROM mcp_source_tools WHERE source_id = ? ORDER BY original_name').all(sourceId).map(rowToTool);
  const resources = db.prepare('SELECT * FROM mcp_source_resources WHERE source_id = ? ORDER BY name').all(sourceId).map(rowToResource);
  return rowToSource(row, tools, resources);
}

function proxiedResourceUri(sourceId, originalUri) {
  return `td-mcp://${sourceId}/${encodeURIComponent(originalUri)}`;
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

function upsertDiscoveredResources(sourceId, resources) {
  const discoveredAt = nowIso();
  const seen = new Set();
  const insert = db.prepare(`
    INSERT INTO mcp_source_resources
      (source_id, original_uri, proxied_uri, name, description, mime_type, status, discovered_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 'available', ?, ?)
    ON CONFLICT(source_id, original_uri) DO UPDATE SET
      proxied_uri = excluded.proxied_uri,
      name = excluded.name,
      description = excluded.description,
      mime_type = excluded.mime_type,
      status = 'available',
      discovered_at = excluded.discovered_at,
      updated_at = excluded.updated_at
  `);
  const txn = db.transaction(() => {
    for (const resource of resources) {
      if (!resource?.uri || seen.has(resource.uri)) continue;
      seen.add(resource.uri);
      insert.run(
        sourceId,
        resource.uri,
        proxiedResourceUri(sourceId, resource.uri),
        resource.name ?? resource.uri,
        resource.description ?? '',
        resource.mimeType ?? null,
        discoveredAt,
        discoveredAt,
      );
    }
    if (seen.size > 0) {
      const placeholders = Array.from(seen).map(() => '?').join(',');
      db.prepare(`
        UPDATE mcp_source_resources
           SET status = 'stale', updated_at = ?
         WHERE source_id = ? AND original_uri NOT IN (${placeholders})
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

function normalizeDiscoveredResources(payload) {
  const resources = isObject(payload?.result) && Array.isArray(payload.result.resources) ? payload.result.resources : [];
  return resources
    .filter(resource => isObject(resource) && typeof resource.uri === 'string' && resource.uri.trim())
    .map(resource => ({
      uri: resource.uri.trim(),
      name: typeof resource.name === 'string' ? resource.name : undefined,
      description: typeof resource.description === 'string' ? resource.description : undefined,
      mimeType: typeof resource.mimeType === 'string' ? resource.mimeType : undefined,
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

async function postMcpRpc(url, body, sessionId, timeoutMs, extraHeaders = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
        ...extraHeaders,
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

async function initializeRemoteSession(url, timeoutMs, headers = {}) {
  const initialized = await postMcpRpc(url, {
    jsonrpc: '2.0',
    id: `td-init-${randomUUID()}`,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'terminal-docks-starlink-proxy', version: '0.1.0' },
    },
  }, undefined, timeoutMs, headers);
  if (!initialized.sessionId) throw new Error('MCP initialize did not return a session id.');
  await postMcpRpc(url, {
    jsonrpc: '2.0',
    method: 'notifications/initialized',
    params: {},
  }, initialized.sessionId, timeoutMs, headers);
  return initialized.sessionId;
}

async function discoverRemoteCapabilities(url, { timeoutMs = DISCOVERY_TIMEOUT_MS, auth = { type: 'none' }, trustAccepted = false } = {}) {
  const validation = validateRemoteSourceUrl(url, { allowPublic: trustAccepted });
  if (!validation.ok) throw new Error(validation.error);
  const headers = authHeaders(auth);
  const sessionId = await initializeRemoteSession(validation.url, timeoutMs, headers);
  const listed = await postMcpRpc(validation.url, {
    jsonrpc: '2.0',
    id: `td-list-${randomUUID()}`,
    method: 'tools/list',
    params: {},
  }, sessionId, timeoutMs, headers);
  let resources = [];
  try {
    const resourceList = await postMcpRpc(validation.url, {
      jsonrpc: '2.0',
      id: `td-resources-${randomUUID()}`,
      method: 'resources/list',
      params: {},
    }, sessionId, timeoutMs, headers);
    resources = normalizeDiscoveredResources(resourceList.data);
  } catch {
    resources = [];
  }
  return { tools: normalizeDiscoveredTools(listed.data), resources };
}

export async function discoverRemoteMcpSource(url, options = {}) {
  return (await discoverRemoteCapabilities(url, options)).tools;
}

async function fetchWithProbeTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchTextWithProbeTimeout(url, init, timeoutMs) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const text = await response.text();
    return { response, text };
  } finally {
    clearTimeout(timeout);
  }
}

function classifyProbeError(error) {
  const message = error instanceof Error ? error.message : String(error);
  if (error?.name === 'AbortError' || /abort|timeout|timed out/i.test(message)) {
    return { status: 'timeout', detail: 'No complete MCP response before the probe timeout.' };
  }
  if (/ECONNREFUSED|fetch failed|connect|ENOTFOUND|EHOSTUNREACH|ECONNRESET/i.test(message)) {
    return { status: 'unreachable', detail: message };
  }
  return { status: 'rejected', detail: message };
}

async function probeMcpUrl(url, timeoutMs) {
  let postRejection = null;
  const initializeBody = {
    jsonrpc: '2.0',
    id: `td-probe-${randomUUID()}`,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'terminal-docks-mcp-prober', version: '0.1.0' },
    },
  };
  try {
    const { response, text } = await fetchTextWithProbeTimeout(url, {
      method: 'POST',
      headers: {
        Accept: 'application/json, text/event-stream',
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(initializeBody),
    }, timeoutMs);
    const contentType = response.headers.get('content-type') || '';
    if (!response.ok) {
      postRejection = { url, status: 'rejected', detail: `HTTP ${response.status}`, httpStatus: response.status, contentType };
    } else {
      if (contentType.includes('text/event-stream')) {
        return { url, status: 'possible_mcp_sse', detail: 'Endpoint opened an SSE response; run discovery to confirm.', httpStatus: response.status, contentType };
      }
      const payload = parseRpcPayload(text);
      if (isObject(payload?.result)) {
        return { url, status: 'valid_mcp', detail: 'MCP initialize completed.', httpStatus: response.status, contentType };
      }
      if (isObject(payload?.error)) {
        postRejection = { url, status: 'rejected', detail: payload.error.message || 'MCP initialize returned an error.', httpStatus: response.status, contentType };
      } else {
        postRejection = { url, status: 'rejected', detail: 'Response was not an MCP initialize result.', httpStatus: response.status, contentType };
      }
    }
  } catch (error) {
    const classified = classifyProbeError(error);
    if (classified.status !== 'timeout') return { url, ...classified };
  }

  try {
    const response = await fetchWithProbeTimeout(url, {
      method: 'GET',
      headers: { Accept: 'text/event-stream, application/json' },
    }, timeoutMs);
    const contentType = response.headers.get('content-type') || '';
    if (response.ok && contentType.includes('text/event-stream')) {
      return { url, status: 'possible_mcp_sse', detail: 'Endpoint accepts SSE connections; run discovery to confirm.', httpStatus: response.status, contentType };
    }
    return postRejection ?? { url, status: response.ok ? 'rejected' : 'unreachable', detail: `HTTP ${response.status}`, httpStatus: response.status, contentType };
  } catch (error) {
    const classified = classifyProbeError(error);
    return postRejection && classified.status === 'unreachable' ? postRejection : { url, ...classified };
  }
}

export async function probeMcpSourcePorts(input = {}) {
  const host = normalizeProbeHost(input.host);
  const ports = normalizeProbePorts(input.ports ?? input.port);
  const paths = normalizeProbePaths(input.paths);
  const timeoutMs = normalizePositiveInt(input.timeoutMs, 1200, 300, 5000);
  const protocol = String(input.protocol || 'http').toLowerCase() === 'https' ? 'https' : 'http';
  const displayHost = host.includes(':') && !host.startsWith('[') ? `[${host}]` : host;
  const candidates = [];
  for (const port of ports) {
    for (const path of paths) candidates.push(`${protocol}://${displayHost}:${port}${path}`);
  }
  const results = [];
  for (const url of candidates) results.push(await probeMcpUrl(url, timeoutMs));
  return { host, ports, paths, timeoutMs, results };
}

async function runStdioMcpSequence(config, sequence, timeoutMs) {
  const child = spawn(config.command, config.args ?? [], {
    cwd: config.cwd,
    env: { ...process.env, ...(config.env ?? {}) },
    stdio: ['pipe', 'pipe', 'pipe'],
    windowsHide: true,
  });
  let stdout = '';
  let stderr = '';
  let nextIndex = 0;
  const pending = new Map();
  const finishLine = (line) => {
    if (!line.trim()) return;
    let message;
    try {
      message = JSON.parse(line);
    } catch {
      return;
    }
    if (Object.prototype.hasOwnProperty.call(message, 'id') && pending.has(message.id)) {
      pending.get(message.id)(message);
      pending.delete(message.id);
    }
  };
  child.stdout.on('data', chunk => {
    stdout += chunk.toString('utf8');
    const lines = stdout.split(/\r?\n/);
    stdout = lines.pop() ?? '';
    for (const line of lines) finishLine(line);
  });
  child.stderr.on('data', chunk => { stderr += chunk.toString('utf8'); });

  const deadline = Date.now() + timeoutMs;
  const waitForResponse = (id) => new Promise((resolve, reject) => {
    pending.set(id, resolve);
    const poll = () => {
      if (!pending.has(id)) return;
      if (Date.now() >= deadline) {
        pending.delete(id);
        reject(new Error(`stdio MCP request timed out${stderr ? `: ${stderr.slice(0, 240)}` : ''}`));
        return;
      }
      setTimeout(poll, 20);
    };
    poll();
  });

  try {
    const results = [];
    for (const item of sequence) {
      const body = { ...item.body };
      if (item.expectResponse && !Object.prototype.hasOwnProperty.call(body, 'id')) body.id = `td-stdio-${nextIndex++}`;
      child.stdin.write(`${JSON.stringify(body)}\n`);
      if (item.expectResponse) results.push(await waitForResponse(body.id));
    }
    return results;
  } finally {
    child.stdin.end();
    child.kill();
  }
}

async function discoverStdioCapabilities(config, { timeoutMs = DISCOVERY_TIMEOUT_MS } = {}) {
  const [initialized, listed, resourcesResult] = await runStdioMcpSequence(config, [
    {
      expectResponse: true,
      body: {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'terminal-docks-starlink-stdio-proxy', version: '0.1.0' },
        },
      },
    },
    { expectResponse: false, body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } },
    { expectResponse: true, body: { jsonrpc: '2.0', method: 'tools/list', params: {} } },
    { expectResponse: true, body: { jsonrpc: '2.0', method: 'resources/list', params: {} } },
  ], timeoutMs);
  if (initialized?.error) throw new Error(initialized.error.message ?? 'stdio MCP initialize failed');
  return {
    tools: normalizeDiscoveredTools(listed),
    resources: resourcesResult?.error ? [] : normalizeDiscoveredResources(resourcesResult),
  };
}

function persistSource(input, { type, transport, url = null, config = null, tools = [], resources = [], status = 'connected', statusMessage = null }) {
  const timestamp = nowIso();
  const id = String(input.id || '').trim();
  const enabled = status === 'connected' && input.enabled !== false;
  const auth = normalizeAuthConfig(input.auth);
  db.prepare(`
    INSERT INTO mcp_sources
      (id, display_name, type, transport, url, enabled, archived, status, status_message, confirmation, risk, allowed_roles_json, auth_json, config_json, default_args_json, call_timeout_ms, stale_after_ms, trust_accepted, last_discovered_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    String(input.displayName || id),
    type,
    transport,
    url,
    enabled ? 1 : 0,
    status,
    statusMessage,
    input.confirmation ?? 'inherit',
    input.risk ?? 'medium',
    stringifyJson(Array.isArray(input.allowedRoles) ? input.allowedRoles : []),
    stringifyJson(auth),
    config ? stringifyJson(config) : null,
    stringifyJson(normalizeDefaultArgs(input.defaultArgs)),
    normalizePositiveInt(input.callTimeoutMs, CALL_TIMEOUT_MS),
    normalizePositiveInt(input.staleAfterMs, STALE_AFTER_MS, 10_000, 86_400_000),
    input.trustAccepted ? 1 : 0,
    tools.length || resources.length ? timestamp : null,
    timestamp,
    timestamp,
  );
  if (tools.length) upsertDiscoveredTools(id, tools);
  if (resources.length) upsertDiscoveredResources(id, resources);
  return getMcpSource(id);
}

function ensureNewSourceId(input) {
  const id = String(input.id || '').trim();
  if (!validateSourceId(id)) throw new Error('Source ID must match lowercase snake format, e.g. excalidraw or github_tools.');
  const existing = db.prepare('SELECT id FROM mcp_sources WHERE id = ?').get(id);
  if (existing) throw new Error(`MCP source id "${id}" is already reserved.`);
  return id;
}

export async function createRemoteMcpSource(input) {
  initMcpSourceRegistry();
  ensureNewSourceId(input);
  const auth = normalizeAuthConfig(input.auth);
  const validation = validateRemoteSourceUrl(input.url, { allowPublic: !!input.trustAccepted });
  if (!validation.ok) throw new Error(validation.error);

  let tools = [];
  let resources = [];
  let status = 'degraded';
  let statusMessage = null;
  try {
    const capabilities = await discoverRemoteCapabilities(validation.url, {
      auth,
      trustAccepted: !!input.trustAccepted,
      timeoutMs: normalizePositiveInt(input.callTimeoutMs, DISCOVERY_TIMEOUT_MS),
    });
    tools = capabilities.tools;
    resources = capabilities.resources;
    status = 'connected';
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : String(error);
    if (!input.saveDegraded) throw error;
  }
  return persistSource({ ...input, auth }, { type: 'remote', transport: 'http', url: validation.url, tools, resources, status, statusMessage });
}

export async function createStdioMcpSource(input) {
  initMcpSourceRegistry();
  ensureNewSourceId(input);
  const config = normalizeStdioConfig(input);
  let tools = [];
  let resources = [];
  let status = 'degraded';
  let statusMessage = null;
  try {
    const capabilities = await discoverStdioCapabilities(config, { timeoutMs: normalizePositiveInt(input.callTimeoutMs, DISCOVERY_TIMEOUT_MS) });
    tools = capabilities.tools;
    resources = capabilities.resources;
    status = 'connected';
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : String(error);
    if (!input.saveDegraded) throw error;
  }
  return persistSource(input, { type: 'stdio', transport: 'stdio', config, tools, resources, status, statusMessage });
}

export async function createManagedMcpSource(input) {
  const config = normalizeManagedConfig(input);
  initMcpSourceRegistry();
  ensureNewSourceId(input);
  let tools = [];
  let resources = [];
  let status = 'degraded';
  let statusMessage = null;
  try {
    const capabilities = await discoverStdioCapabilities(config, { timeoutMs: normalizePositiveInt(input.callTimeoutMs, DISCOVERY_TIMEOUT_MS) });
    tools = capabilities.tools;
    resources = capabilities.resources;
    status = 'connected';
  } catch (error) {
    statusMessage = error instanceof Error ? error.message : String(error);
    if (!input.saveDegraded) throw error;
  }
  return persistSource(
    { ...input, displayName: input.displayName || `Managed ${config.integration}` },
    { type: 'managed', transport: 'stdio', config, tools, resources, status, statusMessage },
  );
}

export async function createMcpSource(input) {
  const type = String(input?.type || input?.transport || 'remote').toLowerCase();
  if (type === 'stdio') return createStdioMcpSource(input);
  if (type === 'managed') return createManagedMcpSource(input);
  return createRemoteMcpSource(input);
}

async function discoverCapabilitiesForSource(row) {
  const runtime = rowRuntimeConfig(row);
  if (row.transport === 'stdio') return discoverStdioCapabilities(runtime.config, { timeoutMs: runtime.callTimeoutMs });
  return discoverRemoteCapabilities(row.url, { auth: runtime.auth, trustAccepted: runtime.trustAccepted, timeoutMs: runtime.callTimeoutMs });
}

export async function refreshMcpSource(sourceId) {
  const source = getMcpSource(sourceId);
  const row = getSourceRow(sourceId);
  if (!source || !row) throw new Error(`MCP source "${sourceId}" not found.`);
  if (source.type === 'builtin') return source;
  if (source.archived) throw new Error(`MCP source "${sourceId}" is archived.`);
  try {
    const { tools, resources } = await discoverCapabilitiesForSource(row);
    const discoveredAt = upsertDiscoveredTools(source.id, tools);
    if (resources.length) upsertDiscoveredResources(source.id, resources);
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
    trustAccepted: 'trust_accepted',
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
  if (Object.prototype.hasOwnProperty.call(patch, 'auth')) {
    updates.push('auth_json = ?');
    params.push(stringifyJson(normalizeAuthConfig(patch.auth)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'defaultArgs')) {
    updates.push('default_args_json = ?');
    params.push(stringifyJson(normalizeDefaultArgs(patch.defaultArgs)));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'callTimeoutMs')) {
    updates.push('call_timeout_ms = ?');
    params.push(normalizePositiveInt(patch.callTimeoutMs, CALL_TIMEOUT_MS));
  }
  if (Object.prototype.hasOwnProperty.call(patch, 'staleAfterMs')) {
    updates.push('stale_after_ms = ?');
    params.push(normalizePositiveInt(patch.staleAfterMs, STALE_AFTER_MS, 10_000, 86_400_000));
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
  if (Object.prototype.hasOwnProperty.call(patch, 'defaultArgs')) {
    updates.push('default_args_json = ?');
    params.push(stringifyJson(normalizeDefaultArgs(patch.defaultArgs)));
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

export function restoreMcpSource(sourceId) {
  if (sourceId === 'starlink') return getMcpSource(sourceId);
  const timestamp = nowIso();
  const result = db.prepare(`
    UPDATE mcp_sources
       SET archived = 0, enabled = 0, status = 'disabled', archived_at = NULL, updated_at = ?
     WHERE id = ? AND archived = 1
  `).run(timestamp, sourceId);
  if (!result.changes) throw new Error(`Archived MCP source "${sourceId}" not found.`);
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

export function previewMcpClientConfig(input) {
  const config = isObject(input?.config) ? input.config : input;
  const candidates = [];
  const containers = [
    config?.mcpServers,
    config?.mcp_servers,
    config?.mcp?.servers,
    config?.mcp,
  ].filter(isObject);
  for (const container of containers) {
    for (const [id, value] of Object.entries(container)) {
      if (!isObject(value)) continue;
      if (typeof value.url === 'string') {
        candidates.push({ id, type: 'remote', url: value.url, displayName: value.name ?? id, auth: redactAuthConfig(normalizeAuthConfig(value.auth)) });
      } else if (typeof value.command === 'string') {
        candidates.push({ id, type: 'stdio', command: value.command, args: Array.isArray(value.args) ? value.args.map(String) : [], displayName: value.name ?? id });
      }
    }
  }
  return { sources: candidates };
}

export function getCuratedMcpSourceCatalog() {
  return [
    { id: 'remote_http', type: 'remote', name: 'Remote HTTP/SSE MCP', description: 'Connect a local, private-network, or trusted authenticated HTTP MCP endpoint.' },
    { id: 'stdio_command', type: 'stdio', name: 'Stdio command', description: 'Launch a supervised local MCP server over stdio.' },
    { id: 'node_stdio', type: 'managed', integration: 'node-stdio', name: 'Managed Node stdio', description: 'Run a selected Node-based stdio MCP command with Terminal Docks supervision.' },
  ];
}

function effectiveEntrySettings(row) {
  const sourceRoles = parseJson(row.source_allowed_roles_json, []);
  const toolRoles = parseJson(row.tool_allowed_roles_json, []);
  const sourceDefaults = parseJson(row.source_default_args_json, {});
  const toolDefaults = parseJson(row.tool_default_args_json, {});
  const confirmation = row.tool_confirmation && row.tool_confirmation !== 'inherit' ? row.tool_confirmation : row.source_confirmation;
  const risk = row.tool_risk && row.tool_risk !== 'inherit' ? row.tool_risk : row.source_risk;
  return {
    confirmation,
    risk,
    allowedRoles: toolRoles.length ? toolRoles : sourceRoles,
    defaultArgs: { ...sourceDefaults, ...toolDefaults },
    callTimeoutMs: normalizePositiveInt(row.call_timeout_ms, CALL_TIMEOUT_MS),
  };
}

export function getExternalProxyEntries() {
  initMcpSourceRegistry();
  const rows = db.prepare(`
    SELECT
      s.id AS source_id,
      s.display_name AS source_display_name,
      s.url AS source_url,
      s.transport AS source_transport,
      s.config_json AS source_config_json,
      s.auth_json AS source_auth_json,
      s.enabled AS source_enabled,
      s.archived AS source_archived,
      s.status AS source_status,
      s.confirmation AS source_confirmation,
      s.risk AS source_risk,
      s.allowed_roles_json AS source_allowed_roles_json,
      s.default_args_json AS source_default_args_json,
      s.call_timeout_ms,
      t.original_name,
      t.proxied_name,
      t.title,
      t.description,
      t.input_schema_json,
      t.enabled AS tool_enabled,
      t.status AS tool_status,
      t.confirmation AS tool_confirmation,
      t.risk AS tool_risk,
      t.allowed_roles_json AS tool_allowed_roles_json,
      t.default_args_json AS tool_default_args_json
    FROM mcp_source_tools t
    JOIN mcp_sources s ON s.id = t.source_id
    WHERE s.type IN ('remote', 'stdio', 'managed') AND s.archived = 0
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
    sourceTransport: row.source_transport,
    sourceConfig: parseJson(row.source_config_json, null),
    sourceAuth: parseJson(row.source_auth_json, { type: 'none' }),
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
    ...effectiveEntrySettings(row),
  }));
}

function roleAllowed(entry, role) {
  if (!entry.allowedRoles?.length) return true;
  if (!role) return false;
  return entry.allowedRoles.includes(role);
}

export function listAgentVisibleProxyTools(context = {}) {
  return getExternalProxyEntries()
    .filter(entry => entry.sourceEnabled && entry.sourceStatus === 'connected' && entry.toolEnabled && entry.toolStatus === 'available' && !entry.collision)
    .filter(entry => roleAllowed(entry, context.role))
    .map(entry => ({
      name: entry.proxiedName,
      title: entry.title,
      description: `[${entry.sourceDisplayName}] ${entry.description || entry.originalName}`,
      inputSchema: entry.inputSchema,
      _meta: {
        sourceId: entry.sourceId,
        originalName: entry.originalName,
        risk: entry.risk,
        confirmation: entry.confirmation,
      },
    }));
}

export function resolveProxyTool(proxiedName, context = {}) {
  const candidates = getExternalProxyEntries().filter(entry => entry.proxiedName === proxiedName);
  if (candidates.length === 0) return { ok: false, reason: 'not_found' };
  const active = candidates.filter(entry => entry.sourceEnabled && entry.sourceStatus === 'connected' && entry.toolEnabled && entry.toolStatus === 'available');
  if (active.length > 1) return { ok: false, reason: 'collision', entry: active[0] };
  const entry = active[0] ?? candidates[0];
  if (entry.collision) return { ok: false, reason: 'collision', entry };
  if (!entry.sourceEnabled || entry.sourceArchived) return { ok: false, reason: 'disabled', entry };
  if (entry.sourceStatus !== 'connected') return { ok: false, reason: 'unavailable', entry };
  if (!entry.toolEnabled || entry.toolStatus !== 'available') return { ok: false, reason: 'disabled', entry };
  if (!roleAllowed(entry, context.role)) return { ok: false, reason: 'role_denied', entry };
  return { ok: true, entry };
}

function recordProxyAudit({ entry, proxiedName, args, sessionId, role, status, message, result }) {
  db.prepare(`
    INSERT INTO mcp_proxy_audit
      (source_id, proxied_name, original_name, session_id, role, status, message, args_json, result_json, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    entry?.sourceId ?? null,
    proxiedName,
    entry?.originalName ?? null,
    sessionId ?? null,
    role ?? null,
    status,
    message ?? null,
    stringifyJson(isObject(args) ? args : {}),
    result ? stringifyJson(result) : null,
    nowIso(),
  );
}

export function listMcpProxyAudit({ limit = 100 } = {}) {
  initMcpSourceRegistry();
  return db.prepare(`
    SELECT * FROM mcp_proxy_audit
    ORDER BY id DESC
    LIMIT ?
  `).all(normalizePositiveInt(limit, 100, 1, 500));
}

function approvalRequired(entry) {
  return ['ask', 'always'].includes(entry.confirmation) || ['high', 'critical'].includes(entry.risk);
}

function findApprovedCall(entry, context) {
  return db.prepare(`
    SELECT * FROM mcp_tool_approvals
    WHERE source_id = ? AND proxied_name = ? AND status = 'approved'
      AND (session_id IS NULL OR session_id = ?)
    ORDER BY resolved_at DESC
    LIMIT 1
  `).get(entry.sourceId, entry.proxiedName, context.sessionId ?? null);
}

function ensureProxyApproval(entry, proxiedName, args, context) {
  if (!approvalRequired(entry)) return;
  const approved = findApprovedCall(entry, context);
  if (approved) return;
  const existing = db.prepare(`
    SELECT id FROM mcp_tool_approvals
    WHERE source_id = ? AND proxied_name = ? AND status = 'pending'
      AND COALESCE(session_id, '') = COALESCE(?, '')
    ORDER BY requested_at DESC
    LIMIT 1
  `).get(entry.sourceId, proxiedName, context.sessionId ?? null);
  if (!existing) {
    db.prepare(`
      INSERT INTO mcp_tool_approvals
        (id, source_id, proxied_name, original_name, session_id, role, risk, confirmation, args_json, requested_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      `approval_${randomUUID()}`,
      entry.sourceId,
      proxiedName,
      entry.originalName,
      context.sessionId ?? null,
      context.role ?? null,
      entry.risk,
      entry.confirmation,
      stringifyJson(isObject(args) ? args : {}),
      nowIso(),
    );
  }
  recordProxyAudit({ entry, proxiedName, args, ...context, status: 'pending_approval', message: APPROVAL_REQUIRED_MESSAGE });
  throw new Error(APPROVAL_REQUIRED_MESSAGE);
}

export function listPendingMcpToolApprovals({ includeResolved = false } = {}) {
  initMcpSourceRegistry();
  const rows = db.prepare(`
    SELECT * FROM mcp_tool_approvals
    ${includeResolved ? '' : "WHERE status = 'pending'"}
    ORDER BY requested_at DESC
  `).all();
  return rows.map(row => ({
    id: row.id,
    sourceId: row.source_id,
    proxiedName: row.proxied_name,
    originalName: row.original_name,
    sessionId: row.session_id,
    role: row.role,
    risk: row.risk,
    confirmation: row.confirmation,
    args: parseJson(row.args_json, {}),
    status: row.status,
    requestedAt: row.requested_at,
    resolvedAt: row.resolved_at,
    resolvedBy: row.resolved_by,
    reason: row.reason,
  }));
}

export function resolveMcpToolApproval(approvalId, { approved, resolvedBy = 'user', reason = null } = {}) {
  initMcpSourceRegistry();
  const status = approved ? 'approved' : 'rejected';
  const timestamp = nowIso();
  const result = db.prepare(`
    UPDATE mcp_tool_approvals
       SET status = ?, resolved_at = ?, resolved_by = ?, reason = ?
     WHERE id = ? AND status = 'pending'
  `).run(status, timestamp, resolvedBy, reason, approvalId);
  if (!result.changes) throw new Error(`Pending MCP approval "${approvalId}" not found.`);
  return listPendingMcpToolApprovals({ includeResolved: true }).find(item => item.id === approvalId);
}

async function callRemoteTool(entry, args) {
  const headers = authHeaders(entry.sourceAuth);
  const sessionId = await initializeRemoteSession(entry.sourceUrl, entry.callTimeoutMs, headers);
  const response = await postMcpRpc(entry.sourceUrl, {
    jsonrpc: '2.0',
    id: `td-call-${randomUUID()}`,
    method: 'tools/call',
    params: {
      name: entry.originalName,
      arguments: isObject(args) ? args : {},
    },
  }, sessionId, entry.callTimeoutMs, headers);
  return response.data;
}

async function callStdioTool(entry, args) {
  const [, called] = await runStdioMcpSequence(entry.sourceConfig, [
    {
      expectResponse: true,
      body: {
        jsonrpc: '2.0',
        method: 'initialize',
        params: {
          protocolVersion: MCP_PROTOCOL_VERSION,
          capabilities: {},
          clientInfo: { name: 'terminal-docks-starlink-stdio-proxy', version: '0.1.0' },
        },
      },
    },
    { expectResponse: false, body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } },
    {
      expectResponse: true,
      body: {
        jsonrpc: '2.0',
        method: 'tools/call',
        params: { name: entry.originalName, arguments: isObject(args) ? args : {} },
      },
    },
  ], entry.callTimeoutMs);
  return called;
}

export async function callProxyTool(proxiedName, args = {}, context = {}) {
  const resolved = resolveProxyTool(proxiedName, context);
  if (!resolved.ok) {
    const source = resolved.entry?.sourceId ?? 'unknown';
    recordProxyAudit({ entry: resolved.entry, proxiedName, args, ...context, status: 'blocked', message: resolved.reason });
    throw new Error(`MCP source ${source} cannot run ${proxiedName}: ${resolved.reason}.`);
  }
  const { entry } = resolved;
  const mergedArgs = { ...entry.defaultArgs, ...(isObject(args) ? args : {}) };
  ensureProxyApproval(entry, proxiedName, mergedArgs, context);
  recordProxyAudit({ entry, proxiedName, args: mergedArgs, ...context, status: 'started' });
  const response = entry.sourceTransport === 'stdio'
    ? await callStdioTool(entry, mergedArgs)
    : await callRemoteTool(entry, mergedArgs);
  if (response?.error) {
    const message = response.error.message ?? 'upstream error';
    recordProxyAudit({ entry, proxiedName, args: mergedArgs, ...context, status: 'error', message });
    throw new Error(`MCP source ${entry.sourceId} returned upstream error: ${message}`);
  }
  if (!Object.prototype.hasOwnProperty.call(response ?? {}, 'result')) {
    recordProxyAudit({ entry, proxiedName, args: mergedArgs, ...context, status: 'error', message: 'invalid result shape' });
    throw new Error(`MCP source ${entry.sourceId} returned an invalid tool result shape.`);
  }
  recordProxyAudit({ entry, proxiedName, args: mergedArgs, ...context, status: 'completed', result: response.result });
  return response.result;
}

export function listAgentVisibleProxyResources(context = {}) {
  initMcpSourceRegistry();
  const rows = db.prepare(`
    SELECT r.*, s.display_name, s.enabled, s.archived, s.status AS source_status, s.allowed_roles_json
    FROM mcp_source_resources r
    JOIN mcp_sources s ON s.id = r.source_id
    WHERE s.type IN ('remote', 'stdio', 'managed') AND s.archived = 0
    ORDER BY s.id, r.name
  `).all();
  return rows
    .filter(row => row.enabled && row.source_status === 'connected' && row.status === 'available')
    .filter(row => roleAllowed({ allowedRoles: parseJson(row.allowed_roles_json, []) }, context.role))
    .map(row => ({
      uri: row.proxied_uri,
      name: `[${row.display_name}] ${row.name ?? row.original_uri}`,
      description: row.description ?? '',
      mimeType: row.mime_type ?? undefined,
    }));
}

export async function readProxyResource(proxiedUri, context = {}) {
  initMcpSourceRegistry();
  const row = db.prepare(`
    SELECT r.*, s.url, s.transport, s.config_json, s.auth_json, s.call_timeout_ms, s.enabled, s.archived, s.status AS source_status, s.allowed_roles_json
    FROM mcp_source_resources r
    JOIN mcp_sources s ON s.id = r.source_id
    WHERE r.proxied_uri = ?
  `).get(proxiedUri);
  if (!row) return { ok: false, reason: 'not_found' };
  if (!row.enabled || row.archived || row.source_status !== 'connected' || row.status !== 'available') return { ok: false, reason: 'unavailable' };
  if (!roleAllowed({ allowedRoles: parseJson(row.allowed_roles_json, []) }, context.role)) return { ok: false, reason: 'role_denied' };
  const timeoutMs = normalizePositiveInt(row.call_timeout_ms, CALL_TIMEOUT_MS);
  let data;
  if (row.transport === 'stdio') {
    const [, read] = await runStdioMcpSequence(parseJson(row.config_json, null), [
      {
        expectResponse: true,
        body: {
          jsonrpc: '2.0',
          method: 'initialize',
          params: { protocolVersion: MCP_PROTOCOL_VERSION, capabilities: {}, clientInfo: { name: 'terminal-docks-starlink-resource-proxy', version: '0.1.0' } },
        },
      },
      { expectResponse: false, body: { jsonrpc: '2.0', method: 'notifications/initialized', params: {} } },
      { expectResponse: true, body: { jsonrpc: '2.0', method: 'resources/read', params: { uri: row.original_uri } } },
    ], timeoutMs);
    data = read;
  } else {
    const headers = authHeaders(parseJson(row.auth_json, { type: 'none' }));
    const sessionId = await initializeRemoteSession(row.url, timeoutMs, headers);
    const response = await postMcpRpc(row.url, {
      jsonrpc: '2.0',
      id: `td-resource-${randomUUID()}`,
      method: 'resources/read',
      params: { uri: row.original_uri },
    }, sessionId, timeoutMs, headers);
    data = response.data;
  }
  if (data?.error) throw new Error(data.error.message ?? 'upstream resource error');
  return { ok: true, result: data.result };
}

export function jsonRpcResult(id, result) {
  return { jsonrpc: '2.0', id: id ?? null, result };
}

export function jsonRpcError(id, message, code = -32000, data = undefined) {
  return { jsonrpc: '2.0', id: id ?? null, error: { code, message, ...(data ? { data } : {}) } };
}

export async function refreshEnabledSourcesInBackground() {
  const sources = listMcpSources().filter(source => source.type !== 'builtin' && source.enabled && !source.archived);
  for (const source of sources) {
    void refreshMcpSource(source.id).catch(() => {});
    await delay(10);
  }
}

function sendRouteError(res, error, status = 400) {
  res.status(status).json({ ok: false, error: error instanceof Error ? error.message : String(error) });
}

export function registerMcpSourceRoutes(app) {
  app.get('/internal/mcp-sources/catalog', (_req, res) => {
    res.json({ ok: true, catalog: getCuratedMcpSourceCatalog() });
  });

  app.get('/internal/mcp-sources', (req, res) => {
    res.json({ ok: true, sources: listMcpSources({ includeArchived: req.query.includeArchived === '1' || req.query.includeArchived === 'true' }) });
  });

  app.post('/internal/mcp-sources/import-preview', (req, res) => {
    try {
      res.json({ ok: true, ...previewMcpClientConfig(req.body ?? {}) });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post('/internal/mcp-sources/probe', async (req, res) => {
    try {
      res.json({ ok: true, ...(await probeMcpSourcePorts(req.body ?? {})) });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post('/internal/mcp-sources/discover', async (req, res) => {
    try {
      const type = String(req.body?.type || 'remote');
      const capabilities = type === 'stdio'
        ? await discoverStdioCapabilities(normalizeStdioConfig(req.body), { timeoutMs: normalizePositiveInt(req.body?.callTimeoutMs, DISCOVERY_TIMEOUT_MS) })
        : await discoverRemoteCapabilities(req.body?.url, {
          auth: normalizeAuthConfig(req.body?.auth),
          trustAccepted: !!req.body?.trustAccepted,
          timeoutMs: normalizePositiveInt(req.body?.callTimeoutMs, DISCOVERY_TIMEOUT_MS),
        });
      res.json({ ok: true, tools: capabilities.tools, resources: capabilities.resources });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post('/internal/mcp-sources', async (req, res) => {
    try {
      const source = await createMcpSource(req.body ?? {});
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

  app.post('/internal/mcp-sources/:sourceId/restore', (req, res) => {
    try {
      res.json({ ok: true, source: restoreMcpSource(req.params.sourceId) });
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

  app.get('/internal/mcp-tool-approvals', (req, res) => {
    res.json({ ok: true, approvals: listPendingMcpToolApprovals({ includeResolved: req.query.includeResolved === '1' || req.query.includeResolved === 'true' }) });
  });

  app.post('/internal/mcp-tool-approvals/:approvalId/approve', (req, res) => {
    try {
      res.json({ ok: true, approval: resolveMcpToolApproval(req.params.approvalId, { approved: true, resolvedBy: req.body?.resolvedBy ?? 'user', reason: req.body?.reason ?? null }) });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.post('/internal/mcp-tool-approvals/:approvalId/reject', (req, res) => {
    try {
      res.json({ ok: true, approval: resolveMcpToolApproval(req.params.approvalId, { approved: false, resolvedBy: req.body?.resolvedBy ?? 'user', reason: req.body?.reason ?? null }) });
    } catch (error) {
      sendRouteError(res, error);
    }
  });

  app.get('/internal/mcp-proxy-audit', (req, res) => {
    res.json({ ok: true, rows: listMcpProxyAudit({ limit: req.query.limit }) });
  });
}
