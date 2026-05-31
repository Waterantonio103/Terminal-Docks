import {
  detectLocalServerUrls,
  isLoopbackLocalHostname,
  isLocalServerUrl,
  isPrivateIpv4Hostname,
  normalizeLocalServerHostname,
  normalizeLocalServerUrl,
} from './localServerDetection.js';
import { normalizeTerminalId } from './terminalIds.js';

export interface WorkspaceServerPane {
  type: string;
  title?: string;
  data?: {
    terminalId?: unknown;
    url?: unknown;
  } | null;
}

export interface DetectedWorkspaceServer {
  url: string;
  label: string;
}

const SENSITIVE_SERVER_QUERY_KEY = /(?:^|[_-])(?:api[_-]?key|access[_-]?token|auth|authorization|code|jwt|key|password|refresh[_-]?token|secret|session|sig|signature|token)(?:$|[_-])|(?:apiKey|accessToken|refreshToken|idToken|sessionId|clientSecret)/i;
const DEFAULT_MAX_WORKSPACE_SERVERS = 8;
const HARD_MAX_WORKSPACE_SERVERS = 24;

function redactSensitiveServerParams(params: URLSearchParams): void {
  for (const key of Array.from(params.keys())) {
    if (SENSITIVE_SERVER_QUERY_KEY.test(key)) {
      params.set(key, 'redacted');
    }
  }
}

function redactSensitiveServerHash(hash: string): string {
  if (!hash) return '';
  const rawHash = hash.slice(1);
  const queryIndex = rawHash.indexOf('?');
  const prefix = queryIndex === -1 ? '' : rawHash.slice(0, queryIndex + 1);
  const paramText = queryIndex === -1 ? rawHash : rawHash.slice(queryIndex + 1);
  if (!paramText.includes('=')) return hash;

  const params = new URLSearchParams(paramText);
  const original = params.toString();
  redactSensitiveServerParams(params);
  const redacted = params.toString();
  return redacted === original ? hash : `#${prefix}${redacted}`;
}

function redactSensitiveServerUrlLabel(url: string): string {
  const normalized = normalizeLocalServerUrl(url);
  try {
    const parsed = new URL(normalized);
    redactSensitiveServerParams(parsed.searchParams);
    return `${parsed.host}${parsed.pathname.replace(/\/+$/, '')}${parsed.search}${redactSensitiveServerHash(parsed.hash)}`;
  } catch {
    return normalized.replace(/^https?:\/\//i, '');
  }
}

function comparableServerUrlParts(url: string): {
  protocol: string;
  hostname: string;
  port: string;
  pathname: string;
  search: string;
  hash: string;
} | null {
  try {
    const parsed = new URL(normalizeLocalServerUrl(url));
    redactSensitiveServerParams(parsed.searchParams);
    return {
      protocol: parsed.protocol,
      hostname: normalizeLocalServerHostname(parsed.hostname),
      port: parsed.port || (parsed.protocol === 'https:' ? '443' : '80'),
      pathname: parsed.pathname,
      search: parsed.search,
      hash: redactSensitiveServerHash(parsed.hash),
    };
  } catch {
    return null;
  }
}

export function shortWorkspaceServerUrl(url: string): string {
  return redactSensitiveServerUrlLabel(url);
}

function serverLabelUrlMatches(url: string, serverUrl: string): boolean {
  const normalizedUrl = normalizeLocalServerUrl(url);
  const normalizedServerUrl = normalizeLocalServerUrl(serverUrl);
  if (normalizedUrl === normalizedServerUrl) return true;
  try {
    const parsedUrl = new URL(normalizedUrl);
    const parsedServerUrl = new URL(normalizedServerUrl);
    return parsedUrl.protocol === parsedServerUrl.protocol
      && parsedUrl.host === parsedServerUrl.host
      && parsedUrl.pathname.replace(/\/+$/, '') === parsedServerUrl.pathname.replace(/\/+$/, '');
  } catch {
    return false;
  }
}

export function formatWorkspaceServerLabel(server: DetectedWorkspaceServer): string {
  const shortUrl = shortWorkspaceServerUrl(server.url);
  const sourceLabel = cleanServerLabel(server.label);
  if (sourceLabel && isLocalServerUrl(sourceLabel) && serverLabelUrlMatches(sourceLabel, server.url)) {
    return shortUrl;
  }
  if (detectLocalServerUrls(sourceLabel).some(url => serverLabelUrlMatches(url, server.url))) {
    return shortUrl;
  }
  const lowerSourceLabel = sourceLabel.toLowerCase();
  const lowerShortUrl = shortUrl.toLowerCase();
  if (!sourceLabel || lowerSourceLabel === lowerShortUrl || lowerSourceLabel.includes(lowerShortUrl)) return shortUrl;
  return `${sourceLabel} - ${shortUrl}`;
}

function serverIdentityKey(url: string): string {
  const parts = comparableServerUrlParts(url);
  if (!parts) return normalizeLocalServerUrl(url);
  return `${parts.protocol}//${parts.hostname}:${parts.port}${parts.pathname}${parts.search}${parts.hash}`;
}

function serverEndpointKey(url: string): string {
  const parts = comparableServerUrlParts(url);
  if (!parts) return normalizeLocalServerUrl(url);
  return `${parts.protocol}//:${parts.port}${parts.pathname}${parts.search}${parts.hash}`;
}

function isLoopbackUrl(url: string): boolean {
  try {
    return isLoopbackLocalHostname(new URL(normalizeLocalServerUrl(url)).hostname);
  } catch {
    return false;
  }
}

function loopbackUrlRank(url: string): number {
  try {
    const hostname = normalizeLocalServerHostname(new URL(normalizeLocalServerUrl(url)).hostname);
    if (hostname === 'localhost') return 0;
    if (hostname === '127.0.0.1') return 1;
    if (hostname === '[::1]') return 2;
  } catch {
    // Fall through to lowest preference.
  }
  return 3;
}

function isPrivateIpv4Url(url: string): boolean {
  try {
    return isPrivateIpv4Hostname(new URL(normalizeLocalServerUrl(url)).hostname);
  } catch {
    return false;
  }
}

function cleanServerLabel(value: string): string {
  return value
    .replace(/\0/g, '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function paneLabel(pane: WorkspaceServerPane, fallback: string): string {
  const title = typeof pane.title === 'string' ? pane.title.trim() : '';
  const cleanedTitle = cleanServerLabel(title);
  if (pane.type === 'terminal' && /^Terminal(?:\s+\d+)?$/i.test(cleanedTitle)) {
    return fallback;
  }
  return cleanedTitle || fallback;
}

function isWorkspaceServerPane(value: unknown): value is WorkspaceServerPane {
  return typeof value === 'object'
    && value !== null
    && typeof (value as Partial<WorkspaceServerPane>).type === 'string';
}

export function discoverWorkspaceServers(
  panes: WorkspaceServerPane[],
  getTerminalTail: (terminalId: string, maxBytes: number) => string,
  options: { maxServers?: number } = {},
): DetectedWorkspaceServer[] {
  const requestedMaxServers = options.maxServers;
  const maxServers = Number.isFinite(requestedMaxServers)
    ? Math.max(1, Math.min(HARD_MAX_WORKSPACE_SERVERS, Math.floor(requestedMaxServers as number)))
    : DEFAULT_MAX_WORKSPACE_SERVERS;
  const seen = new Map<string, number>();
  const servers: DetectedWorkspaceServer[] = [];

  const add = (url: string, label: string) => {
    const normalized = normalizeLocalServerUrl(url);
    const identityKey = serverIdentityKey(normalized);
    const existingIndex = seen.get(identityKey);
    if (existingIndex !== undefined) {
      if (!isLoopbackUrl(servers[existingIndex].url) && isLoopbackUrl(normalized)) {
        servers[existingIndex] = { url: normalized, label };
      }
      return;
    }

    const endpointKey = serverEndpointKey(normalized);
    const aliasIndex = servers.findIndex(server =>
      serverEndpointKey(server.url) === endpointKey
      && ((isLoopbackUrl(server.url) && isLoopbackUrl(normalized))
        || (isLoopbackUrl(server.url) && isPrivateIpv4Url(normalized))
        || (isPrivateIpv4Url(server.url) && isLoopbackUrl(normalized)))
    );
    if (aliasIndex !== -1) {
      const currentUrl = servers[aliasIndex].url;
      if (
        isLoopbackUrl(normalized)
        && (!isLoopbackUrl(currentUrl) || loopbackUrlRank(normalized) < loopbackUrlRank(currentUrl))
      ) {
        servers[aliasIndex] = { url: normalized, label };
        seen.set(identityKey, aliasIndex);
      }
      return;
    }

    if (servers.length >= maxServers) return;

    seen.set(identityKey, servers.length);
    servers.push({ url: normalized, label });
  };

  const safePanes = Array.isArray(panes) ? panes.filter(isWorkspaceServerPane) : [];

  for (const pane of safePanes) {
    if (pane.type === 'preview') continue;

    if (typeof pane.data?.url === 'string' && pane.data.url.trim()) {
      if (isLocalServerUrl(pane.data.url)) {
        add(pane.data.url.trim(), paneLabel(pane, pane.type === 'terminal' ? 'Terminal server' : 'Server'));
      }
      if (pane.type !== 'terminal') continue;
    }

    if (pane.type !== 'terminal') continue;
    const terminalId = normalizeTerminalId(pane.data?.terminalId);
    if (!terminalId) continue;

    let tail: unknown = '';
    try {
      tail = getTerminalTail(terminalId, 12000);
    } catch {
      continue;
    }
    if (typeof tail !== 'string') continue;
    for (const url of detectLocalServerUrls(tail)) {
      add(url, paneLabel(pane, 'Terminal server'));
    }
  }

  for (const pane of safePanes) {
    if (pane.type !== 'preview') continue;
    if (typeof pane.data?.url !== 'string' || !pane.data.url.trim()) continue;
    if (!isLocalServerUrl(pane.data.url)) continue;
    add(pane.data.url.trim(), paneLabel(pane, 'Open server'));
  }

  return servers;
}
