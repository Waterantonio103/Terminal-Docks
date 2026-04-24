import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowUpRight, ChevronDown, ChevronLeft, Play, Plus, RefreshCw, ScanSearch, Sparkles, TerminalSquare, Trash2, Workflow, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
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
import { useWorkspaceStore, type MissionAgent, type ResultEntry, type WorkflowAgentCli, type WorkflowExecutionMode, type WorkflowGraph } from '../../store/workspace';

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
const SUPPORTED_WORKFLOW_CLIS = new Set(['claude', 'gemini', 'opencode', 'codex', 'custom', 'ollama', 'lmstudio']);
const SELECTABLE_WORKFLOW_CLIS: WorkflowAgentCli[] = ['claude', 'codex', 'gemini', 'opencode', 'custom', 'ollama', 'lmstudio'];
const SELECTABLE_EXECUTION_MODES: WorkflowExecutionMode[] = ['streaming_headless', 'headless', 'interactive_pty'];
const MAX_RUNTIME_SNIPPET_BYTES = 3072;
const MAX_ACTIVITY_SUMMARY_LENGTH = 180;
const ARTIFACT_PATH_REGEX = /\b(?:\.{0,2}\/)?[a-zA-Z0-9_\-./]+\.(?:ts|tsx|js|jsx|mjs|cjs|rs|md|json|yaml|yml|toml|css|scss|html|sh|py|go|java|kt|swift|sql)\b/g;
const ANSI_ESCAPE_REGEX = /\u001b\[[0-9;?]*[ -/]*[@-~]/g;

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
    ? 'border-[#8bc3ff] shadow-[0_0_0_1px_rgba(139,195,255,0.65)]'
    : 'border-border-panel shadow-[0_10px_24px_rgba(0,0,0,0.28)]';
}

function stripAnsi(raw: string): string {
  return raw.replace(ANSI_ESCAPE_REGEX, '').replace(/\r/g, '');
}

function summarizeActivity(raw: string | undefined | null, maxLen = MAX_ACTIVITY_SUMMARY_LENGTH): string {
  const normalized = stripAnsi(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!normalized) return 'No runtime output yet.';
  if (normalized.length <= maxLen) return normalized;
  return `${normalized.slice(0, Math.max(1, maxLen - 1))}…`;
}

function shortId(value: string | null | undefined, max = 26): string {
  if (!value) return '—';
  if (value.length <= max) return value;
  return `${value.slice(0, max)}…`;
}

function decodePtyChunk(data: number[]): string {
  try {
    return stripAnsi(new TextDecoder().decode(new Uint8Array(data)));
  } catch {
    return '';
  }
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
  const [inspectorCommand, setInspectorCommand] = useState('');
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [runtimeOutputByTerminalId, setRuntimeOutputByTerminalId] = useState<Record<string, string>>({});
  const [runtimeOutputByNodeId, setRuntimeOutputByNodeId] = useState<Record<string, string>>({});
  const [expandedTerminalNodeId, setExpandedTerminalNodeId] = useState<string | null>(null);

  const registry = useMemo(() => createWorkflowNodeRegistry(), []);
  const [state, setState] = useState<NodeDocumentState>(() => legacyGraphToNodeDocument(graph));
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: 'idle' });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [hoveredInput, setHoveredInput] = useState<LinkHoverTarget>(null);
  const [validationMessage, setValidationMessage] = useState('Node graph editor is active.');
  const [validationTone, setValidationTone] = useState<ValidationTone>('idle');
  const [activeMissionId, setActiveMissionId] = useState<string | null>(null);
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const suppressContextMenuRef = useRef(false);
  const lastGraphSnapshotRef = useRef(JSON.stringify(graph));

  useEffect(() => {
    const incoming = JSON.stringify(graph);
    if (incoming !== lastGraphSnapshotRef.current) {
      setState(legacyGraphToNodeDocument(graph));
      lastGraphSnapshotRef.current = incoming;
      setActiveMissionId(null);
    }
  }, [graph]);

  useEffect(() => {
    const serialized = nodeDocumentToWorkflowGraph(state.document, registry);
    const json = JSON.stringify(serialized);
    if (json !== lastGraphSnapshotRef.current) {
      lastGraphSnapshotRef.current = json;
      onGraphChange?.(serialized);
    }
  }, [onGraphChange, registry, state.document]);

  const applyOperator = useCallback(
    (operator: Parameters<typeof applyNodeEditorOperator>[3]) => {
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
      unlistenActivation = fn;
      if (unmounted) fn();
    });

    listen<{
      id: string;
      status: string;
      attempt?: number;
      outcome?: 'success' | 'failure';
      reason?: string;
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
      unlistenUpdate = fn;
      if (unmounted) fn();
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
      unlistenWarning = fn;
      if (unmounted) fn();
    });

    return () => {
      unmounted = true;
      unlistenActivation?.();
      unlistenUpdate?.();
      unlistenWarning?.();
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
    (nodeId: string): { id: string; paneId: string; title: string; cli: WorkflowAgentCli } | null => {
      const before = new Set(openTerminals.map(terminal => terminal.id));
      const node = activeTree.nodes[nodeId];
      const role = String(node?.properties.roleId ?? 'agent');
      const cli = SELECTABLE_WORKFLOW_CLIS.includes(node?.properties.cli as WorkflowAgentCli)
        ? (node?.properties.cli as WorkflowAgentCli)
        : 'claude';
      const executionMode = SELECTABLE_EXECUTION_MODES.includes(node?.properties.executionMode as WorkflowExecutionMode)
        ? (node?.properties.executionMode as WorkflowExecutionMode)
        : 'streaming_headless';
      const title = `Runtime ${role}`;
      if (executionMode !== 'interactive_pty') {
        const runtimeId = `runtime-${nodeId}-${generateId()}`;
        applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: runtimeId });
        applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: title });
        applyOperator({ type: 'set_node_property', nodeId, key: 'paneId', value: '' });
        applyOperator({ type: 'set_node_property', nodeId, key: 'cli', value: cli });
        applyOperator({ type: 'set_node_property', nodeId, key: 'executionMode', value: executionMode });
        setNodeTerminalBinding(nodeId, runtimeId);
        setValidationTone('ok');
        setValidationMessage(`Node ${nodeId} bound to ${title}.`);
        return { id: runtimeId, paneId: '', title, cli };
      }

      addPane('terminal', title, { roleId: role, cli, cliSource: 'heuristic', executionMode });
      const nextTabs = useWorkspaceStore.getState().tabs;
      let created: { id: string; paneId: string; title: string; cli: WorkflowAgentCli } | null = null;
      for (const tab of nextTabs) {
        for (const pane of tab.panes) {
          if (pane.type !== 'terminal' || !pane.data?.terminalId) continue;
          if (before.has(pane.data.terminalId)) continue;
          created = { id: pane.data.terminalId, paneId: pane.id, title: pane.title, cli };
          break;
        }
        if (created) break;
      }
      if (!created) {
        setValidationTone('error');
        setValidationMessage('Failed to create terminal runtime binding.');
        return null;
      }
      applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: created.id });
      applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: created.title });
      applyOperator({ type: 'set_node_property', nodeId, key: 'paneId', value: created.paneId });
      applyOperator({ type: 'set_node_property', nodeId, key: 'cli', value: cli });
      applyOperator({ type: 'set_node_property', nodeId, key: 'executionMode', value: executionMode });
      setNodeTerminalBinding(nodeId, created.id);
      setValidationTone('ok');
      setValidationMessage(`Node ${nodeId} bound to ${created.title}.`);
      return created;
    },
    [activeTree.nodes, addPane, applyOperator, openTerminals, setNodeTerminalBinding]
  );

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
      await invoke('write_to_pty', { id: terminalId, data: `${command}\r` });
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
    let unlistenPtyOut: (() => void) | undefined;
    let unlistenAgentRunOutput: (() => void) | undefined;
    let unmounted = false;
    listen<{ id: string; data: number[] }>('pty-out', event => {
      if (unmounted) return;
      const chunk = decodePtyChunk(event.payload.data);
      if (!chunk) return;
      const terminalId = event.payload.id;
      setRuntimeOutputByTerminalId(previous => {
        const merged = `${previous[terminalId] ?? ''}${chunk}`;
        const next = merged.length > MAX_RUNTIME_SNIPPET_BYTES
          ? merged.slice(merged.length - MAX_RUNTIME_SNIPPET_BYTES)
          : merged;
        return { ...previous, [terminalId]: next };
      });
    }).then(unlisten => {
      unlistenPtyOut = unlisten;
      if (unmounted) unlisten();
    });
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
      unlistenPtyOut?.();
      unlistenAgentRunOutput?.();
    };
  }, [activeMissionId]);

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

      // Auto-bind any unbound agent nodes — node owns its terminal
      const freshBindings = new Map<string, { id: string; title: string; paneId: string; cli: WorkflowAgentCli }>();
      const storedBindings = useWorkspaceStore.getState().nodeTerminalBindings;
      for (const node of flow.nodes) {
        if (node.type !== 'workflow.agent' && node.type !== 'agent') continue;
        const nodeId = String(node.id);
        const data = node.data as Record<string, unknown>;
        const executionMode = SELECTABLE_EXECUTION_MODES.includes(data.executionMode as WorkflowExecutionMode)
          ? data.executionMode as WorkflowExecutionMode
          : 'streaming_headless';
        if (data.terminalId && executionMode === 'interactive_pty') continue;

        if (executionMode !== 'interactive_pty') {
          const binding = createAndBindRuntime(nodeId);
          if (binding) freshBindings.set(nodeId, binding);
          continue;
        }

        // Re-attach persisted binding if the terminal pane is still open
        const persistedId = storedBindings[nodeId];
        if (persistedId) {
          const existing = openTerminals.find(t => t.id === persistedId);
          if (existing) {
            applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: persistedId });
            applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: existing.title });
            applyOperator({ type: 'set_node_property', nodeId, key: 'paneId', value: existing.paneId });
            const cli = SELECTABLE_WORKFLOW_CLIS.includes(data.cli as WorkflowAgentCli)
              ? data.cli as WorkflowAgentCli
              : (SUPPORTED_WORKFLOW_CLIS.has(String(existing.cli)) ? existing.cli as WorkflowAgentCli : 'claude');
            freshBindings.set(nodeId, { id: persistedId, title: existing.title, paneId: existing.paneId, cli });
            continue;
          }
        }

        // Spawn a new terminal for this node
        const binding = createAndBindRuntime(nodeId);
        if (binding) freshBindings.set(nodeId, binding);
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
      // Freshly spawned terminals carry the node-selected CLI before stdout detection has output.
      for (const [, binding] of freshBindings) {
        if (!terminalClis[binding.id]) terminalClis[binding.id] = binding.cli;
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

      addPane('missioncontrol', 'Mission Control', {
        taskDescription: mission.task.prompt ?? '',
        agents,
        missionId,
        mission,
      });

      await invoke('start_mission_graph', {
        missionId,
        graph: mission,
      });

      setValidationTone('ok');
      setValidationMessage(
        `Launched mission ${missionId.substring(0, 8)}. Runtime flow: MCP server online -> runtime session registration -> NEW_TASK dispatch.`
      );
    } catch (error) {
      setActiveMissionId(null);
      setValidationTone('error');
      setValidationMessage(error instanceof Error ? error.message : String(error));
    }
  }, [registry, state.document, workspaceDir, graph.id, openTerminals, addPane, applyOperator, createAndBindRuntime]);

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

  const addNodeAt = useCallback(
    (nodeType: string, location: Point2D, linkFrom?: { nodeId: string; socketId: string }) => {
      let connectError: string | null = null;
      setState(previous => {
        let next = applyNodeEditorOperator(previous.document, previous.editor, registry, { type: 'add_node', nodeType, location });
        const newNodeId = next.editor.activeNodeId;
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

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
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

  const inspectedNode = inspectorNodeId ? activeTree.nodes[inspectorNodeId] : null;
  const inspectedRuntimeAgent = inspectorNodeId ? missionAgentByNodeId.get(inspectorNodeId) : undefined;
  const inspectedTerminalId = String(inspectedNode?.properties.terminalId ?? inspectedRuntimeAgent?.terminalId ?? '').trim();
  const inspectedTerminal = openTerminals.find(terminal => terminal.id === inspectedTerminalId);
  const inspectedExecutionMode = SELECTABLE_EXECUTION_MODES.includes(inspectedNode?.properties.executionMode as WorkflowExecutionMode)
    ? inspectedNode?.properties.executionMode as WorkflowExecutionMode
    : 'streaming_headless';
  const inspectedUsesPty = inspectedExecutionMode === 'interactive_pty';
  const inspectorOutput = inspectorNodeId
    ? (inspectedUsesPty ? (runtimeOutputByTerminalId[inspectedTerminalId] ?? '') : (runtimeOutputByNodeId[inspectorNodeId] ?? ''))
    : '';

  return (
    <div className="h-full w-full bg-[#0e1218] text-text-primary flex flex-col">
      <div className="h-12 shrink-0 border-b border-border-panel px-3 flex items-center justify-between bg-[#0a0f15]">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-[#8bc3ff]">
          <Workflow size={14} />
          <span>Node Graph Architecture</span>
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          {state.editor.treePath.length > 1 && (
            <button
              onClick={() => applyOperator({ type: 'end_group_edit' })}
              className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:bg-bg-panel"
            >
              <ChevronLeft size={12} className="inline mr-1" />
              Back
            </button>
          )}
          <button onClick={runWorkflow} className="px-2.5 py-1 rounded border border-accent-primary text-accent-primary hover:bg-accent-primary/10">
            <Play size={12} className="inline mr-1" />
            Run
          </button>
          <button onClick={validateCurrentGraph} className="px-2.5 py-1 rounded border border-[#284867] text-[#8bc3ff] hover:bg-[#112030]">
            <ScanSearch size={12} className="inline mr-1" />
            Validate
          </button>
          <button onClick={viewRuntimeMapping} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:bg-bg-panel">
            Runtime Map
          </button>
          <button onClick={importPresetGraph} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:bg-bg-panel">
            <Sparkles size={12} className="inline mr-1" />
            Import Preset
          </button>
          <button onClick={() => applyOperator({ type: 'delete_selection' })} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-red-300 hover:bg-red-500/10">
            <Trash2 size={12} className="inline mr-1" />
            Delete
          </button>
        </div>
      </div>

      <div className="px-3 py-2 shrink-0 border-b border-border-panel bg-[#0b1118] flex items-center justify-between text-[11px]">
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

      <div ref={canvasRef} className="relative flex-1 overflow-hidden bg-[#0b0f14]" onMouseDown={onCanvasMouseDown} onContextMenu={onCanvasContextMenu} onWheel={onWheel}>
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
              return <path key={link.id} d={bezierPath(from, to)} stroke="#6b7f95" strokeWidth={2} fill="none" />;
            })}
            {interaction.kind === 'dragging_link' && (
              <path
                d={bezierPath(toLinkCanvas(interaction.fromWorld), toLinkCanvas(interaction.currentWorld))}
                stroke="#8bc3ff"
                strokeWidth={2}
                strokeDasharray="5 4"
                fill="none"
              />
            )}
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

          {materializedNodes.map(materializedNode => {
            const rect = worldRect(materializedNode);
            const isSelected = selectedNodeIds.has(materializedNode.node.id);
            const isFrame = materializedNode.node.type === 'workflow.frame';
            const runtimeAgent = missionAgentByNodeId.get(materializedNode.node.id);
            const runtimeBinding = nodeRuntimeBindings[materializedNode.node.id];
            const runtimeStatus = String(
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
              runtimeAgent?.terminalId ??
              materializedNode.node.properties.terminalId ??
              runtimeBinding?.terminalId ??
              ''
            ).trim();
            const terminal = openTerminals.find(entry => entry.id === terminalId);
            const runtimeCli = String(
              runtimeAgent?.runtimeCli ??
              materializedNode.node.properties.cli ??
              terminal?.cli ??
              materializedNode.node.properties.runtimeCli ??
              'claude'
            ).trim();
            const runtimeSessionId = String(runtimeAgent?.runtimeSessionId ?? runtimeBinding?.runtimeSessionId ?? '').trim();
            const executionMode = SELECTABLE_EXECUTION_MODES.includes(materializedNode.node.properties.executionMode as WorkflowExecutionMode)
              ? materializedNode.node.properties.executionMode as WorkflowExecutionMode
              : 'streaming_headless';
            const usesPtyRuntime = executionMode === 'interactive_pty';
            const runtimeOutput = usesPtyRuntime
              ? (runtimeOutputByTerminalId[terminalId] ?? '')
              : (runtimeOutputByNodeId[materializedNode.node.id] ?? '');
            const runtimeSummary = summarizeActivity(
              runtimeOutput ||
              (runtimeAgent?.lastPayload ?? null)
            );
            const artifactHints = artifactHintsByNodeId.get(materializedNode.node.id) ?? [];
            const isInspectorOpen = inspectorNodeId === materializedNode.node.id;
            return (
              <div
                key={materializedNode.node.id}
                className={`absolute rounded-xl border bg-[#10161f] ${borderClass(isSelected)}`}
                style={{ left: rect.x, top: rect.y, width: rect.width, minHeight: rect.height, zIndex: isFrame ? 0 : 10 }}
                onDoubleClick={() => {
                  if (materializedNode.node.type === 'workflow.group') {
                    applyOperator({ type: 'begin_group_edit', nodeId: materializedNode.node.id });
                  }
                }}
              >
                <div className="h-11 px-3 rounded-t-xl border-b border-border-panel flex items-center justify-between bg-[#121925]" onMouseDown={event => startNodeDrag(event, materializedNode.node)}>
                  <div>
                    <div className="text-[10px] uppercase tracking-[0.22em] text-[#8bc3ff]">{registry.get(materializedNode.node.type).category}</div>
                    <div className="text-sm font-semibold text-text-primary">{materializedNode.node.label ?? registry.get(materializedNode.node.type).label}</div>
                  </div>
                  <div className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${workflowStatusTone(runtimeStatus, 'graph')}`}>
                    {workflowStatusLabel(runtimeStatus)}
                  </div>
                </div>

                <div className="px-3 py-3 relative">
                  {materializedNode.inputs.map((socket, index) => (
                    <button
                      key={socket.id}
                      className="absolute left-0 w-4 h-4 -translate-x-1/2 rounded-full border border-[#8bc3ff] bg-[#0b1016]"
                      style={{ top: 12 + index * 24 }}
                      onMouseEnter={() => setHoveredInput({ nodeId: materializedNode.node.id, socketId: socket.id })}
                      onMouseLeave={() => setHoveredInput(current => (current?.nodeId === materializedNode.node.id && current?.socketId === socket.id ? null : current))}
                      title={`${socket.name} (${socket.dataType})`}
                    />
                  ))}
                  {materializedNode.outputs.map((socket, index) => (
                    <button
                      key={socket.id}
                      className="absolute right-0 w-4 h-4 translate-x-1/2 rounded-full border border-[#8bc3ff] bg-[#0b1016]"
                      style={{ top: 12 + index * 24 }}
                      onMouseDown={event => beginLinkDrag(event, materializedNode.node.id, socket.id)}
                      title={`${socket.name} (${socket.dataType})`}
                    />
                  ))}

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
                        placeholder="Task prompt"
                        className="w-full bg-[#0b1118] border border-border-panel rounded-lg px-2 py-2 text-[11px] text-text-primary resize-none"
                      />
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={String(materializedNode.node.properties.mode ?? 'build')}
                          onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'mode', value: event.target.value })}
                          className="bg-[#0b1118] border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                        >
                          <option value="build">Build</option>
                          <option value="edit">Edit</option>
                        </select>
                        <input
                          value={String(materializedNode.node.properties.workspaceDir ?? workspaceDir ?? '')}
                          onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'workspaceDir', value: event.target.value })}
                          placeholder="Workspace dir"
                          className="bg-[#0b1118] border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
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
                          className="flex-1 bg-[#0b1118] border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
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
                          onChange={event => applyOperator({
                            type: 'set_node_property',
                            nodeId: materializedNode.node.id,
                            key: 'cli',
                            value: event.target.value,
                          })}
                          className="flex-1 bg-[#0b1118] border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                          title="Runtime CLI"
                        >
                          {SELECTABLE_WORKFLOW_CLIS.map(cli => (
                            <option key={cli} value={cli}>{cli.toUpperCase()}</option>
                          ))}
                        </select>
                      </div>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div className="rounded border border-border-panel bg-[#0b1118] px-2 py-1.5">
                          <div className="uppercase tracking-wide text-text-muted">Terminal</div>
                          <div className={`truncate font-medium ${terminalId ? 'text-emerald-300' : 'text-red-300'}`}>
                            {terminalId ? (usesPtyRuntime ? 'bound' : 'virtual') : 'unbound'}
                          </div>
                        </div>
                        <div className="rounded border border-border-panel bg-[#0b1118] px-2 py-1.5">
                          <div className="uppercase tracking-wide text-text-muted">Session</div>
                          <div className="text-text-primary truncate">{shortId(runtimeSessionId)}</div>
                        </div>
                        <div className={`rounded border px-2 py-1.5 ${workflowStatusTone(runtimeStatus, 'graph')}`}>
                          <div className="uppercase tracking-wide opacity-70">Status</div>
                          <div className="font-medium">{workflowStatusLabel(runtimeStatus)}</div>
                        </div>
                        <div className="rounded border border-border-panel bg-[#0b1118] px-2 py-1.5">
                          <div className="uppercase tracking-wide text-text-muted">CLI</div>
                          <div className="text-text-primary">{runtimeCli ? runtimeCli.toUpperCase() : 'Unknown'}</div>
                        </div>
                      </div>
                      {/* Collapsible terminal preview — node owns terminal output */}
                      <div className="rounded border border-border-panel bg-[#080d12] overflow-hidden">
                        <button
                          type="button"
                          className="w-full flex items-center justify-between px-2 py-1.5 bg-[#0a0f16] hover:bg-[#0e1520] transition-colors"
                          onClick={() => setExpandedTerminalNodeId(current => current === materializedNode.node.id ? null : materializedNode.node.id)}
                        >
                          <div className="flex items-center gap-1.5 text-[10px] text-text-muted">
                            <TerminalSquare size={10} />
                            {usesPtyRuntime ? 'Terminal Output' : 'Runtime Output'}
                            {terminalId && <span className="text-[8px] text-text-muted opacity-50">({terminalId.slice(0, 8)})</span>}
                          </div>
                          <ChevronDown size={10} className={`text-text-muted transition-transform ${expandedTerminalNodeId === materializedNode.node.id ? 'rotate-180' : ''}`} />
                        </button>
                        {expandedTerminalNodeId === materializedNode.node.id ? (
                          <pre className="px-2 py-2 text-[10px] leading-relaxed text-[#c5d2e4] whitespace-pre-wrap overflow-x-hidden max-h-36 overflow-y-auto bg-[#080d12]">
                            {terminalId
                              ? ((runtimeOutput || '').split('\n').slice(-25).join('\n') || 'Waiting for output…')
                              : 'No terminal bound. Click Run to auto-create one.'}
                          </pre>
                        ) : (
                          <div className="px-2 py-1 text-[10px] text-text-muted font-mono opacity-60 truncate bg-[#080d12]">
                            {terminalId ? (runtimeSummary || 'No output yet') : 'Unbound — will auto-create on Run'}
                          </div>
                        )}
                      </div>
                      {artifactHints.length > 0 && (
                        <div className="rounded border border-border-panel bg-[#0b1118] px-2 py-1.5">
                          <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1">Artifacts / Files</div>
                          <div className="flex flex-wrap gap-1">
                            {artifactHints.map(hint => (
                              <span key={hint} className="px-1.5 py-0.5 text-[10px] rounded border border-border-panel bg-[#111a24] text-text-secondary">
                                {hint}
                              </span>
                            ))}
                          </div>
                        </div>
                      )}
                      <select
                        value={terminalId}
                        onChange={event => {
                          const value = event.target.value;
                          const term = openTerminals.find(t => t.id === value);
                          applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'terminalId', value });
                          applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'terminalTitle', value: term?.title ?? '' });
                          applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'paneId', value: term?.paneId ?? '' });
                          if (term) {
                            applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'executionMode', value: 'interactive_pty' });
                          }
                          if (term?.cli && SUPPORTED_WORKFLOW_CLIS.has(term.cli)) {
                            applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'cli', value: term.cli });
                          }
                            if (value) {
                              setNodeTerminalBinding(materializedNode.node.id, value);
                            }
                          if (value && usesPtyRuntime) {
                            void refreshTerminalOutput(value);
                          }
                        }}
                        className="w-full bg-[#0b1118] border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                      >
                        <option value="">Terminal binding id</option>
                        {terminalId && !openTerminals.some(terminal => terminal.id === terminalId) && (
                          <option value={terminalId}>
                            {terminalId.startsWith('runtime-') ? 'Virtual runtime' : 'Current binding'} ({terminalId.substring(0, 8)})
                          </option>
                        )}
                        {openTerminals.map(terminal => (
                          <option key={terminal.id} value={terminal.id}>
                            {terminal.title} ({terminal.id.substring(0, 8)}){terminal.cli ? ` · ${terminal.cli}` : ''}
                          </option>
                        ))}
                      </select>
                      <div className="grid grid-cols-3 gap-2">
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
                          className="bg-[#0b1118] border border-border-panel rounded px-2 py-1.5 text-[10px] text-text-secondary"
                          title="Runtime execution mode"
                        >
                          <option value="streaming_headless">Stream</option>
                          <option value="headless">Headless</option>
                          <option value="interactive_pty">PTY</option>
                        </select>
                        <button
                          type="button"
                          onClick={() => {
                            setInspectorNodeId(current => (current === materializedNode.node.id ? null : materializedNode.node.id));
                            setInspectorError(null);
                            if (terminalId && usesPtyRuntime) {
                              void refreshTerminalOutput(terminalId);
                            }
                          }}
                          className={`flex items-center justify-center gap-1 rounded border px-2 py-1.5 text-[10px] transition-colors ${
                            isInspectorOpen
                              ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                              : 'border-border-panel text-text-muted hover:text-text-primary hover:bg-[#111826]'
                          }`}
                        >
                          <TerminalSquare size={11} />
                          {isInspectorOpen ? 'Hide' : 'Inspect'}
                        </button>
                        <button
                          type="button"
                          disabled={!terminalId}
                          onClick={() => terminalId && openTerminalById(terminalId)}
                          className="flex items-center justify-center gap-1 rounded border border-accent-primary/40 px-2 py-1.5 text-[10px] text-accent-primary hover:bg-accent-primary/10 disabled:opacity-40 disabled:cursor-not-allowed transition-colors"
                        >
                          <ArrowUpRight size={11} />
                          Open Terminal
                        </button>
                        <button
                          type="button"
                          onClick={() => createAndBindRuntime(materializedNode.node.id)}
                          className="flex items-center justify-center gap-1 rounded border border-border-panel px-2 py-1.5 text-[10px] text-text-muted hover:text-text-primary hover:bg-[#111826] transition-colors"
                        >
                          <Plus size={11} />
                          New Runtime
                        </button>
                      </div>
                    </div>
                  )}

                  {materializedNode.node.type === 'workflow.output' && (
                    <div className="space-y-3">
                      <div className="text-[10px] uppercase tracking-wide text-text-muted mb-1 font-semibold flex items-center gap-1.5">
                        <Workflow size={10} className="text-[#8bc3ff]" />
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
                              className="p-2.5 rounded-lg border border-border-panel bg-[#080d13] hover:border-[#8bc3ff]/30 hover:bg-[#0c141d] transition-all group cursor-pointer"
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
                                  <span className="text-[9px] font-bold text-[#8bc3ff] uppercase tracking-tighter">
                                    {art.type.replace('_', ' ')}
                                  </span>
                                </div>
                                <span className="text-[9px] text-text-muted font-mono opacity-50">
                                  {new Date(art.timestamp).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-[11px] text-text-primary font-semibold leading-tight group-hover:text-[#8bc3ff] transition-colors">{art.label}</div>
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
                      className="w-full bg-[#0b1118] border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
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
                          className="absolute w-3 h-3 rounded bg-[#8bc3ff] border border-[#0a0f15]"
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
          })}
        </div>

        {interaction.kind === 'box_select' && (
          <div
            className="absolute border border-dashed border-[#8bc3ff] bg-[#8bc3ff]/10 pointer-events-none"
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
            className="absolute z-50 bg-[#121925] border border-border-panel rounded-lg shadow-2xl p-2 w-64"
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
                      className="w-full text-left px-2 py-1.5 text-[12px] text-text-primary hover:bg-bg-surface rounded flex items-center justify-between"
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
            className="absolute z-40 right-3 top-3 bottom-3 w-[420px] rounded-xl border border-border-panel bg-[#0f151e] shadow-2xl flex flex-col"
            onMouseDown={event => event.stopPropagation()}
          >
            <div className="px-3 py-2 border-b border-border-panel bg-[#101826] flex items-center justify-between">
              <div className="min-w-0">
                <div className="text-[10px] uppercase tracking-[0.2em] text-[#8bc3ff]">Node Runtime Inspector</div>
                <div className="text-[12px] text-text-primary truncate">
                  {inspectedNode?.label ?? inspectedNode?.id ?? inspectorNodeId}
                </div>
              </div>
              <div className="flex items-center gap-1">
                {inspectedTerminalId && inspectedUsesPty && (
                  <button
                    type="button"
                    onClick={() => openTerminalById(inspectedTerminalId)}
                    className="p-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:bg-[#111826]"
                    title="Open full terminal pane"
                  >
                    <ArrowUpRight size={12} />
                  </button>
                )}
                <button
                  type="button"
                  onClick={() => setInspectorNodeId(null)}
                  className="p-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:bg-[#111826]"
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
                  className="px-2.5 py-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:bg-[#111826] text-[11px] inline-flex items-center gap-1"
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
                      className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-panel hover:bg-[#111826] text-text-muted hover:text-text-primary"
                      title="Refresh runtime output"
                    >
                      <RefreshCw size={11} />
                      Refresh
                    </button>
                  )}
                </div>

                <pre className="flex-1 overflow-auto px-3 py-3 text-[11px] leading-relaxed text-[#c5d2e4] whitespace-pre-wrap bg-[#0a0f16]">
                  {inspectorOutput || 'Waiting for runtime output...'}
                </pre>

                {inspectorError && (
                  <div className="px-3 py-1.5 text-[10px] text-red-200 bg-red-500/10 border-t border-red-400/20">
                    {inspectorError}
                  </div>
                )}

                {inspectedUsesPty && (
                  <form
                    className="px-3 py-2 border-t border-border-panel bg-[#101826] flex gap-2"
                    onSubmit={event => {
                      event.preventDefault();
                      void sendInspectorCommand();
                    }}
                  >
                    <input
                      value={inspectorCommand}
                      onChange={event => setInspectorCommand(event.target.value)}
                      placeholder="Send command to runtime"
                      className="flex-1 bg-[#0b1118] border border-border-panel rounded px-2 py-1.5 text-[11px] text-text-primary"
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

      <div className="px-3 py-2 shrink-0 border-t border-border-panel bg-[#0a0f15] flex items-center justify-between text-[11px] text-text-muted">
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
