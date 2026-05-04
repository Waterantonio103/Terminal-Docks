import { emit } from '../../lib/desktopApi';
import type { RuntimeManager } from '../../lib/runtime/RuntimeManager';
import type {
  RuntimeManagerBridge,
  RuntimeManagerBridgeSession,
} from '../../lib/runtime/RuntimeTypes';
import { useWorkspaceStore, type WorkflowAgentCli, type WorkflowNodeStatus } from '../../store/workspace';

function asWorkflowCli(cliId: RuntimeManagerBridgeSession['cliId']): WorkflowAgentCli | undefined {
  switch (cliId) {
    case 'claude':
    case 'codex':
    case 'gemini':
    case 'opencode':
    case 'custom':
    case 'ollama':
    case 'lmstudio':
      return cliId;
    default:
      return undefined;
  }
}

function markCliAttachedToTerminal(session: RuntimeManagerBridgeSession): void {
  const cli = asWorkflowCli(session.cliId);
  useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
    cliSource: 'connect_agent',
    ...(cli ? { cli } : {}),
  });
}

export function createRuntimeUiBridge(): RuntimeManagerBridge {
  return {
    onSessionStateChanged(session, _from, to) {
      const store = useWorkspaceStore.getState();
      const existingBinding = store.nodeRuntimeBindings[session.nodeId];
      if (existingBinding?.adapterStatus !== to || existingBinding?.runtimeSessionId !== session.sessionId) {
        store.setNodeRuntimeBinding(session.nodeId, {
          terminalId: session.terminalId || existingBinding?.terminalId || '',
          runtimeSessionId: session.sessionId,
          adapterStatus: to as WorkflowNodeStatus,
        });
      }

      emit('workflow-node-update', {
        id: session.nodeId,
        status: to,
        attempt: session.attempt,
      }).catch(() => {});
    },

    bindRuntimeToTerminalPane(session) {
      const cli = asWorkflowCli(session.cliId);
      useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
        runtimeSessionId: session.sessionId,
        nodeId: session.nodeId,
        roleId: session.role,
        ...(cli ? { cli } : {}),
      });
    },

    markCliAttachedToTerminal,

    getTerminalRuntimeConfig(terminalId) {
      const state = useWorkspaceStore.getState();
      for (const tab of state.tabs) {
        const terminalPane = tab.panes.find(candidate =>
          candidate.type === 'terminal' && candidate.data?.terminalId === terminalId,
        );
        if (terminalPane) {
          return {
            customCommand: terminalPane.data?.customCliCommand ?? null,
            customArgs: Array.isArray(terminalPane.data?.customCliArgs) ? terminalPane.data.customCliArgs : null,
            customEnv: terminalPane.data?.customCliEnv ?? null,
          };
        }
      }
      return {};
    },

    getTerminalState(terminalId) {
      const state = useWorkspaceStore.getState();
      const allPanes = state.tabs.flatMap(tab => tab.panes);
      const pane = allPanes.find(candidate => candidate.data?.terminalId === terminalId);
      const liveRuntimeSessionIds = Object.values(state.nodeRuntimeBindings)
        .filter(binding => binding?.terminalId === terminalId && typeof binding.runtimeSessionId === 'string')
        .map(binding => binding.runtimeSessionId)
        .filter((sessionId): sessionId is string => typeof sessionId === 'string');

      return {
        paneRuntimeSessionId: typeof pane?.data?.runtimeSessionId === 'string' ? pane.data.runtimeSessionId : null,
        cli: typeof pane?.data?.cli === 'string' ? pane.data.cli : null,
        cliSource: typeof pane?.data?.cliSource === 'string' ? pane.data.cliSource : null,
        liveRuntimeSessionIds,
      };
    },
  };
}

export function installRuntimeUiBridge(manager: RuntimeManager): () => void {
  manager.setBridge(createRuntimeUiBridge());
  return () => {
    manager.setBridge(null);
  };
}
