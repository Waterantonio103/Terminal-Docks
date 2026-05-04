import type { RuntimeActivationPayload } from './missionRuntime.js';
import { normalizeCliId, supportsHeadless } from './cliIdentity.js';

export type PromptDelivery = 'arg_file' | 'arg_text' | 'stdin' | 'unsupported';

export interface CliRunCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
  promptDelivery: PromptDelivery;
  unsupportedReason?: string;
}

export interface CliCommandBuilderOptions {
  customCommand?: string | null;
  customArgs?: string[] | null;
  customEnv?: Record<string, string> | null;
  mcpUrl?: string | null;
  localHttpUrl?: string | null;
  localHttpModel?: string | null;
  localHttpApiKey?: string | null;
  model?: string | null;
  yolo?: boolean;
}

function baseEnv(payload: RuntimeActivationPayload, mcpUrl?: string | null): Record<string, string> {
  const env: Record<string, string> = {
    TD_SESSION_ID: payload.sessionId,
    TD_AGENT_ID: payload.agentId,
    TD_MISSION_ID: payload.missionId,
    TD_NODE_ID: payload.nodeId,
    TD_ATTEMPT: String(payload.attempt),
    TD_RUN_ID: payload.runId,
    TD_EXECUTION_MODE: payload.executionMode,
  };
  if (mcpUrl) env.TD_MCP_URL = mcpUrl;
  if (payload.workspaceDir) env.TD_WORKSPACE = payload.workspaceDir;
  return env;
}

function unsupported(reason: string, env: Record<string, string>): CliRunCommand {
  return {
    command: '',
    args: [],
    env,
    promptDelivery: 'unsupported',
    unsupportedReason: reason,
  };
}

export function buildCliRunCommand(
  payload: RuntimeActivationPayload,
  options: CliCommandBuilderOptions = {},
): CliRunCommand {
  const cli = normalizeCliId(payload.cliType);
  const env = { ...baseEnv(payload, options.mcpUrl), ...(options.customEnv ?? {}) };

  if (!cli || !supportsHeadless(cli)) {
    return unsupported(
      `Headless command builder for "${cli ?? 'unknown'}" is not configured yet. Switch this node to interactive PTY or use a custom command template.`,
      env,
    );
  }

  if (cli === 'custom') {
    const command = options.customCommand?.trim();
    if (!command) {
      return unsupported('Custom headless execution requires a configured command.', env);
    }
    return {
      command,
      args: options.customArgs ?? ['{promptPath}'],
      env,
      promptDelivery: 'arg_file',
    };
  }

  if (cli === 'ollama' || cli === 'lmstudio') {
    const defaultUrl = cli === 'ollama'
      ? 'http://localhost:11434/v1/chat/completions'
      : 'http://localhost:1234/v1/chat/completions';
    const defaultModel = cli === 'ollama' ? 'llama3.1' : 'local-model';
    return {
      command: '__terminal_docks_local_http__',
      args: [],
      env: {
        ...env,
        TD_LOCAL_HTTP_PROVIDER: cli,
        TD_LOCAL_HTTP_URL:
          options.localHttpUrl ??
          options.customEnv?.TD_LOCAL_HTTP_URL ??
          options.customEnv?.LOCAL_HTTP_URL ??
          defaultUrl,
        TD_LOCAL_HTTP_MODEL:
          options.localHttpModel ??
          options.customEnv?.TD_LOCAL_HTTP_MODEL ??
          options.customEnv?.LOCAL_HTTP_MODEL ??
          defaultModel,
        ...(options.localHttpApiKey ?? options.customEnv?.TD_LOCAL_HTTP_API_KEY ?? options.customEnv?.LOCAL_HTTP_API_KEY
          ? {
              TD_LOCAL_HTTP_API_KEY:
                options.localHttpApiKey ??
                options.customEnv?.TD_LOCAL_HTTP_API_KEY ??
                options.customEnv?.LOCAL_HTTP_API_KEY ??
                '',
            }
          : {}),
      },
      promptDelivery: 'stdin',
    };
  }

  if (cli === 'claude') {
    const args = ['--print', '{prompt}'];
    if (options.model?.trim()) {
      args.unshift('--model', options.model.trim());
    }
    return {
      command: 'claude',
      args,
      env,
      promptDelivery: 'arg_text',
    };
  }

  return unsupported(`Unknown or unsupported CLI "${cli || 'unknown'}".`, env);
}

export function materializePromptArgs(command: CliRunCommand, prompt: string): CliRunCommand {
  if (command.promptDelivery !== 'arg_text') return command;
  return {
    ...command,
    args: command.args.map(arg => arg.split('{prompt}').join(prompt)),
  };
}

export type ShellKind = 'windows' | 'powershell' | 'cmd' | 'unix';

function quoteShellArgument(value: string, shellKind: ShellKind): string {
  if (shellKind === 'powershell') {
    return `'${value.replace(/'/g, "''")}'`;
  }
  if (shellKind === 'cmd' || shellKind === 'windows') {
    return `"${value.replace(/(["^])/g, '^$1')}"`;
  }
  return `'${value.replace(/'/g, `'\\''`)}'`;
}

function needsShellQuoting(value: string): boolean {
  return value === '' || /[\s"'`&|<>^()[\]{};$]/.test(value);
}

function quoteShellArgumentIfNeeded(value: string, shellKind: ShellKind): string {
  return needsShellQuoting(value) ? quoteShellArgument(value, shellKind) : value;
}

export function redactSensitiveLaunchValue(value: string): string {
  let redacted = value.replace(
    /https?:\/\/[^\s"'<>]+/gi,
    (match) => {
      try {
        const url = new URL(match);
        if (url.username) url.username = '<redacted>';
        if (url.password) url.password = '<redacted>';
        for (const key of Array.from(url.searchParams.keys())) {
          url.searchParams.set(key, '<redacted>');
        }
        return url.toString();
      } catch {
        return match.replace(/([?&][^=&#]+)=([^&#]+)/g, '$1=<redacted>');
      }
    },
  );

  redacted = redacted
    .replace(/(token|api[_-]?key|authorization|password|secret)=([^&\s"']+)/gi, '$1=<redacted>')
    .replace(/(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1<redacted>');

  return redacted;
}

export function formatLaunchArgsForLog(args: string[], options: { redactLastArg?: boolean } = {}): string {
  if (!args.length) return '[]';
  return `[${args.map((arg, index) => {
    if (options.redactLastArg && index === args.length - 1) return '<prompt:redacted>';
    return redactSensitiveLaunchValue(arg);
  }).join(', ')}]`;
}

// Cached result of resolveCodexYoloFlag — undefined means not yet probed.
let _cachedCodexYoloFlag: string | null | undefined = undefined;

/**
 * Detect the correct yolo flag for the installed Codex CLI.
 * Prefers --yolo (newer versions); falls back to --dangerously-bypass-approvals-and-sandbox.
 * Result is cached after first probe.
 */
export async function resolveCodexYoloFlag(): Promise<string | null> {
  if (_cachedCodexYoloFlag !== undefined) return _cachedCodexYoloFlag;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const helpText = await invoke<string>('get_command_output', {
      command: 'codex',
      args: ['--help'],
    }).catch(() => '');

    if (helpText.includes('--yolo')) {
      _cachedCodexYoloFlag = '--yolo';
    } else if (helpText.includes('--dangerously-bypass-approvals-and-sandbox')) {
      _cachedCodexYoloFlag = '--dangerously-bypass-approvals-and-sandbox';
    } else {
      console.warn('[codex] no supported yolo flag found in codex --help output; omitting yolo flag');
      _cachedCodexYoloFlag = null;
    }
  } catch (err) {
    console.warn('[codex] could not probe codex --help, defaulting to --dangerously-bypass-approvals-and-sandbox', err);
    _cachedCodexYoloFlag = '--dangerously-bypass-approvals-and-sandbox';
  }

  console.log(`[codex] resolved yolo flag=${_cachedCodexYoloFlag ?? '<none>'}`);
  return _cachedCodexYoloFlag;
}

function buildCodexInteractiveFlagArgs({
  modelId,
  yolo,
  workspaceDir,
  mcpUrl,
  resolvedYoloFlag,
}: {
  modelId?: string | null;
  yolo?: boolean;
  workspaceDir?: string | null;
  mcpUrl?: string | null;
  resolvedYoloFlag?: string | null;
}): string[] {
  const yoloFlag = yolo ? (resolvedYoloFlag ?? '--dangerously-bypass-approvals-and-sandbox') : null;
  console.log(`[codex] buildCodexInteractiveFlagArgs: resolved yolo flag=${yoloFlag ?? '<none>'}`);
  const args = [
    // Keep workflow-launched Codex sessions focused on Terminal Docks. The
    // user's Codex config may include unrelated MCP servers that add startup
    // latency or fail independently of the workflow under test.
    '-c',
    'mcp_servers.pencil.enabled=false',
    '-c',
    'mcp_servers.excalidraw.enabled=false',
    ...(mcpUrl?.trim() ? ['-c', `mcp_servers.terminal-docks.url="${mcpUrl.trim()}"`] : []),
    ...(modelId?.trim() ? ['--model', modelId.trim()] : []),
    ...(workspaceDir?.trim() ? ['--cd', workspaceDir.trim()] : []),
    '--no-alt-screen',
    ...(yoloFlag ? [yoloFlag] : []),
  ];
  console.log(`[codex] final codex args (no prompt)=${formatLaunchArgsForLog(args)}`);
  return args;
}

export function buildCodexInteractiveLaunchCommand({
  modelId,
  yolo,
  workspaceDir,
  mcpUrl,
  bootstrapPrompt,
  resolvedYoloFlag,
  shellKind = 'windows',
}: {
  modelId?: string | null;
  yolo?: boolean;
  workspaceDir?: string | null;
  mcpUrl?: string | null;
  bootstrapPrompt: string;
  resolvedYoloFlag?: string | null;
  shellKind?: ShellKind;
}): string {
  const normalizedPrompt = bootstrapPrompt.replace(/\s+/g, ' ').trim();
  const parts: string[] = ['codex', ...buildCodexInteractiveFlagArgs({ modelId, yolo, workspaceDir, mcpUrl, resolvedYoloFlag })];
  parts.push(quoteShellArgument(normalizedPrompt, shellKind));
  return parts.join(' ');
}

export function buildCodexInteractiveLaunchArgs({
  modelId,
  yolo,
  workspaceDir,
  mcpUrl,
  bootstrapPrompt,
  resolvedYoloFlag,
}: {
  modelId?: string | null;
  yolo?: boolean;
  workspaceDir?: string | null;
  mcpUrl?: string | null;
  bootstrapPrompt: string;
  resolvedYoloFlag?: string | null;
}): string[] {
  return [
    ...buildCodexInteractiveFlagArgs({ modelId, yolo, workspaceDir, mcpUrl, resolvedYoloFlag }),
    bootstrapPrompt,
  ];
}

function escapeInlineInstruction(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

export function buildCodexFollowupTaskSignal({
  sessionId,
  missionId,
  nodeId,
  attempt,
}: {
  sessionId?: string | null;
  missionId?: string | null;
  nodeId?: string | null;
  attempt?: number | null;
} = {}): string {
  if (missionId?.trim() && nodeId?.trim()) {
    const escapedMissionId = escapeInlineInstruction(missionId.trim());
    const escapedNodeId = escapeInlineInstruction(nodeId.trim());
    const safeAttempt = Number.isInteger(attempt) && Number(attempt) > 0 ? Number(attempt) : 1;
    return `NEW_TASK. call get_task_details({ missionId: "${escapedMissionId}", nodeId: "${escapedNodeId}" }), execute it, then call complete_task({ missionId: "${escapedMissionId}", nodeId: "${escapedNodeId}", attempt: ${safeAttempt}, outcome: "success" or "failure", summary: "<concise summary>" }) as the final MCP action. Do not stop after a normal final answer.`;
  }
  if (sessionId?.trim()) {
    const escaped = escapeInlineInstruction(sessionId.trim());
    return `NEW_TASK. call get_current_task({ sessionId: "${escaped}" }), execute it, then call complete_task as the final MCP action. Do not stop after a normal final answer.`;
  }
  return 'NEW_TASK. call get_current_task(), execute it, then call complete_task as the final MCP action. Do not stop after a normal final answer.';
}

export interface PtyLaunchOptions {
  model?: string | null;
  yolo?: boolean;
  workspaceDir?: string | null;
  shellKind?: ShellKind;
}

export function buildPtyLaunchCommand(cliId: string, options: PtyLaunchOptions = {}): string {
  const { command, args } = buildPtyLaunchCommandParts(cliId, options);
  const shellKind = options.shellKind ?? 'windows';
  return [command, ...args.map(arg => quoteShellArgumentIfNeeded(arg, shellKind))].join(' ');
}

export interface PtyLaunchParts {
  command: string;
  args: string[];
}

export function buildPtyLaunchCommandParts(
  cliId: string,
  options: PtyLaunchOptions = {},
): PtyLaunchParts {
  const cli = normalizeCliId(cliId);
  const model = options.model?.trim();
  const workspaceDir = options.workspaceDir?.trim();

  if (cli === 'claude') {
    const args: string[] = [];
    if (model) args.push('--model', model);
    if (options.yolo) args.push('--dangerously-skip-permissions');
    return { command: 'claude', args };
  }

  if (cli === 'gemini') {
    const args: string[] = [];
    if (model) args.push('--model', model);
    if (options.yolo) args.push('--approval-mode', 'yolo');
    return { command: 'gemini', args };
  }

  if (cli === 'opencode') {
    const args: string[] = [];
    // OpenCode has no confirmed alt-screen or mouse-disable flags. Its TUI
    // accepts the project path as the deterministic workspace input.
    if (workspaceDir) args.push(workspaceDir);
    if (model) args.push('--model', model);
    return { command: 'opencode', args };
  }

  if (cli === 'codex') {
    const args: string[] = [];
    if (model) args.push('--model', model);
    if (workspaceDir) args.push('--cd', workspaceDir);
    args.push('--no-alt-screen');
    if (options.yolo) args.push('--dangerously-bypass-approvals-and-sandbox');
    return { command: 'codex', args };
  }

  return { command: cliId, args: [] };
}
