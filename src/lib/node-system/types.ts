export type NodeTreeId = string;
export type NodeId = string;
export type NodeLinkId = string;
export type NodeSocketId = string;

export type NodeTreeKind = 'workflow' | 'group';
export type NodeSocketDirection = 'input' | 'output';
export type NodeSocketDataType = 'flow' | 'string' | 'path' | 'enum' | 'opaque';
export type NodeSocketDisplayShape = 'circle' | 'square' | 'diamond';

export interface Point2D {
  x: number;
  y: number;
}

export interface Size2D {
  width: number;
  height: number;
}

export interface NodeSocketRef {
  nodeId: NodeId;
  socketId: NodeSocketId;
}

export interface NodeSocketDefinition {
  id: NodeSocketId;
  identifier: string;
  name: string;
  direction: NodeSocketDirection;
  dataType: NodeSocketDataType;
  shape: NodeSocketDisplayShape;
  multiInput?: boolean;
  hidden?: boolean;
  available?: boolean;
  linkLimit?: number;
  defaultValue?: unknown;
  description?: string;
}

export interface NodeTreeInterfaceSocket {
  id: string;
  identifier: string;
  name: string;
  direction: NodeSocketDirection;
  dataType: NodeSocketDataType;
  defaultValue?: unknown;
  description?: string;
}

export interface NodeTreeInterfacePanel {
  id: string;
  name: string;
  parentId?: string;
  collapsed?: boolean;
}

export interface NodeTreeInterface {
  sockets: NodeTreeInterfaceSocket[];
  panels: NodeTreeInterfacePanel[];
}

export interface NodeInstance {
  id: NodeId;
  type: string;
  label?: string;
  location: Point2D;
  size?: Size2D;
  parentId?: string;
  properties: Record<string, unknown>;
  ui?: {
    collapsed?: boolean;
    color?: string;
  };
}

export interface NodeLink {
  id: NodeLinkId;
  from: NodeSocketRef;
  to: NodeSocketRef;
  muted?: boolean;
  hidden?: boolean;
  valid?: boolean;
}

export interface NodeTreeDefinition {
  id: NodeTreeId;
  name: string;
  kind: NodeTreeKind;
  interface: NodeTreeInterface;
  nodes: Record<NodeId, NodeInstance>;
  links: Record<NodeLinkId, NodeLink>;
}

export interface NodeTreeDocument {
  schemaVersion: number;
  rootTreeId: NodeTreeId;
  trees: Record<NodeTreeId, NodeTreeDefinition>;
}

export interface MaterializedNode {
  node: NodeInstance;
  inputs: NodeSocketDefinition[];
  outputs: NodeSocketDefinition[];
  width: number;
}

