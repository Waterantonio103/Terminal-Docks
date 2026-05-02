import { db } from '../db/index.mjs';
import { parseJsonSafe } from './index.mjs';

export function loadCompiledMissionRecord(missionId) {
  const row = db.prepare(
    "SELECT mission_id, graph_id, mission_json, status, datetime(created_at, 'localtime') AS created_at, datetime(updated_at, 'localtime') AS updated_at FROM compiled_missions WHERE mission_id = ?"
  ).get(missionId);
  if (!row) return null;

  const mission = parseJsonSafe(row.mission_json);
  if (!mission) return null;

  return {
    missionId: row.mission_id,
    graphId: row.graph_id,
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    mission,
  };
}

export function getMissionNode(mission, nodeId) {
  return mission?.nodes?.find(node => node.id === nodeId) ?? null;
}

export function getMissionNodeRuntime(missionId, nodeId) {
  return db.prepare(
    "SELECT mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome, last_payload, datetime(updated_at, 'localtime') AS updated_at FROM mission_node_runtime WHERE mission_id = ? AND node_id = ?"
  ).get(missionId, nodeId) ?? null;
}

export function getRuntimeSessionByAttempt(missionId, nodeId, attempt) {
  return db.prepare(
    "SELECT session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, datetime(created_at, 'localtime') AS created_at, datetime(updated_at, 'localtime') AS updated_at FROM agent_runtime_sessions WHERE mission_id = ? AND node_id = ? AND attempt = ? ORDER BY updated_at DESC LIMIT 1"
  ).get(missionId, nodeId, attempt) ?? null;
}

export function allowedOutcomesForCondition(condition) {
  if (condition === 'on_success') return ['success'];
  if (condition === 'on_failure') return ['failure'];
  return ['success', 'failure'];
}

export function getLegalOutgoingTargets(mission, fromNodeId) {
  const nodeById = new Map((mission?.nodes ?? []).map(node => [node.id, node]));

  return (mission?.edges ?? [])
    .filter(edge => edge.fromNodeId === fromNodeId)
    .map(edge => {
      const targetNode = nodeById.get(edge.toNodeId) ?? null;
      return {
        targetNodeId: edge.toNodeId,
        targetRoleId: targetNode?.roleId ?? null,
        condition: edge.condition,
        allowedOutcomes: allowedOutcomesForCondition(edge.condition),
      };
    });
}
