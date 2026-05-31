import type { CliId } from './cliIdentity.js';
import { normalizeCliId } from './cliIdentity.js';
import agentsConfig from '../config/agents.js';

export type AgentCli = CliId;
export type CliDetectionConfidence = 'low' | 'medium' | 'high';

const ROLE_IDS = agentsConfig.agents.map(agent => agent.id);
export type AgentRoleId = string;
const ROLE_LABEL_ALIASES = agentsConfig.agents.flatMap(agent => [
  [agent.id, agent.id] as const,
  [agent.name, agent.id] as const,
  [agent.role, agent.id] as const,
  [agent.name.replace(/\s+Agent$/i, ''), agent.id] as const,
]).sort(([left], [right]) => right.length - left.length);

const CLI_ALIASES: Partial<Record<AgentCli, string[]>> = {
  claude: ['claude', 'claude.cmd'],
  gemini: ['gemini', 'gemini.cmd'],
  opencode: ['opencode', 'opencode.cmd'],
  codex: ['codex', 'codex.cmd'],
  ollama: ['ollama', 'ollama.cmd'],
  lmstudio: ['lmstudio', 'lmstudio.cmd'],
  custom: ['custom'],
};

function firstToken(text: string): string {
  return text.trim().split(/\s+/)[0]?.toLowerCase() ?? '';
}

function normalizeToken(token: string): string {
  return token.replace(/^\.\//, '').replace(/^"|"$/g, '').toLowerCase();
}

function cliDetectionCandidates(text: string): string[] {
  const trimmed = text.trim();
  const tokens = trimmed.split(/\s+/).filter(Boolean);
  const candidates = [
    firstToken(trimmed),
    tokens.slice(0, 2).join(' '),
  ];
  return [...new Set(candidates.map(normalizeToken).filter(Boolean))];
}

export function normalizeCli(value: unknown): AgentCli | null {
  return normalizeCliId(value);
}

export function detectCliFromText(text: string | null | undefined): AgentCli | null {
  if (!text) return null;

  for (const normalized of cliDetectionCandidates(text)) {
    const canonical = normalizeCliId(normalized);
    if (canonical) return canonical;

    for (const [cli, aliases] of Object.entries(CLI_ALIASES) as Array<[AgentCli, string[]]>) {
      if (aliases.includes(normalized)) return cli;
    }
  }

  const lower = text.toLowerCase();
  if (/\bclaude(\.cmd)?\b/.test(lower)) return 'claude';
  if (/\bgemini(\.cmd)?\b/.test(lower)) return 'gemini';
  if (/\bopencode(\.cmd)?\b/.test(lower)) return 'opencode';
  if (/\bcodex(\.cmd)?\b/.test(lower)) return 'codex';
  if (/\bollama(\.cmd)?\b/.test(lower)) return 'ollama';
  if (/\blm[\s_-]?studio(\.cmd)?\b/.test(lower)) return 'lmstudio';
  return null;
}

export function detectCliForPane(pane: { title?: string; data?: Record<string, unknown> }): AgentCli | null {
  if (typeof pane.data?.customCliCommand === 'string' && pane.data.customCliCommand.trim()) {
    return 'custom';
  }

  const fromData = normalizeCli(pane.data?.cli);
  if (fromData) return fromData;

  // If runtime detection has explicitly stamped this pane, trust it (including
  // a null result — don't fall back to stale heuristics).
  const source = pane.data?.cliSource;
  if (typeof source === 'string' && source.length > 0) return null;

  // Only trust initialCommand — the first line is the CLI binary name when the
  // app explicitly spawned it. Title-based guessing removed: a pane named
  // "Scout" or "Terminal 1" tells us nothing reliable about which CLI is running.
  const initialCommand = typeof pane.data?.initialCommand === 'string' ? pane.data.initialCommand : '';
  const initialFirstLine = initialCommand.split(/\r?\n/).find(line => line.trim()) ?? '';
  return detectCliFromText(initialFirstLine);
}

const ANSI_ESCAPE_RE = /\[[0-?]*[ -/]*[@-~]|\][^]*(?:|\\)|[@-_]/g;

export function stripAnsi(input: string): string {
  return input.replace(ANSI_ESCAPE_RE, '');
}

export function detectCliFromTerminalOutput(output: string | null | undefined): {
  cli: AgentCli | null;
  confidence: CliDetectionConfidence;
} {
  if (!output) return { cli: null, confidence: 'low' };

  // 1. Scan raw bytes for OSC window title sequences (\x1b]0;Title\x07).
  // Find all matches and use the LAST one to correctly detect CLI switches.
  const titles = [...output.matchAll(/\x1b\]0;([^\x07\x1b]*)\x07/gi)];
  if (titles.length > 0) {
    const lastTitle = titles[titles.length - 1][1];
    const titleCli = detectCliFromText(lastTitle);
    if (titleCli) return { cli: titleCli, confidence: 'high' };
  }

  // 2. Clean ANSI escape sequences to check for startup banners or explicit CLI name prints.
  const clean = stripAnsi(output);
  const lower = clean.toLowerCase();

  // Find the last index of each CLI's signature keyword to prioritize the most recently printed one.
  const signatures = [
    { cli: 'claude' as AgentCli, idx: Math.max(lower.lastIndexOf('claude code'), /(^|\n)\s*[┌╔].{0,80}\bclaude\b/i.test(clean) ? clean.lastIndexOf('claude') : -1) },
    { cli: 'gemini' as AgentCli, idx: Math.max(lower.lastIndexOf('gemini cli'), lower.lastIndexOf('google gemini')) },
    { cli: 'opencode' as AgentCli, idx: lower.lastIndexOf('opencode') },
    { cli: 'codex' as AgentCli, idx: lower.lastIndexOf('codex') },
    { cli: 'ollama' as AgentCli, idx: lower.lastIndexOf('ollama') },
    { cli: 'lmstudio' as AgentCli, idx: Math.max(lower.lastIndexOf('lm studio'), lower.lastIndexOf('lm-studio'), lower.lastIndexOf('lmstudio')) },
  ].filter(x => x.idx !== -1).sort((a, b) => b.idx - a.idx);

  if (signatures.length > 0) {
    // If it's a very explicit high-confidence signature, return high confidence
    const match = signatures[0];
    if (
      (match.cli === 'claude' && lower.lastIndexOf('claude code') === match.idx) ||
      (match.cli === 'gemini' && (lower.lastIndexOf('gemini cli') === match.idx || lower.lastIndexOf('google gemini') === match.idx))
    ) {
      return { cli: match.cli, confidence: 'high' };
    }
    return { cli: match.cli, confidence: 'medium' };
  }

  // 3. Fallback to generic keyword matching if no strong signature was found (still prioritizing last occurrence)
  const generics = [
    { cli: 'claude' as AgentCli, idx: lower.lastIndexOf('claude') },
    { cli: 'gemini' as AgentCli, idx: lower.lastIndexOf('gemini') },
    { cli: 'codex' as AgentCli, idx: lower.lastIndexOf('codex') },
    { cli: 'ollama' as AgentCli, idx: lower.lastIndexOf('ollama') },
    { cli: 'lmstudio' as AgentCli, idx: Math.max(lower.lastIndexOf('lm studio'), lower.lastIndexOf('lm-studio'), lower.lastIndexOf('lmstudio')) },
  ].filter(x => x.idx !== -1).sort((a, b) => b.idx - a.idx);

  if (generics.length > 0) {
    return { cli: generics[0].cli, confidence: 'medium' };
  }

  return { cli: null, confidence: 'low' };
}

function normalizeRole(value: unknown): AgentRoleId | null {
  if (typeof value !== 'string') return null;
  const v = value.trim().toLowerCase();
  return ROLE_IDS.includes(v) ? v : null;
}

export function detectRoleFromText(text: string | null | undefined): AgentRoleId | null {
  if (!text) return null;
  const lower = text.toLowerCase();

  for (const [alias, roleId] of ROLE_LABEL_ALIASES) {
    const normalized = alias.trim().toLowerCase().replace(/[_-]+/g, ' ');
    if (!normalized) continue;
    const escaped = normalized.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '[\\s_-]+');
    const rx = new RegExp(`\\b${escaped}\\b`);
    if (rx.test(lower)) return roleId;
  }

  if (/\bintelligence specialist\b/.test(lower)) return 'scout';
  if (/\bstaff engineer\b|\btech lead\b/.test(lower)) return 'coordinator';
  if (/\bsenior software engineer\b/.test(lower)) return 'builder';
  if (/\btest engineer\b/.test(lower)) return 'tester';
  if (/\bsecurity engineer\b/.test(lower)) return 'security';
  if (/\bprincipal engineer\b/.test(lower)) return 'reviewer';

  return null;
}

export function detectRoleForPane(pane: { title?: string; data?: Record<string, unknown> }): AgentRoleId | null {
  const fromData = normalizeRole(pane.data?.roleId);
  if (fromData) return fromData;

  const fromTitle = detectRoleFromText(pane.title ?? '');
  if (fromTitle) return fromTitle;

  const initialCommand = typeof pane.data?.initialCommand === 'string' ? pane.data.initialCommand : '';
  const fromInitialCommand = detectRoleFromText(initialCommand);
  if (fromInitialCommand) return fromInitialCommand;

  return null;
}
