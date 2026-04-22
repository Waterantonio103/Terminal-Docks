import type { CompiledMissionEdge } from '../store/workspace.js';

export interface ExecutionLayerNode {
  id: string;
}

export function generateId(): string {
  try {
    return crypto.randomUUID();
  } catch {
    return Math.random().toString(36).substring(2, 15) + Date.now().toString(36);
  }
}

export function deriveExecutionLayers(
  nodes: ReadonlyArray<ExecutionLayerNode>,
  edges: ReadonlyArray<Pick<CompiledMissionEdge, 'fromNodeId' | 'toNodeId'>>
): string[][] {
  if (nodes.length === 0) return [];

  const nodeIds = new Set(nodes.map(node => node.id));
  const indegree = new Map<string, number>();
  const adjacency = new Map<string, string[]>();

  for (const node of nodes) {
    indegree.set(node.id, 0);
    adjacency.set(node.id, []);
  }

  for (const edge of edges) {
    if (!nodeIds.has(edge.fromNodeId) || !nodeIds.has(edge.toNodeId)) {
      throw new Error(`Execution layer calculation received an edge with an unknown node: ${edge.fromNodeId} -> ${edge.toNodeId}`);
    }
    adjacency.get(edge.fromNodeId)?.push(edge.toNodeId);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }

  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const layers: string[][] = [];
  let frontier = nodes
    .map(node => node.id)
    .filter(id => (indegree.get(id) ?? 0) === 0)
    .sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));

  let visited = 0;

  while (frontier.length > 0) {
    layers.push(frontier);
    visited += frontier.length;

    const nextSet = new Set<string>();
    for (const id of frontier) {
      for (const targetId of adjacency.get(id) ?? []) {
        indegree.set(targetId, (indegree.get(targetId) ?? 0) - 1);
        if ((indegree.get(targetId) ?? 0) === 0) {
          nextSet.add(targetId);
        }
      }
    }

    frontier = Array.from(nextSet).sort((a, b) => (order.get(a) ?? 0) - (order.get(b) ?? 0));
  }

  if (visited !== nodes.length) {
    throw new Error('Workflow graph contains a cycle. Remove looped edges before running.');
  }

  return layers;
}
