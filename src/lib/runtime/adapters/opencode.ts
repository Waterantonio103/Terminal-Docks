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
const BANNER_RE = /\bopencode\b/i;
const PROMPT_RE = /(?:^|\n)\s*(?:>|\uff1e|❯|Input:|Prompt:)\s*(?:\S.*)?$/m;
const SHELL_PROMPT_RE = /(?:^|\n)\s*(?:[A-Za-z]:\\[^>\r\n]*>|PS [^>\r\n]*>|[$#>])\s*$/m;
const OPENCODE_INPUT_FOOTER_RE = /(?:^|\s)▣\s+[\w -]+(?:\s*·\s*[\w .-]+)?/u;
const OPENCODE_UI_RE = /(?:\bopencode\b|▣|QUEUED|Press\s+Esc|ctrl-c|ready for next turn)/i;
const READY_KEYWORDS_RE = /\b(ready for next turn|type your|enter your|input|prompt)\b/i;
const PERMISSION_RE = /(?:allow|approve|grant|trust|deny|reject).*(?:\?|y\/n|\[y\/n\]|\b1\.)/is;
const COMPLETION_RE = /(?:\btask\s+(?:completed|complete)\b|turn\.completed|exit code\s+0)/i;
const FAILURE_RE = /(?:\btask\s+failed\b|\bfatal error\b|\buncaught exception\b|exit code\s+[1-9]|\bunknown option\b|\binvalid flag\b|\bunexpected argument\b|(?:^|\n)\s*Usage:\s*opencode\b)/i;
const ACTIVE_WORK_RE =
  /(?:\bQUEUED\b|\bWorking\b|\bThinking\b|\bProcessing\b|\bRunning\b|\bLoading\b|\bInstalling\b|\bFetching\b|\bRetrying\b|\brate[- ]limit\b|\bwaiting for (?:model|tool|response|command|rate limit)\b|\boperation in progress\b|\bpress\s+esc\b|\bctrl-c\b|[⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏])/i;

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

export const opencodeAdapter: CliAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  postReadySettleDelayMs: 3000,

  buildLaunchCommand(context: LaunchContext): LaunchCommand {
    const env: Record<string, string> = {
      TD_SESSION_ID: context.sessionId,
      TD_AGENT_ID: context.agentId,
      TD_MISSION_ID: context.missionId,
      TD_NODE_ID: context.nodeId,
      TD_MCP_URL: context.mcpUrl,
      TD_WORKSPACE: context.workspaceDir ?? '',
      TD_KIND: 'opencode',
      ...(context.envOverrides ?? {}),
    };

    if (context.executionMode === 'headless' || context.executionMode === 'streaming_headless') {
      return {
        command: '',
        args: [],
        env,
        promptDelivery: 'unsupported',
        unsupportedReason: 'Headless command builder for "opencode" is not configured yet. Switch this node to interactive PTY or use a custom command template.',
      };
    }

    const { args } = buildPtyLaunchCommandParts('opencode', {
      model: context.model,
      yolo: context.yolo,
      workspaceDir: context.workspaceDir,
    });
    return {
      command: 'opencode',
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
    const hasOpenCodeUi = OPENCODE_UI_RE.test(clean);
    const lastLine = lastNonEmptyLines(clean, 1);

    if (this.detectPermissionRequest(output)) {
      return { status: 'waiting_user_answer', confidence: 'high', detail: 'OpenCode permission prompt detected' };
    }

    if (FAILURE_RE.test(clean)) {
      return { status: 'error', confidence: 'high', detail: 'OpenCode failure output detected' };
    }

    if (COMPLETION_RE.test(clean)) {
      return { status: 'completed', confidence: 'high', detail: 'OpenCode completion marker detected' };
    }

    if (ACTIVE_WORK_RE.test(clean)) {
      return { status: 'processing', confidence: 'high', detail: 'OpenCode active work indicator detected' };
    }

    if (OPENCODE_INPUT_FOOTER_RE.test(clean) || (hasOpenCodeUi && (PROMPT_RE.test(clean) || READY_KEYWORDS_RE.test(clean)))) {
      return { status: 'idle', confidence: 'high', detail: 'OpenCode input prompt/footer detected' };
    }

    if (SHELL_PROMPT_RE.test(lastLine)) {
      return { status: 'error', confidence: 'low', detail: 'Shell prompt visible - opencode may have exited' };
    }

    if (BANNER_RE.test(clean) || hasOpenCodeUi) {
      return { status: 'processing', confidence: 'low', detail: 'OpenCode UI detected, waiting for input prompt' };
    }

    if (PROMPT_RE.test(clean) || READY_KEYWORDS_RE.test(clean)) {
      return { status: 'processing', confidence: 'low', detail: 'Prompt-like output without OpenCode UI - waiting' };
    }

    return { status: 'processing', confidence: 'low', detail: 'OpenCode output is not ready' };
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
      return { detected: true, outcome: 'success', summary: 'OpenCode task completed' };
    }
    if (FAILURE_RE.test(clean)) {
      return { detected: true, outcome: 'failure', summary: 'OpenCode task failed' };
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
      events.push({ kind: 'banner', cli: 'opencode', timestamp: ts, confidence: 'high' });
    }

    if (OPENCODE_INPUT_FOOTER_RE.test(clean) || (OPENCODE_UI_RE.test(clean) && (PROMPT_RE.test(clean) || READY_KEYWORDS_RE.test(clean)))) {
      events.push({ kind: 'ready', cli: 'opencode', timestamp: ts, confidence: 'medium' });
    }

    if (status.status === 'error' && SHELL_PROMPT_RE.test(lastLine)) {
      events.push({ kind: 'process_exit', cli: 'opencode', timestamp: ts, detail: 'shell-prompt-visible' });
    }

    const perm = this.detectPermissionRequest(output);
    if (perm) {
      events.push({ kind: 'permission_request', cli: 'opencode', timestamp: ts, permissionRequest: perm.request });
    }

    const comp = this.detectCompletion(output);
    if (comp) {
      events.push({ kind: 'task_completed', cli: 'opencode', timestamp: ts, outcome: comp.outcome, detail: comp.summary });
    }

    if (events.length === 0) {
      events.push({ kind: 'unknown', cli: 'opencode', timestamp: ts });
    }

    return events;
  },

  buildActivationInput(signal: string): { paste: string; submit: string } {
    const flat = signal.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return {
      paste: `\x15\x1b[200~${flat}\x1b[201~`,
      submit: '\r',
    };
  },
};
