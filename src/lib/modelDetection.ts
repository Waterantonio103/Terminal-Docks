import type { WorkflowAgentCli } from '../store/workspace';
import {
  discoverModelsForCli,
  invalidateModelDiscoveryCache,
  supportsModelDiscovery,
} from './models/modelDiscoveryService';

export async function getModelsForCli(cli: WorkflowAgentCli): Promise<string[]> {
  if (!supportsModelDiscovery(cli)) return [];
  const result = await discoverModelsForCli(cli);
  return result.models
    .filter(model => model.source !== 'default' && model.source !== 'custom')
    .map(model => model.id);
}

export function invalidateModelCache(cli?: WorkflowAgentCli) {
  if (cli && supportsModelDiscovery(cli)) {
    invalidateModelDiscoveryCache(cli);
  } else if (!cli) {
    invalidateModelDiscoveryCache();
  }
}

export function hasModelListSupport(cli: WorkflowAgentCli): boolean {
  return supportsModelDiscovery(cli);
}
