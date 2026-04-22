import { invoke } from '@tauri-apps/api/core';

export function newSessionId(prefix = 'ws'): string {
  const rand = Math.random().toString(36).slice(2, 10);
  return `${prefix}:${Date.now().toString(36)}:${rand}`;
}

export async function getMcpUrl(): Promise<string> {
  try {
    return await invoke<string>('get_mcp_url');
  } catch {
    return 'http://localhost:3741/mcp';
  }
}

export async function notifyTaskPushed(params: {
  sessionId: string;
  missionId: string;
  nodeId: string;
  taskSeq: number;
  attempt: number;
}): Promise<void> {
  try {
    await invoke('mcp_notify_agent', {
      sessionId: params.sessionId,
      kind: 'task_pushed',
      missionId: params.missionId,
      nodeId: params.nodeId,
      taskSeq: params.taskSeq,
      attempt: params.attempt,
    });
  } catch (error) {
    console.warn('mcp_notify_agent failed', error);
  }
}

export function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const ANSI_ESCAPE_RE = /\x1b\[[0-?]*[ -/]*[@-~]|\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, '');
}

export function decodeBytes(bytes: number[] | Uint8Array): string {
  const arr = bytes instanceof Uint8Array ? bytes : Uint8Array.from(bytes);
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(arr);
  } catch {
    return '';
  }
}
