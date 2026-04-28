import { invoke } from '@tauri-apps/api/core';
import type { ModelDiscoveryResult } from '../modelTypes';

export async function discoverCodexModels(workspaceDir?: string | null, refresh = false): Promise<ModelDiscoveryResult> {
  return await invoke<ModelDiscoveryResult>('discover_cli_models', {
    cli: 'codex',
    refresh,
    projectPath: workspaceDir ?? null,
  });
}
