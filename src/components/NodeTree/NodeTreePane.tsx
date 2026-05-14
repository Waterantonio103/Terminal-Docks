import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { DotTunnelBackground } from '../shared/DotTunnelBackground';
import { WorkflowPresetPicker } from './WorkflowPresetPicker';
import { AppSiteThemePicker } from '../Launcher/AppSiteThemePicker';
import { ModelDiscoveryLoading } from '../models/ModelDiscoveryLoading';
import { AgentActionBadge } from '../models/AgentActionBadge';
import { AlignJustify, ArrowUpRight, Check, ChevronDown, ChevronLeft, ClipboardPaste, FileText, FolderOpen, Image as ImageIcon, Paperclip, Play, Plus, RefreshCw, ScanSearch, ShieldCheck, Sparkles, Square, Terminal, Trash2, UserCheck, Workflow, X, Zap } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { openUrl } from '@tauri-apps/plugin-opener';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { readImage } from '@tauri-apps/plugin-clipboard-manager';
import { emit, listen } from '@tauri-apps/api/event';
import agentsConfig from '../../config/agents';
import { compileMission, validateGraph } from '../../lib/graphCompiler';
import { generateId } from '../../lib/graphUtils';
import { buildPresetFlowGraph, getPresetReadmeDefault, getWorkflowPreset, listWorkflowPresetModes, type PresetDefinition, type WorkflowPresetMode } from '../../lib/workflowPresets';
import { isAppSitePresetId, type FrontendDirectionSpec } from '../../lib/frontendDirection';
import { isWorkflowStatusActive, workflowStatusLabel, workflowStatusTone } from '../../lib/workflowStatus';
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
import { missionOrchestrator } from '../../lib/workflow/MissionOrchestrator';
import { terminalOutputBus } from '../../lib/runtime/TerminalOutputBus';
import { supportsHeadless } from '../../lib/cliIdentity';
import { useWorkspaceStore, type FrontendWorkflowMode, type LaunchedWorkflow, type MissionAgent, type Pane, type ResultEntry, type WorkflowAgentCli, type WorkflowAuthoringMode, type WorkflowExecutionMode, type WorkflowGraph, type WorkflowGraphMode } from '../../store/workspace';
import { discoverModelsForCli, supportsModelDiscovery } from '../../lib/models/modelDiscoveryService';
import type { CliId, CliModel, ModelDiscoveryResult } from '../../lib/models/modelTypes';
import { useMissionSnapshot } from '../../hooks/useMissionSnapshot';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';


type ValidationTone = 'idle' | 'ok' | 'error';
type ResizeEdge = 'n' | 's' | 'e' | 'w' | 'ne' | 'nw' | 'se' | 'sw';
type LinkHoverTarget = { nodeId: string; socketId: string } | null;
type MenuMode = 'canvas' | 'node' | 'link_insert';
type TaskAttachmentKind = 'file' | 'image';

interface TaskAttachment {
  id: string;
  kind: TaskAttachmentKind;
  name: string;
  path?: string;
  mime?: string;
  source?: 'dialog' | 'clipboard';
}

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
const NODE_HEADER_HEIGHT = 44;
const NODE_ACTION_TOOLBAR_HEIGHT = 33;
const SOCKET_TOP_OFFSET = 18;
const SOCKET_RADIUS = 8;
const SOCKET_ROW_GAP = 24;
const SOCKET_SNAP_RADIUS = 48;
const TASK_NODE_ESTIMATED_WIDTH = 640;
const TASK_NODE_ESTIMATED_HEIGHT = 460;
const AGENT_NODE_ESTIMATED_WIDTH = 260;
const AGENT_NODE_ESTIMATED_HEIGHT = 330;
const CANVAS_CULL_PADDING = 900;
const ALIGN_SNAP_THRESHOLD = 12;
const ALIGN_GUIDE_MARGIN = 32;
const SUPPORTED_WORKFLOW_CLIS = new Set(['claude', 'gemini', 'opencode', 'codex', 'custom', 'ollama', 'lmstudio']);
const SELECTABLE_WORKFLOW_CLIS: WorkflowAgentCli[] = ['claude', 'codex', 'gemini', 'opencode', 'custom', 'ollama', 'lmstudio'];
const SELECTABLE_EXECUTION_MODES: WorkflowExecutionMode[] = ['api', 'streaming_headless', 'headless', 'interactive_pty', 'manual'];
const UI_FRONTEND_WORKFLOW_MODES: Array<{ value: Exclude<FrontendWorkflowMode, 'off'>; label: string; icon: typeof Workflow }> = [
  { value: 'fast', label: 'UI Fast', icon: Zap },
  { value: 'aligned', label: 'UI Aligned', icon: AlignJustify },
  { value: 'strict_ui', label: 'Strict UI', icon: ShieldCheck },
];
const PRESET_MODE_TO_GRAPH_MODE: Record<WorkflowPresetMode, WorkflowGraphMode> = {
  build: 'standard',
  research: 'research',
  plan: 'plan',
  review: 'review',
  verify: 'verify',
  secure: 'secure',
  document: 'document',
};
const GRAPH_MODE_LABELS: Record<WorkflowGraphMode, string> = {
  standard: 'Build',
  research: 'Research',
  plan: 'Plan',
  review: 'Review',
  verify: 'Verify',
  secure: 'Secure',
  document: 'Docs',
  ui: 'UI',
};
const GRAPH_MODE_ICONS: Record<WorkflowGraphMode, typeof Workflow> = {
  standard: Workflow,
  research: ScanSearch,
  plan: AlignJustify,
  review: UserCheck,
  verify: Check,
  secure: ShieldCheck,
  document: FileText,
  ui: Sparkles,
};
const PRESET_WORKFLOW_BASE_X = 0;
const PRESET_WORKFLOW_STACK_Y = 1520;
const STANDARD_AGENT_ROLE_IDS = new Set(['scout', 'coordinator', 'builder', 'tester', 'security', 'reviewer']);
const UI_AGENT_ROLE_IDS = new Set([
  'frontend_product',
  'frontend_designer',
  'frontend_architect',
  'frontend_builder',
  'interaction_qa',
  'accessibility_reviewer',
  'visual_polish_reviewer',
  'reviewer',
]);
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
      ? TASK_NODE_ESTIMATED_HEIGHT - 44 - rows * 24
      : node.node.type === 'workflow.agent'
        ? 250
        : node.node.type === 'workflow.frame'
          ? 72
          : 56;
  const height = node.node.size?.height ?? 44 + rows * 24 + controlsHeight;
  return {
    x: node.node.location.x,
    y: node.node.location.y,
    width: node.node.size?.width ?? (node.node.type === 'workflow.task' ? TASK_NODE_ESTIMATED_WIDTH : node.width),
    height,
  };
}

function socketPosition(node: MaterializedNode, socketId: string, direction: 'input' | 'output') {
  const sockets = direction === 'input' ? node.inputs : node.outputs;
  const rect = worldRect(node);
  const rowIndex = Math.max(0, sockets.findIndex(socket => socket.id === socketId));
  const contentTop = rect.y + NODE_HEADER_HEIGHT + (node.node.type === 'workflow.frame' ? 0 : NODE_ACTION_TOOLBAR_HEIGHT);
  return {
    x: direction === 'input' ? rect.x : rect.x + rect.width,
    y: contentTop + SOCKET_TOP_OFFSET + SOCKET_RADIUS + rowIndex * SOCKET_ROW_GAP,
  };
}

function linkPath(from: Point2D, to: Point2D) {
  if (Math.abs(from.y - to.y) < 0.5) {
    return `M ${from.x} ${from.y} L ${to.x} ${to.y}`;
  }

  const direction = to.x >= from.x ? 1 : -1;
  const horizontalRoom = Math.abs(to.x - from.x);
  const stub = Math.max(18, Math.min(56, horizontalRoom / 3));
  const fromStub = { x: from.x + stub * direction, y: from.y };
  const toStub = { x: to.x - stub * direction, y: to.y };

  return `M ${from.x} ${from.y} L ${fromStub.x} ${fromStub.y} L ${toStub.x} ${toStub.y} L ${to.x} ${to.y}`;
}

const bezierPath = linkPath;

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

type NodeRect = ReturnType<typeof worldRect>;
type AlignmentOrientation = 'vertical' | 'horizontal';

interface AlignmentGuide {
  orientation: AlignmentOrientation;
  position: number;
  from: number;
  to: number;
}

interface AlignmentSuggestion {
  offset: Point2D;
  guides: AlignmentGuide[];
  dropRect: NodeRect;
}

function rectBounds(rects: NodeRect[]): NodeRect {
  const minX = Math.min(...rects.map(rect => rect.x));
  const minY = Math.min(...rects.map(rect => rect.y));
  const maxX = Math.max(...rects.map(rect => rect.x + rect.width));
  const maxY = Math.max(...rects.map(rect => rect.y + rect.height));
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function shiftedRect(rect: NodeRect, offset: Point2D): NodeRect {
  return { ...rect, x: rect.x + offset.x, y: rect.y + offset.y };
}

function rectAnchor(rect: NodeRect, axis: 'x' | 'y', anchor: 'start' | 'center' | 'end') {
  if (axis === 'x') {
    if (anchor === 'start') return rect.x;
    if (anchor === 'center') return rect.x + rect.width / 2;
    return rect.x + rect.width;
  }
  if (anchor === 'start') return rect.y;
  if (anchor === 'center') return rect.y + rect.height / 2;
  return rect.y + rect.height;
}

function guideForAlignment(orientation: AlignmentOrientation, position: number, left: NodeRect, right: NodeRect): AlignmentGuide {
  if (orientation === 'vertical') {
    return {
      orientation,
      position,
      from: Math.min(left.y, right.y) - ALIGN_GUIDE_MARGIN,
      to: Math.max(left.y + left.height, right.y + right.height) + ALIGN_GUIDE_MARGIN,
    };
  }
  return {
    orientation,
    position,
    from: Math.min(left.x, right.x) - ALIGN_GUIDE_MARGIN,
    to: Math.max(left.x + left.width, right.x + right.width) + ALIGN_GUIDE_MARGIN,
  };
}

function alignmentSuggestion(draggedRects: NodeRect[], targetRects: NodeRect[]): AlignmentSuggestion | null {
  if (draggedRects.length === 0 || targetRects.length === 0) {
    return null;
  }

  const anchors: Array<'start' | 'center' | 'end'> = ['start', 'center', 'end'];
  let bestX: { delta: number; guide: AlignmentGuide } | null = null;
  let bestY: { delta: number; guide: AlignmentGuide } | null = null;

  for (const dragged of draggedRects) {
    for (const target of targetRects) {
      for (const draggedAnchor of anchors) {
        for (const targetAnchor of anchors) {
          const dx = rectAnchor(target, 'x', targetAnchor) - rectAnchor(dragged, 'x', draggedAnchor);
          if (Math.abs(dx) <= ALIGN_SNAP_THRESHOLD && (!bestX || Math.abs(dx) < Math.abs(bestX.delta))) {
            bestX = {
              delta: dx,
              guide: guideForAlignment('vertical', rectAnchor(target, 'x', targetAnchor), shiftedRect(dragged, { x: dx, y: 0 }), target),
            };
          }

          const dy = rectAnchor(target, 'y', targetAnchor) - rectAnchor(dragged, 'y', draggedAnchor);
          if (Math.abs(dy) <= ALIGN_SNAP_THRESHOLD && (!bestY || Math.abs(dy) < Math.abs(bestY.delta))) {
            bestY = {
              delta: dy,
              guide: guideForAlignment('horizontal', rectAnchor(target, 'y', targetAnchor), shiftedRect(dragged, { x: 0, y: dy }), target),
            };
          }
        }
      }
    }
  }

  if (!bestX && !bestY) {
    return null;
  }

  const offset = { x: bestX?.delta ?? 0, y: bestY?.delta ?? 0 };
  return {
    offset,
    guides: [bestX?.guide, bestY?.guide].filter((guide): guide is AlignmentGuide => Boolean(guide)),
    dropRect: rectBounds(draggedRects.map(rect => shiftedRect(rect, offset))),
  };
}

function toLinkCanvas(point: Point2D) {
  return { x: point.x + LINK_CANVAS_HALF, y: point.y + LINK_CANVAS_HALF };
}

function borderClass(selected: boolean, active = false) {
  if (selected) {
    return 'border-accent-primary shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent-primary)_60%,transparent)]';
  }
  if (active) {
    return 'border-accent-primary/70 shadow-[0_0_0_1px_color-mix(in_srgb,var(--color-accent-primary)_45%,transparent),0_0_26px_color-mix(in_srgb,var(--color-accent-primary)_18%,transparent)]';
  }
  return 'border-border-panel shadow-[0_10px_24px_rgba(0,0,0,0.28)]';
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

function folderLabel(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 'Select folder';
  const normalized = trimmed.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

function fileLabel(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 'Untitled';
  const normalized = trimmed.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

function attachmentKindForName(name: string, mime?: string): TaskAttachmentKind {
  if (mime?.startsWith('image/')) return 'image';
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name) ? 'image' : 'file';
}

function normalizeTaskAttachments(value: unknown): TaskAttachment[] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const attachments: TaskAttachment[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const record = item as Record<string, unknown>;
    const path = typeof record.path === 'string' ? record.path.trim() : '';
    const name = typeof record.name === 'string' && record.name.trim()
      ? record.name.trim()
      : fileLabel(path);
    const mime = typeof record.mime === 'string' ? record.mime : undefined;
    const kind = record.kind === 'image' ? 'image' : attachmentKindForName(name, mime);
    const source = record.source === 'clipboard' ? 'clipboard' : 'dialog';
    const key = `${path || name}:${mime || ''}`;
    if (seen.has(key)) continue;
    seen.add(key);
    attachments.push({
      id: typeof record.id === 'string' && record.id ? record.id : `att-${generateId()}`,
      kind,
      name,
      path: path || undefined,
      mime,
      source,
    });
  }
  return attachments;
}

function taskAttachmentFromPath(path: string): TaskAttachment {
  const name = fileLabel(path);
  return {
    id: `att-${generateId()}`,
    kind: attachmentKindForName(name),
    name,
    path,
    source: 'dialog',
  };
}

function clipboardPathAttachments(data: DataTransfer): TaskAttachment[] {
  const raw = [data.getData('text/uri-list'), data.getData('text/plain')]
    .filter(Boolean)
    .join('\n');
  if (!raw.trim()) return [];
  return raw
    .split(/\r?\n/)
    .map(line => line.trim())
    .filter(line => line && !line.startsWith('#'))
    .map(line => {
      if (/^file:\/\//i.test(line)) {
        try {
          return decodeURIComponent(new URL(line).pathname).replace(/^\/([A-Za-z]:)/, '$1');
        } catch {
          return '';
        }
      }
      return /^[A-Za-z]:[\\/]/.test(line) || /^\\\\/.test(line) ? line : '';
    })
    .filter(Boolean)
    .map(path => ({ ...taskAttachmentFromPath(path), source: 'clipboard' }));
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

function parseArtifactMetadata(metadataJson: string | null | undefined): Record<string, unknown> {
  if (!metadataJson) return {};
  try {
    const parsed = JSON.parse(metadataJson);
    return parsed && typeof parsed === 'object' ? parsed as Record<string, unknown> : {};
  } catch {
    return {};
  }
}

function snapshotArtifactPath(artifact: import('../../hooks/useMissionSnapshot').ArtifactRecord): string | undefined {
  if (artifact.contentUri?.trim()) return artifact.contentUri.trim();
  const metadata = parseArtifactMetadata(artifact.metadataJson);
  const path = metadata.path ?? metadata.outputPath;
  return typeof path === 'string' && path.trim() ? path.trim() : undefined;
}

function ccw(a: Point2D, b: Point2D, c: Point2D) {
  return (c.y - a.y) * (b.x - a.x) > (b.y - a.y) * (c.x - a.x);
}

function segmentsIntersect(a: Point2D, b: Point2D, c: Point2D, d: Point2D) {
  return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
}

interface WorkflowGroup {
  id: string;
  graphMode: WorkflowGraphMode;
  taskNode: NodeInstance;
  name: string;
  subMode: string;
  mode?: string;
  preset?: PresetDefinition | null;
  nodeIds: Set<string>;
  agentCount: number;
}

function workflowGroupsForTree(tree: NodeDocumentState['document']['trees'][string], graphMode: WorkflowGraphMode): WorkflowGroup[] {
  const nodes = Object.values(tree.nodes);
  const taskNodes = nodes
    .filter(node => node.type === 'workflow.task')
    .sort((left, right) => left.location.x - right.location.x || left.location.y - right.location.y);
  const links = Object.values(tree.links);
  const outgoing = new Map<string, string[]>();
  for (const link of links) {
    outgoing.set(link.from.nodeId, [...(outgoing.get(link.from.nodeId) ?? []), link.to.nodeId]);
  }

  return taskNodes.map((task, index) => {
    const preset = getWorkflowPreset(String(task.properties.presetId ?? '').trim());
    const visited = new Set<string>([task.id]);
    const queue = [...(outgoing.get(task.id) ?? [])];
    while (queue.length > 0) {
      const nodeId = queue.shift();
      if (!nodeId || visited.has(nodeId)) continue;
      const node = tree.nodes[nodeId];
      if (!node || (node.type === 'workflow.task' && node.id !== task.id)) continue;
      visited.add(nodeId);
      for (const nextId of outgoing.get(nodeId) ?? []) queue.push(nextId);
    }
    const id = String(task.properties.workflowId ?? '').trim() || task.id;
    const name = workflowLabelFromTask(task, index);
    const subMode = String(task.properties.workflowSubMode ?? '').trim() || preset?.subMode || 'Custom';
    const mode = String(task.properties.workflowMode ?? '').trim() || preset?.mode;
    return {
      id,
      graphMode,
      taskNode: task,
      name,
      subMode,
      mode,
      preset,
      nodeIds: visited,
      agentCount: [...visited].filter(nodeId => tree.nodes[nodeId]?.type === 'workflow.agent').length,
    };
  });
}

function workflowLabelFromTask(taskNode: NodeInstance, index: number) {
  const preset = getWorkflowPreset(String(taskNode.properties.presetId ?? '').trim());
  const explicitName = String(taskNode.properties.workflowName ?? '').trim();
  if (explicitName) return explicitName;
  if (preset) return preset.name;
  const prompt = String(taskNode.properties.prompt ?? '').trim();
  return prompt ? prompt.slice(0, 34) : `Workflow ${index + 1}`;
}

function workflowModeDisplay(mode: string | undefined) {
  const presetMode = listWorkflowPresetModes().find(option => option.value === mode);
  if (!presetMode) return { label: 'Custom', graphMode: 'standard' as WorkflowGraphMode };
  const graphMode = PRESET_MODE_TO_GRAPH_MODE[presetMode.value];
  return { label: GRAPH_MODE_LABELS[graphMode] ?? presetMode.label, graphMode };
}

function flowNodeKind(node: Record<string, unknown>) {
  const type = String(node.type ?? '');
  const roleId = String((node.data as Record<string, unknown> | undefined)?.roleId ?? '');
  if (type === 'workflow.task' || type === 'task' || roleId === 'task') return 'task';
  if (type === 'workflow.agent' || type === 'agent') return 'agent';
  return 'other';
}

function subgraphForWorkflow(flow: { nodes: Array<Record<string, unknown>>; edges: Array<Record<string, unknown>> }, workflow: WorkflowGroup) {
  const nodeIds = workflow.nodeIds;
  return {
    nodes: flow.nodes.filter(node => nodeIds.has(String(node.id))),
    edges: flow.edges.filter(edge => nodeIds.has(String(edge.source)) && nodeIds.has(String(edge.target))),
  };
}

function fitDocumentStateToGraph(documentState: NodeDocumentState, canvasRect: DOMRect | undefined | null): NodeDocumentState {
  const tree = documentState.document.trees[documentState.document.rootTreeId];
  const nodes = Object.values(tree.nodes);
  if (nodes.length === 0) return documentState;

  const minX = Math.min(...nodes.map(node => node.location.x));
  const minY = Math.min(...nodes.map(node => node.location.y));
  const maxX = Math.max(...nodes.map(node => node.location.x + (node.size?.width ?? (node.type === 'workflow.task' ? TASK_NODE_ESTIMATED_WIDTH : AGENT_NODE_ESTIMATED_WIDTH))));
  const maxY = Math.max(...nodes.map(node => node.location.y + (node.size?.height ?? (node.type === 'workflow.task' ? TASK_NODE_ESTIMATED_HEIGHT : AGENT_NODE_ESTIMATED_HEIGHT))));
  const viewportWidth = Math.max(640, canvasRect?.width ?? 1280);
  const viewportHeight = Math.max(420, canvasRect?.height ?? 760);
  const paddedWidth = maxX - minX + 240;
  const paddedHeight = maxY - minY + 240;
  const zoom = Math.max(0.35, Math.min(0.9, viewportWidth / paddedWidth, viewportHeight / paddedHeight));
  const pan = {
    x: (viewportWidth - (maxX - minX) * zoom) / 2 - minX * zoom,
    y: (viewportHeight - (maxY - minY) * zoom) / 2 - minY * zoom,
  };

  return {
    ...documentState,
    editor: {
      ...documentState.editor,
      viewByTree: {
        ...documentState.editor.viewByTree,
        [documentState.document.rootTreeId]: { pan, zoom },
      },
    },
  };
}

export function NodeTreePane(props: { graph: WorkflowGraph; onGraphChange?: (graph: WorkflowGraph) => void }) {
  const { graph, onGraphChange } = props;
  const workspaceDir = useWorkspaceStore(state => state.workspaceDir);
  const workflowGraphMode = useWorkspaceStore(state => state.workflowGraphMode);
  const workflowGraphs = useWorkspaceStore(state => state.workflowGraphs);
  const setWorkflowGraphMode = useWorkspaceStore(state => state.setWorkflowGraphMode);
  const setWorkflowGraphForMode = useWorkspaceStore(state => state.setWorkflowGraphForMode);
  const activeTabId = useWorkspaceStore(state => state.activeTabId);
  const tabs = useWorkspaceStore(state => state.tabs);
  const results = useWorkspaceStore(state => state.results);
  const addPane = useWorkspaceStore(state => state.addPane);
  const setAppMode = useWorkspaceStore(state => state.setAppMode);
  const uiFrontendMode = useWorkspaceStore(state => state.uiFrontendMode);
  const setUiFrontendMode = useWorkspaceStore(state => state.setUiFrontendMode);
  const setWorkspaceDir = useWorkspaceStore(state => state.setWorkspaceDir);
  const addLaunchedWorkflow = useWorkspaceStore(state => state.addLaunchedWorkflow);
  const ensureWorkflowWorkspace = useWorkspaceStore(state => state.ensureWorkflowWorkspace);
  const canvasEffectsEnabled = useWorkspaceStore(state => state.canvasEffectsEnabled);
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
  const graphModeOptions = useMemo(() => {
    const presetModes = listWorkflowPresetModes().map(mode => PRESET_MODE_TO_GRAPH_MODE[mode.value]);
    return [...new Set(presetModes)];
  }, []);
  useEffect(() => {
    if (workflowGraphMode === 'ui') {
      setWorkflowGraphMode('standard');
    }
  }, [setWorkflowGraphMode, workflowGraphMode]);
  const [inspectorNodeId, setInspectorNodeId] = useState<string | null>(null);
  const [lastAddedNodeId, setLastAddedNodeId] = useState<string | null>(null);
  const [inspectorCommand, setInspectorCommand] = useState('');
  const [inspectorError, setInspectorError] = useState<string | null>(null);
  const [runtimeOutputByTerminalId, setRuntimeOutputByTerminalId] = useState<Record<string, string>>({});
  const [runtimeOutputByNodeId, setRuntimeOutputByNodeId] = useState<Record<string, string>>({});
  const [detectedModels, setDetectedModels] = useState<Map<CliId, ModelDiscoveryResult>>(new Map());
  const [loadingModels, setLoadingModels] = useState<Set<WorkflowAgentCli>>(new Set());
  const [customModelNodeIds, setCustomModelNodeIds] = useState<Set<string>>(new Set());
  const [modelDropdownOpenNodeId, setModelDropdownOpenNodeId] = useState<string | null>(null);
  const [presetPickerOpen, setPresetPickerOpen] = useState(false);
  const [appSiteThemePickerOpen, setAppSiteThemePickerOpen] = useState(false);
  const [runMenuOpen, setRunMenuOpen] = useState(false);
  const [selectedRunWorkflowIds, setSelectedRunWorkflowIds] = useState<Set<string>>(new Set());
  const [expandedRunModeIds, setExpandedRunModeIds] = useState<Set<string>>(new Set());
  const modelDropdownRef = useRef<HTMLDivElement>(null);
  const runMenuRef = useRef<HTMLDivElement>(null);

  const registry = useMemo(() => createWorkflowNodeRegistry(), []);
  const [state, setState] = useState<NodeDocumentState>(() => legacyGraphToNodeDocument(graph));
  const stateRef = useRef(state);
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
  const pendingFitGraphRef = useRef<string | null>(null);
  const isUserChangeRef = useRef(false);
  const missionSnapshot = useMissionSnapshot(activeMissionId);
  const workflowEvents = useWorkflowEvents(activeMissionId);

  useEffect(() => {
    stateRef.current = state;
  }, [state]);

  useEffect(() => {
    return () => {
      const serialized = nodeDocumentToWorkflowGraph(stateRef.current.document, registry);
      const json = JSON.stringify(serialized);
      if (json !== lastGraphSnapshotRef.current) {
        lastGraphSnapshotRef.current = json;
        onGraphChange?.(serialized);
      }
    };
  }, [onGraphChange, registry]);

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
        if (pendingFitGraphRef.current === incoming) {
          pendingFitGraphRef.current = null;
          return fitDocumentStateToGraph(newState, canvasRef.current?.getBoundingClientRect());
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
  const taskNode = useMemo(
    () => Object.values(activeTree.nodes).find(node => node.type === 'workflow.task') ?? null,
    [activeTree.nodes]
  );
  const workflowGroups = useMemo<WorkflowGroup[]>(() => {
    return workflowGroupsForTree(activeTree, workflowGraphMode);
  }, [activeTree, workflowGraphMode]);
  const allWorkflowGroups = useMemo<WorkflowGroup[]>(() => {
    const groups: WorkflowGroup[] = [...workflowGroups];
    for (const mode of graphModeOptions) {
      if (mode === workflowGraphMode) continue;
      const modeGraph = workflowGraphs[mode];
      if (!modeGraph || modeGraph.nodes.length === 0) continue;
      const documentState = legacyGraphToNodeDocument(modeGraph);
      const tree = documentState.document.trees[documentState.document.rootTreeId];
      groups.push(...workflowGroupsForTree(tree, mode));
    }
    return groups;
  }, [graphModeOptions, workflowGraphMode, workflowGraphs, workflowGroups]);
  const selectedWorkflowGroup = useMemo(() => {
    const activeNodeId = state.editor.activeNodeId ?? state.editor.selection.nodeIds[0] ?? null;
    if (!activeNodeId) return null;
    return workflowGroups.find(group => group.taskNode.id === activeNodeId || group.nodeIds.has(activeNodeId)) ?? null;
  }, [state.editor.activeNodeId, state.editor.selection.nodeIds, workflowGroups]);
  useEffect(() => {
    setSelectedRunWorkflowIds(current => {
      const available = new Set(allWorkflowGroups.map(group => group.id));
      return new Set([...current].filter(id => available.has(id)));
    });
  }, [allWorkflowGroups]);
  const runWorkflowModeGroups = useMemo(() => {
    const grouped = new Map<string, { id: string; label: string; icon: typeof Workflow; workflows: WorkflowGroup[] }>();
    for (const group of allWorkflowGroups) {
      const mode = String(group.mode ?? 'custom');
      const { label, graphMode } = workflowModeDisplay(group.mode);
      const existing = grouped.get(mode) ?? {
        id: mode,
        label,
        icon: GRAPH_MODE_ICONS[graphMode] ?? Workflow,
        workflows: [],
      };
      existing.workflows.push(group);
      grouped.set(mode, existing);
    }
    return [...grouped.values()];
  }, [allWorkflowGroups]);
  const activePreset = useMemo(() => {
    const presetId = String(taskNode?.properties.presetId ?? '').trim();
    return getWorkflowPreset(presetId);
  }, [taskNode?.properties.presetId]);
  const activePresetLabel = activePreset
    ? activePreset.size === 'expanded'
      ? `Expanded ${activePreset.subMode.replace(/\s*\/\s*/g, '/')}`
      : activePreset.name
    : null;
  const nodeFrontendMode = (taskNode?.properties.frontendMode === 'fast' ||
    taskNode?.properties.frontendMode === 'aligned' ||
    taskNode?.properties.frontendMode === 'strict_ui')
    ? taskNode.properties.frontendMode as FrontendWorkflowMode
    : 'off';
  const graphUsesUiRoles = useMemo(
    () => Object.values(activeTree.nodes).some(node =>
      node.type === 'workflow.agent' && UI_AGENT_ROLE_IDS.has(String(node.properties.roleId ?? ''))
    ),
    [activeTree.nodes]
  );
  const graphUsesUiBackground = graphUsesUiRoles || nodeFrontendMode !== 'off';
  const frontendMode: FrontendWorkflowMode = graphUsesUiBackground
    ? (nodeFrontendMode === 'off' ? uiFrontendMode : nodeFrontendMode)
    : 'off';
  useEffect(() => {
    if (!graphUsesUiRoles || !taskNode || nodeFrontendMode !== 'off') return;
    applyOperator({ type: 'set_node_property', nodeId: taskNode.id, key: 'frontendMode', value: uiFrontendMode });
  }, [applyOperator, graphUsesUiRoles, nodeFrontendMode, taskNode, uiFrontendMode]);
  const materializedNodes = useMemo(
    () => Object.values(activeTree.nodes).map(node => materializeNode(state.document, activeTree, node, registry)),
    [activeTree, registry, state.document]
  );
  const materializedById = useMemo(() => new Map(materializedNodes.map(node => [node.node.id, node])), [materializedNodes]);
  const canvasBounds = canvasRef.current?.getBoundingClientRect();
  const visibleWorldRect = useMemo(() => {
    const width = canvasBounds?.width ?? 1280;
    const height = canvasBounds?.height ?? 760;
    return {
      x: (-view.pan.x / view.zoom) - CANVAS_CULL_PADDING,
      y: (-view.pan.y / view.zoom) - CANVAS_CULL_PADDING,
      width: (width / view.zoom) + CANVAS_CULL_PADDING * 2,
      height: (height / view.zoom) + CANVAS_CULL_PADDING * 2,
    };
  }, [canvasBounds?.height, canvasBounds?.width, view.pan.x, view.pan.y, view.zoom]);
  const visibleMaterializedNodes = useMemo(
    () => materializedNodes.filter(node => rectsIntersect(worldRect(node), visibleWorldRect)),
    [materializedNodes, visibleWorldRect],
  );
  const visibleNodeIds = useMemo(
    () => new Set(visibleMaterializedNodes.map(node => node.node.id)),
    [visibleMaterializedNodes],
  );
  const connectedInputKeys = useMemo(
    () => new Set(Object.values(activeTree.links).map(link => `${link.to.nodeId}:${link.to.socketId}`)),
    [activeTree.links],
  );
  const connectedOutputKeys = useMemo(
    () => new Set(Object.values(activeTree.links).map(link => `${link.from.nodeId}:${link.from.socketId}`)),
    [activeTree.links],
  );
  const terminalById = useMemo(() => new Map(openTerminals.map(entry => [entry.id, entry])), [openTerminals]);
  const snapshotNodeById = useMemo(
    () => new Map((missionSnapshot?.nodes ?? []).map(node => [node.nodeId, node])),
    [missionSnapshot?.nodes],
  );
  const latestEventByNodeId = useMemo(() => {
    const byNode = new Map<string, (typeof workflowEvents)[number]>();
    for (const event of workflowEvents) {
      if (!event.nodeId) continue;
      if (!byNode.has(event.nodeId)) byNode.set(event.nodeId, event);
    }
    return byNode;
  }, [workflowEvents]);
  const dragAlignment = useMemo(() => {
    if (interaction.kind !== 'dragging_nodes') {
      return null;
    }
    const draggedIds = new Set(Object.keys(interaction.nodeOrigins));
    const draggedRects = materializedNodes
      .filter(node => draggedIds.has(node.node.id))
      .map(worldRect);
    const targetRects = materializedNodes
      .filter(node => !draggedIds.has(node.node.id))
      .map(worldRect);
    return alignmentSuggestion(draggedRects, targetRects);
  }, [interaction, materializedNodes]);
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
    const snapshotArtifactsByNode = new Map<string, string[]>();

    for (const artifact of missionSnapshot?.artifacts ?? []) {
      const nodeId = artifact.nodeId ?? '';
      if (!nodeId) continue;
      const current = snapshotArtifactsByNode.get(nodeId) ?? [];
      const label = artifact.title || artifact.kind;
      if (!current.includes(label)) current.push(label);
      snapshotArtifactsByNode.set(nodeId, current.slice(0, 5));
    }

    for (const agent of missionAgents) {
      if (!agent.nodeId) continue;

      const hints: string[] = [...(snapshotArtifactsByNode.get(agent.nodeId) ?? [])];

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

    for (const [nodeId, hints] of snapshotArtifactsByNode.entries()) {
      if (!map.has(nodeId) && hints.length > 0) {
        map.set(nodeId, hints);
      }
    }

    return map;
  }, [missionAgents, missionSnapshot?.artifacts, results]);
  const combinedArtifacts = useMemo(() => {
    const localArtifacts = missionAgents.flatMap(agent =>
      (agent.artifacts ?? []).map(artifact => ({
        id: artifact.id,
        title: artifact.label,
        kind: artifact.type,
        createdAt: new Date(artifact.timestamp).toISOString(),
        path: artifact.path,
        contentText: artifact.content,
        source: 'local' as const,
      })),
    );
    const durableArtifacts = (missionSnapshot?.artifacts ?? []).map(artifact => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      createdAt: artifact.createdAt,
      path: snapshotArtifactPath(artifact),
      contentText: artifact.contentText ?? undefined,
      source: 'snapshot' as const,
    }));

    const merged = new Map<string, typeof localArtifacts[number] | typeof durableArtifacts[number]>();
    for (const artifact of [...durableArtifacts, ...localArtifacts]) {
      const existing = merged.get(artifact.id);
      if (!existing || artifact.source === 'local') merged.set(artifact.id, artifact);
    }
    return [...merged.values()].sort((left, right) => Date.parse(right.createdAt) - Date.parse(left.createdAt));
  }, [missionAgents, missionSnapshot?.artifacts]);
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
  const agentRoleOptions = useMemo(
    () => agentsConfig.agents.filter(agent =>
      graphUsesUiBackground
        ? UI_AGENT_ROLE_IDS.has(agent.id)
        : STANDARD_AGENT_ROLE_IDS.has(agent.id)
    ),
    [graphUsesUiBackground]
  );
  const validAgentRoleIds = graphUsesUiBackground ? UI_AGENT_ROLE_IDS : STANDARD_AGENT_ROLE_IDS;
  const defaultAgentRoleId = graphUsesUiBackground ? 'frontend_product' : 'scout';

  useEffect(() => {
    setState(previous => {
      const activeTreeId = getActiveTreeId(previous.editor);
      const tree = previous.document.trees[activeTreeId];
      if (!tree) return previous;

      let changed = false;
      const nodes = Object.fromEntries(
        Object.entries(tree.nodes).map(([nodeId, node]) => {
          if (node.type !== 'workflow.agent') return [nodeId, node];
          const roleId = String(node.properties.roleId ?? '');
          if (validAgentRoleIds.has(roleId)) return [nodeId, node];
          changed = true;
          return [
            nodeId,
            {
              ...node,
              properties: {
                ...node.properties,
                roleId: defaultAgentRoleId,
              },
            },
          ];
        })
      );

      if (!changed) return previous;
      isUserChangeRef.current = true;
      return {
        ...previous,
        document: {
          ...previous.document,
          trees: {
            ...previous.document.trees,
            [activeTreeId]: {
              ...tree,
              nodes,
            },
          },
        },
      };
    });
  }, [activeTree.nodes, defaultAgentRoleId, validAgentRoleIds]);

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
      if (workflowGroups.length > 1) {
        for (const group of workflowGroups) {
          const subgraph = subgraphForWorkflow(flow, group);
          validateGraph(subgraph.nodes as never[], subgraph.edges as never[]);
        }
        setValidationTone('ok');
        setValidationMessage(`${workflowGroups.length} workflows validated.`);
        return;
      }
      const result = validateGraph(flow.nodes as never[], flow.edges as never[]);
      setValidationTone('ok');
      setValidationMessage(`Graph validated. Task node ${result.taskNodeId} routes into ${result.agentNodeIds.length} executable node(s).`);
    } catch (error) {
      setValidationTone('error');
      setValidationMessage(error instanceof Error ? error.message : String(error));
    }
  }, [registry, state.document, workflowGroups]);

  const runWorkflow = useCallback(async (frontendDirection?: FrontendDirectionSpec) => {
    try {
      const flowByMode = new Map<WorkflowGraphMode, ReturnType<typeof nodeDocumentToFlowGraph>>();
      flowByMode.set(workflowGraphMode, nodeDocumentToFlowGraph(state.document, registry));
      for (const group of allWorkflowGroups) {
        if (flowByMode.has(group.graphMode)) continue;
        const modeGraph = workflowGraphs[group.graphMode];
        if (!modeGraph) continue;
        flowByMode.set(group.graphMode, nodeDocumentToFlowGraph(legacyGraphToNodeDocument(modeGraph).document, registry));
      }
      const selectedWorkflowGroups = allWorkflowGroups.filter(group => selectedRunWorkflowIds.has(group.id));
      const groupsToRun = selectedWorkflowGroups;
      if (groupsToRun.length === 0) {
        throw new Error('Select at least one workflow before running.');
      }
      const needsThemePicker = groupsToRun.some(group => {
        const presetId = group.preset?.id ?? String(group.taskNode.properties.presetId ?? '').trim();
        return isAppSitePresetId(presetId);
      });
      if (needsThemePicker && !frontendDirection) {
        setAppSiteThemePickerOpen(true);
        setValidationTone('idle');
        setValidationMessage('Choose App/Site direction before launching selected App/Site workflow presets.');
        return;
      }
      for (const group of groupsToRun) {
        const flow = flowByMode.get(group.graphMode);
        if (!flow) throw new Error(`Workflow "${group.name}" is not available on its canvas.`);
        const subgraph = subgraphForWorkflow(flow, group);
        validateGraph(subgraph.nodes as never[], subgraph.edges as never[]);
      }
      const selectedNodeIdsByMode = new Map<WorkflowGraphMode, Set<string>>();
      for (const group of groupsToRun) {
        const selected = selectedNodeIdsByMode.get(group.graphMode) ?? new Set<string>();
        for (const nodeId of group.nodeIds) selected.add(nodeId);
        selectedNodeIdsByMode.set(group.graphMode, selected);
      }

      // Phase 1 runtime adapter: every agent node owns a REAL terminal (PTY),
      // regardless of the node's selected executionMode. This keeps Run on a
      // direct graph -> PTY path and avoids the MCP-session dependency.
      const freshBindings = new Map<string, { id: string; title: string; paneId: string; cli: WorkflowAgentCli }>();
      const storedBindings = useWorkspaceStore.getState().nodeTerminalBindings;
      for (const [mode, flow] of flowByMode) {
        const selectedNodeIds = selectedNodeIdsByMode.get(mode);
        if (!selectedNodeIds) continue;
        for (const node of flow.nodes) {
          if (node.type !== 'workflow.agent' && node.type !== 'agent') continue;
          if (!selectedNodeIds.has(String(node.id))) continue;
        const nodeId = String(node.id);
        const data = node.data as Record<string, unknown>;
        const selectedCli: WorkflowAgentCli = SELECTABLE_WORKFLOW_CLIS.includes(data.cli as WorkflowAgentCli)
          ? (data.cli as WorkflowAgentCli)
          : 'claude';
        const role = String(data.roleId ?? 'agent');

        // Force interactive PTY so each agent node owns a real terminal.
        if (mode === workflowGraphMode) {
          applyOperator({ type: 'set_node_property', nodeId, key: 'executionMode', value: 'interactive_pty' });
        }
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
            if (mode === workflowGraphMode) {
              applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: storedTerminalId });
            }
            const existing = openTerminals.find(t => t.id === storedTerminalId);
            if (existing && mode === workflowGraphMode) {
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
            if (mode === workflowGraphMode) {
              applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: persistedId });
              applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: existing.title });
              applyOperator({ type: 'set_node_property', nodeId, key: 'paneId', value: existing.paneId });
            }
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

        // Allocate a runtime terminal id without adding a Workspace pane.
        // RuntimeManager owns the PTY launch, and RuntimeView renders the live
        // terminal stream through a synthetic pane wrapper.
        const paneTitle = `Runtime ${role}`;
        const paneId = `runtime-pane-${nodeId}`;
        const terminalId = generateId();
        useWorkspaceStore.getState().setNodeRuntimeBinding(nodeId, {
          terminalId,
          runtimeSessionId: null,
          adapterStatus: null,
        });

        const created = { id: terminalId, paneId, title: paneTitle, cli: selectedCli };
        if (mode === workflowGraphMode) {
          applyOperator({ type: 'set_node_property', nodeId, key: 'terminalId', value: created.id });
          applyOperator({ type: 'set_node_property', nodeId, key: 'terminalTitle', value: created.title });
          applyOperator({ type: 'set_node_property', nodeId, key: 'paneId', value: created.paneId });
          applyOperator({ type: 'set_node_property', nodeId, key: 'cli', value: selectedCli });
        }
        data.terminalId = created.id;
        data.terminalTitle = created.title;
        data.paneId = created.paneId;
        data.cli = selectedCli;
        setNodeTerminalBinding(nodeId, created.id);
        freshBindings.set(nodeId, created);
      }
      }

      const terminalClis = Object.fromEntries(
        openTerminals
          .filter(terminal => terminal.cli && SUPPORTED_WORKFLOW_CLIS.has(terminal.cli))
          .map(terminal => [terminal.id, terminal.cli as WorkflowAgentCli])
      );
      // Freshly staged bindings must win over any stale openTerminals snapshot.
      for (const [, binding] of freshBindings) {
        terminalClis[binding.id] = binding.cli;
      }
      // Build a lookup that includes freshly spawned terminals not yet in the openTerminals memo
      const allKnownTerminals = new Map([
        ...openTerminals.map(t => [t.id, t] as const),
        ...[...freshBindings.entries()].map(([, b]) => [b.id, { id: b.id, title: b.title, paneId: b.paneId, cli: null }] as const),
      ]);

      const launched: LaunchedWorkflow[] = [];
      for (const group of groupsToRun) {
        const flow = flowByMode.get(group.graphMode);
        if (!flow) throw new Error(`Workflow "${group.name}" is not available on its canvas.`);
        const groupSubgraph = subgraphForWorkflow(flow, group);
        const hydratedNodes = groupSubgraph.nodes.map(node => {
          const data: Record<string, unknown> = { ...((node.data ?? {}) as Record<string, unknown>) };
          if (flowNodeKind(node) === 'task') {
            const taskPresetId = group.preset?.id ?? String(group.taskNode.properties.presetId ?? '').trim();
            const preset = group.preset ?? getWorkflowPreset(taskPresetId);
            data.frontendMode = preset?.frontendMode ?? data.frontendMode ?? frontendMode;
            data.frontendDirection = isAppSitePresetId(taskPresetId) ? frontendDirection : data.frontendDirection;
            data.workflowId = group.id;
            data.workflowName = group.name;
            data.workflowSubMode = group.subMode;
            data.workflowMode = group.mode ?? '';
            if (preset) {
              data.authoringMode = 'preset';
              data.presetId = preset.id;
              data.specProfile = preset.specProfile ?? 'none';
              data.finalReadmeEnabled = Boolean(data.finalReadmeEnabled ?? getPresetReadmeDefault(preset));
            }
            return { ...node, data };
          }
          if (flowNodeKind(node) !== 'agent') return { ...node, data };
          const nodeId = String(node.id);
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
        const taskAuthoringMode = (
          group.preset ? 'preset' : group.taskNode.properties.authoringMode === 'preset' || group.taskNode.properties.authoringMode === 'adaptive'
            ? group.taskNode.properties.authoringMode
            : 'graph'
        ) as WorkflowAuthoringMode;
        const taskPresetId = group.preset?.id ?? (String(group.taskNode.properties.presetId ?? '').trim() || null);
        const taskPreset = group.preset ?? getWorkflowPreset(taskPresetId);
        const mission = compileMission({
          missionId,
          graphId: `${(group.graphMode === workflowGraphMode ? graph.id : workflowGraphs[group.graphMode]?.id) || group.graphMode}:${group.id}`,
          nodes: hydratedNodes as never[],
          edges: groupSubgraph.edges as never[],
          workspaceDirFallback: workspaceDir,
          terminalClis,
          authoringMode: taskAuthoringMode,
          presetId: taskPresetId,
          runVersion: 1,
          frontendMode: taskPreset?.frontendMode ?? frontendMode,
          frontendDirection: isAppSitePresetId(taskPresetId) ? frontendDirection : undefined,
          specProfile: taskPreset?.specProfile,
          finalReadmeEnabled: taskPreset ? getPresetReadmeDefault(taskPreset) : undefined,
        });

        const nodeById = new Map(mission.nodes.map(node => [node.id, node]));
        const startNodes = mission.metadata.startNodeIds
          .map(nodeId => nodeById.get(nodeId))
          .filter((node): node is NonNullable<typeof node> => Boolean(node));
        if (startNodes.length === 0) {
          throw new Error(`Workflow "${group.name}" has no start nodes with terminal bindings.`);
        }
        for (const startNode of startNodes) {
          const terminal = allKnownTerminals.get(startNode.terminal.terminalId);
          if (!terminal) {
            throw new Error(`No terminal bound for start node ${startNode.id}.`);
          }
          if (terminal.cli !== null) {
            const cli = String(terminal.cli ?? '').trim().toLowerCase();
            if (!SUPPORTED_WORKFLOW_CLIS.has(cli)) {
              throw new Error(`CLI not detected or unsupported for ${startNode.terminal.terminalTitle} (${startNode.id}).`);
            }
          }
        }

        setActiveMissionId(missionId);
        activeMissionRef.current = mission;
        await invoke('seed_mission_to_db', { missionId, graph: mission });
        await missionOrchestrator.launchMission(mission);

        const descriptor: LaunchedWorkflow = {
          missionId,
          workflowId: group.id,
          name: group.name,
          subMode: group.subMode,
          mode: group.mode,
          size: group.preset?.size,
          agentCount: mission.nodes.length,
          workspaceDir: mission.task.workspaceDir,
          launchedAt: Date.now(),
        };
        addLaunchedWorkflow(descriptor);
        ensureWorkflowWorkspace(descriptor);
        launched.push(descriptor);
      }
      setAppMode('runtime');

      const { workflowOrchestrator } = await import('../../lib/workflow/WorkflowOrchestrator');
      for (const launchedWorkflow of launched) {
        const unsubFailures = workflowOrchestrator.subscribeForRun(launchedWorkflow.missionId, (event) => {
          if (event.type !== 'node_failed') return;
          setValidationTone('error');
          setValidationMessage(`${launchedWorkflow.name}: node ${event.nodeId} failed: ${event.error ?? 'activation pipeline error'}`);
          unsubFailures.unsubscribe();
        });
      }

      setValidationTone('ok');
      setValidationMessage(
        `${launched.length} workflow${launched.length === 1 ? '' : 's'} registered. Activating nodes…`
      );
    } catch (error) {
      setActiveMissionId(null);
      setValidationTone('error');
      setValidationMessage(error instanceof Error ? error.message : String(error));
    }
  }, [addLaunchedWorkflow, allWorkflowGroups, ensureWorkflowWorkspace, registry, state.document, workspaceDir, graph.id, openTerminals, setAppMode, applyOperator, setNodeTerminalBinding, frontendMode, selectedRunWorkflowIds, workflowGraphMode, workflowGraphs]);

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
        frontendMode,
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
  }, [registry, state.document, workspaceDir, frontendMode]);

  const importPresetGraph = useCallback((presets: PresetDefinition[], options: { finalReadmeEnabled: boolean }) => {
    if (presets.length === 0) return;
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

    const currentPrompt = String(taskNode?.properties.prompt ?? '').trim();
    const currentWorkspaceDir = String(taskNode?.properties.workspaceDir ?? workspaceDir ?? '').trim();
    const taskMode = taskNode?.properties.mode === 'edit' ? 'edit' : 'build';
    const currentGraph = nodeDocumentToWorkflowGraph(state.document, registry);
    const presetsByMode = new Map<WorkflowGraphMode, PresetDefinition[]>();
    for (const preset of presets) {
      const mode = PRESET_MODE_TO_GRAPH_MODE[preset.mode];
      presetsByMode.set(mode, [...(presetsByMode.get(mode) ?? []), preset]);
    }
    const firstMode = PRESET_MODE_TO_GRAPH_MODE[presets[0].mode];
    let firstModeGraph: WorkflowGraph | null = null;

    for (const [targetMode, modePresets] of presetsByMode) {
      const previousGraph = targetMode === workflowGraphMode
        ? currentGraph
        : (workflowGraphs[targetMode] ?? { id: `${targetMode}-editor`, nodes: [], edges: [] });
      const importedNodes: WorkflowGraph['nodes'] = [];
      const importedEdges: WorkflowGraph['edges'] = [];

      for (const [presetIndex, preset] of modePresets.entries()) {
        const missionId = generateId();
        const workflowId = `wf-${preset.id}-${missionId.slice(0, 6)}`;
        const xOffset = PRESET_WORKFLOW_BASE_X;
        const yOffset = presetIndex * PRESET_WORKFLOW_STACK_Y;
        const idMap = new Map<string, string>();
        const presetFrontendMode = preset.frontendMode ?? 'off';

        const flow = buildPresetFlowGraph({
          preset,
          missionId,
          prompt: currentPrompt || 'Imported preset objective',
          mode: taskMode,
          workspaceDir: currentWorkspaceDir || workspaceDir,
          bindingsByRole,
          instructionOverrides: {},
          frontendMode: presetFrontendMode,
          finalReadmeEnabled: options.finalReadmeEnabled,
        });
        for (const node of flow.nodes) {
          idMap.set(node.id, node.type === 'task' ? node.id : `${workflowId}-${node.id}`);
        }

        for (const node of flow.nodes) {
          const data = node.data as Record<string, unknown>;
          const nodeId = idMap.get(node.id) ?? node.id;
          const position = { x: node.position.x + xOffset, y: node.position.y + yOffset };
          if (node.type === 'task') {
            importedNodes.push({
              id: nodeId,
              roleId: 'task',
              status: 'idle',
              config: {
                prompt: String(data.prompt ?? ''),
                mode: data.mode === 'edit' ? 'edit' : 'build',
                workspaceDir: String(data.workspaceDir ?? ''),
                frontendMode: data.frontendMode as FrontendWorkflowMode,
                specProfile: data.specProfile === 'frontend_three_file' ? 'frontend_three_file' : 'none',
                finalReadmeEnabled: Boolean(data.finalReadmeEnabled),
                authoringMode: 'preset',
                presetId: preset.id,
                runVersion: 1,
                workflowId,
                workflowName: preset.name,
                workflowSubMode: preset.subMode,
                workflowMode: preset.mode,
                label: preset.name,
                position,
              },
            });
            continue;
          }

          importedNodes.push({
            id: nodeId,
            roleId: String(data.roleId ?? 'agent'),
            status: 'idle',
            config: {
              instructionOverride: String(data.instructionOverride ?? ''),
              terminalId: String(data.terminalId ?? ''),
              terminalTitle: String(data.terminalTitle ?? ''),
              paneId: String(data.paneId ?? ''),
              cli: data.cli as WorkflowAgentCli,
              model: String(data.model ?? ''),
              executionMode: data.executionMode as WorkflowExecutionMode,
              autoLinked: Boolean(data.autoLinked),
              position,
              authoringMode: 'preset',
              presetId: preset.id,
              runVersion: 1,
              workflowId,
              workflowName: preset.name,
              workflowSubMode: preset.subMode,
              workflowMode: preset.mode,
            },
          });
        }
        importedEdges.push(...flow.edges.map(edge => ({
          fromNodeId: idMap.get(edge.source) ?? edge.source,
          toNodeId: idMap.get(edge.target) ?? edge.target,
          condition: edge.data.condition,
        })));
      }

      const workflowGraph: WorkflowGraph = {
        id: previousGraph.id || `${targetMode}-editor`,
        nodes: importedNodes,
        edges: importedEdges,
      };

      setWorkflowGraphForMode(targetMode, workflowGraph);
      if (targetMode === firstMode) firstModeGraph = workflowGraph;
      if (targetMode === workflowGraphMode) {
        const snapshot = JSON.stringify(workflowGraph);
        lastGraphSnapshotRef.current = snapshot;
        const nextState = fitDocumentStateToGraph(legacyGraphToNodeDocument(workflowGraph), canvasRef.current?.getBoundingClientRect());
        setState(nextState);
        onGraphChange?.(workflowGraph);
      }
    }

    if (firstMode !== workflowGraphMode && firstModeGraph) {
      pendingFitGraphRef.current = JSON.stringify(firstModeGraph);
      setWorkflowGraphMode(firstMode);
    }
    setPresetPickerOpen(false);
    setValidationTone('ok');
    setValidationMessage(`Applied ${presets.length} preset workflow${presets.length === 1 ? '' : 's'} across ${presetsByMode.size} canvas${presetsByMode.size === 1 ? '' : 'es'}.`);
  }, [onGraphChange, openTerminals, registry, setWorkflowGraphForMode, setWorkflowGraphMode, state.document, taskNode?.properties.mode, taskNode?.properties.prompt, taskNode?.properties.workspaceDir, workflowGraphMode, workflowGraphs, workspaceDir]);

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
          const tree = next.document.trees[getActiveTreeId(next.editor)];
          const newNode = tree.nodes[newNodeId];
          if (newNode?.type === 'workflow.agent') {
            next = applyNodeEditorOperator(next.document, next.editor, registry, {
              type: 'set_node_property',
              nodeId: newNodeId,
              key: 'roleId',
              value: defaultAgentRoleId,
            });
          }
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
    [defaultAgentRoleId, registry]
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
        const rawLocations = Object.fromEntries(
          Object.entries(interaction.nodeOrigins).map(([nodeId, origin]) => [
            nodeId,
            {
              x: origin.x + (screenPoint.x - interaction.pointerOrigin.x) / view.zoom,
              y: origin.y + (screenPoint.y - interaction.pointerOrigin.y) / view.zoom,
            },
          ])
        );
        const draggedRects = Object.entries(rawLocations)
          .map(([nodeId, location]) => {
            const materialized = materializedById.get(nodeId);
            if (!materialized) return null;
            const rect = worldRect(materialized);
            return { ...rect, x: location.x, y: location.y };
          })
          .filter((rect): rect is NodeRect => Boolean(rect));
        const draggedIds = new Set(Object.keys(rawLocations));
        const targetRects = materializedNodes
          .filter(node => !draggedIds.has(node.node.id))
          .map(worldRect);
        const snap = alignmentSuggestion(draggedRects, targetRects);

        for (const [nodeId, location] of Object.entries(rawLocations)) {
          applyOperator({
            type: 'set_node_location',
            nodeId,
            location: {
              x: location.x + (snap?.offset.x ?? 0),
              y: location.y + (snap?.offset.y ?? 0),
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
  }, [applyOperator, cutLinksByKnife, hoveredInput, interaction, materializedById, materializedNodes, view.pan, view.zoom]);

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
      const target = event.target as HTMLElement | null;
      if (target?.closest('textarea, input, select, [data-canvas-wheel-lock="true"]')) {
        return;
      }
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

  const globalAgentCliNodes = useMemo(() => {
    return Object.values(activeTree.nodes)
      .filter(node => node.type === 'workflow.agent')
      .filter(node => !selectedWorkflowGroup || selectedWorkflowGroup.nodeIds.has(node.id));
  }, [activeTree.nodes, selectedWorkflowGroup]);

  const agentCliValues = useMemo(() => {
    return globalAgentCliNodes
      .map(node => (
        SELECTABLE_WORKFLOW_CLIS.includes(String(node.properties.cli ?? '') as WorkflowAgentCli)
          ? String(node.properties.cli)
          : 'claude'
      ) as WorkflowAgentCli);
  }, [globalAgentCliNodes]);

  const globalAgentCli = useMemo(() => {
    if (agentCliValues.length === 0) return '';
    const first = agentCliValues[0];
    return agentCliValues.every(cli => cli === first) ? first : '';
  }, [agentCliValues]);

  const applyGlobalAgentCli = useCallback((cli: WorkflowAgentCli) => {
    for (const node of globalAgentCliNodes) {
      applyOperator({ type: 'set_node_property', nodeId: node.id, key: 'cli', value: cli });
      applyOperator({ type: 'set_node_property', nodeId: node.id, key: 'model', value: '' });
      if (!supportsHeadless(cli)) {
        applyOperator({ type: 'set_node_property', nodeId: node.id, key: 'executionMode', value: 'interactive_pty' });
      }
    }
    setCustomModelNodeIds(new Set());
    setValidationTone('ok');
    const targetLabel = selectedWorkflowGroup ? selectedWorkflowGroup.name : 'current canvas';
    setValidationMessage(`Set ${globalAgentCliNodes.length} ${targetLabel} agent node${globalAgentCliNodes.length === 1 ? '' : 's'} to ${cli.toUpperCase()}.`);
  }, [applyOperator, globalAgentCliNodes, selectedWorkflowGroup]);

  const selectTaskWorkspaceDir = useCallback(async (nodeId: string, currentValue: unknown) => {
    const current = String(currentValue ?? workspaceDir ?? '').trim();
    const selected = await openDialog({
      directory: true,
      multiple: false,
      defaultPath: current || workspaceDir || undefined,
    });
    if (typeof selected !== 'string' || !selected.trim()) return;
    const nextDir = selected.trim();
    applyOperator({ type: 'set_node_property', nodeId, key: 'workspaceDir', value: nextDir });
    setWorkspaceDir(nextDir);
  }, [applyOperator, setWorkspaceDir, workspaceDir]);

  const setTaskAttachments = useCallback((nodeId: string, currentValue: unknown, additions: TaskAttachment[]) => {
    if (additions.length === 0) return;
    const current = normalizeTaskAttachments(currentValue);
    applyOperator({
      type: 'set_node_property',
      nodeId,
      key: 'attachments',
      value: normalizeTaskAttachments([...current, ...additions]),
    });
  }, [applyOperator]);

  const attachTaskFiles = useCallback(async (nodeId: string, currentValue: unknown) => {
    const selected = await openDialog({
      directory: false,
      multiple: true,
      defaultPath: workspaceDir || undefined,
    });
    const paths = Array.isArray(selected) ? selected : typeof selected === 'string' ? [selected] : [];
    setTaskAttachments(
      nodeId,
      currentValue,
      paths.filter(path => path.trim()).map(path => taskAttachmentFromPath(path.trim())),
    );
  }, [setTaskAttachments, workspaceDir]);

  const pasteTaskClipboardImage = useCallback(async (nodeId: string, currentValue: unknown) => {
    try {
      await readImage();
      const stamp = new Date().toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
      setTaskAttachments(nodeId, currentValue, [{
        id: `att-${generateId()}`,
        kind: 'image',
        name: `Clipboard image ${stamp}`,
        mime: 'image/*',
        source: 'clipboard',
      }]);
    } catch {
      setValidationTone('error');
      setValidationMessage('No clipboard image was available to attach.');
    }
  }, [setTaskAttachments]);

  const removeTaskAttachment = useCallback((nodeId: string, currentValue: unknown, attachmentId: string) => {
    applyOperator({
      type: 'set_node_property',
      nodeId,
      key: 'attachments',
      value: normalizeTaskAttachments(currentValue).filter(attachment => attachment.id !== attachmentId),
    });
  }, [applyOperator]);

  useEffect(() => {
    if (!inspectorNodeId) return;
    if (supportsModelDiscovery(inspectedCli) && !detectedModels.has(inspectedCli) && !loadingModels.has(inspectedCli)) {
      triggerModelDetection(inspectedCli);
    }
  }, [inspectorNodeId, inspectedCli, detectedModels, loadingModels, triggerModelDetection]);

  useEffect(() => {
    if (!modelDropdownOpenNodeId) return;
    const handler = (e: MouseEvent) => {
      if (modelDropdownRef.current && !modelDropdownRef.current.contains(e.target as Node)) {
        setModelDropdownOpenNodeId(null);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [modelDropdownOpenNodeId]);

  useEffect(() => {
    if (!runMenuOpen) return;
    const handler = (e: MouseEvent) => {
      if (runMenuRef.current && !runMenuRef.current.contains(e.target as Node)) {
        setRunMenuOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [runMenuOpen]);

  return (
    <div className="h-full w-full background-bg-app text-text-primary flex flex-col">
      <div className="h-12 shrink-0 border-b border-border-panel px-3 flex items-center justify-between background-bg-titlebar">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.24em] text-accent-primary">
          <Workflow size={14} />
          <span>Node Graph Architecture</span>
          <div className="ml-3 flex items-center gap-1 rounded-lg border border-border-panel bg-bg-panel p-1 normal-case tracking-normal">
            {graphModeOptions.map(mode => {
              const Icon = GRAPH_MODE_ICONS[mode];
              const active = workflowGraphMode === mode;
              const count = mode === workflowGraphMode
                ? graph.nodes.length
                : (workflowGraphs[mode]?.nodes.length ?? 0);
              return (
                <button
                  key={mode}
                  type="button"
                  onClick={() => setWorkflowGraphMode(mode)}
                  className={`flex h-7 items-center gap-1.5 rounded px-2 text-[10px] font-semibold transition-colors ${
                    active
                      ? 'bg-accent-primary text-accent-text'
                      : 'text-text-muted hover:bg-bg-surface hover:text-text-primary'
                  }`}
                  title={`${GRAPH_MODE_LABELS[mode]} canvas`}
                >
                  <Icon size={11} />
                  <span>{GRAPH_MODE_LABELS[mode]}</span>
                  {count > 0 && (
                    <span className={`rounded px-1 text-[9px] ${active ? 'bg-accent-text/20' : 'bg-accent-primary/15 text-accent-primary'}`}>
                      {count}
                    </span>
                  )}
                </button>
              );
            })}
          </div>
          {activePresetLabel && (
            <span
              className="ml-2 max-w-[220px] truncate rounded border border-accent-primary/40 bg-accent-primary/10 px-2 py-0.5 text-[10px] font-semibold normal-case tracking-normal text-accent-primary"
              title={`Active workflow preset: ${activePresetLabel}`}
            >
              Active: {activePresetLabel}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2 text-[11px]">
          <select
            value={globalAgentCli}
            onChange={event => {
              const value = event.target.value as WorkflowAgentCli;
              if (SELECTABLE_WORKFLOW_CLIS.includes(value)) applyGlobalAgentCli(value);
            }}
            disabled={agentCliValues.length === 0}
            className="background-bg-surface border border-border-panel rounded px-2 py-1 text-[11px] text-text-secondary disabled:opacity-40"
            title={selectedWorkflowGroup ? `Set runtime CLI for ${selectedWorkflowGroup.name}` : 'Set runtime CLI for every workflow on this canvas'}
          >
            <option value="">{agentCliValues.length === 0 ? 'No agents' : 'Mixed CLI'}</option>
            {SELECTABLE_WORKFLOW_CLIS.map(cli => (
              <option key={cli} value={cli}>{cli.toUpperCase()}</option>
            ))}
          </select>
          {state.editor.treePath.length > 1 && (
            <button
              onClick={() => applyOperator({ type: 'end_group_edit' })}
              className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-panel"
            >
              <ChevronLeft size={12} className="inline mr-1" />
              Back
            </button>
          )}
          <div className="relative" ref={runMenuRef}>
            <button onClick={() => setRunMenuOpen(open => !open)} className="px-2.5 py-1 rounded border border-accent-primary text-accent-primary hover:bg-accent-primary/10">
              <Play size={12} className="inline mr-1" />
              Run
              <ChevronDown size={12} className="inline ml-1" />
            </button>
            {runMenuOpen && (
              <div className="absolute right-0 top-full z-50 mt-1 w-80 rounded-lg border border-border-panel bg-bg-panel p-2 shadow-xl">
                <div className="max-h-64 overflow-y-auto custom-scrollbar">
                  {runWorkflowModeGroups.map(modeGroup => {
                    const ModeIcon = modeGroup.icon;
                    const expanded = expandedRunModeIds.has(modeGroup.id);
                    const selectedCount = modeGroup.workflows.filter(group => selectedRunWorkflowIds.has(group.id)).length;
                    const allChecked = selectedCount === modeGroup.workflows.length && modeGroup.workflows.length > 0;
                    const partiallyChecked = selectedCount > 0 && !allChecked;
                    return (
                      <div key={modeGroup.id} className="mb-1 last:mb-0">
                        <button
                          type="button"
                          onClick={() => setExpandedRunModeIds(current => {
                            const next = new Set(current);
                            if (next.has(modeGroup.id)) next.delete(modeGroup.id);
                            else next.add(modeGroup.id);
                            return next;
                          })}
                          className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-surface"
                        >
                          <span
                            role="checkbox"
                            aria-checked={allChecked}
                            tabIndex={0}
                            onClick={event => {
                              event.stopPropagation();
                              setSelectedRunWorkflowIds(current => {
                                const next = new Set(current);
                                if (allChecked) {
                                  for (const workflow of modeGroup.workflows) next.delete(workflow.id);
                                } else {
                                  for (const workflow of modeGroup.workflows) next.add(workflow.id);
                                }
                                return next;
                              });
                            }}
                            onKeyDown={event => {
                              if (event.key !== 'Enter' && event.key !== ' ') return;
                              event.preventDefault();
                              event.currentTarget.click();
                            }}
                            className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                              allChecked
                                ? 'border-accent-primary bg-accent-primary text-accent-text'
                                : partiallyChecked
                                  ? 'border-accent-primary bg-accent-primary/20 text-accent-primary'
                                  : 'border-border-panel'
                            }`}
                          >
                            {allChecked && <Check size={11} />}
                            {partiallyChecked && <span className="h-1.5 w-1.5 rounded-sm bg-accent-primary" />}
                          </span>
                          <ModeIcon size={13} className="shrink-0 text-accent-primary" />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-[11px] font-semibold text-text-secondary">{modeGroup.label}</span>
                            <span className="block truncate text-[10px] text-text-muted">{selectedCount}/{modeGroup.workflows.length} selected</span>
                          </span>
                          <ChevronDown size={13} className={`shrink-0 text-text-muted transition-transform ${expanded ? 'rotate-180' : ''}`} />
                        </button>
                        {expanded && (
                          <div className="ml-6 mt-1 space-y-1 border-l border-border-panel pl-2">
                            {modeGroup.workflows.map(group => {
                              const checked = selectedRunWorkflowIds.has(group.id);
                              return (
                                <button
                                  key={group.id}
                                  type="button"
                                  onClick={() => setSelectedRunWorkflowIds(current => {
                                    const next = new Set(current);
                                    if (next.has(group.id)) next.delete(group.id);
                                    else next.add(group.id);
                                    return next;
                                  })}
                                  className="flex w-full items-center gap-2 rounded px-2 py-1.5 text-left hover:bg-bg-surface"
                                >
                                  <span className={`flex h-4 w-4 shrink-0 items-center justify-center rounded border ${checked ? 'border-accent-primary bg-accent-primary text-accent-text' : 'border-border-panel'}`}>
                                    {checked && <Check size={11} />}
                                  </span>
                                  <span className="min-w-0 flex-1">
                                    <span className="block truncate text-[11px] font-semibold text-text-secondary">{group.name}</span>
                                    <span className="block truncate text-[10px] text-text-muted">{group.subMode} · {group.agentCount} agents</span>
                                  </span>
                                </button>
                              );
                            })}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
                <button
                  type="button"
                  onClick={() => {
                    setRunMenuOpen(false);
                    void runWorkflow();
                  }}
                  disabled={allWorkflowGroups.length === 0 || selectedRunWorkflowIds.size === 0}
                  className="mt-2 w-full rounded border border-accent-primary bg-accent-primary px-2 py-1.5 text-[12px] font-semibold text-accent-text disabled:cursor-not-allowed disabled:opacity-40"
                >
                  Run selected
                </button>
              </div>
            )}
          </div>
          <button onClick={validateCurrentGraph} className="px-2.5 py-1 rounded border border-border-panel text-accent-primary hover:background-bg-panel">
            <ScanSearch size={12} className="inline mr-1" />
            Validate
          </button>
          <button onClick={viewRuntimeMapping} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-panel">
            Runtime Map
          </button>
          <button onClick={() => setPresetPickerOpen(true)} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-panel">
            <Sparkles size={12} className="inline mr-1" />
            Workflow Presets
          </button>
          <button onClick={() => applyOperator({ type: 'delete_selection' })} className="px-2.5 py-1 rounded border border-border-panel text-text-muted hover:text-red-300 hover:bg-red-500/10">
            <Trash2 size={12} className="inline mr-1" />
            Delete
          </button>
        </div>
      </div>

      <WorkflowPresetPicker
        open={presetPickerOpen}
        initialMode="build"
        onClose={() => setPresetPickerOpen(false)}
        onApply={importPresetGraph}
      />

      <AppSiteThemePicker
        open={appSiteThemePickerOpen}
        onClose={() => setAppSiteThemePickerOpen(false)}
        onApply={spec => {
          setAppSiteThemePickerOpen(false);
          void runWorkflow(spec);
        }}
      />

      <div className="px-3 py-2 shrink-0 border-b border-border-panel background-bg-surface flex items-center justify-between text-[11px]">
        <div className="flex items-center gap-2">
          {state.editor.treePath.map((treeId, index) => (
            <span key={treeId} className={index === state.editor.treePath.length - 1 ? 'text-text-primary' : 'text-text-muted'}>
              {state.document.trees[treeId]?.name ?? treeId}
              {index < state.editor.treePath.length - 1 ? ' / ' : ''}
            </span>
          ))}
          {workflowGroups.length > 1 && (
            <div className="ml-3 flex max-w-[52vw] items-center gap-1 overflow-x-auto">
              {workflowGroups.map(group => {
                const active = selectedWorkflowGroup?.id === group.id;
                return (
                  <button
                    key={group.id}
                    type="button"
                    onClick={() => applyOperator({ type: 'set_selection', nodeIds: [group.taskNode.id], activeNodeId: group.taskNode.id })}
                    className={`flex h-6 shrink-0 items-center gap-1 rounded border px-2 text-[10px] ${
                      active
                        ? 'border-accent-primary bg-accent-primary/15 text-text-primary'
                        : 'border-border-panel bg-bg-panel text-text-muted hover:border-accent-primary/50 hover:text-text-primary'
                    }`}
                    title={`${group.name} · ${group.subMode}`}
                  >
                    <Workflow size={11} className="text-accent-primary" />
                    <span className="max-w-28 truncate">{group.subMode}</span>
                    <span className="text-text-muted/70">{group.agentCount}</span>
                  </button>
                );
              })}
            </div>
          )}
        </div>
        <div className={validationTone === 'error' ? 'text-red-300' : validationTone === 'ok' ? 'text-emerald-300' : 'text-text-muted'}>{validationMessage}</div>
      </div>

      <div ref={canvasRef} className="relative flex-1 overflow-hidden" onMouseDown={onCanvasMouseDown} onContextMenu={onCanvasContextMenu}>
        {canvasEffectsEnabled && workflowGraphMode === 'standard' && <DotTunnelBackground />}
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
            {dragAlignment && (
              <>
                <rect
                  x={toLinkCanvas({ x: dragAlignment.dropRect.x, y: dragAlignment.dropRect.y }).x}
                  y={toLinkCanvas({ x: dragAlignment.dropRect.x, y: dragAlignment.dropRect.y }).y}
                  width={dragAlignment.dropRect.width}
                  height={dragAlignment.dropRect.height}
                  rx={10}
                  stroke="var(--accent-primary)"
                  strokeWidth={1.5}
                  strokeDasharray="6 5"
                  fill="color-mix(in srgb, var(--color-accent-primary) 9%, transparent)"
                />
                {dragAlignment.guides.map((guide, index) => (
                  guide.orientation === 'vertical'
                    ? (
                      <line
                        key={`${guide.orientation}-${index}`}
                        x1={toLinkCanvas({ x: guide.position, y: 0 }).x}
                        y1={toLinkCanvas({ x: 0, y: guide.from }).y}
                        x2={toLinkCanvas({ x: guide.position, y: 0 }).x}
                        y2={toLinkCanvas({ x: 0, y: guide.to }).y}
                        stroke="var(--accent-primary)"
                        strokeWidth={1.25}
                        strokeDasharray="5 5"
                      />
                    )
                    : (
                      <line
                        key={`${guide.orientation}-${index}`}
                        x1={toLinkCanvas({ x: guide.from, y: 0 }).x}
                        y1={toLinkCanvas({ x: 0, y: guide.position }).y}
                        x2={toLinkCanvas({ x: guide.to, y: 0 }).x}
                        y2={toLinkCanvas({ x: 0, y: guide.position }).y}
                        stroke="var(--accent-primary)"
                        strokeWidth={1.25}
                        strokeDasharray="5 5"
                      />
                    )
                ))}
              </>
            )}
            {Object.values(activeTree.links).map(link => {
              if (!visibleNodeIds.has(link.from.nodeId) && !visibleNodeIds.has(link.to.nodeId)) {
                return null;
              }
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
            return visibleMaterializedNodes.map(materializedNode => {
            const rect = worldRect(materializedNode);
            const isSelected = selectedNodeIds.has(materializedNode.node.id);
            const isFrame = materializedNode.node.type === 'workflow.frame';
            const runtimeAgent = missionAgentByNodeId.get(materializedNode.node.id);
            const runtimeBinding = nodeRuntimeBindings[materializedNode.node.id];
            
            const snapshotNode = snapshotNodeById.get(materializedNode.node.id);
            
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
            
            const terminal = terminalById.get(terminalId);
            const runtimeCli = String(
              materializedNode.node.properties.cli ??
              terminal?.cli ??
              runtimeAgent?.runtimeCli ??
              materializedNode.node.properties.runtimeCli ??
              'claude'
            ).trim();
            const runtimeSessionId = String(runtimeAgent?.runtimeSessionId ?? runtimeBinding?.runtimeSessionId ?? '').trim();
            const artifactHints = artifactHintsByNodeId.get(materializedNode.node.id) ?? [];
            const latestNodeEvent = latestEventByNodeId.get(materializedNode.node.id);
            const isActiveAgent = materializedNode.node.type === 'workflow.agent' && isWorkflowStatusActive(runtimeStatus);

            return (
              <div
                key={materializedNode.node.id}
                className={`absolute rounded-xl border background-bg-panel ${borderClass(isSelected, isActiveAgent)}`}
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

                {/* Node Actions Toolbar */}
                {!isFrame && (
                  <div className="px-3 py-1.5 border-b border-border-panel flex items-center gap-1 background-bg-panel/50">
                    <button
                      onClick={() => activeMissionId && missionOrchestrator.runNode(activeMissionId, materializedNode.node.id)}
                      title="Run Node"
                      className="p-1 hover:bg-accent-primary/20 rounded text-text-muted hover:text-accent-primary transition-colors"
                    >
                      <Play size={12} />
                    </button>
                    <button
                      onClick={() => activeMissionId && missionOrchestrator.retryNode(activeMissionId, materializedNode.node.id)}
                      title="Retry Node"
                      className="p-1 hover:bg-accent-primary/20 rounded text-text-muted hover:text-accent-primary transition-colors"
                    >
                      <RefreshCw size={12} />
                    </button>
                    <button
                      onClick={() => activeMissionId && missionOrchestrator.cancelNode(activeMissionId, materializedNode.node.id)}
                      title="Cancel Node"
                      className="p-1 hover:bg-red-500/20 rounded text-text-muted hover:text-red-400 transition-colors"
                    >
                      <Square size={12} />
                    </button>
                    <div className="w-px h-3 bg-border-panel mx-1" />
                    <button
                      onClick={() => {
                        const isManual = materializedNode.node.properties.executionMode === 'manual';
                        applyOperator({
                          type: 'set_node_property',
                          nodeId: materializedNode.node.id,
                          key: 'executionMode',
                          value: isManual ? 'interactive_pty' : 'manual'
                        });
                      }}
                      title={materializedNode.node.properties.executionMode === 'manual' ? "Release Takeover" : "Manual Takeover"}
                      className={`p-1 rounded transition-colors ${materializedNode.node.properties.executionMode === 'manual' ? 'bg-accent-primary/20 text-accent-primary' : 'hover:bg-accent-primary/20 text-text-muted hover:text-accent-primary'}`}
                    >
                      <UserCheck size={12} />
                    </button>
                    <button
                      onClick={() => {
                        if (terminalId) {
                          addPane('terminal', `Terminal: ${materializedNode.node.label || materializedNode.node.id}`, { terminalId });
                        }
                      }}
                      title="Open Terminal"
                      className="p-1 hover:bg-accent-primary/20 rounded text-text-muted hover:text-accent-primary transition-colors disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-muted"
                      disabled={!terminalId}
                    >
                      <Terminal size={12} />
                    </button>
                  </div>
                )}

                <div className="px-3 py-3 relative">
                  {materializedNode.inputs.map((socket, index) => {
                    const isSnapTarget = hoveredInput?.nodeId === materializedNode.node.id && hoveredInput?.socketId === socket.id;
                    const isConnected = connectedInputKeys.has(`${materializedNode.node.id}:${socket.id}`);
                    const isFilled = isSnapTarget || isConnected;
                    return (
                      <button
                        key={socket.id}
                        className={`absolute left-0 w-4 h-4 -translate-x-1/2 rounded-full border border-accent-primary transition-all duration-75 ${isFilled ? 'bg-accent-primary' : 'background-bg-app'}`}
                        style={{ top: SOCKET_TOP_OFFSET + index * SOCKET_ROW_GAP, ...(isSnapTarget ? { boxShadow: '0 0 4px var(--accent-primary), 0 0 10px var(--accent-primary), 0 0 22px var(--accent-primary)' } : {}) }}
                        onMouseEnter={() => { if (interaction.kind !== 'dragging_link') setHoveredInput({ nodeId: materializedNode.node.id, socketId: socket.id }); }}
                        onMouseLeave={() => { if (interaction.kind !== 'dragging_link') setHoveredInput(current => (current?.nodeId === materializedNode.node.id && current?.socketId === socket.id ? null : current)); }}
                        title={`${socket.name} (${socket.dataType})`}
                      />
                    );
                  })}
                  {materializedNode.outputs.map((socket, index) => {
                    const isConnectedOutput = connectedOutputKeys.has(`${materializedNode.node.id}:${socket.id}`);
                    const isHiddenFailureOutput =
                      socket.id === 'failure' &&
                      !isConnectedOutput &&
                      !isSelected &&
                      interaction.kind !== 'dragging_link';
                    if (isHiddenFailureOutput) return null;
                    return (
                      <button
                        key={socket.id}
                        className={`absolute right-0 w-4 h-4 translate-x-1/2 rounded-full border border-accent-primary ${isConnectedOutput ? 'bg-accent-primary' : 'background-bg-app'}`}
                        style={{ top: SOCKET_TOP_OFFSET + index * SOCKET_ROW_GAP }}
                        onMouseDown={event => beginLinkDrag(event, materializedNode.node.id, socket.id)}
                        title={`${socket.name} (${socket.dataType})`}
                      />
                    );
                  })}

                  <div className="grid grid-cols-[1fr_auto_1fr] gap-3 text-[11px] text-text-muted mb-4">
                    <div className={materializedNode.node.type === 'workflow.task' ? 'flex min-w-0 items-center justify-start gap-2' : 'space-y-0'}>
                      {materializedNode.node.type === 'workflow.task' && (() => {
                        const taskDir = String(materializedNode.node.properties.workspaceDir ?? workspaceDir ?? '').trim();
                        return (
                          <button
                            type="button"
                            onClick={() => void selectTaskWorkspaceDir(materializedNode.node.id, materializedNode.node.properties.workspaceDir)}
                            title={taskDir || 'Select workspace directory'}
                            className="h-7 max-w-[180px] min-w-[116px] background-bg-surface border border-border-panel rounded-md px-2 text-[11px] text-text-secondary hover:text-text-primary hover:border-accent-primary/40 flex items-center gap-1.5"
                          >
                            <FolderOpen size={12} className="shrink-0 text-accent-primary" />
                            <span className="truncate">{folderLabel(taskDir)}</span>
                          </button>
                        );
                      })()}
                      {materializedNode.inputs.map(socket => <div key={socket.id} className="h-6 flex items-center">{socket.name}</div>)}
                    </div>
                    <div />
                    <div className={materializedNode.node.type === 'workflow.task' ? 'flex min-w-0 items-center justify-end text-right' : 'space-y-0 text-right'}>
                      {materializedNode.outputs.map(socket => {
                        const isConnectedOutput = connectedOutputKeys.has(`${materializedNode.node.id}:${socket.id}`);
                        const isHiddenFailureOutput =
                          socket.id === 'failure' &&
                          !isConnectedOutput &&
                          !isSelected &&
                          interaction.kind !== 'dragging_link';
                        if (isHiddenFailureOutput) return null;
                        return <div key={socket.id} className="h-6 flex items-center justify-end">{socket.name}</div>;
                      })}
                    </div>
                  </div>

                  {runtimeReason && (
                    <div className="mb-3 rounded border border-red-400/20 bg-red-500/10 px-2 py-1.5 text-[10px] text-red-200 break-words">
                      {runtimeReason}
                    </div>
                  )}

                  {materializedNode.node.type === 'workflow.task' && (
                    <div className="space-y-2">
                      {(() => {
                        const attachments = normalizeTaskAttachments(materializedNode.node.properties.attachments);
                        return (
                          <>
                            <div className="background-bg-surface border border-border-panel rounded-lg overflow-hidden">
                              <textarea
                                rows={10}
                                value={String(materializedNode.node.properties.prompt ?? '')}
                                onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'prompt', value: event.target.value })}
                                onWheel={event => event.stopPropagation()}
                                onPaste={event => {
                                  const files = Array.from(event.clipboardData.files ?? []);
                                  const pathAttachments = clipboardPathAttachments(event.clipboardData);
                                  const fileAttachments = files.map(file => {
                                    const path = String((file as File & { path?: string }).path ?? '').trim();
                                    const name = path ? fileLabel(path) : file.name || 'Clipboard item';
                                    return {
                                      id: `att-${generateId()}`,
                                      kind: attachmentKindForName(name, file.type),
                                      name,
                                      path: path || undefined,
                                      mime: file.type || undefined,
                                      source: 'clipboard' as const,
                                    };
                                  });
                                  const attachmentsToAdd = [...pathAttachments, ...fileAttachments];
                                  if (attachmentsToAdd.length === 0) return;
                                  event.preventDefault();
                                  setTaskAttachments(materializedNode.node.id, materializedNode.node.properties.attachments, attachmentsToAdd);
                                }}
                                placeholder="Task prompt"
                                data-canvas-wheel-lock="true"
                                className="w-full min-h-[252px] background-bg-surface px-3 py-3 text-[12px] leading-5 text-text-primary resize-none outline-none overflow-y-auto overscroll-contain"
                              />
                              <div className="border-t border-border-panel px-2 py-1.5">
                                <div className="flex flex-wrap items-center gap-1.5">
                                  <button
                                    type="button"
                                    onClick={() => void attachTaskFiles(materializedNode.node.id, materializedNode.node.properties.attachments)}
                                    title="Attach files"
                                    className="h-6 w-6 rounded border border-border-panel text-text-secondary hover:text-text-primary hover:border-accent-primary/40 flex items-center justify-center"
                                    aria-label="Attach files"
                                  >
                                    <Paperclip size={12} />
                                  </button>
                                  <button
                                    type="button"
                                    onClick={() => void pasteTaskClipboardImage(materializedNode.node.id, materializedNode.node.properties.attachments)}
                                    title="Paste clipboard image"
                                    className="h-6 w-6 rounded border border-border-panel text-text-secondary hover:text-text-primary hover:border-accent-primary/40 flex items-center justify-center"
                                    aria-label="Paste clipboard image"
                                  >
                                    <ClipboardPaste size={12} />
                                  </button>
                                  {attachments.length > 0 && (
                                    <>
                                    {attachments.map(attachment => {
                                      const AttachmentIcon = attachment.kind === 'image' ? ImageIcon : FileText;
                                      return (
                                        <span
                                          key={attachment.id}
                                          title={attachment.path ?? attachment.name}
                                          className="max-w-full min-w-0 rounded border border-border-panel bg-black/10 px-1.5 py-1 text-[10px] text-text-secondary flex items-center gap-1.5"
                                        >
                                          <AttachmentIcon size={11} className="shrink-0 text-accent-primary" />
                                          <span className="truncate max-w-[210px]">{attachment.name}</span>
                                          <button
                                            type="button"
                                            onClick={() => removeTaskAttachment(materializedNode.node.id, materializedNode.node.properties.attachments, attachment.id)}
                                            className="shrink-0 text-text-muted hover:text-red-300"
                                            title="Remove attachment"
                                            aria-label={`Remove ${attachment.name}`}
                                          >
                                            <X size={10} />
                                          </button>
                                        </span>
                                      );
                                    })}
                                    </>
                                  )}
                                </div>
                              </div>
                            </div>
                          </>
                        );
                      })()}
                      {graphUsesUiBackground && (
                      <div className="flex gap-1 rounded-lg border border-border-panel background-bg-surface p-1">
                        {UI_FRONTEND_WORKFLOW_MODES.map(mode => {
                          const ModeIcon = mode.icon;
                          const selected = uiFrontendMode === mode.value;
                          return (
                            <button
                              key={mode.value}
                              type="button"
                              onClick={() => {
                                setUiFrontendMode(mode.value);
                                applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'frontendMode', value: mode.value });
                              }}
                              className={`group relative h-7 flex-1 rounded flex items-center justify-center hover:bg-white/5 ${selected ? 'text-accent-primary bg-accent-primary/10' : 'text-text-secondary'}`}
                              title={mode.label}
                              aria-label={mode.label}
                            >
                              <ModeIcon size={13} />
                              <span className="pointer-events-none absolute top-8 left-1/2 -translate-x-1/2 whitespace-nowrap rounded border border-border-panel background-bg-panel px-2 py-1 text-[10px] text-text-secondary opacity-0 shadow-xl group-hover:opacity-100">
                                {mode.label}
                              </span>
                            </button>
                          );
                        })}
                      </div>
                      )}
                    </div>
                  )}

                  {materializedNode.node.type === 'workflow.agent' && (
                    <div className="space-y-2">
                      <div className="grid grid-cols-2 gap-2">
                        <select
                          value={agentRoleOptions.some(agent => agent.id === String(materializedNode.node.properties.roleId ?? ''))
                            ? String(materializedNode.node.properties.roleId)
                            : defaultAgentRoleId}
                          onChange={event => applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'roleId', value: event.target.value })}
                          className="flex-1 background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px]"
                        >
                          {agentRoleOptions.map(agent => (
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
                                <div className="relative" ref={modelDropdownOpenNodeId === materializedNode.node.id ? modelDropdownRef : undefined}>
                                  <button
                                    type="button"
                                    onClick={() => {
                                      const opening = modelDropdownOpenNodeId !== materializedNode.node.id;
                                      setModelDropdownOpenNodeId(opening ? materializedNode.node.id : null);
                                      if (opening && !isLoading && !modelResult) {
                                        triggerModelDetection(activeCli, false);
                                      }
                                    }}
                                    className="w-full min-w-0 background-bg-surface border border-border-panel rounded-lg px-2 py-1.5 text-[11px] text-text-secondary flex items-center justify-between"
                                  >
                                    <span className="truncate">{currentModel || 'MODEL'}</span>
                                    <ChevronDown size={10} className="text-text-muted" />
                                  </button>
                                  {modelDropdownOpenNodeId === materializedNode.node.id && (
                                    <div className="absolute z-50 left-0 right-0 top-full mt-1 background-bg-surface border border-border-panel rounded-lg shadow-lg max-h-60 overflow-y-auto py-1" onWheel={e => e.stopPropagation()}>
                                      <button
                                        type="button"
                                        className={`w-full text-left px-2 py-1.5 text-[11px] hover:bg-white/5 ${currentModel === '' ? 'text-accent-primary' : 'text-text-secondary'}`}
                                        onClick={() => {
                                          setCustomModelNodeIds(prev => { const next = new Set(prev); next.delete(materializedNode.node.id); return next; });
                                          applyOperator({ type: 'set_node_property', nodeId: materializedNode.node.id, key: 'model', value: '' });
                                          setModelDropdownOpenNodeId(null);
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
                                                setModelDropdownOpenNodeId(null);
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
                                            setModelDropdownOpenNodeId(null);
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
                      {latestNodeEvent && (
                        <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5 text-[10px]">
                          <div className="uppercase tracking-wide text-text-muted">Last Event</div>
                          <div className="mt-0.5 text-text-secondary break-words">{latestNodeEvent.message}</div>
                        </div>
                      )}
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
                              <option value="api">API</option>
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
                          if (combinedArtifacts.length === 0) {
                            return (
                              <div className="py-12 flex flex-col items-center justify-center text-center px-4">
                                <Sparkles size={24} className="text-text-muted opacity-20 mb-2" />
                                <div className="text-[10px] text-text-muted italic opacity-40">Waiting for artifacts...</div>
                                <div className="text-[9px] text-text-muted opacity-30 mt-1 max-w-[140px]">File changes and summaries will appear here in real-time.</div>
                              </div>
                            );
                          }
                          
                          return combinedArtifacts.map(art => (
                            <div 
                              key={art.id} 
                              className="p-2.5 rounded-lg border border-border-panel background-bg-app hover:border-accent-primary/30 hover:background-bg-surface transition-all group cursor-pointer"
                              onClick={() => {
                                if (art.path) {
                                  addPane('editor', art.title, { filePath: art.path });
                                }
                              }}
                            >
                              <div className="flex items-center justify-between mb-1.5">
                                <div className="flex items-center gap-1.5">
                                  <div className={`w-1.5 h-1.5 rounded-full ${
                                    art.kind === 'file_change' || art.kind === 'file' || art.kind === 'patch' ? 'bg-emerald-400' : 
                                    art.kind === 'summary' || art.kind === 'review_verdict' ? 'bg-amber-400' : 'bg-blue-400'
                                  } shadow-[0_0_8px_rgba(0,0,0,0.5)]`} />
                                  <span className="text-[9px] font-bold text-accent-primary uppercase tracking-tighter">
                                    {art.kind.replace('_', ' ')}
                                  </span>
                                </div>
                                <span className="text-[9px] text-text-muted font-mono opacity-50">
                                  {new Date(art.createdAt).toLocaleTimeString([], { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })}
                                </span>
                              </div>
                              <div className="text-[11px] text-text-primary font-semibold leading-tight group-hover:text-accent-primary transition-colors">{art.title}</div>
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
                        <span>{combinedArtifacts.length} items captured</span>
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
