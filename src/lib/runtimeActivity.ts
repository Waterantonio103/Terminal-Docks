const READ_PATTERNS = [/\breadfile\b/i, /\breading\b/i, /\bread\b/i];
const WRITE_PATTERNS = [/\bwritefile\b/i, /\bedit\b/i, /\bwriting\b/i, /\bpatch\b/i, /\bsave\b/i];
const SHELL_PATTERNS = [/\bbash\b/i, /\bshell\b/i, /\bcommand\b/i, /\bpowershell\b/i, /\bcmd\.exe\b/i];
const TEST_PATTERNS = [/\btest\b/i, /\btests\b/i, /\bnpm run test\b/i, /\bcargo test\b/i, /\bpytest\b/i];

export function detectRuntimeAction(raw: string | undefined | null): string {
  const text = String(raw ?? '').replace(/\s+/g, ' ').trim();
  if (!text) return 'Working...';
  if (TEST_PATTERNS.some(pattern => pattern.test(text))) return 'Running tests...';
  if (WRITE_PATTERNS.some(pattern => pattern.test(text))) return 'Writing code...';
  if (READ_PATTERNS.some(pattern => pattern.test(text))) return 'Reading files...';
  if (SHELL_PATTERNS.some(pattern => pattern.test(text))) return 'Running command...';
  return 'Working...';
}
