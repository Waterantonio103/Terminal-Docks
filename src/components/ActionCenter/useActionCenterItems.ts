import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { missionRepository } from '../../lib/missionRepository.js';
import { runtimeManager } from '../../lib/runtime/RuntimeManager.js';
import type { RuntimeManagerEvent } from '../../lib/runtime/RuntimeTypes.js';
import {
  countNeedsYou,
  deriveActionCenterItems,
  type ActionCenterInboxInput,
  type ActionCenterItem,
  type ActionCenterRecentInput,
  type ActionCenterRuntimeSessionInput,
} from '../../lib/actionCenter/index.js';

const MAX_RECENT_EVENTS = 50;

function titleForRuntimeEvent(event: RuntimeManagerEvent): string | null {
  switch (event.type) {
    case 'permission_resolved':
      return `Permission ${event.decision === 'approve' ? 'approved' : 'denied'}`;
    case 'session_completed':
      return `Runtime ${event.outcome === 'success' ? 'completed' : 'failed'}`;
    case 'session_failed':
      return 'Runtime failed';
    case 'session_disconnected':
      return 'Runtime disconnected';
    default:
      return null;
  }
}

function runtimeRecentEvent(event: RuntimeManagerEvent): ActionCenterRecentInput | null {
  const title = titleForRuntimeEvent(event);
  if (!title) return null;

  return {
    id: `${event.type}:${event.sessionId}:${Date.now()}`,
    source: 'runtime',
    eventType: event.type,
    title,
    detail: event.type === 'session_failed'
      ? event.error
      : event.type === 'session_disconnected'
        ? event.reason
        : undefined,
    createdAt: Date.now(),
    severity: event.type === 'session_failed' || event.type === 'session_disconnected' ? 'critical' : 'success',
    sessionId: event.sessionId,
    nodeId: event.nodeId,
  };
}

function snapshotSessions(): ActionCenterRuntimeSessionInput[] {
  return runtimeManager.snapshot().sessions.map(session => ({
    nodeId: session.nodeId,
    terminalId: session.terminalId,
    sessionId: session.sessionId,
    missionId: session.missionId,
    cli: session.cliId,
    roleId: session.role,
    title: `${session.role || 'Agent'} - ${session.nodeId}`,
    status: session.state,
    currentAction: session.state === 'waiting_auth'
      ? 'Authentication Required'
      : session.activePermission ? 'Awaiting Permission' : session.lastError,
    startedAt: session.createdAt,
    lastActivityAt: session.lastHeartbeatAt ?? session.createdAt,
    activePermission: session.activePermission ? {
      permissionId: session.activePermission.permissionId,
      category: session.activePermission.category,
      rawPrompt: session.activePermission.rawPrompt,
      detail: session.activePermission.detail,
      detectedAt: session.activePermission.detectedAt,
      sessionId: session.activePermission.sessionId,
      nodeId: session.activePermission.nodeId,
    } : undefined,
  }));
}

export function useActionCenterItems(): {
  items: ActionCenterItem[];
  needsYouCount: number;
  loadingInbox: boolean;
  refreshInbox: () => Promise<void>;
  clearRecent: (id: string) => void;
  clearAllRecent: () => void;
  sessions: ActionCenterRuntimeSessionInput[];
} {
  const [sessions, setSessions] = useState<ActionCenterRuntimeSessionInput[]>(() => snapshotSessions());
  const [inboxItems, setInboxItems] = useState<ActionCenterInboxInput[]>([]);
  const [recentEvents, setRecentEvents] = useState<ActionCenterRecentInput[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);

  const refreshInbox = useCallback(async () => {
    try {
      setLoadingInbox(true);
      const result = await missionRepository.invokeMcp('list_inbox', {});
      const parsed = JSON.parse(result) as ActionCenterInboxInput[];
      setInboxItems(Array.isArray(parsed) ? parsed : []);
    } catch (error) {
      console.error('Failed to fetch action center inbox', error);
    } finally {
      setLoadingInbox(false);
    }
  }, []);

  useEffect(() => {
    refreshInbox();

    let cancelled = false;
    let unlistenInbox: (() => void) | undefined;
    listen('mcp-message', (event: any) => {
      if (event.payload?.type === 'inbox_update') {
        refreshInbox();
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenInbox = unlisten;
      }
    }).catch(() => {});

    const unlistenRuntime = runtimeManager.subscribe((event) => {
      const recent = runtimeRecentEvent(event);
      if (!recent) return;
      setRecentEvents(prev => [recent, ...prev].slice(0, MAX_RECENT_EVENTS));
    });
    const unlistenSnapshot = runtimeManager.subscribeSnapshot(() => {
      setSessions(snapshotSessions());
    });

    return () => {
      cancelled = true;
      if (unlistenInbox) unlistenInbox();
      unlistenRuntime();
      unlistenSnapshot();
    };
  }, [refreshInbox]);

  const clearRecent = useCallback((id: string) => {
    setRecentEvents(prev => prev.filter(event => `recent:${event.source}:${event.id}` !== id));
  }, []);

  const clearAllRecent = useCallback(() => {
    setRecentEvents([]);
  }, []);

  const items = useMemo(
    () => deriveActionCenterItems({ sessions, inboxItems, recentEvents }),
    [sessions, inboxItems, recentEvents],
  );

  return {
    items,
    needsYouCount: countNeedsYou(items),
    loadingInbox,
    refreshInbox,
    clearRecent,
    clearAllRecent,
    sessions,
  };
}
