import { discoverClaudeModels } from './providers/claudeModels';
import { discoverCodexModels } from './providers/codexModels';
import { discoverGeminiModels } from './providers/geminiModels';
import { discoverOpenCodeModels } from './providers/opencodeModels';
import type { CliId, ModelDiscoveryResult } from './modelTypes';
import { isModelCliId } from './modelTypes';

const CACHE_TTL_MS = 5 * 60 * 1000;

type CacheEntry = {
  result: ModelDiscoveryResult;
  ts: number;
};

const cache = new Map<string, CacheEntry>();

function cacheKey(cli: CliId, workspaceDir?: string | null): string {
  return `${cli}:${workspaceDir ?? ''}`;
}

export function supportsModelDiscovery(cli: unknown): cli is CliId {
  return isModelCliId(cli);
}

export async function discoverModelsForCli(
  cli: CliId,
  options: { refresh?: boolean; workspaceDir?: string | null } = {},
): Promise<ModelDiscoveryResult> {
  const key = cacheKey(cli, options.workspaceDir);
  const cached = cache.get(key);
  if (!options.refresh && cached && Date.now() - cached.ts < CACHE_TTL_MS) {
    return cached.result;
  }

  let result: ModelDiscoveryResult;
  try {
    if (cli === 'opencode') result = await discoverOpenCodeModels(Boolean(options.refresh));
    else if (cli === 'codex') result = await discoverCodexModels(options.workspaceDir, Boolean(options.refresh));
    else if (cli === 'claude') result = await discoverClaudeModels(options.workspaceDir, Boolean(options.refresh));
    else result = await discoverGeminiModels(options.workspaceDir, Boolean(options.refresh));
  } catch (error) {
    result = {
      cli,
      models: [],
      attempts: [],
      errors: [error instanceof Error ? error.message : String(error)],
      fetchedAt: new Date().toISOString(),
    };
  }

  cache.set(key, { result, ts: Date.now() });
  return result;
}

export function invalidateModelDiscoveryCache(cli?: CliId): void {
  if (!cli) {
    cache.clear();
    return;
  }
  for (const key of Array.from(cache.keys())) {
    if (key.startsWith(`${cli}:`)) cache.delete(key);
  }
}
