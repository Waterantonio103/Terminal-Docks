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
  let result: boolean;
  if (args.command) {
    result = await invoke<boolean>('spawn_pty_with_command', {
      id: args.id,
      rows: args.rows,
      cols: args.cols,
      cwd: args.cwd ?? null,
      command: args.command,
      args: args.args ?? [],
      env: args.env ?? {},
    });
  } else {
    result = await invoke<boolean>('spawn_pty', {
      id: args.id,
      rows: args.rows,
      cols: args.cols,
      cwd: args.cwd ?? null,
    });
  }
  if (result !== true) {
    throw new Error(`PTY spawn for terminalId "${args.id}" returned false — backend refused creation.`);
  }
}

export async function writeToTerminal(terminalId: string, data: string): Promise<void> {
  await invoke('write_to_pty', { id: terminalId, data });
}

export async function isTerminalActive(terminalId: string): Promise<boolean> {
  return await invoke<boolean>('is_pty_active', { id: terminalId });
}

export async function destroyTerminal(terminalId: string): Promise<void> {
  await invoke('destroy_pty', { id: terminalId });
}

export async function getRecentTerminalOutput(terminalId: string, maxBytes = 4096): Promise<string> {
  try {
    return await invoke<string>('get_pty_recent_output', { id: terminalId, maxBytes });
  } catch {
    return '';
  }
}

export async function resizeTerminal(terminalId: string, rows: number, cols: number): Promise<void> {
  await invoke('resize_pty', { id: terminalId, rows, cols });
}

// ──────────────────────────────────────────────
// Terminal Metadata
// ──────────────────────────────────────────────

export async function registerTerminalMetadata(args: {
  terminalId: string;
  nodeId: string;
  runtimeSessionId: string;
  cli: string;
}): Promise<void> {
  try {
    await invoke('register_pty_runtime_metadata', {
      terminalId: args.terminalId,
      nodeId: args.nodeId,
      runtimeSessionId: args.runtimeSessionId,
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

export async function getMcpBaseUrl(): Promise<string> {
  if (cachedMcpBaseUrl) return cachedMcpBaseUrl;
  try {
    cachedMcpBaseUrl = await invoke<string>('get_mcp_base_url');
  } catch {
    cachedMcpBaseUrl = 'http://localhost:3741';
  }
  return cachedMcpBaseUrl;
}

export async function getMcpUrl(): Promise<string> {
  try {
    return await invoke<string>('get_mcp_url');
  } catch {
    return 'http://localhost:3741/mcp';
  }
}

export async function checkMcpHealth(): Promise<boolean> {
  const baseUrl = await getMcpBaseUrl();
  try {
    const response = await fetch(`${baseUrl}/health`, { method: 'GET' });
    return response.ok;
  } catch {
    return false;
  }
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

export async function registerMcpSession(request: McpRegistrationRequest): Promise<{ ok: boolean; message?: string; error?: string }> {
  try {
    const result = await invoke<{ ok?: boolean; message?: string; error?: string }>('mcp_register_runtime_session', {
      payload: request,
    });
    return { ok: result.ok ?? false, message: result.message, error: result.error };
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    return { ok: false, error: msg };
  }
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
  await invoke('register_runtime_activation_dispatch', {
    missionId: args.missionId,
    nodeId: args.nodeId,
    attempt: args.attempt,
    sessionId: args.sessionId,
    agentId: args.agentId,
    terminalId: args.terminalId,
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
