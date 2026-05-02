import { randomUUID } from 'crypto';
import { db } from '../db/index.mjs';
import { parseJsonSafe } from '../utils/index.mjs';
import { buildGuardrails } from './guards.mjs';
import { writeDebugEvent } from './audit.mjs';

export function createDebugRun(input = {}) {
  const suiteName = String(input.suiteName || '').trim();
  if (!suiteName) {
    return { ok: false, code: 'missing_suite_name', message: 'suiteName is required.' };
  }

  const guardrails = buildGuardrails(input);
  const id = `debug_${randomUUID()}`;

  db.prepare(
    `INSERT INTO debug_runs (
       id,
       suite_name,
       autonomy_mode,
       require_confirmation,
       status,
       max_repair_attempts,
       repair_attempt,
       max_files_changed,
       max_patch_bytes,
       max_command_runtime_ms,
       allowed_paths_json,
       blocked_paths_json,
       allowed_commands_json,
       mission_ids_json,
       changed_files_json,
       created_at,
       updated_at
     ) VALUES (?, ?, ?, ?, 'created', ?, 0, ?, ?, ?, ?, ?, ?, '[]', '[]', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(
    id,
    suiteName,
    guardrails.autonomyMode,
    guardrails.requireConfirmation ? 1 : 0,
    guardrails.maxRepairAttempts,
    guardrails.maxFilesChanged,
    guardrails.maxPatchBytes,
    guardrails.maxCommandRuntimeMs,
    JSON.stringify(guardrails.allowedPaths),
    JSON.stringify(guardrails.blockedPaths),
    JSON.stringify(guardrails.allowedCommands),
  );

  writeDebugEvent(id, 'debug_run_started', {
    suiteName,
    autonomyMode: guardrails.autonomyMode,
    requireConfirmation: guardrails.requireConfirmation,
  });

  return {
    ok: true,
    debugRun: getDebugRun(id),
    guardrails,
  };
}

export function getDebugRun(id) {
  if (!id) return null;
  const row = db.prepare('SELECT * FROM debug_runs WHERE id = ?').get(id);
  return row ? hydrateDebugRun(row) : null;
}

export function updateDebugRunStatus(id, status, patch = {}) {
  const existing = getDebugRun(id);
  if (!existing) return null;

  const nextMissionIds = Array.isArray(patch.missionIds) ? patch.missionIds : existing.missionIds;
  const nextChangedFiles = Array.isArray(patch.changedFiles) ? patch.changedFiles : existing.changedFiles;

  db.prepare(
    `UPDATE debug_runs
        SET status = ?,
            mission_ids_json = ?,
            changed_files_json = ?,
            report_artifact_id = COALESCE(?, report_artifact_id),
            last_failure = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`
  ).run(
    status ?? existing.status,
    JSON.stringify(nextMissionIds),
    JSON.stringify(nextChangedFiles),
    patch.reportArtifactId ?? null,
    patch.lastFailure ?? existing.lastFailure ?? null,
    id,
  );

  return getDebugRun(id);
}

export function incrementDebugRepairAttempt(id, changedFiles = []) {
  const existing = getDebugRun(id);
  if (!existing) return null;
  const mergedChangedFiles = Array.from(new Set([...existing.changedFiles, ...changedFiles]));
  db.prepare(
    `UPDATE debug_runs
        SET repair_attempt = repair_attempt + 1,
            changed_files_json = ?,
            updated_at = CURRENT_TIMESTAMP
      WHERE id = ?`
  ).run(JSON.stringify(mergedChangedFiles), id);
  return getDebugRun(id);
}

export function createDebugTestResult({
  debugRunId,
  suiteName = null,
  testName,
  status,
  failureCategory = null,
  notes = null,
  evidence = null,
  command = null,
  stdout = null,
  stderr = null,
  exitCode = null,
  durationMs = null,
}) {
  const id = `debug_result_${randomUUID()}`;
  db.prepare(
    `INSERT INTO debug_test_results
       (id, debug_run_id, suite_name, test_name, status, failure_category, notes, evidence_json,
        command, stdout, stderr, exit_code, duration_ms, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
  ).run(
    id,
    debugRunId,
    suiteName,
    testName,
    status,
    failureCategory,
    notes,
    evidence == null ? null : JSON.stringify(evidence),
    command,
    stdout,
    stderr,
    exitCode,
    durationMs,
  );
  return id;
}

export function listDebugTestResults(debugRunId) {
  return db.prepare(
    `SELECT id, debug_run_id, suite_name, test_name, status, failure_category, notes, evidence_json,
            command, stdout, stderr, exit_code, duration_ms, created_at
       FROM debug_test_results
      WHERE debug_run_id = ?
      ORDER BY created_at ASC, id ASC`
  ).all(debugRunId).map(row => ({
    id: row.id,
    debugRunId: row.debug_run_id,
    suiteName: row.suite_name,
    testName: row.test_name,
    status: row.status,
    failureCategory: row.failure_category,
    notes: row.notes,
    evidence: parseJsonSafe(row.evidence_json, null),
    command: row.command,
    stdout: row.stdout,
    stderr: row.stderr,
    exitCode: row.exit_code,
    durationMs: row.duration_ms,
    createdAt: row.created_at,
  }));
}

export function getLatestDebugReport(debugRunId) {
  const row = db.prepare(
    `SELECT id, debug_run_id, status, title, content_text, file_path, bundle_json, created_at, updated_at
       FROM debug_reports
      WHERE debug_run_id = ?
      ORDER BY created_at DESC
      LIMIT 1`
  ).get(debugRunId);
  return row ? {
    id: row.id,
    debugRunId: row.debug_run_id,
    status: row.status,
    title: row.title,
    contentText: row.content_text,
    filePath: row.file_path,
    bundle: parseJsonSafe(row.bundle_json, null),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  } : null;
}

export function addDebugRunMission(debugRunId, missionId) {
  const debugRun = getDebugRun(debugRunId);
  if (!debugRun) return null;
  const missionIds = Array.from(new Set([...debugRun.missionIds, missionId]));
  return updateDebugRunStatus(debugRunId, debugRun.status, { missionIds });
}

export function clearDebugRunMissions(debugRunId) {
  const debugRun = getDebugRun(debugRunId);
  if (!debugRun) return null;
  return updateDebugRunStatus(debugRunId, debugRun.status, { missionIds: [] });
}

export function listDebugEvents(debugRunId, limit = 50) {
  const safeLimit = Number.isInteger(limit) && limit > 0 && limit <= 500 ? limit : 50;
  return db.prepare(
    `SELECT id, debug_run_id, event_type, payload_json, created_at
     FROM debug_events
     WHERE debug_run_id = ?
     ORDER BY id DESC
     LIMIT ?`
  ).all(debugRunId, safeLimit).map(row => ({
    id: row.id,
    debugRunId: row.debug_run_id,
    eventType: row.event_type,
    payload: parseJsonSafe(row.payload_json, null),
    createdAt: row.created_at,
  })).reverse();
}

function hydrateDebugRun(row) {
  return {
    id: row.id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    status: row.status,
    suiteName: row.suite_name,
    autonomyMode: row.autonomy_mode,
    requireConfirmation: Boolean(row.require_confirmation),
    maxRepairAttempts: row.max_repair_attempts,
    repairAttempt: row.repair_attempt,
    maxFilesChanged: row.max_files_changed,
    maxPatchBytes: row.max_patch_bytes,
    maxCommandRuntimeMs: row.max_command_runtime_ms,
    allowedPaths: parseJsonSafe(row.allowed_paths_json, []),
    blockedPaths: parseJsonSafe(row.blocked_paths_json, []),
    allowedCommands: parseJsonSafe(row.allowed_commands_json, []),
    missionIds: parseJsonSafe(row.mission_ids_json, []),
    changedFiles: parseJsonSafe(row.changed_files_json, []),
    reportArtifactId: row.report_artifact_id,
    lastFailure: row.last_failure,
  };
}
