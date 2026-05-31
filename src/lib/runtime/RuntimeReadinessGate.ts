import type {
  ReadyDetectionResult,
  StatusDetectionResult,
} from './adapters/CliAdapter.js';

export const STRICT_STATUS_GATE_CLI_IDS = new Set(['codex', 'opencode', 'claude', 'gemini']);

export interface CliReadinessEvaluation {
  ready: boolean;
  strictGateEnabled: boolean;
  status: StatusDetectionResult;
  legacyReady?: ReadyDetectionResult;
}

export interface CliReadinessDiagnosticContext {
  cliId: string;
  terminalId: string;
  nodeId: string;
  sessionId?: string | null;
  timeoutMs?: number;
  status: StatusDetectionResult;
  strictGateEnabled: boolean;
  recentOutput: string;
}

export function isStrictCliStatusGateEnabled(cliId: string | null | undefined): boolean {
  return STRICT_STATUS_GATE_CLI_IDS.has((cliId ?? '').trim().toLowerCase());
}

export function isStatusSafeForManagedInjection(status: StatusDetectionResult): boolean {
  return status.status === 'idle' && status.confidence !== 'low';
}

export function evaluateCliReadiness(
  cliId: string,
  output: string,
  detectStatus: (output: string) => StatusDetectionResult,
  detectReady: (output: string) => ReadyDetectionResult,
): CliReadinessEvaluation {
  const strictGateEnabled = isStrictCliStatusGateEnabled(cliId);
  const status = detectStatus(output);

  if (strictGateEnabled) {
    return {
      ready: isStatusSafeForManagedInjection(status),
      strictGateEnabled,
      status,
    };
  }

  const legacyReady = detectReady(output);
  return {
    ready: legacyReady.ready && legacyReady.confidence !== 'low',
    strictGateEnabled,
    status,
    legacyReady,
  };
}

export function redactCliDiagnosticText(value: string): string {
  return value
    .replace(/\b(https?:\/\/)[^:\s/@]+:[^@\s/]+@/gi, '$1<redacted>@')
    .replace(/([?&](?:token|access_token|api_key|key|secret)=)[^&\s'"]+/gi, '$1<redacted>')
    .replace(/\b(Bearer\s+)[A-Za-z0-9._~+/=-]+/gi, '$1<redacted>')
    .replace(/\b([A-Za-z0-9_]*(?:TOKEN|API_KEY|SECRET|PASSWORD)[A-Za-z0-9_]*=)[^\s'"]+/g, '$1<redacted>');
}

function cleanCliDiagnosticField(value: string): string {
  return redactCliDiagnosticText(value)
    .replace(/[\x00-\x1F\x7F]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export function buildCliReadinessDiagnostic(context: CliReadinessDiagnosticContext): string {
  const sessionPart = context.sessionId ? ` sessionId=${context.sessionId}` : '';
  const timeoutPart = typeof context.timeoutMs === 'number' ? ` timeoutMs=${context.timeoutMs}` : '';
  const detail = cleanCliDiagnosticField(context.status.detail);
  const tail = cleanCliDiagnosticField(context.recentOutput.trim()) || '<empty>';

  return [
    `CLI readiness gate blocked injection: cli=${context.cliId}`,
    `terminalId=${context.terminalId}`,
    `nodeId=${context.nodeId}`,
    `${sessionPart.trim()}`,
    `status=${context.status.status}`,
    `confidence=${context.status.confidence}`,
    `detail="${detail}"`,
    `strictGateEnabled=${context.strictGateEnabled}`,
    `${timeoutPart.trim()}`,
    `recentTail="${tail}"`,
  ]
    .filter(Boolean)
    .join(' ');
}
