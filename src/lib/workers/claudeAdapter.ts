import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { registry } from './registry';
import { mcpBus, waitForMcpEvent } from './mcpEventBus';
import {
  decodeBytes,
  getMcpUrl,
  newSessionId,
  notifyTaskPushed,
  sleep,
  stripAnsi,
} from './bootstrap';
import type {
  SpawnArgs,
  TaskEnvelope,
  WorkerAdapter,
  WorkerEvent,
  WorkerSession,
} from './types';

/**
 * @deprecated This legacy adapter does direct PTY writes outside RuntimeManager.
 * Use RuntimeManager.createRuntimeForNode() + launchCli() instead.
 * All launch, injection, and readiness should go through RuntimeManager.
 * This file will be removed once the legacy worker system is fully deprecated.
 */

const BOOT_TIMEOUT_MS = 30_000;
const REPRIME_TIMEOUT_MS = 15_000;
const BANNER_HINT_RE = /\bclaude (code|assistant)\b/i;
const SHELL_PROMPT_RE = /(?:\$|>|#)\s*$/m;

class AdapterNotReadyError extends Error {
  constructor(session: WorkerSession) {
    super(`Claude session ${session.sessionId} not ready (state=${session.readyState})`);
  }
}

export const claudeAdapter: WorkerAdapter = {
  kind: 'claude',

  async spawnWorker({ paneId, agentId, profileId, workspaceDir, rows, cols }: SpawnArgs) {
    const sessionId = newSessionId('claude');
    const terminalId = `term-${paneId}`;
    const mcpUrl = await getMcpUrl();

    await invoke('spawn_pty_with_command', {
      id: terminalId,
      rows,
      cols,
      cwd: workspaceDir ?? null,
      command: 'claude',
      args: [],
      env: {
        TD_SESSION_ID: sessionId,
        TD_MCP_URL: mcpUrl,
        TD_AGENT_ID: agentId,
        TD_PROFILE_ID: profileId,
        TD_WORKSPACE: workspaceDir ?? '',
        TD_KIND: 'claude',
      },
    });

    const session: WorkerSession = {
      sessionId,
      paneId,
      terminalId,
      kind: 'claude',
      agentId,
      profileId,
      workspaceDir,
      readyState: 'spawning',
      lastHeartbeatAt: Date.now(),
    };
    registry.put(session);
    return session;
  },

  async bootstrapWorker(session) {
    session.readyState = 'booting';
    try {
      await waitForMcpEvent('agent:ready', session.sessionId, BOOT_TIMEOUT_MS);
      session.readyState = 'ready';
      return;
    } catch {
      // fall through to re-prime
    }

    const mcpUrl = await getMcpUrl();
    const payload = {
      signal: 'BOOTSTRAP',
      sessionId: session.sessionId,
      mcpUrl,
      agentId: session.agentId,
      profileId: session.profileId,
    };
    const primer = `### MISSION_CONTROL_BOOTSTRAP_REQUEST ###
Please connect to the MCP server at: ${mcpUrl}
Use sessionId: ${session.sessionId}

--- ENVELOPE ---
${JSON.stringify(payload)}
--- END ENVELOPE ---
\r`;
    await invoke('write_to_pty', { id: session.terminalId, data: primer });

    await waitForMcpEvent('agent:ready', session.sessionId, REPRIME_TIMEOUT_MS);
    session.readyState = 'ready';
  },

  async sendTask(session, envelope: TaskEnvelope) {
    if (session.readyState !== 'ready' && session.readyState !== 'busy') {
      throw new AdapterNotReadyError(session);
    }
    session.currentTask = {
      missionId: envelope.missionId,
      nodeId: envelope.nodeId,
      attempt: envelope.attempt,
      taskSeq: envelope.taskSeq,
      startedAt: Date.now(),
    };
    session.readyState = 'busy';

    const payload = { signal: 'NEW_TASK', ...envelope };
    const stdinPayload = `### MISSION_CONTROL_ACTIVATION_REQUEST ###
You have been assigned a new task.
Please call 'get_task_details({ missionId: "${envelope.missionId}", nodeId: "${envelope.nodeId}" })' to retrieve your full context.

--- ENVELOPE ---
${JSON.stringify(payload)}
--- END ENVELOPE ---
\r`;
    await Promise.all([
      invoke('write_to_pty', { id: session.terminalId, data: stdinPayload }),
      notifyTaskPushed({
        sessionId: session.sessionId,
        missionId: envelope.missionId,
        nodeId: envelope.nodeId,
        taskSeq: envelope.taskSeq,
        attempt: envelope.attempt,
      }),
    ]);
    return envelope.taskSeq;
  },

  streamOutput(session, onEvent: (e: WorkerEvent) => void) {
    let bannerConfirmed = false;
    const ptyUnlisten = listen<{ id: string; data: number[] }>('pty-out', e => {
      if (e.payload.id !== session.terminalId) return;
      const text = stripAnsi(decodeBytes(e.payload.data));
      if (!bannerConfirmed && BANNER_HINT_RE.test(text)) {
        bannerConfirmed = true;
        onEvent({ kind: 'banner', cli: 'claude', confidence: 'high' });
      }
      if (SHELL_PROMPT_RE.test(text) && session.readyState === 'ready' && bannerConfirmed) {
        // Claude exited; visible shell prompt means the CLI died.
        onEvent({ kind: 'process-exit', detail: 'shell-prompt-visible' });
      }
    });

    const mcpUnsub = mcpBus.subscribe(session.sessionId, ev => {
      switch (ev.type) {
        case 'agent:ready':
          onEvent({ kind: 'ready' });
          break;
        case 'agent:heartbeat':
          onEvent({ kind: 'heartbeat', at: ev.at });
          break;
        case 'task:acked':
          if (typeof ev.taskSeq === 'number') {
            onEvent({ kind: 'task-acked', taskSeq: ev.taskSeq });
          }
          break;
        case 'task:completed':
          if (typeof ev.taskSeq === 'number' && (ev.outcome === 'success' || ev.outcome === 'failure')) {
            onEvent({ kind: 'task-completed', taskSeq: ev.taskSeq, outcome: ev.outcome });
          }
          break;
      }
    });

    return () => {
      void ptyUnlisten.then(fn => fn()).catch(() => {});
      mcpUnsub();
    };
  },

  async focus(_session) {
    // No-op: focus is coordinated by the pane layer.
  },

  async cancel(session) {
    await invoke('write_to_pty', { id: session.terminalId, data: '\x03' });
    await sleep(200);
    await invoke('write_to_pty', { id: session.terminalId, data: '\x03' });
    session.currentTask = undefined;
    session.readyState = 'ready';
  },

  async collectResult() { return null; },

  async dispose(session) {
    try { await invoke('destroy_pty', { id: session.terminalId }); } catch {}
    registry.remove(session.sessionId);
  },
};
