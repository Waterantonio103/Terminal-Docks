import { generateId } from '../graphUtils';
import type { WorkflowEdge, WorkflowGraph, WorkflowNode } from '../../store/workspace';
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
  return {
    id: node.id,
    type: nodeTypeFromLegacy(node),
    label: node.config?.label ?? node.roleId,
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
      instructionOverride: node.config?.instructionOverride ?? '',
      terminalId: node.config?.terminalId ?? '',
      terminalTitle: node.config?.terminalTitle ?? '',
      paneId: node.config?.paneId ?? '',
      cli: node.config?.cli ?? 'claude',
      executionMode: node.config?.executionMode ?? 'streaming_headless',
      autoLinked: Boolean(node.config?.autoLinked),
      authoringMode: node.config?.authoringMode ?? 'graph',
      presetId: node.config?.presetId ?? '',
      runVersion: node.config?.runVersion ?? 1,
      adaptiveSeed: Boolean(node.config?.adaptiveSeed),
      label: node.config?.label ?? '',
    },
  };
}

function starterGraph(): WorkflowGraph {
  const taskId = `task-${generateId()}`;
  const agentId = `agent-${generateId()}`;
  return {
    id: 'global-editor',
    nodes: [
      {
        id: taskId,
        roleId: 'task',
        status: 'idle',
        config: {
          prompt: '',
          mode: 'build',
          workspaceDir: '',
          position: { x: 120, y: 160 },
        },
      },
      {
        id: agentId,
        roleId: 'builder',
        status: 'idle',
        config: {
          instructionOverride: '',
          position: { x: 440, y: 160 },
        },
      },
    ],
    edges: [
      {
        fromNodeId: taskId,
        toNodeId: agentId,
        condition: 'always',
      },
    ],
  };
}

export function legacyGraphToNodeDocument(graph: WorkflowGraph) {
  const source = graph.nodes.length > 0 ? graph : starterGraph();
  const tree: NodeTreeDefinition = {
    id: source.id,
    name: 'Workflow',
    kind: 'workflow',
    interface: interfaceDefinition(),
    nodes: Object.fromEntries(source.nodes.map((node, index) => [node.id, legacyNodeToDocumentNode(node, index)])),
    links: {},
  };

  const typeByNode = new Map(Object.values(tree.nodes).map(node => [node.id, node.type]));
  for (const edge of source.edges) {
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
        instructionOverride: String(node.properties.instructionOverride ?? ''),
        terminalId: String(node.properties.terminalId ?? ''),
        terminalTitle: String(node.properties.terminalTitle ?? ''),
        paneId: String(node.properties.paneId ?? ''),
        cli:
          node.properties.cli === 'gemini' ||
          node.properties.cli === 'opencode' ||
          node.properties.cli === 'codex' ||
          node.properties.cli === 'custom'
            ? node.properties.cli
            : 'claude',
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
        adaptiveSeed: Boolean(node.properties.adaptiveSeed),
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
    }
    if (workflowNode.roleId === 'frame' || workflowNode.roleId === 'reroute' || workflowNode.roleId === 'barrier') {
      delete workflowNode.config?.instructionOverride;
      delete workflowNode.config?.terminalId;
      delete workflowNode.config?.terminalTitle;
      delete workflowNode.config?.paneId;
      delete workflowNode.config?.cli;
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

        instructionOverride: node.config?.instructionOverride ?? '',
        terminalId: node.config?.terminalId,
        terminalTitle: node.config?.terminalTitle,
        paneId: node.config?.paneId,
        cli: node.config?.cli ?? 'claude',
        executionMode: node.config?.executionMode ?? 'streaming_headless',
        autoLinked: node.config?.autoLinked,
        authoringMode: node.config?.authoringMode ?? 'graph',
        presetId: node.config?.presetId ?? '',
        runVersion: node.config?.runVersion ?? 1,
        adaptiveSeed: node.config?.adaptiveSeed ?? false,
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
