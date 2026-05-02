/**
 * WorkflowEvents.ts — Typed event bus for the Workflow Orchestrator.
 *
 * Provides a zero-dependency, strongly-typed publish/subscribe mechanism
 * that the Orchestrator uses to broadcast state changes. UI components,
 * Runtime Manager, MCP bridge, and test harnesses all subscribe here.
 *
 * Phase 5 — Wave 3 / Agent A
 */

import type {
  Artifact,
  CompletionOutcome,
  NodeLifecycleState,
  PermissionDecision,
  RunStatus,
} from './WorkflowTypes.js';

// ──────────────────────────────────────────────
// Orchestrator Event Types
// ──────────────────────────────────────────────

export type OrchestratorEvent =
  | { type: 'run_created'; runId: string; definitionId: string; timestamp: number }
  | { type: 'run_started'; runId: string; timestamp: number }
  | { type: 'run_completed'; runId: string; outcome: CompletionOutcome; timestamp: number }
  | { type: 'run_cancelled'; runId: string; timestamp: number }
  | { type: 'run_status_changed'; runId: string; from: RunStatus; to: RunStatus; timestamp: number }
  | { type: 'node_activated'; runId: string; nodeId: string; attempt: number; timestamp: number }
  | { type: 'node_state_changed'; runId: string; nodeId: string; from: NodeLifecycleState; to: NodeLifecycleState; timestamp: number }
  | { type: 'node_completed'; runId: string; nodeId: string; outcome: CompletionOutcome; attempt: number; timestamp: number }
  | { type: 'node_failed'; runId: string; nodeId: string; error?: string; attempt: number; timestamp: number }
  | { type: 'runtime_requested'; runId: string; nodeId: string; cliId: string; timestamp: number }
  | { type: 'runtime_attached'; runId: string; nodeId: string; sessionId: string; terminalId: string; timestamp: number }
  | { type: 'runtime_detached'; runId: string; nodeId: string; sessionId: string; timestamp: number }
  | { type: 'permission_requested'; runId: string; nodeId: string; permissionId: string; category: string; timestamp: number }
  | { type: 'permission_resolved'; runId: string; nodeId: string; permissionId: string; decision: PermissionDecision; timestamp: number }
  | { type: 'handoff_completed'; runId: string; fromNodeId: string; toNodeId: string; outcome: CompletionOutcome; timestamp: number }
  | { type: 'handoff_rejected'; runId: string; fromNodeId: string; toNodeId: string; reason: string; timestamp: number }
  | { type: 'artifact_published'; runId: string; nodeId: string; artifact: Artifact; timestamp: number }
  | { type: 'manual_takeover_requested'; runId: string; nodeId: string; timestamp: number }
  | { type: 'task_injected'; runId: string; nodeId: string; attempt: number; timestamp: number }
  | { type: 'task_acked'; runId: string; nodeId: string; attempt: number; timestamp: number }
  | { type: 'downstream_activated'; runId: string; sourceNodeId: string; targetNodeId: string; timestamp: number }
  | { type: 'fan_in_pending'; runId: string; targetNodeId: string; pendingFromNodes: string[]; timestamp: number }
  | { type: 'error'; runId: string; nodeId?: string; error: string; timestamp: number };

// ──────────────────────────────────────────────
// Subscriber Types
// ──────────────────────────────────────────────

export type OrchestratorEventHandler = (event: OrchestratorEvent) => void;

export interface OrchestratorEventSubscription {
  readonly unsubscribe: () => void;
}

// ──────────────────────────────────────────────
// Event Emitter
// ──────────────────────────────────────────────

export class WorkflowEventEmitter {
  private handlers = new Set<OrchestratorEventHandler>();
  private globalHistory: OrchestratorEvent[] = [];
  private maxHistorySize = 2000;

  emit(event: OrchestratorEvent): void {
    this.globalHistory.push(event);
    if (this.globalHistory.length > this.maxHistorySize) {
      this.globalHistory = this.globalHistory.slice(-this.maxHistorySize);
    }

    for (const handler of this.handlers) {
      try {
        handler(event);
      } catch (err) {
        console.warn('[WorkflowEventEmitter] handler error:', err);
      }
    }
  }

  subscribe(handler: OrchestratorEventHandler): OrchestratorEventSubscription {
    this.handlers.add(handler);
    return {
      unsubscribe: () => {
        this.handlers.delete(handler);
      },
    };
  }

  subscribeForRun(
    runId: string,
    handler: OrchestratorEventHandler,
  ): OrchestratorEventSubscription {
    const filtered: OrchestratorEventHandler = (event) => {
      if ('runId' in event && event.runId === runId) {
        handler(event);
      }
    };
    this.handlers.add(filtered);
    return {
      unsubscribe: () => {
        this.handlers.delete(filtered);
      },
    };
  }

  subscribeForNode(
    runId: string,
    nodeId: string,
    handler: OrchestratorEventHandler,
  ): OrchestratorEventSubscription {
    const filtered: OrchestratorEventHandler = (event) => {
      if (
        'runId' in event && event.runId === runId &&
        'nodeId' in event && event.nodeId === nodeId
      ) {
        handler(event);
      }
    };
    this.handlers.add(filtered);
    return {
      unsubscribe: () => {
        this.handlers.delete(filtered);
      },
    };
  }

  waitForEvent<T extends OrchestratorEvent['type']>(
    eventType: T,
    runId: string,
    timeoutMs: number,
  ): Promise<OrchestratorEvent & { type: T }> {
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        sub.unsubscribe();
        reject(new Error(`Timed out waiting for ${eventType} on run ${runId}`));
      }, timeoutMs);

      const sub = this.subscribeForRun(runId, (event) => {
        if (event.type === eventType) {
          clearTimeout(timer);
          sub.unsubscribe();
          resolve(event as OrchestratorEvent & { type: T });
        }
      });
    });
  }

  getHistory(runId?: string): OrchestratorEvent[] {
    if (!runId) return [...this.globalHistory];
    return this.globalHistory.filter(
      (e): e is OrchestratorEvent & { runId: string } =>
        'runId' in e && e.runId === runId,
    );
  }

  clearHistory(): void {
    this.globalHistory = [];
  }

  listenerCount(): number {
    return this.handlers.size;
  }
}
