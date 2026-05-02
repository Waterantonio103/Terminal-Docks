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
  TaskContext,
} from './CliAdapter';

const BANNER_RE = /\b(gemini|google gemini|gemini cli)\b/i;
const PROMPT_BAR_RE = /(?:^|\n)\s*(?:>|\uff1e|❯|Input:|Prompt:)\s*$/m;
const SHELL_PROMPT_RE = /(?:^|\n)\s*(?:[A-Za-z]:\\[^>\r\n]*>|PS [^>\r\n]*>|[$#])\s*$/m;
const READY_KEYWORDS_RE = /\b(ready|welcome|type your|enter your (?:prompt|message|query))\b/i;
const GEMINI_UI_RE = /(?:gemini cli|to resume this session|loaded cached credentials|tips for getting started|using:\s*gemini|╭|✦|✧)/i;
const PERMISSION_RE = /(?:allow|deny|approve|reject|permission|grant|trust|always allow)/i;
const COMPLETION_RE = /(?:task completed|finished|done|exit code\s+0)/i;
const FAILURE_RE = /(?:error:|failed|exception|exit code\s+[1-9])/i;
const GEMINI_INPUT_HINT_RE = /\b(type|enter|input|paste|write)\b.*\b(prompt|message|query|input)\b/i;
const GEMINI_PROMPT_MARKER_RE = /(?:gemini[^\n]{0,80}(?:>|\uff1e|❯|Input:|Prompt:))|(?:^|\n)\s*(?:>|\uff1e|❯|Input:|Prompt:)\s*(?:$|\n)|(?:type|enter|input|paste|write)\b.*\b(prompt|message|query|input)\b/i;

function logGeminiReady(message: string): void {
  console.debug(`[gemini-ready] ${message}`);
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

    const args: string[] = [];
    if (context.model?.trim()) args.push('--model', context.model.trim());
    if (context.yolo) args.push('--yolo');
    return {
      command: 'gemini',
      args,
      env,
      promptDelivery: 'interactive_pty',
    };
  },

  detectReady(output: string): ReadyDetectionResult {
    const tail = output.split('\n').slice(-3).join('\n');
    const hasGeminiUi = GEMINI_UI_RE.test(output);
    if (SHELL_PROMPT_RE.test(tail) && !hasGeminiUi) {
      logGeminiReady('rejected reason=shell_prompt_only');
      return { ready: false, confidence: 'low', detail: 'Shell prompt only — Gemini not confirmed' };
    }

    if (BANNER_RE.test(output)) {
      if (hasGeminiUi && (PROMPT_BAR_RE.test(output) || READY_KEYWORDS_RE.test(output) || GEMINI_INPUT_HINT_RE.test(output))) {
        logGeminiReady('accepted reason=banner_and_prompt');
        return { ready: true, confidence: 'high', detail: 'Gemini banner and input prompt detected' };
      }
      // Banner alone is not enough, wait for prompt
      logGeminiReady('waiting reason=banner_without_prompt');
      return { ready: false, confidence: 'low', detail: 'Gemini banner detected, waiting for prompt' };
    }

    if (hasGeminiUi && GEMINI_PROMPT_MARKER_RE.test(output)) {
      logGeminiReady('accepted reason=gemini_prompt_marker');
      return { ready: true, confidence: 'medium', detail: 'Gemini-specific prompt marker detected' };
    }

    logGeminiReady('waiting reason=no_gemini_marker');
    return { ready: false, confidence: 'low' };
  },

  buildInitialPrompt(context: TaskContext): string {
    return `### MISSION_CONTROL_ACTIVATION_REQUEST ### You have been assigned a new task. Please call 'get_task_details({ missionId: "${context.missionId}", nodeId: "${context.nodeId}" })' to retrieve your full context. --- ENVELOPE --- ${context.payloadJson} --- END ENVELOPE --- `;
  },

  detectPermissionRequest(output: string): PermissionDetectionResult | null {
    if (!PERMISSION_RE.test(output)) return null;

    const lines = output.split('\n').filter(l => l.trim());
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
    if (COMPLETION_RE.test(output)) {
      return { detected: true, outcome: 'success', summary: 'Gemini task completed' };
    }
    if (FAILURE_RE.test(output)) {
      return { detected: true, outcome: 'failure', summary: 'Gemini task failed' };
    }
    return null;
  },

  normalizeOutput(output: string): RuntimeOutputEvent[] {
    const events: RuntimeOutputEvent[] = [];
    const ts = Date.now();

    if (BANNER_RE.test(output)) {
      events.push({ kind: 'banner', cli: 'gemini', timestamp: ts, confidence: 'high' });
    }

    if (PROMPT_BAR_RE.test(output) || READY_KEYWORDS_RE.test(output)) {
      events.push({ kind: 'ready', cli: 'gemini', timestamp: ts, confidence: 'medium' });
    }

    if (SHELL_PROMPT_RE.test(output)) {
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
      paste: `\x1b[200~${flat}\x1b[201~`,
      submit: '\r',
    };
  },
};
