export const AUTONOMY_MODES = ['diagnose', 'propose', 'autopatch'];

export const DEFAULT_DEBUG_GUARDRAILS = Object.freeze({
  autonomyMode: 'diagnose',
  requireConfirmation: true,
  maxRepairAttempts: 3,
  repairAttempt: 0,
  maxFilesChanged: 8,
  maxPatchBytes: 120000,
  maxCommandRuntimeMs: 120000,
  allowedPaths: [
    'src/lib/runtime/**',
    'src/components/Terminal/**',
    'src/lib/workers/**',
    'src/store/**',
    'mcp-server/**',
    'src-tauri/src/pty.rs',
    'docs/debug-reports/**',
  ],
  blockedPaths: [
    '.env',
    '.env.*',
    'node_modules/**',
    'target/**',
    '.git/**',
    'package-lock.json',
    'pnpm-lock.yaml',
    'yarn.lock',
  ],
  allowedCommands: [
    'npm run typecheck',
    'npm run lint',
    'npm test',
    'npm run test',
    'cargo check',
    'cargo test',
  ],
  allowDependencyChanges: false,
  allowDestructiveCommands: false,
});

export function normalizeAutonomyMode(mode) {
  return AUTONOMY_MODES.includes(mode) ? mode : DEFAULT_DEBUG_GUARDRAILS.autonomyMode;
}

export function buildGuardrails(input = {}) {
  const autonomyMode = normalizeAutonomyMode(input.autonomyMode);
  const requireConfirmation = typeof input.requireConfirmation === 'boolean'
    ? input.requireConfirmation
    : DEFAULT_DEBUG_GUARDRAILS.requireConfirmation;

  return {
    ...DEFAULT_DEBUG_GUARDRAILS,
    autonomyMode,
    requireConfirmation,
    maxRepairAttempts: positiveInt(input.maxRepairAttempts, DEFAULT_DEBUG_GUARDRAILS.maxRepairAttempts),
    maxFilesChanged: positiveInt(input.maxFilesChanged, DEFAULT_DEBUG_GUARDRAILS.maxFilesChanged),
    maxPatchBytes: positiveInt(input.maxPatchBytes, DEFAULT_DEBUG_GUARDRAILS.maxPatchBytes),
    maxCommandRuntimeMs: positiveInt(input.maxCommandRuntimeMs, DEFAULT_DEBUG_GUARDRAILS.maxCommandRuntimeMs),
    allowedPaths: nonEmptyStringArray(input.allowedPaths, DEFAULT_DEBUG_GUARDRAILS.allowedPaths),
    blockedPaths: nonEmptyStringArray(input.blockedPaths, DEFAULT_DEBUG_GUARDRAILS.blockedPaths),
    allowedCommands: nonEmptyStringArray(input.allowedCommands, DEFAULT_DEBUG_GUARDRAILS.allowedCommands),
  };
}

export function normalizeRepoPath(path) {
  return String(path || '')
    .replaceAll('\\', '/')
    .replace(/^[a-zA-Z]:\//, '')
    .replace(/^\.?\//, '')
    .replace(/\/+/g, '/')
    .trim();
}

export function globToRegExp(glob) {
  const source = normalizeRepoPath(glob)
    .replace(/[.+^${}()|[\]\\]/g, '\\$&')
    .replaceAll('**', '\0')
    .replaceAll('*', '[^/]*')
    .replaceAll('\0', '.*');
  return new RegExp(`^${source}$`);
}

export function matchesAnyPath(path, patterns = []) {
  const normalized = normalizeRepoPath(path);
  return patterns.some(pattern => globToRegExp(pattern).test(normalized));
}

export function validatePathScope(path, guardrails) {
  const normalized = normalizeRepoPath(path);
  if (!normalized || normalized.includes('..')) {
    return { ok: false, code: 'invalid_path', message: `Invalid path: ${path}` };
  }
  if (matchesAnyPath(normalized, guardrails.blockedPaths)) {
    return { ok: false, code: 'blocked_path', message: `Path is blocked by debug guardrails: ${normalized}` };
  }
  if (!matchesAnyPath(normalized, guardrails.allowedPaths)) {
    return { ok: false, code: 'outside_allowed_paths', message: `Path is outside debug allowed paths: ${normalized}` };
  }
  return { ok: true, path: normalized };
}

export function extractDiffPaths(diff) {
  const paths = new Set();
  for (const line of String(diff || '').split(/\r?\n/)) {
    let match = line.match(/^diff --git a\/(.+?) b\/(.+)$/);
    if (match) {
      if (match[1] !== '/dev/null') paths.add(normalizeRepoPath(match[1]));
      if (match[2] !== '/dev/null') paths.add(normalizeRepoPath(match[2]));
      continue;
    }
    match = line.match(/^(?:---|\+\+\+) (?:a|b)\/(.+)$/);
    if (match && match[1] !== '/dev/null') paths.add(normalizeRepoPath(match[1]));
  }
  return [...paths].filter(Boolean);
}

export function validatePatchScope(diff, debugRun) {
  const paths = extractDiffPaths(diff);
  if (!paths.length) return { ok: false, code: 'empty_patch_paths', message: 'Patch diff does not include any file paths.' };
  if (String(diff || '').length > debugRun.maxPatchBytes) {
    return { ok: false, code: 'patch_too_large', message: `Patch exceeds maxPatchBytes (${debugRun.maxPatchBytes}).` };
  }
  if (paths.length > debugRun.maxFilesChanged) {
    return { ok: false, code: 'too_many_files', message: `Patch touches ${paths.length} files; maxFilesChanged is ${debugRun.maxFilesChanged}.` };
  }
  for (const path of paths) {
    const checked = validatePathScope(path, debugRun);
    if (!checked.ok) return checked;
  }
  return { ok: true, paths };
}

export function validateAutopatchAllowed(debugRun) {
  if (debugRun.autonomyMode !== 'autopatch') {
    return { ok: false, code: 'not_autopatch_mode', message: 'debug_apply_patch requires autonomyMode=autopatch.' };
  }
  if (debugRun.requireConfirmation) {
    return { ok: false, code: 'confirmation_required', message: 'debug_apply_patch requires requireConfirmation=false or an explicit approval flow.' };
  }
  if (debugRun.repairAttempt >= debugRun.maxRepairAttempts) {
    return { ok: false, code: 'max_attempts_reached', message: `Repair attempt limit reached (${debugRun.maxRepairAttempts}).` };
  }
  return { ok: true };
}

export function validateCommand(command, debugRun) {
  const normalized = String(command || '').trim().replace(/\s+/g, ' ');
  if (!normalized) return { ok: false, code: 'missing_command', message: 'Command is required.' };
  if (!debugRun.allowedCommands.includes(normalized)) {
    return { ok: false, code: 'command_not_allowed', message: `Command is not allowed by debug guardrails: ${normalized}` };
  }
  return { ok: true, command: normalized };
}

function positiveInt(value, fallback) {
  return Number.isInteger(value) && value > 0 ? value : fallback;
}

function nonEmptyStringArray(value, fallback) {
  if (!Array.isArray(value)) return [...fallback];
  const clean = value.map(item => String(item).trim()).filter(Boolean);
  return clean.length > 0 ? clean : [...fallback];
}
