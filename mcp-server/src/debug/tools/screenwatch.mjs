import { execFile } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { promisify } from 'node:util';
import { z } from 'zod';
import { writeDebugEvent } from '../audit.mjs';
import { auditTool, jsonResponse, REPO_ROOT, requireDebugRun } from './shared.mjs';
import { makeToolText, parseJsonSafe } from '../../utils/index.mjs';

const execFileAsync = promisify(execFile);
const DEFAULT_SCREENSHOT_ROOT = resolve(REPO_ROOT, '.tmp-tests/debug-screenshots');
const DEFAULT_SCREENWATCH_ROOT = resolve(REPO_ROOT, '.tmp-tests/ui-screenwatch');
const DEBUG_TMP_ROOT = resolve(REPO_ROOT, '.tmp-tests');
const MAX_JSON_BYTES = 1_000_000;

function safeSlug(value, fallback = 'capture') {
  const slug = String(value ?? '').trim().replace(/[^a-z0-9_-]+/gi, '-').replace(/^-+|-+$/g, '').toLowerCase();
  return slug || fallback;
}

function resolveUnderRepo(pathValue, fallbackRoot) {
  const absolute = isAbsolute(pathValue ?? '') ? resolve(pathValue) : resolve(REPO_ROOT, pathValue || fallbackRoot);
  const rel = relative(REPO_ROOT, absolute);
  if (rel.startsWith('..') || isAbsolute(rel)) {
    throw new Error(`Path is outside repository: ${pathValue}`);
  }
  return absolute;
}

function ensureDir(pathValue) {
  mkdirSync(pathValue, { recursive: true });
  return pathValue;
}

function toRepoPath(pathValue) {
  return relative(REPO_ROOT, pathValue).replace(/\\/g, '/');
}

function walkJsonFiles(root, limit, out = []) {
  if (!existsSync(root) || out.length >= limit) return out;
  for (const entry of readdirSync(root, { withFileTypes: true })) {
    if (out.length >= limit) break;
    const fullPath = join(root, entry.name);
    if (entry.isDirectory()) {
      walkJsonFiles(fullPath, limit, out);
    } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.json')) {
      out.push(fullPath);
    }
  }
  return out;
}

function readSnapshotSummary(pathValue) {
  const stat = statSync(pathValue);
  if (stat.size > MAX_JSON_BYTES) {
    return {
      path: toRepoPath(pathValue),
      bytes: stat.size,
      skipped: 'file_too_large',
    };
  }
  const parsed = parseJsonSafe(readFileSync(pathValue, 'utf8'), null);
  return {
    path: toRepoPath(pathValue),
    bytes: stat.size,
    capturedAt: parsed?.capturedAt ?? null,
    label: parsed?.label ?? null,
    missionId: parsed?.missionId ?? null,
    issues: Array.isArray(parsed?.issues) ? parsed.issues : [],
    terminalCount: Array.isArray(parsed?.terminals) ? parsed.terminals.length : 0,
  };
}

async function captureWindowsAppWindow(outputPath, { targetWindowTitle, processName, allowTitleFallback }) {
  const escapedOutput = outputPath.replace(/'/g, "''");
  const escapedTitle = String(targetWindowTitle || 'CometAI').replace(/'/g, "''");
  const escapedProcess = String(processName || '').replace(/'/g, "''");
  const fallbackLiteral = allowTitleFallback ? '$true' : '$false';
  const script = [
    'Add-Type -AssemblyName System.Windows.Forms',
    'Add-Type -AssemblyName System.Drawing',
    '$title = \'' + escapedTitle + '\'',
    '$processName = \'' + escapedProcess + '\'',
    `$allowTitleFallback = ${fallbackLiteral}`,
    '$candidates = Get-Process | Where-Object { $_.MainWindowHandle -ne 0 }',
    'if ($processName) { $candidates = $candidates | Where-Object { $_.ProcessName -ieq $processName } }',
    'if ($title) {',
    '  $titleMatches = $candidates | Where-Object { $_.MainWindowTitle -like "*$title*" }',
    '  if ($titleMatches) { $candidates = $titleMatches }',
    '  elseif (-not $allowTitleFallback) { throw "No visible app window matched requested title $title. Refusing fallback capture." }',
    '}',
    '$window = $candidates | Sort-Object @{ Expression = { if ($_.MainWindowTitle -eq $title) { 0 } elseif ($_.MainWindowTitle -like "*$title*") { 1 } else { 2 } } }, Id | Select-Object -First 1',
    'if (-not $window) { throw "No visible app window found. Launch the app explicitly, then capture by processName or targetWindowTitle." }',
    'Add-Type @"',
    'using System;',
    'using System.Runtime.InteropServices;',
    'public struct RECT { public int Left; public int Top; public int Right; public int Bottom; }',
    'public class Win32CaptureWindow {',
    '  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr hWnd, out RECT rect);',
    '  [DllImport("user32.dll")] public static extern bool PrintWindow(IntPtr hWnd, IntPtr hdcBlt, uint nFlags);',
    '}',
    '"@',
    '$rect = New-Object RECT',
    '[Win32CaptureWindow]::GetWindowRect($window.MainWindowHandle, [ref]$rect) | Out-Null',
    '$width = $rect.Right - $rect.Left',
    '$height = $rect.Bottom - $rect.Top',
    'if ($width -le 0 -or $height -le 0) { throw "Matched app window has invalid bounds" }',
    '$bitmap = New-Object System.Drawing.Bitmap $width, $height',
    '$graphics = [System.Drawing.Graphics]::FromImage($bitmap)',
    '$graphics.Clear([System.Drawing.Color]::Transparent)',
    '$hdc = $graphics.GetHdc()',
    '$ok = [Win32CaptureWindow]::PrintWindow($window.MainWindowHandle, $hdc, 2)',
    '$graphics.ReleaseHdc($hdc)',
    'if (-not $ok) { throw "PrintWindow failed for matched app window" }',
    `$bitmap.Save('${escapedOutput}', [System.Drawing.Imaging.ImageFormat]::Png)`,
    '$graphics.Dispose()',
    '$bitmap.Dispose()',
    'Write-Output "$($window.ProcessName)|$($window.Id)|$($window.MainWindowTitle)|$($width)x$($height)"',
  ].join('\n');
  const result = await execFileAsync('powershell', ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-Command', script], {
    cwd: REPO_ROOT,
    timeout: 30_000,
    windowsHide: true,
    maxBuffer: 128 * 1024,
  });
  return result.stdout.trim();
}

export function registerDebugScreenwatchTools(server, getSessionId) {
  server.registerTool('debug_capture_app_screenshot', {
    title: 'Debug Capture App Screenshot',
    inputSchema: {
      debugRunId: z.string().min(1),
      label: z.string().optional(),
      outputDir: z.string().optional(),
      mode: z.enum(['window', 'metadata_only']).optional(),
      targetWindowTitle: z.string().optional(),
      processName: z.string().optional(),
      allowTitleFallback: z.boolean().optional(),
    },
  }, async ({
    debugRunId,
    label = 'capture',
    outputDir,
    mode = 'window',
    targetWindowTitle = 'CometAI',
    processName = 'comet-ai',
    allowTitleFallback = false,
  }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;

    let root;
    try {
      root = ensureDir(resolveUnderRepo(outputDir, DEFAULT_SCREENSHOT_ROOT));
    } catch (error) {
      return makeToolText(error instanceof Error ? error.message : String(error), true);
    }

    const stamp = new Date().toISOString().replace(/[:.]/g, '-');
    const baseName = `${stamp}-${safeSlug(label)}`;
    const metadataPath = join(root, `${baseName}.json`);
    const pngPath = join(root, `${baseName}.png`);
    const metadata = {
      schemaVersion: 1,
      debugRunId,
      capturedAt: new Date().toISOString(),
      label,
      mode,
      platform: process.platform,
      pngPath: null,
      targetWindowTitle,
      processName: processName ?? null,
      allowTitleFallback,
      note: 'window mode captures the running app window handle via PrintWindow. It does not capture the desktop, browser tabs, or windows layered above the app.',
    };

    try {
      if (mode === 'window') {
        if (process.platform !== 'win32') {
          return makeToolText('debug_capture_app_screenshot window mode is currently implemented for Windows only. Use mode="metadata_only" on other platforms.', true);
        }
        ensureDir(dirname(pngPath));
        const dimensions = await captureWindowsAppWindow(pngPath, { targetWindowTitle, processName, allowTitleFallback });
        metadata.pngPath = toRepoPath(pngPath);
        metadata.dimensions = dimensions;
        metadata.bytes = statSync(pngPath).size;
      }
      writeFileSync(metadataPath, JSON.stringify(metadata, null, 2));
      auditTool(debugRunId, 'debug_capture_app_screenshot', getSessionId?.(), { label, mode, path: toRepoPath(metadataPath) });
      writeDebugEvent(debugRunId, 'debug_screenshot_captured', {
        label,
        mode,
        metadataPath: toRepoPath(metadataPath),
        pngPath: metadata.pngPath,
      });
      return jsonResponse({
        ok: true,
        metadataPath: toRepoPath(metadataPath),
        pngPath: metadata.pngPath,
        mode,
      });
    } catch (error) {
      writeDebugEvent(debugRunId, 'debug_screenshot_failed', {
        label,
        mode,
        error: error instanceof Error ? error.message : String(error),
      });
      return makeToolText(`Screenshot capture failed: ${error instanceof Error ? error.message : String(error)}`, true);
    }
  });

  server.registerTool('debug_list_ui_screenwatch_snapshots', {
    title: 'Debug List UI Screenwatch Snapshots',
    inputSchema: {
      debugRunId: z.string().min(1),
      missionId: z.string().optional(),
      rootDir: z.string().optional(),
      limit: z.number().int().positive().max(500).optional(),
    },
  }, async ({ debugRunId, missionId, rootDir, limit = 100 }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    let root;
    try {
      root = resolveUnderRepo(rootDir, DEFAULT_SCREENWATCH_ROOT);
    } catch (error) {
      return makeToolText(error instanceof Error ? error.message : String(error), true);
    }
    const snapshots = walkJsonFiles(root, limit)
      .map(readSnapshotSummary)
      .filter(snapshot => !missionId || snapshot.missionId === missionId);
    auditTool(debugRunId, 'debug_list_ui_screenwatch_snapshots', getSessionId?.(), { missionId: missionId ?? null, root: toRepoPath(root) });
    writeDebugEvent(debugRunId, 'debug_ui_screenwatch_listed', { missionId: missionId ?? null, count: snapshots.length });
    return jsonResponse({
      root: toRepoPath(root),
      missionId: missionId ?? null,
      snapshots,
    });
  });

  server.registerTool('debug_read_ui_screenwatch_snapshot', {
    title: 'Debug Read UI Screenwatch Snapshot',
    inputSchema: {
      debugRunId: z.string().min(1),
      path: z.string().min(1),
    },
  }, async ({ debugRunId, path }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    let absolute;
    try {
      absolute = resolveUnderRepo(path, DEFAULT_SCREENWATCH_ROOT);
    } catch (error) {
      return makeToolText(error instanceof Error ? error.message : String(error), true);
    }
    const relScreenwatch = relative(DEFAULT_SCREENWATCH_ROOT, absolute);
    const relScreenshots = relative(DEFAULT_SCREENSHOT_ROOT, absolute);
    const relTmp = relative(DEBUG_TMP_ROOT, absolute);
    const allowed =
      (!relScreenwatch.startsWith('..') && !isAbsolute(relScreenwatch)) ||
      (!relScreenshots.startsWith('..') && !isAbsolute(relScreenshots)) ||
      (!relTmp.startsWith('..') && !isAbsolute(relTmp) && absolute.toLowerCase().endsWith('.json'));
    if (!allowed) return makeToolText(`Snapshot path is outside debug screenwatch roots: ${path}`, true);
    if (!existsSync(absolute)) return makeToolText(`Snapshot not found: ${path}`, true);
    const stat = statSync(absolute);
    if (stat.size > MAX_JSON_BYTES) return makeToolText(`Snapshot too large to read through MCP: ${path}`, true);
    const snapshot = parseJsonSafe(readFileSync(absolute, 'utf8'), null);
    auditTool(debugRunId, 'debug_read_ui_screenwatch_snapshot', getSessionId?.(), { path: toRepoPath(absolute) });
    writeDebugEvent(debugRunId, 'debug_ui_screenwatch_read', { path: toRepoPath(absolute) });
    return jsonResponse({
      path: toRepoPath(absolute),
      snapshot,
    });
  });
}
