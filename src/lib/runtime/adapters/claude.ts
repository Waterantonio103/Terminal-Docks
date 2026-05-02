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

const BANNER_RE = /\bclaude (code|assistant)\b/i;
const SHELL_PROMPT_RE = /(?:\$|>|#)\s*$/m;
const PERMISSION_RE = /(?:allow|approve|grant|deny|reject).*(?:\?|y\/n|\[y\/n\]|\b1\.)/is;

const COMPLETION_RE = /(?:task completed|finished|done|exit code\s+0)/i;
const FAILURE_RE = /(?:error:|failed|exception|exit code\s+[1-9])/i;

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

    const args: string[] = [];
    if (context.model?.trim()) args.push('--model', context.model.trim());
    if (context.yolo) args.push('--dangerously-skip-permissions');
    return {
      command: 'claude',
      args,
      env,
      promptDelivery: 'interactive_pty',
    };
  },

  detectReady(output: string): ReadyDetectionResult {
    if (BANNER_RE.test(output)) {
      return { ready: true, confidence: 'high', detail: 'Claude banner detected' };
    }
    if (SHELL_PROMPT_RE.test(output)) {
      return { ready: false, confidence: 'low', detail: 'Shell prompt visible — CLI may have exited' };
    }
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
      return { detected: true, outcome: 'success', summary: 'Claude task completed' };
    }
    if (FAILURE_RE.test(output)) {
      return { detected: true, outcome: 'failure', summary: 'Claude task failed' };
    }
    return null;
  },

  normalizeOutput(output: string): RuntimeOutputEvent[] {
    const events: RuntimeOutputEvent[] = [];
    const ts = Date.now();

    if (BANNER_RE.test(output)) {
      events.push({ kind: 'banner', cli: 'claude', timestamp: ts, confidence: 'high' });
    }

    if (SHELL_PROMPT_RE.test(output)) {
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
