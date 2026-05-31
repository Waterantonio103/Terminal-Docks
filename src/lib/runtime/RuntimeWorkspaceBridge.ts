import { useWorkspaceStore, type NodeRuntimeBinding, type Pane } from '../../store/workspace.js';
import { normalizeTerminalId } from '../terminalIds.js';

type TerminalPaneData = Partial<NonNullable<Pane['data']>>;

export function getRuntimeNodeBinding(nodeId: string): NodeRuntimeBinding | undefined {
  return useWorkspaceStore.getState().nodeRuntimeBindings[nodeId];
}

export function getRuntimeNodeBindings(): Record<string, NodeRuntimeBinding> {
  return useWorkspaceStore.getState().nodeRuntimeBindings;
}

export function setRuntimeNodeBinding(nodeId: string, binding: NodeRuntimeBinding): void {
  useWorkspaceStore.getState().setNodeRuntimeBinding(nodeId, binding);
}

export function updateRuntimeTerminalPaneData(terminalId: string, data: TerminalPaneData): void {
  useWorkspaceStore.getState().updatePaneDataByTerminalId(terminalId, data);
}

export function getRuntimeTerminalPanes(): Pane[] {
  return useWorkspaceStore.getState().tabs.flatMap(tab => tab.panes.filter(pane => pane.type === 'terminal'));
}

export function getRuntimeTerminalPane(terminalId: string): Pane | undefined {
  const normalizedTerminalId = normalizeTerminalId(terminalId);
  if (!normalizedTerminalId) return undefined;
  return getRuntimeTerminalPanes().find(pane => normalizeTerminalId(pane.data?.terminalId) === normalizedTerminalId);
}
