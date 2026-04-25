import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { Bot, Cpu, FileCode2, Focus, Maximize2, RefreshCw, ShieldAlert, Square } from 'lucide-react';
import { TerminalPane } from '../Terminal/TerminalPane';
import { useWorkspaceStore, type CompiledMission, type MissionAgent, type Pane, type WorkflowAgentCli, type WorkflowEdgeCondition, type WorkflowNodeStatus } from '../../store/workspace';
import { workflowStatusLabel, workflowStatusTone } from '../../lib/workflowStatus';

interface PermissionRequest {
  id: string;
  nodeId?: string | null;
  terminalId?: string;
  cli?: string;
  permissionType: string;
  label?: string;
  message?: string;
  dedupeKey?: string;
  timestamp?: number;
  state?: 'pending' | 'approved' | 'denied' | 'injected' | 'failed' | 'expired';
  decision?: 'approve' | 'deny' | string | null;
  error?: string | null;
}

type ResizeCorner = 'se' | 'sw' | 'ne' | 'nw';

interface Point {
  x: number;
  y: number;
}

interface RuntimeNodeLayout {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface RuntimeEdge {
  id: string;
  fromKey: string;
  toKey: string;
  fromNodeId: string;
  toNodeId: string;
  condition: WorkflowEdgeCondition;
}

type CanvasInteraction =
  | { kind: 'idle' }
  | { kind: 'panning'; pointerOrigin: Point; panOrigin: Point }
  | { kind: 'dragging_node'; nodeKey: string; pointerOrigin: Point; nodeOrigin: Point }
  | { kind: 'resizing_node'; nodeKey: string; corner: ResizeCorner; pointerOrigin: Point; startRect: RuntimeNodeLayout };

const DEFAULT_NODE_WIDTH = 460;
const DEFAULT_NODE_HEIGHT = 430;
const MIN_NODE_WIDTH = 280;
const MIN_NODE_HEIGHT = 220;
const GRID_GAP_X = 80;
const GRID_GAP_Y = 60;
const GRID_SIZE = 24;
const ACTIVE_STATUSES = new Set(['launching', 'connecting', 'spawning', 'terminal_started', 'adapter_starting', 'mcp_connecting', 'registered', 'ready', 'activation_pending', 'activation_acked', 'activated', 'running', 'handoff_pending', 'waiting']);

const _sessionLayouts: Record<string, RuntimeNodeLayout> = {};
const _sessionPan: Point = { x: 0, y: 0 };
let _sessionZoom = 1;

function clampZoom(nextZoom: number) {
  return Math.max(0.25, Math.min(2.5, nextZoom));
}

function pointFromMouse(clientX: number, clientY: number, rect: DOMRect): Point {
  return { x: clientX - rect.left, y: clientY - rect.top };
}

function screenToWorld(screen: Point, pan: Point, zoom: number): Point {
  return { x: (screen.x - pan.x) / zoom, y: (screen.y - pan.y) / zoom };
}

function runtimePaneFor(agent: MissionAgent): Pane | null {
  if (!agent.terminalId) return null;
  return {
    id: `runtime-${agent.terminalId}`,
    type: 'terminal',
    title: agent.title || agent.roleId || 'Runtime',
    gridPos: { x: 0, y: 0, w: 12, h: 12 },
    data: {
      terminalId: agent.terminalId,
      nodeId: agent.nodeId,
      roleId: agent.roleId,
      cli: (agent.runtimeCli ?? agent.cli ?? 'claude') as WorkflowAgentCli,
      executionMode: agent.executionMode ?? 'interactive_pty',
    },
  };
}

export function RuntimeView() {
  const tabs = useWorkspaceStore(state => state.tabs);
  const nodeRuntimeBindings = useWorkspaceStore(state => state.nodeRuntimeBindings);
  const globalGraph = useWorkspaceStore(state => state.globalGraph);
  const setAppMode = useWorkspaceStore(state => state.setAppMode);
  const addPane = useWorkspaceStore(state => state.addPane);
  const [permissionRequests, setPermissionRequests] = useState<Record<string, PermissionRequest>>({});

  const [pan, setPan] = useState<Point>(() => ({ ..._sessionPan }));
  const [zoom, setZoom] = useState(() => _sessionZoom);
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: 'idle' });
  const [nodeLayouts, setNodeLayouts] = useState<Record<string, RuntimeNodeLayout>>(() => ({ ..._sessionLayouts }));
  const canvasRef = useRef<HTMLDivElement | null>(null);

  const persistPan = useCallback((next: Point) => {
    _sessionPan.x = next.x;
    _sessionPan.y = next.y;
    setPan(next);
  }, []);

  const persistZoom = useCallback((next: number) => {
    _sessionZoom = next;
    setZoom(next);
  }, []);

  const persistLayouts = useCallback((updater: (prev: Record<string, RuntimeNodeLayout>) => Record<string, RuntimeNodeLayout>) => {
    setNodeLayouts(prev => {
      const next = updater(prev);
      for (const [k, v] of Object.entries(next)) _sessionLayouts[k] = v;
      return next;
    });
  }, []);

  const agents = useMemo(() => {
    const liveAgents: MissionAgent[] = [];
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.type !== 'missioncontrol') continue;
        const paneAgents = (pane.data?.agents as MissionAgent[] | undefined) ?? [];
        liveAgents.push(...paneAgents.filter(agent => agent.terminalId || agent.runtimeSessionId));
      }
    }

    const graphStatusByNodeId = new Map<string, WorkflowNodeStatus>();
    for (const node of globalGraph.nodes) {
      if (node.status && node.status !== 'idle') {
        graphStatusByNodeId.set(node.id, node.status);
      }
    }

    const byNode = new Map(liveAgents.filter(agent => agent.nodeId).map(agent => [agent.nodeId as string, agent]));
    for (const node of globalGraph.nodes) {
      const isSystemRole = ['task', 'barrier', 'frame', 'reroute', 'output'].includes(node.roleId);
      if (isSystemRole && !node.config?.profileId) continue;
      if (byNode.has(node.id)) continue;
      const binding = nodeRuntimeBindings[node.id];
      const terminalId = String(node.config?.terminalId ?? binding?.terminalId ?? '').trim();
      const runtimeSessionId = String(binding?.runtimeSessionId ?? '').trim();
      if (!terminalId && !runtimeSessionId) continue;
      liveAgents.push({
        nodeId: node.id,
        terminalId,
        title: node.config?.terminalTitle || `Runtime ${node.roleId ?? 'agent'}`,
        roleId: node.roleId ?? 'agent',
        status: graphStatusByNodeId.get(node.id) ?? binding?.adapterStatus ?? node.status ?? 'idle',
        runtimeSessionId: runtimeSessionId || null,
        cli: node.config?.cli,
        runtimeCli: node.config?.cli ?? null,
        executionMode: node.config?.executionMode ?? 'interactive_pty',
      });
    }

    const deduped = new Map<string, MissionAgent>();
    for (const agent of liveAgents) {
      const key = agent.nodeId || agent.terminalId || agent.runtimeSessionId || `${agent.roleId}-${deduped.size}`;
      const graphStatus = agent.nodeId ? graphStatusByNodeId.get(agent.nodeId) : undefined;
      const merged = { ...(deduped.get(key) ?? {}), ...agent };
      if (graphStatus && graphStatus !== 'idle' && graphStatus !== 'disconnected' && graphStatus !== 'failed') {
        merged.status = graphStatus;
        merged.lastError = null;
        merged.runtimeBootstrapReason = null;
      }
      deduped.set(key, merged);
    }
    return Array.from(deduped.values());
  }, [globalGraph.nodes, nodeRuntimeBindings, tabs]);

  const runtimeNodes = useMemo(() => {
    const occupied = new Set<string>();
    return agents.map((agent, index) => {
      const key = agent.nodeId || agent.terminalId || agent.runtimeSessionId || `runtime-${index}`;
      const workflowNode = agent.nodeId ? globalGraph.nodes.find(node => node.id === agent.nodeId) : null;
      const position = workflowNode?.config?.position;
      const existing = nodeLayouts[key];
      let x: number, y: number;
      if (existing) {
        x = existing.x;
        y = existing.y;
      } else {
        x = typeof position?.x === 'number' ? position.x : 60 + (index % 3) * (DEFAULT_NODE_WIDTH + GRID_GAP_X);
        y = typeof position?.y === 'number' ? position.y : 70 + Math.floor(index / 3) * (DEFAULT_NODE_HEIGHT + GRID_GAP_Y);
      }
      let guard = 0;
      while (occupied.has(`${Math.round(x)}:${Math.round(y)}`) && guard < 20) {
        x += 32;
        y += 28;
        guard += 1;
      }
      occupied.add(`${Math.round(x)}:${Math.round(y)}`);
      return { key, agent, x, y };
    });
  }, [agents, globalGraph.nodes, nodeLayouts]);

  useEffect(() => {
    persistLayouts(prev => {
      let changed = false;
      const next = { ...prev };
      for (const node of runtimeNodes) {
        if (!next[node.key]) {
          next[node.key] = { x: node.x, y: node.y, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
          changed = true;
        }
      }
      return changed ? next : prev;
    });
  }, [runtimeNodes, persistLayouts]);

  const getNodeLayout = useCallback((key: string): RuntimeNodeLayout => {
    return nodeLayouts[key] ?? { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
  }, [nodeLayouts]);

  const runtimeNodeByNodeId = useMemo(() => {
    const map = new Map<string, typeof runtimeNodes[number]>();
    for (const node of runtimeNodes) {
      if (node.agent.nodeId) map.set(node.agent.nodeId, node);
    }
    return map;
  }, [runtimeNodes]);

  const runtimeEdges = useMemo<RuntimeEdge[]>(() => {
    const seen = new Set<string>();
    const edges: RuntimeEdge[] = [];

    const addEdge = (fromNodeId: string, toNodeId: string, condition: WorkflowEdgeCondition) => {
      const id = `${fromNodeId}->${toNodeId}`;
      if (seen.has(id)) return;
      seen.add(id);
      edges.push({ id, fromNodeId, toNodeId, condition, fromKey: '', toKey: '' });
    };

    for (const edge of globalGraph.edges) {
      addEdge(edge.fromNodeId, edge.toNodeId, edge.condition ?? 'always');
    }

    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.type !== 'missioncontrol') continue;
        const mission = pane.data?.mission as CompiledMission | undefined;
        if (!mission?.edges) continue;
        for (const edge of mission.edges) {
          addEdge(edge.fromNodeId, edge.toNodeId, edge.condition ?? 'always');
        }
      }
    }

    return edges
      .map(edge => {
        const fromNode = runtimeNodeByNodeId.get(edge.fromNodeId);
        const toNode = runtimeNodeByNodeId.get(edge.toNodeId);
        if (!fromNode || !toNode) return null;
        return { ...edge, fromKey: fromNode.key, toKey: toNode.key };
      })
      .filter((e): e is RuntimeEdge & { fromKey: string; toKey: string } => e !== null);
  }, [globalGraph.edges, runtimeNodeByNodeId, tabs]);

  useEffect(() => {
    let unlistenRequested: (() => void) | undefined;
    let unlistenUpdated: (() => void) | undefined;
    let unmounted = false;
    invoke<PermissionRequest[]>('list_active_permission_requests')
      .then(requests => {
        if (unmounted) return;
        setPermissionRequests(Object.fromEntries(requests.map(request => [request.id, request])));
      })
      .catch(() => {});
    listen<PermissionRequest>('workflow-permission-requested', event => {
      if (unmounted) return;
      setPermissionRequests(previous => {
        const dedupeKey = event.payload.dedupeKey ?? event.payload.id;
        const existing = Object.values(previous).find(request => (request.dedupeKey ?? request.id) === dedupeKey);
        if (existing?.state === 'pending') return previous;
        return {
          ...previous,
          [event.payload.id]: { ...event.payload, dedupeKey, state: 'pending' },
        };
      });
    }).then(fn => {
      unlistenRequested = fn;
      if (unmounted) fn();
    });
    listen<PermissionRequest>('workflow-permission-updated', event => {
      if (unmounted) return;
      setPermissionRequests(previous => ({
        ...previous,
        [event.payload.id]: event.payload,
      }));
    }).then(fn => {
      unlistenUpdated = fn;
      if (unmounted) fn();
    });
    return () => {
      unmounted = true;
      unlistenRequested?.();
      unlistenUpdated?.();
    };
  }, []);

  const decidePermission = (request: PermissionRequest, decision: 'approve' | 'deny') => {
    setPermissionRequests(previous => ({
      ...previous,
      [request.id]: { ...request, state: decision === 'approve' ? 'approved' : 'denied' },
    }));
    invoke('handle_workflow_permission_decision', {
      requestId: request.id,
      decision,
    }).catch(() => {
      setPermissionRequests(previous => ({
        ...previous,
        [request.id]: { ...request, state: 'failed', decision, error: 'Decision was rejected by the backend.' },
      }));
    });
  };

  const focusRuntime = (agent: MissionAgent) => {
    if (!agent.terminalId) return;
    emit('focus-terminal', { terminalId: agent.terminalId }).catch(() => {});
  };

  const stopRuntime = (agent: MissionAgent) => {
    if (!agent.terminalId) return;
    invoke('destroy_pty', { id: agent.terminalId }).catch(() => {});
  };

  const retryRuntime = (agent: MissionAgent) => {
    emit('workflow-runtime-retry-requested', {
      nodeId: agent.nodeId ?? null,
      terminalId: agent.terminalId ?? null,
      runtimeSessionId: agent.runtimeSessionId ?? null,
    }).catch(() => {});
  };

  const openArtifact = (agent: MissionAgent) => {
    const artifact = agent.artifacts?.find(item => item.path);
    if (!artifact?.path) return;
    addPane('editor', artifact.label || artifact.path.split(/[\\/]/).pop() || 'Artifact', { filePath: artifact.path });
    setAppMode('workspace');
  };

  const requestsByNode = useMemo(() => {
    const map = new Map<string, PermissionRequest[]>();
    for (const request of Object.values(permissionRequests)) {
      const key = request.nodeId || request.terminalId || 'global';
      map.set(key, [...(map.get(key) ?? []), request]);
    }
    return map;
  }, [permissionRequests]);

  const onWheel = useCallback(
    (event: React.WheelEvent<HTMLDivElement>) => {
      event.preventDefault();
      event.stopPropagation();
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);
      const worldBefore = screenToWorld(screenPoint, pan, zoom);
      if (event.ctrlKey || event.metaKey) {
        const nextZoom = clampZoom(zoom + (event.deltaY > 0 ? -0.08 : 0.08));
        persistPan({
          x: screenPoint.x - worldBefore.x * nextZoom,
          y: screenPoint.y - worldBefore.y * nextZoom,
        });
        persistZoom(nextZoom);
      } else {
        persistPan({ x: pan.x - event.deltaX, y: pan.y - event.deltaY });
      }
    },
    [pan, zoom, persistPan, persistZoom]
  );

  const onCanvasMouseDown = useCallback(
    (event: React.MouseEvent<HTMLDivElement>) => {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);

      if (event.button === 1 || (event.button === 0 && event.altKey)) {
        event.preventDefault();
        setInteraction({ kind: 'panning', pointerOrigin: screenPoint, panOrigin: pan });
        return;
      }

      if (event.button === 0 && (event.target === canvasRef.current || (event.target as HTMLElement).dataset?.runtimeCanvas !== undefined)) {
        setInteraction({ kind: 'panning', pointerOrigin: screenPoint, panOrigin: pan });
      }
    },
    [pan]
  );

  const startNodeDrag = useCallback(
    (event: React.MouseEvent<HTMLDivElement>, nodeKey: string) => {
      event.stopPropagation();
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);
      const layout = getNodeLayout(nodeKey);
      setInteraction({
        kind: 'dragging_node',
        nodeKey,
        pointerOrigin: screenPoint,
        nodeOrigin: { x: layout.x, y: layout.y },
      });
    },
    [getNodeLayout]
  );

  const startNodeResize = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, nodeKey: string, corner: ResizeCorner) => {
      event.stopPropagation();
      event.preventDefault();
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);
      const layout = getNodeLayout(nodeKey);
      setInteraction({
        kind: 'resizing_node',
        nodeKey,
        corner,
        pointerOrigin: screenPoint,
        startRect: { ...layout },
      });
    },
    [getNodeLayout]
  );

  useEffect(() => {
    if (interaction.kind === 'idle') return;

    function onWindowMouseMove(event: MouseEvent) {
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);

      if (interaction.kind === 'panning') {
        persistPan({
          x: interaction.panOrigin.x + (screenPoint.x - interaction.pointerOrigin.x),
          y: interaction.panOrigin.y + (screenPoint.y - interaction.pointerOrigin.y),
        });
        return;
      }

      if (interaction.kind === 'dragging_node') {
        const dx = (screenPoint.x - interaction.pointerOrigin.x) / zoom;
        const dy = (screenPoint.y - interaction.pointerOrigin.y) / zoom;
        const nodeKey = interaction.nodeKey;
        persistLayouts(prev => ({
          ...prev,
          [nodeKey]: {
            ...prev[nodeKey],
            x: interaction.nodeOrigin.x + dx,
            y: interaction.nodeOrigin.y + dy,
          },
        }));
        return;
      }

      if (interaction.kind === 'resizing_node') {
        const dx = (screenPoint.x - interaction.pointerOrigin.x) / zoom;
        const dy = (screenPoint.y - interaction.pointerOrigin.y) / zoom;
        let { x, y, width, height } = interaction.startRect;
        const corner = interaction.corner;

        if (corner === 'se') {
          width += dx;
          height += dy;
        } else if (corner === 'sw') {
          x += dx;
          width -= dx;
          height += dy;
        } else if (corner === 'ne') {
          y += dy;
          width += dx;
          height -= dy;
        } else if (corner === 'nw') {
          x += dx;
          y += dy;
          width -= dx;
          height -= dy;
        }

        if (width < MIN_NODE_WIDTH) {
          if (corner === 'nw' || corner === 'sw') x -= MIN_NODE_WIDTH - width;
          width = MIN_NODE_WIDTH;
        }
        if (height < MIN_NODE_HEIGHT) {
          if (corner === 'nw' || corner === 'ne') y -= MIN_NODE_HEIGHT - height;
          height = MIN_NODE_HEIGHT;
        }

        const nodeKey = interaction.nodeKey;
        persistLayouts(prev => ({
          ...prev,
          [nodeKey]: { x, y, width, height },
        }));
      }
    }

    function onWindowMouseUp() {
      setInteraction({ kind: 'idle' });
    }

    window.addEventListener('mousemove', onWindowMouseMove);
    window.addEventListener('mouseup', onWindowMouseUp);
    return () => {
      window.removeEventListener('mousemove', onWindowMouseMove);
      window.removeEventListener('mouseup', onWindowMouseUp);
    };
  }, [interaction, zoom, persistPan, persistLayouts]);

  const resetView = useCallback(() => {
    if (runtimeNodes.length === 0) {
      persistPan({ x: 0, y: 0 });
      persistZoom(1);
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of runtimeNodes) {
      const layout = getNodeLayout(node.key);
      minX = Math.min(minX, layout.x);
      minY = Math.min(minY, layout.y);
      maxX = Math.max(maxX, layout.x + layout.width);
      maxY = Math.max(maxY, layout.y + layout.height);
    }
    const canvasRect = canvasRef.current?.getBoundingClientRect();
    if (canvasRect) {
      const contentWidth = maxX - minX + 80;
      const contentHeight = maxY - minY + 80;
      const scaleX = canvasRect.width / contentWidth;
      const scaleY = canvasRect.height / contentHeight;
      const nextZoom = clampZoom(Math.min(scaleX, scaleY, 1));
      persistPan({
        x: (canvasRect.width - contentWidth * nextZoom) / 2 - minX * nextZoom + 40 * nextZoom,
        y: (canvasRect.height - contentHeight * nextZoom) / 2 - minY * nextZoom + 40 * nextZoom,
      });
      persistZoom(nextZoom);
    }
  }, [runtimeNodes, getNodeLayout, persistPan, persistZoom]);

  const isInteracting = interaction.kind !== 'idle';

  return (
    <div className="h-full w-full bg-bg-app flex flex-col">
      <div className="shrink-0 z-20 px-5 py-3 border-b border-border-panel bg-bg-app/95 backdrop-blur flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-accent-primary">Machine View</div>
          <div className="text-lg font-semibold text-text-primary">Runtime Execution</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[11px] text-text-muted">
            {agents.length} runtime node{agents.length === 1 ? '' : 's'} · {runtimeEdges.length} edge{runtimeEdges.length === 1 ? '' : 's'}
          </div>
          <button
            className="px-2 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:bg-bg-surface text-[11px] flex items-center gap-1"
            onClick={resetView}
            title="Fit all nodes in view"
          >
            <Maximize2 size={12} />
            Fit
          </button>
          <div className="text-[10px] text-text-muted tabular-nums w-16 text-right">
            {Math.round(zoom * 100)}%
          </div>
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-text-muted gap-3">
          <Cpu size={34} className="opacity-40" />
          <div className="text-sm text-text-secondary">No active agent sessions.</div>
          <div className="text-[11px] max-w-sm">Run a workflow to populate this view with live runtime nodes and terminal streams.</div>
        </div>
      ) : (
        <div
          ref={canvasRef}
          className="relative flex-1 overflow-hidden"
          onWheel={onWheel}
          onMouseDown={onCanvasMouseDown}
          style={{ cursor: isInteracting ? 'grabbing' : 'default' }}
        >
          <div
            className="absolute inset-0 opacity-60"
            data-runtime-canvas
            style={{
              backgroundImage:
                'linear-gradient(rgba(120,150,180,0.06) 1px, transparent 1px), linear-gradient(90deg, rgba(120,150,180,0.06) 1px, transparent 1px)',
              backgroundSize: `${GRID_SIZE * zoom}px ${GRID_SIZE * zoom}px`,
              backgroundPosition: `${pan.x % (GRID_SIZE * zoom)}px ${pan.y % (GRID_SIZE * zoom)}px`,
            }}
          />

          <div
            className="absolute inset-0"
            style={{
              transform: `translate(${pan.x}px, ${pan.y}px) scale(${zoom})`,
              transformOrigin: '0 0',
            }}
          >
            <svg className="absolute pointer-events-none overflow-visible" style={{ left: 0, top: 0, width: '100%', height: '100%', overflow: 'visible' }}>
              {runtimeEdges.map(edge => {
                const fromLayout = getNodeLayout(edge.fromKey);
                const toLayout = getNodeLayout(edge.toKey);
                const fromX = fromLayout.x + fromLayout.width;
                const fromY = fromLayout.y + 86;
                const toX = toLayout.x;
                const toY = toLayout.y + 86;
                const mid = Math.max(70, Math.abs(toX - fromX) * 0.45);
                return (
                  <path
                    key={edge.id}
                    d={`M ${fromX} ${fromY} C ${fromX + mid} ${fromY}, ${toX - mid} ${toY}, ${toX} ${toY}`}
                    fill="none"
                    stroke="rgba(139,195,255,0.42)"
                    strokeWidth="2"
                    strokeDasharray={edge.condition === 'always' ? undefined : '8 6'}
                  />
                );
              })}
            </svg>

            {runtimeNodes.map(runtimeNode => {
              const agent = runtimeNode.agent;
              const pane = runtimePaneFor(agent);
              const status = agent.status ?? 'idle';
              const isActive = ACTIVE_STATUSES.has(status);
              const nodeRequests = requestsByNode.get(agent.nodeId || agent.terminalId || 'global') ?? [];
              const layout = getNodeLayout(runtimeNode.key);
              const isDragging = interaction.kind === 'dragging_node' && interaction.nodeKey === runtimeNode.key;

              return (
                <div
                  key={runtimeNode.key}
                  className={`absolute rounded-lg border bg-bg-panel overflow-hidden flex flex-col shadow-lg transition-shadow ${
                    isActive ? 'border-accent-primary/50 shadow-accent-primary/5' : 'border-border-panel'
                  } ${isDragging ? 'shadow-2xl ring-2 ring-accent-primary/30' : ''}`}
                  style={{
                    left: layout.x,
                    top: layout.y,
                    width: layout.width,
                    height: layout.height,
                    zIndex: isDragging ? 20 : 10,
                  }}
                >
                  <div
                    className="h-12 px-3 border-b border-border-panel bg-bg-titlebar flex items-center justify-between gap-3 select-none"
                    style={{ cursor: isInteracting ? 'grabbing' : 'grab' }}
                    onMouseDown={event => {
                      if (event.button === 0 && !event.altKey) {
                        startNodeDrag(event, runtimeNode.key);
                      }
                    }}
                  >
                    <div className="min-w-0 flex items-center gap-2">
                      <Bot size={15} className="text-accent-primary shrink-0" />
                      <div className="min-w-0">
                        <div className="text-sm font-semibold text-text-primary truncate">{agent.roleId || agent.title}</div>
                        <div className="text-[10px] text-text-muted truncate">{agent.runtimeCli ?? agent.cli ?? 'CLI unknown'} · {agent.terminalId || agent.runtimeSessionId}</div>
                      </div>
                    </div>
                    <div className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${workflowStatusTone(status, 'mission')}`}>
                      {workflowStatusLabel(status)}
                    </div>
                  </div>

                  <div className="h-9 px-3 border-b border-border-panel bg-bg-panel flex items-center justify-between">
                    <div className="text-[10px] text-text-muted truncate">{agent.currentAction || (isActive ? 'Working...' : 'No active action')}</div>
                    <div className="flex items-center gap-1">
                      <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-surface" title="Focus terminal" onClick={() => focusRuntime(agent)} disabled={!agent.terminalId}>
                        <Focus size={13} />
                      </button>
                      <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-red-300 hover:bg-red-500/10" title="Stop session" onClick={() => stopRuntime(agent)} disabled={!agent.terminalId}>
                        <Square size={12} />
                      </button>
                      <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-surface" title="Retry activation" onClick={() => retryRuntime(agent)}>
                        <RefreshCw size={13} />
                      </button>
                      <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-surface disabled:opacity-30" title="Open artifact in Workspace" onClick={() => openArtifact(agent)} disabled={!agent.artifacts?.some(item => item.path)}>
                        <FileCode2 size={13} />
                      </button>
                    </div>
                  </div>

                  {nodeRequests.map(request => (
                    <div key={request.id} className="m-3 mb-0 rounded border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] text-amber-100">
                      <div className="flex items-center gap-2 font-semibold">
                        <ShieldAlert size={13} />
                        Grant permission for: {request.label ?? request.permissionType}?
                      </div>
                      {request.message && <div className="mt-1 text-amber-100/70 line-clamp-2">{request.message}</div>}
                      {request.error && <div className="mt-1 text-red-200/80 line-clamp-2">{request.error}</div>}
                      {request.state === 'pending' ? (
                        <div className="mt-2 flex gap-2">
                          <button className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-400/30" onClick={() => decidePermission(request, 'approve')}>Approve</button>
                          <button className="px-2 py-1 rounded bg-red-500/20 text-red-200 border border-red-400/30" onClick={() => decidePermission(request, 'deny')}>Deny</button>
                        </div>
                      ) : (
                        <div className="mt-2 uppercase tracking-wide text-[9px] text-amber-100/70">{request.state}{request.decision ? ` · ${request.decision}` : ''}</div>
                      )}
                    </div>
                  ))}

                  <div className="flex-1 min-h-0 bg-bg-app overflow-hidden">
                    {pane ? (
                      <TerminalPane pane={pane} />
                    ) : (
                      <div className="h-full flex items-center justify-center text-[12px] text-text-muted">Runtime has no PTY stream.</div>
                    )}
                  </div>

                  <button
                    className="absolute bottom-0 right-0 w-4 h-4 cursor-nwse-resize z-10"
                    onMouseDown={event => startNodeResize(event, runtimeNode.key, 'se')}
                    title="Resize node"
                  >
                    <svg className="w-4 h-4 text-text-muted opacity-30 hover:opacity-70" viewBox="0 0 16 16">
                      <path d="M14 14L14 8M14 14L8 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                      <path d="M14 14L14 10M14 14L10 14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" opacity="0.5" />
                    </svg>
                  </button>
                  <button
                    className="absolute bottom-0 left-0 w-4 h-4 cursor-nesw-resize z-10"
                    onMouseDown={event => startNodeResize(event, runtimeNode.key, 'sw')}
                    title="Resize node"
                  >
                    <svg className="w-4 h-4 text-text-muted opacity-30 hover:opacity-70" viewBox="0 0 16 16">
                      <path d="M2 14L2 8M2 14L8 14" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    className="absolute top-0 right-0 w-4 h-4 cursor-nesw-resize z-10"
                    onMouseDown={event => startNodeResize(event, runtimeNode.key, 'ne')}
                    title="Resize node"
                  >
                    <svg className="w-4 h-4 text-text-muted opacity-30 hover:opacity-70" viewBox="0 0 16 16">
                      <path d="M14 2L14 8M14 2L8 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                  <button
                    className="absolute top-0 left-0 w-4 h-4 cursor-nwse-resize z-10"
                    onMouseDown={event => startNodeResize(event, runtimeNode.key, 'nw')}
                    title="Resize node"
                  >
                    <svg className="w-4 h-4 text-text-muted opacity-30 hover:opacity-70" viewBox="0 0 16 16">
                      <path d="M2 2L2 8M2 2L8 2" stroke="currentColor" strokeWidth="2" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              );
            })}
          </div>

          {interaction.kind === 'panning' && (
            <div className="absolute bottom-4 left-4 px-2 py-1 rounded bg-bg-panel/90 border border-border-panel text-[10px] text-text-muted pointer-events-none">
              Panning...
            </div>
          )}
        </div>
      )}
    </div>
  );
}
