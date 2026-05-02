import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText, appendWorkflowEvent } from '../utils/index.mjs';
import { broadcast, emitAgentEvent } from '../state.mjs';
import { randomUUID } from 'crypto';

export function registerArtifactTools(server, getSessionId) {
  server.registerTool('write_artifact', {
    title: 'Write Artifact',
    description: 'Persist an artifact (file, summary, log, or reference) to the mission database.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string().optional(),
      kind: z.enum(['file', 'summary', 'log', 'reference', 'patch', 'review_verdict']),
      title: z.string(),
      contentText: z.string().optional(),
      contentJson: z.any().optional(),
      metadataJson: z.any().optional(),
    }
  }, async ({ missionId, nodeId, kind, title, contentText, contentJson, metadataJson }) => {
    const sid = getSessionId() ?? 'unknown';
    const id = randomUUID();
    
    db.prepare(
      `INSERT INTO artifacts (id, mission_id, node_id, session_id, kind, title, content_text, content_json, metadata_json)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).run(
      id,
      missionId,
      nodeId ?? null,
      sid,
      kind,
      title,
      contentText ?? null,
      contentJson ? JSON.stringify(contentJson) : null,
      metadataJson ? JSON.stringify(metadataJson) : null
    );

    appendWorkflowEvent({
      missionId,
      nodeId,
      sessionId: sid,
      type: 'artifact_created',
      message: `Artifact "${title}" (${kind}) created.`,
      payload: { id, kind, title }
    });

    emitAgentEvent({
      type: 'agent:artifact',
      sessionId: sid,
      at: Date.now(),
      missionId,
      nodeId,
      artifactType: kind === 'file' ? 'file_change' : (kind === 'reference' ? 'reference' : 'summary'),
      label: title,
      content: contentText ?? (contentJson ? JSON.stringify(contentJson) : null),
    });

    return { content: [{ type: 'text', text: JSON.stringify({ id, status: 'created' }) }] };
  });

  server.registerTool('list_artifacts', {
    title: 'List Artifacts',
    description: 'List artifacts for a mission or node.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string().optional(),
      kind: z.string().optional(),
    }
  }, async ({ missionId, nodeId, kind }) => {
    let query = 'SELECT id, kind, title, created_at FROM artifacts WHERE mission_id = ?';
    const params = [missionId];
    if (nodeId) { query += ' AND node_id = ?'; params.push(nodeId); }
    if (kind) { query += ' AND kind = ?'; params.push(kind); }
    query += ' ORDER BY created_at DESC';
    
    const rows = db.prepare(query).all(...params);
    return { content: [{ type: 'text', text: JSON.stringify(rows) }] };
  });

  server.registerTool('read_artifact', {
    title: 'Read Artifact',
    description: 'Read the full content of an artifact.',
    inputSchema: { id: z.string() }
  }, async ({ id }) => {
    const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(id);
    if (!row) return { isError: true, content: [{ type: 'text', text: `Artifact ${id} not found.` }] };
    return { content: [{ type: 'text', text: JSON.stringify(row) }] };
  });

  server.registerTool('propose_patch', {
    title: 'Propose Patch',
    description: 'Submit a patch proposal as an artifact for review.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string(),
      title: z.string(),
      diff: z.string(),
      description: z.string().optional(),
    }
  }, async (args) => {
    // Convenience wrapper around write_artifact
    return server.callTool('write_artifact', {
      ...args,
      kind: 'patch',
      contentText: args.diff,
      metadataJson: { description: args.description }
    });
  });

  server.registerTool('submit_summary', {
    title: 'Submit Summary',
    description: 'Submit a progress or final summary for the current node.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string(),
      summary: z.string().min(1),
      isFinal: z.boolean().optional(),
    }
  }, async (args) => {
    return server.callTool('write_artifact', {
      ...args,
      kind: 'summary',
      title: args.isFinal ? 'Final Summary' : 'Progress Summary',
      contentText: args.summary,
      metadataJson: { isFinal: args.isFinal }
    });
  });

  server.registerTool('submit_review_verdict', {
    title: 'Submit Review Verdict',
    description: 'Submit a review verdict (approve/request_changes) as an artifact.',
    inputSchema: {
      missionId: z.string(),
      nodeId: z.string(),
      verdict: z.enum(['approve', 'request_changes', 'comment']),
      comment: z.string(),
      patchArtifactId: z.string().optional(),
    }
  }, async (args) => {
    return server.callTool('write_artifact', {
      ...args,
      kind: 'review_verdict',
      contentText: args.comment,
      metadataJson: { verdict: args.verdict, patchArtifactId: args.patchArtifactId }
    });
  });
}
