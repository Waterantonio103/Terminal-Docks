import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { Activity, AlertTriangle, Archive, Ban, Bot, Plus, RefreshCw, Save, SlidersHorizontal, Wrench, X } from 'lucide-react';
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
  lastDiscoveredAt?: string | null;
  tools: BackendTool[];
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
}

interface SourceView extends Omit<BackendSource, 'tools'> {
  tools: ToolView[];
  toolCount: number;
}

interface McpFeedItem {
  id: string;
  agent: string;
  tool: string;
  result: string;
  timestamp: number;
}

interface AddSourceDraft {
  step: 1 | 2 | 3;
  id: string;
  displayName: string;
  url: string;
  enabled: boolean;
  saveDegraded: boolean;
  discoveredTools: McpToolDescriptor[];
  error: string | null;
  testing: boolean;
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
  id: '',
  displayName: '',
  url: '',
  enabled: false,
  saveDegraded: false,
  discoveredTools: [],
  error: null,
  testing: false,
});

export function McpToolboxPage() {
  const [sources, setSources] = useState<SourceView[]>([]);
  const [selectedSourceId, setSelectedSourceId] = useState('starlink');
  const [selectedToolName, setSelectedToolName] = useState<string | null>(null);
  const [editingTool, setEditingTool] = useState<ToolView | null>(null);
  const [draftConfig, setDraftConfig] = useState<ToolView | null>(null);
  const [addDraft, setAddDraft] = useState<AddSourceDraft | null>(null);
  const [feed, setFeed] = useState<McpFeedItem[]>([]);
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

      const [registry, starlinkTools] = await Promise.all([
        apiFetch<{ sources: BackendSource[] }>('/internal/mcp-sources'),
        listStarlinkTools(),
      ]);
      const starlinkSource = registry.sources.find(source => source.id === 'starlink');
      const externalSources = registry.sources.filter(source => source.id !== 'starlink').map(toSourceView);
      const nextSources = [mergeStarlinkTools(starlinkSource, starlinkTools), ...externalSources];
      setSources(nextSources);
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
      }),
    });
    setEditingTool(null);
    setDraftConfig(null);
    await syncSources();
  }, [draftConfig, editingTool, syncSources]);

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

  const testAddSource = useCallback(async () => {
    if (!addDraft) return;
    setAddDraft(current => current ? { ...current, testing: true, error: null } : current);
    try {
      const result = await apiFetch<{ tools: McpToolDescriptor[] }>('/internal/mcp-sources/discover', {
        method: 'POST',
        body: JSON.stringify({ url: addDraft.url }),
      });
      setAddDraft(current => current ? { ...current, testing: false, step: 3, discoveredTools: result.tools, error: null } : current);
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
        id: addDraft.id,
        displayName: addDraft.displayName || addDraft.id,
        url: addDraft.url,
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
                  <span>{source.status} · {source.type === 'builtin' ? 'Built-in' : 'Remote'}</span>
                </div>
                <em>{source.toolCount}</em>
              </button>
            ))}
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
                <button type="button" onClick={() => void archiveSelectedSource()}>
                  <Archive size={12} />
                  Archive
                </button>
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
              </div>
              {feed.length === 0 ? (
                <div className="td-mcp-call td-mcp-call-empty">
                  <Activity size={13} />
                  <span>Waiting for activity</span>
                  <em>{lastSyncedAt ? `Registry synced ${formatRelativeTime(lastSyncedAt)}` : 'No events yet'}</em>
                </div>
              ) : feed.map((call, index) => (
                <div key={call.id} className="td-mcp-call" style={{ '--td-call-index': index } as CSSProperties}>
                  <strong>{call.agent}</strong>
                  <span>{call.tool}</span>
                  <em>{call.result}</em>
                </div>
              ))}
            </aside>

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
                      <button type="button" className="td-mcp-source-choice active" onClick={() => setAddDraft({ ...addDraft, step: 2 })}>
                        <strong>Remote HTTP/SSE MCP</strong>
                        <span>Connect a localhost or private-network MCP endpoint.</span>
                      </button>
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
                        <label>
                          <span>MCP URL</span>
                          <input value={addDraft.url} placeholder="http://127.0.0.1:3001/mcp" onChange={event => setAddDraft({ ...addDraft, url: event.target.value })} />
                          <em>Public internet URLs are blocked until auth/trust handling lands.</em>
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
                      <button type="button" disabled={!SOURCE_ID_RE.test(addDraft.id) || !addDraft.url || addDraft.testing} onClick={() => void testAddSource()}>
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
