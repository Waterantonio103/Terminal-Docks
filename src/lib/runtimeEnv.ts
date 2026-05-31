export interface CometRuntimeEnvInput {
  sessionId: string;
  agentId?: string | null;
  missionId?: string | null;
  nodeId?: string | null;
  attempt?: string | number | null;
  runId?: string | null;
  executionMode?: string | null;
  mcpUrl?: string | null;
  workspaceDir?: string | null;
  kind?: string | null;
  promptPath?: string | null;
}

const RUNTIME_ENV_KEYS = [
  'SESSION_ID',
  'AGENT_ID',
  'MISSION_ID',
  'NODE_ID',
  'ATTEMPT',
  'RUN_ID',
  'EXECUTION_MODE',
  'MCP_URL',
  'WORKSPACE',
  'KIND',
  'PROMPT_PATH',
] as const;

export type RuntimeEnvKey = typeof RUNTIME_ENV_KEYS[number];

function assignRuntimeEnv(
  env: Record<string, string>,
  key: RuntimeEnvKey,
  value?: string | number | null,
): void {
  if (value === undefined || value === null) return;
  const stringValue = cleanRuntimeEnvValue(value);
  if (!stringValue) return;
  env[`COMET_${key}`] = stringValue;
  env[`TD_${key}`] = stringValue;
}

function cleanRuntimeEnvValue(value: string | number): string {
  return String(value).replace(/\0/g, '').trim();
}

function normalizeRuntimeEnvLookupKey(key: string): string {
  return key
    .replace(/\0/g, '')
    .trim()
    .replace(/^(?:COMET|TD)_/i, '')
    .toUpperCase();
}

export function buildCometRuntimeEnv(input: CometRuntimeEnvInput): Record<string, string> {
  const env: Record<string, string> = {};
  assignRuntimeEnv(env, 'SESSION_ID', input.sessionId);
  assignRuntimeEnv(env, 'AGENT_ID', input.agentId);
  assignRuntimeEnv(env, 'MISSION_ID', input.missionId);
  assignRuntimeEnv(env, 'NODE_ID', input.nodeId);
  assignRuntimeEnv(env, 'ATTEMPT', input.attempt);
  assignRuntimeEnv(env, 'RUN_ID', input.runId);
  assignRuntimeEnv(env, 'EXECUTION_MODE', input.executionMode);
  assignRuntimeEnv(env, 'MCP_URL', input.mcpUrl);
  assignRuntimeEnv(env, 'WORKSPACE', input.workspaceDir);
  assignRuntimeEnv(env, 'KIND', input.kind);
  assignRuntimeEnv(env, 'PROMPT_PATH', input.promptPath);
  return env;
}

export function readCometEnv(
  env: Record<string, string> | null | undefined,
  key: string,
  fallbackKey?: string,
): string | undefined {
  if (!env) return undefined;
  const lookupKey = normalizeRuntimeEnvLookupKey(key);
  const fallbackLookupKey = fallbackKey?.replace(/\0/g, '').trim();
  if (!lookupKey) {
    const fallbackValue = fallbackLookupKey ? env[fallbackLookupKey] : undefined;
    return fallbackValue === undefined ? undefined : cleanRuntimeEnvValue(fallbackValue);
  }
  const value = env[`COMET_${lookupKey}`] ?? env[`TD_${lookupKey}`] ?? (fallbackLookupKey ? env[fallbackLookupKey] : undefined);
  if (value === undefined) return undefined;
  return cleanRuntimeEnvValue(value);
}
