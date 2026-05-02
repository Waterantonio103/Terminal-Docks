import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DotTunnelBackground } from '../shared/DotTunnelBackground';
import { ModelDiscoveryLoading } from '../models/ModelDiscoveryLoading';
import { AgentActionBadge } from '../models/AgentActionBadge';
import { ArrowUpRight, ChevronDown, ChevronLeft, Play, Plus, RefreshCw, ScanSearch, Sparkles, Trash2, Workflow, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { emit, listen } from '@tauri-apps/api/event';
import agentsConfig from '../../config/agents';
import { compileMission, validateGraph } from '../../lib/graphCompiler';
import { generateId } from '../../lib/graphUtils';
import { buildPresetFlowGraph, getWorkflowPreset } from '../../lib/workflowPresets';
import { workflowStatusLabel, workflowStatusTone } from '../../lib/workflowStatus';
import {
  legacyGraphToNodeDocument,
  nodeDocumentToFlowGraph,
  nodeDocumentToWorkflowGraph,
  type NodeDocumentState,
} from '../../lib/node-system/adapter';
import { createWorkflowNodeRegistry, materializeNode } from '../../lib/node-system/declarations';
import { getActiveTreeId, getViewState } from '../../lib/node-system/editor';
import { applyNodeEditorOperator } from '../../lib/node-system/operators';
import type { MaterializedNode, NodeInstance, Point2D } from '../../lib/node-system/types';
import { detectRoleForPane } from '../../lib/cliDetection';
import { runtimeManager } from '../../lib/runtime/RuntimeManager';
import { runtimeExecutor } from '../../lib/runtime/RuntimeExecutor';
import { terminalOutputBus } from '../../lib/runtime/TerminalOutputBus';
import { supportsHeadless } from '../../lib/cliIdentity';
import { useWorkspaceStore, type MissionAgent, type Pane, type ResultEntry, type WorkflowAgentCli, type WorkflowExecutionMode, type WorkflowGraph } from '../../store/workspace';
import { discoverModelsForCli, supportsModelDiscovery } from '../../lib/models/modelDiscoveryService';
import type { CliId, CliModel, ModelDiscoveryResult } from '../../lib/models/modelTypes';
import { useMissionSnapshot } from '../../hooks/useMissionSnapshot';

type ValidationTone = 'idle' | 'ok' | 'error';
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type LinkHoverTarget = { nodeId: string; socketId: string } | null;
type MenuMode = 'canvas' | 'node' | 'link_insert';

type CanvasInteraction =
  | { kind: 'idle' }
  | { kind: 'panning'; pointerOrigin: Point2D; panOrigin: Point2D }
  | { kind: 'dragging_nodes'; pointerOrigin: Point2D; nodeOrigins: Record<string, Point2D> }
  | { kind: 'dragging_link'; fromNodeId: string; fromSocketId: string; fromWorld: Point2D; currentWorld: Point2D }
  | { kind: 'box_select'; worldOrigin: Point2D; worldCurrent: Point2D }
  | { kind: 'knife'; worldOrigin: Point2D; worldCurrent: Point2D }
  | {
      kind: 'resizing_frame';
      nodeId: string;
      edge: ResizeEdge;
      pointerOrigin: Point2D;
      startRect: { x: number; y: number; width: number; height: number };
    };

interface ContextMenuState {
  mode: MenuMode;
  screen: Point2D;
  world: Point2D;
  nodeId?: string;
  linkFrom?: { nodeId: string; socketId: string };
}

const GRID_SIZE = 24;
const LINK_CANVAS_SIZE = 16384;
const LINK_CANVAS_HALF = LINK_CANVAS_SIZE / 2;
const FRAME_MIN_WIDTH = 160;
const FRAME_MIN_HEIGHT = 100;
const SOCKET_SNAP_RADIUS = 48;
const SUPPORTED_WORKFLOW_CLIS = new Set(['claude', 'gemini', 'opencode', 'codex', 'custom', 'ollama', 'lmstudio']);
const SELECTABLE_WORKFLOW_CLIS: WorkflowAgentCli[] = ['claude', 'codex', 'gemini', 'opencode', 'custom', 'ollama', 'lmstudio'];
const SELECTABLE_EXECUTION_MODES: WorkflowExecutionMode[] = ['streaming_headless', 'headless', 'interactive_pty'];
const MAX_RUNTIME_SNIPPET_BYTES = 3072;
const MODEL_DOC_URLS: Record<string, string | null> = {
  claude: 'https://code.claude.com/docs/en/model-config',
  gemini: 'https://ai.google.dev/gemini-api/docs/models',
  codex: 'https://developers.openai.com/codex/models',
  opencode: null,
};
const ARTIFACT_PATH_REGEX = /\b(?:\.{0,2}\/)?[a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|md|json|yaml|yml|toml|css|scss|html|sh|py|go|java|kt|swift|sql)\b/g;

function clampZoom(nextZoom: number) {
  return Math.max(0.35, Math.min(1.8, nextZoom));
}

function worldRect(node: MaterializedNode) {
  const rows = Math.max(node.inputs.length, node.outputs.length);
  const controlsHeight =
    node.node.type === 'workflow.task'
      ? 128
      : node.node.type === 'workflow.agent'
        ? 250
        : node.node.type === 'workflow.frame'
          ? 72
          : 56;
  const height = node.node.size?.height ?? 44 + rows * 24 + controlsHeight;
  return {
    x: node.node.location.x,
    y: node.node.location.y,
    width: node.node.size?.width ?? node.width,
    height,
  };
}

function socketPosition(node: MaterializedNode, socketId: string, direction: 'input' | 'output') {
  const sockets = direction === 'input' ? node.inputs : node.outputs;
  const rect = worldRect(node);
  const rowIndex = Math.max(0, sockets.findIndex(socket => socket.id === socketId));
  return {
    x: direction === 'input' ? rect.x : rect.x + rect.width,
    y: rect.y + 64 + rowIndex * 24,
  };
}

function bezierPath(from: Point2D, to: Point2D) {
  const delta = Math.max(40, Math.abs(to.x - from.x) * 0.4);
  return `M ${from.x} ${from.y} C ${from.x + delta} ${from.y}, ${to.x - delta} ${to.y}, ${to.x} ${to.y}`;
}

function pointFromMouse(clientX: number, clientY: number, rect: DOMRect) {
  return {
    x: clientX - rect.left,
    y: clientY - rect.top,
  };
}

function screenToWorld(screen: Point2D, pan: Point2D, zoom: number) {
  return {
    x: (screen.x - pan.x) / zoom,
    y: (screen.y - pan.y) / zoom,
  };
}

function isPointInsideRect(point: Point2D, rect: { x: number; y: number; width: number; height: number }) {
  return point.x >= rect.x && point.x <= rect.x + rect.width && point.y >= rect.y && point.y <= rect.y + rect.height;
}

function rectsIntersect(left: { x: number; y: number; width: number; height: number }, right: { x: number; y: number; width: number; height: number }) {
  return left.x < right.x + right.width && left.x + left.width > right.x && left.y < right.y + right.height && left.y + left.height > right.y;
}

function selectionRect(origin: Point2D, current: Point2D) {
  return {
    x: Math.min(origin.x, current.x),
    y: Math.min(origin.y, current.y),
    width: Math.abs(current.x - origin.x),
    height: Math.abs(current.y - origin.y),
  };
}

function toLinkCanvas(point: Point2D) {
  return { x: point.x + LINK_CANVAS_HALF, y: point.y + LINK_CANVAS_HALF };
}

function borderClass(selected: boolean) {
  return selected
    ? 'border-accent-primary shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent-primary)_60%,transparent)]'
    : 'border-border-panel shadow-[0_10px_24px_rgba(0,0,0,0.28)]';
}

const CLEAR_SCREEN_MARKERS = ['[2J', '[3J', '[H[J', 'c'];

function stripAnsi(raw: string): string {
  // For TUI apps (Claude/Ink, etc.) the buffer is a series of re-renders.
  // Start from the last full-screen clear so the inspector shows the current
  // frame, not ten stacked frames of cursor-positioned garbage.
  let start = -1;
  for (const marker of CLEAR_SCREEN_MARKERS) {
    const idx = raw.lastIndexOf(marker);
    if (idx > start) start = idx;
  }
  const tail = start >= 0 ? raw.slice(start) : raw;

  const stripped = tail
    // OSC (title, clipboard, hyperlinks) — terminated by BEL or ST.
    .replace(/\][^]*(?:|\\)/g, '')
    // DCS / SOS / PM / APC — terminated by ST.
    .replace(/[PX^_][\s\S]*?\\/g, '')
    // CSI (cursor/colour/etc).
    .replace(/\[[0-9;?]*[ -/]*[@-~]/g, '')
    // Character-set / single-shift / other short escapes.
    .replace(/[()#][\dA-Z]/g, '')
    .replace(/[=>DMHc78]/g, '');

  // Handle carriage returns as "overwrite the line so far" instead of dropping
  // them, so progress bars and re-printed lines show their final text only.
  return stripped
    .split('\n')
    .map(line => {
      if (!line.includes('\r')) return line;
      const parts = line.split('\r');
      return parts[parts.length - 1] ?? '';
    })
    .join('\n');
}


function shortId(value: string | null | undefined, max = 26): string {
  if (!value) return '—';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}



function groupModelsByProvider(models: CliModel[]): Array<{ provider: string; models: CliModel[] }> {
  const groups = new Map<string, CliModel[]>();
  for (const model of models) {
    if (model.source === 'default' || model.source === 'custom') continue;
    const provider = model.provider ?? (model.id.includes('/') ? model.id.split('/')[0] : 'Discovered');
    const current = groups.get(provider) ?? [];
    current.push(model);
    groups.set(provider, current);
  }
  return Array.from(groups.entries()).map(([provider, groupedModels]) => ({ provider, models: groupedModels }));
}

function extractArtifactHints(result: ResultEntry): string[] {
  if (result.type === 'url') {
    const url = result.content.trim();
    return url ? [`Preview ${url}`] : [];
  }
  const hits = new Set<string>();
  const text = stripAnsi(result.content);
  for (const match of text.matchAll(ARTIFACT_PATH_REGEX)) {
    const value = String(match[0] ?? '').trim();
    if (!value) continue;
    hits.add(value);
    if (hits.size >= 4) break;
  }
  return [...hits];
}

function ccw(a: Point2D, b: Point2D, c: Point2D) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

export function NodeTreePane(props: { graph: WorkflowGraph; onGraphChange?: (graph: WorkflowGraph) => void }) {
  const { graph, onGraphChange } = props;
  const workspaceDir = useWorkspaceStore(state => state.workspaceDir);
  const activeTabId = useWorkspaceStore(state => state.activeTabId);
  const tabs = useWorkspaceStore(state => state.tabs);
  const results = useWorkspaceStore(state => state.results);
  const addPane = useWorkspaceStore(state => state.addPane);
  const updatePaneDataByTerminalId = useWorkspaceStore(state => state.updatePaneDataByTerminalId);
  const setNodeTerminalBinding = useWorkspaceStore(state => state.setNodeTerminalBinding);
  const nodeRuntimeBindings = useWorkspaceStore(state => state.nodeRuntimeBindings);
  const openTerminals = useMemo(() => {
    const terminals: Array<{ id: string; title: string; cli: string | null; paneId: string }> = [];
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.type === 'terminal' && pane.data?.terminalId) {
          terminals.push({ id: pane.data.terminalId, title: pane.title, cli: (pane.data?.cli as string) ?? null, paneId: pane.id });
        }
      }
    }
    return terminals;
  }, [tabs]);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [lastAddedNodeId, setLastAddedNodeId] = useState<string | null>(null);
  const [inspectorCommand, setInspectorCommand] = useState('');
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [runtimeOutputByTerminalId, setRuntimeOutputByTerminalId] = useState<Record<string, string>>({});
  const [runtimeOutputByNodeId, setRuntimeOutputByNodeId] = useState<Record<string, string>>({});
  const [detectedModels, setDetectedModels] = useState<Map<CliId, ModelDiscoveryResult>>(new Map());
  const [loadingModels, setLoadingModels] = useState<Set<WorkflowAgentCli>>(new Set());
  const [customModelNodeIds, setCustomModelNodeIds] = useState<Set<string>>(new Set());
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const modelDropdownRef = useRef<HTMLDivElement>(null);

  const registry = useMemo(() => createWorkflowNodeRegistry(), []);
  const [state, setState] = useState<NodeDocumentState>(() => legacyGraphToNodeDocument(graph));
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: 'idle' });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [hoveredInput, setHoveredInput] = useState<LinkHoverTarget>(null);
  const [validationMessage, setValidationMessage] = useState('Node graph editor is active.');
  const [validationTone, setValidationTone] = useState<ValidationTone>('idle');
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const activeMissionRef = useRef<import('../../store/workspace').CompiledMission | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const suppressContextMenuRef = useRef(false);
  const lastGraphSnapshotRef = useRef(JSON.stringify(graph));
  const isUserChangeRef = useRef(false);
  const missionSnapshot = useMissionSnapshot(activeMissionId);

  // Sync pane.data.cli from the persisted graph node configs before any useEffect
  // (including TerminalPane's initPty) can fire. useLayoutEffect runs synchronously
  // after the DOM commit but before useEffects, so pane data is correct at spawn time.
  useLayoutEffect(() => {
    for (const node of graph.nodes) {
      const nodeCli = node.config?.cli;
      const terminalId = node.config?.terminalId;
      if (!nodeCli || !terminalId) continue;
      // Also stamp nodeId so handleCliChange can locate old persisted panes by nodeId.
      updatePaneDataByTerminalId(terminalId, { cli: nodeCli, nodeId: node.id });
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const incoming = JSON.stringify(graph);
    if (incoming !== lastGraphSnapshotRef.current) {
      isUserChangeRef.current = false;
      const newState = legacyGraphToNodeDocument(graph);
      setState(prev => {
        const runtimeKeys = ['terminalId', 'paneId', 'terminalTitle'] as const;
        for (const treeId of Object.keys(newState.document.trees)) {
          const newTree = newState.document.trees[treeId];
          const oldTree = prev.document.trees[treeId];
          if (!oldTree) continue;
          for (const nodeId of Object.keys(newTree.nodes)) {
            const oldNode = oldTree.nodes[nodeId];
            if (!oldNode) continue;
            let dirty = false;
            const patched = { ...newTree.nodes[nodeId], properties: { ...newTree.nodes[nodeId].properties } };
            for (const key of runtimeKeys) {
              if ((oldNode.properties as any)[key] && !(patched.properties as any)[key]) {
                (patched.properties as any)[key] = (oldNode.properties as any)[key];
                dirty = true;
              }
            }
            if (dirty) newTree.nodes[nodeId] = patched;
          }
        }
        return newState;
      });
      lastGraphSnapshotRef.current = incoming;
      setActiveMissionId(null);
    }
  }, [graph]);

  useEffect(() => {
    if (!isUserChangeRef.current) return;
    
    const serialized = nodeDocumentToWorkflowGraph(state.document, registry);
    const json = JSON.stringify(serialized);
    if (json !== lastGraphSnapshotRef.current) {
      lastGraphSnapshotRef.current = json;
      onGraphChange?.(serialized);
    }
  }, [onGraphChange, registry, state.document]);

  const applyOperator = useCallback(
    (operator: Parameters<typeof applyNodeEditorOperator>[3]) => {
      isUserChangeRef.current = true;
      setState(previous => applyNodeEditorOperator(previous.document, previous.editor, registry, operator));
    },
    [registry]
  );

  const activeTree = state.document.trees[getActiveTreeId(state.editor)];
  const view = getViewState(state.editor);
  const materializedNodes = useMemo(
    () => Object.values(activeTree.nodes).map(node => materializeNode(state.document, activeTree, node, registry)),
    [activeTree, registry, state.document]
  );
  const materializedById = useMemo(() => new Map(materializedNodes.map(node => [node.node.id, node])), [materializedNodes]);
  const missionAgents = useMemo(() => {
    const activeTab = tabs.find(tab => tab.id === activeTabId);
    const findMissionPane = (targetTabs: typeof tabs, missionId: string | null) => {
      for (const tab of targetTabs) {
        for (const pane of tab.panes) {
          if (pane.type !== 'missioncontrol') continue;
          const paneMissionId = typeof pane.data?.missionId === 'string' ? pane.data.missionId : null;
          if (!missionId || paneMissionId === missionId) return pane;
        }
      }
      return null;
    };

    let pane = activeTab ? findMissionPane([activeTab], activeMissionId) : null;
    if (!pane) pane = findMissionPane(tabs, activeMissionId);
    if (!pane && activeTab) pane = findMissionPane([activeTab], null);
    if (!pane) pane = findMissionPane(tabs, null);

    return ((pane?.data?.agents as MissionAgent[] | undefined) ?? []).filter(agent => Boolean(agent.nodeId));
  }, [activeMissionId, activeTabId, tabs]);
  const missionAgentByNodeId = useMemo(
    () => new Map(missionAgents.filter(agent => agent.nodeId).map(agent => [agent.nodeId as string, agent])),
    [missionAgents]
  );
  const artifactHintsByNodeId = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const agent of missionAgents) {
      if (!agent.nodeId) continue;

      const hints: string[] = [];

      // Priority 1: Structured artifacts
      if (agent.artifacts && agent.artifacts.length > 0) {
        for (const art of agent.artifacts) {
          const label = art.label;
          if (!hints.includes(label)) {
            hints.push(label);
            if (hints.length >= 5) break;
          }
        }
      }

      // Priority 2: Heuristic extraction from results (legacy support)
      if (hints.length < 4) {
        const candidates = new Set(
          [
            agent.runtimeSessionId,
            agent.terminalId,
            agent.title,
            agent.roleId,
          ]
            .map(value => String(value ?? '').trim().toLowerCase())
            .filter(Boolean)
        );

        if (candidates.size > 0) {
          for (let index = results.length - 1; index >= 0; index -= 1) {
            const result = results[index];
            if (!result) continue;
            if (!candidates.has(String(result.agentId ?? '').trim().toLowerCase())) continue;
            for (const hint of extractArtifactHints(result)) {
              if (!hints.includes(hint)) {
                hints.push(hint);
                if (hints.length >= 5) break;
              }
            }
            if (hints.length >= 5) break;
          }
        }
      }

      if (hints.length > 0) map.set(agent.nodeId, hints);
    }
    return map;
  }, [missionAgents, results]);
  const setRuntimeNodeState = useCallback(
    (nodeId: string, status: string, reason?: string | null) => {
      setState(previous => {
        const tree = previous.document.trees[getActiveTreeId(previous.editor)];
        if (!tree?.nodes[nodeId]) {
          return previous;
        }
        let next = applyNodeEditorOperator(previous.document, previous.editor, registry, {
          type: 'set_node_property',
          nodeId,
          key: 'status',
          value: status,
        });
        next = applyNodeEditorOperator(next.document, next.editor, registry, {
          type: 'set_node_property',
          nodeId,
          key: 'runtimeReason',
          value: reason ?? '',
        });
        next = applyNodeEditorOperator(next.document, next.editor, registry, {
          type: 'set_node_property',
          nodeId,
          key: 'runtimeUpdatedAt',
          value: Date.now(),
        });
        return next;
      });
    },
    [registry]
  );
  const selectedNodeIds = new Set(state.editor.selection.nodeIds);
  const nodeOptions = useMemo(
    () =>
      registry
        .list()
        .filter(entry => entry.type.startsWith('workflow.'))
        .sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label)),
    [registry]
  );

  useEffect(() => {
    if (inspectorNodeId && !activeTree.nodes[inspectorNodeId]) {
      setInspectorNodeId(null);
      setInspectorCommand('');
    }
  }, [activeTree.nodes, inspectorNodeId]);

  const findNodeAtWorld = useCallback(
    (point: Point2D) => materializedNodes.find(node => isPointInsideRect(point, worldRect(node))),
    [materializedNodes]
  );
  const boundAgentTerminalIds = useMemo(() => (
    [...new Set(
      Object.values(activeTree.nodes)
        .filter(node => node.type === 'workflow.agent')
        .filter(node => node.properties.executionMode === 'interactive_pty')
        .map(node => String(node.properties.terminalId ?? '').trim())
        .filter(Boolean)
    )].sort()
  ), [activeTree.nodes]);

  useEffect(() => {
    let unlistenActivation: (() => void) | undefined;
    let unlistenUpdate: (() => void) | undefined;
    let unlistenWarning: (() => void) | undefined;
    let unmounted = false;

    listen<{
      missionId: string;
      nodeId: string;
      attempt: number;
    }>('workflow-runtime-activation-requested', event => {
      if (unmounted) return;
      if (activeMissionId && event.payload.missionId !== activeMissionId) return;
      setRuntimeNodeState(event.payload.nodeId, 'launching', null);
    }).then(fn => {
      if (unmounted) {
        fn();
      } else {
        unlistenActivation = fn;
      }
    });

    listen<{
      id: string;
      status: string;
      attempt?: number;
      outcome?: 'success' | 'failure';
      reason?: string;
      action?: string;
    }>('workflow-node-update', event => {
      if (unmounted) return;
      const { id, status, reason, attempt, outcome } = event.payload;
      setRuntimeNodeState(id, status, reason ?? null);
      if (typeof attempt === 'number') {
        setState(previous => {
          const tree = previous.document.trees[getActiveTreeId(previous.editor)];
          if (!tree?.nodes[id]) return previous;
          return applyNodeEditorOperator(previous.document, previous.editor, registry, {
            type: 'set_node_property',
            nodeId: id,
            key: 'attempt',
            value: attempt,
          });
        });
      }
      if (outcome) {
        setState(previous => {
          const tree = previous.document.trees[getActiveTreeId(previous.editor)];
          if (!tree?.nodes[id]) return previous;
          return applyNodeEditorOperator(previous.document, previous.editor, registry, {
            type: 'set_node_property',
            nodeId: id,
            key: 'lastOutcome',
            value: outcome,
          });
        });
      }
    }).then(fn => {
      if (unmounted) {
        fn();
      } else {
        unlistenUpdate = fn;
      }
    });

    listen<{
      missionId: string;
      nodeId: string;
      message: string;
    }>('workflow-runtime-warning', event => {
      if (unmounted) return;
      if (activeMissionId && event.payload.missionId !== activeMissionId) return;
      setRuntimeNodeState(event.payload.nodeId, 'failed', event.payload.message);
    }).then(fn => {
      if (unmounted) {
        fn();
      } else {
        unlistenWarning = fn;
      }
    });

    return () => {
      unmounted = true;
      if (unlistenActivation) {
        unlistenActivation();
        unlistenActivation = undefined;
      }
      if (unlistenUpdate) {
        unlistenUpdate();
        unlistenUpdate = undefined;
      }
      if (unlistenWarning) {
        unlistenWarning();
        unlistenWarning = undefined;
      }
    };
  }, [activeMissionId, registry, setRuntimeNodeState]);


  const openTerminalById = useCallback((terminalId: string) => {
    const stateSnapshot = useWorkspaceStore.getState();
    const targetTab = stateSnapshot.tabs.find(tab =>
      tab.panes.some(pane => pane.type === 'terminal' && pane.data?.terminalId === terminalId)
    );
    if (!targetTab) {
      setValidationTone('error');
      setValidationMessage(`Terminal ${terminalId} is not available.`);
      return;
    }
    if (stateSnapshot.activeTabId !== targetTab.id) {
      stateSnapshot.switchTab(targetTab.id);
    }
    window.setTimeout(() => {
      emit('focus-terminal', { terminalId }).catch(() => {});
    }, 80);
  }, []);

  const refreshTerminalOutput = useCallback(async (terminalId: string) => {
    if (!terminalId) return;
    try {
      const output = await invoke<string>('get_pty_recent_output', {
        id: terminalId,
        maxBytes: MAX_RUNTIME_SNIPPET_BYTES,
      });
      const normalized = stripAnsi(output ?? '');
      setRuntimeOutputByTerminalId(previous => (
        previous[terminalId] === normalized
          ? previous
          : { ...previous, [terminalId]: normalized }
      ));
      setInspectorError(null);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInspectorError(message);
    }
  }, []);

  const createAndBindRuntime = useCallback(
    async (nodeId: string): Promise<{ id: string; paneId: string; title: string; cli: WorkflowAgentCli } | null> => {
      const node = activeTree.nodes[nodeId];
      const role = String(node?.properties.roleId ?? 'agent');
      const cli = SELECTABLE_WORKFLOW_CLIS.includes(node?.properties.cli as WorkflowAgentCli)
        ? (node?.properties.cli as WorkflowAgentCli)
        : 'claude';
      let executionMode = SELECTABLE_EXECUTION_MODES.includes(node?.properties.executionMode as WorkflowExecutionMode)
        ? (node?.properties.executionMode as WorkflowExecutionMode)
        : 'streaming_headless';

      if (executionMode !== 'interactive_pty' && !supportsHeadless(cli as any)) {
        executionMode = 'interactive_pty';
      }

      const title = `Runtime ${role}`;
      const terminalId = generateId();

      // Create a live session in RuntimeManager so it appears in Machine View
      // and is managed by the new canonical brain.
      const missionId = activeMissionId || `adhoc-${generateId().slice(0, 8)}`;
      
      try {
        // For interactive PTY, add the pane first so TerminalPane can spawn
        // before the executor tries to write to it.
        if (executionMode === 'interactive_pty') {
          addPane('terminal', title, {
            terminalId,
            nodeId,
            roleId: role,
            cli,
            cliSource: 'heuristic',
            executionMode,
          });
        }

        const session = await runtimeExecutor.startNodeRun({
          missionId,
          nodeId,
          attempt: Number(node?.properties.attempt ?? 0) + 1,
          role,
          agentId: role,
          profileId: role,
          cliId: cli,
          executionMode,
          terminalId,
          workspaceDir: workspaceDir || null,
          model: String(node?.properties.model ?? '') || null,
          yolo: Boolean(node?.properties.yolo),
        });

        if (executionMode === 'interactive_pty') {
          useWorkspaceStore.getState().updatePaneDataByTerminalId(terminalId, {
            runtimeSessionId: session.sessionId,
          });
        }

        // Update persistent node properties in a single batch if possible (though applyOperator is currently single-op)
        applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: terminalId });
        applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: title });
        applyOperator({ type: 'set_node_property', nodeId, key: 'status', value: 'launching' });

        setNodeTerminalBinding(nodeId, terminalId);

        setValidationTone('ok');
        setValidationMessage(`Runtime session ${session.sessionId.slice(0, 8)} started for node ${nodeId}.`);
        
        return { id: terminalId, paneId: '', title, cli };
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        setValidationTone('error');
        setValidationMessage(`Failed to start runtime: ${msg}`);
        return null;
      }
    },
    [activeMissionId, activeTree.nodes, addPane, applyOperator, setNodeTerminalBinding, workspaceDir]
  );

  const handleCliChange = useCallback(async (nodeId: string, newCli: WorkflowAgentCli) => {
    applyOperator({ type: 'set_node_property', nodeId, key: 'cli', value: newCli });
    applyOperator({ type: 'set_node_property', nodeId, key: 'model', value: '' });
    setCustomModelNodeIds(prev => {
      const next = new Set(prev);
      next.delete(nodeId);
      return next;
    });

    // Force interactive PTY if headless is unsupported for the new CLI
    if (!supportsHeadless(newCli)) {
      applyOperator({ type: 'set_node_property', nodeId, key: 'executionMode', value: 'interactive_pty' });
    }

    // Find the terminal pane by nodeId — more reliable than using node.properties.terminalId
    // which can drift out of sync with pane.data.terminalId.
    const storeState = useWorkspaceStore.getState();
    let boundPane: Pane | null = null;
    outer: for (const tab of storeState.tabs) {
      for (const pane of tab.panes) {
        if (pane.type === 'terminal' && pane.data?.nodeId === nodeId) {
          boundPane = pane;
          break outer;
        }
      }
    }

    if (!boundPane) {
      // Fallback: nodeId not stamped on pane — use nodeTerminalBindings (persisted, always fresh).
      const boundTerminalId = storeState.nodeTerminalBindings[nodeId];
      if (boundTerminalId) {
        outer2: for (const tab of storeState.tabs) {
          for (const pane of tab.panes) {
            if (pane.type === 'terminal' && pane.data?.terminalId === boundTerminalId) {
              boundPane = pane;
              break outer2;
            }
          }
        }
      }
    }

    if (!boundPane) return;

    const existingTerminalId = typeof boundPane.data?.terminalId === 'string'
      ? boundPane.data.terminalId
      : null;

    // Stop any active runtime session for this node before destroying the terminal.
    // Without this, RuntimeManager keeps a stale session that blocks the next launch.
    const runtimeBinding = storeState.nodeRuntimeBindings[nodeId];
    if (runtimeBinding?.runtimeSessionId) {
      try {
        await runtimeManager.stopRuntime({
          sessionId: runtimeBinding.runtimeSessionId,
          reason: 'CLI swapped by user',
        });
      } catch { /* session may already be cleaned up */ }
    }

    if (existingTerminalId) {
      try { await invoke('destroy_pty', { id: existingTerminalId }); } catch { /* already gone */ }
    }

    // Issue a fresh terminalId so TerminalPane's useEffect([terminalId]) re-runs
    // and spawns a new PTY with the new CLI. Use the pane's own id (stable) for
    // the update so we never miss due to a stale terminalId lookup.
    // Clear cliSource so shouldLaunchCliInTerminal doesn't skip launching the new CLI.
    const newTerminalId = generateId();
    storeState.updatePaneData(boundPane.id, { terminalId: newTerminalId, cli: newCli, model: '', cliSource: undefined });
    storeState.setNodeRuntimeBinding(nodeId, { terminalId: newTerminalId, runtimeSessionId: null, adapterStatus: null });
    applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: newTerminalId });
    setNodeTerminalBinding(nodeId, newTerminalId);
  }, [applyOperator, setNodeTerminalBinding]);

  const sendInspectorCommand = useCallback(async () => {
    if (!inspectorNodeId) return;
    const node = activeTree.nodes[inspectorNodeId];
    const terminalId = String(node?.properties.terminalId ?? '');
    const executionMode = SELECTABLE_EXECUTION_MODES.includes(node?.properties.executionMode as WorkflowExecutionMode)
      ? node?.properties.executionMode as WorkflowExecutionMode
      : 'streaming_headless';
    const command = inspectorCommand.trim();
    if (!terminalId || !command) return;
    if (executionMode !== 'interactive_pty') {
      setInspectorError('Commands can only be sent to interactive PTY runtimes.');
      return;
    }
    try {
      await runtimeManager.writeBootstrapToTerminal(terminalId, `${command}\r`, 'NodeTreePane.sendInspectorCommand');
      setInspectorCommand('');
      setInspectorError(null);
      setTimeout(() => {
        void refreshTerminalOutput(terminalId);
      }, 120);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setInspectorError(message);
    }
  }, [activeTree.nodes, inspectorCommand, inspectorNodeId, refreshTerminalOutput]);

  useEffect(() => {
    let unlistenAgentRunOutput: (() => void) | undefined;
    let unmounted = false;
    void terminalOutputBus.start();
    const unlistenTerminalOutput = (terminalId: string) => terminalOutputBus.subscribe(terminalId, event => {
      if (unmounted) return;
      const chunk = stripAnsi(event.text);
      if (!chunk) return;
      setRuntimeOutputByTerminalId(previous => {
        const merged = `${previous[terminalId] ?? ''}${chunk}`;
        const next = merged.length > MAX_RUNTIME_SNIPPET_BYTES
          ? merged.slice(merged.length - MAX_RUNTIME_SNIPPET_BYTES)
          : merged;
        return { ...previous, [terminalId]: next };
      });
    });
    const terminalOutputUnsubscribers = boundAgentTerminalIds.map(unlistenTerminalOutput);
    listen<{
      runId: string;
      missionId: string;
      nodeId: string;
      stream: 'stdout' | 'stderr';
      chunk: string;
      at: number;
    }>('agent-run-output', event => {
      if (unmounted) return;
      if (activeMissionId && event.payload.missionId !== activeMissionId) return;
      const { nodeId, stream, chunk } = event.payload;
      setRuntimeOutputByNodeId(previous => {
        const prefix = stream === 'stderr' ? '[stderr] ' : '';
        const merged = `${previous[nodeId] ?? ''}${prefix}${chunk}`;
        const next = merged.length > MAX_RUNTIME_SNIPPET_BYTES
          ? merged.slice(merged.length - MAX_RUNTIME_SNIPPET_BYTES)
          : merged;
        return { ...previous, [nodeId]: next };
      });
    }).then(unlisten => {
      unlistenAgentRunOutput = unlisten;
      if (unmounted) unlisten();
    });
    return () => {
      unmounted = true;
      for (const unlisten of terminalOutputUnsubscribers) unlisten();
      if (unlistenAgentRunOutput) unlistenAgentRunOutput();
    };
  }, [activeMissionId, boundAgentTerminalIds]);

  useEffect(() => {
    if (boundAgentTerminalIds.length === 0) return;

    let cancelled = false;
    const poll = async () => {
      await Promise.all(boundAgentTerminalIds.map(async terminalId => {
        try {
          const output = await invoke<string>('get_pty_recent_output', {
            id: terminalId,
            maxBytes: MAX_RUNTIME_SNIPPET_BYTES,
          });
          if (cancelled) return;
          const normalized = stripAnsi(output ?? '');
          setRuntimeOutputByTerminalId(previous => (
            previous[terminalId] === normalized
              ? previous
              : { ...previous, [terminalId]: normalized }
          ));
        } catch {
          // PTY may not be spawned yet; keep polling.
        }
      }));
    };

    void poll();
    const interval = window.setInterval(() => {
      void poll();
    }, 3500);
    return () => {
      cancelled = true;
      window.clearInterval(interval);
    };
  }, [boundAgentTerminalIds]);

  useEffect(() => {
    if (!inspectorNodeId) return;
    const node = activeTree.nodes[inspectorNodeId];
    if (!node || node.type !== 'workflow.agent') return;
    const executionMode = SELECTABLE_EXECUTION_MODES.includes(node.properties.executionMode as WorkflowExecutionMode)
      ? node.properties.executionMode as WorkflowExecutionMode
      : 'streaming_headless';
    if (executionMode !== 'interactive_pty') return;
    const terminalId = String(node.properties.terminalId ?? '').trim();
    if (!terminalId) return;
    void refreshTerminalOutput(terminalId);
  }, [activeTree.nodes, inspectorNodeId, refreshTerminalOutput]);

  const validateCurrentGraph = useCallback(() => {
    try {
      const flow = nodeDocumentToFlowGraph(state.document, registry);
      const result = validateGraph(flow.nodes as never[], flow.edges as never[]);
      setValidationTone('ok');
      setValidationMessage(`Graph validated. Task node ${result.taskNodeId} routes into ${result.agentNodeIds.length} executable node(s).`);
    } catch (error) {
      setValidationTone('error');
      setValidationMessage(error instanceof Error ? error.message : String(error));
    }
  }, [registry, state.document]);

  const runWorkflow = useCallback(async () => {
    try {
      const flow = nodeDocumentToFlowGraph(state.document, registry);
      validateGraph(flow.nodes as never[], flow.edges as never[]);

      // Phase 1 runtime adapter: every agent node owns a REAL terminal (PTY),
      // regardless of the node's selected executionMode. This keeps Run on a
      // direct graph -> PTY path and avoids the MCP-session dependency.
      const freshBindings = new Map<string, { id: string; title: string; paneId: string; cli: WorkflowAgentCli }>();
      const storedBindings = useWorkspaceStore.getState().nodeTerminalBindings;
      for (const node of flow.nodes) {
        if (node.type !== 'workflow.agent' && node.type !== 'agent') continue;
        const nodeId = String(node.id);
        const data = node.data as Record<string, unknown>;
        const selectedCli: WorkflowAgentCli = SELECTABLE_WORKFLOW_CLIS.includes(data.cli as WorkflowAgentCli)
          ? (data.cli as WorkflowAgentCli)
          : 'claude';
        const role = String(data.roleId ?? 'agent');

        // Force interactive PTY so each agent node owns a real terminal.
        applyOperator({ type: 'set_node_property', nodeId, key: 'executionMode', value: 'interactive_pty' });
        data.executionMode = 'interactive_pty';

        // If a real terminal is already bound and still open, reuse it.
        const currentTerminalId = typeof data.terminalId === 'string' ? data.terminalId : '';
        const storedTerminalId = storedBindings[nodeId];
        const resolvedTerminalId = currentTerminalId || storedTerminalId;
        // Read live from store instead of stale openTerminals React state
        const livePanes = useWorkspaceStore.getState().tabs.flatMap(t => t.panes);
        const liveResolvedPane = resolvedTerminalId
          ? livePanes.find(p => p.type === 'terminal' && p.data?.terminalId === resolvedTerminalId)
          : null;
        const openResolvedTerminal = liveResolvedPane
          ? { id: liveResolvedPane.data!.terminalId as string, cli: liveResolvedPane.data!.cli as WorkflowAgentCli, title: liveResolvedPane.title, paneId: liveResolvedPane.id }
          : null;
        const canReuseResolvedTerminal = openResolvedTerminal && openResolvedTerminal.cli === selectedCli;
        if (canReuseResolvedTerminal) {
          if (!currentTerminalId && storedTerminalId) {
            applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: storedTerminalId });
            const existing = openTerminals.find(t => t.id === storedTerminalId);
            if (existing) {
              applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: existing.title });
              applyOperator({ type: 'set_node_property', nodeId, key: 'paneId', value: existing.paneId });
            }
          }
          const existingTerminal = openResolvedTerminal!;
          freshBindings.set(nodeId, {
            id: resolvedTerminalId,
            title: existingTerminal.title,
            paneId: existingTerminal.paneId,
            cli: selectedCli,
          });
          continue;
        }
        if (openResolvedTerminal && openResolvedTerminal.cli !== selectedCli) {
          console.log(
            `[runWorkflow] rebinding node=${nodeId} terminal=${resolvedTerminalId} oldCli=${openResolvedTerminal.cli ?? '<unknown>'} newCli=${selectedCli}`,
          );
        }

        // Re-attach persisted binding if the terminal pane is still open
        const persistedId = storedBindings[nodeId];
        if (persistedId) {
          const existing = openTerminals.find(t => t.id === persistedId);
          if (existing && existing.cli === selectedCli) {
            applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: persistedId });
            applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: existing.title });
            applyOperator({ type: 'set_node_property', nodeId, key: 'paneId', value: existing.paneId });
            freshBindings.set(nodeId, { id: persistedId, title: existing.title, paneId: existing.paneId, cli: selectedCli });
            continue;
          }
        }

        // Remove any existing pane for this node before creating a new one.
        // Without this, old panes accumulate causing duplicate nodeId keys in RuntimeView.
        const storeBeforeCreate = useWorkspaceStore.getState();
        const allPanesBeforeCreate = storeBeforeCreate.tabs.flatMap(t => t.panes);
        const oldPane = allPanesBeforeCreate.find(p =>
          p.type === 'terminal' && p.data?.nodeId === nodeId
        );
        if (oldPane) {
          storeBeforeCreate.removePane(oldPane.id);
        }

        // Spawn a real terminal pane for this node (inline so it doesn't depend
        // on stale component state via createAndBindRuntime).
        const paneTitle = `Runtime ${role}`;
        const { paneId, terminalId } = useWorkspaceStore.getState().createRuntimeTerminal({
          nodeId,
          roleId: role,
          cli: selectedCli,
          executionMode: 'interactive_pty',
          title: paneTitle,
        });

        const created = { id: terminalId, paneId, title: paneTitle, cli: selectedCli };
        applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: created.id });
        applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: created.title });
        applyOperator({ type: 'set_node_property', nodeId, key: 'paneId', value: created.paneId });
        applyOperator({ type: 'set_node_property', nodeId, key: 'cli', value: selectedCli });
        setNodeTerminalBinding(nodeId, created.id);
        freshBindings.set(nodeId, created);
      }

      const hydratedNodes = flow.nodes.map(node => {
        if (node.type !== 'workflow.agent' && node.type !== 'agent') return node;
        const nodeId = String(node.id);
        const data: Record<string, unknown> = { ...((node.data ?? {}) as Record<string, unknown>) };
        const fresh = freshBindings.get(nodeId);
        if (fresh) {
          data.terminalId = fresh.id;
          data.terminalTitle = fresh.title;
          data.paneId = fresh.paneId;
          data.cli = fresh.cli;
        }
        if (!data.terminalId) throw new Error(`Agent node ${nodeId}: failed to create or find terminal binding.`);
        if (!data.terminalTitle) data.terminalTitle = `Terminal ${data.roleId ?? nodeId}`;
        return { ...node, data };
      });

      const missionId = generateId();
      const terminalClis = Object.fromEntries(
        openTerminals
          .filter(terminal => terminal.cli && SUPPORTED_WORKFLOW_CLIS.has(terminal.cli))
          .map(terminal => [terminal.id, terminal.cli as WorkflowAgentCli])
      );
      // Freshly staged bindings must win over any stale openTerminals snapshot.
      for (const [, binding] of freshBindings) {
        terminalClis[binding.id] = binding.cli;
      }
      const mission = compileMission({
        missionId,
        graphId: graph.id || 'graph',
        nodes: hydratedNodes as never[],
        edges: flow.edges as never[],
        workspaceDirFallback: workspaceDir,
        terminalClis,
        authoringMode: 'graph',
        runVersion: 1,
      });

      const agents: MissionAgent[] = mission.nodes.map(node => ({
        terminalId: node.terminal.terminalId,
        title: node.terminal.terminalTitle,
        roleId: node.roleId,
        paneId: node.terminal.paneId,
        status: 'idle',
        attempt: 0,
        lastPayload: null,
        attemptHistory: [],
        nodeId: node.id,
        runtimeSessionId: null,
        runtimeCli: node.terminal.cli,
        runtimeBootstrapState: 'NOT_CONNECTED',
        runtimeBootstrapReason: null,
      }));

      const nodeById = new Map(mission.nodes.map(node => [node.id, node]));
      const startNodes = mission.metadata.startNodeIds
        .map(nodeId => nodeById.get(nodeId))
        .filter((node): node is NonNullable<typeof node> => Boolean(node));
      if (startNodes.length === 0) {
        throw new Error('Compiled mission has no start nodes with terminal bindings.');
      }
      // Build a lookup that includes freshly spawned terminals not yet in the openTerminals memo
      const allKnownTerminals = new Map([
        ...openTerminals.map(t => [t.id, t] as const),
        ...[...freshBindings.entries()].map(([, b]) => [b.id, { id: b.id, title: b.title, paneId: b.paneId, cli: null }] as const),
      ]);
      for (const startNode of startNodes) {
        const terminal = allKnownTerminals.get(startNode.terminal.terminalId);
        if (!terminal) {
          throw new Error(`No terminal bound for start node ${startNode.id}.`);
        }
        // Skip CLI check for freshly spawned terminals — CLI is detected after first output
        if (terminal.cli !== null) {
          const cli = String(terminal.cli ?? '').trim().toLowerCase();
          if (!SUPPORTED_WORKFLOW_CLIS.has(cli)) {
            throw new Error(
              `CLI not detected or unsupported for ${startNode.terminal.terminalTitle} (${startNode.id}).`
            );
          }
        }
      }

      setActiveMissionId(missionId);
      activeMissionRef.current = mission;

      addPane('missioncontrol', 'Mission Control', {
        taskDescription: mission.task.prompt ?? '',
        agents,
        missionId,
        mission,
      });

      // Persist mission to shared SQLite so MCP tools (complete_task, get_task_details, etc.) can find it.
      // Uses seed_mission_to_db (not start_mission_graph) to avoid the Rust engine emitting
      // workflow-runtime-activation-requested, which would double-activate nodes alongside the TS orchestrator.
      await invoke('seed_mission_to_db', { missionId, graph: mission });

      // TS Orchestrator is the canonical runtime brain.
      const { missionOrchestrator } = await import('../../lib/workflow/MissionOrchestrator');
      await missionOrchestrator.launchMission(mission);

      const unsubFailures = (await import('../../lib/workflow/WorkflowOrchestrator')).workflowOrchestrator.subscribeForRun(missionId, (event) => {
        if (event.type !== 'node_failed') return;
        setValidationTone('error');
        setValidationMessage(`Node ${event.nodeId} failed: ${event.error ?? 'activation pipeline error'}`);
        unsubFailures.unsubscribe();
      });

      setValidationTone('ok');
      setValidationMessage(
        `Mission ${missionId.substring(0, 8)} registered. Activating nodes…`
      );
    } catch (error) {
      setActiveMissionId(null);
      setValidationTone('error');
      setValidationMessage(error instanceof Error ? error.message : String(error));
    }
  }, [registry, state.document, workspaceDir, graph.id, openTerminals, tabs, addPane, applyOperator, setNodeTerminalBinding]);

  const viewRuntimeMapping = useCallback(() => {
    try {
      const flow = nodeDocumentToFlowGraph(state.document, registry);
      const hydratedNodes = flow.nodes.map(node => {
        if (node.type !== 'workflow.agent' && node.type !== 'agent') return node;
        const data: Record<string, unknown> = { ...((node.data ?? {}) as Record<string, unknown>) };
        if (!data.terminalId) data.terminalId = `preview-term-${node.id}`;
        if (!data.terminalTitle) data.terminalTitle = `Preview ${data.roleId ?? node.id}`;
        return { ...node, data };
      });

      const mission = compileMission({
        missionId: 'preview-mission',
        graphId: 'preview-graph',
        nodes: hydratedNodes as never[],
        edges: flow.edges as never[],
        workspaceDirFallback: workspaceDir,
        terminalClis: {},
        authoringMode: 'graph',
        runVersion: 1,
      });

      const layerText = mission.metadata.executionLayers
        .map((layer, index) => `L${index + 1}: ${layer.join(', ')}`)
        .join(' | ');

      setValidationTone('ok');
      setValidationMessage(`Runtime mapping: start=[${mission.metadata.startNodeIds.join(', ')}] ${layerText}`);
    } catch (error) {
      setValidationTone('error');
      setValidationMessage(error instanceof Error ? error.message : String(error));
    }
  }, [registry, state.document, workspaceDir]);

  const importPresetGraph = useCallback(() => {
    const preset = getWorkflowPreset('parallel_delivery');
    if (!preset) return;

    const missionId = generateId();
    const bindingsByRole: Record<string, { terminalId: string; terminalTitle: string; paneId?: string }> = {};
    for (const terminal of openTerminals) {
      const role = detectRoleForPane({ title: terminal.title, data: {} });
      if (role && !bindingsByRole[role]) {
        bindingsByRole[role] = {
          terminalId: terminal.id,
          terminalTitle: terminal.title,
        };
      }
    }

    const flow = buildPresetFlowGraph({
      preset,
      missionId,
      prompt: 'Imported preset objective',
      mode: 'build',
      workspaceDir,
      bindingsByRole,
      instructionOverrides: {},
    });

    const workflowGraph: WorkflowGraph = {
      id: `preset:${preset.id}`,
      nodes: flow.nodes.map(node => {
        const data = node.data as Record<string, unknown>;
        if (node.type === 'task') {
          return {
            id: node.id,
            roleId: 'task',
            status: 'idle',
            config: {
              prompt: String(data.prompt ?? ''),
              mode: data.mode === 'edit' ? 'edit' : 'build',
              workspaceDir: String(data.workspaceDir ?? ''),
              position: node.position,
            },
          };
        }

        return {
          id: node.id,
          roleId: String(data.roleId ?? 'agent'),
          status: 'idle',
          config: {
            instructionOverride: String(data.instructionOverride ?? ''),
            terminalId: String(data.terminalId ?? ''),
            terminalTitle: String(data.terminalTitle ?? ''),
            paneId: String(data.paneId ?? ''),
            autoLinked: Boolean(data.autoLinked),
            position: node.position,
          },
        };
      }),
      edges: flow.edges.map(edge => ({
        fromNodeId: edge.source,
        toNodeId: edge.target,
        condition: edge.data.condition,
      })),
    };

    const snapshot = JSON.stringify(workflowGraph);
    lastGraphSnapshotRef.current = snapshot;
    setState(legacyGraphToNodeDocument(workflowGraph));
    onGraphChange?.(workflowGraph);
    setValidationTone('ok');
    setValidationMessage(`Imported preset "${preset.name}" into the graph editor.`);
  }, [onGraphChange, openTerminals, workspaceDir]);

  useEffect(() => {
    if (!lastAddedNodeId) return;
    
    // The node needs to be in activeTree for createAndBindRuntime to find it
    const node = activeTree.nodes[lastAddedNodeId];
    if (node && node.type === 'workflow.agent' && !node.properties.terminalId) {
      void createAndBindRuntime(lastAddedNodeId);
      setLastAddedNodeId(null);
    }
  }, [activeTree.nodes, createAndBindRuntime, lastAddedNodeId]);

  const addNodeAt = useCallback(
    (nodeType: string, location: Point2D, linkFrom?: { nodeId: string; socketId: string }) => {
      let connectError: string | null = null;
      setState(previous => {
        let next = applyNodeEditorOperator(previous.document, previous.editor, registry, { type: 'add_node', nodeType, location });
        const newNodeId = next.editor.activeNodeId;
        
        if (newNodeId) {
          setLastAddedNodeId(newNodeId);
        }

        if (newNodeId && linkFrom) {
          const tree = next.document.trees[getActiveTreeId(next.editor)];
          const newNode = tree.nodes[newNodeId];
          if (newNode) {
            const materialized = materializeNode(next.document, tree, newNode, registry);
            const firstInput = materialized.inputs[0];
            if (firstInput) {
              try {
                next = applyNodeEditorOperator(next.document, next.editor, registry, {
                  type: 'connect_sockets',
                  fromNodeId: linkFrom.nodeId,
                  fromSocketId: linkFrom.socketId,
                  toNodeId: newNodeId,
                  toSocketId: firstInput.id,
                });
              } catch (error) {
                connectError = error instanceof Error ? error.message : String(error);
              }
            }
          }
        }
        return next;
      });
      if (connectError) {
        setValidationTone('error');
        setValidationMessage(connectError);
      }
      setContextMenu(null);
    },
    [registry]
  );

  const deleteNodeById = useCallback(
    (nodeId: string) => {
      applyOperator({ type: 'set_selection', nodeIds: [nodeId], linkIds: [], activeNodeId: nodeId });
      applyOperator({ type: 'delete_selection' });
      setContextMenu(null);
    },
    [applyOperator]
  );

  const createFrameFromSelection = useCallback(() => {
    const selected = [...selectedNodeIds]
      .map(id => materializedById.get(id))
      .filter((node): node is MaterializedNode => Boolean(node))
      .filter(node => node.node.type !== 'workflow.frame');
    if (selected.length === 0) {
      return;
    }
    const rects = selected.map(worldRect);
    const minX = Math.min(...rects.map(rect => rect.x));
    const minY = Math.min(...rects.map(rect => rect.y));
    const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
    const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
    const frameRect = {
      x: minX - 24,
      y: minY - 40,
      width: maxX - minX + 48,
      height: maxY - minY + 64,
    };
    setState(previous => {
      let next = applyNodeEditorOperator(previous.document, previous.editor, registry, {
        type: 'add_node',
        nodeType: 'workflow.frame',
        location: { x: frameRect.x, y: frameRect.y },
      });
      const frameId = next.editor.activeNodeId;
      if (!frameId) {
        return next;
      }
      next = applyNodeEditorOperator(next.document, next.editor, registry, {
        type: 'set_node_size',
        nodeId: frameId,
        width: frameRect.width,
        height: frameRect.height,
      });
      return next;
    });
  }, [materializedById, registry, selectedNodeIds]);

  const cutLinksByKnife = useCallback(
    (from: Point2D, to: Point2D) => {
      const cutIds: string[] = [];
      for (const link of Object.values(activeTree.links)) {
        const fromNode = materializedById.get(link.from.nodeId);
        const toNode = materializedById.get(link.to.nodeId);
        if (!fromNode || !toNode) {
          continue;
        }
        const a = socketPosition(fromNode, link.from.socketId, 'output');
        const b = socketPosition(toNode, link.to.socketId, 'input');
        if (segmentsIntersect(from, to, a, b)) {
          cutIds.push(link.id);
        }
      }
      for (const linkId of cutIds) {
        applyOperator({ type: 'disconnect_link', linkId });
      }
      if (cutIds.length > 0) {
        setValidationTone('idle');
        setValidationMessage(`Knife cut removed ${cutIds.length} link(s).`);
      }
    },
    [activeTree.links, applyOperator, materializedById]
  );

  const onCanvasMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      setContextMenu(null);
      if (!canvasRef.current) {
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);
      const worldPoint = screenToWorld(screenPoint, view.pan, view.zoom);

      if (event.button === 2 && event.ctrlKey) {
        event.preventDefault();
        setInteraction({ kind: 'knife', worldOrigin: worldPoint, worldCurrent: worldPoint });
        return;
      }

      if (event.button === 1 || event.altKey) {
        setInteraction({ kind: 'panning', pointerOrigin: screenPoint, panOrigin: view.pan });
        return;
      }

      if (event.button !== 0) {
        return;
      }

      const clickedNode = findNodeAtWorld(worldPoint);
      if (clickedNode) {
        return;
      }

      applyOperator({ type: 'set_selection', nodeIds: [], linkIds: [], activeNodeId: undefined });
      setInteraction({ kind: 'box_select', worldOrigin: worldPoint, worldCurrent: worldPoint });
    },
    [applyOperator, findNodeAtWorld, view.pan, view.zoom]
  );

  const onCanvasContextMenu = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      event.preventDefault();
      if (suppressContextMenuRef.current || !canvasRef.current) {
        suppressContextMenuRef.current = false;
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const screen = pointFromMouse(event.clientX, event.clientY, rect);
      const world = screenToWorld(screen, view.pan, view.zoom);
      const hit = findNodeAtWorld(world);
      if (hit) {
        setContextMenu({ mode: 'node', nodeId: hit.node.id, screen, world });
        applyOperator({ type: 'set_selection', nodeIds: [hit.node.id], linkIds: [], activeNodeId: hit.node.id });
      } else {
        setContextMenu({ mode: 'canvas', screen, world });
      }
    },
    [applyOperator, findNodeAtWorld, view.pan, view.zoom]
  );

  useEffect(() => {
    if (interaction.kind === 'idle') {
      return;
    }

    function onWindowMouseMove(event: MouseEvent) {
      if (!canvasRef.current) {
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);
      const worldPoint = screenToWorld(screenPoint, view.pan, view.zoom);

      if (interaction.kind === 'panning') {
        applyOperator({
          type: 'set_view',
          pan: {
            x: interaction.panOrigin.x + (screenPoint.x - interaction.pointerOrigin.x),
            y: interaction.panOrigin.y + (screenPoint.y - interaction.pointerOrigin.y),
          },
        });
        return;
      }

      if (interaction.kind === 'dragging_nodes') {
        for (const [nodeId, origin] of Object.entries(interaction.nodeOrigins)) {
          applyOperator({
            type: 'set_node_location',
            nodeId,
            location: {
              x: origin.x + (screenPoint.x - interaction.pointerOrigin.x) / view.zoom,
              y: origin.y + (screenPoint.y - interaction.pointerOrigin.y) / view.zoom,
            },
          });
        }
        return;
      }

      if (interaction.kind === 'dragging_link') {
        setInteraction({ ...interaction, currentWorld: worldPoint });
        // Snap hoveredInput to nearest input socket within radius (Blender-style)
        let nearest: { nodeId: string; socketId: string } | null = null;
        let nearestDist = SOCKET_SNAP_RADIUS;
        for (const node of materializedNodes) {
          if (node.node.id === interaction.fromNodeId) continue;
          for (const socket of node.inputs) {
            const pos = socketPosition(node, socket.id, 'input');
            const dx = pos.x - worldPoint.x;
            const dy = pos.y - worldPoint.y;
            const dist = Math.sqrt(dx * dx + dy * dy);
            if (dist < nearestDist) {
              nearestDist = dist;
              nearest = { nodeId: node.node.id, socketId: socket.id };
            }
          }
        }
        setHoveredInput(nearest);
        return;
      }

      if (interaction.kind === 'box_select') {
        setInteraction({ kind: 'box_select', worldOrigin: interaction.worldOrigin, worldCurrent: worldPoint });
        return;
      }

      if (interaction.kind === 'knife') {
        setInteraction({ kind: 'knife', worldOrigin: interaction.worldOrigin, worldCurrent: worldPoint });
        return;
      }

      if (interaction.kind === 'resizing_frame') {
        const dx = (screenPoint.x - interaction.pointerOrigin.x) / view.zoom;
        const dy = (screenPoint.y - interaction.pointerOrigin.y) / view.zoom;
        let { x, y, width, height } = interaction.startRect;
        if (interaction.edge.includes('e')) {
          width += dx;
        }
        if (interaction.edge.includes('s')) {
          height += dy;
        }
        if (interaction.edge.includes('w')) {
          x += dx;
          width -= dx;
        }
        if (interaction.edge.includes('n')) {
          y += dy;
          height -= dy;
        }
        if (width < FRAME_MIN_WIDTH) {
          if (interaction.edge.includes('w')) {
            x -= FRAME_MIN_WIDTH - width;
          }
          width = FRAME_MIN_WIDTH;
        }
        if (height < FRAME_MIN_HEIGHT) {
          if (interaction.edge.includes('n')) {
            y -= FRAME_MIN_HEIGHT - height;
          }
          height = FRAME_MIN_HEIGHT;
        }
        applyOperator({ type: 'set_node_location', nodeId: interaction.nodeId, location: { x, y } });
        applyOperator({ type: 'set_node_size', nodeId: interaction.nodeId, width, height });
      }
    }

    function onWindowMouseUp(event: MouseEvent) {
      if (!canvasRef.current) {
        setInteraction({ kind: 'idle' });
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);
      const worldPoint = screenToWorld(screenPoint, view.pan, view.zoom);

      if (interaction.kind === 'dragging_link') {
        if (hoveredInput) {
          try {
            applyOperator({
              type: 'connect_sockets',
              fromNodeId: interaction.fromNodeId,
              fromSocketId: interaction.fromSocketId,
              toNodeId: hoveredInput.nodeId,
              toSocketId: hoveredInput.socketId,
            });
            setValidationTone('idle');
            setValidationMessage('Link connected.');
          } catch (error) {
            setValidationTone('error');
            setValidationMessage(error instanceof Error ? error.message : String(error));
          }
        } else {
          setContextMenu({
            mode: 'link_insert',
            screen: screenPoint,
            world: worldPoint,
            linkFrom: { nodeId: interaction.fromNodeId, socketId: interaction.fromSocketId },
          });
        }
        setHoveredInput(null);
      }

      if (interaction.kind === 'box_select') {
        const box = selectionRect(interaction.worldOrigin, interaction.worldCurrent);
        const boxNodeIds = materializedNodes.filter(node => rectsIntersect(box, worldRect(node))).map(node => node.node.id);
        applyOperator({ type: 'set_selection', nodeIds: boxNodeIds, linkIds: [], activeNodeId: boxNodeIds[0] });
      }

      if (interaction.kind === 'knife') {
        cutLinksByKnife(interaction.worldOrigin, interaction.worldCurrent);
        suppressContextMenuRef.current = true;
      }

      if (interaction.kind !== 'idle') {
        setState(previous => ({
          ...previous,
          editor: {
            ...previous.editor,
            pendingLinkStart: undefined,
          },
        }));
      }
      setInteraction({ kind: 'idle' });
    }

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [applyOperator, cutLinksByKnife, hoveredInput, interaction, materializedNodes, view.pan, view.zoom]);

  useEffect(() => {
    function onWindowKeyDown(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null;
      if (target && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) {
        return;
      }
      if (event.key === 'Delete' || event.key === 'Backspace') {
        event.preventDefault();
        applyOperator({ type: 'delete_selection' });
        setContextMenu(null);
        return;
      }
      if (event.key.toLowerCase() === 'f') {
        event.preventDefault();
        createFrameFromSelection();
      }
    }
    window.addEventListener('keydown', onWindowKeyDown);
    return () => window.removeEventListener('keydown', onWindowKeyDown);
  }, [applyOperator, createFrameFromSelection]);

  const handleCanvasWheel = useCallback(
    (event: WheelEvent) => {
      event.preventDefault();
      if (!canvasRef.current) {
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);
      const worldBefore = screenToWorld(screenPoint, view.pan, view.zoom);
      const nextZoom = clampZoom(view.zoom + (event.deltaY > 0 ? -0.08 : 0.08));
      const nextPan = {
        x: screenPoint.x - worldBefore.x * nextZoom,
        y: screenPoint.y - worldBefore.y * nextZoom,
      };
      applyOperator({ type: 'set_view', pan: nextPan, zoom: nextZoom });
    },
    [applyOperator, view.pan, view.zoom]
  );

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleCanvasWheel);
    };
  }, [handleCanvasWheel]);

  const startNodeDrag = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, node: NodeInstance) => {
      event.stopPropagation();
      if (!canvasRef.current) {
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const point = pointFromMouse(event.clientX, event.clientY, rect);
      const nextSelection = selectedNodeIds.has(node.id) ? [...selectedNodeIds] : [node.id];
      applyOperator({ type: 'set_selection', nodeIds: nextSelection, linkIds: [], activeNodeId: node.id });
      const nodeOrigins = Object.fromEntries(nextSelection.map(nodeId => [nodeId, activeTree.nodes[nodeId]?.location ?? node.location]));
      setInteraction({ kind: 'dragging_nodes', pointerOrigin: point, nodeOrigins });
    },
    [activeTree.nodes, applyOperator, selectedNodeIds]
  );

  const beginLinkDrag = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, nodeId: string, socketId: string) => {
      event.stopPropagation();
      event.preventDefault();
      const sourceNode = materializedById.get(nodeId);
      if (!sourceNode) {
        return;
      }
      const fromWorld = socketPosition(sourceNode, socketId, 'output');
      setState(previous => ({
        ...previous,
        editor: {
          ...previous.editor,
          pendingLinkStart: { nodeId, socketId },
        },
      }));
      setInteraction({
        kind: 'dragging_link',
        fromNodeId: nodeId,
        fromSocketId: socketId,
        fromWorld,
        currentWorld: fromWorld,
      });
    },
    [materializedById]
  );

  const startFrameResize = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, nodeId: string, edge: ResizeEdge) => {
      event.stopPropagation();
      event.preventDefault();
      if (!canvasRef.current) {
        return;
      }
      const materialized = materializedById.get(nodeId);
      if (!materialized) {
        return;
      }
      const rect = canvasRef.current.getBoundingClientRect();
      const pointerOrigin = pointFromMouse(event.clientX, event.clientY, rect);
      const startRect = worldRect(materialized);
      applyOperator({ type: 'set_selection', nodeIds: [nodeId], linkIds: [], activeNodeId: nodeId });
      setInteraction({ kind: 'resizing_frame', nodeId, edge, pointerOrigin, startRect });
    },
    [applyOperator, materializedById]
  );

  const triggerModelDetection = useCallback((cli: WorkflowAgentCli, refresh = false) => {
    if (!supportsModelDiscovery(cli)) return;
    setLoadingModels(prev => { const s = new Set(prev); s.add(cli); return s; });
    const minDelay = new Promise<void>(resolve => setTimeout(resolve, 2000));
    const discovery = discoverModelsForCli(cli, { refresh, workspaceDir }).then(result => {
      setDetectedModels(prev => new Map(prev).set(cli, result));
    }).catch(error => {
      const result: ModelDiscoveryResult = {
        cli,
        models: [],
        attempts: [],
        errors: [error instanceof Error ? error.message : String(error)],
        fetchedAt: new Date().toISOString(),
      };
      setDetectedModels(prev => new Map(prev).set(cli, result));
    });
    Promise.all([discovery, minDelay]).finally(() => {
      setLoadingModels(prev => { const s = new Set(prev); s.delete(cli); return s; });
    });
  }, [workspaceDir]);

  const inspectedNode = inspectorNodeId ? activeTree.nodes[inspectorNodeId] : null;
  const inspectedRuntimeAgent = inspectorNodeId ? missionAgentByNodeId.get(inspectorNodeId) : undefined;
  const inspectedSnapshotNode = inspectorNodeId ? missionSnapshot?.nodes.find(n => n.nodeId === inspectorNodeId) : undefined;
  const inspectedTerminalId = String(inspectedSnapshotNode?.terminalId ?? inspectedNode?.properties.terminalId ?? inspectedRuntimeAgent?.terminalId ?? '').trim();
  const inspectedTerminal = openTerminals.find(terminal => terminal.id === inspectedTerminalId);
  const inspectedExecutionMode = SELECTABLE_EXECUTION_MODES.includes(inspectedNode?.properties.executionMode as WorkflowExecutionMode)
    ? inspectedNode?.properties.executionMode as WorkflowExecutionMode
    : 'streaming_headless';
  const inspectedUsesPty = inspectedExecutionMode === 'interactive_pty';
  const inspectorOutput = inspectorNodeId
    ? (inspectedUsesPty ? (runtimeOutputByTerminalId[inspectedTerminalId] ?? '') : (runtimeOutputByNodeId[inspectorNodeId] ?? ''))
    : '';

  const inspectedCli = (SELECTABLE_WORKFLOW_CLIS.includes(String(inspectedNode?.properties.cli ?? '') as WorkflowAgentCli)
    ? String(inspectedNode?.properties.cli ?? 'claude')
    : 'claude') as WorkflowAgentCli;

  useEffect(() => {
    if (!inspectorNodeId) return;
    if (supportsModelDiscovery(inspectedCli) && !detectedModels.has(inspectedCli) && !loadingModels.has(inspectedCli)) {
      triggerModelDetection(inspectedCli);
    }
  }, [inspectorNodeId, inspectedCli, detectedModels, loadingModels, triggerModelDetection]);

  useEffect(() => {
    if (!modelDropdownOpen) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpen]);

  return (
    <div className="h-full w-full background-bg-app text-text-primary flex flex-col">
      <div className="h-12 shrink-0 border-b border-border-panel px-3 flex items-center justify-between background-bg-titlebar">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-accent-primary">
          <Workflow size={14} />
          <span>Node Graph Architecture</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {state.editor.treePath.length > 1 && (
            <button
              onClick={() => applyOperator({ type: 'end_group_edit' })}
              className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-panel"
            >
              <ChevronLeft size={12} className="inline mr-1" />
              Back
            </button>
          )}
          <button onClick={runWorkflow} className="px-2.5 py-1 rounded border border-accent-primary text-accent-primary hover:bg-accent-primary/10">
            <Play size={12} className="inline mr-1" />
            Run
          </button>
          <button onClick={validateCurrentGraph} className="px-2.5 py-1 rounded border border-border-panel text-accent-primary hover:background-bg-panel">
            <ScanSearch size={12} className="inline mr-1" />
            Validate
          </button>
          <button onClick={viewRuntimeMapping} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-panel">
            Runtime Map
          </button>
          <button onClick={importPresetGraph} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-panel">
            <Sparkles size={12} className="inline mr-1" />
            Import Preset
          </button>
          <button onClick={() => applyOperator({ type: 'delete_selection' })} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-red-300 hover:bg-red-500/10">
            <Trash2 size={12} className="inline mr-1" />
            Delete
          </button>
        </div>
      </div>

      <div className="px-3 py-2 shrink-0 border-b border-border-panel background-bg-surface flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          {state.editor.treePath.map((treeId, index) => (
            <span key={treeId} className={index === state.editor.treePath.length - 1 ? 'text-text-primary' : 'text-text-muted'}>
              {state.document.trees[treeId]?.name ?? treeId}
              {index < state.editor.treePath.length - 1 ? ' / ' : ''}
            </span>
          ))}
        </div>
        <div className={validationTone === 'error' ? 'text-red-300' : validationTone === 'ok' ? 'text-emerald-300' : 'text-text-muted'}>{validationMessage}</div>
      </div>

      <div ref={canvasRef} className="relative flex-1 overflow-hidden" onMouseDown={onCanvasMouseDown} onContextMenu={onCanvasContextMenu}>
        <DotTunnelBackground />
        <div
          className="absolute inset-0 opacity-60"
          style={{
            backgroundImage:
              'linear-gradient(rgba(120,150,180,0.08) 1px, transparent 1px), linear-gradient(90deg, rgba(120,150,180,0.08) 1px, transparent 1px)',
            backgroundSize: `${GRID_SIZE}px ${GRID_SIZE}px`,
            backgroundPosition: `${view.pan.x % GRID_SIZE}px ${view.pan.y % GRID_SIZE}px`,
          }}
        />

        <div className="absolute inset-0" style={{ transform: `translate(${view.pan.x}px, ${view.pan.y}px) scale(${view.zoom})`, transformOrigin: '0 0' }}>
          <svg
            className="absolute pointer-events-none overflow-visible"
            style={{ left: -LINK_CANVAS_HALF, top: -LINK_CANVAS_HALF, width: LINK_CANVAS_SIZE, height: LINK_CANVAS_SIZE }}
          >
            {Object.values(activeTree.links).map(link => {
              const fromNode = materializedById.get(link.from.nodeId);
              const toNode = materializedById.get(link.to.nodeId);
              if (!fromNode || !toNode) {
                return null;
              }
              const from = toLinkCanvas(socketPosition(fromNode, link.from.socketId, 'output'));
              const to = toLinkCanvas(socketPosition(toNode, link.to.socketId, 'input'));
              return <path key={link.id} d={bezierPath(from, to)} stroke="var(--border-divider)" strokeWidth={2} fill="none" />;
            })}
            {interaction.kind === 'dragging_link' && (() => {
              let tipWorld = interaction.currentWorld;
              if (hoveredInput) {
                const snapNode = materializedById.get(hoveredInput.nodeId);
                if (snapNode) tipWorld = socketPosition(snapNode, hoveredInput.socketId, 'input');
              }
              const isSnapped = hoveredInput !== null;
              return (
                <path
                  d={bezierPath(toLinkCanvas(interaction.fromWorld), toLinkCanvas(tipWorld))}
                  stroke="var(--accent-primary)"
                  strokeWidth={isSnapped ? 2.5 : 2}
                  strokeDasharray={isSnapped ? undefined : '5 4'}
                  fill="none"
                />
              );
            })()}
            {interaction.kind === 'knife' && (
              <line
                x1={toLinkCanvas(interaction.worldOrigin).x}
                y1={toLinkCanvas(interaction.worldOrigin).y}
                x2={toLinkCanvas(interaction.worldCurrent).x}
                y2={toLinkCanvas(interaction.worldCurrent).y}
                stroke="#ff8c6b"
                strokeWidth={2}
                strokeDasharray="7 5"
              />
            )}
          </svg>

          {(() => {
            const connectedInputKeys = new Set(Object.values(activeTree.links).map(link => `${link.to.nodeId}:${link.to.socketId}`));
            return materializedNodes.map(materializedNode => {
            const rect = worldRect(materializedNode);
            const isSelected = selectedNodeIds.has(materializedNode.node.id);
            const isFrame = materializedNode.node.type === 'workflow.frame';
            const runtimeAgent = missionAgentByNodeId.get(materializedNode.node.id);
            const runtimeBinding = nodeRuntimeBindings[materializedNode.node.id];
            
            const snapshotNode = missionSnapshot?.nodes.find(n => n.nodeId === materializedNode.node.id);
            
            const runtimeStatus = String(
              snapshotNode?.status ??
              runtimeAgent?.status ??
              runtimeBinding?.adapterStatus ??
              materializedNode.node.properties.status ??
              'idle'
            );
            const runtimeReason = String(
              runtimeAgent?.lastError ??
              materializedNode.node.properties.runtimeReason ??
              ''
            ).trim();
            const terminalId = String(
              snapshotNode?.terminalId ??
              runtimeAgent?.terminalId ??
              materializedNode.node.properties.terminalId ??
              runtimeBinding?.terminalId ??
              ''
            ).trim();
            
            const attemptCount = snapshotNode?.attempt ?? Number(materializedNode.node.properties.attempt ?? 0);
            
            const terminal = openTerminals.find(entry => entry.id === terminalId);
            const runtimeCli = String(
              materializedNode.node.properties.cli ??
              terminal?.cli ??
              runtimeAgent?.runtimeCli ??
              materializedNode.node.properties.runtimeCli ??
              'claude'
            ).trim();
            const runtimeSessionId = String(runtimeAgent?.runtimeSessionId ?? runtimeBinding?.runtimeSessionId ?? '').trim();
            const artifactHints = artifactHintsByNodeId.get(materializedNode.node.id) ?? [];
            return (
              <div
                key={materializedNode.node.id}
                className={`absolute rounded-xl border background-bg-panel ${borderClass(isSelected)}`}
                style={{ left: rect.x, top: rect.y, width: rect.width, minHeight: rect.height, zIndex: isFrame ? 0 : 10 }}
                onDoubleClick={() => {
                  if (materializedNode.node.type === 'workflow.group') {
                    applyOperator({ type: 'begin_group_edit', nodeId: materializedNode.node.id });
                  }
                }}
              >
                <div className="h-11 px-3 rounded-t-xl border-b border-border-panel flex items-center justify-between background-bg-titlebar" onMouseDown={event => startNodeDrag(event, materializedNode.node)}>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-accent-primary">{registry.get(materializedNode.node.type).category}</div>
                    <div className="text-sm font-semibold text-text-primary">
                      {materializedNode.node.type === 'workflow.agent' ? 'Agent' :
                       materializedNode.node.type === 'workflow.task' ? 'Task' :
                       (materializedNode.node.label ?? registry.get(materializedNode.node.type).label)}
                    </div>
                  </div>
                  <div className={`flex items-center gap-1.5 text-[10px] uppercase tracking-wide px-2 py-1 rounded border ${workflowStatusTone(runtimeStatus, 'graph')}`}>
                    {attemptCount > 0 && <span className="opacity-70">#{attemptCount}</span>}
                    <span>{workflowStatusLabel(runtimeStatus)}</span>
                  </div>
                </div>

                <div className="px-3 py-3 relative">
                  {materializedNode.inputs.map((socket, index) => {
                    const isSnapTarget = hoveredInput?.nodeId === materializedNode.node.id && hoveredInput?.socketId === socket.id;
                    const isConnected = connectedInputKeys.has(`${materializedNode.node.id}:${socket.id}`);
                    const isFilled = isSnapTarget || isConnected;
                    return (
                      <button
                        key={socket.id}
                        className={`absolute left-0 w-4 h-4 -translate-x-1/2 rounded-full border border-accent-primary transition-all duration-75 ${isFilled ? 'bg-accent-primary' : 'background-bg-app'}`}
                        style={{ top: 12 + index * 24, ...(isSnapTarget ? { boxShadow: '0 0 4px var(--accent-primary), 0 0 10px var(--accent-primary), 0 0 22px var(--accent-primary)' } : {}) }}
                        onMouseEnter={() => { if (interaction.kind !== 'dragging_link') setHoveredInput({ nodeId: materializedNode.node.id, socketId: socket.id }); }}
                        onMouseLeave={() => { if (interaction.kind !== 'dragging_link') setHoveredInput(current => (current?.nodeId === materializedNode.node.id && current?.socketId === socket.id ? null : current)); }}
                        title={`${socket.name} (${socket.dataType})`}
                      />
                    );
                  })}
                  {materializedNode.outputs.map((socket, index) => {
                    const isConnectedOutput = Object.values(activeTree.links).some(link => link.from.nodeId === materializedNode.node.id && link.from.socketId === socket.id);
                    return (
                      <button
                        key={socket.id}
                        className={`absolute right-0 w-4 h-4 translate-x-1/2 rounded-full border border-accent-primary ${isConnectedOutput ? 'bg-accent-primary' : 'background-bg-app'}`}
                        style={{ top: 12 + index * 24 }}
                        onMouseDown={event => beginLinkDrag(event, materializedNode.node.id, socket.id)}
                        title={`${socket.name} (${socket.dataType})`}
                      />
                    );
                  })}

                  <div className="grid grid-cols-[1fr_auto_1fr] gap-3 text-[11px] text-text-muted mb-4">
                    <div className="space-y-2">{materializedNode.inputs.map(socket => <div key={socket.id}>{socket.name}</div>)}</div>
                    <div />
                    <div className="space-y-2 text-right">{materializedNode.outputs.map(socket => <div key={socket.id}>{socket.name}</div>)}</div>
                  </div>

                  {runtimeReason && (
                    <div className="mb-3 rounded border border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200 break-words">
                      {runtimeReason}
                    </div>
                  )}

                  {materializedNode.node.type === 'workflow.task' && (
                    <div className="space-y-2">
                      <textarea
                        rows={5}
                        value={String(materializedNode.node.properties.prompt ?? '')}
                        onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'prompt', value: event.target.value })}
                        onWheel={event => event.stopPropagation()}
                        placeholder="Task prompt"
                        className="w-full background-bg-surface border border-border-panel rounded-lg px-2 py-2 text-[11px] text-text-primary resize-none"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={String(materializedNode.node.properties.mode ?? 'build')}
                          onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'mode', value: event.target.value })}
                          className="background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                        >
                          <option value="build">Build</option>
                          <option value="edit">Edit</option>
                        </select>
                        <input
                          value={String(materializedNode.node.properties.workspaceDir ?? workspaceDir ?? '')}
                          onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'workspaceDir', value: event.target.value })}
                          placeholder="Workspace dir"
                          className="background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                        />
                      </div>
                    </div>
                  )}

                  {materializedNode.node.type === 'workflow.agent' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={String(materializedNode.node.properties.roleId ?? 'agent')}
                          onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'roleId', value: event.target.value })}
                          className="flex-1 background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                        >
                          {agentsConfig.agents.map(agent => (
                            <option key={agent.id} value={agent.id}>
                              {agent.name}
                            </option>
                          ))}
                        </select>
                        <select
                          value={SELECTABLE_WORKFLOW_CLIS.includes(String(materializedNode.node.properties.cli ?? runtimeCli) as WorkflowAgentCli)
                            ? String(materializedNode.node.properties.cli ?? runtimeCli)
                            : 'claude'}
                          onChange={event => handleCliChange(materializedNode.node.id, event.target.value as WorkflowAgentCli)}
                          className="flex-1 background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                          title="Runtime CLI"
                        >
                          {SELECTABLE_WORKFLOW_CLIS.map(cli => (
                            <option key={cli} value={cli}>{cli.toUpperCase()}</option>
                          ))}
                        </select>
                      </div>
                      {(() => {
                        const activeCli = (SELECTABLE_WORKFLOW_CLIS.includes(String(materializedNode.node.properties.cli ?? runtimeCli) as WorkflowAgentCli)
                          ? String(materializedNode.node.properties.cli ?? runtimeCli)
                          : 'claude') as WorkflowAgentCli;
                        const isSupported = supportsModelDiscovery(activeCli);
                        const modelResult = isSupported ? detectedModels.get(activeCli) : undefined;
                        const discoveredModels = modelResult?.models ?? [];
                        const groupedModels = groupModelsByProvider(discoveredModels);
                        const isLoading = loadingModels.has(activeCli);
                        const currentModel = String(materializedNode.node.properties.model ?? '');
                        const discoveredIds = new Set(discoveredModels.map(model => model.id));
                        const hasDiscoveryResult = Boolean(modelResult);
                        const isCustomOpen = hasDiscoveryResult && (customModelNodeIds.has(materializedNode.node.id) || Boolean(currentModel && !discoveredIds.has(currentModel)));
                        const isYolo = Boolean(materializedNode.node.properties.yolo);
                        return (
                          <div className="grid gap-2" style={{ gridTemplateColumns: '1fr auto' }}>
                            {isSupported ? (
                              <div className="min-w-0 space-y-1">
                                <div className="relative" ref={modelDropdownRef}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const opening = !modelDropdownOpen;
                                      setModelDropdownOpen(opening);
                                      if (opening && !isLoading && !modelResult) {
                                        triggerModelDetection(activeCli, false);
                                      }
                                    }}
                                    className="w-full min-w-0 background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px] text-text-secondary flex items-center justify-between"
                                  >
                                    <span className="truncate">{currentModel || 'MODEL'}</span>
                                    <ChevronDown size={10} className="text-text-muted" />
                                  </button>
                                  {modelDropdownOpen && (
                                    <div className="absolute z-50 left-0 right-0 top-full mt-1 background-bg-surface border border-border-panel rounded-lg shadow-lg max-h-60 overflow-y-auto py-1" onWheel={e => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-white/5 ${currentModel === '' ? 'text-accent-primary' : 'text-text-secondary'}`}
                                        onClick={() => {
                                          setCustomModelNodeIds(prev => { const next = new Set(prev); next.delete(materializedNode.node.id); return next; });
                                          applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'model', value: '' });
                                          setModelDropdownOpen(false);
                                        }}
                                      >
                                        Default model
                                      </button>
                                      {isLoading && (
                                        <ModelDiscoveryLoading cli={activeCli} phase="searching" />
                                      )}
                                      {!isLoading && modelResult && groupedModels.map(group => (
                                        <div key={group.provider}>
                                          <div className="px-2 py-1 text-[9px] uppercase tracking-wider text-text-muted">{group.provider}</div>
                                          {group.models.map(model => (
                                            <button
                                              key={model.id}
                                              type="button"
                                              className={`w-full text-left px-3 py-1 text-[11px] hover:bg-white/5 ${currentModel === model.id ? 'text-accent-primary' : 'text-text-secondary'}`}
                                              onClick={() => {
                                                setCustomModelNodeIds(prev => { const next = new Set(prev); next.delete(materializedNode.node.id); return next; });
                                                applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'model', value: model.id });
                                                setModelDropdownOpen(false);
                                              }}
                                            >
                                              {model.label}
                                            </button>
                                          ))}
                                        </div>
                                      ))}
                                      {!isLoading && modelResult && discoveredModels.length === 0 && (
                                        <div className="px-2 py-1.5 text-[10px] text-text-muted">No models discovered</div>
                                      )}
                                      {modelResult && (
                                        <button
                                          type="button"
                                          className="w-full text-left px-2 py-1.5 text-[11px] hover:bg-white/5 text-text-muted border-t border-border-panel/50 mt-1"
                                          onClick={() => {
                                            setCustomModelNodeIds(prev => new Set(prev).add(materializedNode.node.id));
                                            setModelDropdownOpen(false);
                                          }}
                                        >
                                          Custom model ID...
                                        </button>
                                      )}
                                    </div>
                                  )}
                                </div>
                                {isCustomOpen && (
                                  <div className="group relative">
                                    <input
                                      value={currentModel}
                                      onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'model', value: event.target.value })}
                                      placeholder="model name"
                                      className="w-full min-w-0 background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px] text-text-secondary"
                                    />
                                    <div className="absolute left-0 top-full z-50 pt-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
                                      <div className="whitespace-nowrap rounded border border-border-panel background-bg-panel px-2.5 py-1.5 text-[10px] text-text-secondary shadow-lg">
                                        {MODEL_DOC_URLS[activeCli] ? (
                                          <>Available models: <button type="button" onClick={() => openUrl(MODEL_DOC_URLS[activeCli]!)} className="text-accent-primary underline underline-offset-2 cursor-pointer">{MODEL_DOC_URLS[activeCli]!.replace('https://', '')}</button></>
                                        ) : activeCli === 'opencode' ? (
                                          'Check with provider for specific model names'
                                        ) : (
                                          'Enter a model ID supported by the CLI'
                                        )}
                                      </div>
                                    </div>
                                  </div>
                                )}
                                {discoveredModels.length === 0 && (modelResult?.warnings?.length || modelResult?.errors?.length) ? (
                                  <div className="text-[9px] leading-snug text-amber-200/90">
                                    {[...(modelResult.warnings ?? []), ...(modelResult.errors ?? [])][0]}
                                  </div>
                                ) : null}
                              </div>
                            ) : (
                              <div className="group relative">
                                <input
                                  value={currentModel}
                                  onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'model', value: event.target.value })}
                                  placeholder="model name"
                                  className="w-full min-w-0 background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px] text-text-secondary"
                                />
                                <div className="absolute left-0 top-full z-50 pt-1 opacity-0 pointer-events-none group-hover:opacity-100 group-hover:pointer-events-auto">
                                  <div className="whitespace-nowrap rounded border border-border-panel background-bg-panel px-2.5 py-1.5 text-[10px] text-text-secondary shadow-lg">
                                    {(() => {
                                      const cli = String(materializedNode.node.properties.cli ?? runtimeCli).toLowerCase().replace(/[_-]/g, '');
                                      const norm = cli === 'claude' || cli === 'claudecode' ? 'claude'
                                        : cli === 'gemini' ? 'gemini'
                                        : cli === 'codex' ? 'codex'
                                        : cli === 'opencode' ? 'opencode' : '';
                                      if (MODEL_DOC_URLS[norm]) {
                                        return <>Available models: <button type="button" onClick={() => openUrl(MODEL_DOC_URLS[norm]!)} className="text-accent-primary underline underline-offset-2 cursor-pointer">{MODEL_DOC_URLS[norm]!.replace('https://', '')}</button></>;
                                      }
                                      if (norm === 'opencode') return 'Check with provider for specific model names';
                                      return 'Enter a model ID supported by the CLI';
                                    })()}
                                  </div>
                                </div>
                              </div>
                            )}
                            <button
                              type="button"
                              onClick={() => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'yolo', value: !isYolo })}
                              className={`flex shrink-0 items-center gap-1 rounded-lg border px-2 py-1.5 text-[11px] transition-colors ${
                                isYolo
                                  ? 'border-white/20 text-white hover:opacity-90 yolo-gradient'
                                  : 'border-border-panel background-bg-surface text-text-muted hover:text-text-primary'
                              }`}
                              title="Yolo mode — skip permission prompts at CLI startup"
                            >
                              <span className={`inline-flex items-center rounded border px-1 text-[9px] font-semibold tracking-wide leading-none h-[16px] ${
                                isYolo
                                  ? 'border-white/30 bg-white/10 text-white'
                                  : 'border-border-panel bg-transparent text-text-muted'
                              }`}>
                                YOLO
                              </span>
                              <span className="leading-none">{isYolo ? 'ON' : 'OFF'}</span>
                            </button>
                          </div>
                        );
                      })()}
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div className={`rounded border px-2 py-1.5 ${workflowStatusTone(runtimeStatus, 'graph')}`}>
                          <div className="uppercase tracking-wide opacity-70">Status</div>
                          <div className="font-medium uppercase">{workflowStatusLabel(runtimeStatus)}</div>
                        </div>
                        <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
                          <div className="uppercase tracking-wide text-text-muted">Action</div>
                          <AgentActionBadge cli={runtimeCli} status={runtimeStatus} />
                        </div>
                      </div>
                      <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5 text-[10px]">
                        <div className="uppercase tracking-wide text-text-muted">Runtime</div>
                        <div className="mt-0.5 flex items-center justify-between gap-2 text-text-secondary">
                          <span className="truncate">{runtimeCli ? runtimeCli.toUpperCase() : 'Unknown CLI'}</span>
                          <span className="truncate">{runtimeSessionId ? shortId(runtimeSessionId) : (terminalId ? 'bound' : 'not bound')}</span>
                        </div>
                      </div>
                      {artifactHints.length > 0 && (
                        <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">Artifacts / Files</div>
                          <div className="flex flex-wrap gap-1">
                            {artifactHints.map(hint => (
                              <span key={hint} className="px-1.5 py-0.5 text-[10px] rounded border border-border-panel background-bg-surface text-text-secondary">
                                {hint}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={SELECTABLE_EXECUTION_MODES.includes(materializedNode.node.properties.executionMode as WorkflowExecutionMode)
                            ? String(materializedNode.node.properties.executionMode)
                            : 'streaming_headless'}
                          onChange={event => applyOperator({
                            type: 'set_node_property',
                            nodeId: materializedNode.node.id,
                            key: 'executionMode',
                            value: event.target.value,
                          })}
                          className="background-bg-surface border border-border-panel rounded px-2 py-1.5 text-[10px] text-text-secondary"
                          title="Runtime execution mode"
                        >
                          {supportsHeadless(runtimeCli as any) && (
                            <>
                              <option value="streaming_headless">Stream</option>
                              <option value="headless">Headless</option>
                            </>
                          )}
                          <option value="interactive_pty">PTY</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => createAndBindRuntime(materializedNode.node.id)}
                          className="flex items-center justify-center gap-1 rounded border border-border-panel px-2 py-1.5 text-[10px] text-text-muted hover:text-text-primary hover:background-bg-surface transition-colors"
                        >
                          <Plus size={11} />
                          New Runtime
                        </button>
                      </div>
                      {typeof materializedNode.node.properties.lastOutputSummary === 'string' &&
                        String(materializedNode.node.properties.lastOutputSummary).trim() && (
                          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1 flex items-center justify-between">
                              <span>Captured Output</span>
                              <span className="text-[9px] text-emerald-300">
                                {String(materializedNode.node.properties.lastOutcome ?? 'success')}
                              </span>
                            </div>
                            <pre className="max-h-32 overflow-y-auto whitespace-pre-wrap break-words text-[10px] text-text-secondary custom-scrollbar">
                              {String(materializedNode.node.properties.lastOutputSummary).slice(-800)}
                            </pre>
                          </div>
                        )}
                    </div>
                  )}

                  {materializedNode.node.type === 'workflow.output' && (
                    <div className="space-y-3">
                      {(() => {
                        const agentResults = Object.values(activeTree.nodes)
                          .filter(n => n.type === 'workflow.agent')
                          .map(n => ({
                            id: n.id,
                            roleId: String(n.properties.roleId ?? 'agent'),
                            summary: String(n.properties.lastOutputSummary ?? '').trim(),
                            outcome: String(n.properties.lastOutcome ?? ''),
                          }))
                          .filter(entry => entry.summary);
                        if (agentResults.length === 0) return null;
                        return (
                          <div className="space-y-1.5">
                            <div className="text-[10px] uppercase tracking-wide text-text-muted font-semibold">
                              Agent Results
                            </div>
                            {agentResults.map(entry => (
                              <div key={entry.id} className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
                                <div className="flex items-center justify-between mb-0.5">
                                  <span className="text-[10px] font-semibold text-accent-primary">{entry.roleId}</span>
                                  <span className={`text-[9px] ${entry.outcome === 'failure' ? 'text-red-300' : 'text-emerald-300'}`}>
                                    {entry.outcome || 'completed'}
                                  </span>
                                </div>
                                <pre className="max-h-24 overflow-y-auto whitespace-pre-wrap break-words text-[10px] text-text-secondary custom-scrollbar">
                                  {entry.summary.slice(-500)}
                                </pre>
                              </div>
                            ))}
                          </div>
                        );
                      })()}
                      <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1 font-semibold flex items-center gap-1.5">
                        <Workflow size={10} className="text-accent-primary" />
                        Live Artifact Stream
                      </div>
                      <div className="space-y-2 max-h-80 overflow-y-auto pr-1 custom-scrollbar">
                        {(() => {
                          const allArtifacts = missionAgents.flatMap(a => a.artifacts ?? []);
                          const sorted = [...allArtifacts].sort((a, b) => b.timestamp - a.timestamp);
                          
                          if (sorted.length === 0) {
                            return (
                              <div className="py-12 flex flex-col items-center justify-center text-center px-4">
                                <Sparkles size={24} className="text-text-muted opacity-20 mb-2" />
                                <div className="text-[10px] text-text-muted italic opacity-40">Waiting for artifacts...</div>
                                <div className="text-[9px] text-text-muted opacity-30 mt-1 max-w-[140px]">File changes and summaries will appear here in real-time.</div>
                              </div>
                            );
                          }
                          
                          return sorted.map(art => (
                            <div 
                              key={art.id} 
                              className="p-2.5 rounded-lg border border-border-panel background-bg-app hover:border-accent-primary/30 hover:background-bg-surface transition-all group cursor-pointer"
                              onClick={() => {
                                if (art.path) {
                                  addPane('editor', art.label, { filePath: art.path });
                                }
                              }}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-1.5 h-1.5 rounded-full ${
                                    art.type === 'file_change' ? 'bg-emerald-400' : 
                                    art.type === 'summary' ? 'bg-amber-400' : 'bg-blue-400'
                                  } shadow-[0_0_8px_rgba(0,0,0,0.5)]`} />
                                  <span className="text-[9px] font-bold text-accent-primary uppercase tracking-tighter">
                                    {art.type.replace('_', ' ')}
                                  </span>
                                </div>
                                <span className="text-[9px] text-text-muted font-mono opacity-50">
                                  {new Date(art.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-[11px] text-text-primary font-semibold leading-tight group-hover:text-accent-primary transition-colors">{art.label}</div>
                              {art.path && (
                                <div className="flex items-center gap-1 mt-1.5">
                                  <div className="text-[9px] text-text-muted truncate opacity-50 font-mono bg-black/20 px-1 py-0.5 rounded border border-white/5 flex-1">
                                    {art.path}
                                  </div>
                                  <ArrowUpRight size={10} className="text-text-muted opacity-0 group-hover:opacity-100 transition-opacity" />
                                </div>
                              )}
                            </div>
                          ));
                        })()}
                      </div>
                      <div className="pt-2 border-t border-border-panel/50 flex items-center justify-between text-[9px] text-text-muted px-1">
                        <span>{missionAgents.flatMap(a => a.artifacts ?? []).length} items captured</span>
                        <div className="flex items-center gap-1">
                          <span className="w-1 h-1 rounded-full bg-emerald-400 animate-pulse" />
                          Live
                        </div>
                      </div>
                    </div>
                  )}

                  {materializedNode.node.type === 'workflow.frame' && (
                    <input
                      value={String(materializedNode.node.properties.label ?? 'Frame')}
                      onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'label', value: event.target.value })}
                      placeholder="Frame label"
                      className="w-full background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                    />
                  )}
                </div>

                {isFrame && (
                  <>
                    {(['n', 's', 'e', 'w', 'ne', 'nw', 'se', 'sw'] as ResizeEdge[]).map(edge => {
                      const style: React.CSSProperties = {};
                      if (edge.includes('n')) style.top = -5;
                      if (edge.includes('s')) style.bottom = -5;
                      if (edge.includes('w')) style.left = -5;
                      if (edge.includes('e')) style.right = -5;
                      if (edge === 'n' || edge === 's') style.left = '50%';
                      if (edge === 'e' || edge === 'w') style.top = '50%';
                      if (edge === 'n' || edge === 's') style.transform = 'translateX(-50%)';
                      if (edge === 'e' || edge === 'w') style.transform = 'translateY(-50%)';
                      return (
                        <button
                          key={edge}
                          className="absolute w-3 h-3 rounded bg-accent-primary border border-bg-titlebar"
                          style={style}
                          onMouseDown={event => startFrameResize(event, materializedNode.node.id, edge)}
                          title={`Resize ${edge}`}
                        />
                      );
                    })}
                  </>
                )}
              </div>
            );
          });
          })()}
        </div>

        {interaction.kind === 'box_select' && (
          <div
            className="absolute border border-dashed border-accent-primary bg-accent-primary/10 pointer-events-none"
            style={(() => {
              const screenOrigin = { x: interaction.worldOrigin.x * view.zoom + view.pan.x, y: interaction.worldOrigin.y * view.zoom + view.pan.y };
              const screenCurrent = { x: interaction.worldCurrent.x * view.zoom + view.pan.x, y: interaction.worldCurrent.y * view.zoom + view.pan.y };
              const rect = selectionRect(screenOrigin, screenCurrent);
              return { left: rect.x, top: rect.y, width: rect.width, height: rect.height };
            })()}
          />
        )}

        {contextMenu && (
          <div
            className="absolute z-50 background-bg-titlebar border border-border-panel rounded-lg shadow-2xl p-2 w-64"
            style={{ left: contextMenu.screen.x, top: contextMenu.screen.y }}
            onMouseDown={e => e.stopPropagation()}
          >
            {contextMenu.mode === 'node' && contextMenu.nodeId && (
              <button
                className="w-full text-left px-2 py-1.5 text-[12px] text-red-300 hover:bg-red-500/10 rounded"
                onClick={() => deleteNodeById(contextMenu.nodeId!)}
              >
                Delete Node
              </button>
            )}
            {(contextMenu.mode === 'canvas' || contextMenu.mode === 'link_insert') && (
              <>
                <div className="px-2 py-1 text-[10px] uppercase tracking-[0.18em] text-text-muted">
                  {contextMenu.mode === 'link_insert' ? 'Insert Node' : 'Add Node'}
                </div>
                <div className="max-h-72 overflow-auto">
                  {nodeOptions.map(option => (
                    <button
                      key={option.type}
                      className="w-full text-left px-2 py-1.5 text-[12px] text-text-primary hover:background-bg-surface rounded flex items-center justify-between"
                      onClick={() => addNodeAt(option.type, contextMenu.world, contextMenu.linkFrom)}
                    >
                      <span>{option.label}</span>
                      <span className="text-[10px] uppercase tracking-wide text-text-muted">{option.category}</span>
                    </button>
                  ))}
                </div>
              </>
            )}
          </div>
        )}

        {inspectorNodeId && (
          <div
            className="absolute z-40 right-3 top-3 bottom-3 w-[420px] rounded-xl border border-border-panel background-bg-panel shadow-2xl flex flex-col"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-border-panel background-bg-titlebar flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.2em] text-accent-primary">Node Runtime Inspector</div>
                <div className="text-[12px] text-text-primary truncate">
                  {inspectedNode?.type === 'workflow.agent' ? 'Agent' :
                   inspectedNode?.type === 'workflow.task' ? 'Task' :
                   (inspectedNode?.label ?? inspectedNode?.id ?? inspectorNodeId)}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {inspectedTerminalId && inspectedUsesPty && (
                  <button
                    type="button"
                    onClick={() => openTerminalById(inspectedTerminalId)}
                    className="p-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface"
                    title="Open full terminal pane"
                  >
                    <ArrowUpRight size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInspectorNodeId(null)}
                  className="p-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface"
                  title="Close inspector"
                >
                  <X size={12} />
                </button>
              </div>
            </div>

            {!inspectedNode ? (
              <div className="flex-1 flex items-center justify-center text-[12px] text-text-muted px-4 text-center">
                Selected node is no longer available.
              </div>
            ) : !inspectedTerminalId ? (
              <div className="flex-1 flex flex-col items-center justify-center text-[12px] text-text-muted px-4 text-center gap-3">
                <p>This node has no terminal runtime binding.</p>
                <button
                  type="button"
                  onClick={() => {
                    if (inspectorNodeId) createAndBindRuntime(inspectorNodeId);
                  }}
                  className="px-2.5 py-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface text-[11px] inline-flex items-center gap-1"
                >
                  <Plus size={11} />
                  Create Runtime Binding
                </button>
              </div>
            ) : (
              <>
                <div className="px-3 py-2 border-b border-border-panel text-[10px] text-text-muted flex items-center justify-between gap-2">
                  <span className="truncate">
                    {inspectedTerminal?.title ?? inspectedTerminalId}
                    {inspectedRuntimeAgent?.runtimeSessionId ? ` · ${shortId(inspectedRuntimeAgent.runtimeSessionId)}` : ''}
                  </span>
                  {inspectedUsesPty && (
                    <button
                      type="button"
                      onClick={() => void refreshTerminalOutput(inspectedTerminalId)}
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-panel hover:background-bg-surface text-text-muted hover:text-text-primary"
                      title="Refresh runtime output"
                    >
                      <RefreshCw size={11} />
                      Refresh
                    </button>
                  )}
                </div>

                <pre className="flex-1 overflow-auto px-3 py-3 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap background-bg-app">
                  {inspectorOutput || 'Waiting for runtime output...'}
                </pre>

                {inspectorError && (
                  <div className="px-3 py-1.5 text-[10px] text-red-200 bg-red-500/10 border-t border-red-400/20">
                    {inspectorError}
                  </div>
                )}

                {inspectedUsesPty && (
                  <form
                    className="px-3 py-2 border-t border-border-panel background-bg-titlebar flex gap-2"
                    onSubmit={event => {
                      event.preventDefault();
                      void sendInspectorCommand();
                    }}
                  >
                    <input
                      value={inspectorCommand}
                      onChange={event => setInspectorCommand(event.target.value)}
                      placeholder="Send command to runtime"
                      className="flex-1 background-bg-surface border border-border-panel rounded px-2 py-1.5 text-[11px] text-text-primary"
                    />
                    <button
                      type="submit"
                      disabled={!inspectorCommand.trim()}
                      className="px-2.5 py-1.5 rounded border border-accent-primary text-accent-primary hover:bg-accent-primary/10 disabled:opacity-40 disabled:cursor-not-allowed text-[11px]"
                    >
                      Send
                    </button>
                  </form>
                )}
              </>
            )}
          </div>
        )}
      </div>

      <div className="px-3 py-2 shrink-0 border-t border-border-panel background-bg-titlebar flex items-center justify-between text-[11px] text-text-muted">
        <div>
          Tree: <span className="text-text-primary">{activeTree.name}</span> | Nodes: <span className="text-text-primary">{materializedNodes.length}</span> | Links:{' '}
          <span className="text-text-primary">{Object.keys(activeTree.links).length}</span>
        </div>
        <div>
          Right-click to add/delete, drag output to input, <span className="text-text-primary">Ctrl+Right Drag</span> for knife, <span className="text-text-primary">F</span> to frame selected, and use <span className="text-text-primary">Inspect</span> on agent nodes for live runtime details.
        </div>
      </div>
    </div>
  );
}
