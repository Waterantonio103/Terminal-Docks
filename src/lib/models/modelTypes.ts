export type CliId = 'claude' | 'gemini' | 'codex' | 'opencode';

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
  return value === 'claude' || value === 'gemini' || value === 'codex' || value === 'opencode';
}
