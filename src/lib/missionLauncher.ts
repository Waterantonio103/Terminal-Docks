import { invoke } from '@tauri-apps/api/core';
import agentsConfig from '../config/agents';
import { buildLaunchPrompt, type LaunchContext, type LaunchOutgoingTarget } from './buildPrompt';
import type { CompiledMission, Pane } from '../store/workspace';

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

export async function stageMissionPrompts(
  mission: CompiledMission,
  workspaceDir: string | null,
  panes: Pane[],
): Promise<void> {
  const panesByTerminalId = new Map(
    panes
      .filter(p => Boolean(p.data?.terminalId))
      .map(p => [p.data?.terminalId as string, p]),
  );

  const countByRole = new Map<string, number>();
  for (const node of mission.nodes) {
    countByRole.set(node.roleId, (countByRole.get(node.roleId) ?? 0) + 1);
  }

  const usedByRole = new Map<string, number>();
  for (const node of mission.nodes) {
    // Non-interactive nodes are activated headlessly by MissionControl — no PTY write needed.
    if (node.terminal.executionMode !== 'interactive_pty') continue;

    const pane = panesByTerminalId.get(node.terminal.terminalId);
    if (!pane) continue; // MissionControl will launch Claude into the terminal itself

    const currentRoleIndex = (usedByRole.get(node.roleId) ?? 0) + 1;
    usedByRole.set(node.roleId, currentRoleIndex);

    const ctx: LaunchContext = {
      workspaceDir,
      missionId: mission.missionId,
      nodeId: node.id,
      attempt: 1,
      allowedOutgoingTargets: getAllowedOutgoingTargets(mission, node.id),
      authoringMode: mission.metadata.authoringMode,
      presetId: mission.metadata.presetId,
      runVersion: mission.metadata.runVersion,
      instanceNum: currentRoleIndex,
      totalInstances: countByRole.get(node.roleId) ?? 1,
      task: mission.task.prompt,
      mode: mission.task.mode,
    };

    const prompt = buildLaunchPrompt(node.roleId, ctx, node.instructionOverride || undefined);
    if (prompt) {
      const terminalId = pane.data?.terminalId ?? `term-${pane.id}`;
      await invoke('write_to_pty', { id: terminalId, data: prompt });
    }
  }
}
