import type { CliAdapter } from './CliAdapter';
import { claudeAdapter } from './claude';
import { codexAdapter } from './codex';
import { geminiAdapter } from './gemini';
import { opencodeAdapter } from './opencode';
import { streamingAdapter } from './StreamingAdapter';

const ADAPTERS: Record<string, CliAdapter> = {
  claude: claudeAdapter,
  codex: codexAdapter,
  gemini: geminiAdapter,
  opencode: opencodeAdapter,
  streaming: streamingAdapter,
};

export function getCliAdapter(cliId: string | null | undefined): CliAdapter | null {
  if (!cliId) return null;
  const id = cliId.trim().toLowerCase();
  return ADAPTERS[id] ?? null;
}

export function getAllCliAdapters(): CliAdapter[] {
  return Object.values(ADAPTERS);
}

export function getSupportedCliIds(): string[] {
  return Object.keys(ADAPTERS);
}

export { claudeAdapter, codexAdapter, geminiAdapter, opencodeAdapter, streamingAdapter };
export type { CliAdapter } from './CliAdapter';
