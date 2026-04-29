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

  if (cli === 'codex') {
    const args: string[] = [];
    if (options.model?.trim()) {
      args.push('--model', options.model.trim());
    }
    if (options.yolo) {
      args.push('--dangerously-bypass-approvals-and-sandbox');
    } else {
      args.push('--ask-for-approval', 'never', '--sandbox', 'workspace-write');
    }
    args.push('exec', '--json', '--skip-git-repo-check', '-');

    return {
      command: 'codex',
      args,
      env,
      promptDelivery: 'stdin',
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

/**
 * Build a shell command that pipes a prompt file into `codex exec -` via the visible PTY.
 * Global flags (--model, --ask-for-approval, YOLO) must appear BEFORE `exec`.
 */
export function buildCodexVisibleExecCommand({
  promptPath,
  model,
  yolo,
  shellKind = 'windows',
}: {
  promptPath: string;
  model?: string | null;
  yolo?: boolean;
  shellKind?: ShellKind;
}): string {
  const codexParts: string[] = ['codex'];
  if (model?.trim()) codexParts.push('--model', model.trim());
  if (yolo) {
    codexParts.push('--dangerously-bypass-approvals-and-sandbox');
  } else {
    codexParts.push('--ask-for-approval', 'never', '--sandbox', 'workspace-write');
  }
  codexParts.push('exec', '--json', '--skip-git-repo-check', '-');
  const codexCmd = codexParts.join(' ');

  if (shellKind === 'windows') {
    const cmdPath = promptPath.replace(/"/g, '');
    const inner = `type "${cmdPath}" | ${codexCmd}`;
    return `cmd /d /s /c "${inner}"`;
  }
  if (shellKind === 'powershell') {
    // Single-quoted path: backslashes are literal in PowerShell single-quoted strings
    const psPath = promptPath.replace(/'/g, "''");
    return `Get-Content -Raw '${psPath}' | ${codexCmd}`;
  }
  if (shellKind === 'cmd') {
    const cmdPath = promptPath.replace(/"/g, '');
    return `type "${cmdPath}" | ${codexCmd}`;
  }
  // Unix bash/zsh
  const unixPath = promptPath.replace(/'/g, "'\\''");
  return `cat '${unixPath}' | ${codexCmd}`;
}

export function buildPtyLaunchCommand(cliId: string, options: { model?: string | null; yolo?: boolean }): string {
  const cli = normalizeCliId(cliId);
  const parts: string[] = [cliId];

  const supportsModelFlag = cli === 'claude' || cli === 'opencode' || cli === 'gemini' || cli === 'codex';
  if (options.model && supportsModelFlag) {
    parts.push('--model', options.model);
  }

  if (options.yolo) {
    if (cli === 'claude') parts.push('--dangerously-skip-permissions');
    else if (cli === 'gemini') parts.push('--yolo');
    else if (cli === 'codex') parts.push('--dangerously-bypass-approvals-and-sandbox');
    // opencode: --yolo is only valid for `opencode run`, not the default TUI mode.
  } else if (cli === 'codex') {
    parts.push('--ask-for-approval', 'never', '--sandbox', 'workspace-write');
  }

  return parts.join(' ');
}
