import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity, AlertTriangle, Archive, Ban, Bot, Check, Plus, RefreshCw, RotateCcw, Save, Search, SlidersHorizontal, Wrench, X } from 'lucide-react';
import type { CSSProperties } from 'react';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import agentsConfig from '../../config/agents';
import type { McpMessage } from '../../store/workspace';

type JsonObject = Record<string, unknown>;
type ToolConfirmationMode = 'inherit' | 'off' | 'ask' | 'always';
type ToolRisk = 'inherit' | 'low' | 'medium' | 'high' | 'critical';

interface McpToolDescriptor {
  name: string;
  title?: string;
  description?: string;
  inputSchema?: JsonObject;
  _meta?: JsonObject;
}

interface BackendTool {
  originalName: string;
  proxiedName: string;
  title: string;
  description: string;
  inputSchema?: JsonObject;
  enabled: boolean;
  status: string;
  statusMessage?: string | null;
  confirmation?: ToolConfirmationMode;
  risk?: ToolRisk;
  allowedRoles?: string[];
  defaultArgs?: JsonObject;
}

interface BackendSourceAuth {
  type: 'none' | 'bearer' | 'headers';
  hasBearerToken?: boolean;
  headerNames?: string[];
}

interface BackendSource {
  id: string;
  displayName: string;
  type: 'builtin' | 'remote' | string;
  transport: string;
  url?: string | null;
  enabled: boolean;
  archived: boolean;
  status: string;
  statusMessage?: string | null;
  confirmation: ToolConfirmationMode;
  risk: ToolRisk;
  allowedRoles: string[];
  auth?: BackendSourceAuth;
  config?: JsonObject | null;
  defaultArgs?: JsonObject;
  callTimeoutMs?: number;
  staleAfterMs?: number;
  trustAccepted?: boolean;
  lastDiscoveredAt?: string | null;
  tools: BackendTool[];
  resources?: Array<{ proxiedUri: string; name: string; mimeType?: string | null; status: string }>;
}

interface ToolView {
  sourceId: string;
  sourceName: string;
  sourceType: string;
  name: string;
  agentName: string;
  displayName: string;
  description: string;
  status: 'available' | 'connected' | 'unavailable' | 'disabled' | 'degraded' | 'stale';
  parameters: string[];
  enabled: boolean;
  confirmation: ToolConfirmationMode;
  risk: ToolRisk;
  allowedRoles: string[];
  defaultArgs: JsonObject;
}

interface SourceView extends Omit<BackendSource, 'tools'> {
  tools: ToolView[];
  toolCount: number;
}

interface McpFeedItem {
  id: string;
  agent: string;
  tool: string;
  sourceId: string | null;
  result: string;
  timestamp: number;
}

interface AddSourceDraft {
  step: 1 | 2 | 3;
  type: 'remote' | 'stdio' | 'managed';
  id: string;
  displayName: string;
  url: string;
  probeHost: string;
  probePorts: string;
  command: string;
  argsText: string;
  authType: 'none' | 'bearer' | 'headers';
  bearerToken: string;
  headersText: string;
  trustAccepted: boolean;
  callTimeoutMs: number;
  enabled: boolean;
  saveDegraded: boolean;
  discoveredTools: McpToolDescriptor[];
  discoveredResources: Array<{ name?: string; uri: string; mimeType?: string }>;
  error: string | null;
  testing: boolean;
  probing: boolean;
  probeResults: McpProbeResult[];
}

interface SourceConfigDraft {
  id: string;
  displayName: string;
  enabled: boolean;
  confirmation: ToolConfirmationMode;
  risk: ToolRisk;
  allowedRoles: string[];
  defaultArgsText: string;
  callTimeoutMs: number;
  authType: 'none' | 'bearer' | 'headers';
  bearerToken: string;
  headersText: string;
  trustAccepted: boolean;
}

interface McpApproval {
  id: string;
  sourceId: string;
  proxiedName: string;
  role?: string | null;
  risk?: string | null;
  confirmation?: string | null;
  args?: JsonObject;
  status: string;
  requestedAt: string;
}

interface McpProbeResult {
  url: string;
  status: 'valid_mcp' | 'possible_mcp_sse' | 'rejected' | 'timeout' | 'unreachable' | string;
  detail: string;
  httpStatus?: number;
  contentType?: string;
}

const MCP_PROTOCOL_VERSION = '2025-11-25';
const TOOL_CONFIG_STORAGE_KEY = 'td:mcp-toolbox:tool-config:v1';
const SOURCE_ID_RE = /^[a-z][a-z0-9_]{1,31}$/;
const AGENT_ROLES = agentsConfig.agents.map(agent => ({ id: agent.id, name: agent.name }));
const CONFIRMATION_OPTIONS: Array<{ value: ToolConfirmationMode; label: string }> = [
  { value: 'inherit', label: 'Default' },
  { value: 'off', label: 'Off' },
  { value: 'ask', label: 'Ask' },
  { value: 'always', label: 'Always' },
];
const RISK_OPTIONS: Array<{ value: ToolRisk; label: string }> = [
  { value: 'inherit', label: 'Default' },
  { value: 'low', label: 'Low' },
  { value: 'medium', label: 'Medium' },
  { value: 'high', label: 'High' },
  { value: 'critical', label: 'Critical' },
];

function isJsonObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function parseRpcPayload(text: string): JsonObject {
  const trimmed = text.trim();
  if (!trimmed) return {};
  const lines = trimmed.split(/\r?\n/);
  if (!lines.some(line => line.startsWith('data:'))) return JSON.parse(trimmed) as JsonObject;
  for (const frame of trimmed.split(/\r?\n\r?\n/)) {
    const data = frame
      .split(/\r?\n/)
      .filter(line => line.startsWith('data:'))
      .map(line => line.slice(5).trim())
      .join('\n')
      .trim();
    if (!data || data === '[DONE]') continue;
    const parsed = JSON.parse(data) as unknown;
    if (isJsonObject(parsed)) return parsed;
  }
  return {};
}

async function postMcpRpc(url: string, body: JsonObject, sessionId?: string): Promise<{ data: JsonObject; sessionId?: string }> {
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/event-stream',
      'Content-Type': 'application/json',
      ...(sessionId ? { 'mcp-session-id': sessionId } : {}),
    },
    body: JSON.stringify(body),
  });
  const text = await response.text();
  if (!response.ok) throw new Error(text || `MCP request failed with HTTP ${response.status}`);
  return { data: parseRpcPayload(text), sessionId: response.headers.get('mcp-session-id') ?? sessionId };
}

async function listStarlinkTools(): Promise<McpToolDescriptor[]> {
  const mcpUrl = await invoke<string>('get_mcp_url');
  const initialized = await postMcpRpc(mcpUrl, {
    jsonrpc: '2.0',
    id: 1,
    method: 'initialize',
    params: {
      protocolVersion: MCP_PROTOCOL_VERSION,
      capabilities: {},
      clientInfo: { name: 'terminal-docks-mcp-toolbox', version: '0.1.0' },
    },
  });
  if (!initialized.sessionId) throw new Error('MCP initialize did not return a session id.');
  await postMcpRpc(mcpUrl, { jsonrpc: '2.0', method: 'notifications/initialized', params: {} }, initialized.sessionId);
  const listed = await postMcpRpc(mcpUrl, { jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }, initialized.sessionId);
  const result = listed.data.result;
  if (!isJsonObject(result) || !Array.isArray(result.tools)) return [];
  return result.tools
    .filter((tool): tool is JsonObject => isJsonObject(tool) && typeof tool.name === 'string')
    .filter(tool => !String(tool.name).startsWith('debug_') && !(isJsonObject(tool._meta) && typeof tool._meta.sourceId === 'string'))
    .map(tool => ({
      name: String(tool.name),
      title: typeof tool.title === 'string' ? tool.title : undefined,
      description: typeof tool.description === 'string' ? tool.description : undefined,
      inputSchema: isJsonObject(tool.inputSchema) ? tool.inputSchema : undefined,
      _meta: isJsonObject(tool._meta) ? tool._meta : undefined,
    }));
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const baseUrl = await invoke<string>('get_mcp_base_url');
  const response = await fetch(`${baseUrl}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {}),
    },
  });
  const payload = await response.json() as { ok?: boolean; error?: string } & T;
  if (!response.ok || payload.ok === false) throw new Error(payload.error || `Request failed with HTTP ${response.status}`);
  return payload as T;
}

function getToolParameters(schema?: JsonObject): string[] {
  const properties = isJsonObject(schema?.properties) ? schema.properties : {};
  return Object.keys(properties).slice(0, 5);
}

function stringifyPretty(value: unknown): string {
  return JSON.stringify(isJsonObject(value) ? value : {}, null, 2);
}

function parseJsonObjectText(text: string, label: string): JsonObject {
  if (!text.trim()) return {};
  const parsed = JSON.parse(text) as unknown;
  if (!isJsonObject(parsed)) throw new Error(`${label} must be a JSON object.`);
  return parsed;
}

function formatTimestamp(value?: string | null): string {
  if (!value) return 'not discovered';
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : date.toLocaleString();
}

function splitArgs(text: string): string[] {
  return text
    .split(/\s+/)
    .map(part => part.trim())
    .filter(Boolean);
}

function sourceHealthLabel(source: Pick<BackendSource, 'status' | 'lastDiscoveredAt' | 'archived'>): string {
  if (source.archived) return 'Archived';
  return `${source.status} · Last discovery ${formatTimestamp(source.lastDiscoveredAt)}`;
}

function statusFor(enabled: boolean, sourceStatus: string, toolStatus: string): ToolView['status'] {
  if (!enabled) return 'disabled';
  if (sourceStatus === 'degraded') return 'degraded';
  if (toolStatus === 'stale') return 'stale';
  if (toolStatus === 'available') return 'available';
  return 'unavailable';
}

function mergeStarlinkTools(source: BackendSource | undefined, tools: McpToolDescriptor[]): SourceView {
  const overrides = new Map((source?.tools ?? []).map(tool => [tool.originalName, tool]));
  return {
    id: 'starlink',
    displayName: source?.displayName ?? 'Starlink',
    type: 'builtin',
    transport: 'internal',
    url: null,
    enabled: source?.enabled ?? true,
    archived: false,
    status: source?.status ?? 'connected',
    statusMessage: source?.statusMessage ?? null,
    confirmation: source?.confirmation ?? 'inherit',
    risk: source?.risk ?? 'medium',
    allowedRoles: source?.allowedRoles ?? [],
    defaultArgs: source?.defaultArgs ?? {},
    lastDiscoveredAt: source?.lastDiscoveredAt ?? null,
    tools: tools.map(tool => {
      const override = overrides.get(tool.name);
      const enabled = source?.enabled !== false && override?.enabled !== false;
      return {
        sourceId: 'starlink',
        sourceName: source?.displayName ?? 'Starlink',
        sourceType: 'builtin',
        name: tool.name,
        agentName: tool.name,
        displayName: override?.title || tool.title || tool.name,
        description: tool.description ?? override?.description ?? 'No description provided.',
        status: statusFor(enabled, source?.status ?? 'connected', override?.status ?? 'available'),
        parameters: getToolParameters(tool.inputSchema),
        enabled,
        confirmation: override?.confirmation ?? source?.confirmation ?? 'inherit',
        risk: override?.risk ?? source?.risk ?? 'medium',
        allowedRoles: override?.allowedRoles ?? source?.allowedRoles ?? [],
        defaultArgs: override?.defaultArgs ?? {},
      };
    }),
    toolCount: tools.length,
  };
}

function toSourceView(source: BackendSource): SourceView {
  const tools = source.tools.map(tool => {
    const enabled = source.enabled && tool.enabled;
    return {
      sourceId: source.id,
      sourceName: source.displayName,
      sourceType: source.type,
      name: tool.originalName,
      agentName: tool.proxiedName,
      displayName: tool.title || tool.originalName,
      description: tool.description || tool.statusMessage || 'No description provided.',
      status: statusFor(enabled, source.status, tool.status),
      parameters: getToolParameters(tool.inputSchema),
      enabled,
      confirmation: tool.confirmation ?? source.confirmation,
      risk: tool.risk ?? source.risk,
      allowedRoles: tool.allowedRoles?.length ? tool.allowedRoles : source.allowedRoles,
      defaultArgs: tool.defaultArgs ?? {},
    } satisfies ToolView;
  });
  return { ...source, tools, toolCount: tools.length };
}

function toFeedItem(raw: unknown, fallbackIndex: number): McpFeedItem | null {
  if (!isJsonObject(raw)) return null;
  const type = typeof raw.type === 'string' ? raw.type : 'event';
  if (type.startsWith('debug_') || type.startsWith('debug:')) return null;
  const toolName = typeof raw.proxiedToolName === 'string'
    ? raw.proxiedToolName
    : typeof raw.toolName === 'string'
      ? raw.toolName
      : typeof raw.tool === 'string'
        ? raw.tool
        : null;
  if (toolName?.startsWith('debug_')) return null;

  const timestamp = typeof raw.timestamp === 'number' ? raw.timestamp : typeof raw.at === 'number' ? raw.at : Date.now();
  const agent = String(raw.from ?? raw.agentId ?? raw.role ?? raw.sessionId ?? 'starlink');
  const source = typeof raw.sourceId === 'string' ? `${raw.sourceId}:` : '';
  let result = typeof raw.content === 'string' ? raw.content : String(raw.nodeId ?? raw.missionId ?? 'event received');
  if (type === 'tool:started') result = 'started';
  if (type === 'tool:completed') result = 'completed';
  if (type === 'tool:error') result = String(raw.error ?? 'error');
  if (type === 'agent:heartbeat') result = 'heartbeat';
  if (type === 'agent:ready') result = 'connected';
  if (type === 'task:pushed') result = `task pushed to ${String(raw.nodeId ?? 'node')}`;
  if (type === 'task:completed') result = `task ${String(raw.outcome ?? 'completed')}`;

  return {
    id: `${timestamp}-${fallbackIndex}-${toolName ?? type}`,
    agent,
    tool: `${source}${toolName ?? type}`,
    sourceId: typeof raw.sourceId === 'string' ? raw.sourceId : null,
    result,
    timestamp,
  };
}

function formatRelativeTime(timestamp: number): string {
  const seconds = Math.max(0, Math.round((Date.now() - timestamp) / 1000));
  if (seconds < 10) return 'now';
  if (seconds < 60) return `${seconds}s ago`;
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  return `${Math.round(minutes / 60)}h ago`;
}

function readLegacyConfig(): Record<string, unknown> | null {
  try {
    const raw = window.localStorage.getItem(TOOL_CONFIG_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as unknown;
    return isJsonObject(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const emptyAddDraft = (): AddSourceDraft => ({
  step: 1,
  type: 'remote',
  id: '',
  displayName: '',
  url: '',
  probeHost: '127.0.0.1',
  probePorts: '',
  command: '',
  argsText: '',
  authType: 'none',
  bearerToken: '',
  headersText: '{}',
  trustAccepted: false,
  callTimeoutMs: 30000,
  enabled: false,
  saveDegraded: false,
  discoveredTools: [],
  discoveredResources: [],
  error: null,
  testing: false,
  probing: false,
  probeResults: [],
});

export function McpToolboxPage() {
  const [sources, setSources] = useState<SourceView[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('starlink');
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [editingTool, setEditingTool] = useState<ToolView | null>(null);
  const [draftConfig, setDraftConfig] = useState<ToolView | null>(null);
  const [editingSource, setEditingSource] = useState<SourceView | null>(null);
  const [sourceDraft, setSourceDraft] = useState<SourceConfigDraft | null>(null);
  const [addDraft, setAddDraft] = useState<AddSourceDraft | null>(null);
  const [feed, setFeed] = useState<McpFeedItem[]>([]);
  const [approvals, setApprovals] = useState<McpApproval[]>([]);
  const [eventFilterSourceId, setEventFilterSourceId] = useState<string>('all');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const eventCountRef = useRef(0);

  const appendFeedEvent = useCallback((raw: unknown) => {
    const item = toFeedItem(raw, eventCountRef.current++);
    if (!item) return;
    setFeed(items => [item, ...items.filter(existing => existing.id !== item.id)].slice(0, 24));
  }, []);

  const syncSources = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const legacy = readLegacyConfig();
      if (legacy) {
        await apiFetch('/internal/mcp-sources/migrate-starlink-config', {
          method: 'POST',
          body: JSON.stringify({ configByTool: legacy }),
        }).catch(() => {});
        window.localStorage.removeItem(TOOL_CONFIG_STORAGE_KEY);
      }

      const [registry, starlinkTools, approvalPayload] = await Promise.all([
        apiFetch<{ sources: BackendSource[] }>('/internal/mcp-sources?includeArchived=1'),
        listStarlinkTools(),
        apiFetch<{ approvals: McpApproval[] }>('/internal/mcp-tool-approvals').catch(() => ({ approvals: [] })),
      ]);
      const starlinkSource = registry.sources.find(source => source.id === 'starlink');
      const externalSources = registry.sources.filter(source => source.id !== 'starlink').map(toSourceView);
      const nextSources = [mergeStarlinkTools(starlinkSource, starlinkTools), ...externalSources];
      setSources(nextSources);
      setApprovals(approvalPayload.approvals ?? []);
      setSelectedSourceId(current => nextSources.some(source => source.id === current) ? current : 'starlink');
      setSelectedToolName(current => current ?? nextSources[0]?.tools[0]?.name ?? null);
      setLastSyncedAt(Date.now());
    } catch (syncError) {
      setError(syncError instanceof Error ? syncError.message : String(syncError));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void syncSources();
  }, [syncSources]);

  useEffect(() => {
    let closed = false;
    let eventSource: EventSource | null = null;
    invoke<string>('get_mcp_base_url')
      .then(baseUrl => {
        if (closed) return;
        eventSource = new EventSource(`${baseUrl}/events`);
        eventSource.onmessage = event => {
          try {
            appendFeedEvent(JSON.parse(event.data) as unknown);
          } catch {}
        };
      })
      .catch(() => {});
    return () => {
      closed = true;
      eventSource?.close();
    };
  }, [appendFeedEvent]);

  useEffect(() => {
    const unlisten = listen<McpMessage>('mcp-message', event => appendFeedEvent(event.payload));
    return () => {
      unlisten.then(dispose => dispose()).catch(() => {});
    };
  }, [appendFeedEvent]);

  const selectedSource = sources.find(source => source.id === selectedSourceId) ?? sources[0] ?? null;
  const visibleTools = selectedSource?.tools ?? [];
  const selectedTool = visibleTools.find(tool => tool.name === selectedToolName) ?? visibleTools[0] ?? null;
  const visibleFeed = eventFilterSourceId === 'all'
    ? feed
    : feed.filter(item => item.sourceId === eventFilterSourceId || item.tool.startsWith(`${eventFilterSourceId}:`) || item.tool.startsWith(`${eventFilterSourceId}_`));

  const toolbarText = useMemo(() => {
    if (loading) return 'Syncing MCP sources.';
    if (error) return 'MCP source registry is unavailable.';
    const sourceCount = sources.filter(source => !source.archived).length;
    const toolCount = sources.reduce((sum, source) => sum + source.toolCount, 0);
    return `${sourceCount} sources, ${toolCount} tools discovered.`;
  }, [error, loading, sources]);

  const openToolConfig = useCallback((tool: ToolView) => {
    setSelectedToolName(tool.name);
    setEditingTool(tool);
    setDraftConfig({ ...tool, allowedRoles: [...tool.allowedRoles] });
  }, []);

  const openSourceConfig = useCallback((source: SourceView) => {
    setEditingSource(source);
    setSourceDraft({
      id: source.id,
      displayName: source.displayName,
      enabled: source.enabled,
      confirmation: source.confirmation,
      risk: source.risk,
      allowedRoles: [...source.allowedRoles],
      defaultArgsText: stringifyPretty(source.defaultArgs),
      callTimeoutMs: source.callTimeoutMs ?? 30000,
      authType: source.auth?.type ?? 'none',
      bearerToken: '',
      headersText: '{}',
      trustAccepted: !!source.trustAccepted,
    });
  }, []);

  const saveToolConfig = useCallback(async () => {
    if (!editingTool || !draftConfig) return;
    await apiFetch(`/internal/mcp-sources/${encodeURIComponent(editingTool.sourceId)}/tools/${encodeURIComponent(editingTool.name)}`, {
      method: 'PATCH',
      body: JSON.stringify({
        title: draftConfig.displayName,
        enabled: draftConfig.enabled,
        confirmation: draftConfig.confirmation,
        risk: draftConfig.risk,
        allowedRoles: draftConfig.allowedRoles,
        defaultArgs: draftConfig.defaultArgs,
      }),
    });
    setEditingTool(null);
    setDraftConfig(null);
    await syncSources();
  }, [draftConfig, editingTool, syncSources]);

  const saveSourceConfig = useCallback(async () => {
    if (!editingSource || !sourceDraft) return;
    setError(null);
    try {
      const auth = sourceDraft.authType === 'bearer'
        ? { type: 'bearer', bearerToken: sourceDraft.bearerToken }
        : sourceDraft.authType === 'headers'
          ? { type: 'headers', headers: parseJsonObjectText(sourceDraft.headersText, 'Headers') }
          : { type: 'none' };
      await apiFetch(`/internal/mcp-sources/${encodeURIComponent(editingSource.id)}`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: sourceDraft.displayName,
          enabled: sourceDraft.enabled,
          confirmation: sourceDraft.confirmation,
          risk: sourceDraft.risk,
          allowedRoles: sourceDraft.allowedRoles,
          defaultArgs: parseJsonObjectText(sourceDraft.defaultArgsText, 'Default arguments'),
          callTimeoutMs: sourceDraft.callTimeoutMs,
          trustAccepted: sourceDraft.trustAccepted,
          ...(sourceDraft.authType === 'bearer' && !sourceDraft.bearerToken ? {} : { auth }),
        }),
      });
      setEditingSource(null);
      setSourceDraft(null);
      await syncSources();
    } catch (sourceError) {
      setError(sourceError instanceof Error ? sourceError.message : String(sourceError));
    }
  }, [editingSource, sourceDraft, syncSources]);

  const refreshSelectedSource = useCallback(async () => {
    if (!selectedSource || selectedSource.id === 'starlink') {
      await syncSources();
      return;
    }
    await apiFetch(`/internal/mcp-sources/${encodeURIComponent(selectedSource.id)}/refresh`, { method: 'POST', body: '{}' });
    await syncSources();
  }, [selectedSource, syncSources]);

  const archiveSelectedSource = useCallback(async () => {
    if (!selectedSource || selectedSource.id === 'starlink') return;
    await apiFetch(`/internal/mcp-sources/${encodeURIComponent(selectedSource.id)}`, { method: 'DELETE' });
    setSelectedSourceId('starlink');
    await syncSources();
  }, [selectedSource, syncSources]);

  const restoreSelectedSource = useCallback(async () => {
    if (!selectedSource || selectedSource.id === 'starlink') return;
    await apiFetch(`/internal/mcp-sources/${encodeURIComponent(selectedSource.id)}/restore`, { method: 'POST', body: '{}' });
    await syncSources();
  }, [selectedSource, syncSources]);

  const resolveApproval = useCallback(async (approvalId: string, approved: boolean) => {
    await apiFetch(`/internal/mcp-tool-approvals/${encodeURIComponent(approvalId)}/${approved ? 'approve' : 'reject'}`, {
      method: 'POST',
      body: JSON.stringify({ resolvedBy: 'toolbox' }),
    });
    await syncSources();
  }, [syncSources]);

  const probeAddSourcePort = useCallback(async () => {
    if (!addDraft || addDraft.type !== 'remote') return;
    setAddDraft(current => current ? { ...current, probing: true, error: null, probeResults: [] } : current);
    try {
      const payload = await apiFetch<{ results: McpProbeResult[] }>('/internal/mcp-sources/probe', {
        method: 'POST',
        body: JSON.stringify({
          host: addDraft.probeHost,
          ports: addDraft.probePorts,
          timeoutMs: 1200,
        }),
      });
      const results = payload.results ?? [];
      const preferred = results.find(result => result.status === 'valid_mcp') ?? results.find(result => result.status === 'possible_mcp_sse');
      setAddDraft(current => current ? {
        ...current,
        probing: false,
        probeResults: results,
        url: preferred?.url ?? current.url,
      } : current);
    } catch (probeError) {
      setAddDraft(current => current ? {
        ...current,
        probing: false,
        probeResults: [],
        error: probeError instanceof Error ? probeError.message : String(probeError),
      } : current);
    }
  }, [addDraft]);

  const testAddSource = useCallback(async () => {
    if (!addDraft) return;
    setAddDraft(current => current ? { ...current, testing: true, error: null } : current);
    try {
      const result = await apiFetch<{ tools: McpToolDescriptor[]; resources?: AddSourceDraft['discoveredResources'] }>('/internal/mcp-sources/discover', {
        method: 'POST',
        body: JSON.stringify({
          type: addDraft.type,
          url: addDraft.url,
          command: addDraft.command,
          args: splitArgs(addDraft.argsText),
          callTimeoutMs: addDraft.callTimeoutMs,
          trustAccepted: addDraft.trustAccepted,
          auth: addDraft.authType === 'bearer'
            ? { type: 'bearer', bearerToken: addDraft.bearerToken }
            : addDraft.authType === 'headers'
              ? { type: 'headers', headers: parseJsonObjectText(addDraft.headersText, 'Headers') }
              : { type: 'none' },
        }),
      });
      setAddDraft(current => current ? { ...current, testing: false, step: 3, discoveredTools: result.tools, discoveredResources: result.resources ?? [], error: null } : current);
    } catch (testError) {
      setAddDraft(current => current ? {
        ...current,
        testing: false,
        step: 3,
        discoveredTools: [],
        error: testError instanceof Error ? testError.message : String(testError),
      } : current);
    }
  }, [addDraft]);

  const createAddSource = useCallback(async () => {
    if (!addDraft) return;
    const degraded = addDraft.discoveredTools.length === 0;
    await apiFetch('/internal/mcp-sources', {
      method: 'POST',
      body: JSON.stringify({
        type: addDraft.type,
        id: addDraft.id,
        displayName: addDraft.displayName || addDraft.id,
        url: addDraft.url,
        command: addDraft.command,
        args: splitArgs(addDraft.argsText),
        callTimeoutMs: addDraft.callTimeoutMs,
        trustAccepted: addDraft.trustAccepted,
        auth: addDraft.authType === 'bearer'
          ? { type: 'bearer', bearerToken: addDraft.bearerToken }
          : addDraft.authType === 'headers'
            ? { type: 'headers', headers: parseJsonObjectText(addDraft.headersText, 'Headers') }
            : { type: 'none' },
        enabled: addDraft.enabled && !degraded,
        saveDegraded: degraded ? addDraft.saveDegraded : true,
      }),
    });
    setSelectedSourceId(addDraft.id);
    setAddDraft(null);
    await syncSources();
  }, [addDraft, syncSources]);

  return (
    <div className="td-mcp-page">
      <div className="td-mcp-view">
        <aside className="td-mcp-sidebar">
          <div className="td-mcp-sidebar-header">
            <Wrench size={14} />
            <span>MCP Sources</span>
          </div>
          <button type="button" className="td-mcp-add-source" onClick={() => setAddDraft(emptyAddDraft())}>
            <Plus size={13} />
            Add MCP Source
          </button>
          <div className="td-mcp-server-list">
            {sources.map(source => (
              <button
                key={source.id}
                type="button"
                className={`td-mcp-server ${selectedSource?.id === source.id ? 'active' : ''} ${source.enabled ? '' : 'disabled'}`}
                onClick={() => {
                  setSelectedSourceId(source.id);
                  setSelectedToolName(source.tools[0]?.name ?? null);
                }}
              >
                <div>
                  <strong>{source.displayName}</strong>
                  <span>{sourceHealthLabel(source)} · {source.type === 'builtin' ? 'Built-in' : source.transport}</span>
                </div>
                <em>{source.toolCount}</em>
              </button>
            ))}
            {!loading && sources.filter(source => source.id !== 'starlink').length === 0 && (
              <div className="td-mcp-empty">No external sources configured.</div>
            )}
          </div>
        </aside>

        <main className="td-mcp-main">
          <header className="td-mcp-toolbar">
            <div>
              <span>Tool Registry</span>
              <strong>{toolbarText}</strong>
            </div>
            <div className="td-mcp-toolbar-actions">
              {selectedSource && selectedSource.id !== 'starlink' && (
                <>
                  <button type="button" onClick={() => openSourceConfig(selectedSource)}>
                    <SlidersHorizontal size={12} />
                    Source
                  </button>
                  {selectedSource.archived ? (
                    <button type="button" onClick={() => void restoreSelectedSource()}>
                      <RotateCcw size={12} />
                      Restore
                    </button>
                  ) : (
                    <button type="button" onClick={() => void archiveSelectedSource()}>
                      <Archive size={12} />
                      Archive
                    </button>
                  )}
                </>
              )}
              <button type="button" onClick={() => void refreshSelectedSource()} disabled={loading}>
                <RefreshCw size={12} className={loading ? 'td-mcp-spin' : ''} />
                Sync
              </button>
            </div>
          </header>

          {error && (
            <div className="td-mcp-error">
              <AlertTriangle size={14} />
              <span>{error}</span>
            </div>
          )}

          {selectedSource?.statusMessage && (
            <div className="td-mcp-error">
              <AlertTriangle size={14} />
              <span>{selectedSource.statusMessage}</span>
            </div>
          )}

          <div className="td-mcp-content">
            <section className="td-mcp-registry">
              <div className="td-mcp-table-head">
                <span>Tool</span>
                <span>Agent name</span>
                <span>Status</span>
                <span>Inputs</span>
                <span></span>
              </div>
              {visibleTools.map(tool => (
                <div
                  key={`${tool.sourceId}:${tool.name}`}
                  className={`td-mcp-tool-row ${selectedTool?.name === tool.name ? 'active' : ''} ${tool.enabled ? '' : 'disabled'}`}
                  onClick={() => setSelectedToolName(tool.name)}
                >
                  <div className="td-mcp-tool-name">
                    <span className="td-mcp-tool-icon">
                      <Wrench size={13} />
                      {!tool.enabled && <Ban size={15} />}
                    </span>
                    <div>
                      <strong>{tool.displayName}</strong>
                      <span>{tool.description}</span>
                    </div>
                  </div>
                  <span>{tool.agentName}</span>
                  <em className={`td-mcp-status td-mcp-status-${tool.status}`}>{tool.status}</em>
                  <span>{tool.parameters.length ? tool.parameters.join(', ') : 'none'}</span>
                  <button
                    type="button"
                    className="td-mcp-config-trigger"
                    aria-label={`Configure ${tool.displayName}`}
                    onClick={event => {
                      event.stopPropagation();
                      openToolConfig(tool);
                    }}
                  >
                    <SlidersHorizontal size={13} />
                  </button>
                </div>
              ))}
              {!loading && visibleTools.length === 0 && (
                <div className="td-mcp-empty">No tools available for this source.</div>
              )}
            </section>

            <aside className="td-mcp-call-feed">
              <div className="td-mcp-call-feed-header">
                <Bot size={14} />
                <span>Live MCP Events</span>
                <select value={eventFilterSourceId} onChange={event => setEventFilterSourceId(event.target.value)} aria-label="Filter MCP events by source">
                  <option value="all">All</option>
                  {sources.map(source => <option key={source.id} value={source.id}>{source.displayName}</option>)}
                </select>
              </div>
              {approvals.map(approval => (
                <div key={approval.id} className="td-mcp-call">
                  <strong>{approval.role || 'agent'}</strong>
                  <span>{approval.proxiedName}</span>
                  <em>{approval.risk || approval.confirmation || 'approval'}</em>
                  <button type="button" aria-label={`Approve ${approval.proxiedName}`} onClick={() => void resolveApproval(approval.id, true)}>
                    <Check size={12} />
                  </button>
                  <button type="button" aria-label={`Reject ${approval.proxiedName}`} onClick={() => void resolveApproval(approval.id, false)}>
                    <X size={12} />
                  </button>
                </div>
              ))}
              {visibleFeed.length === 0 ? (
                <div className="td-mcp-call td-mcp-call-empty">
                  <Activity size={13} />
                  <span>Waiting for activity</span>
                  <em>{lastSyncedAt ? `Registry synced ${formatRelativeTime(lastSyncedAt)}` : 'No events yet'}</em>
                </div>
              ) : visibleFeed.map((call, index) => (
                <div key={call.id} className="td-mcp-call" style={{ '--td-call-index': index } as CSSProperties}>
                  <strong>{call.agent}</strong>
                  <span>{call.tool}</span>
                  <em>{call.result}</em>
                </div>
              ))}
            </aside>

            {editingSource && sourceDraft && (
              <div className="td-mcp-config-sheet" role="dialog" aria-modal="true" aria-label={`Configure ${editingSource.displayName}`}>
                <div className="td-mcp-config-panel">
                  <header>
                    <div>
                      <span>Configure Source</span>
                      <strong>{editingSource.displayName}</strong>
                    </div>
                    <button type="button" aria-label="Close source configuration" onClick={() => { setEditingSource(null); setSourceDraft(null); }}>
                      <X size={14} />
                    </button>
                  </header>
                  <div className="td-mcp-config-body">
                    <label>
                      <span>Display name</span>
                      <input value={sourceDraft.displayName} onChange={event => setSourceDraft({ ...sourceDraft, displayName: event.target.value })} />
                    </label>
                    <div className="td-mcp-config-grid">
                      <label>
                        <span>Confirmation</span>
                        <select value={sourceDraft.confirmation} onChange={event => setSourceDraft({ ...sourceDraft, confirmation: event.target.value as ToolConfirmationMode })}>
                          {CONFIRMATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Risk</span>
                        <select value={sourceDraft.risk} onChange={event => setSourceDraft({ ...sourceDraft, risk: event.target.value as ToolRisk })}>
                          {RISK_OPTIONS.filter(option => option.value !== 'inherit').map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    </div>
                    <label>
                      <span>Default arguments</span>
                      <textarea value={sourceDraft.defaultArgsText} onChange={event => setSourceDraft({ ...sourceDraft, defaultArgsText: event.target.value })} />
                      <em>JSON object merged before tool call arguments.</em>
                    </label>
                    <label>
                      <span>Call timeout ms</span>
                      <input value={sourceDraft.callTimeoutMs} onChange={event => setSourceDraft({ ...sourceDraft, callTimeoutMs: Number(event.target.value) || 30000 })} />
                    </label>
                    <div className="td-mcp-config-grid">
                      <label>
                        <span>Auth</span>
                        <select value={sourceDraft.authType} onChange={event => setSourceDraft({ ...sourceDraft, authType: event.target.value as SourceConfigDraft['authType'] })}>
                          <option value="none">None</option>
                          <option value="bearer">Bearer token</option>
                          <option value="headers">Custom headers</option>
                        </select>
                      </label>
                      <label className="td-mcp-inline-check">
                        <input type="checkbox" checked={sourceDraft.trustAccepted} onChange={event => setSourceDraft({ ...sourceDraft, trustAccepted: event.target.checked })} />
                        <span>Trust public URL</span>
                      </label>
                    </div>
                    {sourceDraft.authType === 'bearer' && (
                      <label>
                        <span>Bearer token</span>
                        <input value={sourceDraft.bearerToken} placeholder={editingSource.auth?.hasBearerToken ? 'Stored token unchanged' : ''} onChange={event => setSourceDraft({ ...sourceDraft, bearerToken: event.target.value })} />
                      </label>
                    )}
                    {sourceDraft.authType === 'headers' && (
                      <label>
                        <span>Headers JSON</span>
                        <textarea value={sourceDraft.headersText} onChange={event => setSourceDraft({ ...sourceDraft, headersText: event.target.value })} />
                      </label>
                    )}
                    <div className="td-mcp-role-picker">
                      <span>Allowed roles</span>
                      <div>
                        {AGENT_ROLES.map(role => {
                          const checked = sourceDraft.allowedRoles.includes(role.id);
                          return (
                            <label key={role.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={event => {
                                  const allowedRoles = event.target.checked
                                    ? [...sourceDraft.allowedRoles, role.id]
                                    : sourceDraft.allowedRoles.filter(id => id !== role.id);
                                  setSourceDraft({ ...sourceDraft, allowedRoles });
                                }}
                              />
                              <span>{role.name}</span>
                            </label>
                          );
                        })}
                      </div>
                      <em>{sourceDraft.allowedRoles.length === 0 ? 'All roles allowed' : `${sourceDraft.allowedRoles.length} role filter${sourceDraft.allowedRoles.length === 1 ? '' : 's'}`}</em>
                    </div>
                    <button
                      type="button"
                      className={sourceDraft.enabled ? 'td-mcp-disable-button' : 'td-mcp-enable-button'}
                      onClick={() => setSourceDraft({ ...sourceDraft, enabled: !sourceDraft.enabled })}
                    >
                      {sourceDraft.enabled ? 'Disable Source' : 'Enable Source'}
                    </button>
                  </div>
                  <footer>
                    <button type="button" onClick={() => { setEditingSource(null); setSourceDraft(null); }}>Cancel</button>
                    <button type="button" onClick={() => void saveSourceConfig()}>
                      <Save size={13} />
                      Save
                    </button>
                  </footer>
                </div>
              </div>
            )}

            {editingTool && draftConfig && (
              <div className="td-mcp-config-sheet" role="dialog" aria-modal="true" aria-label={`Configure ${editingTool.displayName}`}>
                <div className="td-mcp-config-panel">
                  <header>
                    <div>
                      <span>Configure Tool</span>
                      <strong>{editingTool.displayName}</strong>
                    </div>
                    <button type="button" aria-label="Close configuration" onClick={() => { setEditingTool(null); setDraftConfig(null); }}>
                      <X size={14} />
                    </button>
                  </header>
                  <div className="td-mcp-config-body">
                    <label>
                      <span>Display name</span>
                      <input value={draftConfig.displayName} onChange={event => setDraftConfig({ ...draftConfig, displayName: event.target.value })} />
                    </label>
                    <div className="td-mcp-config-grid">
                      <label>
                        <span>Confirmation</span>
                        <select value={draftConfig.confirmation} onChange={event => setDraftConfig({ ...draftConfig, confirmation: event.target.value as ToolConfirmationMode })}>
                          {CONFIRMATION_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                      <label>
                        <span>Risk</span>
                        <select value={draftConfig.risk} onChange={event => setDraftConfig({ ...draftConfig, risk: event.target.value as ToolRisk })}>
                          {RISK_OPTIONS.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
                        </select>
                      </label>
                    </div>
                    <div className="td-mcp-role-picker">
                      <span>Allowed roles</span>
                      <div>
                        {AGENT_ROLES.map(role => {
                          const checked = draftConfig.allowedRoles.includes(role.id);
                          return (
                            <label key={role.id}>
                              <input
                                type="checkbox"
                                checked={checked}
                                onChange={event => {
                                  const allowedRoles = event.target.checked
                                    ? [...draftConfig.allowedRoles, role.id]
                                    : draftConfig.allowedRoles.filter(id => id !== role.id);
                                  setDraftConfig({ ...draftConfig, allowedRoles });
                                }}
                              />
                              <span>{role.name}</span>
                            </label>
                          );
                        })}
                      </div>
                      <em>{draftConfig.allowedRoles.length === 0 ? 'All roles allowed' : `${draftConfig.allowedRoles.length} role filter${draftConfig.allowedRoles.length === 1 ? '' : 's'}`}</em>
                    </div>
                    <label>
                      <span>Default arguments</span>
                      <textarea
                        value={stringifyPretty(draftConfig.defaultArgs)}
                        onChange={event => {
                          try {
                            setDraftConfig({ ...draftConfig, defaultArgs: parseJsonObjectText(event.target.value, 'Default arguments') });
                          } catch {
                            setDraftConfig({ ...draftConfig, defaultArgs: {} });
                          }
                        }}
                      />
                    </label>
                    <button
                      type="button"
                      className={draftConfig.enabled ? 'td-mcp-disable-button' : 'td-mcp-enable-button'}
                      onClick={() => setDraftConfig({ ...draftConfig, enabled: !draftConfig.enabled })}
                    >
                      {draftConfig.enabled ? 'Disable Tool' : 'Enable Tool'}
                    </button>
                  </div>
                  <footer>
                    <button type="button" onClick={() => { setEditingTool(null); setDraftConfig(null); }}>Cancel</button>
                    <button type="button" onClick={() => void saveToolConfig()}>
                      <Save size={13} />
                      Save
                    </button>
                  </footer>
                </div>
              </div>
            )}

            {addDraft && (
              <div className="td-mcp-config-sheet" role="dialog" aria-modal="true" aria-label="Add MCP Source">
                <div className="td-mcp-config-panel td-mcp-add-panel">
                  <header>
                    <div>
                      <span>Add MCP Source</span>
                      <strong>{addDraft.step === 1 ? 'Choose source type' : addDraft.step === 2 ? 'Remote HTTP/SSE source' : 'Review discovery'}</strong>
                    </div>
                    <button type="button" aria-label="Close add source" onClick={() => setAddDraft(null)}>
                      <X size={14} />
                    </button>
                  </header>
                  <div className="td-mcp-config-body">
                    {addDraft.step === 1 && (
                      <>
                        {[
                          ['remote', 'Remote HTTP/SSE MCP', 'Connect a local, private-network, or trusted authenticated HTTP MCP endpoint.'],
                          ['stdio', 'Stdio MCP command', 'Launch and supervise a local MCP server process over stdio.'],
                          ['managed', 'Managed local MCP', 'Use the managed Node stdio integration when a known local command is selected.'],
                        ].map(([type, title, description]) => (
                          <button
                            key={type}
                            type="button"
                            className={`td-mcp-source-choice ${addDraft.type === type ? 'active' : ''}`}
                            onClick={() => setAddDraft({ ...addDraft, type: type as AddSourceDraft['type'], step: 2 })}
                          >
                            <strong>{title}</strong>
                            <span>{description}</span>
                          </button>
                        ))}
                      </>
                    )}
                    {addDraft.step === 2 && (
                      <>
                        <label>
                          <span>Source ID</span>
                          <input value={addDraft.id} placeholder="excalidraw" onChange={event => setAddDraft({ ...addDraft, id: event.target.value.toLowerCase().replace(/[^a-z0-9_]/g, '_') })} />
                          <em>{SOURCE_ID_RE.test(addDraft.id) ? 'Used as the agent tool prefix.' : 'Use lowercase snake format, 2-32 chars.'}</em>
                        </label>
                        <label>
                          <span>Display name</span>
                          <input value={addDraft.displayName} placeholder="Excalidraw" onChange={event => setAddDraft({ ...addDraft, displayName: event.target.value })} />
                        </label>
                        {addDraft.type === 'remote' ? (
                          <>
                            <label>
                              <span>MCP URL</span>
                              <input value={addDraft.url} placeholder="http://127.0.0.1:3001/mcp" onChange={event => setAddDraft({ ...addDraft, url: event.target.value })} />
                            </label>
                            <div className="td-mcp-prober">
                              <div className="td-mcp-config-grid">
                                <label>
                                  <span>Probe host</span>
                                  <input value={addDraft.probeHost} placeholder="127.0.0.1" onChange={event => setAddDraft({ ...addDraft, probeHost: event.target.value })} />
                                </label>
                                <label>
                                  <span>Probe port</span>
                                  <input value={addDraft.probePorts} placeholder="9876" onChange={event => setAddDraft({ ...addDraft, probePorts: event.target.value })} />
                                </label>
                              </div>
                              <button type="button" disabled={!addDraft.probePorts.trim() || addDraft.probing} onClick={() => void probeAddSourcePort()}>
                                <Search size={13} className={addDraft.probing ? 'td-mcp-spin' : ''} />
                                Probe Port
                              </button>
                              {addDraft.probeResults.length > 0 && (
                                <div className="td-mcp-probe-results">
                                  {addDraft.probeResults.map(result => (
                                    <button
                                      key={result.url}
                                      type="button"
                                      className={`td-mcp-probe-result ${result.status === 'valid_mcp' ? 'valid' : result.status === 'possible_mcp_sse' ? 'possible' : ''}`}
                                      onClick={() => setAddDraft({ ...addDraft, url: result.url })}
                                    >
                                      <strong>{result.status.replace(/_/g, ' ')}</strong>
                                      <span>{result.url}</span>
                                      <em>{result.detail}</em>
                                    </button>
                                  ))}
                                </div>
                              )}
                            </div>
                            <div className="td-mcp-config-grid">
                              <label>
                                <span>Auth</span>
                                <select value={addDraft.authType} onChange={event => setAddDraft({ ...addDraft, authType: event.target.value as AddSourceDraft['authType'] })}>
                                  <option value="none">None</option>
                                  <option value="bearer">Bearer token</option>
                                  <option value="headers">Custom headers</option>
                                </select>
                              </label>
                              <label className="td-mcp-inline-check">
                                <input type="checkbox" checked={addDraft.trustAccepted} onChange={event => setAddDraft({ ...addDraft, trustAccepted: event.target.checked })} />
                                <span>Trust public URL</span>
                              </label>
                            </div>
                            {addDraft.authType === 'bearer' && (
                              <label>
                                <span>Bearer token</span>
                                <input value={addDraft.bearerToken} onChange={event => setAddDraft({ ...addDraft, bearerToken: event.target.value })} />
                              </label>
                            )}
                            {addDraft.authType === 'headers' && (
                              <label>
                                <span>Headers JSON</span>
                                <textarea value={addDraft.headersText} onChange={event => setAddDraft({ ...addDraft, headersText: event.target.value })} />
                              </label>
                            )}
                          </>
                        ) : (
                          <>
                            <label>
                              <span>Command</span>
                              <input value={addDraft.command} placeholder="node" onChange={event => setAddDraft({ ...addDraft, command: event.target.value })} />
                            </label>
                            <label>
                              <span>Arguments</span>
                              <input value={addDraft.argsText} placeholder="./server.mjs --stdio" onChange={event => setAddDraft({ ...addDraft, argsText: event.target.value })} />
                            </label>
                          </>
                        )}
                        <label>
                          <span>Call timeout ms</span>
                          <input value={addDraft.callTimeoutMs} onChange={event => setAddDraft({ ...addDraft, callTimeoutMs: Number(event.target.value) || 30000 })} />
                        </label>
                      </>
                    )}
                    {addDraft.step === 3 && (
                      <>
                        {addDraft.error ? (
                          <div className="td-mcp-error">
                            <AlertTriangle size={14} />
                            <span>{addDraft.error}</span>
                          </div>
                        ) : (
                          <div className="td-mcp-discovery-summary">
                            <strong>{addDraft.discoveredTools.length} tools discovered</strong>
                            <span>{addDraft.discoveredTools.slice(0, 6).map(tool => tool.name).join(', ') || 'No tools returned.'}</span>
                            <span>{addDraft.discoveredResources.length} resources discovered</span>
                          </div>
                        )}
                        <label className="td-mcp-inline-check">
                          <input
                            type="checkbox"
                            checked={addDraft.error ? addDraft.saveDegraded : addDraft.enabled}
                            onChange={event => setAddDraft(addDraft.error ? { ...addDraft, saveDegraded: event.target.checked } : { ...addDraft, enabled: event.target.checked })}
                          />
                          <span>{addDraft.error ? 'Save disabled/degraded for later repair' : 'Enable this source now'}</span>
                        </label>
                      </>
                    )}
                  </div>
                  <footer>
                    <button type="button" onClick={() => addDraft.step === 1 ? setAddDraft(null) : setAddDraft({ ...addDraft, step: (addDraft.step - 1) as AddSourceDraft['step'] })}>
                      {addDraft.step === 1 ? 'Cancel' : 'Back'}
                    </button>
                    {addDraft.step === 2 ? (
                      <button type="button" disabled={!SOURCE_ID_RE.test(addDraft.id) || (addDraft.type === 'remote' ? !addDraft.url : !addDraft.command) || addDraft.testing} onClick={() => void testAddSource()}>
                        <RefreshCw size={13} className={addDraft.testing ? 'td-mcp-spin' : ''} />
                        Test Discovery
                      </button>
                    ) : addDraft.step === 3 ? (
                      <button type="button" disabled={!!addDraft.error && !addDraft.saveDegraded} onClick={() => void createAddSource()}>
                        <Save size={13} />
                        Save Source
                      </button>
                    ) : (
                      <button type="button" onClick={() => setAddDraft({ ...addDraft, step: 2 })}>Next</button>
                    )}
                  </footer>
                </div>
              </div>
            )}
          </div>
        </main>
      </div>
    </div>
  );
}
