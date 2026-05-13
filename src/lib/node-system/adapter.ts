import { generateId } from '../graphUtils';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../store/workspace';
import { normalizeCliId } from '../cliIdentity';
import { createNodeEditorState, type NodeEditorState } from './editor';
import { createWorkflowNodeRegistry, type NodeTypeRegistry } from './declarations';
import type {
  NodeInstance,
  NodeLink,
  NodeTreeDefinition,
  NodeTreeDocument,
  NodeTreeInterface,
  Point2D,
} from './types';

interface FlowGraphLike {
  nodes: Array<Record<string, unknown>>;
  edges: Array<Record<string, unknown>>;
}

function fileLabel(value: string | null | undefined): string {
  const trimmed = String(value ?? '').trim();
  if (!trimmed) return 'Untitled';
  const normalized = trimmed.replace(/[\\/]+$/, '');
  return normalized.split(/[\\/]/).filter(Boolean).pop() || normalized;
}

function attachmentKindForName(name: string, mime?: string): 'file' | 'image' {
  if (mime?.startsWith('image/')) return 'image';
  return /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name) ? 'image' : 'file';
}

function normalizeTaskAttachments(value: unknown): NonNullable<WorkflowNode['config']>['attachments'] {
  if (!Array.isArray(value)) return [];
  const seen = new Set<string>();
  const attachments: NonNullable<WorkflowNode['config']>['attachments'] = [];
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

function interfaceDefinition(): NodeTreeInterface {
  return { sockets: [], panels: [] };
}

function defaultPoint(index: number): Point2D {
  return {
    x: 120 + index * 260,
    y: 120 + (index % 3) * 120,
  };
}

function nodeTypeFromLegacy(node: WorkflowNode): string {
  if (node.roleId === 'task') return 'workflow.task';
  if (node.roleId === 'barrier') return 'workflow.barrier';
  if (node.roleId === 'frame') return 'workflow.frame';
  if (node.roleId === 'reroute') return 'workflow.reroute';
  return 'workflow.agent';
}

function outputSocketFromLegacyCondition(nodeType: string, condition: WorkflowEdge['condition']) {
  if (nodeType === 'workflow.agent' && condition === 'on_failure') {
    return 'failure';
  }
  if (nodeType === 'workflow.agent' && condition === 'on_success') {
    return 'success';
  }
  if (nodeType === 'workflow.task') {
    return 'start';
  }
  return 'out';
}

function inputSocketForNodeType(nodeType: string) {
  if (nodeType === 'workflow.group_output') {
    return 'out';
  }
  return 'in';
}

function legacyNodeToDocumentNode(node: WorkflowNode, index: number): NodeInstance {
  const type = nodeTypeFromLegacy(node);
  let fallbackLabel = node.roleId;
  if (type === 'workflow.agent') fallbackLabel = 'Agent';
  else if (type === 'workflow.task') fallbackLabel = 'Task';
  else if (type === 'workflow.barrier') fallbackLabel = 'Barrier';
  else if (type === 'workflow.frame') fallbackLabel = 'Frame';
  else if (type === 'workflow.reroute') fallbackLabel = 'Reroute';

  return {
    id: node.id,
    type,
    label: node.config?.label || fallbackLabel,
    location: node.config?.position ?? defaultPoint(index),
    size:
      typeof node.config?.width === 'number' && typeof node.config?.height === 'number'
        ? { width: node.config.width, height: node.config.height }
        : undefined,
    parentId: node.config?.parentId,
    properties: {
      roleId: node.roleId,
      prompt: node.config?.prompt ?? '',
      mode: node.config?.mode ?? 'build',
      workspaceDir: node.config?.workspaceDir ?? '',
      attachments: normalizeTaskAttachments(node.config?.attachments),
      instructionOverride: node.config?.instructionOverride ?? '',
      terminalId: node.config?.terminalId ?? '',
      terminalTitle: node.config?.terminalTitle ?? '',
      paneId: node.config?.paneId ?? '',
      cli: node.config?.cli ?? 'claude',
      model: node.config?.model ?? '',
      yolo: Boolean(node.config?.yolo),
      executionMode: node.config?.executionMode ?? 'streaming_headless',
      autoLinked: Boolean(node.config?.autoLinked),
      authoringMode: node.config?.authoringMode ?? 'graph',
      presetId: node.config?.presetId ?? '',
      runVersion: node.config?.runVersion ?? 1,
      frontendMode: node.config?.frontendMode ?? 'off',
      finalReadmeEnabled: Boolean(node.config?.finalReadmeEnabled),
      finalReadmeOwnerNodeId: node.config?.finalReadmeOwnerNodeId ?? '',
      adaptiveSeed: Boolean(node.config?.adaptiveSeed),
      workflowId: node.config?.workflowId ?? '',
      workflowName: node.config?.workflowName ?? '',
      workflowSubMode: node.config?.workflowSubMode ?? '',
      workflowMode: node.config?.workflowMode ?? '',
      label: node.config?.label ?? '',
    },
  };
}

export function legacyGraphToNodeDocument(graph: WorkflowGraph) {
  const tree: NodeTreeDefinition = {
    id: graph.id || 'global-editor',
    name: 'Workflow',
    kind: 'workflow',
    interface: interfaceDefinition(),
    nodes: Object.fromEntries(graph.nodes.map((node, index) => [node.id, legacyNodeToDocumentNode(node, index)])),
    links: {},
  };

  const typeByNode = new Map(Object.values(tree.nodes).map(node => [node.id, node.type]));
  for (const edge of graph.edges) {
    const fromType = typeByNode.get(edge.fromNodeId) ?? 'workflow.agent';
    const toType = typeByNode.get(edge.toNodeId) ?? 'workflow.agent';
    const link: NodeLink = {
      id: `link-${generateId()}`,
      from: {
        nodeId: edge.fromNodeId,
        socketId: outputSocketFromLegacyCondition(fromType, edge.condition),
      },
      to: {
        nodeId: edge.toNodeId,
        socketId: inputSocketForNodeType(toType),
      },
      valid: true,
    };
    tree.links[link.id] = link;
  }

  const document: NodeTreeDocument = {
    schemaVersion: 1,
    rootTreeId: tree.id,
    trees: {
      [tree.id]: tree,
    },
  };

  return {
    document,
    editor: createNodeEditorState(document),
  };
}

function legacyRoleForNode(node: NodeInstance): string {
  switch (node.type) {
    case 'workflow.task':
      return 'task';
    case 'workflow.barrier':
      return 'barrier';
    case 'workflow.frame':
      return 'frame';
    case 'workflow.reroute':
      return 'reroute';
    case 'workflow.output':
      return 'output';
    default:
      return String(node.properties.roleId ?? 'agent');
  }
}

function legacyConditionFromSocket(nodeType: string, socketId: string): WorkflowEdge['condition'] {
  if (nodeType === 'workflow.agent' && socketId === 'failure') {
    return 'on_failure';
  }
  if (nodeType === 'workflow.agent' && socketId === 'success') {
    return 'on_success';
  }
  return 'always';
}

export function nodeDocumentToWorkflowGraph(
  document: NodeTreeDocument,
  _registry: NodeTypeRegistry = createWorkflowNodeRegistry()
): WorkflowGraph {
  const tree = document.trees[document.rootTreeId];
  const nodes = Object.values(tree.nodes).map(node => {
    const workflowNode: WorkflowNode = {
      id: node.id,
      roleId: legacyRoleForNode(node),
      status: 'idle',
      config: {
        prompt: String(node.properties.prompt ?? ''),
        mode: node.properties.mode === 'edit' ? 'edit' : 'build',
        workspaceDir: String(node.properties.workspaceDir ?? ''),
        attachments: normalizeTaskAttachments(node.properties.attachments),
        instructionOverride: String(node.properties.instructionOverride ?? ''),
        terminalId: String(node.properties.terminalId ?? ''),
        terminalTitle: String(node.properties.terminalTitle ?? ''),
        paneId: String(node.properties.paneId ?? ''),
        cli:
          normalizeCliId(node.properties.cli) ?? 'claude',
        model: String(node.properties.model ?? ''),
        yolo: Boolean(node.properties.yolo),
        executionMode:
          node.properties.executionMode === 'headless' ||
          node.properties.executionMode === 'interactive_pty'
            ? node.properties.executionMode
            : 'streaming_headless',
        autoLinked: Boolean(node.properties.autoLinked),
        authoringMode:
          node.properties.authoringMode === 'preset' || node.properties.authoringMode === 'adaptive'
            ? node.properties.authoringMode
            : 'graph',
        presetId: String(node.properties.presetId ?? ''),
        runVersion:
          typeof node.properties.runVersion === 'number' && Number.isFinite(node.properties.runVersion)
            ? Math.max(1, Math.floor(node.properties.runVersion))
            : 1,
        frontendMode:
          node.properties.frontendMode === 'fast' ||
          node.properties.frontendMode === 'aligned' ||
          node.properties.frontendMode === 'strict_ui'
            ? node.properties.frontendMode
            : 'off',
        finalReadmeEnabled: Boolean(node.properties.finalReadmeEnabled),
        finalReadmeOwnerNodeId: String(node.properties.finalReadmeOwnerNodeId ?? '') || null,
        adaptiveSeed: Boolean(node.properties.adaptiveSeed),
        workflowId: String(node.properties.workflowId ?? ''),
        workflowName: String(node.properties.workflowName ?? ''),
        workflowSubMode: String(node.properties.workflowSubMode ?? ''),
        workflowMode: String(node.properties.workflowMode ?? ''),
        label: String(node.properties.label ?? node.label ?? ''),
        position: node.location,
        width: node.size?.width,
        height: node.size?.height,
        parentId: node.parentId,
      },
    };
    if (workflowNode.roleId !== 'task') {
      delete workflowNode.config?.mode;
      delete workflowNode.config?.workspaceDir;
      delete workflowNode.config?.prompt;
      delete workflowNode.config?.attachments;
    }
    if (workflowNode.roleId === 'frame' || workflowNode.roleId === 'reroute' || workflowNode.roleId === 'barrier') {
      delete workflowNode.config?.instructionOverride;
      delete workflowNode.config?.terminalId;
      delete workflowNode.config?.terminalTitle;
      delete workflowNode.config?.paneId;
      delete workflowNode.config?.cli;
      delete workflowNode.config?.model;
      delete workflowNode.config?.yolo;
      delete workflowNode.config?.executionMode;
      delete workflowNode.config?.autoLinked;
    }
    return workflowNode;
  });

  const edges = Object.values(tree.links)
    .filter(link => tree.nodes[link.from.nodeId] && tree.nodes[link.to.nodeId])
    .map(link => {
      const sourceNode = tree.nodes[link.from.nodeId];
      return {
        fromNodeId: link.from.nodeId,
        toNodeId: link.to.nodeId,
        condition: legacyConditionFromSocket(sourceNode?.type ?? 'workflow.agent', link.from.socketId),
      } satisfies WorkflowEdge;
    });

  return {
    id: tree.id,
    nodes,
    edges,
  };
}

export function nodeDocumentToFlowGraph(
  document: NodeTreeDocument,
  registry: NodeTypeRegistry = createWorkflowNodeRegistry()
): FlowGraphLike {
  const workflowGraph = nodeDocumentToWorkflowGraph(document, registry);

  return {
    nodes: workflowGraph.nodes.map(node => ({
      id: node.id,
      type: nodeTypeFromLegacy(node),
      position: node.config?.position ?? { x: 0, y: 0 },
      parentId: node.config?.parentId,
      extent: node.config?.extent,
      style: {
        width: node.config?.width,
        height: node.config?.height,
      },
      data: {
        roleId: node.roleId,
        prompt: node.config?.prompt ?? '',
        mode: node.config?.mode ?? 'build',
        workspaceDir: node.config?.workspaceDir ?? '',
        attachments: normalizeTaskAttachments(node.config?.attachments),

        instructionOverride: node.config?.instructionOverride ?? '',
        terminalId: node.config?.terminalId,
        terminalTitle: node.config?.terminalTitle,
        paneId: node.config?.paneId,
        cli: node.config?.cli ?? 'claude',
        model: node.config?.model ?? '',
        yolo: node.config?.yolo ?? false,
        executionMode: node.config?.executionMode ?? 'streaming_headless',
        autoLinked: node.config?.autoLinked,
        authoringMode: node.config?.authoringMode ?? 'graph',
        presetId: node.config?.presetId ?? '',
        runVersion: node.config?.runVersion ?? 1,
        frontendMode: node.config?.frontendMode ?? 'off',
        finalReadmeEnabled: node.config?.finalReadmeEnabled ?? false,
        finalReadmeOwnerNodeId: node.config?.finalReadmeOwnerNodeId ?? null,
        adaptiveSeed: node.config?.adaptiveSeed ?? false,
        workflowId: node.config?.workflowId ?? '',
        workflowName: node.config?.workflowName ?? '',
        workflowSubMode: node.config?.workflowSubMode ?? '',
        workflowMode: node.config?.workflowMode ?? '',
        label: node.config?.label ?? '',
      },
    })),
    edges: workflowGraph.edges.map(edge => ({
      id: `edge-${edge.fromNodeId}-${edge.condition ?? 'always'}-${edge.toNodeId}`,
      source: edge.fromNodeId,
      target: edge.toNodeId,
      label: edge.condition ?? 'always',
      data: {
        condition: edge.condition ?? 'always',
      },
    })),
  };
}

export type NodeDocumentState = {
  document: NodeTreeDocument;
  editor: NodeEditorState;
};
