import type { CliId, CliModel } from './models/modelTypes.js';

export type AgentSlashCommandId =
  | 'help'
  | 'usage'
  | 'cli'
  | 'model'
  | 'reasoning'
  | 'agent'
  | 'permission'
  | 'plan'
  | 'goal'
  | 'context'
  | 'session'
  | 'compact'
  | 'clear';

export type AgentSlashCommandGroup = 'session' | 'runtime' | 'context' | 'workflow';

export interface AgentSlashCommandDefinition {
  id: AgentSlashCommandId;
  name: string;
  aliases: string[];
  label: string;
  description: string;
  usage: string;
  group: AgentSlashCommandGroup;
  submitPrompt?: boolean;
}

export interface AgentSlashParseResult {
  kind: 'command';
  raw: string;
  command: string;
  args: string;
}

export interface AgentSlashCommandMatch extends AgentSlashParseResult {
  start: number;
  end: number;
}

export interface AgentSlashLiteralResult {
  kind: 'literal';
  text: string;
}

export interface AgentSlashSuggestion {
  id: AgentSlashCommandId;
  name: string;
  label: string;
  usage: string;
  description: string;
  group: AgentSlashCommandGroup;
}

export interface AgentSlashSuggestionContext {
  cli?: CliId | string | null;
  models?: CliModel[];
  agentRoles?: Array<{ id: string; name: string; role?: string }>;
  max?: number;
}

export const AGENT_SLASH_COMMANDS: readonly AgentSlashCommandDefinition[] = [
  {
    id: 'help',
    name: 'help',
    aliases: ['commands', '?'],
    label: 'Commands',
    description: 'Show the agent prompt commands available in Comet.',
    usage: '/help',
    group: 'session',
  },
  {
    id: 'usage',
    name: 'usage',
    aliases: ['quota', 'limits', 'limit', 'cost'],
    label: 'Usage',
    description: 'Ask the selected CLI for available usage, quota, or limit details.',
    usage: '/usage',
    group: 'runtime',
  },
  {
    id: 'cli',
    name: 'cli',
    aliases: ['runtime'],
    label: 'Switch CLI',
    description: 'Switch the selected runtime CLI for new agent turns.',
    usage: '/cli <claude|codex|gemini|opencode>',
    group: 'runtime',
  },
  {
    id: 'model',
    name: 'model',
    aliases: ['m'],
    label: 'Switch Model',
    description: 'Switch the selected model for the current CLI.',
    usage: '/model <model-id>',
    group: 'runtime',
  },
  {
    id: 'reasoning',
    name: 'reasoning',
    aliases: ['effort'],
    label: 'Reasoning Effort',
    description: 'Set the requested reasoning depth added to agent context.',
    usage: '/reasoning <low|medium|high|xhigh>',
    group: 'runtime',
  },
  {
    id: 'agent',
    name: 'agent',
    aliases: ['role'],
    label: 'Switch Agent',
    description: 'Switch the workspace agent role/profile.',
    usage: '/agent <role>',
    group: 'runtime',
  },
  {
    id: 'permission',
    name: 'permission',
    aliases: ['permissions', 'mode'],
    label: 'Permission Mode',
    description: 'Set command/edit approval behavior.',
    usage: '/permission <default|restricted|full>',
    group: 'runtime',
  },
  {
    id: 'plan',
    name: 'plan',
    aliases: [],
    label: 'Plan',
    description: 'Ask for a read-only implementation plan.',
    usage: '/plan [task]',
    group: 'workflow',
    submitPrompt: true,
  },
  {
    id: 'goal',
    name: 'goal',
    aliases: ['objective'],
    label: 'Goal',
    description: 'Set or show the standing goal added to agent context.',
    usage: '/goal [goal text]',
    group: 'workflow',
  },
  {
    id: 'context',
    name: 'context',
    aliases: ['ctx'],
    label: 'Context',
    description: 'Select a file or folder path as agent context.',
    usage: '/context <path>',
    group: 'context',
  },
  {
    id: 'session',
    name: 'session',
    aliases: [],
    label: 'Session',
    description: 'Manage the selected agent session.',
    usage: '/session new',
    group: 'session',
  },
  {
    id: 'compact',
    name: 'compact',
    aliases: ['summarize'],
    label: 'Compact',
    description: 'Summarize long chat context and continue from the summary.',
    usage: '/compact',
    group: 'session',
  },
  {
    id: 'clear',
    name: 'clear',
    aliases: ['reset', 'new'],
    label: 'Clear',
    description: 'Start a fresh agent conversation.',
    usage: '/clear',
    group: 'session',
  },
];

const COMMAND_BY_NAME = new Map<string, AgentSlashCommandDefinition>();

for (const command of AGENT_SLASH_COMMANDS) {
  COMMAND_BY_NAME.set(command.name, command);
  for (const alias of command.aliases) COMMAND_BY_NAME.set(alias, command);
}

function normalizeCommandToken(value: string): string {
  return value.trim().replace(/^\/+/, '').toLowerCase();
}

export function parseAgentSlashCommand(input: string): AgentSlashParseResult | AgentSlashLiteralResult | null {
  const match = findAgentSlashCommand(input);
  if (!match) return null;
  if (match.kind === 'literal') return match;
  return {
    kind: 'command',
    raw: match.raw,
    command: match.command,
    args: match.args,
  };
}

export function findAgentSlashCommand(input: string): AgentSlashCommandMatch | AgentSlashLiteralResult | null {
  const leadingWhitespace = /^\s*/.exec(input)?.[0] ?? '';
  const trimmedStart = leadingWhitespace.length;
  if (input.slice(trimmedStart).startsWith('//')) {
    return { kind: 'literal', text: `${leadingWhitespace}${input.slice(trimmedStart + 1)}` };
  }

  const candidates = Array.from(input.matchAll(/(^|\s)\/(?!\/)([^\s/]*)/g));
  const candidate = candidates[candidates.length - 1];
  if (!candidate) return null;
  const start = (candidate.index ?? 0) + (candidate[1]?.length ?? 0);
  const rest = input.slice(start);
  const match = /^\/([^\s/]+)(?:\s+([\s\S]*))?$/.exec(rest);
  if (!match) {
    return {
      kind: 'command',
      raw: rest,
      command: '',
      args: '',
      start,
      end: input.length,
    };
  }

  return {
    kind: 'command',
    raw: rest,
    command: normalizeCommandToken(match[1] ?? ''),
    args: (match[2] ?? '').trim(),
    start,
    end: input.length,
  };
}

export function resolveAgentSlashCommand(name: string): AgentSlashCommandDefinition | null {
  return COMMAND_BY_NAME.get(normalizeCommandToken(name)) ?? null;
}

export function buildAgentSlashCommandSuggestions(
  input: string,
  context: AgentSlashSuggestionContext = {},
): AgentSlashSuggestion[] {
  const parsed = parseAgentSlashCommand(input);
  if (!parsed || parsed.kind !== 'command') return [];
  const query = normalizeCommandToken(parsed.command);
  const max = Math.max(1, context.max ?? 8);
  const selectedCli = context.cli ? String(context.cli).toLowerCase() : '';

  return AGENT_SLASH_COMMANDS
    .filter(command => {
      if (!query) return true;
      return command.name.startsWith(query) || command.aliases.some(alias => alias.startsWith(query));
    })
    .sort((a, b) => {
      const aExact = a.name === query || a.aliases.includes(query);
      const bExact = b.name === query || b.aliases.includes(query);
      if (aExact !== bExact) return aExact ? -1 : 1;
      if (selectedCli === 'codex' && a.id === 'model') return -1;
      return a.name.localeCompare(b.name);
    })
    .slice(0, max)
    .map(command => ({
      id: command.id,
      name: command.name,
      label: command.label,
      usage: command.usage,
      description: command.description,
      group: command.group,
    }));
}

export function slashCommandHelpText(): string {
  return [
    'Agent prompt commands:',
    ...AGENT_SLASH_COMMANDS.map(command => `/${command.name} - ${command.description}`),
    '',
    'Use // at the start to send a literal slash message.',
  ].join('\n');
}

export function resolveModelArgument(value: string, models: CliModel[]): CliModel | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  return models.find(model =>
    model.id.toLowerCase() === needle ||
    model.label.toLowerCase() === needle ||
    model.id.toLowerCase().includes(needle)
  ) ?? null;
}

export function resolveAgentRoleArgument<T extends { id: string; name: string; role?: string }>(
  value: string,
  roles: T[],
): T | null {
  const needle = value.trim().toLowerCase();
  if (!needle) return null;
  return roles.find(role =>
    role.id.toLowerCase() === needle ||
    role.name.toLowerCase() === needle ||
    role.role?.toLowerCase() === needle ||
    role.id.toLowerCase().includes(needle) ||
    role.name.toLowerCase().includes(needle)
  ) ?? null;
}

export function buildPlanPrompt(args: string): string {
  const task = args.trim();
  return task
    ? `Create a concise implementation plan for this task before editing. Stay read-only unless I explicitly ask you to implement it after the plan:\n\n${task}`
    : 'Create a concise implementation plan for the current workspace task before editing. Stay read-only unless I explicitly ask you to implement it after the plan.';
}
