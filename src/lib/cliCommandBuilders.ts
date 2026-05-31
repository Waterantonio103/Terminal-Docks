import type { RuntimeActivationPayload } from './missionRuntime.js';
import { normalizeCliId, supportsHeadless } from './cliIdentity.js';
import { buildCometRuntimeEnv, readCometEnv } from './runtimeEnv.js';
import { scopedDebugLog } from './debugLog.js';

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
  return buildCometRuntimeEnv({
    sessionId: payload.sessionId,
    agentId: payload.agentId,
    missionId: payload.missionId,
    nodeId: payload.nodeId,
    attempt: payload.attempt,
    runId: payload.runId,
    executionMode: payload.executionMode,
    mcpUrl,
    workspaceDir: payload.workspaceDir,
  });
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

function normalizeOpenCodeMcpUrl(value?: string | null): string | null {
  const trimmed = value?.trim();
  if (!trimmed) return null;

  try {
    const url = new URL(trimmed);
    const currentPath = url.pathname.replace(/\/+$/, '');
    url.pathname = currentPath.endsWith('/mcp') ? currentPath : `${currentPath || ''}/mcp`;
    url.hash = '';
    return url.toString();
  } catch {
    const base = trimmed.split('#')[0]?.replace(/\/+$/, '') ?? '';
    return base.endsWith('/mcp') ? base : `${base}/mcp`;
  }
}

export function buildOpenCodeWorkflowConfigContent(mcpUrl?: string | null): string {
  const normalizedMcpUrl = normalizeOpenCodeMcpUrl(mcpUrl);
  return JSON.stringify({
    $schema: 'https://opencode.ai/config.json',
    ...(normalizedMcpUrl
      ? {
          mcp: {
            starlink: {
              type: 'remote',
              url: normalizedMcpUrl,
              enabled: true,
            },
          },
          tools: {
            'starlink*': true,
            'starlink_*': true,
          },
        }
      : {}),
    permission: 'allow',
  });
}

export function buildOpenCodeHeadlessRunCommand({
  env,
  mcpUrl,
  model,
  workspaceDir,
}: {
  env: Record<string, string>;
  mcpUrl?: string | null;
  model?: string | null;
  workspaceDir?: string | null;
}): CliRunCommand {
  const args = ['run', '--format', 'json'];
  const workspace = workspaceDir?.trim();
  const modelId = model?.trim();

  if (workspace) args.push('--dir', workspace);
  if (modelId) args.push('--model', modelId);
  args.push('--dangerously-skip-permissions', '{prompt}');

  return {
    command: 'opencode',
    args,
    env: {
      ...env,
      OPENCODE_CONFIG_CONTENT:
        env.OPENCODE_CONFIG_CONTENT?.trim() || buildOpenCodeWorkflowConfigContent(mcpUrl),
    },
    promptDelivery: 'arg_text',
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
    const localHttpUrl =
      options.localHttpUrl ??
      readCometEnv(options.customEnv, 'LOCAL_HTTP_URL', 'LOCAL_HTTP_URL') ??
      defaultUrl;
    const localHttpModel =
      options.localHttpModel ??
      readCometEnv(options.customEnv, 'LOCAL_HTTP_MODEL', 'LOCAL_HTTP_MODEL') ??
      defaultModel;
    const localHttpApiKey =
      options.localHttpApiKey ??
      readCometEnv(options.customEnv, 'LOCAL_HTTP_API_KEY', 'LOCAL_HTTP_API_KEY') ??
      '';
    return {
      command: '__comet_ai_local_http__',
      args: [],
      env: {
        ...env,
        COMET_LOCAL_HTTP_PROVIDER: cli,
        TD_LOCAL_HTTP_PROVIDER: cli,
        COMET_LOCAL_HTTP_URL: localHttpUrl,
        TD_LOCAL_HTTP_URL: localHttpUrl,
        COMET_LOCAL_HTTP_MODEL: localHttpModel,
        TD_LOCAL_HTTP_MODEL: localHttpModel,
        ...(localHttpApiKey
          ? {
              COMET_LOCAL_HTTP_API_KEY: localHttpApiKey,
              TD_LOCAL_HTTP_API_KEY: localHttpApiKey,
            }
          : {}),
      },
      promptDelivery: 'stdin',
    };
  }

  if (cli === 'opencode') {
    return buildOpenCodeHeadlessRunCommand({
      env,
      mcpUrl: options.mcpUrl,
      model: options.model ?? payload.modelId ?? null,
      workspaceDir: payload.workspaceDir,
    });
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

export function withCodexHomeForShell(command: string, shellKind: ShellKind = 'windows'): string {
  if (shellKind === 'powershell') {
    return `$env:CODEX_HOME = "$env:USERPROFILE\\.codex"; ${command}`;
  }
  if (shellKind === 'unix') {
    return `CODEX_HOME="$HOME/.codex" ${command}`;
  }
  return `set "CODEX_HOME=%USERPROFILE%\\.codex" && ${command}`;
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

export function cliDebugLog(...args: unknown[]): void {
  scopedDebugLog('cli', 'VITE_CLI_DEBUG', ...args);
}

// Cached result of resolveCodexYoloFlag — undefined means not yet probed.
let _cachedCodexYoloFlag: string | null | undefined = undefined;

export function normalizeCodexModelId(modelId: string | null | undefined): string | null {
  const trimmed = typeof modelId === 'string' ? modelId.trim() : '';
  if (!trimmed) return null;
  if (!isModelCompatibleWithCli('codex', trimmed)) return null;
  if (/^gpt-\d/i.test(trimmed) || /^o\d/i.test(trimmed) || /^codex/i.test(trimmed)) {
    return trimmed.toLowerCase();
  }
  return trimmed;
}

export function isModelCompatibleWithCli(cliId: string, modelId: string | null | undefined): boolean {
  const model = typeof modelId === 'string' ? modelId.trim().toLowerCase() : '';
  if (!model) return true;
  const cli = normalizeCliId(cliId);

  const looksClaude = model.startsWith('anthropic/')
    || model.startsWith('claude-')
    || /\b(?:sonnet|opus|haiku)\b/.test(model);
  const looksGemini = model.startsWith('google/')
    || model.startsWith('gemini-')
    || model.includes('/gemini-');
  const looksOpenAi = model.startsWith('openai/')
    || /^gpt-\d/.test(model)
    || /^o\d/.test(model)
    || model.startsWith('codex');

  if (cli === 'codex') return looksOpenAi && !looksClaude && !looksGemini;
  if (cli === 'claude') return looksClaude && !looksOpenAi && !looksGemini;
  if (cli === 'gemini') return looksGemini && !looksOpenAi && !looksClaude;
  return true;
}

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

  cliDebugLog(`[codex] resolved yolo flag=${_cachedCodexYoloFlag ?? '<none>'}`);
  return _cachedCodexYoloFlag;
}

function buildCodexInteractiveFlagArgs({
  modelId,
  yolo,
  workspaceDir,
  mcpUrl,
  resolvedYoloFlag,
  disableKnownGlobalMcps = true,
  trustedProjectDir,
}: {
  modelId?: string | null;
  yolo?: boolean;
  workspaceDir?: string | null;
  mcpUrl?: string | null;
  resolvedYoloFlag?: string | null;
  disableKnownGlobalMcps?: boolean;
  trustedProjectDir?: string | null;
}): string[] {
  const yoloFlag = yolo ? (resolvedYoloFlag ?? '--dangerously-bypass-approvals-and-sandbox') : null;
  const normalizedModelId = normalizeCodexModelId(modelId);
  const trustedProject = trustedProjectDir?.trim();
  const trustedProjectKey = trustedProject ? trustedProject.replace(/"/g, '\\"') : null;
  cliDebugLog(`[codex] buildCodexInteractiveFlagArgs: resolved yolo flag=${yoloFlag ?? '<none>'}`);
  const args = [
    // Keep workflow-launched Codex sessions focused on Comet-AI. The
    // user's Codex config may include unrelated MCP servers that add startup
    // latency or fail independently of the workflow under test.
    ...(disableKnownGlobalMcps ? [
      '-c',
      'mcp_servers.pencil.enabled=false',
      '-c',
      'mcp_servers.excalidraw.enabled=false',
    ] : []),
    ...(trustedProjectKey ? [
      '-c',
      `projects."${trustedProjectKey}".trust_level="trusted"`,
    ] : []),
    '-c',
    'approval_policy="never"',
    '-c',
    'sandbox_mode="danger-full-access"',
    ...(mcpUrl?.trim() ? [
      '-c',
      `mcp_servers.starlink.url="${mcpUrl.trim()}"`,
      '-c',
      'mcp_servers.starlink.enabled=true',
      '-c',
      'mcp_servers.starlink.startup_timeout_sec=30',
      '-c',
      'mcp_servers.starlink.tool_timeout_sec=120',
    ] : []),
    ...(normalizedModelId ? ['--model', normalizedModelId] : []),
    ...(workspaceDir?.trim() ? ['--cd', workspaceDir.trim()] : []),
    '--no-alt-screen',
    ...(yoloFlag ? [yoloFlag] : []),
  ];
  cliDebugLog(`[codex] final codex args (no prompt)=${formatLaunchArgsForLog(args)}`);
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
  disableKnownGlobalMcps,
  trustedProjectDir,
}: {
  modelId?: string | null;
  yolo?: boolean;
  workspaceDir?: string | null;
  mcpUrl?: string | null;
  bootstrapPrompt: string;
  resolvedYoloFlag?: string | null;
  shellKind?: ShellKind;
  disableKnownGlobalMcps?: boolean;
  trustedProjectDir?: string | null;
}): string {
  const normalizedPrompt = bootstrapPrompt.replace(/\s+/g, ' ').trim();
  const parts: string[] = ['codex', ...buildCodexInteractiveFlagArgs({ modelId, yolo, workspaceDir, mcpUrl, resolvedYoloFlag, disableKnownGlobalMcps, trustedProjectDir })];
  parts.push(quoteShellArgument(normalizedPrompt, shellKind));
  return withCodexHomeForShell(parts.join(' '), shellKind);
}

export function buildCodexInteractiveLaunchArgs({
  modelId,
  yolo,
  workspaceDir,
  mcpUrl,
  bootstrapPrompt,
  resolvedYoloFlag,
  disableKnownGlobalMcps,
  trustedProjectDir,
}: {
  modelId?: string | null;
  yolo?: boolean;
  workspaceDir?: string | null;
  mcpUrl?: string | null;
  bootstrapPrompt: string;
  resolvedYoloFlag?: string | null;
  disableKnownGlobalMcps?: boolean;
  trustedProjectDir?: string | null;
}): string[] {
  return [
    ...buildCodexInteractiveFlagArgs({ modelId, yolo, workspaceDir, mcpUrl, resolvedYoloFlag, disableKnownGlobalMcps, trustedProjectDir }),
    bootstrapPrompt,
  ];
}

export function buildGeminiInteractiveLaunchCommand({
  modelId,
  yolo,
  workspaceDir,
  prompt,
  shellKind = 'windows',
}: {
  modelId?: string | null;
  yolo?: boolean;
  workspaceDir?: string | null;
  prompt: string;
  shellKind?: ShellKind;
}): string {
  const { command, args } = buildPtyLaunchCommandParts('gemini', {
    model: modelId,
    yolo,
    workspaceDir,
  });
  return [
    command,
    ...args.map(arg => quoteShellArgumentIfNeeded(arg, shellKind)),
    '--prompt-interactive',
    quoteShellArgument(prompt.replace(/\s+/g, ' ').trim(), shellKind),
  ].join(' ');
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
    return `NEW_TASK. call get_task_details({ missionId: "${escapedMissionId}", nodeId: "${escapedNodeId}" }); the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call complete_task({ missionId: "${escapedMissionId}", nodeId: "${escapedNodeId}", attempt: ${safeAttempt}, outcome: "success" or "failure", summary: "<concise summary>" }) as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.`;
  }
  if (sessionId?.trim()) {
    const escaped = escapeInlineInstruction(sessionId.trim());
    return `NEW_TASK. call get_current_task({ sessionId: "${escaped}" }); the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call complete_task as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.`;
  }
  return 'NEW_TASK. call get_current_task(); the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call complete_task as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.';
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
  const shellCommand = [command, ...args.map(arg => quoteShellArgumentIfNeeded(arg, shellKind))].join(' ');
  return normalizeCliId(cliId) === 'codex'
    ? withCodexHomeForShell(shellCommand, shellKind)
    : shellCommand;
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
    const codexModel = normalizeCodexModelId(model);
    if (codexModel) args.push('--model', codexModel);
    if (workspaceDir) args.push('--cd', workspaceDir);
    args.push('--no-alt-screen');
    if (options.yolo) args.push('--dangerously-bypass-approvals-and-sandbox');
    return { command: 'codex', args };
  }

  return { command: cliId, args: [] };
}
