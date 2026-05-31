import { cleanLocalServerUrlInput, isLocalServerUrl, normalizeLocalServerUrl } from './localServerDetection.js';

function cleanHttpPreviewUrl(raw: string): string {
  if (isLocalServerUrl(raw)) return normalizeLocalServerUrl(raw);
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return '';
  }
}

function cleanFilePreviewUrl(raw: string): string {
  try {
    return new URL(raw).toString();
  } catch {
    return '';
  }
}

export function normalizePreviewUrl(value: unknown): string {
  const raw = typeof value === 'string' ? cleanLocalServerUrlInput(value) : '';
  if (!raw) return '';
  if (/^https?:\/\//i.test(raw)) return cleanHttpPreviewUrl(raw);
  if (/^file:\/\//i.test(raw)) return cleanFilePreviewUrl(raw);
  if (isLocalServerUrl(raw)) return normalizeLocalServerUrl(raw);
  if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return '';
  return raw;
}

export function previewUrlEquals(left: unknown, right: unknown): boolean {
  const leftUrl = normalizePreviewUrl(left);
  const rightUrl = normalizePreviewUrl(right);
  return Boolean(leftUrl && rightUrl && leftUrl === rightUrl);
}
