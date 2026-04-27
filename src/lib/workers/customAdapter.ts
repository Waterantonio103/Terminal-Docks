import { invoke } from '@tauri-apps/api/core';
import { registry } from './registry';
import { mcpBus } from './mcpEventBus';
import { getMcpUrl, newSessionId } from './bootstrap';
import { useWorkspaceStore } from '../../store/workspace';
import type { SpawnArgs, TaskEnvelope, WorkerAdapter, WorkerEvent, WorkerSession } from './types';

/**
 * @deprecated This legacy adapter does direct PTY writes outside RuntimeManager.
 * Use RuntimeManager.createRuntimeForNode() + launchCli() instead.
 * All launch, injection, and readiness should go through RuntimeManager.
 * This file will be removed once the legacy worker system is fully deprecated.
 */

function lookupCustomCliForPane(paneId: string): {
  command: string;
  args: string[];
  env: Record<string, string>;
} {
  const { tabs } = useWorkspaceStore.getState();
  for (const tab of tabs) {
    const pane = tab.panes.find(p => p.id === paneId);
    if (pane?.data?.customCliCommand) {
      return {
        command: pane.data.customCliCommand as string,
        args: (pane.data.customCliArgs as string[] | undefined) ?? [],
        env: (pane.data.customCliEnv as Record<string, string> | undefined) ?? {},
      };
    }
  }
  return { command: 'bash', args: [], env: {} };
}

export const customAdapter: WorkerAdapter = {
  kind: 'custom',

  async spawnWorker({ paneId, agentId, profileId, workspaceDir, rows, cols }: SpawnArgs) {
    const sessionId = newSessionId('custom');
    const terminalId = `term-${paneId}`;
    const mcpUrl = await getMcpUrl();
    const { command, args, env } = lookupCustomCliForPane(paneId);

    await invoke('spawn_pty_with_command', {
      id: terminalId,
      rows,
      cols,
      cwd: workspaceDir ?? null,
      command,
      args,
      env: {
        ...env,
        TD_SESSION_ID: sessionId,
        TD_MCP_URL: mcpUrl,
        TD_AGENT_ID: agentId,
        TD_PROFILE_ID: profileId,
        TD_WORKSPACE: workspaceDir ?? '',
        TD_KIND: 'custom',
      },
    });

    const session: WorkerSession = {
      sessionId,
      paneId,
      terminalId,
      kind: 'custom',
      agentId,
      profileId,
      workspaceDir,
      readyState: 'ready',
      lastHeartbeatAt: Date.now(),
    };
    registry.put(session);
    return session;
  },

  async bootstrapWorker(session) {
    session.readyState = 'ready';
    session.lastHeartbeatAt = Date.now();
  },

  async sendTask(session, envelope: TaskEnvelope) {
    session.currentTask = {
      missionId: envelope.missionId,
      nodeId: envelope.nodeId,
      attempt: envelope.attempt,
      taskSeq: envelope.taskSeq,
      startedAt: Date.now(),
    };
    session.readyState = 'busy';
    const payload = JSON.stringify({ signal: 'NEW_TASK', ...envelope }) + '\r';
    await invoke('write_to_pty', { id: session.terminalId, data: payload });
    return envelope.taskSeq;
  },

  streamOutput(session, onEvent: (e: WorkerEvent) => void) {
    return mcpBus.subscribe(session.sessionId, ev => {
      switch (ev.type) {
        case 'agent:ready':
          onEvent({ kind: 'ready' });
          break;
        case 'agent:heartbeat':
          onEvent({ kind: 'heartbeat', at: ev.at });
          break;
        case 'task:completed':
          if (typeof ev.taskSeq === 'number' && (ev.outcome === 'success' || ev.outcome === 'failure')) {
            onEvent({ kind: 'task-completed', taskSeq: ev.taskSeq, outcome: ev.outcome });
          }
          break;
      }
    });
  },

  async focus(_session) {},

  async cancel(session) {
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
