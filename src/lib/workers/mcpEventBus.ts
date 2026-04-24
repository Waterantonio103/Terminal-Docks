import { invoke } from '@tauri-apps/api/core';
import { registry } from './registry';
import type { McpServerEvent } from './types';
import { useWorkspaceStore, type MissionArtifact } from '../../store/workspace';
import { generateId } from '../graphUtils';

type Handler = (ev: McpServerEvent) => void;

interface Connection {
  es: EventSource;
  handlers: Set<Handler>;
}

let cachedBaseUrl: string | null = null;
async function getBaseUrl(): Promise<string> {
  if (cachedBaseUrl) return cachedBaseUrl;
  try {
    cachedBaseUrl = await invoke<string>('get_mcp_base_url');
  } catch {
    cachedBaseUrl = 'http://localhost:3741';
  }
  return cachedBaseUrl;
}

class McpEventBus {
  private connections = new Map<string, Connection>();

  subscribe(sessionId: string, handler: Handler): () => void {
    let conn = this.connections.get(sessionId);
    if (!conn) conn = this.openConnection(sessionId);
    conn.handlers.add(handler);

    return () => {
      const current = this.connections.get(sessionId);
      if (!current) return;
      current.handlers.delete(handler);
      if (current.handlers.size === 0) {
        current.es.close();
        this.connections.delete(sessionId);
      }
    };
  }

  private openConnection(sessionId: string): Connection {
    const handlers = new Set<Handler>();
    const conn: Connection = { es: undefined as unknown as EventSource, handlers };
    this.connections.set(sessionId, conn);

    void getBaseUrl().then(base => {
      // Avoid re-opening if a dispose raced with the fetch.
      if (!this.connections.has(sessionId)) return;
      const es = new EventSource(`${base}/events/session?sid=${encodeURIComponent(sessionId)}`);
      conn.es = es;
      es.onmessage = e => {
        let ev: McpServerEvent | null = null;
        try { ev = JSON.parse(e.data) as McpServerEvent; } catch { return; }
        if (!ev || typeof ev.type !== 'string') return;
        // Mirror into the registry so any subscriber (adapter, UI) sees
        // state changes even if it hasn't subscribed yet.
        applyToRegistry(ev);
        for (const h of handlers) {
          try { h(ev); } catch (error) { console.warn('mcp event handler failed', error); }
        }
      };
      es.onerror = () => { /* EventSource auto-reconnects; nothing to do */ };
    });
    return conn;
  }
}

function applyToRegistry(ev: McpServerEvent): void {
  switch (ev.type) {
    case 'agent:artifact':
      if (ev.artifactType === 'file_change' || ev.artifactType === 'summary' || ev.artifactType === 'reference') {
        const session = registry.get(ev.sessionId);
        const task = session?.currentTask;
        if (task) {
          const artifact: MissionArtifact = {
            id: ev.key || generateId(),
            type: ev.artifactType,
            label: ev.label || (ev.artifactType === 'file_change' ? 'File Change' : 'Artifact'),
            content: ev.content,
            path: ev.path,
            timestamp: ev.at || Date.now(),
          };
          useWorkspaceStore.getState().addMissionArtifact(task.missionId, task.nodeId, artifact);
        }
      }
      break;
    case 'agent:ready':
      registry.onReady(ev.sessionId);
      break;
    case 'agent:heartbeat':
      registry.onHeartbeat(ev.sessionId);
      break;
    case 'task:acked':
      if (typeof ev.taskSeq === 'number') registry.onTaskAcked(ev.sessionId, ev.taskSeq);
      break;
    case 'task:completed':
      if (typeof ev.taskSeq === 'number' && (ev.outcome === 'success' || ev.outcome === 'failure')) {
        registry.onTaskCompleted(ev.sessionId, ev.taskSeq, ev.outcome);
      }
      break;
    case 'agent:disconnected':
      registry.markDead(ev.sessionId, 'disconnected');
      break;
    case 'activation:acked':
      if (ev.missionId && ev.nodeId) {
        invoke('acknowledge_runtime_activation', {
          missionId: ev.missionId,
          nodeId: ev.nodeId,
          attempt: ev.attempt || 1,
          status: 'activation_acked'
        }).catch(err => console.warn('Failed to ack activation from mcp', err));
      }
      break;
  }
}

export const mcpBus = new McpEventBus();

export async function waitForMcpEvent<T extends McpServerEvent['type']>(
  expectedType: T,
  sessionId: string,
  timeoutMs: number,
): Promise<McpServerEvent> {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      unsub();
      reject(new Error(`Timed out waiting for ${expectedType} on ${sessionId}`));
    }, timeoutMs);
    const unsub = mcpBus.subscribe(sessionId, ev => {
      if (ev.type === expectedType) {
        clearTimeout(timer);
        unsub();
        resolve(ev);
      }
    });
  });
}
