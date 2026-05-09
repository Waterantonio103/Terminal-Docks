import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { DotTunnelBackground } from '../shared/DotTunnelBackground';
import { Bot, Cpu, FileCode2, Focus, Maximize2, RefreshCw, ShieldAlert, Square } from 'lucide-react';
import { TerminalPane } from '../Terminal/TerminalPane';
import { useWorkspaceStore, type CompiledMission, type Pane, type WorkflowAgentCli, type WorkflowEdgeCondition } from '../../store/workspace';
import { workflowStatusLabel, workflowStatusTone } from '../../lib/workflowStatus';
import { useRuntimeSessions, useRuntimeObserver, type EnrichedRuntimeSession } from './useRuntimeSessions';
import { runtimeObserver } from './RuntimeObserver';

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
const GRAPH_GAP_X = 72;
const GRAPH_GAP_Y = 96;
const GRID_SIZE = 24;
const ACTIVE_STATUSES = new Set<string>([
  'launching', 'connecting', 'spawning', 'terminal_started',
  'adapter_starting', 'mcp_connecting', 'registered', 'ready',
  'activation_pending', 'activation_acked', 'activated',
  'running', 'handoff_pending', 'waiting',
]);
const WORKING_STATUSES = new Set<string>([
  'activated', 'activation_acked', 'running', 'handoff_pending', 'waiting',
]);
const EMPTY_RUNTIME_GRAPH = { id: 'runtime-empty-graph', nodes: [], edges: [] };

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

function layoutKeyFor(session: EnrichedRuntimeSession, index: number): string {
  return session.nodeId || session.terminalId || `runtime-${index}`;
}

function runtimePaneFor(session: EnrichedRuntimeSession): Pane {
  return {
    id: `runtime-${session.terminalId}`,
    type: 'terminal',
    title: session.title || session.roleId || 'Runtime',
    gridPos: { x: 0, y: 0, w: 12, h: 12 },
    data: {
      terminalId: session.terminalId,
      runtimeSessionId: session.sessionId,
      nodeId: session.nodeId,
      roleId: session.roleId,
      cli: (session.cli ?? 'claude') as WorkflowAgentCli,
      executionMode: session.executionMode ?? 'interactive_pty',
      runtimeManaged: true,
    },
  };
}

function buildVisibleRuntimeEdges(
  runtimeNodes: Array<{ key: string; session: EnrichedRuntimeSession }>,
  graphEdges: Array<{ fromNodeId: string; toNodeId: string; condition?: WorkflowEdgeCondition }>,
): RuntimeEdge[] {
  const keyByNodeId = new Map<string, string>();
  for (const node of runtimeNodes) {
    if (node.session.nodeId) keyByNodeId.set(node.session.nodeId, node.key);
  }

  const adjacency = new Map<string, Array<{ toNodeId: string; condition: WorkflowEdgeCondition }>>();
  for (const edge of graphEdges) {
    const list = adjacency.get(edge.fromNodeId) ?? [];
    list.push({ toNodeId: edge.toNodeId, condition: edge.condition ?? 'always' });
    adjacency.set(edge.fromNodeId, list);
  }

  const seen = new Set<string>();
  const visibleEdges: RuntimeEdge[] = [];

  for (const [sourceNodeId, sourceKey] of keyByNodeId.entries()) {
    const queue = adjacency.get(sourceNodeId)?.map(edge => ({ ...edge, firstCondition: edge.condition })) ?? [];
    const visited = new Set<string>();

    while (queue.length > 0) {
      const next = queue.shift()!;
      if (visited.has(next.toNodeId)) continue;
      visited.add(next.toNodeId);

      const targetKey = keyByNodeId.get(next.toNodeId);
      if (targetKey) {
        const id = `${sourceNodeId}->${next.toNodeId}`;
        if (!seen.has(id)) {
          seen.add(id);
          visibleEdges.push({
            id,
            fromNodeId: sourceNodeId,
            toNodeId: next.toNodeId,
            condition: next.firstCondition,
            fromKey: sourceKey,
            toKey: targetKey,
          });
        }
        continue;
      }

      for (const child of adjacency.get(next.toNodeId) ?? []) {
        queue.push({
          toNodeId: child.toNodeId,
          condition: child.condition,
          firstCondition: next.firstCondition === 'always' ? child.condition : next.firstCondition,
        });
      }
    }
  }

  return visibleEdges;
}

function computeVerticalRuntimeLayouts(
  runtimeNodes: Array<{ key: string; session: EnrichedRuntimeSession }>,
  runtimeEdges: RuntimeEdge[],
  previous: Record<string, RuntimeNodeLayout>,
  preferredLayers: string[][] = [],
): Record<string, RuntimeNodeLayout> {
  const currentKeys = new Set(runtimeNodes.map(node => node.key));
  const nodeByKey = new Map(runtimeNodes.map(node => [node.key, node]));
  const keyByNodeId = new Map<string, string>();
  for (const node of runtimeNodes) {
    if (node.session.nodeId) keyByNodeId.set(node.session.nodeId, node.key);
  }
  const incoming = new Map<string, number>();
  const children = new Map<string, string[]>();
  const depth = new Map<string, number>();
  const order = new Map(runtimeNodes.map((node, index) => [node.key, index]));

  for (const node of runtimeNodes) {
    incoming.set(node.key, 0);
    children.set(node.key, []);
    depth.set(node.key, 0);
  }

  for (const edge of runtimeEdges) {
    if (!currentKeys.has(edge.fromKey) || !currentKeys.has(edge.toKey)) continue;
    children.get(edge.fromKey)!.push(edge.toKey);
    incoming.set(edge.toKey, (incoming.get(edge.toKey) ?? 0) + 1);
  }

  const queue = runtimeNodes
    .filter(node => (incoming.get(node.key) ?? 0) === 0)
    .sort((a, b) => (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0))
    .map(node => node.key);

  const visited = new Set<string>();
  while (queue.length > 0) {
    const key = queue.shift()!;
    if (visited.has(key)) continue;
    visited.add(key);
    for (const child of children.get(key) ?? []) {
      depth.set(child, Math.max(depth.get(child) ?? 0, (depth.get(key) ?? 0) + 1));
      incoming.set(child, (incoming.get(child) ?? 1) - 1);
      if ((incoming.get(child) ?? 0) <= 0) queue.push(child);
    }
  }

  for (const node of runtimeNodes) {
    if (!visited.has(node.key)) {
      const parentDepths = runtimeEdges
        .filter(edge => edge.toKey === node.key && depth.has(edge.fromKey))
        .map(edge => (depth.get(edge.fromKey) ?? 0) + 1);
      depth.set(node.key, parentDepths.length ? Math.max(...parentDepths) : 0);
    }
  }

  const layers = new Map<number, Array<{ key: string; session: EnrichedRuntimeSession }>>();
  const placedKeys = new Set<string>();
  preferredLayers.forEach((nodeIds, layer) => {
    for (const nodeId of nodeIds) {
      const key = keyByNodeId.get(nodeId);
      const node = key ? nodeByKey.get(key) : undefined;
      if (!node || placedKeys.has(node.key)) continue;
      const list = layers.get(layer) ?? [];
      list.push(node);
      layers.set(layer, list);
      placedKeys.add(node.key);
    }
  });

  for (const node of runtimeNodes) {
    if (placedKeys.has(node.key)) continue;
    const layer = depth.get(node.key) ?? 0;
    const list = layers.get(layer) ?? [];
    list.push(node);
    layers.set(layer, list);
  }

  const layerWidths = [...layers.values()].map(nodes =>
    nodes.length * DEFAULT_NODE_WIDTH + Math.max(0, nodes.length - 1) * GRAPH_GAP_X,
  );
  const widestLayer = Math.max(DEFAULT_NODE_WIDTH, ...layerWidths);
  const next: Record<string, RuntimeNodeLayout> = {};
  for (const [layer, nodes] of [...layers.entries()].sort((a, b) => a[0] - b[0])) {
    const sorted = nodes.sort((a, b) => {
      const ax = a.session.position?.x;
      const bx = b.session.position?.x;
      if (typeof ax === 'number' && typeof bx === 'number' && ax !== bx) return ax - bx;
      return (order.get(a.key) ?? 0) - (order.get(b.key) ?? 0);
    });
    const totalWidth = sorted.length * DEFAULT_NODE_WIDTH + Math.max(0, sorted.length - 1) * GRAPH_GAP_X;
    const startX = 60 + (widestLayer - totalWidth) / 2;
    for (let index = 0; index < sorted.length; index += 1) {
      const node = sorted[index];
      next[node.key] = {
        x: startX + index * (DEFAULT_NODE_WIDTH + GRAPH_GAP_X),
        y: 70 + layer * (DEFAULT_NODE_HEIGHT + GRAPH_GAP_Y),
        width: previous[node.key]?.width ?? DEFAULT_NODE_WIDTH,
        height: previous[node.key]?.height ?? DEFAULT_NODE_HEIGHT,
      };
    }
  }

  return next;
}

export function RuntimeView() {
  const setAppMode = useWorkspaceStore(state => state.setAppMode);
  const addPane = useWorkspaceStore(state => state.addPane);
  const globalGraph = useWorkspaceStore(state => state.globalGraph ?? EMPTY_RUNTIME_GRAPH);
  const tabs = useWorkspaceStore(state => state.tabs ?? []);

  const sessions = useRuntimeSessions();
  const { 
    focusRuntime, 
    stopRuntime, 
    retryRuntime, 
    resolvePermission,
    resumeNode,
    forceCompleteNode,
    forceFailNode
  } = useRuntimeObserver();

  const [pan, setPan] = useState<Point>(() => ({ ..._sessionPan }));
  const [zoom, setZoom] = useState(() => _sessionZoom);
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: 'idle' });
  const [nodeLayouts, setNodeLayouts] = useState<Record<string, RuntimeNodeLayout>>(() => ({ ..._sessionLayouts }));
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const autoFitSignatureRef = useRef<string>('');

  useEffect(() => {
    runtimeObserver.start();
    return () => {
      runtimeObserver.stop();
    };
  }, []);

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

  const handleCanvasWheel = useCallback(
    (event: WheelEvent) => {
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

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    canvas.addEventListener('wheel', handleCanvasWheel, { passive: false });
    return () => {
      canvas.removeEventListener('wheel', handleCanvasWheel);
    };
  }, [handleCanvasWheel]);

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
      const layout = nodeLayouts[nodeKey] ?? { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
      setInteraction({
        kind: 'dragging_node',
        nodeKey,
        pointerOrigin: screenPoint,
        nodeOrigin: { x: layout.x, y: layout.y },
      });
    },
    [nodeLayouts]
  );

  const startNodeResize = useCallback(
    (event: React.MouseEvent<HTMLButtonElement>, nodeKey: string, corner: ResizeCorner) => {
      event.stopPropagation();
      event.preventDefault();
      if (!canvasRef.current) return;
      const rect = canvasRef.current.getBoundingClientRect();
      const screenPoint = pointFromMouse(event.clientX, event.clientY, rect);
      const layout = nodeLayouts[nodeKey] ?? { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
      setInteraction({
        kind: 'resizing_node',
        nodeKey,
        corner,
        pointerOrigin: screenPoint,
        startRect: { ...layout },
      });
    },
    [nodeLayouts]
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

  const runtimeNodes = useMemo(
    () => sessions.map((session, index) => ({ key: layoutKeyFor(session, index), session })),
    [sessions],
  );

  const allPanes = useMemo(() => tabs.flatMap(tab => tab.panes), [tabs]);

  const missionGraph = useMemo(() => {
    const missionIds = new Set(sessions.map(session => session.missionId).filter(Boolean));
    const missionPanes = allPanes
      .map((pane: Pane) => pane.data?.mission as CompiledMission | undefined)
      .filter((mission): mission is CompiledMission => Boolean(mission && missionIds.has(mission.missionId)));
    const latestMission = missionPanes[missionPanes.length - 1];
    return {
      edges: latestMission?.edges ?? globalGraph.edges,
      executionLayers: latestMission?.metadata?.executionLayers ?? [],
    };
  }, [allPanes, globalGraph.edges, sessions]);

  const runtimeEdges = useMemo<RuntimeEdge[]>(
    () => buildVisibleRuntimeEdges(runtimeNodes, missionGraph.edges),
    [runtimeNodes, missionGraph.edges],
  );

  useEffect(() => {
    persistLayouts(prev => {
      let next = computeVerticalRuntimeLayouts(runtimeNodes, runtimeEdges, prev, missionGraph.executionLayers);
      let changed = false;
      const currentKeys = new Set(runtimeNodes.map(node => node.key));
      for (const key of Object.keys(_sessionLayouts)) {
        if (!currentKeys.has(key)) delete _sessionLayouts[key];
      }
      if (Object.keys(prev).length !== Object.keys(next).length) {
        changed = true;
      } else {
        for (const [key, layout] of Object.entries(next)) {
          const old = prev[key];
          if (!old || old.x !== layout.x || old.y !== layout.y || old.width !== layout.width || old.height !== layout.height) {
            changed = true;
            break;
          }
        }
      }
      return changed ? next : prev;
    });
  }, [runtimeNodes, runtimeEdges, persistLayouts]);

  const resetView = useCallback(() => {
    if (runtimeNodes.length === 0) {
      persistPan({ x: 0, y: 0 });
      persistZoom(1);
      return;
    }
    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const node of runtimeNodes) {
      const layout = nodeLayouts[node.key] || { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
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
  }, [runtimeNodes, nodeLayouts, persistPan, persistZoom]);

  useEffect(() => {
    if (runtimeNodes.length === 0) return;
    if (!runtimeNodes.every(node => nodeLayouts[node.key])) return;
    const signature = [
      runtimeNodes.map(node => node.key).join('|'),
      runtimeEdges.map(edge => edge.id).join('|'),
    ].join('::');
    if (autoFitSignatureRef.current === signature) return;
    autoFitSignatureRef.current = signature;
    const frame = window.requestAnimationFrame(resetView);
    return () => window.cancelAnimationFrame(frame);
  }, [runtimeNodes, runtimeEdges, nodeLayouts, resetView]);

  const openArtifact = (session: EnrichedRuntimeSession) => {
    const artifact = session.artifacts?.find(item => item.path);
    if (!artifact?.path) return;
    addPane('editor', artifact.label || artifact.path.split(/[\\/]/).pop() || 'Artifact', { filePath: artifact.path });
    setAppMode('workspace');
  };

  const isInteracting = interaction.kind !== 'idle';

  return (
    <div className="h-full w-full background-bg-app flex flex-col">
      <div className="shrink-0 z-20 px-5 py-3 border-b border-border-panel background-bg-app/95 backdrop-blur flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-accent-primary">Machine View</div>
          <div className="text-lg font-semibold text-text-primary">Runtime Execution</div>
        </div>
        <div className="flex items-center gap-3">
          <div className="text-[11px] text-text-muted">
            {sessions.length} runtime node{sessions.length === 1 ? '' : 's'} · {runtimeEdges.length} edge{runtimeEdges.length === 1 ? '' : 's'}
          </div>
          <button
            className="px-2 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface text-[11px] flex items-center gap-1"
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

      {sessions.length === 0 ? (
        <div className="flex-1 flex flex-col items-center justify-center text-center text-text-muted gap-3">
          <Cpu size={34} className="opacity-40" />
          <div className="text-sm text-text-secondary">No active agent sessions.</div>
          <div className="text-[11px] max-w-sm">Run a workflow to populate this view with live runtime nodes and terminal streams.</div>
        </div>
      ) : (
        <div
          ref={canvasRef}
          className="relative flex-1 overflow-hidden"
          onMouseDown={onCanvasMouseDown}
          style={{ cursor: isInteracting ? 'grabbing' : 'grab' }}
        >
          <DotTunnelBackground />
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
                const fromLayout = nodeLayouts[edge.fromKey] || { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
                const toLayout = nodeLayouts[edge.toKey] || { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
                const fromX = fromLayout.x + fromLayout.width / 2;
                const fromY = fromLayout.y + fromLayout.height;
                const toX = toLayout.x + toLayout.width / 2;
                const toY = toLayout.y;
                const midY = fromY + Math.max(36, (toY - fromY) * 0.45);
                return (
                  <path
                    key={edge.id}
                    d={`M ${fromX} ${fromY} C ${fromX} ${midY}, ${toX} ${midY}, ${toX} ${toY}`}
                    fill="none"
                    stroke="rgba(139,195,255,0.42)"
                    strokeWidth="2"
                    strokeDasharray={edge.condition === 'always' ? undefined : '8 6'}
                  />
                );
              })}
            </svg>

            {runtimeNodes.map(runtimeNode => {
              const session = runtimeNode.session;
              const pane = runtimePaneFor(session);
              const status = session.status ?? 'idle';
              const isActive = ACTIVE_STATUSES.has(status);
              const layout = nodeLayouts[runtimeNode.key] || { x: 0, y: 0, width: DEFAULT_NODE_WIDTH, height: DEFAULT_NODE_HEIGHT };
              const isDragging = interaction.kind === 'dragging_node' && interaction.nodeKey === runtimeNode.key;

              return (
                <div
                  key={runtimeNode.key}
                  className={`absolute rounded-lg border background-bg-panel overflow-hidden flex flex-col shadow-lg transition-shadow ${
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
                    className="h-12 px-3 border-b border-border-panel background-bg-titlebar flex items-center justify-between gap-3 select-none"
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
                        <div className="text-sm font-semibold text-text-primary truncate">{session.roleId || session.title}</div>
                        <div className="text-[10px] text-text-muted truncate">{session.cli ?? 'CLI unknown'} · {session.terminalId || session.sessionId}</div>
                      </div>
                    </div>
                    <div className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded border ${workflowStatusTone(status, 'mission')}`}>
                      {workflowStatusLabel(status)}
                    </div>
                  </div>

                  <div className="h-9 px-3 border-b border-border-panel background-bg-panel flex items-center justify-between">
                    <div className="text-[10px] text-text-muted truncate">{session.currentAction || (WORKING_STATUSES.has(status) ? 'Working...' : isActive ? 'Ready' : '—')}</div>
                    <div className="flex items-center gap-1">
                      <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:background-bg-surface" title="Focus terminal" onClick={() => focusRuntime(session)} disabled={!session.terminalId}>
                        <Focus size={13} />
                      </button>
                      <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-red-300 hover:bg-red-500/10" title="Stop session" onClick={() => stopRuntime(session)} disabled={!session.terminalId}>
                        <Square size={12} />
                      </button>
                      <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:background-bg-surface" title="Retry activation" onClick={() => retryRuntime(session)}>
                        <RefreshCw size={13} />
                      </button>
                      <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:background-bg-surface disabled:opacity-30" title="Open artifact in Workspace" onClick={() => openArtifact(session)} disabled={!session.artifacts?.some(item => item.path)}>
                        <FileCode2 size={13} />
                      </button>
                    </div>
                  </div>

                  {session.activePermission && (
                    <div className="m-3 mb-0 rounded border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] text-amber-100">
                      <div className="flex items-center gap-2 font-semibold">
                        <ShieldAlert size={13} />
                        Grant permission for: {session.activePermission.category}?
                      </div>
                      <div className="mt-1 text-amber-100/70 line-clamp-2">{session.activePermission.detail}</div>
                      <div className="mt-2 flex gap-2">
                        <button 
                          className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 hover:bg-emerald-500/30 transition-colors" 
                          onClick={() => resolvePermission(session.sessionId, session.activePermission!.permissionId, 'approve')}
                        >
                          Approve
                        </button>
                        <button 
                          className="px-2 py-1 rounded bg-red-500/20 text-red-200 border border-red-400/30 hover:bg-red-500/30 transition-colors" 
                          onClick={() => resolvePermission(session.sessionId, session.activePermission!.permissionId, 'deny')}
                        >
                          Deny
                        </button>
                      </div>
                    </div>
                  )}

                  {session.status === 'manual_takeover' && (
                    <div className="m-3 mb-0 rounded border border-blue-400/40 bg-blue-400/10 p-3 text-[11px] text-blue-100">
                      <div className="flex items-center gap-2 font-semibold">
                        <Cpu size={13} />
                        Manual Takeover
                      </div>
                      <div className="mt-1 text-blue-100/70">Node is waiting for manual intervention. Use the terminal to perform tasks.</div>
                      <div className="mt-2 flex gap-2">
                        <button 
                          className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-400/30 hover:bg-emerald-500/30 transition-colors" 
                          onClick={() => resumeNode(session.missionId, session.nodeId)}
                        >
                          Resume
                        </button>
                        <button 
                          className="px-2 py-1 rounded bg-blue-500/20 text-blue-200 border border-blue-400/30 hover:bg-blue-500/30 transition-colors" 
                          onClick={() => forceCompleteNode(session.missionId, session.nodeId, 'success', 'Manually completed')}
                        >
                          Force Success
                        </button>
                        <button 
                          className="px-2 py-1 rounded bg-red-500/20 text-red-200 border border-red-400/30 hover:bg-red-500/30 transition-colors" 
                          onClick={() => forceFailNode(session.missionId, session.nodeId, 'Manually failed')}
                        >
                          Force Fail
                        </button>
                      </div>
                    </div>
                  )}

                  <div className="flex-1 min-h-0 background-bg-app overflow-hidden">
                    {pane ? (
                      <TerminalPane pane={pane} />
                    ) : session.executionMode === 'api' || session.executionMode === 'streaming_headless' ? (
                      <div className="h-full flex flex-col items-center justify-center text-[12px] text-text-muted p-4 text-center">
                        <div className="mb-2 text-accent-primary"><Cpu size={24} /></div>
                        <div>API / Streaming Backend Active</div>
                        <div className="mt-1 text-[10px] opacity-70">Logs and artifacts will appear in Mission Control.</div>
                      </div>
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
