import { randomUUID } from 'crypto';
import { mkdirSync, writeFileSync } from 'fs';
import { resolve } from 'path';
import { z } from 'zod';
import { db } from '../../db/index.mjs';
import { parseJsonSafe } from '../../utils/index.mjs';
import { getLatestDebugReport, listDebugEvents, listDebugTestResults, updateDebugRunStatus } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';
import { auditTool, jsonResponse, REPO_ROOT, requireDebugRun } from './shared.mjs';

function section(title, value) {
  if (value == null || value === '') return `## ${title}\n\nNone.\n`;
  if (Array.isArray(value)) {
    if (!value.length) return `## ${title}\n\nNone.\n`;
    return `## ${title}\n\n${value.map(item => `- ${typeof item === 'string' ? item : JSON.stringify(item)}`).join('\n')}\n`;
  }
  if (typeof value === 'object') return `## ${title}\n\n\`\`\`json\n${JSON.stringify(value, null, 2)}\n\`\`\`\n`;
  return `## ${title}\n\n${value}\n`;
}

function buildReportMarkdown({ debugRun, testsRun, failureTimeline, evidence, diagnosis, patches, verification, remainingIssues, nextRecommendedAction, finalStatus }) {
  const tests = testsRun?.length
    ? `| Test | Status | Notes |\n|---|---|---|\n${testsRun.map(test => `| ${test.testName ?? test.name ?? 'test'} | ${test.status ?? 'unknown'} | ${String(test.notes ?? '').replaceAll('|', '\\|')} |`).join('\n')}`
    : 'No tests recorded.';
  return [
    '# Debug Run Report',
    '',
    '## Summary',
    `- Debug Run ID: ${debugRun.id}`,
    `- Suite: ${debugRun.suiteName}`,
    `- Mode: ${debugRun.autonomyMode}`,
    `- Final Status: ${finalStatus}`,
    '',
    '## Tests Run',
    tests,
    '',
    section('Failure Timeline', failureTimeline),
    section('Evidence', evidence),
    section('Diagnosis', diagnosis),
    section('Patches', patches),
    section('Verification', verification),
    section('Remaining Issues', remainingIssues),
    section('Next Recommended Action', nextRecommendedAction),
  ].join('\n');
}

function saveReport({ debugRun, title, status, contentText, bundle }) {
  const id = `debug_report_${randomUUID()}`;
  const reportsDir = resolve(REPO_ROOT, 'docs/debug-reports');
  mkdirSync(reportsDir, { recursive: true });
  const filePath = resolve(reportsDir, `${debugRun.id}.md`);
  writeFileSync(filePath, contentText, 'utf8');
  const repoPath = `docs/debug-reports/${debugRun.id}.md`;
  db.prepare(
    `INSERT INTO debug_reports
       (id, debug_run_id, status, title, content_text, file_path, bundle_json, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)`
  ).run(id, debugRun.id, status, title, contentText, repoPath, bundle == null ? null : JSON.stringify(bundle));
  updateDebugRunStatus(debugRun.id, status, { reportArtifactId: id });
  writeDebugEvent(debugRun.id, 'debug_report_written', { reportId: id, filePath: repoPath, status });
  if (['completed', 'failed', 'blocked', 'cancelled'].includes(status)) {
    writeDebugEvent(debugRun.id, 'debug_run_completed', { status, reportId: id });
  }
  return { id, filePath: repoPath };
}

export function registerDebugReportTools(server, getSessionId) {
  server.registerTool('debug_write_report', {
    title: 'Debug Write Report',
    inputSchema: {
      debugRunId: z.string().min(1),
      title: z.string().optional(),
      finalStatus: z.enum(['completed', 'failed', 'blocked', 'cancelled']).optional(),
      testsRun: z.array(z.any()).optional(),
      failureTimeline: z.any().optional(),
      evidence: z.any().optional(),
      diagnosis: z.any().optional(),
      patches: z.any().optional(),
      verification: z.any().optional(),
      remainingIssues: z.any().optional(),
      nextRecommendedAction: z.any().optional(),
    },
  }, async (args) => {
    const checked = requireDebugRun(args.debugRunId);
    if (!checked.ok) return checked.response;
    const testsRun = args.testsRun ?? listDebugTestResults(args.debugRunId);
    const finalStatus = args.finalStatus ?? (testsRun.some(test => test.status === 'failed') ? 'failed' : 'completed');
    const bundle = {
      debugRun: checked.debugRun,
      testsRun,
      events: listDebugEvents(args.debugRunId, 500),
      evidence: args.evidence ?? null,
      patches: args.patches ?? null,
      verification: args.verification ?? null,
    };
    const contentText = buildReportMarkdown({ ...args, debugRun: checked.debugRun, testsRun, finalStatus });
    const report = saveReport({
      debugRun: checked.debugRun,
      title: args.title ?? `Debug Run ${checked.debugRun.id}`,
      status: finalStatus,
      contentText,
      bundle,
    });
    auditTool(args.debugRunId, 'debug_write_report', getSessionId?.(), { reportId: report.id });
    return jsonResponse({ reportId: report.id, status: finalStatus, filePath: report.filePath });
  });

  server.registerTool('debug_get_report', {
    title: 'Debug Get Report',
    inputSchema: { debugRunId: z.string().min(1), reportId: z.string().optional() },
  }, async ({ debugRunId, reportId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const report = reportId
      ? db.prepare(`SELECT * FROM debug_reports WHERE id = ? AND debug_run_id = ?`).get(reportId, debugRunId)
      : getLatestDebugReport(debugRunId);
    if (!report) return jsonResponse({ report: null });
    auditTool(debugRunId, 'debug_get_report', getSessionId?.(), { reportId: reportId ?? report.id });
    if (report.contentText) return jsonResponse({ report });
    return jsonResponse({
      report: {
        id: report.id,
        debugRunId: report.debug_run_id,
        status: report.status,
        title: report.title,
        contentText: report.content_text,
        filePath: report.file_path,
        bundle: parseJsonSafe(report.bundle_json, null),
        createdAt: report.created_at,
        updatedAt: report.updated_at,
      },
    });
  });

  server.registerTool('debug_export_diagnostics_bundle', {
    title: 'Debug Export Diagnostics Bundle',
    inputSchema: { debugRunId: z.string().min(1) },
  }, async ({ debugRunId }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const bundle = {
      debugRun: checked.debugRun,
      events: listDebugEvents(debugRunId, 500),
      testResults: listDebugTestResults(debugRunId),
      reports: db.prepare(`SELECT id, status, title, file_path, created_at FROM debug_reports WHERE debug_run_id = ? ORDER BY created_at ASC`).all(debugRunId),
      patchArtifacts: db.prepare(`SELECT id, title, files_touched_json, status, created_at, updated_at FROM debug_patch_artifacts WHERE debug_run_id = ? ORDER BY created_at ASC`).all(debugRunId)
        .map(row => ({ ...row, filesTouched: parseJsonSafe(row.files_touched_json, []) })),
    };
    const id = `debug_bundle_${randomUUID()}`;
    const reportsDir = resolve(REPO_ROOT, 'docs/debug-reports');
    mkdirSync(reportsDir, { recursive: true });
    const filePath = resolve(reportsDir, `${debugRunId}-bundle.json`);
    writeFileSync(filePath, JSON.stringify(bundle, null, 2), 'utf8');
    auditTool(debugRunId, 'debug_export_diagnostics_bundle', getSessionId?.(), { bundleId: id });
    return jsonResponse({ bundleId: id, filePath: `docs/debug-reports/${debugRunId}-bundle.json`, bundle });
  });
}
