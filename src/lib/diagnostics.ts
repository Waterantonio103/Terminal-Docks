export type Breadcrumb = {
  ts: number;
  label: string;
  data?: Record<string, unknown>;
};

const BREADCRUMB_KEY = 'comet-ai:breadcrumbs';
const FATAL_KEY = 'comet-ai:last-fatal';
const MAX_BREADCRUMBS = 50;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

function normalizeBreadcrumb(value: unknown): Breadcrumb | null {
  if (!isRecord(value)) return null;
  const label = typeof value.label === 'string' ? value.label.trim() : '';
  if (!label) return null;
  const ts = typeof value.ts === 'number' && Number.isFinite(value.ts) ? value.ts : Date.now();
  const data = isRecord(value.data) ? value.data : undefined;
  return { ts, label, ...(data ? { data } : {}) };
}

function normalizeBreadcrumbs(value: unknown): Breadcrumb[] {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeBreadcrumb).filter((breadcrumb): breadcrumb is Breadcrumb => Boolean(breadcrumb)).slice(-MAX_BREADCRUMBS);
}

export function recordBreadcrumb(label: string, data?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  const normalizedLabel = label.trim();
  if (!normalizedLabel) return;
  try {
    const raw = window.localStorage.getItem(BREADCRUMB_KEY);
    const parsed = raw ? normalizeBreadcrumbs(JSON.parse(raw)) : [];
    const next = [...parsed, { ts: Date.now(), label: normalizedLabel, ...(data ? { data } : {}) }].slice(-MAX_BREADCRUMBS);
    window.localStorage.setItem(BREADCRUMB_KEY, safeJson(next));
  } catch {
    // ignore
  }
}

export function readBreadcrumbs(): Breadcrumb[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(BREADCRUMB_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    return normalizeBreadcrumbs(parsed);
  } catch {
    return [];
  }
}

export type FatalErrorReport = {
  ts: number;
  kind: 'error' | 'unhandledrejection' | 'react';
  message: string;
  stack?: string;
  url?: string;
  breadcrumbs?: Breadcrumb[];
};

export function stringifyUnknownError(error: unknown): { message: string; stack?: string } {
  if (error instanceof Error) return { message: error.message || String(error), stack: error.stack };
  if (typeof error === 'string') return { message: error };
  try {
    return { message: JSON.stringify(error) };
  } catch {
    return { message: String(error) };
  }
}

export function writeFatalReport(report: FatalErrorReport) {
  if (typeof window === 'undefined') return;
  try {
    const normalized = normalizeFatalReport(report);
    if (!normalized) return;
    window.localStorage.setItem(FATAL_KEY, safeJson(normalized));
  } catch {
    // ignore
  }
}

function normalizeFatalReport(value: unknown): FatalErrorReport | null {
  if (!isRecord(value)) return null;
  const kind = value.kind;
  if (kind !== 'error' && kind !== 'unhandledrejection' && kind !== 'react') return null;
  const message = typeof value.message === 'string' ? value.message.trim() : '';
  if (!message) return null;
  const ts = typeof value.ts === 'number' && Number.isFinite(value.ts) ? value.ts : Date.now();
  const stack = typeof value.stack === 'string' && value.stack ? value.stack : undefined;
  const url = typeof value.url === 'string' && value.url ? value.url : undefined;
  const breadcrumbs = normalizeBreadcrumbs(value.breadcrumbs);
  return { ts, kind, message, ...(stack ? { stack } : {}), ...(url ? { url } : {}), ...(breadcrumbs.length ? { breadcrumbs } : {}) };
}

export function readLastFatalReport(): FatalErrorReport | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FATAL_KEY);
    if (!raw) return null;
    return normalizeFatalReport(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function clearLastFatalReport() {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(FATAL_KEY);
  } catch {
    // ignore
  }
}
