import { useEffect, useMemo, useState } from 'react';
import { useWorkspaceStore, type CompiledMission, type MissionAgent, type Pane } from '../../store/workspace';
import { useMissionSnapshot } from '../../hooks/useMissionSnapshot';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { deriveMissionProgressRows } from '../../lib/missionProgress';
import { FollowUpComposer } from '../MissionControl/MissionControlPane';
import { generateId } from '../../lib/graphUtils';
import { getPublicRoleForWorkflowRole } from '../../config/agentRoles';

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

function CometAgentLogo({ className = '' }: { className?: string }) {
  return <img className={`td-agent-footer-logo ${className}`} src="/comet-ai-logo.svg" alt="" aria-hidden="true" draggable={false} />;
}

function roleTitleForPane(pane: Pane | null): string {
  const roleId = typeof pane?.data?.followUpAgentRoleId === 'string'
    ? pane.data.followUpAgentRoleId
    : typeof pane?.data?.agentRoleId === 'string'
      ? pane.data.agentRoleId
      : 'code';
  return getPublicRoleForWorkflowRole(roleId).name;
}

function AgentFooterCompartment({
  label,
  title,
  onOpen,
}: {
  label: string;
  title: string;
  onOpen: () => void;
}) {
  return (
    <div className="td-agent-footer-compartment" role="group" aria-label="Agent dock">
      <button
        type="button"
        className="td-agent-footer-main"
        onClick={onOpen}
        title={title}
      >
        <CometAgentLogo />
        <span>{label}</span>
      </button>
    </div>
  );
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
                  workspaceDir,
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
      const roleTitle = roleTitleForPane(sourcePane);
      const sourcePaneWorkspaceDir = typeof sourcePane.data?.workspaceDir === 'string' && sourcePane.data.workspaceDir.trim()
        ? sourcePane.data.workspaceDir
        : null;
      const sourceWorkspaceDir = sourceTab?.workspaceDir ?? state.workspaceDir ?? workspaceDir ?? sourcePaneWorkspaceDir;
      const visiblePane: Pane = {
        ...sourcePane,
        title: roleTitle,
        gridPos: { x: 0, y: 0, w: 100, h: 100 },
        data: {
          ...sourcePane.data,
          dockOnly: false,
          dockExpandedToTab: true,
          workspaceDir: sourceWorkspaceDir,
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
        <AgentFooterCompartment
          label="Agent"
          title="Show agent dock"
          onOpen={() => setHidden(false)}
        />
      );
    }

    return (
      <AgentFooterCompartment
        label="Workspace agent"
        title="Start workspace agent"
        onOpen={createWorkspaceAgent}
      />
    );
  }

  if (hidden) {
    return (
      <AgentFooterCompartment
        label="Agent"
        title="Show agent dock"
        onOpen={() => setHidden(false)}
      />
    );
  }

  if (collapsed) {
    return (
      <AgentFooterCompartment
        label={taskDescription}
        title="Expand agent dock"
        onOpen={() => setCollapsed(false)}
      />
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
