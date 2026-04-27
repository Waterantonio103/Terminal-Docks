import agentsConfig from '../config/agents';
import type { CompiledMission } from '../store/workspace';
import type { LaunchOutgoingTarget } from './buildPrompt';

/**
 * missionLauncher.ts — Helper for resolving mission-related metadata.
 *
 * NOTE: stageMissionPrompts() has been removed as RuntimeManager is now the
 * single owner of runtime launch and prompt injection.
 */

export function getAllowedOutgoingTargets(mission: CompiledMission, nodeId: string): LaunchOutgoingTarget[] {
  const nodeById = new Map(mission.nodes.map(node => [node.id, node]));
  return mission.edges
    .filter(edge => edge.fromNodeId === nodeId)
    .map(edge => {
      const targetNode = nodeById.get(edge.toNodeId);
      const targetRoleId = targetNode?.roleId ?? 'unknown';
      const targetRoleName =
        (agentsConfig.agents as Array<{ id: string; name: string }>).find(a => a.id === targetRoleId)?.name ?? targetRoleId;
      return {
        targetNodeId: edge.toNodeId,
        targetRoleId,
        targetRoleName,
        condition: edge.condition,
      } satisfies LaunchOutgoingTarget;
    });
}
