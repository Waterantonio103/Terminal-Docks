import { randomUUID } from 'crypto';
import { existsSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { execFileSync } from 'child_process';
import { z } from 'zod';
import { db } from '../../db/index.mjs';
import { makeToolText, parseJsonSafe } from '../../utils/index.mjs';
import { extractDiffPaths, normalizeRepoPath, validateAutopatchAllowed, validatePatchScope, validatePathScope } from '../guards.mjs';
import { incrementDebugRepairAttempt } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';
import { auditBlocked, auditTool, jsonResponse, REPO_ROOT, requireDebugRun } from './shared.mjs';

const MAX_FILE_BYTES = 256_000;
const MAX_SEARCH_RESULTS = 50;
const SKIP_DIRS = new Set(['.git', 'node_modules', 'target', 'dist']);

function absoluteRepoPath(repoPath) {
  return resolve(REPO_ROOT, normalizeRepoPath(repoPath));
}

function readAllowedFile(debugRun, path) {
  const checked = validatePathScope(path, debugRun);
  if (!checked.ok) return checked;
  const absolutePath = absoluteRepoPath(checked.path);
  if (!absolutePath.startsWith(REPO_ROOT)) return { ok: false, code: 'path_escape', message: `Path escapes repo root: ${path}` };
  if (!existsSync(absolutePath)) return { ok: false, code: 'file_not_found', message: `File not found: ${checked.path}` };
  const stat = statSync(absolutePath);
  if (!stat.isFile()) return { ok: false, code: 'not_file', message: `Not a file: ${checked.path}` };
  if (stat.size > MAX_FILE_BYTES) return { ok: false, code: 'file_too_large', message: `File exceeds ${MAX_FILE_BYTES} bytes: ${checked.path}` };
  return { ok: true, path: checked.path, absolutePath, content: readFileSync(absolutePath, 'utf8') };
}

function walkFiles(dir, output = []) {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (SKIP_DIRS.has(entry.name)) continue;
    const absolute = resolve(dir, entry.name);
    if (entry.isDirectory()) {
      walkFiles(absolute, output);
    } else if (entry.isFile()) {
      output.push(absolute);
    }
    if (output.length >= 5000) break;
  }
  return output;
}

function mapPatch(row) {
  return {
    id: row.id,
    debugRunId: row.debug_run_id,
    title: row.title,
    diagnosis: row.diagnosis,
    diff: row.diff,
    filesTouched: parseJsonSafe(row.files_touched_json, []),
    expectedFix: row.expected_fix,
    testsToRun: parseJsonSafe(row.tests_to_run_json, []),
    riskLevel: row.risk_level,
    rollbackNotes: row.rollback_notes,
    status: row.status,
    appliedAt: row.applied_at,
    revert: parseJsonSafe(row.revert_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function createPatchRecord({ debugRunId, title, diagnosis, diff, filesTouched, expectedFix, testsToRun, riskLevel, rollbackNotes, status = 'created', revert = null }) {
  const id = `debug_patch_${randomUUID()}`;
  db.prepare(
    `INSERT INTO debug_patch_artifacts
       (id, debug_run_id, title, diagnosis, diff, files_touched_json, expected_fix,
        tests_to_run_json, risk_level, rollback_notes, status, revert_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    id,
    debugRunId,
    title,
    diagnosis ?? null,
    diff,
    JSON.stringify(filesTouched),
    expectedFix ?? null,
    JSON.stringify(testsToRun ?? []),
    riskLevel ?? 'medium',
    rollbackNotes ?? null,
    status,
    revert == null ? null : JSON.stringify(revert),
  );
  return id;
}

function captureRevert(paths) {
  return paths.map(path => {
    const absolutePath = absoluteRepoPath(path);
    return {
      path,
      existed: existsSync(absolutePath),
      content: existsSync(absolutePath) ? readFileSync(absolutePath, 'utf8') : null,
    };
  });
}

export function registerDebugPatchTools(server, getSessionId) {
  server.registerTool('debug_read_file', {
    title: 'Debug Read File',
    inputSchema: { debugRunId: z.string().min(1), path: z.string().min(1) },
  }, async ({ debugRunId, path }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const result = readAllowedFile(checked.debugRun, path);
    if (!result.ok) {
      auditBlocked(debugRunId, 'debug_read_file', result.message, { path });
      return makeToolText(result.message, true);
    }
    auditTool(debugRunId, 'debug_read_file', getSessionId?.(), { path: result.path });
    return jsonResponse({ path: result.path, content: result.content });
  });

  server.registerTool('debug_get_file_context', {
    title: 'Debug Get File Context',
    inputSchema: {
      debugRunId: z.string().min(1),
      path: z.string().min(1),
      line: z.number().int().positive().optional(),
      radius: z.number().int().positive().max(100).optional(),
    },
  }, async ({ debugRunId, path, line = 1, radius = 20 }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const result = readAllowedFile(checked.debugRun, path);
    if (!result.ok) return makeToolText(result.message, true);
    const lines = result.content.split(/\r?\n/);
    const start = Math.max(1, line - radius);
    const end = Math.min(lines.length, line + radius);
    const context = lines.slice(start - 1, end).map((content, index) => ({
      line: start + index,
      content,
    }));
    auditTool(debugRunId, 'debug_get_file_context', getSessionId?.(), { path: result.path, line, radius });
    return jsonResponse({ path: result.path, startLine: start, endLine: end, context });
  });

  server.registerTool('debug_search_code', {
    title: 'Debug Search Code',
    inputSchema: {
      debugRunId: z.string().min(1),
      query: z.string().min(1),
      maxResults: z.number().int().positive().max(MAX_SEARCH_RESULTS).optional(),
    },
  }, async ({ debugRunId, query, maxResults = 25 }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const results = [];
    for (const absolute of walkFiles(REPO_ROOT)) {
      const repoPath = normalizeRepoPath(absolute.slice(REPO_ROOT.length + 1));
      if (!validatePathScope(repoPath, checked.debugRun).ok) continue;
      let text = '';
      try {
        if (statSync(absolute).size > MAX_FILE_BYTES) continue;
        text = readFileSync(absolute, 'utf8');
      } catch {
        continue;
      }
      const lines = text.split(/\r?\n/);
      for (let index = 0; index < lines.length; index += 1) {
        if (lines[index].includes(query)) {
          results.push({ path: repoPath, line: index + 1, content: lines[index] });
          if (results.length >= maxResults) break;
        }
      }
      if (results.length >= maxResults) break;
    }
    auditTool(debugRunId, 'debug_search_code', getSessionId?.(), { query, resultCount: results.length });
    return jsonResponse({ query, results });
  });

  server.registerTool('debug_create_patch_proposal', {
    title: 'Debug Create Patch Proposal',
    inputSchema: {
      debugRunId: z.string().min(1),
      title: z.string().min(1),
      diagnosis: z.string().min(1),
      diff: z.string().min(1),
      filesTouched: z.array(z.string().min(1)),
      expectedFix: z.string().min(1),
      testsToRun: z.array(z.string()).optional(),
      riskLevel: z.enum(['low', 'medium', 'high']).optional(),
      rollbackNotes: z.string().optional(),
    },
  }, async (args) => {
    const checked = requireDebugRun(args.debugRunId);
    if (!checked.ok) return checked.response;
    const patchCheck = validatePatchScope(args.diff, checked.debugRun);
    if (!patchCheck.ok) {
      auditBlocked(args.debugRunId, 'debug_create_patch_proposal', patchCheck.message, { filesTouched: args.filesTouched });
      return makeToolText(patchCheck.message, true);
    }
    const declared = args.filesTouched.map(normalizeRepoPath).sort();
    const extracted = patchCheck.paths.map(normalizeRepoPath).sort();
    if (JSON.stringify(declared) !== JSON.stringify(extracted)) {
      return makeToolText(`filesTouched must match diff paths. Declared=${declared.join(', ')} Diff=${extracted.join(', ')}`, true);
    }
    const id = createPatchRecord({ ...args, filesTouched: patchCheck.paths, status: 'created' });
    auditTool(args.debugRunId, 'debug_create_patch_proposal', getSessionId?.(), { patchProposalId: id });
    writeDebugEvent(args.debugRunId, 'debug_patch_proposed', { patchProposalId: id, title: args.title, filesTouched: patchCheck.paths });
    return jsonResponse({ patchProposalId: id, status: 'created' });
  });

  server.registerTool('debug_list_patch_proposals', {
    title: 'Debug List Patch Proposals',
    inputSchema: { debugRunId: z.string().min(1) },
  }, async ({ debugRunId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const rows = db.prepare(
      `SELECT * FROM debug_patch_artifacts WHERE debug_run_id = ? ORDER BY created_at ASC`
    ).all(debugRunId).map(mapPatch);
    auditTool(debugRunId, 'debug_list_patch_proposals', getSessionId?.(), { count: rows.length });
    return jsonResponse({ proposals: rows });
  });

  server.registerTool('debug_read_patch_proposal', {
    title: 'Debug Read Patch Proposal',
    inputSchema: { debugRunId: z.string().min(1), patchProposalId: z.string().min(1) },
  }, async ({ debugRunId, patchProposalId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const row = db.prepare(`SELECT * FROM debug_patch_artifacts WHERE id = ? AND debug_run_id = ?`).get(patchProposalId, debugRunId);
    if (!row) return makeToolText(`Patch proposal not found: ${patchProposalId}`, true);
    auditTool(debugRunId, 'debug_read_patch_proposal', getSessionId?.(), { patchProposalId });
    return jsonResponse({ proposal: mapPatch(row) });
  });

  server.registerTool('debug_apply_patch', {
    title: 'Debug Apply Patch',
    inputSchema: {
      debugRunId: z.string().min(1),
      diff: z.string().min(1),
      reason: z.string().min(1),
    },
  }, async ({ debugRunId, diff, reason }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const modeCheck = validateAutopatchAllowed(checked.debugRun);
    if (!modeCheck.ok) {
      auditBlocked(debugRunId, 'debug_apply_patch', modeCheck.message);
      return makeToolText(modeCheck.message, true);
    }
    const patchCheck = validatePatchScope(diff, checked.debugRun);
    if (!patchCheck.ok) {
      auditBlocked(debugRunId, 'debug_apply_patch', patchCheck.message);
      return makeToolText(patchCheck.message, true);
    }
    const revert = captureRevert(patchCheck.paths);
    try {
      execFileSync('git', ['apply', '--check', '--whitespace=nowarn', '-'], { cwd: REPO_ROOT, input: diff, encoding: 'utf8' });
      execFileSync('git', ['apply', '--whitespace=nowarn', '-'], { cwd: REPO_ROOT, input: diff, encoding: 'utf8' });
    } catch (error) {
      return makeToolText(`Patch failed: ${error.stderr || error.message}`, true);
    }
    const patchId = createPatchRecord({
      debugRunId,
      title: reason,
      diagnosis: reason,
      diff,
      filesTouched: patchCheck.paths,
      expectedFix: reason,
      testsToRun: [],
      riskLevel: 'medium',
      rollbackNotes: 'Use debug_revert_patch with this patchId to restore captured file contents.',
      status: 'applied',
      revert,
    });
    db.prepare(`UPDATE debug_patch_artifacts SET applied_at = CURRENT_TIMESTAMP WHERE id = ?`).run(patchId);
    incrementDebugRepairAttempt(debugRunId, patchCheck.paths);
    auditTool(debugRunId, 'debug_apply_patch', getSessionId?.(), { patchId, filesTouched: patchCheck.paths });
    writeDebugEvent(debugRunId, 'debug_patch_applied', { patchId, filesTouched: patchCheck.paths, reason });
    return jsonResponse({ applied: true, changedFiles: patchCheck.paths, patchId });
  });

  server.registerTool('debug_revert_patch', {
    title: 'Debug Revert Patch',
    inputSchema: { debugRunId: z.string().min(1), patchId: z.string().min(1) },
  }, async ({ debugRunId, patchId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const row = db.prepare(`SELECT * FROM debug_patch_artifacts WHERE id = ? AND debug_run_id = ?`).get(patchId, debugRunId);
    if (!row) return makeToolText(`Applied patch not found: ${patchId}`, true);
    const revert = parseJsonSafe(row.revert_json, null);
    if (!Array.isArray(revert)) return makeToolText(`Patch ${patchId} does not include revert metadata.`, true);
    for (const file of revert) {
      const checkedPath = validatePathScope(file.path, checked.debugRun);
      if (!checkedPath.ok) return makeToolText(checkedPath.message, true);
      if (file.existed) {
        const absolutePath = absoluteRepoPath(file.path);
        writeFileSync(absolutePath, file.content ?? '', 'utf8');
      } else {
        const absolutePath = absoluteRepoPath(file.path);
        if (existsSync(absolutePath)) rmSync(absolutePath, { force: true });
      }
    }
    db.prepare(`UPDATE debug_patch_artifacts SET status = 'reverted', updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(patchId);
    auditTool(debugRunId, 'debug_revert_patch', getSessionId?.(), { patchId });
    writeDebugEvent(debugRunId, 'debug_patch_reverted', { patchId });
    return jsonResponse({ reverted: true, patchId });
  });
}
