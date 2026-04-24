import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../lib/graphUtils.js';

export function arrayMove<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  const newArray = [...array];
  const [item] = newArray.splice(fromIndex, 1);
  newArray.splice(toIndex, 0, item);
  return newArray;
}

export type PaneType = 'terminal' | 'editor' | 'taskboard' | 'activityfeed' | 'launcher' | 'missioncontrol' | 'nodetree';
export type WorkflowNodeStatus =
  | 'idle'
  | 'unbound'
  | 'bound'
  | 'launching'
  | 'connecting'
  | 'spawning'
  | 'terminal_started'
  | 'adapter_starting'
  | 'mcp_connecting'
  | 'registered'
  | 'ready'
  | 'activation_pending'
  | 'activation_acked'
  | 'activated'
  | 'running'
  | 'handoff_pending'
  | 'waiting'
  | 'done'
  | 'completed'
  | 'failed'
  | 'disconnected';
export type WorkflowMode = 'build' | 'edit';
export type WorkflowEdgeCondition = 'always' | 'on_success' | 'on_failure';
export type WorkflowAgentCli = 'claude' | 'gemini' | 'opencode' | 'codex' | 'custom' | 'ollama' | 'lmstudio';
export type WorkflowExecutionMode = 'headless' | 'streaming_headless' | 'interactive_pty';
export type WorkflowAuthoringMode = 'preset' | 'graph' | 'adaptive';
export type WorkerCapabilityId = 'planning' | 'coding' | 'testing' | 'review' | 'security' | 'repo_analysis' | 'shell_execution';

export interface WorkerCapability {
  id: WorkerCapabilityId;
  level?: 0 | 1 | 2 | 3;
  verifiedBy?: 'profile' | 'runtime';
}

export interface TaskRequirements {
  requiredCapabilities?: WorkerCapabilityId[];
  preferredCapabilities?: WorkerCapabilityId[];
  fileScope?: string[];
  workingDir?: string;
  writeAccess?: boolean;
  parallelSafe?: boolean;
}

export interface WorkflowNode {
  id: string;
  roleId: string;
  status: WorkflowNodeStatus;
  mcpState?: 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED';
  config?: {
    prompt?: string;
    mode?: WorkflowMode;
    workspaceDir?: string;
    instructionOverride?: string;
    terminalId?: string;
    terminalTitle?: string;
    paneId?: string;
    cli?: WorkflowAgentCli;
    executionMode?: WorkflowExecutionMode;
    autoLinked?: boolean;
    authoringMode?: WorkflowAuthoringMode;
    presetId?: string | null;
    runVersion?: number;
    adaptiveSeed?: boolean;
    profileId?: string;
    capabilities?: WorkerCapability[];
    requirements?: TaskRequirements;
    parentId?: string;
    extent?: 'parent';
    width?: number;
    height?: number;
    label?: string;
    position?: { x: number; y: number };
  };
}

export interface WorkflowEdge {
  fromNodeId: string;
  toNodeId: string;
  condition?: WorkflowEdgeCondition;
}

export interface WorkflowGraph {
  id: string;
  nodes: WorkflowNode[];
  edges: WorkflowEdge[];
}

export interface CompiledMissionTaskContext {
  nodeId: string;
  prompt: string;
  mode: WorkflowMode;
  workspaceDir: string | null;
}

export interface CompiledMissionTerminalBinding {
  terminalId: string;
  terminalTitle: string;
  cli: WorkflowAgentCli;
  executionMode: WorkflowExecutionMode;
  paneId?: string;
  reusedExisting: boolean;
}

export interface CompiledMissionNode {
  id: string;
  roleId: string;
  profileId?: string;
  instructionOverride: string;
  capabilities?: WorkerCapability[];
  requirements?: TaskRequirements;
  terminal: CompiledMissionTerminalBinding;
}

export interface CompiledMissionEdge {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  condition: WorkflowEdgeCondition;
}

export interface CompiledMissionMetadata {
  compiledAt: number;
  sourceGraphId: string;
  startNodeIds: string[];
  executionLayers: string[][];
  authoringMode?: WorkflowAuthoringMode;
  presetId?: string | null;
  runVersion?: number;
}

export interface CompiledMission {
  missionId: string;
  graphId: string;
  task: CompiledMissionTaskContext;
  metadata: CompiledMissionMetadata;
  nodes: CompiledMissionNode[];
  edges: CompiledMissionEdge[];
}

export interface MissionArtifact {
  id: string;
  type: 'file_change' | 'summary' | 'reference';
  label: string;
  content?: string;
  path?: string;
  timestamp: number;
}

export interface MissionAttemptRecord {
  attempt: number;
  status: WorkflowNodeStatus;
  startedAt?: number;
  completedAt?: number;
  outcome?: 'success' | 'failure';
  payloadPreview?: string | null;
  artifacts?: MissionArtifact[];
}

export interface MissionAgent {
  terminalId: string;
  title: string;
  roleId: string;
  paneId?: string;
  status?: WorkflowNodeStatus;
  triggered?: boolean;
  attempt?: number;
  startedAt?: number;
  completedAt?: number;
  lastOutcome?: 'success' | 'failure';
  lastPayload?: string | null;
  lastError?: string | null;
  attemptHistory?: MissionAttemptRecord[];
  nodeId?: string;
  cli?: WorkflowAgentCli; // Added to track intended CLI in MissionControl
  runtimeSessionId?: string | null;
  runtimeCli?: WorkflowAgentCli | null;
  executionMode?: WorkflowExecutionMode | null;
  activeRunId?: string | null;
  runtimeBootstrapState?: 'NOT_CONNECTED' | 'CONNECTING' | 'CONNECTED' | 'registered' | 'failed' | WorkflowNodeStatus;
  runtimeBootstrapReason?: string | null;
  runtimeRegisteredAt?: number;
  runtimeLastHeartbeatAt?: number;
  artifacts?: MissionArtifact[];
  runtimeLogs?: string[]; // Added for activation pipeline debugging
}

export interface NodeRuntimeBinding {
  terminalId?: string;
  runtimeSessionId?: string | null;
  adapterStatus?: WorkflowNodeStatus | null;
  updatedAt?: number;
}

export type ThemeType =
  // Original themes
  | 'dark' | 'light' | 'nord' | 'dracula' | 'cyberpunk' | 'ocean' | 'solarized'
  // Spec dark themes
  | 'void' | 'ghost' | 'plasma' | 'carbon' | 'hex' | 'neon-tokyo' | 'obsidian'
  | 'nebula' | 'storm' | 'infrared' | 'nova' | 'stealth' | 'hologram' | 'bridgemind'
  | 'synthwave' | 'cybernetics' | 'quantum' | 'mecha' | 'abyss'
  // Spec light themes
  | 'paper' | 'chalk' | 'solar' | 'arctic' | 'ivory';

export interface GridPos {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Pane {
  id: string;
  type: PaneType;
  title: string;
  gridPos: GridPos;
  data?: {
    terminalId?: string;
    cli?: WorkflowAgentCli;
    cliSource?: 'connect_agent' | 'stdout' | 'heuristic';
    cliConfidence?: 'low' | 'medium' | 'high';
    cliUpdatedAt?: number;
    roleId?: string;
    filePath?: string;
    initialCommand?: string;
    customCliCommand?: string;
    customCliArgs?: string[];
    customCliEnv?: Record<string, string>;
    customCliMcpHint?: string;
    [key: string]: any;
  };
}

export function resolveCollisions(panes: Pane[], anchorId?: string): Pane[] {
  // If there's an anchor, it gets priority and stays fixed
  const anchor = anchorId ? panes.find(p => p.id === anchorId) : null;
  const others = anchorId ? panes.filter(p => p.id !== anchorId) : panes;

  // Sort others by Y then X
  const sortedOthers = [...others].sort((a, b) => {
    if (a.gridPos.y !== b.gridPos.y) return a.gridPos.y - b.gridPos.y;
    return a.gridPos.x - b.gridPos.x;
  });

  const resolved: Pane[] = [];
  if (anchor) resolved.push(anchor);

  for (const pane of sortedOthers) {
    let currentPos = { ...pane.gridPos };
    let hasCollision = true;

    while (hasCollision) {
      hasCollision = false;
      for (const other of resolved) {
        // Check overlap
        const overlapX = currentPos.x < other.gridPos.x + other.gridPos.w && currentPos.x + currentPos.w > other.gridPos.x;
        const overlapY = currentPos.y < other.gridPos.y + other.gridPos.h && currentPos.y + currentPos.h > other.gridPos.y;

        if (overlapX && overlapY) {
          currentPos.y = other.gridPos.y + other.gridPos.h;
          hasCollision = true;
          // After moving Y, we need to re-check all resolved panes
          break;
        }
      }
    }
    resolved.push({ ...pane, gridPos: currentPos });
  }

  // Final sort to keep consistency in the array if needed, though id-based mapping is usually used
  return resolved;
}

export interface WorkspaceTab {
  id: string;
  name: string;
  color: string;
  panes: Pane[];
}

export interface SavedLayout {
  id: string;
  name: string;
  createdAt: number;
  panes: Array<{ type: PaneType; title: string; data?: any }>;
}

export const TAB_COLORS = [
  '#7059f5', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
  '#ec4899', '#14b8a6',
];

export function selectActivePanes(state: WorkspaceState): Pane[] {
  return state.tabs.find(t => t.id === state.activeTabId)?.panes ?? [];
}

function withActivePanes(
  state: WorkspaceState,
  updater: (panes: Pane[]) => Pane[]
): Pick<WorkspaceState, 'tabs'> {
  return {
    tabs: state.tabs.map(t =>
      t.id === state.activeTabId ? { ...t, panes: updater(t.panes) } : t
    ),
  };
}

export interface ResultEntry {
  id: number;
  agentId: string;
  content: string;
  type: 'markdown' | 'url';
  timestamp: number;
}

export interface McpMessage {
  id: number;
  from: string;
  content: string;
  type: string;
  timestamp: number;
}

export interface DbTask {
  id: number;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  parent_id: number | null;
  agent_id: string | null;
  from_role: string | null;
  target_role: string | null;
  payload: string | null;
}

export type SidebarTabType = 'files' | 'tasks' | 'swarm' | 'agents' | 'nodetree' | 'settings';

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  sidebarOpen: boolean;
  activeSidebarTab: SidebarTabType;
  workspaceDir: string | null;
  theme: ThemeType;
  savedLayouts: SavedLayout[];
  messages: McpMessage[];
  results: ResultEntry[];
  tasks: DbTask[];
  agentInstructions: Record<string, string>;
  globalGraph: WorkflowGraph;
  nodeTerminalBindings: Record<string, string>;
  nodeRuntimeBindings: Record<string, NodeRuntimeBinding>;
  toggleSidebar: () => void;
  setActiveSidebarTab: (tab: SidebarTabType) => void;
  setGlobalGraph: (graph: WorkflowGraph) => void;
  addPane: (type: PaneType, title: string, data?: any) => void;
  addPaneAt: (type: PaneType, title: string, index: number, data?: any) => void;
  removePane: (id: string) => void;
  movePane: (activeId: string, overId: string) => void;
  updatePaneData: (id: string, data: Partial<NonNullable<Pane['data']>>) => void;
  updatePaneDataByTerminalId: (terminalId: string, data: Partial<NonNullable<Pane['data']>>) => void;
  renamePane: (id: string, title: string) => void;
  resizePane: (id: string, w: number, h: number) => void;
  updatePaneLayout: (id: string, gridPos: Partial<GridPos>) => void;
  createMissionTab: (taskDescription: string, agents: MissionAgent[]) => void;
  clearPanes: () => void;
  setWorkspaceDir: (dir: string | null) => void;
  setTheme: (theme: ThemeType) => void;
  saveLayout: (name: string) => void;
  loadLayout: (id: string) => void;
  deleteLayout: (id: string) => void;
  addTab: () => void;
  removeTab: (id: string) => void;
  switchTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
  addMessage: (msg: McpMessage) => void;
  addResult: (result: ResultEntry) => void;
  setTasks: (tasks: DbTask[]) => void;
  setAgentInstruction: (id: string, value: string) => void;
  setNodeTerminalBinding: (nodeId: string, terminalId: string) => void;
  setNodeRuntimeBinding: (nodeId: string, binding: NodeRuntimeBinding) => void;
  removeNodeTerminalBinding: (nodeId: string) => void;
  addMissionArtifact: (missionId: string, nodeId: string, artifact: MissionArtifact) => void;
}

const _initTabId = generateId();

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      tabs: [{
        id: _initTabId,
        name: 'Workspace 1',
        color: TAB_COLORS[0],
        panes: [
          { id: generateId(), type: 'terminal', title: 'Terminal 1', gridPos: { x: 0, y: 0, w: 12, h: 18 }, data: { terminalId: generateId() } },
          { id: generateId(), type: 'editor', title: 'Welcome', gridPos: { x: 12, y: 0, w: 12, h: 18 } },
        ],
      }],
      activeTabId: _initTabId,
      sidebarOpen: true,
      activeSidebarTab: 'files',
      workspaceDir: null,
      theme: 'dark',
      savedLayouts: [],
      messages: [],
      results: [],
      tasks: [],
      agentInstructions: {},
      globalGraph: { id: 'global-editor', nodes: [], edges: [] },
      nodeTerminalBindings: {},
      nodeRuntimeBindings: {},

      setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
      setGlobalGraph: (graph) => set({ globalGraph: graph }),

      addMessage: (msg) => set((s) => ({ messages: [...s.messages, msg].slice(-500) })),
      addResult: (result) => set((s) => ({ results: [...s.results, result].slice(-200) })),
      setTasks: (tasks) => set({ tasks }),
      setAgentInstruction: (id, value) => set((s) => ({ agentInstructions: { ...s.agentInstructions, [id]: value } })),
      setNodeTerminalBinding: (nodeId, terminalId) => set((s) => ({
        nodeTerminalBindings: { ...s.nodeTerminalBindings, [nodeId]: terminalId },
        nodeRuntimeBindings: {
          ...s.nodeRuntimeBindings,
          [nodeId]: {
            ...(s.nodeRuntimeBindings[nodeId] ?? {}),
            terminalId,
            updatedAt: Date.now(),
          },
        },
      })),
      setNodeRuntimeBinding: (nodeId, binding) => set((s) => ({
        nodeRuntimeBindings: {
          ...s.nodeRuntimeBindings,
          [nodeId]: {
            ...(s.nodeRuntimeBindings[nodeId] ?? {}),
            ...binding,
            updatedAt: Date.now(),
          },
        },
        nodeTerminalBindings: binding.terminalId
          ? { ...s.nodeTerminalBindings, [nodeId]: binding.terminalId }
          : s.nodeTerminalBindings,
      })),
      removeNodeTerminalBinding: (nodeId) => set((s) => {
        const bindings = { ...s.nodeTerminalBindings };
        const runtimeBindings = { ...s.nodeRuntimeBindings };
        delete bindings[nodeId];
        delete runtimeBindings[nodeId];
        return { nodeTerminalBindings: bindings, nodeRuntimeBindings: runtimeBindings };
      }),
      addMissionArtifact: (_missionId, nodeId, artifact) => set((state) => ({
        tabs: state.tabs.map(tab => ({
          ...tab,
          panes: tab.panes.map(pane => {
            if (pane.type !== 'missioncontrol') return pane;
            const agents = (pane.data?.agents as MissionAgent[] | undefined) ?? [];
            const updatedAgents = agents.map(agent => {
              if (agent.nodeId !== nodeId) return agent;
              const exists = agent.artifacts?.some(a => a.id === artifact.id);
              if (exists) return agent;
              return {
                ...agent,
                artifacts: [...(agent.artifacts ?? []), artifact],
              };
            });
            return {
              ...pane,
              data: { ...pane.data, agents: updatedAgents },
            };
          }),
        })),
      })),

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      addPane: (type, title, data) => set((state) => {
        const panes = selectActivePanes(state);
        
        // Singleton logic for specific pane types
        if (type === 'missioncontrol') {
          const existing = panes.find(p => p.type === 'missioncontrol');
          if (existing) {
            return {
              ...withActivePanes(state, ps => 
                ps.map(p => p.id === existing.id ? { ...p, data: { ...p.data, ...data } } : p)
              ),
              messages: [],
              results: [],
              tasks: [],
            };
          }
        }

        if (data?.filePath && panes.find(p => p.data?.filePath === data.filePath)) return state;
        const newData = data ? { ...data } : {};
        if (type === 'terminal' && !newData.terminalId) newData.terminalId = generateId();
        
        // Find next Y position
        const maxY = panes.reduce((max, p) => Math.max(max, p.gridPos.y + p.gridPos.h), 0);

        const gridPos = newData.gridPos || { x: 0, y: maxY, w: 8, h: 12 };
        delete newData.gridPos;

        const newPane: Pane = { 
          id: generateId(), 
          type, 
          title, 
          gridPos,
          data: newData 
        };
        
        const nextState = withActivePanes(state, ps => resolveCollisions([...ps, newPane]));
        
        // If we just added a new mission control pane (not just updated an existing one)
        if (type === 'missioncontrol') {
          return { ...nextState, messages: [], results: [], tasks: [] };
        }
        
        return nextState;
      }),

      addPaneAt: (type, title, index, data) => set((state) => {
        const newData = data ? { ...data } : {};
        if (type === 'terminal' && !newData.terminalId) newData.terminalId = generateId();

        const panes = selectActivePanes(state);
        const maxY = panes.reduce((max, p) => Math.max(max, p.gridPos.y + p.gridPos.h), 0);

        const gridPos = newData.gridPos || { x: 0, y: maxY, w: 8, h: 12 };
        delete newData.gridPos;

        const newPane: Pane = { 
          id: generateId(), 
          type, 
          title, 
          gridPos,
          data: newData 
        };
        
        const nextState = withActivePanes(state, ps => {
          const arr = [...ps];
          arr.splice(index, 0, newPane);
          return resolveCollisions(arr);
        });

        if (type === 'missioncontrol') {
          return { ...nextState, messages: [], results: [], tasks: [] };
        }

        return nextState;
      }),

      removePane: (id) => set((state) => {
        const pane = selectActivePanes(state).find(p => p.id === id);
        if (pane?.type === 'terminal' && pane.data?.terminalId) {
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('destroy_pty', { id: pane.data?.terminalId }).catch(console.error);
          });
        }
        return withActivePanes(state, ps => ps.filter(p => p.id !== id));
      }),

      movePane: (activeId, overId) => set((state) =>
        withActivePanes(state, panes => {
          const oldIndex = panes.findIndex(p => p.id === activeId);
          const newIndex = panes.findIndex(p => p.id === overId);
          return arrayMove(panes, oldIndex, newIndex);
        })
      ),

      updatePaneData: (id, data) => set((state) =>
        withActivePanes(state, panes =>
          panes.map(p => p.id === id ? { ...p, data: { ...p.data, ...data } } : p)
        )
      ),

      updatePaneDataByTerminalId: (terminalId, data) => set((state) => ({
        tabs: state.tabs.map(tab => ({
          ...tab,
          panes: tab.panes.map(p =>
            p.type === 'terminal' && p.data?.terminalId === terminalId
              ? { ...p, data: { ...p.data, ...data } }
              : p
          ),
        })),
      })),

      renamePane: (id, title) => set((state) =>
        withActivePanes(state, panes =>
          panes.map(p => p.id === id ? { ...p, title } : p)
        )
      ),

      resizePane: (id, w, h) => set((state) =>
        withActivePanes(state, panes => {
          const updated = panes.map(p => p.id === id ? { ...p, gridPos: { ...p.gridPos, w, h } } : p);
          return resolveCollisions(updated, id);
        })
      ),

      updatePaneLayout: (id, gridPos) => set((state) =>
        withActivePanes(state, panes => {
          const updated = panes.map(p => p.id === id ? { ...p, gridPos: { ...p.gridPos, ...gridPos } } : p);
          return resolveCollisions(updated, id);
        })
      ),

      createMissionTab: (taskDescription, agents) => set((state) => {
        const color = TAB_COLORS[state.tabs.length % TAB_COLORS.length];
        const tabId = generateId();
        const shortTask = taskDescription.length > 24
          ? taskDescription.slice(0, 24) + '…'
          : taskDescription;
        const newTab: WorkspaceTab = {
          id: tabId,
          name: `Mission: ${shortTask}`,
          color,
          panes: [{
            id: generateId(),
            type: 'missioncontrol',
            title: 'Mission Control',
            gridPos: { x: 0, y: 0, w: 24, h: 20 },
            data: { taskDescription, agents },
          }],
        };
        return { tabs: [...state.tabs, newTab], activeTabId: tabId };
      }),

      clearPanes: () => set((state) => withActivePanes(state, () => [])),

      setWorkspaceDir: (dir) => set({ workspaceDir: dir }),
      setTheme: (theme) => set({ theme }),

      saveLayout: (name) => set((state) => {
        const panes = selectActivePanes(state);
        const layout: SavedLayout = {
          id: generateId(),
          name,
          createdAt: Date.now(),
          panes: panes.map(({ type, title, data, gridPos }) => ({ type, title, data: data ? { ...data } : {}, gridPos })),
        };
        return { savedLayouts: [...state.savedLayouts, layout] };
      }),

      loadLayout: (id) => set((state) => {
        const layout = state.savedLayouts.find(l => l.id === id);
        if (!layout) return state;
        const newPanes: Pane[] = (layout.panes as any[]).map(p => {
          const newData = p.data ? { ...p.data } : {};
          if (p.type === 'terminal') newData.terminalId = generateId();
          return { 
            id: generateId(), 
            type: p.type, 
            title: p.title, 
            gridPos: p.gridPos || { x: 0, y: 0, w: 8, h: 12 },
            data: newData 
          };
        });
        return withActivePanes(state, () => resolveCollisions(newPanes));
      }),

      deleteLayout: (id) => set((state) => ({
        savedLayouts: state.savedLayouts.filter(l => l.id !== id),
      })),

      addTab: () => set((state) => {
        const tabNum = state.tabs.length + 1;
        const color = TAB_COLORS[state.tabs.length % TAB_COLORS.length];
        const newTabId = generateId();
        const newTab: WorkspaceTab = {
          id: newTabId,
          name: `Workspace ${tabNum}`,
          color,
          panes: [
            { id: generateId(), type: 'terminal', title: 'Terminal 1', gridPos: { x: 0, y: 0, w: 12, h: 18 }, data: { terminalId: generateId() } },
          ],
        };
        return { tabs: [...state.tabs, newTab], activeTabId: newTabId };
      }),

      removeTab: (id) => set((state) => {
        if (state.tabs.length <= 1) return state;
        const tab = state.tabs.find(t => t.id === id);
        if (tab) {
          tab.panes.forEach(pane => {
            if (pane.type === 'terminal' && pane.data?.terminalId) {
              import('@tauri-apps/api/core').then(({ invoke }) => {
                invoke('destroy_pty', { id: pane.data?.terminalId }).catch(console.error);
              });
            }
          });
        }
        const newTabs = state.tabs.filter(t => t.id !== id);
        const newActiveTabId = id === state.activeTabId
          ? newTabs[Math.max(0, state.tabs.findIndex(t => t.id === id) - 1)].id
          : state.activeTabId;
        return { tabs: newTabs, activeTabId: newActiveTabId };
      }),

      switchTab: (id) => set({ activeTabId: id }),

      renameTab: (id, name) => set((state) => ({
        tabs: state.tabs.map(t => t.id === id ? { ...t, name } : t),
      })),
    }),
    {
      name: 'workspace-storage',
      version: 8,
      migrate: (persistedState: any, version: number) => {
        if (version <= 2) {
          const tabs = (persistedState as any).tabs || [];
          const updatedTabs = tabs.map((tab: any) => ({
            ...tab,
            panes: (tab.panes || []).map((pane: any, idx: number) => ({
              ...pane,
              gridPos: pane.gridPos || { x: (idx % 2) * 12, y: Math.floor(idx / 2) * 10, w: 12, h: 10 }
            }))
          }));
          return { ...persistedState, tabs: updatedTabs };
        }
        if (version < 5) {
          return {
            ...persistedState,
            globalGraph: { id: 'global-editor', nodes: [], edges: [] },
            nodeTerminalBindings: {},
            nodeRuntimeBindings: {},
          };
        }
        if (version < 6) {
          return { ...persistedState, nodeTerminalBindings: {}, nodeRuntimeBindings: {} };
        }
        if (version < 7) {
          const tabs = persistedState?.tabs ?? [];
          return {
            ...persistedState,
            nodeRuntimeBindings: Object.fromEntries(
              Object.entries(persistedState?.nodeTerminalBindings ?? {}).map(([nodeId, terminalId]) => [
                nodeId,
                { terminalId: String(terminalId), runtimeSessionId: null, adapterStatus: null },
              ])
            ),
            tabs: tabs.map((tab: any) => ({
              ...tab,
              panes: (tab.panes ?? []).map((pane: any) => ({
                ...pane,
                data: pane.data ? {
                  ...pane.data,
                  agents: Array.isArray(pane.data.agents)
                    ? pane.data.agents.map((agent: any) => ({
                        ...agent,
                        executionMode: agent.executionMode ?? 'interactive_pty',
                      }))
                    : pane.data.agents,
                } : pane.data,
              })),
            })),
          };
        }
        if (version < 8) {
          return {
            ...persistedState,
            nodeRuntimeBindings: Object.fromEntries(
              Object.entries(persistedState?.nodeTerminalBindings ?? {}).map(([nodeId, terminalId]) => [
                nodeId,
                { terminalId: String(terminalId), runtimeSessionId: null, adapterStatus: null },
              ])
            ),
          };
        }
        return persistedState;
      },
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        sidebarOpen: state.sidebarOpen,
        workspaceDir: state.workspaceDir,
        theme: state.theme,
        savedLayouts: state.savedLayouts,
        results: state.results.slice(-100),
        agentInstructions: state.agentInstructions,
        globalGraph: state.globalGraph,
        nodeTerminalBindings: state.nodeTerminalBindings,
        nodeRuntimeBindings: state.nodeRuntimeBindings,
      }),
    }
  )
);
