import type { WorkflowAgentCli } from '../store/workspace';

const CACHE_TTL_MS = 60 * 60 * 1000;

type CacheEntry = { models: string[]; ts: number };
const cache = new Map<string, CacheEntry>();

const STATIC_MODELS: Partial<Record<WorkflowAgentCli, string[]>> = {
  claude:   ['claude-opus-4-7', 'claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-5', 'claude-sonnet-4-5'],
  opencode: ['kilo/anthropic/claude-opus-4-5', 'kilo/anthropic/claude-sonnet-4-5', 'kilo/google/gemini-2.5-pro', 'kilo/openai/gpt-4o', 'opencode/big-pickle'],
  gemini:   ['gemini-2.5-pro', 'gemini-2.0-flash', 'gemini-1.5-pro'],
  codex:    ['gpt-5.5', 'gpt-5.4', 'o4-mini', 'o3'],
};

export async function getModelsForCli(cli: WorkflowAgentCli): Promise<string[]> {
  const cached = cache.get(cli);
  if (cached && Date.now() - cached.ts < CACHE_TTL_MS) return cached.models;

  try {
    const { invoke } = await import('@tauri-apps/api/core');
    const models = await invoke<string[]>('detect_models', { cli });
    if (models.length > 0) {
      cache.set(cli, { models, ts: Date.now() });
      return models;
    }
  } catch {
    // fall through to static list
  }

  return STATIC_MODELS[cli] ?? [];
}

export function invalidateModelCache(cli?: WorkflowAgentCli) {
  if (cli) {
    cache.delete(cli);
  } else {
    cache.clear();
  }
}

export function hasModelListSupport(cli: WorkflowAgentCli): boolean {
  return cli in STATIC_MODELS;
}
