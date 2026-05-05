export type PostAckWatchdogReason = 'post_ack_no_progress' | 'post_ack_no_mcp_completion';
export type PostAckWatchdogAction = 'none' | 'nudge' | 'fail';

export type PostAckProgressSource =
  | 'mcp_event'
  | 'terminal_output'
  | 'known_long_running_progress'
  | 'expected_file_output'
  | 'permission_prompt'
  | 'manual_input';

export interface PostAckProgressSnapshot {
  acknowledgedAt: number;
  lastProgressAt: number;
  progressCount: number;
  mcpEventCount: number;
  terminalProgressCount: number;
  expectedFileOutputCount: number;
  permissionPromptCount: number;
  lastProgressSource?: PostAckProgressSource;
  warnedAt?: number | null;
}

export interface PostAckWatchdogDecision {
  action: PostAckWatchdogAction;
  reason?: PostAckWatchdogReason;
  idleMs: number;
}

export interface TerminalProgressAssessment {
  useful: boolean;
  source?: 'terminal_output' | 'known_long_running_progress';
  signature?: string;
  preview?: string;
  detail?: string;
}

const ANSI_RE =
  /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
const LOW_SIGNAL_RE = /^[^a-z0-9]+$/i;
const WATCHDOG_NUDGE_RE =
  /Terminal Docks still has missionId=|Terminal Docks is still waiting for MCP complete_task|post-ACK watchdog/i;
const CLI_CHROME_RE =
  /\b(?:context\s+\d+%|insert|bypass permissions|shift\+tab|ready for next turn|type your|ask anything|input|prompt)\b/i;
const USEFUL_PROGRESS_RE =
  /\b(?:tool|calling|called|using|running|executing|command|shell|read|reading|write|writing|wrote|created|updated|modified|deleted|patch|applying|installing|fetching|downloading|building|compiling|testing|searching|grep|rg|npm|node|python|cargo|git|pass|failed|error)\b/i;
const LONG_RUNNING_RE =
  /\b(?:installing|fetching|downloading|building|compiling|testing|running\s+(?:command|tests?|npm|node|python|cargo|git)|waiting for (?:model|tool|response|command|rate limit)|rate[- ]limit)\b/i;

function stripTerminalControls(output: string): string {
  return output
    .replace(ANSI_RE, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '')
    .replace(/[\u2800-\u28ff]/g, ' ');
}

function normalizeProgressText(output: string): string {
  return stripTerminalControls(output)
    .replace(/\b\d+(?:\.\d+)?\s*(?:ms|s|m|h|%|kb|mb|gb)\b/gi, '#')
    .replace(/\b\d+\b/g, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function preview(value: string, limit = 240): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...`;
}

export function isMeaningfulPostAckMcpEvent(type: string): boolean {
  return !new Set([
    'activation:acked',
    'agent:ready',
    'bootstrap:requested',
    'task:pushed',
  ]).has(type);
}

export function classifyPostAckWatchdogReason(snapshot: PostAckProgressSnapshot): PostAckWatchdogReason {
  return snapshot.progressCount > 0 ? 'post_ack_no_mcp_completion' : 'post_ack_no_progress';
}

export function evaluatePostAckWatchdog(args: {
  snapshot: PostAckProgressSnapshot;
  now: number;
  windowMs: number;
  completed?: boolean;
  blockedOnPermission?: boolean;
}): PostAckWatchdogDecision {
  const idleMs = Math.max(0, args.now - args.snapshot.lastProgressAt);
  if (args.completed || args.blockedOnPermission) {
    return { action: 'none', idleMs };
  }

  if (idleMs < args.windowMs) {
    return { action: 'none', idleMs };
  }

  const reason = classifyPostAckWatchdogReason(args.snapshot);
  if (!args.snapshot.warnedAt) {
    return { action: 'nudge', reason, idleMs };
  }

  if (idleMs < args.windowMs * 2) {
    return { action: 'none', reason, idleMs };
  }

  return { action: 'fail', reason, idleMs };
}

export function assessPostAckTerminalProgress(output: string): TerminalProgressAssessment {
  const normalized = normalizeProgressText(output);
  if (!normalized || normalized.length < 3) return { useful: false };
  if (WATCHDOG_NUDGE_RE.test(normalized)) return { useful: false };
  if (LOW_SIGNAL_RE.test(normalized)) return { useful: false };
  if (!/[a-z0-9]/i.test(normalized)) return { useful: false };

  const signature = normalized.toLowerCase().slice(-500);
  if (LONG_RUNNING_RE.test(normalized)) {
    return {
      useful: true,
      source: 'known_long_running_progress',
      signature,
      preview: preview(normalized),
      detail: 'known long-running terminal progress',
    };
  }

  if (USEFUL_PROGRESS_RE.test(normalized)) {
    return {
      useful: true,
      source: 'terminal_output',
      signature,
      preview: preview(normalized),
      detail: 'terminal tool or file progress',
    };
  }

  if (CLI_CHROME_RE.test(normalized)) return { useful: false };
  if (normalized.length < 80) return { useful: false };

  return {
    useful: true,
    source: 'terminal_output',
    signature,
    preview: preview(normalized),
    detail: 'substantial terminal output',
  };
}
