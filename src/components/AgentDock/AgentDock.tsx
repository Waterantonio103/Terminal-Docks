import { useEffect, useMemo, useState } from 'react';
import { Bot, ChevronUp, X } from 'lucide-react';
import { useWorkspaceStore, type CompiledMission, type MissionAgent, type Pane } from '../../store/workspace';
import { useMissionSnapshot } from '../../hooks/useMissionSnapshot';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { deriveMissionProgressRows } from '../../lib/missionProgress';
import { FollowUpComposer } from '../MissionControl/MissionControlPane';
import { generateId } from '../../lib/graphUtils';

function missionIdForPane(pane: Pane): string | null {
  const missionId = pane.data?.missionId ?? pane.data?.mission?.missionId;
  return typeof missionId === 'string' && missionId.trim() ? missionId : null;
}

function findDockMission(tabs: ReturnType<typeof useWorkspaceStore.getState>['tabs'], activeTabId: string): Pane | null {
  const activeTab = tabs.find(tab => tab.id === activeTabId);
  const activeMissionPane = activeTab?.panes.find(pane => pane.type === 'missioncontrol' && missionIdForPane(pane));
  if (activeMissionPane) return activeMissionPane;

  for (const tab of tabs) {
    const missionPane = tab.panes.find(pane => pane.type === 'missioncontrol' && missionIdForPane(pane));
    if (missionPane) return missionPane;
  }

  return null;
}

export function AgentDock() {
  const tabs = useWorkspaceStore(state => state.tabs);
  const activeTabId = useWorkspaceStore(state => state.activeTabId);
  const workspaceDir = useWorkspaceStore(state => state.tabs.find(tab => tab.id === state.activeTabId)?.workspaceDir ?? state.workspaceDir);
  const setAppMode = useWorkspaceStore(state => state.setAppMode);
  const [collapsed, setCollapsed] = useState(false);
  const [hidden, setHidden] = useState(false);
  const pane = useMemo(() => findDockMission(tabs, activeTabId), [activeTabId, tabs]);
  const missionId = pane ? missionIdForPane(pane) : null;
  const mission = (pane?.data?.mission ?? null) as CompiledMission | null;
  const agents = (pane?.data?.agents ?? []) as MissionAgent[];
  const taskDescription = (pane?.data?.taskDescription as string | undefined) ?? mission?.task.prompt ?? 'Mission follow-up';
  const snapshot = useMissionSnapshot(missionId);
  const events = useWorkflowEvents(missionId, 200);
  const progressRows = useMemo(
    () => deriveMissionProgressRows({ mission, agents, snapshot, events }),
    [agents, events, mission, snapshot],
  );
  const paneIsOpenInWorkspace = pane?.data?.dockOnly === false;
  const dockReturnOpenAt = typeof pane?.data?.dockReturnOpenAt === 'number' ? pane.data.dockReturnOpenAt : null;

  useEffect(() => {
    if (!pane || pane.data?.dockOnly !== true || !dockReturnOpenAt) return;
    setCollapsed(false);
    setHidden(false);
  }, [dockReturnOpenAt, pane]);

  const createWorkspaceAgent = () => {
    const id = `adhoc-workspace-${generateId()}`;
    const paneId = generateId();
    useWorkspaceStore.setState(state => ({
      tabs: state.tabs.map(tab => tab.id === state.activeTabId
        ? {
            ...tab,
            panes: [
              ...tab.panes,
              {
                id: paneId,
                type: 'missioncontrol',
                title: 'Workspace Agent',
                gridPos: { x: 0, y: 0, w: 1, h: 1 },
                data: {
                  dockOnly: true,
                  missionId: id,
                  taskDescription: workspaceDir ? `Workspace agent: ${workspaceDir}` : 'Workspace agent',
                  agents: [],
                  followUpThreadId: `thread:${id}`,
                },
              },
            ],
          }
        : tab),
    }));
    setCollapsed(false);
    setHidden(false);
  };

  const openWorkspaceAgentTab = () => {
    if (!pane || !missionId) return;
    useWorkspaceStore.setState(state => {
      const sourceTab = state.tabs.find(tab => tab.panes.some(candidate => candidate.id === pane.id));
      const sourcePane = sourceTab?.panes.find(candidate => candidate.id === pane.id) ?? pane;
      const visiblePane: Pane = {
        ...sourcePane,
        title: 'Agent',
        gridPos: { x: 0, y: 0, w: 100, h: 100 },
        data: {
          ...sourcePane.data,
          dockOnly: false,
          dockExpandedToTab: true,
        },
      };
      return {
        tabs: state.tabs.map(tab => tab.id === (sourceTab?.id ?? state.activeTabId)
          ? {
              ...tab,
              panes: tab.panes.some(candidate => candidate.id === pane.id)
                ? tab.panes.map(candidate => candidate.id === pane.id ? visiblePane : candidate)
                : [...tab.panes, visiblePane],
            }
          : tab),
        activeTabId: sourceTab?.id ?? state.activeTabId,
        activePaneId: pane.id,
      };
    });
    setCollapsed(false);
    setHidden(true);
    setAppMode('workspace');
  };

  if (paneIsOpenInWorkspace) {
    return null;
  }

  if (!pane || !missionId) {
    if (hidden) {
      return (
        <button
          type="button"
          className="fixed bottom-4 right-4 z-[8500] flex h-10 items-center gap-2 rounded-full border border-border-panel bg-bg-panel px-3 text-xs text-text-secondary shadow-2xl hover:text-text-primary"
          onClick={() => setHidden(false)}
          title="Show agent dock"
        >
          <Bot size={15} />
          Agent
        </button>
      );
    }

    return (
      <div className="fixed bottom-4 right-4 z-[8500] flex items-center gap-1 rounded-full border border-border-panel bg-bg-panel px-2 py-1.5 shadow-2xl">
        <button
          type="button"
          className="flex items-center gap-2 rounded-full px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
          onClick={createWorkspaceAgent}
          title="Start workspace agent"
        >
          <Bot size={15} className="text-accent-primary" />
          <span className="max-w-[220px] truncate">Workspace agent</span>
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-bg-surface hover:text-text-primary"
          onClick={createWorkspaceAgent}
          title="Start workspace agent"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-bg-surface hover:text-text-primary"
          onClick={() => setHidden(true)}
          title="Hide agent dock"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  if (hidden) {
    return (
      <button
        type="button"
        className="fixed bottom-4 right-4 z-[8500] flex h-10 items-center gap-2 rounded-full border border-border-panel bg-bg-panel px-3 text-xs text-text-secondary shadow-2xl hover:text-text-primary"
        onClick={() => setHidden(false)}
        title="Show agent dock"
      >
        <Bot size={15} />
        Agent
      </button>
    );
  }

  if (collapsed) {
    return (
      <div className="fixed bottom-4 right-4 z-[8500] flex items-center gap-1 rounded-full border border-border-panel bg-bg-panel px-2 py-1.5 shadow-2xl">
        <button
          type="button"
          className="flex items-center gap-2 rounded-full px-2 py-1 text-xs text-text-secondary hover:text-text-primary"
          onClick={() => setCollapsed(false)}
          title="Expand agent dock"
        >
          <Bot size={15} />
          <span className="max-w-[220px] truncate">{taskDescription}</span>
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-bg-surface hover:text-text-primary"
          onClick={() => setCollapsed(false)}
          title="Expand agent dock"
        >
          <ChevronUp size={14} />
        </button>
        <button
          type="button"
          className="flex h-6 w-6 items-center justify-center rounded-full text-text-muted hover:bg-bg-surface hover:text-text-primary"
          onClick={() => setHidden(true)}
          title="Hide agent dock"
        >
          <X size={13} />
        </button>
      </div>
    );
  }

  return (
    <div className="fixed bottom-4 right-4 z-[8500]">
      <FollowUpComposer
        pane={pane}
        mission={mission}
        missionId={missionId}
        taskDescription={taskDescription}
        progressRows={progressRows}
        placement="global"
        workspaceDir={workspaceDir}
        onOpenWorkspace={() => setAppMode('workspace')}
        onOpenInTab={openWorkspaceAgentTab}
        onCollapse={() => setCollapsed(true)}
        onHide={() => setHidden(true)}
      />
    </div>
  );
}

export default AgentDock;
