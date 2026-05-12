/**
 * useRuntimeSessions — React hook for the RuntimeObserver.
 *
 * Provides live runtime session data to React components.
 * Automatically subscribes on mount and unsubscribes on unmount.
 *
 * Also enriches session data with graph node metadata from the
 * workspace store (position, role label, CLI config).
 *
 * Phase 9 — Wave 3 / Agent D
 */

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import {
  runtimeObserver,
  type LiveRuntimeSession,
} from './RuntimeObserver';
import { useWorkspaceStore } from '../../store/workspace';

export type { LiveRuntimeSession } from './RuntimeObserver';

const EMPTY_GRAPH = { nodes: [] };

export interface EnrichedRuntimeSession extends LiveRuntimeSession {
  position?: { x: number; y: number };
  cliConfig?: string;
}

export function useRuntimeSessions(): EnrichedRuntimeSession[] {
  const [sessions, setSessions] = useState<LiveRuntimeSession[]>(() =>
    runtimeObserver.getSessions(),
  );
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    const unsubscribe = runtimeObserver.subscribe((updated) => {
      if (mountedRef.current) {
        setSessions(updated);
      }
    });
    return () => {
      mountedRef.current = false;
      unsubscribe();
    };
  }, []);

  const globalGraph = useWorkspaceStore((s) => s.globalGraph ?? EMPTY_GRAPH);

  const enriched = useMemo(() => {
    const nodeMap = new Map((globalGraph.nodes ?? []).map((n) => [n.id, n]));

    return sessions.map((session) => {
      const node = nodeMap.get(session.nodeId);
      return {
        ...session,
        position: node?.config?.position,
        cliConfig: node?.config?.cli,
        title: node?.config?.terminalTitle || session.title,
      } satisfies EnrichedRuntimeSession;
    });
  }, [sessions, globalGraph.nodes]);

  return enriched;
}

export function useRuntimeObserver(): {
  focusRuntime: (session: EnrichedRuntimeSession) => void;
  stopRuntime: (session: EnrichedRuntimeSession) => void;
  retryRuntime: (session: EnrichedRuntimeSession) => void;
  resolvePermission: (sessionId: string, permissionId: string, decision: 'approve' | 'deny') => Promise<void>;
  resumeNode: (missionId: string, nodeId: string) => Promise<void>;
  forceCompleteNode: (missionId: string, nodeId: string, outcome: 'success' | 'failure', summary: string) => Promise<void>;
  forceFailNode: (missionId: string, nodeId: string, error: string) => Promise<void>;
} {
  const emit = useCallback(async (event: string, payload: unknown) => {
    try {
      const { emit: tauriEmit } = await import('@tauri-apps/api/event');
      await tauriEmit(event, payload);
    } catch {}
  }, []);

  const focusRuntime = useCallback(
    (session: EnrichedRuntimeSession) => {
      if (!session.terminalId) return;
      emit('focus-terminal', { terminalId: session.terminalId });
    },
    [emit],
  );

  const stopRuntime = useCallback(
    (session: EnrichedRuntimeSession) => {
      if (!session.terminalId) return;
      invoke('destroy_pty', { id: session.terminalId }).catch(() => {});
    },
    [],
  );

  const retryRuntime = useCallback(
    async (session: EnrichedRuntimeSession) => {
      if (session.missionId && session.nodeId) {
        const { missionOrchestrator } = await import('../../lib/workflow/MissionOrchestrator');
        await missionOrchestrator.retryNode(session.missionId, session.nodeId);
        return;
      }
      await emit('workflow-runtime-retry-requested', {
        nodeId: session.nodeId,
        terminalId: session.terminalId || null,
        runtimeSessionId: session.sessionId || null,
      });
    },
    [emit],
  );

  const resolvePermission = useCallback(
    async (sessionId: string, permissionId: string, decision: 'approve' | 'deny') => {
      const { runtimeManager } = await import('../../lib/runtime/RuntimeManager');
      await runtimeManager.resolvePermission({ sessionId, permissionId, decision });
    },
    [],
  );

  const resumeNode = useCallback(
    async (missionId: string, nodeId: string) => {
      const { missionOrchestrator } = await import('../../lib/workflow/MissionOrchestrator');
      await missionOrchestrator.resumeNode(missionId, nodeId);
    },
    [],
  );

  const forceCompleteNode = useCallback(
    async (missionId: string, nodeId: string, outcome: 'success' | 'failure', summary: string) => {
      const { missionOrchestrator } = await import('../../lib/workflow/MissionOrchestrator');
      await missionOrchestrator.forceCompleteNode(missionId, nodeId, outcome, summary);
    },
    [],
  );

  const forceFailNode = useCallback(
    async (missionId: string, nodeId: string, error: string) => {
      const { missionOrchestrator } = await import('../../lib/workflow/MissionOrchestrator');
      await missionOrchestrator.forceFailNode(missionId, nodeId, error);
    },
    [],
  );

  return { 
    focusRuntime, 
    stopRuntime, 
    retryRuntime, 
    resolvePermission, 
    resumeNode, 
    forceCompleteNode, 
    forceFailNode 
  };
}
