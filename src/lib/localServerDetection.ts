const LOCAL_SERVER_HOST_PATTERN = String.raw`(?:localhost\.?|127(?:\.\d{1,3}){3}\.?|0\.0\.0\.0\.?|\[::1\]|\[::\]|[a-z0-9.-]+\.localhost\.?|(?:\d{1,3}\.){3}\d{1,3}\.?)`;
const LOCAL_SERVER_USERINFO_PATTERN = String.raw`(?:[^\s"'<>/@]+(?::[^\s"'<>/@]*)?@)?`;
const LOCAL_SERVER_URL_PATTERN = new RegExp(
  String.raw`(^|[^\w.-])((?:https?:\/\/${LOCAL_SERVER_USERINFO_PATTERN}${LOCAL_SERVER_HOST_PATTERN}(?::\d+)?|${LOCAL_SERVER_HOST_PATTERN}:\d+)(?:[/?#][^\s"'<>]*)?)`,
  'gi',
);
const ANSI_ESCAPE_PATTERN = /\x1B(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1B]*(?:\x07|\x1B\\)|[@-~])/g;
const URL_WRAPPERS: Array<[string, string]> = [
  ['<', '>'],
  ['(', ')'],
  ['[', ']'],
  ['{', '}'],
  ['"', '"'],
  ["'", "'"],
  ['`', '`'],
];

function isBracketedIpv6Host(value: string): boolean {
  return /^(?:https?:\/\/)?\[[0-9a-f:.]+\](?::\d+)?(?:[/?#].*)?$/i.test(value.trim());
}

function stripTrailingUrlPunctuation(value: string): string {
  let trimmed = value;
  while (/[)\]},.;:!]$/.test(trimmed) && trimmed.length > 0) {
    if (trimmed.endsWith(']') && isBracketedIpv6Host(trimmed)) break;
    if (
      (trimmed.startsWith('[') && trimmed.endsWith(']'))
      || (trimmed.startsWith('(') && trimmed.endsWith(')'))
      || (trimmed.startsWith('{') && trimmed.endsWith('}'))
    ) {
      break;
    }
    trimmed = trimmed.slice(0, -1);
  }
  return trimmed;
}

function parseIpv4Hostname(hostname: string): number[] | null {
  const rawParts = hostname.split('.');
  if (rawParts.length !== 4 || rawParts.some(part => !/^\d{1,3}$/.test(part))) return null;
  const parts = rawParts.map(part => Number(part));
  if (parts.length !== 4 || parts.some(part => !Number.isInteger(part) || part < 0 || part > 255)) return null;
  return parts;
}

export function isPrivateIpv4Hostname(hostname: string): boolean {
  const parts = parseIpv4Hostname(normalizeLocalServerHostname(hostname));
  if (!parts) return false;
  const [a, b] = parts;
  return a === 10
    || (a === 172 && b >= 16 && b <= 31)
    || (a === 192 && b === 168)
    || (a === 169 && b === 254);
}

export function normalizeLocalServerHostname(hostname: string): string {
  const value = hostname.replace(ANSI_ESCAPE_PATTERN, '').replace(/\0/g, '').trim().toLowerCase().replace(/\.+$/, '');
  return value === '::1' ? '[::1]' : value;
}

export function isLoopbackLocalHostname(hostname: string): boolean {
  const normalized = normalizeLocalServerHostname(hostname);
  if (normalized === 'localhost' || normalized === '[::1]') return true;
  const ipv4Parts = parseIpv4Hostname(normalized);
  return Boolean(ipv4Parts && ipv4Parts[0] === 127);
}

export function cleanLocalServerUrlInput(rawUrl: string): string {
  let trimmed = rawUrl.replace(ANSI_ESCAPE_PATTERN, '').replace(/\0/g, '').trim();
  let changed = true;
  while (changed) {
    changed = false;
    for (const [open, close] of URL_WRAPPERS) {
      if (open === '[' && isBracketedIpv6Host(trimmed)) continue;
      if (trimmed.startsWith(open) && trimmed.endsWith(close) && trimmed.length > open.length + close.length) {
        trimmed = trimmed.slice(open.length, -close.length).trim();
        changed = true;
      }
    }
    const withoutTrailingPunctuation = stripTrailingUrlPunctuation(trimmed);
    if (withoutTrailingPunctuation !== trimmed) {
      trimmed = withoutTrailingPunctuation;
      changed = true;
    }
  }
  return trimmed;
}

export function normalizeLocalServerUrl(rawUrl: string): string {
  const trimmed = cleanLocalServerUrlInput(rawUrl);
  const withProtocol = /^https?:\/\//i.test(trimmed) ? trimmed : `http://${trimmed}`;
  const localHostMapped = withProtocol
    .replace(/^(https?:\/\/)0\.0\.0\.0(?=[:/]|$)/i, '$1localhost')
    .replace(/^(https?:\/\/)\[::\](?=[:/]|$)/i, '$1localhost');

  try {
    const url = new URL(localHostMapped);
    const protocol = url.protocol.toLowerCase();
    const parsedHostname = normalizeLocalServerHostname(url.hostname);
    const hostname = parsedHostname === '0.0.0.0' || parsedHostname === '[::]' ? 'localhost' : parsedHostname;
    const host = hostname.includes(':') && !hostname.startsWith('[')
      ? `[${hostname}]`
      : hostname;
    const port = url.port ? `:${url.port}` : '';
    const pathname = /^\/+$/.test(url.pathname) ? '' : url.pathname.replace(/\/+$/, '');
    return `${protocol}//${host}${port}${pathname}${url.search}${url.hash}`;
  } catch {
    return localHostMapped.replace(/\/$/, '');
  }
}

export function isLocalServerUrl(rawUrl: string): boolean {
  try {
    const url = new URL(normalizeLocalServerUrl(rawUrl));
    const hostname = normalizeLocalServerHostname(url.hostname);
    return isLoopbackLocalHostname(hostname)
      || hostname.endsWith('.localhost')
      || isPrivateIpv4Hostname(hostname);
  } catch {
    return false;
  }
}

export function detectLocalServerUrls(text: string): string[] {
  const seen = new Set<string>();
  const urls: string[] = [];
  const plainText = text.replace(ANSI_ESCAPE_PATTERN, '').replace(/\0/g, '');

  for (const match of plainText.matchAll(LOCAL_SERVER_URL_PATTERN)) {
    const normalized = normalizeLocalServerUrl(match[2]);
    if (!isLocalServerUrl(normalized)) continue;
    if (seen.has(normalized)) continue;
    seen.add(normalized);
    urls.push(normalized);
  }

  return urls;
}
