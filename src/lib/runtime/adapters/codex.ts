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

const BANNER_RE = /\bcodex\b/i;
const PROMPT_RE = /(?:>|\uff1e|❯|Input:|Prompt:|\$)\s*$/m;
const SHELL_PROMPT_RE = /(?:\$|>|#)\s*$/m;
const READY_KEYWORDS_RE = /\b(ready|listening|connected|type|enter)\b/i;
const PERMISSION_RE = /(?:allow|deny|approve|reject|permission|grant|trust)/i;
const COMPLETION_RE = /(?:task completed|finished|done|exit code\s+0)/i;
const FAILURE_RE = /(?:error:|failed|exception|exit code\s+[1-9]|interrupted|cancelled|canceled|aborted)/i;

export const codexAdapter: CliAdapter = {
  id: 'codex',
  label: 'Codex',
  capabilities: {
    supportsHeadless: true,
    supportsMcpConfig: true,
    supportsHardToolRestrictions: true,
    supportsPermissions: true,
    requiresTrustPromptHandling: true,
    completionAuthority: 'process_exit',
  },

  // Codex's interactive TUI has an input-readiness race that causes PTY
  // injection to truncate the first ~80–120 bytes regardless of settle delay.
  // Use exec_stdin so the full prompt is piped to stdin of `codex exec -`.
  execMode: 'exec_stdin',

  // Retained as a fallback if ever used in interactive PTY mode directly.
  postReadySettleDelayMs: 800,

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
        command: 'codex',
        args: ['exec', '--json', '--skip-git-repo-check', '-a', 'never', '-'],
        env,
        promptDelivery: 'stdin',
      };
    }

    return {
      command: 'codex',
      args: [],
      env,
      promptDelivery: 'interactive_pty',
    };
  },

  detectReady(output: string): ReadyDetectionResult {
    const lines = output.split('\n');
    const lastLine = lines[lines.length - 1] ?? '';

    if (BANNER_RE.test(output)) {
      // If we see the banner AND the last line looks like a prompt, we are highly confident.
      if (PROMPT_RE.test(lastLine) || READY_KEYWORDS_RE.test(lastLine)) {
        return { ready: true, confidence: 'high', detail: 'Codex banner and prompt detected' };
      }
      // If we see the banner but no prompt yet, wait. 
      // Multi-line banners can cause early injection issues.
      return { ready: false, confidence: 'low', detail: 'Codex banner detected, waiting for prompt' };
    }

    if (PROMPT_RE.test(lastLine) || READY_KEYWORDS_RE.test(lastLine)) {
      return { ready: true, confidence: 'medium', detail: 'Codex prompt indicator detected' };
    }

    if (SHELL_PROMPT_RE.test(lastLine)) {
      return { ready: false, confidence: 'low', detail: 'Shell prompt visible — CLI may have exited' };
    }

    return { ready: false, confidence: 'low' };
  },

  buildInitialPrompt(context: TaskContext): string {
    return `### MISSION_CONTROL_ACTIVATION_REQUEST ### You have been assigned a new task. Please call 'get_task_details({ missionId: "${context.missionId}", nodeId: "${context.nodeId}" })' to retrieve your full context. --- ENVELOPE --- ${context.payloadJson} --- END ENVELOPE --- `;
  },

  detectPermissionRequest(output: string): PermissionDetectionResult | null {
    if (!PERMISSION_RE.test(output)) return null;

    const lines = output.split('\n').map(l => l.trim()).filter(Boolean);
    const promptLine = [...lines].reverse().find(line => (
      !/^\[/.test(line) &&
      !/^press\b/i.test(line) &&
      !/^approve to continue/i.test(line) &&
      /allow|approve|permission|grant|trust|bash|command|edit|read|network|install/i.test(line)
    )) ?? lines[lines.length - 1] ?? '';

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
      return { detected: true, outcome: 'success', summary: 'Codex task completed' };
    }
    if (FAILURE_RE.test(output)) {
      return { detected: true, outcome: 'failure', summary: 'Codex task failed' };
    }
    return null;
  },

  normalizeOutput(output: string): RuntimeOutputEvent[] {
    const events: RuntimeOutputEvent[] = [];
    const ts = Date.now();
    const readyPromptVisible = PROMPT_RE.test(output) || READY_KEYWORDS_RE.test(output);

    if (BANNER_RE.test(output)) {
      events.push({ kind: 'banner', cli: 'codex', timestamp: ts, confidence: 'high' });
    }

    if (readyPromptVisible) {
      events.push({ kind: 'ready', cli: 'codex', timestamp: ts, confidence: 'medium' });
    }

    if (!readyPromptVisible && SHELL_PROMPT_RE.test(output)) {
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

    // Sniff for the large NEW_TASK activation request and shorten it.
    if (signal.includes('### MISSION_CONTROL_ACTIVATION_REQUEST ###')) {
      const missionIdMatch = signal.match(/missionId: "([^"]+)"/);
      const nodeIdMatch = signal.match(/nodeId: "([^"]+)"/);
      if (missionIdMatch && nodeIdMatch) {
        target = `### MISSION_CONTROL_ACTIVATION_REQUEST ### Please call 'get_task_details({ missionId: "${missionIdMatch[1]}", nodeId: "${nodeIdMatch[1]}" })'`;
      }
    } 
    // Sniff for the large bootstrap prompt and shorten it.
    else if (signal.includes('Connect to MCP before task activation.')) {
      const mcpUrlMatch = signal.match(/MCP URL: (https?:\/\/[^\s]+)\./);
      const roleMatch = signal.match(/role="([^"]+)"/);
      const agentIdMatch = signal.match(/agentId="([^"]+)"/);
      const terminalIdMatch = signal.match(/terminalId="([^"]+)"/);
      const missionIdMatch = signal.match(/missionId: "([^"]+)"/);
      const nodeIdMatch = signal.match(/nodeId: "([^"]+)"/);
      const attemptMatch = signal.match(/attempt=(\d+)/);

      if (mcpUrlMatch && roleMatch && agentIdMatch && terminalIdMatch && missionIdMatch && nodeIdMatch && attemptMatch) {
        target = `Connect to MCP: ${mcpUrlMatch[1]}. Call connect_agent(role="${roleMatch[1]}", agentId="${agentIdMatch[1]}", terminalId="${terminalIdMatch[1]}", missionId="${missionIdMatch[1]}", nodeId="${nodeIdMatch[1]}", attempt=${attemptMatch[1]}). Then wait for NEW_TASK and run get_task_details.`;
      }
    }

    const flat = target.replace(/\r?\n/g, ' ').replace(/\s{2,}/g, ' ').trim();
    return {
      // Ctrl+U is returned as a separate preClear so RuntimeManager can write it
      // first, sleep a settle gap, then write the bracketed paste.  Sending both
      // in a single PTY write causes the Codex readline reset (which fires ~ms
      // after the prompt appears) to eat the leading bytes of the paste.
      preClear: '\x15',
      paste: `\x1b[200~${flat}\x1b[201~`,
      submit: '\r',
    };
  },
};
