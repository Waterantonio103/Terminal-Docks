import { invoke } from '@tauri-apps/api/core';
import type { ModelDiscoveryResult } from '../modelTypes';

export async function discoverClaudeModels(workspaceDir?: string | null, refresh = false): Promise<ModelDiscoveryResult> {
  return await invoke<ModelDiscoveryResult>('discover_cli_models', {
    cli: 'claude',
    refresh,
    projectPath: workspaceDir ?? null,
  });
}
