import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ChevronLeft, ScanSearch, Trash2, Workflow } from 'lucide-react';
import agentsConfig from '../../config/agents';
import { validateGraph } from '../../lib/graphCompiler';
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
import { useWorkspaceStore, type WorkflowGraph } from '../../store/workspace';

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

function clampZoom(nextZoom: number) {
  return Math.max(0.35, Math.min(1.8, nextZoom));
}

function worldRect(node: MaterializedNode) {
  const rows = Math.max(node.inputs.length, node.outputs.length);
  const controlsHeight =
    node.node.type === 'workflow.task'
      ? 128
      : node.node.type === 'workflow.agent'
        ? 160
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

function ccw(a: Point2D, b: Point2D, c: Point2D) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

export function NodeTreePane(props: { graph: WorkflowGraph; onGraphChange?: (graph: WorkflowGraph) => void }) {
  const { graph, onGraphChange } = props;
  const workspaceDir = useWorkspaceStore(state => state.workspaceDir);
  const tabs = useWorkspaceStore(state => state.tabs);
  const openTerminals = useMemo(() => {
    const terminals: Array<{ id: string; title: string; cli: string | null }> = [];
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.type === 'terminal' && pane.data?.terminalId) {
          terminals.push({ id: pane.data.terminalId, title: pane.title, cli: (pane.data?.cli as string) ?? null });
        }
      }
    }
    return terminals;
  }, [tabs]);

  const registry = useMemo(() => createWorkflowNodeRegistry(), []);
  const [state, setState] = useState<NodeDocumentState>(() => legacyGraphToNodeDocument(graph));
  const [interaction, setInteraction] = useState<CanvasInteraction>({ kind: 'idle' });
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [hoveredInput, setHoveredInput] = useState<LinkHoverTarget>(null);
  const [validationMessage, setValidationMessage] = useState('Node graph editor is active.');
  const [validationTone, setValidationTone] = useState<ValidationTone>('idle');
  const canvasRef = useRef<HTMLDivElement | null>(null);
  const suppressContextMenuRef = useRef(false);
  const lastGraphSnapshotRef = useRef(JSON.stringify(graph));

  useEffect(() => {
    const incoming = JSON.stringify(graph);
    if (incoming !== lastGraphSnapshotRef.current) {
      setState(legacyGraphToNodeDocument(graph));
      lastGraphSnapshotRef.current = incoming;
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
  const selectedNodeIds = new Set(state.editor.selection.nodeIds);
  const nodeOptions = useMemo(
    () =>
      registry
        .list()
        .filter(entry => entry.type.startsWith('workflow.'))
        .sort((left, right) => left.category.localeCompare(right.category) || left.label.localeCompare(right.label)),
    [registry]
  );

  const findNodeAtWorld = useCallback(
    (point: Point2D) => materializedNodes.find(node => isPointInsideRect(point, worldRect(node))),
    [materializedNodes]
  );

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
          <button onClick={validateCurrentGraph} className="px-2.5 py-1 rounded border border-[#284867] text-[#8bc3ff] hover:bg-[#112030]">
            <ScanSearch size={12} className="inline mr-1" />
            Validate
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
                        <div className="bg-[#0b1118] border border-border-panel rounded-lg px-2 py-1.5 text-[11px] text-text-muted flex items-center shrink-0">
                          CLI: {(() => {
                            const termId = materializedNode.node.properties.terminalId;
                            const term = openTerminals.find(t => t.id === termId);
                            return term?.cli ? term.cli.charAt(0).toUpperCase() + term.cli.slice(1) : 'Unknown';
                          })()}
                        </div>
                      </div>
                      <select
                        value={String(materializedNode.node.properties.terminalId ?? '')}
                        onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'terminalId', value: event.target.value })}
                        className="w-full bg-[#0b1118] border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                      >
                        <option value="">Terminal binding id</option>
                        {openTerminals.map(terminal => (
                          <option key={terminal.id} value={terminal.id}>
                            {terminal.title} ({terminal.id.substring(0, 8)})
                          </option>
                        ))}
                      </select>
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
      </div>

      <div className="px-3 py-2 shrink-0 border-t border-border-panel bg-[#0a0f15] flex items-center justify-between text-[11px] text-text-muted">
        <div>
          Tree: <span className="text-text-primary">{activeTree.name}</span> | Nodes: <span className="text-text-primary">{materializedNodes.length}</span> | Links:{' '}
          <span className="text-text-primary">{Object.keys(activeTree.links).length}</span>
        </div>
        <div>
          Right-click to add/delete, drag output to input, <span className="text-text-primary">Ctrl+Right Drag</span> for knife, <span className="text-text-primary">F</span> to frame selected.
        </div>
      </div>
    </div>
  );
}
