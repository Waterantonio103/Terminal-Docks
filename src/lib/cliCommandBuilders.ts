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
    return {
      command: 'claude',
      args: ['--print', '{prompt}'],
      env,
      promptDelivery: 'arg_text',
    };
  }

  if (cli === 'codex') {
    const codexEnv = { ...env };
    // Use a workspace-local Codex home by default to avoid profile ACL issues
    // (common on Windows when spawning from desktop app runtimes).
    if (!codexEnv.CODEX_HOME) {
      codexEnv.CODEX_HOME = '.terminal-docks\\codex-home';
    }

    // On Windows, `codex` is installed as `codex.cmd` (an npm shim) which
    // Command::new("codex") cannot find — it only resolves .exe.  Route through
    // cmd.exe so the shell resolves the .cmd extension and handles the < stdin
    // redirect (Rust's Command does not pipe stdin for us).
    // The prompt is pre-written to {promptPath} by the Rust backend before spawn.
    return {
      command: 'cmd',
      args: ['/c', 'codex exec --json --skip-git-repo-check -a never - < "{promptPath}"'],
      env: codexEnv,
      promptDelivery: 'arg_file',
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
