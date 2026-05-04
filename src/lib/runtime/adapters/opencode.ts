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

const BANNER_RE = /\bopencode\b/i;
const PROMPT_RE = /(?:>|\uff1e|❯|Input:|Prompt:|\$)\s*$/m;
const SHELL_PROMPT_RE = /(?:\$|>|#)\s*$/m;
const READY_KEYWORDS_RE = /\b(ready|listening|connected|type|enter)\b/i;
const PERMISSION_RE = /(?:allow|deny|approve|reject|permission|grant|trust)/i;
const COMPLETION_RE = /(?:task completed|finished|done|exit code\s+0)/i;
const FAILURE_RE = /(?:error:|failed|exception|exit code\s+[1-9])/i;

export const opencodeAdapter: CliAdapter = {
  id: 'opencode',
  label: 'OpenCode',
  capabilities: {
    supportsHeadless: false,
    supportsMcpConfig: true,
    supportsHardToolRestrictions: false,
    supportsPermissions: true,
    requiresTrustPromptHandling: false,
    completionAuthority: 'process_exit',
  },

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

    return {
      command: 'opencode',
      args: [],
      env,
      promptDelivery: 'interactive_pty',
    };
  },

  detectReady(output: string): ReadyDetectionResult {
    if (BANNER_RE.test(output)) {
      if (PROMPT_RE.test(output) || READY_KEYWORDS_RE.test(output)) {
        return { ready: true, confidence: 'high', detail: 'OpenCode banner and prompt detected' };
      }
      return { ready: true, confidence: 'medium', detail: 'OpenCode banner detected, assuming ready' };
    }

    if (PROMPT_RE.test(output) || READY_KEYWORDS_RE.test(output)) {
      return { ready: true, confidence: 'medium', detail: 'OpenCode prompt indicator detected' };
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
      return { detected: true, outcome: 'success', summary: 'OpenCode task completed' };
    }
    if (FAILURE_RE.test(output)) {
      return { detected: true, outcome: 'failure', summary: 'OpenCode task failed' };
    }
    return null;
  },

  normalizeOutput(output: string): RuntimeOutputEvent[] {
    const events: RuntimeOutputEvent[] = [];
    const ts = Date.now();

    if (BANNER_RE.test(output)) {
      events.push({ kind: 'banner', cli: 'opencode', timestamp: ts, confidence: 'high' });
    }

    if (PROMPT_RE.test(output) || READY_KEYWORDS_RE.test(output)) {
      events.push({ kind: 'ready', cli: 'opencode', timestamp: ts, confidence: 'medium' });
    }

    if (SHELL_PROMPT_RE.test(output)) {
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
