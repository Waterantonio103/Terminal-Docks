import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText, appendWorkflowEvent, parseJsonSafe } from '../utils/index.mjs';
import { broadcast, emitAgentEvent } from '../state.mjs';
import { loadCompiledMissionRecord, getMissionNode, getMissionNodeRuntime, allowedOutcomesForCondition } from '../utils/workflow.mjs';
import { executeHandoffTask, executeCompleteTask } from './handoff-complete.mjs';

export function registerWorkflowTools(server, getSessionId) {
  server.registerTool('handoff_task', {
    title: 'Handoff Task',
    inputSchema: {
      fromRole: z.string().optional(),
      targetRole: z.string().optional(),
      title: z.string().min(1),
      description: z.string().optional(),
      payload: z.any().optional(),
      completion: z.object({
        status: z.enum(['success', 'failure']).optional(),
        summary: z.string().optional(),
        artifactReferences: z.array(z.string()).optional(),
        filesChanged: z.array(z.string()).optional(),
        keyFindings: z.array(z.string()).optional(),
        downstreamPayload: z.any().optional(),
      }).optional(),
      parentTaskId: z.number().int().optional(),
      missionId: z.string().optional(),
      fromNodeId: z.string().optional(),
      fromAttempt: z.number().int().positive().optional(),
      targetNodeId: z.string().optional(),
      outcome: z.enum(['success', 'failure']).optional(),
    }
  }, async (args) => executeHandoffTask(args, getSessionId() ?? 'unknown'));

  server.registerTool('complete_task', {
    title: 'Complete Task',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string(),
      attempt: z.number().int().positive(),
      outcome: z.enum(['success', 'failure']),
      title: z.string().optional(),
      summary: z.string().optional(),
      rawOutput: z.string().optional(),
      logRef: z.string().optional(),
      filesChanged: z.array(z.string()).optional(),
      artifactReferences: z.array(z.string()).optional(),
      keyFindings: z.array(z.string()).optional(),
      downstreamPayload: z.any().optional(),
      parentTaskId: z.number().int().optional(),
    }
  }, async (args) => executeCompleteTask(args, getSessionId() ?? 'unknown'));

  server.registerTool('request_retry', {
    title: 'Request Retry',
    inputSchema: { missionId: z.string(), nodeId: z.string(), reason: z.string().min(1) }
  }, async ({ missionId, nodeId, reason }) => {
    const sid = getSessionId() ?? 'unknown';
    appendWorkflowEvent({ missionId, nodeId, sessionId: sid, type: 'retry_requested', message: `Retry requested for ${nodeId}: ${reason}` });
    return { content: [{ type: 'text', text: 'Retry request submitted.' }] };
  });

  server.registerTool('submit_adaptive_patch', {
    title: 'Submit Adaptive Patch',
    inputSchema: {
      missionId: z.string(),
      runVersion: z.number().int(),
      patch: z.object({
        nodes: z.array(z.any()).default([]),
        edges: z.array(z.any()).default([]),
      }),
    }
  }, async ({ missionId, runVersion, patch }) => {
    const record = loadCompiledMissionRecord(missionId);
    if (!record) return { isError: true, content: [{ type: 'text', text: 'Mission not found.' }] };
    
    const mission = record.mission;
    mission.nodes.push(...(patch.nodes || []));
    mission.edges.push(...(patch.edges || []));
    mission.metadata = mission.metadata || {};
    mission.metadata.runVersion = (mission.metadata.runVersion || 1) + 1;

    db.prepare('UPDATE compiled_missions SET mission_json = ?, updated_at = CURRENT_TIMESTAMP WHERE mission_id = ?')
      .run(JSON.stringify(mission), missionId);

    broadcast('adaptive', JSON.stringify({ missionId, runVersion: mission.metadata.runVersion }), 'adaptive_patch');
    return { content: [{ type: 'text', text: `Patch applied. New version: ${mission.metadata.runVersion}` }] };
  });

  server.registerTool('get_workflow_graph', {
    title: 'Get Workflow Graph',
    inputSchema: { missionId: z.string().optional() }
  }, async ({ missionId }) => {
    if (!missionId) return { content: [{ type: 'text', text: 'No missionId provided.' }] };
    const record = loadCompiledMissionRecord(missionId);
    if (!record) return { isError: true, content: [{ type: 'text', text: 'Mission not found.' }] };
    return { content: [{ type: 'text', text: JSON.stringify(record.mission, null, 2) }] };
  });
}
