import type { RuntimeActivationPayload } from './missionRuntime.js';
import type { ExecutionMode } from './workflow/WorkflowTypes.js';
import {
  buildCliRunCommand,
  materializePromptArgs,
  type CliCommandBuilderOptions,
} from './cliCommandBuilders.js';

export interface StartAgentRunRequest {
  runId: string;
  missionId: string;
  nodeId: string;
  attempt: number;
  sessionId: string;
  agentId: string;
  cli: string;
  executionMode: ExecutionMode;
  cwd: string | null;
  command: string;
  args: string[];
  env: Record<string, string>;
  promptDelivery: string;
  prompt: string;
  timeoutMs?: number;
}

export function isHeadlessExecutionMode(mode: RuntimeActivationPayload['executionMode']): boolean {
  return mode === 'headless' || mode === 'streaming_headless';
}

export function buildStartAgentRunRequest(
  payload: RuntimeActivationPayload,
  prompt: string,
  options: CliCommandBuilderOptions = {},
): { request: StartAgentRunRequest | null; error: string | null } {
  const command = materializePromptArgs(buildCliRunCommand(payload, options), prompt);
  if (command.promptDelivery === 'unsupported') {
    return {
      request: null,
      error: command.unsupportedReason ?? 'Headless execution is unsupported for this CLI.',
    };
  }
  const replacements: Record<string, string> = {
    mcpUrl: options.mcpUrl ?? '',
    sessionId: payload.sessionId,
    missionId: payload.missionId,
    nodeId: payload.nodeId,
    attempt: String(payload.attempt),
    runId: payload.runId,
  };
  const replaceKnown = (value: string) =>
    Object.entries(replacements).reduce((acc, [key, replacement]) => acc.split(`{${key}}`).join(replacement), value);

  return {
    request: {
      runId: payload.runId,
      missionId: payload.missionId,
      nodeId: payload.nodeId,
      attempt: payload.attempt,
      sessionId: payload.sessionId,
      agentId: payload.agentId,
      cli: payload.cliType,
      executionMode: payload.executionMode,
      cwd: payload.workspaceDir ?? null,
      command: replaceKnown(command.command),
      args: command.args.map(replaceKnown),
      env: Object.fromEntries(Object.entries(command.env).map(([key, value]) => [key, replaceKnown(String(value))])),
      promptDelivery: command.promptDelivery,
      prompt,
    },
    error: null,
  };
}
