import { invoke } from '@tauri-apps/api/core';
import type { Pane } from '../store/workspace';
import { detectCliFromTerminalOutput, normalizeCli, type AgentCli } from './cliDetection';

type PaneDataPatch = Partial<NonNullable<Pane['data']>>;
type UpdatePaneData = (id: string, data: PaneDataPatch) => void;

interface RuntimeState {
  candidateCli: AgentCli | null;
  candidateCount: number;
  noHitCount: number;
}

const states = new Map<string, RuntimeState>();
const SWITCH_CONFIRMATION_COUNT = 2;
const CLEAR_AFTER_NO_HIT_COUNT = 3;

function getState(terminalId: string): RuntimeState {
  const existing = states.get(terminalId);
  if (existing) return existing;
  const created: RuntimeState = { candidateCli: null, candidateCount: 0, noHitCount: 0 };
  states.set(terminalId, created);
  return created;
}

export async function refreshCliDetectionForTerminals(
  panes: Pane[],
  updatePaneData: UpdatePaneData
): Promise<void> {
  const terminals = panes.filter(p => p.type === 'terminal');

  await Promise.all(terminals.map(async pane => {
    const terminalId = pane.data?.terminalId;
    if (!terminalId) return;

    let recentOutput = '';
    try {
      recentOutput = await invoke<string>('get_pty_recent_output', { id: terminalId, maxBytes: 16384 });
    } catch {
      return;
    }

    const state = getState(terminalId);
    const currentCli = normalizeCli(pane.data?.cli);
    const currentSource = pane.data?.cliSource;
    const detected = detectCliFromTerminalOutput(recentOutput);

    if (detected.cli) {
      state.noHitCount = 0;

      if (currentCli === detected.cli) {
        state.candidateCli = detected.cli;
        state.candidateCount = 0;
        return;
      }

      if (state.candidateCli === detected.cli) {
        state.candidateCount += 1;
      } else {
        state.candidateCli = detected.cli;
        state.candidateCount = 1;
      }

      const shouldApply = !currentCli || state.candidateCount >= SWITCH_CONFIRMATION_COUNT;
      if (!shouldApply) return;

      updatePaneData(pane.id, {
        cli: detected.cli,
        cliSource: 'stdout',
        cliConfidence: detected.confidence,
        cliUpdatedAt: Date.now(),
      });
      state.candidateCount = 0;
      return;
    }

    state.candidateCli = null;
    state.candidateCount = 0;
    state.noHitCount += 1;

    if (currentSource === 'stdout' && currentCli && state.noHitCount >= CLEAR_AFTER_NO_HIT_COUNT) {
      updatePaneData(pane.id, {
        cli: undefined,
        cliSource: 'stdout',
        cliConfidence: 'low',
        cliUpdatedAt: Date.now(),
      });
      state.noHitCount = 0;
    }
  }));
}
