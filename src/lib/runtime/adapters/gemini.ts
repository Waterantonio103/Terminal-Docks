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
import { buildPtyLaunchCommandParts } from '../../cliCommandBuilders.js';

const ANSI_RE =
  /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const BANNER_RE = /\b(?:gemini|google gemini|gemini cli)\b/i;
const PROMPT_BAR_RE = /(?:^|\n)\s*(?:>|\uff1e|❯|Input:|Prompt:)\s*$/m;
const SHELL_PROMPT_RE = /(?:^|\n)\s*(?:[A-Za-z]:\\[^>\r\n]*>|PS [^>\r\n]*>|[$#>])\s*$/m;
const GEMINI_UI_RE =
  /(?:gemini cli|gemini\.md|mcp servers?|to resume this session|loaded cached credentials|tips for getting started|using:\s*gemini|signed in with google|plan:\s*gemini|\/model\b|\bcontext\b|\bquota\b|\byolo\b|╭|✦|✧)/i;
const GEMINI_INPUT_READY_RE =
  /(?:^|\n)\s*(?:\*|>)?\s*Type your message\b|(?:^|\n)\s*(?:>|\uff1e|❯|Input:|Prompt:)\s*(?:$|\n)|\b(?:type|enter|input|paste|write)\b.*\b(?:prompt|message|query|input)\b/i;
const PERMISSION_RE =
  /(?:trust this folder\?|approve tool call\?|permission request|allow|approve|grant|trust|deny|reject|do you want).*(?:\?|y\/n|\[y\/n\]|\b1\.|yes\/no|always allow)/is;
const COMPLETION_RE = /(?:\btask\s+(?:completed|complete)\b|turn\.completed|exit code\s+0)/i;
const FAILURE_RE =
  /(?:\btask\s+failed\b|\bfatal error\b|\buncaught exception\b|exit code\s+[1-9]|\bunknown option\b|\binvalid flag\b|\bunexpected argument\b|(?:^|\n)\s*Usage:\s*gemini\b|(?:^|\n)\s*Error:)/i;
const AUTH_RE =
  /(?:\bWaiting for authentication\b|\bauthentication required\b|\blog(?:\s|-)?in required\b|\bsign(?:\s|-)?in required\b|\bopen .*browser.*(?:auth|sign in|login)\b|\bpress esc or ctrl\+c to cancel\b.*\bauthentication\b)/i;
const UPDATE_RE =
  /(?:\bGemini CLI update available\b|\bAttempting to automatically update now\b|\bUpdate successful\b)/i;
const PASTED_TEXT_RE = /\[Pasted Text:\s*\d+\s*chars\]/i;
const ACTIVE_WORK_RE =
  /(?:\bWorking\b|\bThinking\b|\bProcessing\b|\bRunning\b|\bExecuting\b|\bCalling\b|\bUsing tool\b|\btool execution\b|\bqueued message\b|\besc to interrupt\b|\bctrl-c to interrupt\b|\boperation in progress\b|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])/i;

function logGeminiReady(_message: string): void {
  // Kept as a local hook for temporary parser diagnostics without noisy polling logs.
}

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

function lastMatchIndex(output: string, pattern: RegExp): number {
  const flags = pattern.flags.includes('g') ? pattern.flags : `${pattern.flags}g`;
  const matcher = new RegExp(pattern.source, flags);
  let lastIndex = -1;
  let match: RegExpExecArray | null;

  while ((match = matcher.exec(output)) !== null) {
    lastIndex = match.index;
    if (match[0].length === 0) {
      matcher.lastIndex += 1;
    }
  }

  return lastIndex;
}

function latestIndexedStatus(
  statuses: Array<StatusDetectionResult & { index: number; logMessage: string }>,
): (StatusDetectionResult & { logMessage: string }) | null {
  let latest: (StatusDetectionResult & { index: number; logMessage: string }) | null = null;
  for (const status of statuses) {
    if (status.index < 0) continue;
    if (!latest || status.index > latest.index) {
      latest = status;
    }
  }

  return latest;
}

export const geminiAdapter: CliAdapter = {
  id: 'gemini',
  label: 'Gemini CLI',
  postReadySettleDelayMs: 3000,

  buildLaunchCommand(context: LaunchContext): LaunchCommand {
    const env: Record<string, string> = {
      TD_SESSION_ID: context.sessionId,
      TD_AGENT_ID: context.agentId,
      TD_MISSION_ID: context.missionId,
      TD_NODE_ID: context.nodeId,
      TD_MCP_URL: context.mcpUrl,
      TD_WORKSPACE: context.workspaceDir ?? '',
      TD_KIND: 'gemini',
      ...(context.envOverrides ?? {}),
    };

    if (context.executionMode === 'headless' || context.executionMode === 'streaming_headless') {
      return {
        command: '',
        args: [],
        env,
        promptDelivery: 'unsupported',
        unsupportedReason: 'Headless command builder for "gemini" is not configured yet. Switch this node to interactive PTY or use a custom command template.',
      };
    }

    const { args } = buildPtyLaunchCommandParts('gemini', {
      model: context.model,
      yolo: context.yolo,
      workspaceDir: context.workspaceDir,
    });
    return {
      command: 'gemini',
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
    const hasGeminiUi = GEMINI_UI_RE.test(clean);
    const lastLine = lastNonEmptyLines(clean, 1);
    const promptLikeIndex = Math.max(
      lastMatchIndex(clean, PROMPT_BAR_RE),
      lastMatchIndex(clean, GEMINI_INPUT_READY_RE),
    );
    const lastLineIsGeminiPrompt = hasGeminiUi && PROMPT_BAR_RE.test(`\n${lastLine}`);
    const shellPromptIndex = !lastLineIsGeminiPrompt && SHELL_PROMPT_RE.test(lastLine)
      ? clean.lastIndexOf(lastLine)
      : -1;
    const permission = this.detectPermissionRequest(output);

    const latestStatus = latestIndexedStatus([
      {
        index: permission ? lastMatchIndex(clean, PERMISSION_RE) : -1,
        status: 'waiting_user_answer',
        confidence: 'high',
        detail: 'Gemini permission prompt detected',
        logMessage: 'blocked reason=permission_prompt',
      },
      {
        index: lastMatchIndex(clean, FAILURE_RE),
        status: 'error',
        confidence: 'high',
        detail: 'Gemini failure output detected',
        logMessage: 'blocked reason=failure_output',
      },
      {
        index: lastMatchIndex(clean, COMPLETION_RE),
        status: 'completed',
        confidence: 'high',
        detail: 'Gemini completion marker detected',
        logMessage: 'blocked reason=completion_marker',
      },
      {
        index: lastMatchIndex(clean, AUTH_RE),
        status: 'waiting_auth',
        confidence: 'high',
        detail: 'Gemini authentication flow detected',
        logMessage: 'blocked reason=authentication_required',
      },
      {
        index: lastMatchIndex(clean, UPDATE_RE),
        status: 'processing',
        confidence: 'high',
        detail: 'Gemini package update is still settling',
        logMessage: 'waiting reason=package_update',
      },
      {
        index: lastMatchIndex(clean, PASTED_TEXT_RE),
        status: 'processing',
        confidence: 'high',
        detail: 'Gemini has pasted text in the editor that has not been submitted',
        logMessage: 'waiting reason=pasted_text_pending_submit',
      },
      {
        index: lastMatchIndex(clean, ACTIVE_WORK_RE),
        status: 'processing',
        confidence: 'high',
        detail: 'Gemini active work indicator detected',
        logMessage: 'waiting reason=active_work',
      },
      {
        index: hasGeminiUi ? promptLikeIndex : -1,
        status: 'idle',
        confidence: BANNER_RE.test(clean) ? 'high' : 'medium',
        detail: 'Gemini input prompt detected',
        logMessage: 'accepted reason=gemini_prompt_marker',
      },
      {
        index: shellPromptIndex,
        status: 'error',
        confidence: 'low',
        detail: 'Shell prompt only - Gemini not confirmed',
        logMessage: 'rejected reason=shell_prompt_only',
      },
    ]);

    if (latestStatus) {
      logGeminiReady(latestStatus.logMessage);
      return {
        status: latestStatus.status,
        confidence: latestStatus.confidence,
        detail: latestStatus.detail,
      };
    }

    if (hasGeminiUi) {
      logGeminiReady('waiting reason=ui_without_prompt');
      return { status: 'processing', confidence: 'low', detail: 'Gemini UI detected, waiting for input prompt' };
    }

    if (promptLikeIndex >= 0) {
      logGeminiReady('waiting reason=prompt_without_ui');
      return { status: 'processing', confidence: 'low', detail: 'Prompt-like output without Gemini UI - waiting' };
    }

    logGeminiReady('waiting reason=no_gemini_marker');
    return { status: 'processing', confidence: 'low', detail: 'Gemini output is not ready' };
  },

  buildInitialPrompt(context: TaskContext): string {
    return `### MISSION_CONTROL_ACTIVATION_REQUEST ### You have been assigned a new task. Please call 'get_task_details({ missionId: "${context.missionId}", nodeId: "${context.nodeId}" })' to retrieve your full context. --- ENVELOPE --- ${context.payloadJson} --- END ENVELOPE --- `;
  },

  detectPermissionRequest(output: string): PermissionDetectionResult | null {
    const clean = stripTerminalControls(output);
    if (!PERMISSION_RE.test(clean)) return null;

    const lines = clean.split('\n').filter(l => l.trim());
    const promptLine = lines[lines.length - 1] ?? '';

    let category: PermissionRequest['category'] = 'unknown';
    if (/bash|command|shell|exec|run\s/i.test(promptLine)) category = 'shell_execution';
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
      return { detected: true, outcome: 'success', summary: 'Gemini task completed' };
    }
    if (FAILURE_RE.test(clean)) {
      return { detected: true, outcome: 'failure', summary: 'Gemini task failed' };
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
      events.push({ kind: 'banner', cli: 'gemini', timestamp: ts, confidence: 'high' });
    }

    if (GEMINI_UI_RE.test(clean) && (PROMPT_BAR_RE.test(clean) || GEMINI_INPUT_READY_RE.test(clean))) {
      events.push({ kind: 'ready', cli: 'gemini', timestamp: ts, confidence: 'medium' });
    }

    if (status.status === 'error' && SHELL_PROMPT_RE.test(lastLine)) {
      events.push({ kind: 'process_exit', cli: 'gemini', timestamp: ts, detail: 'shell-prompt-visible' });
    }

    const perm = this.detectPermissionRequest(output);
    if (perm) {
      events.push({ kind: 'permission_request', cli: 'gemini', timestamp: ts, permissionRequest: perm.request });
    }

    const comp = this.detectCompletion(output);
    if (comp) {
      events.push({ kind: 'task_completed', cli: 'gemini', timestamp: ts, outcome: comp.outcome, detail: comp.summary });
    }

    if (events.length === 0) {
      events.push({ kind: 'unknown', cli: 'gemini', timestamp: ts });
    }

    return events;
  },

  buildActivationInput(signal: string): { preClear?: string; paste: string; submit: string } {
    const flat = signal.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return {
      preClear: '\x15',
      paste: flat,
      submit: '\x1b[13u',
    };
  },
};
