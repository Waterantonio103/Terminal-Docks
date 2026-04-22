import { claudeAdapter } from './claudeAdapter';
import { genericAdapter } from './genericAdapter';
import type { WorkerAdapter, WorkerKind } from './types';

const ADAPTERS: Record<WorkerKind, WorkerAdapter> = {
  claude: claudeAdapter,
  gemini: genericAdapter,
  codex: genericAdapter,
  opencode: genericAdapter,
  generic: genericAdapter,
};

export function getAdapter(kind: WorkerKind | null | undefined): WorkerAdapter {
  if (!kind) return genericAdapter;
  return ADAPTERS[kind] ?? genericAdapter;
}

export { registry, startStaleTicker } from './registry';
export { mcpBus, waitForMcpEvent } from './mcpEventBus';
export * from './types';
