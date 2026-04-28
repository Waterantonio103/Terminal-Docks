import { invoke } from '@tauri-apps/api/core';
import type { ModelDiscoveryResult } from '../modelTypes';

export async function discoverOpenCodeModels(refresh = false): Promise<ModelDiscoveryResult> {
  return await invoke<ModelDiscoveryResult>('discover_cli_models', {
    cli: 'opencode',
    refresh,
    projectPath: null,
  });
}
