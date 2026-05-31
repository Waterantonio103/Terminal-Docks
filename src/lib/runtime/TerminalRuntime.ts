/**
 * TerminalRuntime.ts — Low-level PTY/Tauri operations.
 *
 * Wraps Tauri invoke() calls for PTY management into a clean async API.
 * The RuntimeManager uses this layer; higher-level code never calls
 * PTY commands directly.
 *
 * Phase 4 — Wave 3 / Agent B
 */

import { invoke } from '@tauri-apps/api/core';
import { normalizeTerminalId } from '../terminalIds.js';
import { terminalOutputBus } from './TerminalOutputBus.js';

export function requireTerminalRuntimeId(value: unknown, operation: string): string {
  const terminalId = normalizeTerminalId(value);
  if (!terminalId) {
    throw new Error(`Cannot ${operation}: missing terminal id.`);
  }
  return terminalId;
}

// ──────────────────────────────────────────────
// PTY Lifecycle
// ──────────────────────────────────────────────

export async function spawnTerminal(args: {
  id: string;
  rows: number;
  cols: number;
  cwd?: string | null;
  command?: string;
  args?: string[];
  env?: Record<string, string>;
}): Promise<void> {
  const terminalId = requireTerminalRuntimeId(args.id, 'spawn PTY');
  let result: boolean;
  if (args.command) {
    result = await invoke<boolean>('spawn_pty_with_command', {
      id: terminalId,
      rows: args.rows,
      cols: args.cols,
      cwd: args.cwd ?? null,
      command: args.command,
      args: args.args ?? [],
      env: args.env ?? {},
    });
  } else {
    result = await invoke<boolean>('spawn_pty', {
      id: terminalId,
      rows: args.rows,
      cols: args.cols,
      cwd: args.cwd ?? null,
      env: args.env ?? {},
    });
  }
  if (result !== true) {
    throw new Error(`PTY spawn for terminalId "${terminalId}" returned false — backend refused creation.`);
  }
}

export async function writeToTerminal(terminalId: string, data: string): Promise<void> {
  const id = requireTerminalRuntimeId(terminalId, 'write to PTY');
  try {
    await invoke('write_to_pty', { id, data });
  } catch (err) {
    console.warn(`[pty] Write error for ${id}:`, err);
    throw err;
  }
}

export async function isTerminalActive(terminalId: string): Promise<boolean> {
  const id = requireTerminalRuntimeId(terminalId, 'check PTY state');
  return await invoke<boolean>('is_pty_active', { id });
}

export async function destroyTerminal(terminalId: string): Promise<void> {
  const id = normalizeTerminalId(terminalId);
  if (!id) return;
  try {
    await invoke('destroy_pty', { id });
  } catch (err) {
    console.warn(`[pty] Ignored destroy error for ${id}:`, err);
  }
}

export async function getRecentTerminalOutput(terminalId: string, maxBytes = 4096): Promise<string> {
  const id = normalizeTerminalId(terminalId);
  if (!id) return '';

  const buffered = terminalOutputBus.getTail(id, maxBytes);
  if (buffered) return buffered;

  try {
    return await invoke<string>('get_pty_recent_output', { id, maxBytes });
  } catch {
    return '';
  }
}

export async function resizeTerminal(terminalId: string, rows: number, cols: number): Promise<void> {
  const id = normalizeTerminalId(terminalId);
  if (!id) return;

  try {
    await invoke('resize_pty', { id, rows, cols });
  } catch (err) {
    console.warn(`[pty] Ignored resize error for ${id}:`, err);
  }
}

// ──────────────────────────────────────────────
// Terminal Metadata
// ──────────────────────────────────────────────

export async function registerTerminalMetadata(args: {
  terminalId: string;
  missionId: string;
  nodeId: string;
  runtimeSessionId: string;
  attempt: number;
  cli: string;
}): Promise<void> {
  const terminalId = normalizeTerminalId(args.terminalId);
  if (!terminalId) return;

  try {
    await invoke('register_pty_runtime_metadata', {
      terminalId,
      missionId: args.missionId,
      nodeId: args.nodeId,
      runtimeSessionId: args.runtimeSessionId,
      attempt: args.attempt,
      cli: args.cli,
    });
  } catch {
    // Non-critical — metadata is informational
  }
}

// ──────────────────────────────────────────────
// MCP Server Health
// ──────────────────────────────────────────────

let cachedMcpBaseUrl: string | null = null;
const DEFAULT_MCP_HEALTH_TIMEOUT_MS = 5_000;
const DEFAULT_MCP_BASE_URL = 'http://localhost:3741';
const DEFAULT_MCP_ENDPOINT_URL = `${DEFAULT_MCP_BASE_URL}/mcp`;
const URL_CONTROL_CHARS_PATTERN = /[\x00-\x1F\x7F]/g;

export interface McpHealthCheckOptions {
  timeoutMs?: number;
  baseUrl?: string;
}

export interface McpHealthCheckResult {
  ok: boolean;
  baseUrl: string;
  status?: number;
  timedOut: boolean;
  error?: string;
  durationMs: number;
}

export function normalizeMcpBaseUrl(value: string | null | undefined): string {
  const raw = typeof value === 'string' ? value.replace(URL_CONTROL_CHARS_PATTERN, '').trim() : '';
  if (!raw) return DEFAULT_MCP_BASE_URL;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_MCP_BASE_URL;
    url.username = '';
    url.password = '';
    url.pathname = url.pathname.replace(/\/mcp\/?$/i, '').replace(/\/+$/g, '');
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/g, '');
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return DEFAULT_MCP_BASE_URL;
    return raw.replace(/\/mcp\/?$/i, '').replace(/\/+$/g, '') || DEFAULT_MCP_BASE_URL;
  }
}

export function normalizeMcpEndpointUrl(value: string | null | undefined): string {
  const raw = typeof value === 'string' ? value.replace(URL_CONTROL_CHARS_PATTERN, '').trim() : '';
  if (!raw) return DEFAULT_MCP_ENDPOINT_URL;

  try {
    const url = new URL(raw);
    if (url.protocol !== 'http:' && url.protocol !== 'https:') return DEFAULT_MCP_ENDPOINT_URL;
    url.username = '';
    url.password = '';
    const pathname = url.pathname.replace(/\/+$/g, '');
    url.pathname = pathname.endsWith('/mcp') ? pathname : `${pathname || ''}/mcp`;
    url.hash = '';
    return url.toString();
  } catch {
    if (/^[a-z][a-z0-9+.-]*:/i.test(raw)) return DEFAULT_MCP_ENDPOINT_URL;
    const cleaned = raw.split('#')[0]?.replace(/\/+$/g, '') ?? '';
    return cleaned.endsWith('/mcp') ? cleaned : `${cleaned || DEFAULT_MCP_BASE_URL}/mcp`;
  }
}

export async function getMcpBaseUrl(): Promise<string> {
  if (cachedMcpBaseUrl) return cachedMcpBaseUrl;
  try {
    cachedMcpBaseUrl = normalizeMcpBaseUrl(await invoke<string>('get_mcp_base_url'));
  } catch {
    cachedMcpBaseUrl = 'http://localhost:3741';
  }
  return cachedMcpBaseUrl;
}

export async function getMcpUrl(): Promise<string> {
  try {
    return normalizeMcpEndpointUrl(await invoke<string>('get_mcp_url'));
  } catch {
    return normalizeMcpEndpointUrl(await getMcpBaseUrl());
  }
}

export async function checkMcpHealthDetailed(options: McpHealthCheckOptions = {}): Promise<McpHealthCheckResult> {
  const startedAt = Date.now();
  const baseUrl = normalizeMcpBaseUrl(options.baseUrl ?? await getMcpBaseUrl());
  const timeoutMs = Math.max(1, options.timeoutMs ?? DEFAULT_MCP_HEALTH_TIMEOUT_MS);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${baseUrl}/health`, {
      method: 'GET',
      signal: controller.signal,
      cache: 'no-store',
    });
    return {
      ok: response.ok,
      baseUrl,
      status: response.status,
      timedOut: false,
      durationMs: Date.now() - startedAt,
    };
  } catch (err) {
    const name = err instanceof Error ? err.name : '';
    const timedOut = controller.signal.aborted || name === 'AbortError';
    return {
      ok: false,
      baseUrl,
      timedOut,
      error: timedOut ? `mcp_health_timeout after ${timeoutMs}ms` : (err instanceof Error ? err.message : String(err)),
      durationMs: Date.now() - startedAt,
    };
  } finally {
    clearTimeout(timer);
  }
}

export async function checkMcpHealth(options: McpHealthCheckOptions = {}): Promise<boolean> {
  return (await checkMcpHealthDetailed(options)).ok;
}

// ──────────────────────────────────────────────
// MCP Session Registration
// ──────────────────────────────────────────────

export interface McpRegistrationRequest {
  sessionId: string;
  missionId: string;
  nodeId: string;
  attempt: number;
  role: string;
  profileId?: string | null;
  agentId: string;
  terminalId: string;
  cli: string;
  capabilities?: Array<{ id: string; level?: number; verifiedBy?: string }>;
  workingDir?: string | null;
  activationId?: string;
  runId?: string;
  executionMode?: string;
}

export async function registerMcpSession(
  request: McpRegistrationRequest,
  options: { timeoutMs?: number } = {},
): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const invokePromise = invoke<{ ok?: boolean; message?: string; error?: string }>('mcp_register_runtime_session', {
      payload: request,
    });
    const result = options.timeoutMs
      ? await promiseWithTimeout(
          invokePromise,
          options.timeoutMs,
          () => ({ ok: false, error: `mcp_registration_timeout after ${options.timeoutMs}ms` }),
        )
      : await invokePromise;
    return { ok: result.ok ?? false, message: result.message, error: result.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
}

function promiseWithTimeout<T>(promise: Promise<T>, timeoutMs: number, onTimeout: () => T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  return Promise.race([
    promise,
    new Promise<T>(resolve => {
      timer = setTimeout(() => resolve(onTimeout()), timeoutMs);
    }),
  ]).finally(() => {
    if (timer) clearTimeout(timer);
  });
}

// ──────────────────────────────────────────────
// Runtime Activation Backend
// ──────────────────────────────────────────────

export async function registerActivationDispatch(args: {
  missionId: string;
  nodeId: string;
  attempt: number;
  sessionId: string;
  agentId: string;
  terminalId: string;
  activatedAt: number;
}): Promise<void> {
  const terminalId = requireTerminalRuntimeId(args.terminalId, 'register runtime activation');
  await invoke('register_runtime_activation_dispatch', {
    missionId: args.missionId,
    nodeId: args.nodeId,
    attempt: args.attempt,
    sessionId: args.sessionId,
    agentId: args.agentId,
    terminalId,
    activatedAt: args.activatedAt,
  });
}

export async function acknowledgeActivation(args: {
  missionId: string;
  nodeId: string;
  attempt: number;
  status: string;
  reason?: string | null;
}): Promise<void> {
  await invoke('acknowledge_runtime_activation', {
    missionId: args.missionId,
    nodeId: args.nodeId,
    attempt: args.attempt,
    status: args.status,
    reason: args.reason ?? null,
  });
}

// ──────────────────────────────────────────────
// Headless Agent Run
// ──────────────────────────────────────────────

export interface HeadlessRunRequest {
  runId: string;
  missionId: string;
  nodeId: string;
  attempt: number;
  sessionId: string;
  agentId: string;
  cli: string;
  executionMode: string;
  cwd: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  promptDelivery?: string;
  prompt: string;
  timeoutMs?: number;
}

export async function startHeadlessRun(request: HeadlessRunRequest): Promise<void> {
  await invoke('start_agent_run', { payload: request });
}

/**
 * Write prompt content to a temp file inside the run directory and return the file path.
 */
export async function writePromptTempFile(
  runId: string,
  prompt: string,
  cwd: string | null,
): Promise<string> {
  return await invoke<string>('write_prompt_temp_file', { runId, prompt, cwd });
}

// ──────────────────────────────────────────────
// MCP Notifications
// ──────────────────────────────────────────────

export async function notifyMcpTaskPushed(args: {
  sessionId: string;
  missionId: string;
  nodeId: string;
  taskSeq: number;
  attempt: number;
}): Promise<void> {
  try {
    await invoke('mcp_notify_agent', {
      sessionId: args.sessionId,
      kind: 'task_pushed',
      missionId: args.missionId,
      nodeId: args.nodeId,
      taskSeq: args.taskSeq,
      attempt: args.attempt,
    });
  } catch {
    // Non-critical notification
  }
}

export async function notifyMcpDisconnected(args: {
  sessionId: string;
  missionId?: string | null;
  nodeId?: string | null;
  attempt?: number | null;
  reason: string;
}): Promise<void> {
  try {
    await invoke('mcp_notify_agent', {
      sessionId: args.sessionId,
      kind: 'runtime_disconnected',
      missionId: args.missionId ?? null,
      nodeId: args.nodeId ?? null,
      attempt: args.attempt ?? null,
      reason: args.reason,
    });
  } catch {
    // Non-critical notification
  }
}
