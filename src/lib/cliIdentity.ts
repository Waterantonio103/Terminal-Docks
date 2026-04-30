export type CliId =
  | 'claude'
  | 'codex'
  | 'gemini'
  | 'opencode'
  | 'custom'
  | 'ollama'
  | 'lmstudio';

export const CANONICAL_CLI_IDS: readonly CliId[] = [
  'claude',
  'codex',
  'gemini',
  'opencode',
  'custom',
  'ollama',
  'lmstudio',
] as const;

const CLI_ID_SET = new Set<string>(CANONICAL_CLI_IDS);

const CLI_ALIASES: Record<string, CliId> = {
  open_code: 'opencode',
  opencode: 'opencode',
  claude: 'claude',
  gemini: 'gemini',
  codex: 'codex',
  custom: 'custom',
  ollama: 'ollama',
  lmstudio: 'lmstudio',
};

export function normalizeCliId(value: unknown): CliId | null {
  if (typeof value !== 'string') return null;
  const key = value.trim().toLowerCase();
  if (CLI_ID_SET.has(key)) return key as CliId;
  const aliased = CLI_ALIASES[key];
  if (aliased) return aliased;
  return null;
}

export function isValidCliId(value: unknown): value is CliId {
  return normalizeCliId(value) !== null;
}

export function supportsHeadless(cli: CliId): boolean {
  switch (cli) {
    case 'claude':
    case 'ollama':
    case 'lmstudio':
    case 'custom':
      return true;
    case 'codex':
    case 'gemini':
    case 'opencode':
      return false;
    default:
      return false;
  }
}

export function assertCliIdConsistency(): void {
  for (const id of CANONICAL_CLI_IDS) {
    const resolved = normalizeCliId(id);
    if (resolved !== id) {
      throw new Error(
        `CLI identity assertion failed: normalizeCliId("${id}") => ${JSON.stringify(resolved)}, expected "${id}"`
      );
    }
  }

  const legacyChecks: Array<{ input: string; expected: CliId }> = [
    { input: 'open_code', expected: 'opencode' },
    { input: 'OpenCode', expected: 'opencode' },
    { input: 'OPCODE', expected: null as unknown as CliId },
  ];

  for (const { input, expected } of legacyChecks) {
    const resolved = normalizeCliId(input);
    if (resolved !== expected && !(expected === null && resolved === null)) {
      throw new Error(
        `CLI legacy alias assertion failed: normalizeCliId("${input}") => ${JSON.stringify(resolved)}, expected ${JSON.stringify(expected)}`
      );
    }
  }
}
