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

  const globalGraph = useWorkspaceStore((s) => s.globalGraph);

  const enriched = useMemo(() => {
    const nodeMap = new Map(globalGraph.nodes.map((n) => [n.id, n]));

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
    (session: EnrichedRuntimeSession) => {
      emit('workflow-runtime-retry-requested', {
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

  return { focusRuntime, stopRuntime, retryRuntime, resolvePermission };
}
