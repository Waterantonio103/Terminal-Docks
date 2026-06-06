import { useCallback, useEffect, useMemo, useState } from 'react';
import { listen } from '@tauri-apps/api/event';
import { missionRepository } from '../../lib/missionRepository.js';
import type { RuntimeManager } from '../../lib/runtime/RuntimeManager.js';
import type { RuntimeManagerEvent } from '../../lib/runtime/RuntimeTypes.js';
import type { WorkflowOrchestrator } from '../../lib/workflow/WorkflowOrchestrator.js';
import { isMcpMessageType } from '../../lib/mcpMessages.js';
import {
  countNeedsYou,
  deriveActionCenterItems,
  normalizeActionCenterInboxItems,
  type ActionCenterInboxInput,
  type ActionCenterItem,
  type ActionCenterRecentInput,
  type ActionCenterRuntimeSessionInput,
} from '../../lib/actionCenter/index.js';

const MAX_RECENT_EVENTS = 50;

function titleForRuntimeEvent(
  event: RuntimeManagerEvent,
  runtimeManager: RuntimeManager,
  workflowOrchestrator: WorkflowOrchestrator,
): string | null {
  const completedLabel = runtimeAgentProgressLabel(event, runtimeManager, workflowOrchestrator);
  switch (event.type) {
    case 'permission_resolved':
      return null;
    case 'session_completed':
      return `${completedLabel} ${event.outcome === 'success' ? 'completed' : 'failed'}`;
    case 'session_failed':
      return 'Runtime failed';
    case 'session_disconnected':
      return 'Runtime disconnected';
    default:
      return null;
  }
}

function runtimeAgentProgressLabel(
  event: RuntimeManagerEvent,
  runtimeManager: RuntimeManager,
  workflowOrchestrator: WorkflowOrchestrator,
): string {
  if (!('sessionId' in event)) return 'Runtime';
  const snapshot = runtimeManager.snapshot();
  const session = snapshot.sessions.find(candidate => candidate.sessionId === event.sessionId);
  const missionId = session?.missionId;
  const nodeId = event.nodeId;
  const run = missionId ? workflowOrchestrator.getRun(missionId) : undefined;
  const nodeDefinition = run?.definition.nodes.find(node => node.id === nodeId);
  const agentName = nodeDefinition?.config?.label || nodeDefinition?.roleId || session?.role || nodeId || 'Runtime';
  const agentNodes = run?.definition.nodes.filter(node => node.kind === 'agent') ?? [];
  const index = agentNodes.findIndex(node => node.id === nodeId);
  const position = index >= 0 && agentNodes.length > 0 ? ` (${index + 1}/${agentNodes.length})` : '';
  return `${agentName}${position}`;
}

function runtimeRecentEvent(
  event: RuntimeManagerEvent,
  runtimeManager: RuntimeManager,
  workflowOrchestrator: WorkflowOrchestrator,
): ActionCenterRecentInput | null {
  const title = titleForRuntimeEvent(event, runtimeManager, workflowOrchestrator);
  if (!title) return null;
  const session = 'sessionId' in event
    ? runtimeManager.snapshot().sessions.find(candidate => candidate.sessionId === event.sessionId)
    : undefined;

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
    missionId: session?.missionId,
  };
}

function snapshotSessions(runtimeManager: RuntimeManager): ActionCenterRuntimeSessionInput[] {
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
  const [sessions, setSessions] = useState<ActionCenterRuntimeSessionInput[]>([]);
  const [inboxItems, setInboxItems] = useState<ActionCenterInboxInput[]>([]);
  const [recentEvents, setRecentEvents] = useState<ActionCenterRecentInput[]>([]);
  const [loadingInbox, setLoadingInbox] = useState(false);

  const refreshInbox = useCallback(async () => {
    try {
      setLoadingInbox(true);
      const result = await missionRepository.invokeMcp('list_inbox', {});
      setInboxItems(normalizeActionCenterInboxItems(JSON.parse(result)));
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
    listen<unknown>('mcp-message', (event) => {
      if (isMcpMessageType(event.payload, 'inbox_update')) {
        refreshInbox();
      }
    }).then((unlisten) => {
      if (cancelled) {
        unlisten();
      } else {
        unlistenInbox = unlisten;
      }
    }).catch(() => {});

    let cleanupManagers: (() => void) | undefined;
    Promise.all([
      import('../../lib/runtime/RuntimeManager.js'),
      import('../../lib/workflow/WorkflowOrchestrator.js'),
    ]).then(([runtimeManagerModule, workflowOrchestratorModule]) => {
      const runtimeManager = runtimeManagerModule.runtimeManager;
      const workflowOrchestrator = workflowOrchestratorModule.workflowOrchestrator;
      if (cancelled) return;
      setSessions(snapshotSessions(runtimeManager));
      const unlistenRuntime = runtimeManager.subscribe((event) => {
        const recent = runtimeRecentEvent(event, runtimeManager, workflowOrchestrator);
        if (!recent) return;
        setRecentEvents(prev => [recent, ...prev].slice(0, MAX_RECENT_EVENTS));
      });
      const unlistenWorkflow = workflowOrchestrator.subscribe((event) => {
        if (event.type !== 'run_completed') return;
        const recent: ActionCenterRecentInput = {
          id: `workflow-completed:${event.runId}:${Date.now()}`,
          source: 'workflow',
          eventType: 'run_completed',
          title: 'Workflow completed',
          detail: `Mission ${event.runId.slice(0, 8)} finished with ${event.outcome}.`,
          createdAt: Date.now(),
          severity: event.outcome === 'success' ? 'success' : 'warning',
          missionId: event.runId,
        };
        setRecentEvents(prev => [recent, ...prev].slice(0, MAX_RECENT_EVENTS));
      });
      const unlistenSnapshot = runtimeManager.subscribeSnapshot(() => {
        setSessions(snapshotSessions(runtimeManager));
      });
      cleanupManagers = () => {
        unlistenRuntime();
        unlistenWorkflow.unsubscribe();
        unlistenSnapshot();
      };
    }).catch((error) => {
      console.error('Failed to initialize action center runtime subscriptions', error);
    });

    return () => {
      cancelled = true;
      if (unlistenInbox) unlistenInbox();
      cleanupManagers?.();
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
