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
import { formatLaunchArgsForLog } from '../../cliCommandBuilders.js';

const ANSI_RE =
  /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const BANNER_RE = /\bcodex\b/i;
const PROMPT_RE = /(?:^|\n)\s*(?:›|\uff1e|❯|Input:|Prompt:)\s*(?:\S.*)?$/m;
const SHELL_PROMPT_RE = /(?:^|\n)\s*(?:[A-Za-z]:\\[^>\r\n]*>|PS [^>\r\n]*>|[$#>])\s*$/m;
const CODEX_FOOTER_RE = /(?:\bgpt-[\w.-]+(?:\s+\w+)?\b[\s\S]{0,120}\bContext\s+\d+%\s+(?:left|used)\b|\bContext\s+\d+%\s+left\b[\s\S]{0,80}\bContext\s+\d+%\s+used\b|\bFast\s+(?:on|off)\b)/i;
const CODEX_UI_RE = /(?:\bcodex\b|\bgpt-[\w.-]+\b|\bContext\s+\d+%\s+(?:left|used)\b|\bFast\s+(?:on|off)\b|›)/i;
const ACTIVE_WORK_RE =
  /(?:\bWorking\b|\bBooting MCP server\b|\bStarting MCP servers\b|\bqueued message\b|\btab to queue message\b|\bPasted Content\b|\besc to interrupt\b|\bctrl-c to interrupt\b|\boperation in progress\b)/i;
const MCP_PERMISSION_PROMPT_RE =
  /Allow\s+the\s+.+?\s+MCP\s+server\s+to\s+run\s+tool\s+"[^"]+"\?\s*[\s\S]*(?:\b1\.\s*Allow\b|\bAlways\s+allow\b|\benter\s+to\s+submit\b)/i;
const GENERIC_PERMISSION_PROMPT_RE =
  /(?:allow|approve|grant)\s+(?:this\s+)?(?:command|tool|operation|request|permission)\??\s*[\s\S]*(?:\b1\.\s*Allow\b|\bAlways\s+allow\b|\by\/n\b|\[y\/n\])/i;
const CONFIRMATION_PERMISSION_PROMPT_RE =
  /(?:\bproceed\??\s*(?:\(\s*y\s*\)|\[\s*y\s*\/\s*n\s*\]|\byes\b|\by\/n\b)|\b(?:yes|no)\b[\s\S]{0,80}\b(?:approve|deny|edit|edits|command|tool|proceed)\b|\bapprove\s+edits\s+manually\b)/i;
const CODEX_STARTUP_PERMISSION_PROMPT_RE =
  /(?:\b(?:do\s+you\s+)?(?:want\s+to\s+)?trust\s+(?:the\s+)?(?:files\s+in\s+)?(?:this\s+)?folder\b[\s\S]{0,180}(?:\by\s*\/\s*n\b|\[\s*y\s*\/\s*n\s*\]|\(\s*y\s*\/\s*n\s*\)|\byes\b|\bno\b|\?)|\b(?:enable|allow|approve|grant|turn\s+on)\s+(?:the\s+)?(?:admin\s+)?sandbox\b[\s\S]{0,220}(?:\by\s*\/\s*n\b|\[\s*y\s*\/\s*n\s*\]|\(\s*y\s*\/\s*n\s*\)|\byes\b|\bno\b|\?)|\badmin\s+sandbox\b[\s\S]{0,220}(?:\by\s*\/\s*n\b|\[\s*y\s*\/\s*n\s*\]|\(\s*y\s*\/\s*n\s*\)|\byes\b|\bno\b|\?))/i;
const COMPLETION_RE = /(?:\btask\s+(?:completed|complete)\b|turn\.completed|exit code\s+0|(?:^|\n)\s*[─-]+\s*worked for\b|\bworked for\s+\d+\s*(?:s|m|h))/i;
const FAILURE_RE =
  /(?:\btask\s+failed\b|\bfatal error\b|\buncaught exception\b|\bMCP error\b|exit code\s+[1-9]|\bfailed process\b|\bcommand not found\b|\bnot recognized as\b|\bunknown option\b|\bunexpected argument\b|\binvalid flag\b|(?:^|\n)\s*(?:error|fatal):)/i;

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
      TD_SESSION_ID: context.sessionId,
      TD_AGENT_ID: context.agentId,
      TD_MISSION_ID: context.missionId,
      TD_NODE_ID: context.nodeId,
      TD_MCP_URL: context.mcpUrl,
      TD_WORKSPACE: context.workspaceDir ?? '',
      TD_KIND: 'codex',
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

    const args: string[] = [
      '-c',
      'mcp_servers.pencil.enabled=false',
      '-c',
      'mcp_servers.excalidraw.enabled=false',
      ...(context.mcpUrl?.trim() ? [
        '-c',
        `mcp_servers.terminal-docks.url="${context.mcpUrl.trim()}"`,
        '-c',
        'mcp_servers.terminal-docks.enabled=true',
        '-c',
        'mcp_servers.terminal-docks.startup_timeout_sec=30',
        '-c',
        'mcp_servers.terminal-docks.tool_timeout_sec=120',
      ] : []),
    ];
    if (context.model?.trim()) args.push('--model', context.model.trim());
    if (context.workspaceDir?.trim()) args.push('--cd', context.workspaceDir.trim());
    args.push('--no-alt-screen');
    const yoloFlag = '--dangerously-bypass-approvals-and-sandbox';
    if (context.yolo) {
      args.push(yoloFlag);
      console.log(`[codex] resolved yolo flag=${yoloFlag}`);
    } else {
      console.log('[codex] resolved yolo flag=<none> (yolo=false)');
    }
    console.log(`[codex] final codex args (no prompt)=${formatLaunchArgsForLog(args)}`);
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
    const hasCodexUi = CODEX_UI_RE.test(clean);
    const lastLine = lastNonEmptyLines(clean, 1);

    if (this.detectPermissionRequest(output)) {
      return { status: 'waiting_user_answer', confidence: 'high', detail: 'Codex permission prompt detected' };
    }

    if (FAILURE_RE.test(clean)) {
      return { status: 'error', confidence: 'high', detail: 'Codex failure output detected' };
    }

    if (COMPLETION_RE.test(clean)) {
      return { status: 'completed', confidence: 'high', detail: 'Codex completion marker detected' };
    }

    if (ACTIVE_WORK_RE.test(clean)) {
      return { status: 'processing', confidence: 'high', detail: 'Codex active work indicator detected' };
    }

    if (hasCodexUi && PROMPT_RE.test(clean) && CODEX_FOOTER_RE.test(clean)) {
      return { status: 'idle', confidence: 'high', detail: 'Codex input prompt and footer detected' };
    }

    if (SHELL_PROMPT_RE.test(lastLine)) {
      return { status: 'error', confidence: 'low', detail: 'Shell prompt visible - CLI may have exited' };
    }

    if (BANNER_RE.test(clean) || hasCodexUi) {
      return { status: 'processing', confidence: 'low', detail: 'Codex UI detected, waiting for idle prompt' };
    }

    if (PROMPT_RE.test(clean)) {
      return { status: 'processing', confidence: 'low', detail: 'Prompt-like output without Codex footer - waiting' };
    }

    return { status: 'processing', confidence: 'low', detail: 'Codex output is not ready' };
  },

  buildInitialPrompt(context: TaskContext): string {
    return `NEW_TASK. call get_task_details({ missionId: "${escapeInstructionValue(context.missionId)}", nodeId: "${escapeInstructionValue(context.nodeId)}" }), execute the actual task from that payload, then call complete_task({ missionId: "${escapeInstructionValue(context.missionId)}", nodeId: "${escapeInstructionValue(context.nodeId)}", attempt: ${context.attempt}, outcome: "success" or "failure", summary: "<concise summary>" }) as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.`;
  },

  detectPermissionRequest(output: string): PermissionDetectionResult | null {
    const clean = stripTerminalControls(output);
    if (!MCP_PERMISSION_PROMPT_RE.test(clean) && !GENERIC_PERMISSION_PROMPT_RE.test(clean) && !CONFIRMATION_PERMISSION_PROMPT_RE.test(clean) && !CODEX_STARTUP_PERMISSION_PROMPT_RE.test(clean)) {
      return null;
    }

    const lines = clean.split('\n').filter(l => l.trim());
    const promptLine = lines.slice(-12).join('\n');

    let category: PermissionRequest['category'] = 'unknown';
    if (/admin\s+sandbox|bash|command|shell|exec|run\s/i.test(promptLine)) category = 'shell_execution';
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

    if (CODEX_UI_RE.test(clean) && PROMPT_RE.test(clean) && CODEX_FOOTER_RE.test(clean)) {
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
          `NEW_TASK. call get_task_details({ missionId: "${escapedMissionId}", nodeId: "${escapedNodeId}" }), ` +
          'execute the actual task from that payload, then call ' +
          `complete_task({ missionId: "${escapedMissionId}", nodeId: "${escapedNodeId}", attempt: ${attempt}, outcome: "success" or "failure", summary: "<concise summary>" }) ` +
          'as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.';
      } else if (sessionIdMatch) {
        target = `NEW_TASK. call get_current_task({ sessionId: "${escapeInstructionValue(sessionIdMatch[1])}" }), execute the active task it returns, then call complete_task as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.`;
      }
    }

    const flat = target.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return {
      paste: flat,
      submit: '\r',
    };
  },
};
