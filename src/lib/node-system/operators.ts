import { generateId } from '../graphUtils';
import { getActiveTreeId, type NodeEditorState } from './editor';
import { materializeNode, type NodeTypeRegistry } from './declarations';
import type { NodeInstance, NodeLink, NodeTreeDocument, Point2D } from './types';

export type NodeEditorOperator =
  | { type: 'add_node'; nodeType: string; location: Point2D }
  | { type: 'set_node_location'; nodeId: string; location: Point2D }
  | { type: 'set_node_size'; nodeId: string; width: number; height: number }
  | { type: 'set_node_property'; nodeId: string; key: string; value: unknown }
  | { type: 'delete_selection' }
  | { type: 'connect_sockets'; fromNodeId: string; fromSocketId: string; toNodeId: string; toSocketId: string }
  | { type: 'disconnect_link'; linkId: string }
  | { type: 'set_selection'; nodeIds: string[]; linkIds?: string[]; activeNodeId?: string }
  | { type: 'set_view'; pan?: Point2D; zoom?: number }
  | { type: 'begin_group_edit'; nodeId: string }
  | { type: 'end_group_edit' };

function cloneDocument(document: NodeTreeDocument): NodeTreeDocument {
  return {
    ...document,
    trees: Object.fromEntries(
      Object.entries(document.trees).map(([treeId, tree]) => [
        treeId,
        {
          ...tree,
          nodes: { ...tree.nodes },
          links: { ...tree.links },
          interface: {
            sockets: [...tree.interface.sockets],
            panels: [...tree.interface.panels],
          },
        },
      ])
    ),
  };
}

function withActiveTree(document: NodeTreeDocument, editor: NodeEditorState) {
  const treeId = getActiveTreeId(editor);
  const tree = document.trees[treeId];
  if (!tree) {
    throw new Error(`Active tree "${treeId}" could not be found.`);
  }
  return { treeId, tree };
}

function getNode(document: NodeTreeDocument, editor: NodeEditorState, nodeId: string): NodeInstance {
  const { tree } = withActiveTree(document, editor);
  const node = tree.nodes[nodeId];
  if (!node) {
    throw new Error(`Node "${nodeId}" could not be found.`);
  }
  return node;
}

function validateConnection(
  document: NodeTreeDocument,
  editor: NodeEditorState,
  registry: NodeTypeRegistry,
  fromNodeId: string,
  fromSocketId: string,
  toNodeId: string,
  toSocketId: string
) {
  const { tree } = withActiveTree(document, editor);
  const fromNode = materializeNode(document, tree, getNode(document, editor, fromNodeId), registry);
  const toNode = materializeNode(document, tree, getNode(document, editor, toNodeId), registry);
  const fromSocket = fromNode.outputs.find(socket => socket.id === fromSocketId);
  const toSocket = toNode.inputs.find(socket => socket.id === toSocketId);

  if (!fromSocket) {
    throw new Error(`Socket "${fromSocketId}" is not a valid output on node "${fromNodeId}".`);
  }
  if (!toSocket) {
    throw new Error(`Socket "${toSocketId}" is not a valid input on node "${toNodeId}".`);
  }
  if (fromSocket.dataType !== toSocket.dataType) {
    throw new Error(`Cannot connect ${fromSocket.dataType} to ${toSocket.dataType}.`);
  }

  return { fromSocket, toSocket };
}

export function applyNodeEditorOperator(
  document: NodeTreeDocument,
  editor: NodeEditorState,
  registry: NodeTypeRegistry,
  operator: NodeEditorOperator
) {
  const nextDocument = cloneDocument(document);
  const nextEditor: NodeEditorState = {
    ...editor,
    selection: {
      nodeIds: [...editor.selection.nodeIds],
      linkIds: [...editor.selection.linkIds],
    },
    treePath: [...editor.treePath],
    viewByTree: { ...editor.viewByTree },
  };
  const { treeId, tree } = withActiveTree(nextDocument, nextEditor);

  switch (operator.type) {
    case 'add_node': {
      const nodeId = generateId();
      const definition = registry.get(operator.nodeType);
      tree.nodes[nodeId] = {
        id: nodeId,
        type: operator.nodeType,
        location: operator.location,
        label: definition.label,
        properties: definition.createProperties(),
      };
      nextEditor.selection = { nodeIds: [nodeId], linkIds: [] };
      nextEditor.activeNodeId = nodeId;
      return { document: nextDocument, editor: nextEditor };
    }
    case 'set_node_location': {
      const node = getNode(nextDocument, nextEditor, operator.nodeId);
      tree.nodes[node.id] = { ...node, location: operator.location };
      return { document: nextDocument, editor: nextEditor };
    }
    case 'set_node_size': {
      const node = getNode(nextDocument, nextEditor, operator.nodeId);
      tree.nodes[node.id] = {
        ...node,
        size: {
          width: Math.max(120, operator.width),
          height: Math.max(80, operator.height),
        },
      };
      return { document: nextDocument, editor: nextEditor };
    }
    case 'set_node_property': {
      const node = getNode(nextDocument, nextEditor, operator.nodeId);
      tree.nodes[node.id] = {
        ...node,
        properties: {
          ...node.properties,
          [operator.key]: operator.value,
        },
      };
      return { document: nextDocument, editor: nextEditor };
    }
    case 'delete_selection': {
      const selectedNodes = new Set(nextEditor.selection.nodeIds);
      const selectedLinks = new Set(nextEditor.selection.linkIds);
      for (const nodeId of selectedNodes) {
        delete tree.nodes[nodeId];
      }
      for (const [linkId, link] of Object.entries(tree.links)) {
        if (
          selectedLinks.has(linkId) ||
          selectedNodes.has(link.from.nodeId) ||
          selectedNodes.has(link.to.nodeId)
        ) {
          delete tree.links[linkId];
        }
      }
      nextEditor.selection = { nodeIds: [], linkIds: [] };
      nextEditor.activeNodeId = undefined;
      return { document: nextDocument, editor: nextEditor };
    }
    case 'connect_sockets': {
      const { toSocket } = validateConnection(
        nextDocument,
        nextEditor,
        registry,
        operator.fromNodeId,
        operator.fromSocketId,
        operator.toNodeId,
        operator.toSocketId
      );

      for (const [linkId, link] of Object.entries(tree.links)) {
        const isDuplicate =
          link.from.nodeId === operator.fromNodeId &&
          link.from.socketId === operator.fromSocketId &&
          link.to.nodeId === operator.toNodeId &&
          link.to.socketId === operator.toSocketId;
        const blocksSingleInput =
          !toSocket.multiInput &&
          link.to.nodeId === operator.toNodeId &&
          link.to.socketId === operator.toSocketId;
        if (isDuplicate || blocksSingleInput) {
          delete tree.links[linkId];
        }
      }

      const link: NodeLink = {
        id: generateId(),
        from: { nodeId: operator.fromNodeId, socketId: operator.fromSocketId },
        to: { nodeId: operator.toNodeId, socketId: operator.toSocketId },
        valid: true,
      };
      tree.links[link.id] = link;
      nextEditor.selection = { nodeIds: [], linkIds: [link.id] };
      return { document: nextDocument, editor: nextEditor };
    }
    case 'disconnect_link': {
      delete tree.links[operator.linkId];
      nextEditor.selection = {
        nodeIds: nextEditor.selection.nodeIds.filter(nodeId => tree.nodes[nodeId]),
        linkIds: nextEditor.selection.linkIds.filter(linkId => linkId !== operator.linkId),
      };
      return { document: nextDocument, editor: nextEditor };
    }
    case 'set_selection': {
      nextEditor.selection = {
        nodeIds: [...operator.nodeIds],
        linkIds: [...(operator.linkIds ?? [])],
      };
      nextEditor.activeNodeId = operator.activeNodeId ?? operator.nodeIds[0];
      return { document: nextDocument, editor: nextEditor };
    }
    case 'set_view': {
      const current = nextEditor.viewByTree[treeId] ?? { pan: { x: 160, y: 96 }, zoom: 1 };
      nextEditor.viewByTree[treeId] = {
        pan: operator.pan ?? current.pan,
        zoom: operator.zoom ?? current.zoom,
      };
      return { document: nextDocument, editor: nextEditor };
    }
    case 'begin_group_edit': {
      const groupNode = getNode(nextDocument, nextEditor, operator.nodeId);
      const targetTreeId = String(groupNode.properties.treeId ?? '');
      if (!targetTreeId || !nextDocument.trees[targetTreeId]) {
        throw new Error(`Group node "${groupNode.id}" does not reference a valid child tree.`);
      }
      nextEditor.treePath.push(targetTreeId);
      nextEditor.selection = { nodeIds: [], linkIds: [] };
      nextEditor.activeNodeId = undefined;
      if (!nextEditor.viewByTree[targetTreeId]) {
        nextEditor.viewByTree[targetTreeId] = { pan: { x: 160, y: 96 }, zoom: 1 };
      }
      return { document: nextDocument, editor: nextEditor };
    }
    case 'end_group_edit': {
      if (nextEditor.treePath.length > 1) {
        nextEditor.treePath.pop();
        nextEditor.selection = { nodeIds: [], linkIds: [] };
        nextEditor.activeNodeId = undefined;
      }
      return { document: nextDocument, editor: nextEditor };
    }
  }
}
