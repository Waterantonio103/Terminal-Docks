import type { CliId } from '../cliIdentity.js';
import { normalizeCliId } from '../cliIdentity.js';

export type { CliId };

const MODEL_DISCOVERY_CLI_IDS: readonly CliId[] = ['claude', 'gemini', 'codex', 'opencode'];
const MODEL_DISCOVERY_CLI_ID_SET = new Set<CliId>(MODEL_DISCOVERY_CLI_IDS);

export type ModelSource =
  | 'cli-command'
  | 'interactive-cli-scrape'
  | 'config-file'
  | 'cache-file'
  | 'default'
  | 'custom';

export interface CliModel {
  cli: CliId;
  id: string;
  label: string;
  provider?: string;
  source: ModelSource;
  raw?: string;
  contextWindow?: number;
  maxContextWindow?: number;
  canLaunch?: boolean;
  reason?: string;
}

export interface DiscoveryAttempt {
  method: string;
  command?: string;
  args?: string[];
  filePath?: string;
  exitCode?: number | null;
  stdoutPreview?: string;
  stderrPreview?: string;
  modelsParsed: number;
  error?: string;
  parserReason?: string;
}

export interface ModelDiscoveryResult {
  cli: CliId;
  models: CliModel[];
  attempts: DiscoveryAttempt[];
  errors?: string[];
  warnings?: string[];
  fetchedAt?: string;
  refreshedAt?: string;
  fromCache?: boolean;
  cachePath?: string;
}

export function isModelCliId(value: unknown): value is CliId {
  const cli = normalizeCliId(value);
  return Boolean(cli && MODEL_DISCOVERY_CLI_ID_SET.has(cli));
}
