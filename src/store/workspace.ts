import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { generateId } from '../lib/graphUtils.js';
import type { RetryPolicy } from '../lib/workflow/WorkflowTypes.js';
import type { FrontendDirectionSpec } from '../lib/frontendDirection.js';
import { activePaneIdAfterReplacingTabPanes, activePaneIdForTab, activeTabIdForTabs, arrayMoveSafely, clampPaneInsertIndex, normalizeWorkspaceGridPos } from '../lib/workspaceTabs.js';
import { workspacePathEquals } from '../lib/workspacePaths.js';
import { normalizePreviewUrl, previewUrlEquals } from '../lib/previewUrl.js';
import { normalizeTerminalId } from '../lib/terminalIds.js';
export type { RetryPolicy };

export function arrayMove<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  return arrayMoveSafely(array, fromIndex, toIndex);
}

export type PaneType = 'terminal' | 'editor' | 'changereview' | 'preview' | 'taskboard' | 'activityfeed' | 'launcher' | 'missioncontrol' | 'nodetree' | 'inbox';
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

export const WORKFLOW_NODE_STATUS_VALUES = [
  'idle',
  'unbound',
  'bound',
  'launching',
  'connecting',
  'spawning',
  'waiting_auth',
  'terminal_started',
  'adapter_starting',
  'mcp_connecting',
  'registered',
  'ready',
  'activation_pending',
  'activation_acked',
  'activated',
  'running',
  'handoff_pending',
  'waiting',
  'done',
  'completed',
  'failed',
  'disconnected',
  'manual_takeover',
] as const satisfies readonly WorkflowNodeStatus[];

export const WORKFLOW_NODE_STATUS_SET: ReadonlySet<WorkflowNodeStatus> = new Set(WORKFLOW_NODE_STATUS_VALUES);

export function isWorkflowNodeStatus(value: string | null | undefined): value is WorkflowNodeStatus {
  return Boolean(value && WORKFLOW_NODE_STATUS_SET.has(value as WorkflowNodeStatus));
}

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

type RuntimeOnlyWorkflowConfig = NonNullable<WorkflowNode['config']> & {
  runtimeSessionId?: unknown;
  currentAttempt?: unknown;
  heartbeat?: unknown;
};

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
    cwd?: string;
    initialCommand?: string;
    initialCommandShouldRun?: boolean;
    customCliCommand?: string;
    customCliArgs?: string[];
    customCliEnv?: Record<string, string>;
    customCliMcpHint?: string;
    [key: string]: any;
  };
}

const EMPTY_PANES: Pane[] = [];

function isPane(value: unknown): value is Pane {
  if (!value || typeof value !== 'object') return false;
  const pane = value as Partial<Pane>;
  const gridPos = pane.gridPos;
  if (!gridPos || typeof gridPos !== 'object') return false;
  return typeof pane.id === 'string'
    && Boolean(pane.id)
    && typeof pane.type === 'string'
    && typeof pane.title === 'string'
    && Number.isFinite(gridPos.x)
    && Number.isFinite(gridPos.y)
    && Number.isFinite(gridPos.w)
    && Number.isFinite(gridPos.h);
}

function safePanes(value: unknown): Pane[] {
  if (!Array.isArray(value)) return EMPTY_PANES;
  for (const item of value) {
    if (!isPane(item)) return value.filter(isPane);
  }
  return value;
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
  panes: Array<Pick<Pane, 'type' | 'title' | 'data' | 'gridPos'>>;
}

const PANE_TYPES = new Set<PaneType>([
  'terminal',
  'editor',
  'changereview',
  'preview',
  'taskboard',
  'activityfeed',
  'launcher',
  'missioncontrol',
  'nodetree',
  'inbox',
]);

function isPaneType(value: unknown): value is PaneType {
  return typeof value === 'string' && PANE_TYPES.has(value as PaneType);
}

function normalizeGridPos(value: unknown, fallback: GridPos): GridPos {
  return normalizeWorkspaceGridPos(value, fallback);
}

function normalizeSavedLayoutPane(value: unknown): Pick<Pane, 'type' | 'title' | 'data' | 'gridPos'> | null {
  if (!value || typeof value !== 'object') return null;
  const pane = value as Partial<Pane>;
  if (!isPaneType(pane.type)) return null;
  return {
    type: pane.type,
    title: cleanPaneTitle(pane.title, pane.type === 'terminal' ? 'Terminal' : 'Untitled'),
    data: cleanPaneDataInput(pane.data),
    gridPos: normalizeGridPos(pane.gridPos, { x: 0, y: 0, w: 25, h: 40 }),
  };
}

export const TAB_COLORS = [
  '#7059f5', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
  '#ec4899', '#14b8a6',
];

export function selectActivePanes(state: WorkspaceState): Pane[] {
  const activeTabId = activeTabIdForTabs(state.tabs, state.activeTabId);
  const panes = state.tabs.find(t => t.id === activeTabId)?.panes;
  return safePanes(panes);
}

function withActivePanes(
  state: WorkspaceState,
  updater: (panes: Pane[]) => Pane[]
): Pick<WorkspaceState, 'tabs' | 'activeTabId'> {
  const activeTabId = activeTabIdForTabs(state.tabs, state.activeTabId) ?? state.activeTabId;
  return {
    activeTabId,
    tabs: state.tabs.map(t =>
      t.id === activeTabId ? { ...t, panes: updater(safePanes(t.panes)) } : t
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

export type SidebarTabType = 'files' | 'tasks' | 'agents' | 'nodetree' | 'settings';
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

function dirtyEditorPanes(panes: Pane[]): Pane[] {
  return panes.filter(pane => pane.type === 'editor' && Boolean(pane.data?.editorDirty));
}

function canUseBlockingWindowConfirm(): boolean {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false;
  return window.location?.hostname !== 'tauri.localhost';
}

function confirmDiscardDirtyEditors(panes: Pane[], action: string): boolean {
  const dirty = dirtyEditorPanes(panes);
  if (dirty.length === 0 || !canUseBlockingWindowConfirm()) return true;
  const names = dirty
    .slice(0, 3)
    .map(pane => pane.title || pane.data?.filePath || 'Untitled')
    .join(', ');
  const extra = dirty.length > 3 ? ` and ${dirty.length - 3} more` : '';
  try {
    return window.confirm(`Discard unsaved changes in ${names}${extra} before ${action}?`);
  } catch (error) {
    console.warn('Discard confirmation unavailable:', error);
    return true;
  }
}

function destroyTerminalPanes(panes: Pane[]) {
  const terminalIds = panes
    .map(pane => pane.type === 'terminal' ? normalizeTerminalId(pane.data?.terminalId) : null)
    .filter((terminalId): terminalId is string => Boolean(terminalId));
  if (terminalIds.length === 0) return;
  import('../lib/runtime/TerminalOutputBus.js').then(({ terminalOutputBus }) => {
    terminalIds.forEach(id => terminalOutputBus.clear(id));
  }).catch(console.error);
  import('@tauri-apps/api/core').then(({ invoke }) => {
    terminalIds.forEach(id => {
      invoke('destroy_pty', { id }).catch(console.error);
    });
  });
}

function clearEditorPanesForWorkspaceChange(state: WorkspaceState): Pick<WorkspaceState, 'tabs' | 'activePaneId'> {
  const tabs = state.tabs.map(tab => tab.id === state.activeTabId
    ? {
        ...tab,
        panes: safePanes(tab.panes).filter(pane => pane.type !== 'editor'),
      }
    : tab);
  return {
    tabs,
    activePaneId: activePaneIdForTab(tabs, state.activeTabId, state.activePaneId),
  };
}

function cleanWorkspaceDirValue(dir: string | null): string | null {
  if (typeof dir !== 'string') return null;
  const cleaned = dir.replace(/\0/g, '').trim();
  return cleaned || null;
}

export function cleanPaneTitle(value: unknown, fallback = 'Untitled'): string {
  const title = typeof value === 'string'
    ? value.replace(/\0/g, '').replace(/\s+/g, ' ').trim()
    : '';
  const fallbackTitle = fallback.replace(/\0/g, '').replace(/\s+/g, ' ').trim() || 'Untitled';
  return (title || fallbackTitle).slice(0, 120);
}

export function cleanWorkspaceTabName(value: unknown, fallback = 'Workspace'): string {
  return cleanPaneTitle(value, fallback);
}

export function cleanSavedLayoutName(value: unknown, fallback = 'Workspace layout'): string {
  return cleanPaneTitle(value, fallback);
}

function activeWorkspaceDirForState(state: WorkspaceState): string | null {
  return cleanWorkspaceDirValue(state.tabs.find(tab => tab.id === state.activeTabId)?.workspaceDir ?? state.workspaceDir);
}

function cleanPaneDataInput(data: unknown): Record<string, unknown> {
  if (!data || typeof data !== 'object' || Array.isArray(data)) return {};
  return Object.fromEntries(
    Object.entries(data as Record<string, unknown>).filter(([, value]) => value !== undefined),
  );
}

function paneDataWithActiveWorkspaceDir(state: WorkspaceState, data?: any): any {
  const nextData = cleanPaneDataInput(data);
  const providedWorkspaceDir = cleanWorkspaceDirValue(typeof nextData.workspaceDir === 'string' ? nextData.workspaceDir : null);
  if (providedWorkspaceDir) {
    nextData.workspaceDir = providedWorkspaceDir;
  } else {
    const activeWorkspaceDir = activeWorkspaceDirForState(state);
    if (activeWorkspaceDir) {
      nextData.workspaceDir = activeWorkspaceDir;
    } else {
      delete nextData.workspaceDir;
    }
  }
  return nextData;
}

function normalizePreviewPaneData(data?: any): any {
  const nextData = cleanPaneDataInput(data);
  if (typeof nextData.url === 'string') {
    const normalizedUrl = normalizePreviewUrl(nextData.url);
    if (normalizedUrl) {
      nextData.url = normalizedUrl;
    } else {
      delete nextData.url;
    }
  }
  return nextData;
}

function paneDataForType(state: WorkspaceState, type: PaneType, data?: any): any {
  const nextData = paneDataWithActiveWorkspaceDir(state, data);
  return type === 'preview' ? normalizePreviewPaneData(nextData) : nextData;
}

function matchingPreviewPane(panes: Pane[], previewData: any): Pane | null {
  return previewData?.url
    ? panes.find(p => p.type === 'preview' && previewUrlEquals(p.data?.url, previewData.url)) ?? null
    : null;
}

function reusePreviewPaneState(
  state: WorkspaceState,
  existingPreview: Pane,
  title: string,
  previewData: any,
): Pick<WorkspaceState, 'tabs' | 'activeTabId' | 'activePaneId'> {
  const nextTitle = cleanPaneTitle(title, existingPreview.title);
  return {
    ...withActivePanes(state, ps => ps.map(p => p.id === existingPreview.id
      ? { ...p, title: nextTitle, data: { ...p.data, ...previewData } }
      : p)),
    activePaneId: existingPreview.id,
  };
}

function refreshedFilePaneData(state: WorkspaceState, type: PaneType, data: any): any {
  const nextData = paneDataForType(state, type, data);
  if (type === 'editor' && nextData.filePath) nextData.editorReloadToken = generateId();
  return nextData;
}

function workspaceDirValuesEqual(left: string | null | undefined, right: string | null | undefined): boolean {
  if (!left && !right) return true;
  if (!left || !right) return false;
  return workspacePathEquals(left, right);
}

function cleanRuntimeBindingNodeId(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const cleaned = value.replace(/\0/g, '').trim();
  return cleaned || null;
}

export function nodeRuntimeBindingsFromTerminalBindings(bindings: unknown): Record<string, NodeRuntimeBinding> {
  if (!bindings || typeof bindings !== 'object') return {};
  return Object.fromEntries(
    Object.entries(bindings as Record<string, unknown>)
      .map(([nodeId, terminalId]) => [cleanRuntimeBindingNodeId(nodeId), normalizeTerminalId(terminalId)] as const)
      .filter((entry): entry is readonly [string, string] => Boolean(entry[0] && entry[1]))
      .map(([nodeId, terminalId]) => [
        nodeId,
        { terminalId, runtimeSessionId: null, adapterStatus: null },
      ]),
  );
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
      const config: RuntimeOnlyWorkflowConfig | undefined = node.config ? { ...node.config } : undefined;
      if (config) {
        delete config.terminalId;
        delete config.paneId;
        delete config.runtimeSessionId;
        delete config.currentAttempt;
        delete config.heartbeat;
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
      appMode: 'workspace',
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
          const missionPane = existing.panes.find(pane => pane.type === 'missioncontrol');
          return {
            activeTabId: existing.id,
            activePaneId: missionPane?.id ?? existing.panes[0]?.id ?? state.activePaneId,
            workspaceDir: workflow.workspaceDir ?? state.workspaceDir,
          };
        }

        const color = TAB_COLORS[state.tabs.length % TAB_COLORS.length];
        const missionPaneId = generateId();
        const editorPaneId = generateId();
        const newTab: WorkspaceTab = {
          id: tabId,
          name: workflow.name,
          color,
          workspaceDir: workflow.workspaceDir,
          workflowRunId: workflow.missionId,
          workflowName: workflow.name,
          panes: [
            {
              id: missionPaneId,
              type: 'missioncontrol',
              title: 'Mission Progress',
              gridPos: { x: 0, y: 0, w: 50, h: 100 },
              data: {
                missionId: workflow.missionId,
                taskDescription: workflow.name,
                agents: [],
              },
            },
            {
              id: editorPaneId,
              type: 'editor',
              title: workflow.workspaceDir
                ? workflow.workspaceDir.split(/[\\/]/).filter(Boolean).pop() || workflow.name
                : workflow.name,
              gridPos: { x: 50, y: 0, w: 50, h: 100 },
              data: {
                workspaceDir: workflow.workspaceDir,
                initialContent: `// ${workflow.name}\n// Workspace: ${workflow.workspaceDir ?? 'No directory selected'}\n`,
              },
            },
          ],
        };
        return {
          tabs: [...state.tabs, newTab],
          activeTabId: tabId,
          activePaneId: missionPaneId,
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
      setNodeTerminalBinding: (nodeId, terminalId) => set((s) => {
        const normalizedTerminalId = normalizeTerminalId(terminalId);
        if (!normalizedTerminalId) return s;
        return {
          nodeTerminalBindings: { ...s.nodeTerminalBindings, [nodeId]: normalizedTerminalId },
          nodeRuntimeBindings: {
            ...s.nodeRuntimeBindings,
            [nodeId]: {
              ...(s.nodeRuntimeBindings[nodeId] ?? {}),
              terminalId: normalizedTerminalId,
              updatedAt: Date.now(),
            },
          },
        };
      }),
      setNodeRuntimeBinding: (nodeId, binding) => set((s) => {
        const normalizedTerminalId = normalizeTerminalId(binding.terminalId);
        const nextBinding = {
          ...(s.nodeRuntimeBindings[nodeId] ?? {}),
          ...binding,
          ...(normalizedTerminalId ? { terminalId: normalizedTerminalId } : {}),
          updatedAt: Date.now(),
        };
        if (binding.terminalId !== undefined && !normalizedTerminalId) {
          delete nextBinding.terminalId;
        }
        return {
          nodeRuntimeBindings: {
            ...s.nodeRuntimeBindings,
            [nodeId]: nextBinding,
          },
          nodeTerminalBindings: normalizedTerminalId
            ? { ...s.nodeTerminalBindings, [nodeId]: normalizedTerminalId }
            : s.nodeTerminalBindings,
        };
      }),
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
          panes: safePanes(tab.panes).map(pane => {
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
            data: paneDataWithActiveWorkspaceDir(state, { terminalId, nodeId, roleId, cli, cliSource: 'heuristic', executionMode, runtimeManaged: true })
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
        const paneTitle = cleanPaneTitle(title, type === 'terminal' ? 'Terminal' : 'Untitled');
        
        // Singleton logic for specific pane types
        if (type === 'missioncontrol' || type === 'inbox') {
          const existing = panes.find(p => p.type === type);
          if (existing) {
            return {
              ...withActivePanes(state, ps => 
                ps.map(p => p.id === existing.id ? { ...p, title: cleanPaneTitle(title, existing.title), data: { ...p.data, ...data } } : p)
              ),
              ...(type === 'missioncontrol' ? { messages: [], results: [], tasks: [] } : {}),
              activePaneId: existing.id
            };
          }
        }

        const previewData = type === 'preview' ? normalizePreviewPaneData(data) : null;
        const existingPreview = type === 'preview' ? matchingPreviewPane(panes, previewData) : null;
        if (existingPreview) {
          return reusePreviewPaneState(state, existingPreview, title, previewData);
        }

        const existingFile = data?.filePath
          ? panes.find(p => typeof p.data?.filePath === 'string' && workspacePathEquals(p.data.filePath, data.filePath))
          : null;
        if (existingFile) {
          if (existingFile.data?.editorDirty) {
            return { activePaneId: existingFile.id };
          }
          const nextData = refreshedFilePaneData(state, type, data);
          return {
            ...withActivePanes(state, ps => ps.map(p => p.id === existingFile.id
              ? { ...p, title: paneTitle, data: { ...p.data, ...nextData } }
              : p)),
            activePaneId: existingFile.id
          };
        }

        const newData = paneDataForType(state, type, data);
        if (type === 'editor' && newData.filePath) newData.editorReloadToken = generateId();
        if (type === 'terminal' && !newData.terminalId) newData.terminalId = generateId();
        
        const gridPos = normalizeGridPos(newData.gridPos, findHighestAvailableSpot(panes, 25, 40));
        delete newData.gridPos;

        const paneId = generateId();
        const newPane: Pane = { 
          id: paneId, 
          type, 
          title: paneTitle, 
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
        const panes = selectActivePanes(state);
        const paneTitle = cleanPaneTitle(title, type === 'terminal' ? 'Terminal' : 'Untitled');

        const previewData = type === 'preview' ? normalizePreviewPaneData(data) : null;
        const existingPreview = type === 'preview' ? matchingPreviewPane(panes, previewData) : null;
        if (existingPreview) {
          return reusePreviewPaneState(state, existingPreview, title, previewData);
        }

        const existingFile = data?.filePath
          ? panes.find(p => typeof p.data?.filePath === 'string' && workspacePathEquals(p.data.filePath, data.filePath))
          : null;
        if (existingFile) {
          if (existingFile.data?.editorDirty) {
            return { activePaneId: existingFile.id };
          }
          const nextData = refreshedFilePaneData(state, type, data);
          return {
            ...withActivePanes(state, ps => ps.map(p => p.id === existingFile.id
              ? { ...p, title: paneTitle, data: { ...p.data, ...nextData } }
              : p)),
            activePaneId: existingFile.id
          };
        }

        const newData = paneDataForType(state, type, data);
        if (type === 'editor' && newData.filePath) newData.editorReloadToken = generateId();
        if (type === 'terminal' && !newData.terminalId) newData.terminalId = generateId();

        const gridPos = normalizeGridPos(newData.gridPos, findHighestAvailableSpot(panes, 25, 40));
        delete newData.gridPos;

        const paneId = generateId();
        const newPane: Pane = { 
          id: paneId, 
          type, 
          title: paneTitle, 
          gridPos,
          data: newData 
        };
        
        const nextState = withActivePanes(state, ps => {
          const arr = [...ps];
          arr.splice(clampPaneInsertIndex(arr.length, index), 0, newPane);
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
        if (pane?.type === 'editor' && pane.data?.editorDirty && !confirmDiscardDirtyEditors([pane], 'closing this tab')) {
          return state;
        }
        if (pane) destroyTerminalPanes([pane]);
        
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

      updatePaneDataByTerminalId: (terminalId, data) => set((state) => {
        const normalizedTerminalId = normalizeTerminalId(terminalId);
        if (!normalizedTerminalId) return state;
        return {
          tabs: state.tabs.map(tab => ({
            ...tab,
            panes: safePanes(tab.panes).map(p =>
              p.type === 'terminal' && normalizeTerminalId(p.data?.terminalId) === normalizedTerminalId
                ? { ...p, data: { ...p.data, ...data } }
                : p
            ),
          })),
        };
      }),

      renamePane: (id, title) => set((state) =>
        withActivePanes(state, panes =>
          panes.map(p => p.id === id ? { ...p, title: cleanPaneTitle(title, p.title) } : p)
        )
      ),

      resizePane: (id, w, h) => set((state) =>
        withActivePanes(state, panes => {
          const updated = panes.map(p => p.id === id ? { ...p, gridPos: normalizeGridPos({ ...p.gridPos, w, h }, p.gridPos) } : p);
          return resolveCollisions(updated, id);
        })
      ),

      updatePaneLayout: (id, gridPos) => set((state) =>
        withActivePanes(state, panes => {
          const updated = panes.map(p => p.id === id ? { ...p, gridPos: normalizeGridPos({ ...p.gridPos, ...gridPos }, p.gridPos) } : p);
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
        return { tabs: [...state.tabs, newTab], activeTabId: tabId, activePaneId: activePaneIdForTab([newTab], tabId) };
      }),

      clearPanes: () => set((state) => {
        const panes = selectActivePanes(state);
        if (!confirmDiscardDirtyEditors(panes, 'clearing panes')) return state;
        destroyTerminalPanes(panes);
        return { ...withActivePanes(state, () => []), activePaneId: null };
      }),

      setWorkspaceDir: (dir) => set((state) => {
        const nextDir = cleanWorkspaceDirValue(dir);
        const activeTab = state.tabs.find(tab => tab.id === state.activeTabId);
        if (
          workspaceDirValuesEqual(state.workspaceDir, nextDir)
          && workspaceDirValuesEqual(activeTab?.workspaceDir, nextDir)
        ) {
          return state;
        }
        if (!confirmDiscardDirtyEditors(safePanes(activeTab?.panes), 'changing workspace folders')) return state;
        const cleared = clearEditorPanesForWorkspaceChange(state);
        return {
          workspaceDir: nextDir,
          ...cleared,
          tabs: cleared.tabs.map(tab => tab.id === state.activeTabId ? { ...tab, workspaceDir: nextDir } : tab),
        };
      }),

      saveLayout: (name) => set((state) => {
        const panes = selectActivePanes(state);
        const layout: SavedLayout = {
          id: generateId(),
          name: cleanSavedLayoutName(name),
          createdAt: Date.now(),
          panes: panes.map(({ type, title, data, gridPos }) => ({
            type,
            title: cleanPaneTitle(title, type === 'terminal' ? 'Terminal' : 'Untitled'),
            data: cleanPaneDataInput(data),
            gridPos: normalizeGridPos(gridPos, { x: 0, y: 0, w: 25, h: 40 }),
          })),
        };
        return { savedLayouts: [...state.savedLayouts, layout] };
      }),

      loadLayout: (id) => set((state) => {
        const layout = state.savedLayouts.find(l => l.id === id);
        if (!layout) return state;
        const panes = selectActivePanes(state);
        if (!confirmDiscardDirtyEditors(panes, 'loading this layout')) return state;
        destroyTerminalPanes(panes);
        const layoutPanes = Array.isArray(layout.panes)
          ? layout.panes.map(normalizeSavedLayoutPane).filter((pane): pane is Pick<Pane, 'type' | 'title' | 'data' | 'gridPos'> => Boolean(pane))
          : [];
        const newPanes: Pane[] = layoutPanes.map(p => {
          const newData = paneDataForType(state, p.type, p.data);
          if (p.type === 'terminal') newData.terminalId = generateId();
          return { 
            id: generateId(), 
            type: p.type, 
            title: cleanPaneTitle(p.title, p.type === 'terminal' ? 'Terminal' : 'Untitled'), 
            gridPos: p.gridPos,
            data: newData 
          };
        });
        const nextState = withActivePanes(state, () => resolveCollisions(newPanes));
        return {
          ...nextState,
          activePaneId: activePaneIdAfterReplacingTabPanes(nextState.tabs, state.activeTabId),
        };
      }),

      deleteLayout: (id) => set((state) => ({
        savedLayouts: state.savedLayouts.filter(l => l.id !== id),
      })),

      addTab: () => set((state) => {
        const tabNum = state.tabs.length + 1;
        const color = TAB_COLORS[state.tabs.length % TAB_COLORS.length];
        const newTabId = generateId();
        const activeWorkspaceDir = activeWorkspaceDirForState(state);
        const newTab: WorkspaceTab = {
          id: newTabId,
          name: `Workspace ${tabNum}`,
          color,
          workspaceDir: activeWorkspaceDir,
          panes: [
            { id: generateId(), type: 'terminal', title: 'Terminal 1', gridPos: { x: 0, y: 0, w: 50, h: 100 }, data: paneDataWithActiveWorkspaceDir(state, { terminalId: generateId() }) },
          ],
        };
        return {
          tabs: [...state.tabs, newTab],
          activeTabId: newTabId,
          activePaneId: activePaneIdForTab([newTab], newTabId),
        };
      }),

      removeTab: (id) => set((state) => {
        if (state.tabs.length <= 1) return state;
        const tab = state.tabs.find(t => t.id === id);
        if (!tab) return state;
        const panes = safePanes(tab.panes);
        if (!confirmDiscardDirtyEditors(panes, 'closing this workspace tab')) return state;
        destroyTerminalPanes(panes);
        const newTabs = state.tabs.filter(t => t.id !== id);
        const newActiveTabId = id === state.activeTabId
          ? newTabs[Math.max(0, state.tabs.findIndex(t => t.id === id) - 1)].id
          : state.activeTabId;
        return {
          tabs: newTabs,
          activeTabId: newActiveTabId,
          activePaneId: activePaneIdForTab(newTabs, newActiveTabId, id === state.activeTabId ? null : state.activePaneId),
        };
      }),

      switchTab: (id) => set((state) => {
        const activeTabId = activeTabIdForTabs(state.tabs, id, state.activeTabId);
        if (!activeTabId || activeTabId === state.activeTabId) return state;
        return {
          activeTabId,
          activePaneId: activePaneIdForTab(state.tabs, activeTabId),
        };
      }),

      renameTab: (id, name) => set((state) => ({
        tabs: state.tabs.map(t => t.id === id ? { ...t, name: cleanWorkspaceTabName(name, t.name) } : t),
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
      version: 18,
      migrate: (persistedState: any, version: number) => {
        if (version < 18) {
          persistedState = {
            ...persistedState,
            appMode: 'workspace',
          };
        }
        if (version < 17) {
          const tabs = Array.isArray(persistedState?.tabs) ? persistedState.tabs : [];
          persistedState = {
            ...persistedState,
            launchedWorkflows: [],
            tabs: tabs.map((tab: any) => ({
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
          const tabs = Array.isArray(persistedState?.tabs) ? persistedState.tabs : [];
          const updatedTabs = tabs.map((tab: any) => ({
            ...tab,
            panes: (Array.isArray(tab.panes) ? tab.panes : []).map((pane: any, idx: number) => ({
              ...pane,
              gridPos: pane.gridPos || { x: (idx % 2) * 12, y: Math.floor(idx / 2) * 10, w: 12, h: 10 }
            }))
          }));
          persistedState = { ...persistedState, tabs: updatedTabs };
        }
        if (version < 5) {
          persistedState = {
            ...persistedState,
            globalGraph: { id: 'global-editor', nodes: [], edges: [] },
            nodeTerminalBindings: {},
            nodeRuntimeBindings: {},
          };
        }
        if (version < 6) {
          persistedState = { ...persistedState, nodeTerminalBindings: {}, nodeRuntimeBindings: {} };
        }
        if (version < 7) {
          const tabs = Array.isArray(persistedState?.tabs) ? persistedState.tabs : [];
          persistedState = {
            ...persistedState,
            nodeRuntimeBindings: nodeRuntimeBindingsFromTerminalBindings(persistedState?.nodeTerminalBindings),
            tabs: tabs.map((tab: any) => ({
              ...tab,
              panes: (Array.isArray(tab.panes) ? tab.panes : []).map((pane: any) => ({
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
          persistedState = {
            ...persistedState,
            nodeRuntimeBindings: nodeRuntimeBindingsFromTerminalBindings(persistedState?.nodeTerminalBindings),
          };
        }
        if (version < 10) {
          const tabs = Array.isArray(persistedState?.tabs) ? persistedState.tabs : [];
          persistedState = {
            ...persistedState,
            nodeTerminalBindings: {},
            nodeRuntimeBindings: {},
            tabs: tabs.map((tab: any) => ({
              ...tab,
              panes: (Array.isArray(tab.panes) ? tab.panes : [])
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
          persistedState = {
            ...persistedState,
            layoutMode: 'tabs',
            activePaneId: null,
          };
        }
        if (version < 13) {
          const graph = persistedState?.globalGraph ?? { id: 'global-editor', nodes: [], edges: [] };
          persistedState = {
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
          persistedState = {
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
          persistedState = {
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
      partialize: (state) => {
        const tabs = state.tabs.map(tab => ({
          ...tab,
          panes: safePanes(tab.panes).filter(p => p.type !== 'terminal').map(p => {
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
        }));

        const activeTabId = activeTabIdForTabs(tabs, state.activeTabId);

        return {
          tabs,
          activeTabId: activeTabId ?? state.activeTabId,
          activePaneId: activePaneIdForTab(tabs, activeTabId, state.activePaneId),
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
        };
      },
    }
  )
);
