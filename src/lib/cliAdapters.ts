import type { WorkflowAgentCli } from '../store/workspace.js';

export interface RuntimePromptInput {
  missionGoal: string;
  roleId: string;
  roleInstructions?: string;
  workspaceDir?: string | null;
  upstreamHandoff?: string | null;
}

export interface CliRuntimeAdapter {
  id: WorkflowAgentCli;
  displayName: string;
  /** Shell binary the user would type to start this CLI. */
  launchCommand(): string;
  /** Build the task prompt text that will be written into the PTY. */
  formatPrompt(input: RuntimePromptInput): string;
  /** Substrings (lowercased) in PTY output that suggest the CLI is ready. */
  readinessHints(): string[];
  /** Startup delay to fall back to when readiness hints never appear. */
  startupDelayMs: number;
  /** Delay between writing prompt body and the lone submit Enter. */
  submitDelayMs: number;
  /** Known limitations that should surface as UI warnings. */
  knownLimitations?: string[];
}

const COMMON_TASK_HEADER = '### TERMINAL_DOCKS_TASK ###';

function defaultFormatPrompt({
  missionGoal,
  roleId,
  roleInstructions,
  workspaceDir,
  upstreamHandoff,
}: RuntimePromptInput): string {
  const parts: string[] = [COMMON_TASK_HEADER];
  if (roleId) parts.push(`Role: ${roleId}`);
  if (workspaceDir) parts.push(`Workspace: ${workspaceDir}`);
  parts.push('');
  parts.push('Task:');
  parts.push((missionGoal || '(No task description was provided.)').trim());
  const trimmedInstructions = roleInstructions?.trim();
  if (trimmedInstructions) {
    parts.push('');
    parts.push('Role Instructions:');
    parts.push(trimmedInstructions);
  }
  const trimmedHandoff = upstreamHandoff?.trim();
  if (trimmedHandoff) {
    parts.push('');
    parts.push('Upstream Handoff:');
    parts.push(trimmedHandoff);
  }
  parts.push('');
  parts.push('When finished, end your output with the literal marker: TERMINAL_DOCKS_DONE');
  return parts.join('\n');
}

const claudeAdapter: CliRuntimeAdapter = {
  id: 'claude',
  displayName: 'Claude Code',
  launchCommand: () => 'claude',
  formatPrompt: defaultFormatPrompt,
  readinessHints: () => ['how can i help', 'welcome to claude', '? for shortcuts', 'claude code'],
  startupDelayMs: 4000,
  submitDelayMs: 400,
};

const codexAdapter: CliRuntimeAdapter = {
  id: 'codex',
  displayName: 'Codex CLI',
  launchCommand: () => 'codex',
  formatPrompt: defaultFormatPrompt,
  readinessHints: () => ['codex', '>'],
  startupDelayMs: 3500,
  submitDelayMs: 400,
};

const geminiAdapter: CliRuntimeAdapter = {
  id: 'gemini',
  displayName: 'Gemini CLI',
  launchCommand: () => 'gemini',
  formatPrompt: defaultFormatPrompt,
  readinessHints: () => ['gemini', 'ready', '>'],
  startupDelayMs: 3500,
  submitDelayMs: 400,
};

const opencodeAdapter: CliRuntimeAdapter = {
  id: 'opencode',
  displayName: 'OpenCode',
  launchCommand: () => 'opencode',
  formatPrompt: defaultFormatPrompt,
  readinessHints: () => ['opencode', '>'],
  startupDelayMs: 3500,
  submitDelayMs: 400,
};

const REGISTRY = new Map<WorkflowAgentCli, CliRuntimeAdapter>([
  [claudeAdapter.id, claudeAdapter],
  [codexAdapter.id, codexAdapter],
  [geminiAdapter.id, geminiAdapter],
  [opencodeAdapter.id, opencodeAdapter],
]);

export function getCliAdapter(cli: WorkflowAgentCli): CliRuntimeAdapter | null {
  return REGISTRY.get(cli) ?? null;
}

export function listCliAdapters(): CliRuntimeAdapter[] {
  return Array.from(REGISTRY.values());
}
