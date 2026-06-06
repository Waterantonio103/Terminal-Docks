import type {
  CliAdapter,
  CompletionDetectionResult,
  LaunchCommand,
  LaunchContext,
  PermissionDecision,
  PermissionDetectionResult,
  PermissionRequest,
  PermissionResponse,
  ReadyDetectionResult,
  RuntimeOutputEvent,
  StatusDetectionResult,
  TaskContext,
} from './CliAdapter.js';
import { cliDebugLog, formatLaunchArgsForLog, normalizeCliPermissionMode, normalizeCliReasoningEffort, normalizeCodexModelId } from '../../cliCommandBuilders.js';
import { buildCometRuntimeEnv } from '../../runtimeEnv.js';

const ANSI_RE =
  /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const BANNER_RE = /\bcodex\b/i;
const PROMPT_RE = /(?:^|\n)\s*(?:›|\uff1e|❯|Input:|Prompt:)\s*(?:\S.*)?$/m;
const INLINE_PROMPT_RE = /(?:^|[\n\r]|[╯│]\s*)\s*(?:›|\uff1e|❯|Input:|Prompt:)\s*(?:\S.*)?(?:$|\bgpt-[\w.-]+\b[\s\S]{0,160}\bContext\b)/m;
const SHELL_PROMPT_RE = /(?:^|\n)\s*(?:[A-Za-z]:\\[^>\r\n]*>|PS [^>\r\n]*>|[$#>])\s*$/m;
const CODEX_FOOTER_RE = /(?:\bgpt-[\w.-]+(?:\s+\w+)?\b[\s\S]{0,120}\bContext\s+\d+%\s+(?:left|used)\b|\bContext\s+\d+%\s+left\b[\s\S]{0,80}\bContext\s+\d+%\s+used\b|\bFast\s+(?:on|off)\b)/i;
const CODEX_COMPACT_FOOTER_RE = /\bgpt-[\w.-]+(?:\s+\w+)?\b\s*·\s*[^·\r\n]{2,160}\s*·\s*gpt-[\w.-]+(?:\s+\w+)?\b(?:\s*·\s*[^\r\n]{1,120})?/i;
const CODEX_UI_RE = /(?:\bcodex\b|\bgpt-[\w.-]+\b|\bContext\s+\d+%\s+(?:left|used)\b|\bFast\s+(?:on|off)\b|›)/i;
const MODEL_STATE_RE = /\bmodel:\s*([^│\n\r]*?)(?:\/model\s+to\s+change|│|$)/i;
const ACTIVE_WORK_RE =
  /(?:\bWorking\b|\bBooting MCP server\b|\bStarting MCP servers\b|\bqueued message\b|\btab to queue message\b|\bPasted Content\b|\besc to interrupt\b|\bctrl-c to interrupt\b|\boperation in progress\b)/i;
const MCP_STARTUP_ACTIVE_RE = /(?:\bBooting MCP server\b|\bStarting MCP servers\b)/i;
const INTERRUPTED_IDLE_RE = /\bConversation interrupted\b|\btell the model what to do differently\b/i;
const MCP_PERMISSION_PROMPT_RE =
  /Allow\s+the\s+.+?\s+MCP\s+server\s+to\s+run\s+tool\s+"[^"]+"\?\s*[\s\S]*(?:\b1\.\s*Allow\b|\bAlways\s+allow\b|\benter\s+to\s+submit\b)/i;
const GENERIC_PERMISSION_PROMPT_RE =
  /(?:allow|approve|grant)\s+(?:this\s+)?(?:command|tool|operation|request|permission)\??\s*[\s\S]*(?:\b1\.\s*Allow\b|\bAlways\s+allow\b|\by\/n\b|\[y\/n\])/i;
const CONFIRMATION_PERMISSION_PROMPT_RE =
  /(?:\bproceed\??\s*(?:\(\s*y\s*\)|\[\s*y\s*\/\s*n\s*\]|\byes\b|\by\/n\b)|\b(?:yes|no)\b[\s\S]{0,80}\b(?:approve|deny|edit|edits|command|tool|proceed)\b|\bapprove\s+edits\s+manually\b)/i;
const CODEX_STARTUP_PERMISSION_PROMPT_RE =
  /(?:\b(?:do\s+you\s+)?(?:want\s+to\s+)?trust\s+(?:the\s+)?(?:files\s+in\s+)?(?:this\s+)?folder\b[\s\S]{0,180}(?:\by\s*\/\s*n\b|\[\s*y\s*\/\s*n\s*\]|\(\s*y\s*\/\s*n\s*\)|\byes\b|\bno\b|\?)|\b(?:enable|allow|approve|grant|turn\s+on)\s+(?:the\s+)?(?:admin\s+)?sandbox\b[\s\S]{0,220}(?:\by\s*\/\s*n\b|\[\s*y\s*\/\s*n\s*\]|\(\s*y\s*\/\s*n\s*\)|\byes\b|\bno\b|\?)|\badmin\s+sandbox\b[\s\S]{0,220}(?:\by\s*\/\s*n\b|\[\s*y\s*\/\s*n\s*\]|\(\s*y\s*\/\s*n\s*\)|\byes\b|\bno\b|\?))/i;
const CODEX_UPDATE_PROMPT_RE =
  /Update available(?:[!:]|\s)[\s\S]{0,800}\b1\.\s*Update now\b[\s\S]{0,400}\b2\.\s*Skip\b[\s\S]{0,400}\bPress enter to continue\b/i;
const COMPLETION_RE = /(?:\btask\s+(?:completed|complete)\b|turn\.completed|exit code\s+0|(?:^|\n)\s*[─-]+\s*worked for\b|\bworked for\s+\d+\s*(?:s|m|h))/i;
const FAILURE_RE =
  /(?:\btask\s+failed\b|\bfatal error\b|\buncaught exception\b|\bMCP error\b|exit code\s+[1-9]|\bfailed process\b|\bcommand not found\b|\bnot recognized as\b|\bunknown option\b|\bunexpected argument\b|\binvalid flag\b|(?:^|\n)\s*(?:error|fatal):)/i;
const MCP_TOOL_NAME_RE = /run\s+tool\s+"([^"]+)"/i;

function stripTerminalControls(output: string): string {
  return output
    .replace(ANSI_RE, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '');
}

function lastNonEmptyLines(output: string, count: number): string {
  return output
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim())
    .slice(-count)
    .join('\n');
}

function lastMatchingLineIndex(output: string, pattern: RegExp): number {
  const flags = pattern.flags.replace(/g/g, '');
  const matcher = new RegExp(pattern.source, flags);
  return output
    .split('\n')
    .reduce((lastIndex, line, index) => matcher.test(line) ? index : lastIndex, -1);
}

function lastCodexModelState(output: string): { offset: number; loading: boolean } | null {
  const matcher = new RegExp(MODEL_STATE_RE.source, 'ig');
  let lastState: { offset: number; loading: boolean } | null = null;
  let match: RegExpExecArray | null;
  while ((match = matcher.exec(output)) !== null) {
    const value = (match[1] ?? '').trim().toLowerCase();
    if (value) {
      lastState = {
        offset: match.index,
        loading: /^loading\b/.test(value),
      };
    }
    if (match[0].length === 0) matcher.lastIndex += 1;
  }
  return lastState;
}

function escapeInstructionValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

function extractActivationField(signal: string, key: string): string | null {
  const quoted = new RegExp(`"${key}"\\s*:\\s*"([^"]+)"`).exec(signal);
  if (quoted?.[1]) return quoted[1];
  const yamlish = new RegExp(`${key}\\s*:\\s*"([^"]+)"`).exec(signal);
  return yamlish?.[1] ?? null;
}

function extractActivationNumber(signal: string, key: string): number | null {
  const match = new RegExp(`"?${key}"?\\s*:\\s*(\\d+)`).exec(signal);
  if (!match?.[1]) return null;
  const value = Number(match[1]);
  return Number.isInteger(value) && value > 0 ? value : null;
}

export const codexAdapter: CliAdapter = {
  id: 'codex',
  label: 'Codex',

  // Use the standard interactive PTY launch path. Codex needs a stricter
  // ready gate plus a quieter post-launch injection window than the other CLIs.
  postReadySettleDelayMs: 1200,

  buildLaunchCommand(context: LaunchContext): LaunchCommand {
    const env: Record<string, string> = {
      ...buildCometRuntimeEnv({
        sessionId: context.sessionId,
        agentId: context.agentId,
        missionId: context.missionId,
        nodeId: context.nodeId,
        mcpUrl: context.mcpUrl,
        workspaceDir: context.workspaceDir ?? '',
        kind: 'codex',
      }),
      ...(context.envOverrides ?? {}),
    };

    if (context.executionMode === 'headless' || context.executionMode === 'streaming_headless') {
      return {
        command: '',
        args: [],
        env,
        promptDelivery: 'unsupported',
        unsupportedReason: 'Headless command builder for "codex" is not configured yet. Switch this node to interactive PTY or use a custom command template.',
      };
    }

    const permissionMode = normalizeCliPermissionMode(context.permissionMode, context.yolo);
    const args: string[] = [
      '-c',
      'mcp_servers.pencil.enabled=false',
      '-c',
      'mcp_servers.excalidraw.enabled=false',
      '-c',
      'mcp_servers.terminal-docks.enabled=false',
      '-c',
      'mcp_servers.node_repl.enabled=false',
      '--disable',
      'apps',
      ...(context.mcpUrl?.trim() ? [
        '-c',
        `mcp_servers.starlink.url="${context.mcpUrl.trim()}"`,
        '-c',
        'mcp_servers.starlink.enabled=true',
        '-c',
        'mcp_servers.starlink.startup_timeout_sec=30',
        '-c',
        'mcp_servers.starlink.tool_timeout_sec=120',
      ] : []),
      ...(permissionMode === 'restricted' ? [
        '--sandbox',
        'read-only',
        '--ask-for-approval',
        'untrusted',
      ] : []),
      ...(permissionMode === 'default' ? [
        '--sandbox',
        'workspace-write',
        '--ask-for-approval',
        'untrusted',
      ] : []),
    ];
    const reasoningEffort = normalizeCliReasoningEffort(context.reasoningEffort);
    if (reasoningEffort) args.push('-c', `model_reasoning_effort=${reasoningEffort}`);
    const model = normalizeCodexModelId(context.model);
    if (model) args.push('--model', model);
    if (context.workspaceDir?.trim()) args.push('--cd', context.workspaceDir.trim());
    args.push('--no-alt-screen');
    const yoloFlag = '--dangerously-bypass-approvals-and-sandbox';
    if (permissionMode === 'full') {
      args.push(yoloFlag);
      cliDebugLog(`[codex] resolved yolo flag=${yoloFlag}`);
    } else {
      cliDebugLog(`[codex] resolved yolo flag=<none> (permissionMode=${permissionMode})`);
    }
    cliDebugLog(`[codex] final codex args (no prompt)=${formatLaunchArgsForLog(args)}`);
    return {
      command: 'codex',
      args,
      env,
      promptDelivery: 'interactive_pty',
    };
  },

  detectReady(output: string): ReadyDetectionResult {
    const status = this.detectStatus(output);
    return {
      ready: status.status === 'idle',
      confidence: status.confidence,
      detail: status.detail,
    };
  },

  detectStatus(output: string): StatusDetectionResult {
    const clean = stripTerminalControls(output);
    const recent = lastNonEmptyLines(clean, 24);
    const hasCodexUi = CODEX_UI_RE.test(clean);
    const lastLine = lastNonEmptyLines(recent || clean, 1);

    if (this.detectPermissionRequest(recent || clean)) {
      return { status: 'waiting_user_answer', confidence: 'high', detail: 'Codex permission prompt detected' };
    }

    if (FAILURE_RE.test(recent || clean)) {
      return { status: 'error', confidence: 'high', detail: 'Codex failure output detected' };
    }

    if (COMPLETION_RE.test(recent || clean)) {
      return { status: 'completed', confidence: 'high', detail: 'Codex completion marker detected' };
    }

    const recentOrClean = recent || clean;
    const hasPrompt = PROMPT_RE.test(recentOrClean) || INLINE_PROMPT_RE.test(recentOrClean);
    const hasCodexFooter = CODEX_FOOTER_RE.test(recentOrClean) || CODEX_COMPACT_FOOTER_RE.test(recentOrClean);
    const hasIdlePrompt = hasCodexUi && hasPrompt && hasCodexFooter;
    const idlePromptLineIndex = hasIdlePrompt
      ? Math.max(
        lastMatchingLineIndex(clean, PROMPT_RE),
        lastMatchingLineIndex(clean, CODEX_FOOTER_RE),
        lastMatchingLineIndex(clean, CODEX_COMPACT_FOOTER_RE),
      )
      : -1;
    const modelState = lastCodexModelState(clean);
    const modelLoadingIsCurrent = modelState?.loading === true;
    const activeWorkLineIndex = lastMatchingLineIndex(clean, ACTIVE_WORK_RE);
    const mcpStartupLineIndex = lastMatchingLineIndex(clean, MCP_STARTUP_ACTIVE_RE);
    const mcpStartupIsCurrent = mcpStartupLineIndex >= 0
      && (!hasIdlePrompt || mcpStartupLineIndex > idlePromptLineIndex);
    const activeWorkIsCurrent = activeWorkLineIndex >= 0
      && (
        !hasIdlePrompt
        || activeWorkLineIndex > idlePromptLineIndex
      );
    if (hasIdlePrompt && INTERRUPTED_IDLE_RE.test(recent || clean)) {
      return { status: 'idle', confidence: 'high', detail: 'Codex input prompt and footer detected' };
    }

    if (modelLoadingIsCurrent) {
      return { status: 'processing', confidence: 'high', detail: 'Codex model is still loading' };
    }

    if (mcpStartupIsCurrent || activeWorkIsCurrent) {
      return { status: 'processing', confidence: 'high', detail: 'Codex active work indicator detected' };
    }

    if (hasIdlePrompt) {
      return { status: 'idle', confidence: 'high', detail: 'Codex input prompt and footer detected' };
    }

    if (SHELL_PROMPT_RE.test(lastLine)) {
      return { status: 'error', confidence: 'low', detail: 'Shell prompt visible - CLI may have exited' };
    }

    if (BANNER_RE.test(clean) || hasCodexUi) {
      return { status: 'processing', confidence: 'low', detail: 'Codex UI detected, waiting for idle prompt' };
    }

    if (PROMPT_RE.test(recent || clean)) {
      return { status: 'processing', confidence: 'low', detail: 'Prompt-like output without Codex footer - waiting' };
    }

    return { status: 'processing', confidence: 'low', detail: 'Codex output is not ready' };
  },

  buildInitialPrompt(context: TaskContext): string {
    return `NEW_TASK. call get_task_details({ missionId: "${escapeInstructionValue(context.missionId)}", nodeId: "${escapeInstructionValue(context.nodeId)}" }); the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call complete_task({ missionId: "${escapeInstructionValue(context.missionId)}", nodeId: "${escapeInstructionValue(context.nodeId)}", attempt: ${context.attempt}, outcome: "success" or "failure", summary: "<concise summary>" }) as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.`;
  },

  detectPermissionRequest(output: string): PermissionDetectionResult | null {
    const clean = stripTerminalControls(output);
    if (CODEX_UPDATE_PROMPT_RE.test(clean)) {
      const lines = clean.split('\n').filter(l => l.trim());
      const promptLine = lines.slice(-16).join('\n');
      return {
        detected: true,
        request: {
          permissionId: `codex-update-${Date.now()}`,
          category: 'package_install',
          rawPrompt: promptLine,
          detail: 'Codex CLI update available. Update now? Skipping continues this prompt without updating.',
        },
      };
    }

    if (!MCP_PERMISSION_PROMPT_RE.test(clean) && !GENERIC_PERMISSION_PROMPT_RE.test(clean) && !CONFIRMATION_PERMISSION_PROMPT_RE.test(clean) && !CODEX_STARTUP_PERMISSION_PROMPT_RE.test(clean)) {
      return null;
    }

    const lines = clean.split('\n').filter(l => l.trim());
    const promptLine = lines.slice(-12).join('\n');

    const mcpTool = MCP_TOOL_NAME_RE.exec(promptLine)?.[1]?.toLowerCase() ?? '';
    let category: PermissionRequest['category'] = 'unknown';
    if (mcpTool && /(?:read|get|list|search|find|stat|metadata)/i.test(mcpTool)) category = 'file_read';
    else if (mcpTool && /(?:write|edit|patch|replace|move|delete|create|mkdir|touch)/i.test(mcpTool)) category = 'file_edit';
    else if (mcpTool && /(?:shell|exec|run|command|terminal|spawn|process)/i.test(mcpTool)) category = 'shell_execution';
    else if (/admin\s+sandbox|bash|command|shell|exec|run\s/i.test(promptLine)) category = 'shell_execution';
    else if (/trust\s+(?:the\s+)?(?:files\s+in\s+)?(?:this\s+)?folder/i.test(promptLine)) category = 'file_read';
    else if (/edit|write|create|modify|delete.*file/i.test(promptLine)) category = 'file_edit';
    else if (/read|cat|open.*file/i.test(promptLine)) category = 'file_read';
    else if (/network|fetch|curl|http|request/i.test(promptLine)) category = 'network_access';
    else if (/install|npm|pip|cargo|package/i.test(promptLine)) category = 'package_install';

    return {
      detected: true,
      request: {
        permissionId: `perm-${Date.now()}`,
        category,
        rawPrompt: promptLine,
        detail: promptLine,
      },
    };
  },

  buildPermissionResponse(decision: PermissionDecision, _request: PermissionRequest): PermissionResponse {
    if (CODEX_UPDATE_PROMPT_RE.test(_request.rawPrompt ?? _request.detail ?? '')) {
      return { input: decision === 'approve' ? '1\r' : '2\r' };
    }
    if (decision === 'approve' && /\b1\.\s*Allow\b|enter\s+to\s+submit/i.test(_request.rawPrompt ?? '')) {
      return { input: '\r' };
    }
    return { input: decision === 'approve' ? 'y\r' : 'n\r' };
  },

  detectCompletion(output: string): CompletionDetectionResult | null {
    const clean = stripTerminalControls(output);
    if (COMPLETION_RE.test(clean)) {
      return { detected: true, outcome: 'success', summary: 'Codex task completed' };
    }
    if (FAILURE_RE.test(clean)) {
      return { detected: true, outcome: 'failure', summary: 'Codex task failed' };
    }
    return null;
  },

  normalizeOutput(output: string): RuntimeOutputEvent[] {
    const events: RuntimeOutputEvent[] = [];
    const ts = Date.now();
    const clean = stripTerminalControls(output);
    const status = this.detectStatus(output);
    const lastLine = lastNonEmptyLines(clean, 1);

    if (BANNER_RE.test(clean)) {
      events.push({ kind: 'banner', cli: 'codex', timestamp: ts, confidence: 'high' });
    }

    if (status.status === 'idle' && status.confidence !== 'low') {
      events.push({ kind: 'ready', cli: 'codex', timestamp: ts, confidence: 'medium' });
    }

    if (status.status === 'error' && SHELL_PROMPT_RE.test(lastLine)) {
      events.push({ kind: 'process_exit', cli: 'codex', timestamp: ts, detail: 'shell-prompt-visible' });
    }

    const perm = this.detectPermissionRequest(output);
    if (perm) {
      events.push({ kind: 'permission_request', cli: 'codex', timestamp: ts, permissionRequest: perm.request });
    }

    const comp = this.detectCompletion(output);
    if (comp) {
      events.push({ kind: 'task_completed', cli: 'codex', timestamp: ts, outcome: comp.outcome, detail: comp.summary });
    }

    if (events.length === 0) {
      events.push({ kind: 'unknown', cli: 'codex', timestamp: ts });
    }

    return events;
  },

  buildActivationInput(signal: string): { preClear?: string; paste: string; submit: string } {
    let target = signal;

    if (signal.includes('### MISSION_CONTROL_ACTIVATION_REQUEST ###')) {
      const sessionIdMatch = signal.match(/sessionId:\s*"([^"]+)"/);
      const missionId = extractActivationField(signal, 'missionId');
      const nodeId = extractActivationField(signal, 'nodeId');
      const attempt = extractActivationNumber(signal, 'attempt') ?? 1;

      if (missionId && nodeId) {
        const escapedMissionId = escapeInstructionValue(missionId);
        const escapedNodeId = escapeInstructionValue(nodeId);
        target =
          `NEW_TASK. call get_task_details({ missionId: "${escapedMissionId}", nodeId: "${escapedNodeId}" }); ` +
          'the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call ' +
          `complete_task({ missionId: "${escapedMissionId}", nodeId: "${escapedNodeId}", attempt: ${attempt}, outcome: "success" or "failure", summary: "<concise summary>" }) ` +
          'as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.';
      } else if (sessionIdMatch) {
        target = `NEW_TASK. call get_current_task({ sessionId: "${escapeInstructionValue(sessionIdMatch[1])}" }); the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call complete_task as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.`;
      }
    }

    const flat = target.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return {
      preClear: '\x15',
      paste: flat,
      submit: '\r',
    };
  },
};
