import type { NodeSocketRef, NodeTreeDocument, NodeTreeId, Point2D } from './types';

export interface NodeEditorViewState {
  pan: Point2D;
  zoom: number;
}

export interface NodeEditorSelection {
  nodeIds: string[];
  linkIds: string[];
}

export interface NodeEditorState {
  treePath: NodeTreeId[];
  activeNodeId?: string;
  selection: NodeEditorSelection;
  viewByTree: Record<NodeTreeId, NodeEditorViewState>;
  pendingLinkStart?: NodeSocketRef;
}

export function createNodeEditorState(document: NodeTreeDocument): NodeEditorState {
  return {
    treePath: [document.rootTreeId],
    selection: { nodeIds: [], linkIds: [] },
    viewByTree: {
      [document.rootTreeId]: {
        pan: { x: 160, y: 96 },
        zoom: 1,
      },
    },
  };
}

export function getActiveTreeId(editor: NodeEditorState): NodeTreeId {
  return editor.treePath[editor.treePath.length - 1];
}

export function getViewState(editor: NodeEditorState): NodeEditorViewState {
  const treeId = getActiveTreeId(editor);
  return editor.viewByTree[treeId] ?? { pan: { x: 160, y: 96 }, zoom: 1 };
}

