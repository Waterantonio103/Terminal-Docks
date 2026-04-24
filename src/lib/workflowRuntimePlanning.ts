import type { CompiledMission, CompiledMissionEdge, CompiledMissionNode } from '../store/workspace.js';

export type NodeOutcome = 'success' | 'failure';

function matchesOutcome(edge: CompiledMissionEdge, outcome: NodeOutcome): boolean {
  if (edge.condition === 'always') return true;
  if (edge.condition === 'on_success') return outcome === 'success';
  if (edge.condition === 'on_failure') return outcome === 'failure';
  return false;
}

/**
 * Compute the downstream agent nodes that should run when `fromNodeId`
 * finishes with a given outcome (success/failure). Pure; no IO.
 */
export function resolveNextNodes(
  mission: CompiledMission,
  fromNodeId: string,
  outcome: NodeOutcome,
): CompiledMissionNode[] {
  const nodeById = new Map(mission.nodes.map((node: CompiledMissionNode) => [node.id, node] as const));
  const targets: CompiledMissionNode[] = [];
  for (const edge of mission.edges) {
    if (edge.fromNodeId !== fromNodeId) continue;
    if (!matchesOutcome(edge, outcome)) continue;
    const target = nodeById.get(edge.toNodeId);
    if (target) targets.push(target);
  }
  return targets;
}
