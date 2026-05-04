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
const BANNER_RE = /\bclaude (code|assistant)\b/i;
const SHELL_PROMPT_RE = /(?:^|\n)\s*(?:[A-Za-z]:\\[^>\r\n]*>|PS [^>\r\n]*>|[$#>])\s*$/m;
const CLAUDE_UI_RE = /(?:\bclaude (?:code|assistant)\b|Sonnet|Opus|Haiku|--\s*INSERT\s*--|bypass permissions|shift\+tab to cycle|❯|⏵⏵)/i;
const CLAUDE_INPUT_READY_RE = /(?:^|\n)\s*❯\s*(?:$|\n)|--\s*INSERT\s*--|\b(?:type|enter|paste|write)\b.*\b(?:prompt|message|input)\b/i;
const ACTIVE_WORK_RE =
  /(?:\bStewing\b|\bContemplating\b|\bThinking\b|\bProcessing\b|\bWorking\b|\bRunning\b|\bExecuting\b|\bCalling\b|\bUsing tool\b|\btool execution\b|\bqueued message\b|\besc to interrupt\b|\bctrl-c to interrupt\b|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])/i;
const PERMISSION_RE =
  /(?:permission request|allow|approve|grant|trust|deny|reject|do you want).*(?:\?|y\/n|\[y\/n\]|\b1\.|yes\/no|always allow)/is;

const COMPLETION_RE = /(?:\btask\s+(?:completed|complete)\b|turn\.completed|exit code\s+0)/i;
const FAILURE_RE =
  /(?:\btask\s+failed\b|\bfatal error\b|\buncaught exception\b|exit code\s+[1-9]|\bunknown option\b|\binvalid flag\b|\bunexpected argument\b|(?:^|\n)\s*Usage:\s*claude\b)/i;

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

export const claudeAdapter: CliAdapter = {
  id: 'claude',
  label: 'Claude Code',
  postReadySettleDelayMs: 1000,

  buildLaunchCommand(context: LaunchContext): LaunchCommand {
    const env: Record<string, string> = {
      TD_SESSION_ID: context.sessionId,
      TD_AGENT_ID: context.agentId,
      TD_MISSION_ID: context.missionId,
      TD_NODE_ID: context.nodeId,
      TD_MCP_URL: context.mcpUrl,
      TD_WORKSPACE: context.workspaceDir ?? '',
      TD_KIND: 'claude',
      ...(context.envOverrides ?? {}),
    };

    if (context.executionMode === 'headless' || context.executionMode === 'streaming_headless') {
      const args = ['--print', '{prompt}'];
      if (context.model?.trim()) args.unshift('--model', context.model.trim());
      return {
        command: 'claude',
        args,
        env,
        promptDelivery: 'arg_text',
      };
    }

    const { args } = buildPtyLaunchCommandParts('claude', {
      model: context.model,
      yolo: context.yolo,
      workspaceDir: context.workspaceDir,
    });
    return {
      command: 'claude',
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
    const hasClaudeUi = CLAUDE_UI_RE.test(clean);
    const lastLine = lastNonEmptyLines(clean, 1);

    if (this.detectPermissionRequest(output)) {
      return { status: 'waiting_user_answer', confidence: 'high', detail: 'Claude permission prompt detected' };
    }

    if (FAILURE_RE.test(clean)) {
      return { status: 'error', confidence: 'high', detail: 'Claude failure output detected' };
    }

    if (COMPLETION_RE.test(clean)) {
      return { status: 'completed', confidence: 'high', detail: 'Claude completion marker detected' };
    }

    if (ACTIVE_WORK_RE.test(clean)) {
      return { status: 'processing', confidence: 'high', detail: 'Claude active work indicator detected' };
    }

    if (hasClaudeUi && CLAUDE_INPUT_READY_RE.test(clean)) {
      return { status: 'idle', confidence: 'high', detail: 'Claude input prompt detected' };
    }

    if (SHELL_PROMPT_RE.test(lastLine)) {
      return { status: 'error', confidence: 'low', detail: 'Shell prompt visible - CLI may have exited' };
    }

    if (BANNER_RE.test(clean) || hasClaudeUi) {
      return { status: 'processing', confidence: 'low', detail: 'Claude UI detected, waiting for input prompt' };
    }

    return { status: 'processing', confidence: 'low', detail: 'Claude output is not ready' };
  },

  buildInitialPrompt(context: TaskContext): string {
    return `### MISSION_CONTROL_ACTIVATION_REQUEST ### You have been assigned a new task. Please call 'get_task_details({ missionId: "${context.missionId}", nodeId: "${context.nodeId}" })' to retrieve your full context. --- ENVELOPE --- ${context.payloadJson} --- END ENVELOPE --- `;
  },

  detectPermissionRequest(output: string): PermissionDetectionResult | null {
    const clean = stripTerminalControls(output);
    if (!PERMISSION_RE.test(clean)) return null;

    const lines = clean.split('\n').filter(l => l.trim());
    const promptLine = lines.slice(-12).join('\n');

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
      return { detected: true, outcome: 'success', summary: 'Claude task completed' };
    }
    if (FAILURE_RE.test(clean)) {
      return { detected: true, outcome: 'failure', summary: 'Claude task failed' };
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
      events.push({ kind: 'banner', cli: 'claude', timestamp: ts, confidence: 'high' });
    }

    if (CLAUDE_UI_RE.test(clean) && CLAUDE_INPUT_READY_RE.test(clean)) {
      events.push({ kind: 'ready', cli: 'claude', timestamp: ts, confidence: 'medium' });
    }

    if (status.status === 'error' && SHELL_PROMPT_RE.test(lastLine)) {
      events.push({ kind: 'process_exit', cli: 'claude', timestamp: ts, detail: 'shell-prompt-visible' });
    }

    const perm = this.detectPermissionRequest(output);
    if (perm) {
      events.push({ kind: 'permission_request', cli: 'claude', timestamp: ts, permissionRequest: perm.request });
    }

    const comp = this.detectCompletion(output);
    if (comp) {
      events.push({ kind: 'task_completed', cli: 'claude', timestamp: ts, outcome: comp.outcome, detail: comp.summary });
    }

    if (events.length === 0) {
      events.push({ kind: 'unknown', cli: 'claude', timestamp: ts });
    }

    return events;
  },

  buildActivationInput(signal: string): { preClear?: string; paste: string; submit: string } {
    // Claude's editor accepts plain PTY input more reliably than bracketed paste on Windows.
    const flat = signal.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return {
      preClear: '\x15',
      paste: flat,
      submit: '\r',
    };
  },
};
