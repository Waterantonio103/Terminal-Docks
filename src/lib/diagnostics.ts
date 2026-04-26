export type Breadcrumb = {
  ts: number;
  label: string;
  data?: Record<string, unknown>;
};

const BREADCRUMB_KEY = 'comet-ai:breadcrumbs';
const FATAL_KEY = 'comet-ai:last-fatal';
const MAX_BREADCRUMBS = 50;

function safeJson(value: unknown) {
  try {
    return JSON.stringify(value);
  } catch {
    return '"[unserializable]"';
  }
}

export function recordBreadcrumb(label: string, data?: Record<string, unknown>) {
  if (typeof window === 'undefined') return;
  try {
    const raw = window.localStorage.getItem(BREADCRUMB_KEY);
    const parsed = raw ? (JSON.parse(raw) as Breadcrumb[]) : [];
    const next = [...parsed, { ts: Date.now(), label, ...(data ? { data } : {}) }].slice(-MAX_BREADCRUMBS);
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
    return Array.isArray(parsed) ? (parsed as Breadcrumb[]) : [];
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
    window.localStorage.setItem(FATAL_KEY, safeJson(report));
  } catch {
    // ignore
  }
}

export function readLastFatalReport(): FatalErrorReport | null {
  if (typeof window === 'undefined') return null;
  try {
    const raw = window.localStorage.getItem(FATAL_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as FatalErrorReport;
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

