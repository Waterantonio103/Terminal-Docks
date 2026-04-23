import type { RuntimeActivationPayload } from './missionRuntime';

export type SupportedRuntimeCli = 'claude' | 'gemini' | 'opencode' | 'codex';

export interface RuntimeBootstrapContract {
  cli: SupportedRuntimeCli;
  endpoint: '/internal/push';
  registrationType: 'runtime_bootstrap';
  handshakeEvent: 'agent:ready';
  notes: string;
}

export interface RuntimeBootstrapRegistrationRequest {
  sessionId: string;
  missionId: string;
  nodeId: string;
  attempt: number;
  role: string;
  profileId?: string | null;
  agentId: string;
  terminalId: string;
  cli: SupportedRuntimeCli;
  capabilities?: Array<{
    id: string;
    level?: number;
    verifiedBy?: string;
  }>;
  workingDir?: string | null;
  activationId?: string;
  runId?: string;
}

const CONTRACTS: Record<SupportedRuntimeCli, RuntimeBootstrapContract> = {
  claude: {
    cli: 'claude',
    endpoint: '/internal/push',
    registrationType: 'runtime_bootstrap',
    handshakeEvent: 'agent:ready',
    notes: 'Bootstrap is sent by Mission Control; runtime readiness is gated on MCP session registration.',
  },
  gemini: {
    cli: 'gemini',
    endpoint: '/internal/push',
    registrationType: 'runtime_bootstrap',
    handshakeEvent: 'agent:ready',
    notes: 'Bootstrap is sent by Mission Control; runtime readiness is gated on MCP session registration.',
  },
  opencode: {
    cli: 'opencode',
    endpoint: '/internal/push',
    registrationType: 'runtime_bootstrap',
    handshakeEvent: 'agent:ready',
    notes: 'Bootstrap is sent by Mission Control; runtime readiness is gated on MCP session registration.',
  },
  codex: {
    cli: 'codex',
    endpoint: '/internal/push',
    registrationType: 'runtime_bootstrap',
    handshakeEvent: 'agent:ready',
    notes: 'Bootstrap is sent by Mission Control; runtime readiness is gated on MCP session registration.',
  },
};

export function normalizeRuntimeCli(value: unknown): SupportedRuntimeCli | null {
  if (typeof value !== 'string') return null;
  const cli = value.trim().toLowerCase();
  if (cli === 'claude' || cli === 'gemini' || cli === 'opencode' || cli === 'codex') {
    return cli;
  }
  return null;
}

export function getRuntimeBootstrapContract(value: unknown): RuntimeBootstrapContract | null {
  const cli = normalizeRuntimeCli(value);
  if (!cli) return null;
  return CONTRACTS[cli];
}

export function buildRuntimeBootstrapRegistrationRequest(
  payload: RuntimeActivationPayload,
): RuntimeBootstrapRegistrationRequest | null {
  const cli = normalizeRuntimeCli(payload.cliType);
  if (!cli) return null;

  const capabilities = Array.isArray(payload.capabilities)
    ? payload.capabilities
        .filter(capability => capability && typeof capability.id === 'string' && capability.id.trim().length > 0)
        .map(capability => ({
          id: capability.id.trim(),
          level: typeof capability.level === 'number' ? Math.max(0, Math.min(3, Math.floor(capability.level))) : undefined,
          verifiedBy: typeof capability.verifiedBy === 'string' ? capability.verifiedBy : undefined,
        }))
    : undefined;

  return {
    sessionId: payload.sessionId,
    missionId: payload.missionId,
    nodeId: payload.nodeId,
    attempt: payload.attempt,
    role: payload.role,
    profileId: payload.profileId ?? payload.role,
    agentId: payload.agentId,
    terminalId: payload.terminalId,
    cli,
    capabilities: capabilities && capabilities.length > 0 ? capabilities : undefined,
    workingDir: payload.workspaceDir ?? null,
    activationId: payload.activationId,
    runId: payload.runId,
  };
}
