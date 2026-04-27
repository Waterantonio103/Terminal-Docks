import { invoke } from '@tauri-apps/api/core';
import { registry } from './registry';
import { mcpBus } from './mcpEventBus';
import { newSessionId } from './bootstrap';
import type {
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

// Backwards-compatible adapter. Does not spawn a child process — it binds to
// a PTY that some other code (Launcher / manual flow) already created, and
// relays tasks through stdin exactly the way MissionControl used to.
// The bootstrap step is a no-op because we can't actually guarantee what CLI
// is running. readyState becomes 'ready' immediately so dispatch works.
export const genericAdapter: WorkerAdapter = {
  kind: 'generic',

  async spawnWorker({ paneId, agentId, profileId, workspaceDir }) {
    const sessionId = newSessionId('generic');
    const terminalId = `term-${paneId}`;
    const session: WorkerSession = {
      sessionId,
      paneId,
      terminalId,
      kind: 'generic',
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

  async focus(_session) {
    // Focus integration handled at the pane layer; no-op here.
  },

  async cancel(session) {
    await invoke('write_to_pty', { id: session.terminalId, data: '\x03' });
    session.currentTask = undefined;
    session.readyState = 'ready';
  },

  async collectResult() { return null; },

  async dispose(session) {
    registry.remove(session.sessionId);
  },
};
