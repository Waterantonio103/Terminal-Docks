import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../lib/graphUtils.js';
import type { RetryPolicy } from '../lib/workflow/WorkflowTypes.js';
import type { FrontendDirectionSpec } from '../lib/frontendDirection.js';
export type { RetryPolicy };

export function arrayMove<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  const newArray = [...array];
  const [item] = newArray.splice(fromIndex, 1);
  newArray.splice(toIndex, 0, item);
  return newArray;
}

export type PaneType = 'terminal' | 'editor' | 'taskboard' | 'activityfeed' | 'launcher' | 'missioncontrol' | 'nodetree' | 'inbox';
export type AppMode = 'workflow' | 'runtime' | 'workspace' | 'actioncenter' | 'mcptoolbox';
export type WorkflowNodeStatus =
  | 'idle'
  | 'unbound'
  | 'bound'
  | 'launching'
  | 'connecting'
  | 'spawning'
  | 'waiting_auth'
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
  | 'disconnected'
  | 'manual_takeover';
export type WorkflowMode = 'build' | 'edit';
export type WorkflowEdgeCondition = 'always' | 'on_success' | 'on_failure';
export type WorkflowAgentCli = 'claude' | 'gemini' | 'opencode' | 'codex' | 'custom' | 'ollama' | 'lmstudio';
export type WorkflowExecutionMode = 'api' | 'headless' | 'streaming_headless' | 'interactive_pty' | 'manual';
export type WorkflowAuthoringMode = 'preset' | 'graph' | 'adaptive';
export type WorkflowGraphMode = 'standard' | 'research' | 'plan' | 'review' | 'verify' | 'secure' | 'document' | 'ui';
export type FrontendWorkflowMode = 'off' | 'fast' | 'aligned' | 'strict_ui';
export type PresetSpecProfile = 'none' | 'frontend_three_file';
export type FrontendSpecCategory = 'marketing_site' | 'saas_dashboard' | 'admin_internal_tool' | 'docs_portal' | 'consumer_mobile_app';
export type WorkerCapabilityId = 'planning' | 'coding' | 'testing' | 'review' | 'security' | 'repo_analysis' | 'shell_execution';
export interface TaskAttachment {
  id: string;
  kind: 'file' | 'image';
  name: string;
  path?: string;
  mime?: string;
  source?: 'dialog' | 'clipboard';
}

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
    attachments?: TaskAttachment[];
    instructionOverride?: string;
    terminalId?: string;
    terminalTitle?: string;
    paneId?: string;
    cli?: WorkflowAgentCli;
    model?: string;
    yolo?: boolean;
    executionMode?: WorkflowExecutionMode;
    autoLinked?: boolean;
    authoringMode?: WorkflowAuthoringMode;
    presetId?: string | null;
    runVersion?: number;
    frontendMode?: FrontendWorkflowMode;
    frontendDirection?: FrontendDirectionSpec;
    specProfile?: PresetSpecProfile;
    finalReadmeEnabled?: boolean;
    finalReadmeOwnerNodeId?: string | null;
    adaptiveSeed?: boolean;
    profileId?: string;
    capabilities?: WorkerCapability[];
    requirements?: TaskRequirements;
    retryPolicy?: RetryPolicy;
    acceptanceCriteria?: string[];
    outputContract?: string;
    parentId?: string;
    extent?: 'parent';
    width?: number;
    height?: number;
    label?: string;
    position?: { x: number; y: number };
    workflowId?: string;
    workflowName?: string;
    workflowSubMode?: string;
    workflowMode?: string;
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
  attachments?: TaskAttachment[];
  frontendMode?: FrontendWorkflowMode;
  frontendCategory?: FrontendSpecCategory;
  frontendDirection?: FrontendDirectionSpec;
  specProfile?: PresetSpecProfile;
  finalReadmeEnabled?: boolean;
  finalReadmeOwnerNodeId?: string | null;
}

export interface CompiledMissionTerminalBinding {
  terminalId: string;
  terminalTitle: string;
  cli: WorkflowAgentCli;
  model?: string;
  yolo?: boolean;
  executionMode: WorkflowExecutionMode;
  paneId?: string;
  reusedExisting: boolean;
}

export interface CompiledMissionNode {
  id: string;
  roleId: string;
  profileId?: string;
  instructionOverride: string;
  acceptanceCriteria?: string[];
  outputContract?: string;
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
  frontendMode?: FrontendWorkflowMode;
  frontendCategory?: FrontendSpecCategory;
  frontendDirection?: FrontendDirectionSpec;
  specProfile?: PresetSpecProfile;
  finalReadmeEnabled?: boolean;
  finalReadmeOwnerNodeId?: string | null;
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
  model?: string | null;
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
  currentAction?: string | null;
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
  | 'void' | 'ghost' | 'plasma' | 'hex' | 'neon-tokyo' | 'obsidian'
  | 'nebula' | 'storm' | 'infrared' | 'nova' | 'stealth' | 'hologram' | 'cometmind'
  | 'synthwave' | 'cybernetics' | 'quantum' | 'mecha' | 'abyss'
  // Spec light themes
  | 'paper' | 'starlink-light' | 'solar' | 'arctic' | 'ivory';

function getInitialTheme(): ThemeType {
  if (typeof window !== 'undefined' && window.matchMedia) {
    if (window.matchMedia('(prefers-color-scheme: light)').matches) {
      return 'starlink-light';
    }
  }
  return 'dark';
}

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
    cliSource?: 'connect_agent' | 'stdout' | 'heuristic' | 'runtime_shell_launch';
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
  workspaceDir?: string | null;
  workflowRunId?: string;
  workflowName?: string;
}

export interface LaunchedWorkflow {
  missionId: string;
  workflowId: string;
  name: string;
  subMode: string;
  mode?: string;
  size?: string;
  agentCount: number;
  workspaceDir: string | null;
  launchedAt: number;
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
export type LayoutMode = 'grid' | 'tabs';

export interface CustomThemeColors {
  // UI Colors
  '--bg-app'?: string;
  '--bg-panel'?: string;
  '--bg-surface'?: string;
  '--accent-primary'?: string;
  '--accent-subtle'?: string;
  '--text-primary'?: string;
  // Syntax Colors
  '--syntax-keyword'?: string;
  '--syntax-string'?: string;
  '--syntax-function'?: string;
  '--syntax-variable'?: string;
  '--syntax-number'?: string;
  '--syntax-comment'?: string;
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  activePaneId: string | null;
  layoutMode: LayoutMode;
  sidebarOpen: boolean;
  activeSidebarTab: SidebarTabType;
  appMode: AppMode;
  workspaceDir: string | null;
  theme: ThemeType;
  showSettings: boolean;
  canvasEffectsEnabled: boolean;
  customTheme: CustomThemeColors;
  savedLayouts: SavedLayout[];
  messages: McpMessage[];
  results: ResultEntry[];
  tasks: DbTask[];
  agentInstructions: Record<string, string>;
  globalGraph: WorkflowGraph;
  workflowGraphMode: WorkflowGraphMode;
  workflowGraphs: Record<WorkflowGraphMode, WorkflowGraph | null>;
  uiFrontendMode: Exclude<FrontendWorkflowMode, 'off'>;
  launchedWorkflows: LaunchedWorkflow[];
  nodeTerminalBindings: Record<string, string>;
  nodeRuntimeBindings: Record<string, NodeRuntimeBinding>;
  toggleSidebar: () => void;
  setActiveSidebarTab: (tab: SidebarTabType) => void;
  setAppMode: (mode: AppMode) => void;
  setLayoutMode: (mode: LayoutMode) => void;
  setActivePaneId: (id: string | null) => void;
  setGlobalGraph: (graph: WorkflowGraph) => void;
  setWorkflowGraphMode: (mode: WorkflowGraphMode) => void;
  setWorkflowGraphForMode: (mode: WorkflowGraphMode, graph: WorkflowGraph) => void;
  setUiFrontendMode: (mode: Exclude<FrontendWorkflowMode, 'off'>) => void;
  addLaunchedWorkflow: (workflow: LaunchedWorkflow) => void;
  ensureWorkflowWorkspace: (workflow: LaunchedWorkflow) => void;
  setShowSettings: (open: boolean) => void;
  setCanvasEffectsEnabled: (enabled: boolean) => void;
  setTheme: (theme: ThemeType) => void;
  setCustomThemeColor: (key: keyof CustomThemeColors, value: string) => void;
  resetCustomTheme: () => void;
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
  createRuntimeTerminal: (opts: { nodeId: string; roleId: string; cli: WorkflowAgentCli; executionMode: WorkflowExecutionMode; title: string }) => { paneId: string; terminalId: string };
  loadPlannedDag: (planned: any) => void;
}

function gridRectsOverlap(a: GridPos, b: GridPos, padding = 0): boolean {
  return (
    a.x < b.x + b.w + padding &&
    a.x + a.w + padding > b.x &&
    a.y < b.y + b.h + padding &&
    a.y + a.h + padding > b.y
  );
}

function findHighestAvailableSpot(panes: Pane[], w: number, h: number, padding = 1): GridPos {
  const GRID_COLUMNS = 100;
  let y = 0;
  while (y < 2000) {
    for (let x = 0; x <= GRID_COLUMNS - w; x++) {
      const rect = { x, y, w, h };
      const hasCollision = panes.some(p => gridRectsOverlap(rect, p.gridPos, padding));
      if (!hasCollision) return rect;
    }
    y += 1;
  }
  return { x: 0, y: 0, w, h };
}

function clearEditorPanesForWorkspaceChange(state: WorkspaceState): Pick<WorkspaceState, 'tabs' | 'activePaneId'> {
  const tabs = state.tabs.map(tab => ({
    ...tab,
    panes: tab.panes.filter(pane => pane.type !== 'editor'),
  }));
  const activePaneStillExists = tabs.some(tab => tab.panes.some(pane => pane.id === state.activePaneId));
  const activeTab = tabs.find(tab => tab.id === state.activeTabId) ?? tabs[0];
  return {
    tabs,
    activePaneId: activePaneStillExists ? state.activePaneId : (activeTab?.panes[0]?.id ?? null),
  };
}

function cleanWorkflowGraph(graph: WorkflowGraph): WorkflowGraph {
  return {
    ...graph,
    nodes: graph.nodes.map(node => ({
      ...node,
      config: node.config ? {
        ...node.config,
        workspaceDir: typeof node.config.workspaceDir === 'string' ? node.config.workspaceDir.replace(/\0/g, '').trim() : node.config.workspaceDir,
        cli: typeof node.config.cli === 'string' ? node.config.cli.replace(/\0/g, '').trim() as WorkflowAgentCli : node.config.cli,
      } : undefined,
    })),
  };
}

function createEmptyWorkflowGraph(id: string): WorkflowGraph {
  return {
    id,
    nodes: [],
    edges: [],
  };
}

function persistWorkflowGraph(graph: WorkflowGraph) {
  import('@tauri-apps/api/core').then(({ invoke }) => {
    invoke('save_workflow_definition', { id: 'global-editor', graphJson: JSON.stringify(graph) }).catch(console.error);
  });
}

function stripRuntimeFromGraph(graph: WorkflowGraph | null): WorkflowGraph | null {
  if (!graph) return null;
  return {
    ...graph,
    nodes: graph.nodes.map(node => {
      const config = node.config ? { ...node.config } : undefined;
      if (config) {
        delete config.terminalId;
        delete config.paneId;
        delete (config as any).runtimeSessionId;
        delete (config as any).currentAttempt;
        delete (config as any).heartbeat;
      }
      return {
        ...node,
        status: 'idle',
        mcpState: undefined,
        config,
      };
    }),
  };
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
          { id: generateId(), type: 'terminal', title: 'Terminal 1', gridPos: { x: 0, y: 0, w: 50, h: 200 }, data: { terminalId: generateId() } },
          { id: generateId(), type: 'editor', title: 'Welcome', gridPos: { x: 50, y: 0, w: 50, h: 200 } },
        ],
      }],
      activeTabId: _initTabId,
      activePaneId: null,
      layoutMode: 'tabs',
      sidebarOpen: true,
      activeSidebarTab: 'files',
      appMode: 'workflow',
      workspaceDir: null,
      theme: getInitialTheme(),
      showSettings: false,
      canvasEffectsEnabled: true,
      customTheme: {},
      savedLayouts: [],
      messages: [],
      results: [],
      tasks: [],
      agentInstructions: {},
      globalGraph: { id: 'global-editor', nodes: [], edges: [] },
      workflowGraphMode: 'standard',
      workflowGraphs: {
        standard: { id: 'global-editor', nodes: [], edges: [] },
        research: null,
        plan: null,
        review: null,
        verify: null,
        secure: null,
        document: null,
        ui: null,
      },
      uiFrontendMode: 'strict_ui',
      launchedWorkflows: [],
      nodeTerminalBindings: {},
      nodeRuntimeBindings: {},

      setActiveSidebarTab: (tab) => set({ activeSidebarTab: tab }),
      setAppMode: (mode) => set({ appMode: mode }),
      setLayoutMode: () => set({ layoutMode: 'tabs' }),
      setActivePaneId: (id) => set({ activePaneId: id }),
      setGlobalGraph: (graph) => {
        const cleanGraph = cleanWorkflowGraph(graph);
        set((state) => ({
          globalGraph: cleanGraph,
          workflowGraphs: {
            ...state.workflowGraphs,
            [state.workflowGraphMode]: cleanGraph,
          },
        }));
        persistWorkflowGraph(cleanGraph);
      },
      setWorkflowGraphMode: (mode) => set((state) => {
        if (state.workflowGraphMode === mode) return state;
        const graphs = {
          ...state.workflowGraphs,
          [state.workflowGraphMode]: state.globalGraph,
        };
        const selectedGraph = graphs[mode] ?? (mode === 'ui'
          ? createEmptyWorkflowGraph('ui-editor')
          : createEmptyWorkflowGraph('global-editor'));
        graphs[mode] = selectedGraph;
        const cleanGraph = cleanWorkflowGraph(selectedGraph);
        persistWorkflowGraph(cleanGraph);
        return {
          workflowGraphMode: mode,
          workflowGraphs: {
            ...graphs,
            [mode]: cleanGraph,
          },
          globalGraph: cleanGraph,
          nodeTerminalBindings: {},
          nodeRuntimeBindings: {},
        };
      }),
      setWorkflowGraphForMode: (mode, graph) => {
        const cleanGraph = cleanWorkflowGraph(graph);
        set((state) => ({
          workflowGraphs: {
            ...state.workflowGraphs,
            [mode]: cleanGraph,
          },
          ...(state.workflowGraphMode === mode ? { globalGraph: cleanGraph } : {}),
        }));
        persistWorkflowGraph(cleanGraph);
      },
      setUiFrontendMode: (mode) => set({ uiFrontendMode: mode }),
      addLaunchedWorkflow: (workflow) => set((state) => ({
        launchedWorkflows: [
          workflow,
          ...state.launchedWorkflows.filter(item => item.missionId !== workflow.missionId),
        ].slice(0, 24),
      })),
      ensureWorkflowWorkspace: (workflow) => set((state) => {
        const tabId = `workflow-workspace:${workflow.missionId}`;
        const existing = state.tabs.find(tab => tab.id === tabId);
        if (existing) {
          return {
            activeTabId: existing.id,
            activePaneId: existing.panes[0]?.id ?? state.activePaneId,
            workspaceDir: workflow.workspaceDir ?? state.workspaceDir,
          };
        }

        const color = TAB_COLORS[state.tabs.length % TAB_COLORS.length];
        const editorPaneId = generateId();
        const newTab: WorkspaceTab = {
          id: tabId,
          name: workflow.name,
          color,
          workspaceDir: workflow.workspaceDir,
          workflowRunId: workflow.missionId,
          workflowName: workflow.name,
          panes: [{
            id: editorPaneId,
            type: 'editor',
            title: workflow.workspaceDir
              ? workflow.workspaceDir.split(/[\\/]/).filter(Boolean).pop() || workflow.name
              : workflow.name,
            gridPos: { x: 0, y: 0, w: 100, h: 100 },
            data: {
              workspaceDir: workflow.workspaceDir,
              initialContent: `// ${workflow.name}\n// Workspace: ${workflow.workspaceDir ?? 'No directory selected'}\n`,
            },
          }],
        };
        return {
          tabs: [...state.tabs, newTab],
          activeTabId: tabId,
          activePaneId: editorPaneId,
          workspaceDir: workflow.workspaceDir ?? state.workspaceDir,
        };
      }),
      setShowSettings: (open) => set({ showSettings: open }),
      setCanvasEffectsEnabled: (enabled) => set({ canvasEffectsEnabled: enabled }),
      setTheme: (theme) => set({ theme }),
      setCustomThemeColor: (key, value) => set((s) => ({
        customTheme: { ...s.customTheme, [key]: value }
      })),
      resetCustomTheme: () => set({ customTheme: {} }),

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

      createRuntimeTerminal: ({ nodeId, roleId, cli, executionMode, title }) => {
        const terminalId = generateId();
        const paneId = generateId();
        
        set((state) => {
          const panes = selectActivePanes(state);
          const gridPos = findHighestAvailableSpot(panes, 48, 80, 2);
          
          const newPane: Pane = {
            id: paneId,
            type: 'terminal',
            title,
            gridPos,
            data: { terminalId, nodeId, roleId, cli, cliSource: 'heuristic', executionMode, runtimeManaged: true }
          };
          
          return {
            ...withActivePanes(state, ps => resolveCollisions([...ps, newPane])),
            activePaneId: paneId
          };
        });
        
        return { paneId, terminalId };
      },

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      addPane: (type, title, data) => set((state) => {
        const panes = selectActivePanes(state);
        
        // Singleton logic for specific pane types
        if (type === 'missioncontrol' || type === 'inbox') {
          const existing = panes.find(p => p.type === type);
          if (existing) {
            return {
              ...withActivePanes(state, ps => 
                ps.map(p => p.id === existing.id ? { ...p, title, data: { ...p.data, ...data } } : p)
              ),
              ...(type === 'missioncontrol' ? { messages: [], results: [], tasks: [] } : {}),
              activePaneId: existing.id
            };
          }
        }

        const existingFile = data?.filePath ? panes.find(p => p.data?.filePath === data.filePath) : null;
        if (existingFile) {
          return { ...state, activePaneId: existingFile.id };
        }

        const newData = data ? { ...data } : {};
        if (type === 'terminal' && !newData.terminalId) newData.terminalId = generateId();
        
        const gridPos = newData.gridPos || findHighestAvailableSpot(panes, 25, 40);
        delete newData.gridPos;

        const paneId = generateId();
        const newPane: Pane = { 
          id: paneId, 
          type, 
          title, 
          gridPos,
          data: newData 
        };
        
        const nextState = withActivePanes(state, ps => resolveCollisions([...ps, newPane]));
        
        // If we just added a new mission control pane (not just updated an existing one)
        if (type === 'missioncontrol') {
          return { ...nextState, messages: [], results: [], tasks: [], activePaneId: paneId };
        }
        
        return { ...nextState, activePaneId: paneId };
      }),

      addPaneAt: (type, title, index, data) => set((state) => {
        const newData = data ? { ...data } : {};
        if (type === 'terminal' && !newData.terminalId) newData.terminalId = generateId();

        const panes = selectActivePanes(state);
        const gridPos = newData.gridPos || findHighestAvailableSpot(panes, 25, 40);
        delete newData.gridPos;

        const paneId = generateId();
        const newPane: Pane = { 
          id: paneId, 
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
          return { ...nextState, messages: [], results: [], tasks: [], activePaneId: paneId };
        }

        return { ...nextState, activePaneId: paneId };
      }),

      removePane: (id) => set((state) => {
        const panes = selectActivePanes(state);
        const pane = panes.find(p => p.id === id);
        if (pane?.type === 'terminal' && pane.data?.terminalId) {
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('destroy_pty', { id: pane.data?.terminalId }).catch(console.error);
          });
        }
        
        const nextPanes = panes.filter(p => p.id !== id);
        let nextActivePaneId = state.activePaneId;
        if (state.activePaneId === id) {
          const idx = panes.findIndex(p => p.id === id);
          nextActivePaneId = nextPanes.length > 0 
            ? nextPanes[Math.min(idx, nextPanes.length - 1)].id 
            : null;
        }

        return {
          ...withActivePanes(state, () => nextPanes),
          activePaneId: nextActivePaneId
        };
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
            gridPos: { x: 0, y: 0, w: 100, h: 100 },
            data: { taskDescription, agents },
          }],
        };
        return { tabs: [...state.tabs, newTab], activeTabId: tabId };
      }),

      clearPanes: () => set((state) => withActivePanes(state, () => [])),

      setWorkspaceDir: (dir) => set((state) => {
        const nextDir = typeof dir === 'string' ? dir.replace(/\0/g, '').trim() : dir;
        if ((state.workspaceDir ?? null) === (nextDir ?? null)) return state;
        return {
          workspaceDir: nextDir,
          ...clearEditorPanesForWorkspaceChange(state),
        };
      }),

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
            gridPos: p.gridPos || { x: 0, y: 0, w: 25, h: 40 },
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
            { id: generateId(), type: 'terminal', title: 'Terminal 1', gridPos: { x: 0, y: 0, w: 50, h: 100 }, data: { terminalId: generateId() } },
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

      loadPlannedDag: (planned) => {
        import('../lib/workflow/PlanningRouter.js').then(({ convertPlannedDagToWorkflowGraph }) => {
          const graph = convertPlannedDagToWorkflowGraph(planned);
          const cleanGraph = cleanWorkflowGraph(graph);
          set((state) => ({
            globalGraph: cleanGraph,
            workflowGraphs: {
              ...state.workflowGraphs,
              [state.workflowGraphMode]: cleanGraph,
            },
            activeSidebarTab: 'nodetree',
          }));
          persistWorkflowGraph(cleanGraph);
        });
      },
    }),
    {
      name: 'workspace-storage',
      version: 17,
      migrate: (persistedState: any, version: number) => {
        if (version < 17) {
          persistedState = {
            ...persistedState,
            launchedWorkflows: [],
            tabs: (persistedState?.tabs ?? []).map((tab: any) => ({
              ...tab,
              workspaceDir: tab.workspaceDir ?? null,
            })),
          };
        }
        if (version < 16) {
          persistedState = {
            ...persistedState,
            layoutMode: 'tabs',
          };
        }
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
        if (version < 10) {
          const tabs = persistedState?.tabs ?? [];
          return {
            ...persistedState,
            nodeTerminalBindings: {},
            nodeRuntimeBindings: {},
            tabs: tabs.map((tab: any) => ({
              ...tab,
              panes: (tab.panes ?? [])
                .filter((pane: any) => pane.type !== 'terminal')
                .map((pane: any) => {
                  if (pane.type === 'missioncontrol' && Array.isArray(pane.data?.agents)) {
                    return {
                      ...pane,
                      data: {
                        ...pane.data,
                        agents: pane.data.agents.map((agent: any) => ({
                          ...agent,
                          terminalId: '',
                          runtimeSessionId: null,
                          status: 'idle',
                        })),
                      },
                    };
                  }
                  return pane;
                }),
            })),
          };
        }
        if (version < 11) {
          return {
            ...persistedState,
            layoutMode: 'tabs',
            activePaneId: null,
          };
        }
        if (version < 12) {
          return persistedState;
        }
        if (version < 13) {
          const graph = persistedState?.globalGraph ?? { id: 'global-editor', nodes: [], edges: [] };
          return {
            ...persistedState,
            workflowGraphMode: 'standard',
            workflowGraphs: {
              standard: graph,
              research: null,
              plan: null,
              review: null,
              verify: null,
              secure: null,
              document: null,
              ui: null,
            },
          };
        }
        if (version < 14) {
          const activeMode = persistedState?.workflowGraphMode === 'ui' ? 'ui' : 'standard';
          const graphs = persistedState?.workflowGraphs ?? {};
          return {
            ...persistedState,
            workflowGraphMode: activeMode,
            workflowGraphs: {
              standard: activeMode === 'standard'
                ? (persistedState?.globalGraph ?? graphs.standard ?? createEmptyWorkflowGraph('global-editor'))
                : (graphs.standard ?? createEmptyWorkflowGraph('global-editor')),
              research: graphs.research ?? null,
              plan: graphs.plan ?? null,
              review: graphs.review ?? null,
              verify: graphs.verify ?? null,
              secure: graphs.secure ?? null,
              document: graphs.document ?? null,
              ui: null,
            },
            globalGraph: activeMode === 'ui'
              ? createEmptyWorkflowGraph('ui-editor')
              : (persistedState?.globalGraph ?? graphs.standard ?? createEmptyWorkflowGraph('global-editor')),
            uiFrontendMode: 'strict_ui',
          };
        }
        if (version < 15) {
          return {
            ...persistedState,
            canvasEffectsEnabled: true,
          };
        }
        persistedState.workflowGraphs = {
          standard: persistedState?.workflowGraphs?.standard ?? persistedState?.globalGraph ?? createEmptyWorkflowGraph('global-editor'),
          research: persistedState?.workflowGraphs?.research ?? null,
          plan: persistedState?.workflowGraphs?.plan ?? null,
          review: persistedState?.workflowGraphs?.review ?? null,
          verify: persistedState?.workflowGraphs?.verify ?? null,
          secure: persistedState?.workflowGraphs?.secure ?? null,
          document: persistedState?.workflowGraphs?.document ?? null,
          ui: persistedState?.workflowGraphs?.ui ?? null,
        };
        return persistedState;
      },
      partialize: (state) => ({
        tabs: state.tabs.map(tab => ({
          ...tab,
          panes: tab.panes.filter(p => p.type !== 'terminal').map(p => {
            if (p.type === 'missioncontrol' && Array.isArray(p.data?.agents)) {
              return {
                ...p,
                data: {
                  ...p.data,
                  agents: p.data.agents.map((agent: any) => ({
                    ...agent,
                    terminalId: '',
                    runtimeSessionId: null,
                    status: 'idle',
                  })),
                },
              };
            }
            return p;
          })
        })),
        activeTabId: state.activeTabId,
        activePaneId: state.activePaneId,
        layoutMode: 'tabs',
        sidebarOpen: state.sidebarOpen,
        appMode: state.appMode,
        workspaceDir: state.workspaceDir,
        theme: state.theme,
        canvasEffectsEnabled: state.canvasEffectsEnabled,
        savedLayouts: state.savedLayouts,
        results: state.results.slice(-100),
        agentInstructions: state.agentInstructions,
        workflowGraphMode: state.workflowGraphMode,
        uiFrontendMode: state.uiFrontendMode,
        launchedWorkflows: state.launchedWorkflows.slice(0, 24),
        workflowGraphs: {
          standard: stripRuntimeFromGraph(state.workflowGraphMode === 'standard' ? state.globalGraph : state.workflowGraphs.standard),
          research: stripRuntimeFromGraph(state.workflowGraphMode === 'research' ? state.globalGraph : state.workflowGraphs.research),
          plan: stripRuntimeFromGraph(state.workflowGraphMode === 'plan' ? state.globalGraph : state.workflowGraphs.plan),
          review: stripRuntimeFromGraph(state.workflowGraphMode === 'review' ? state.globalGraph : state.workflowGraphs.review),
          verify: stripRuntimeFromGraph(state.workflowGraphMode === 'verify' ? state.globalGraph : state.workflowGraphs.verify),
          secure: stripRuntimeFromGraph(state.workflowGraphMode === 'secure' ? state.globalGraph : state.workflowGraphs.secure),
          document: stripRuntimeFromGraph(state.workflowGraphMode === 'document' ? state.globalGraph : state.workflowGraphs.document),
          ui: stripRuntimeFromGraph(state.workflowGraphMode === 'ui' ? state.globalGraph : state.workflowGraphs.ui),
        },
        globalGraph: stripRuntimeFromGraph(state.globalGraph)!,
        nodeTerminalBindings: {},
        nodeRuntimeBindings: {},
      }),
    }
  )
);
