import { invoke } from '@tauri-apps/api/core';
import type {
  CompiledMission,
  CompiledMissionNode,
  WorkflowAgentCli,
} from '../store/workspace';
import { useWorkspaceStore } from '../store/workspace';
import { getCliAdapter } from './cliAdapters';
import { resolveNextNodes, type NodeOutcome } from './workflowRuntimePlanning';

export { resolveNextNodes } from './workflowRuntimePlanning';
export type { NodeOutcome } from './workflowRuntimePlanning';

export type RuntimeStatus =
  | 'idle'
  | 'terminal_creating'
  | 'terminal_ready'
  | 'cli_launching'
  | 'cli_ready_guess'
  | 'prompt_sending'
  | 'running'
  | 'waiting_for_completion'
  | 'completed'
  | 'failed';

export interface AgentLaunchResult {
  nodeId: string;
  terminalId: string;
  cli: WorkflowAgentCli;
  status: RuntimeStatus;
  error?: string;
}

export type StatusCallback = (nodeId: string, status: RuntimeStatus, details?: string) => void;

export interface LaunchAgentOptions {
  onStatus?: StatusCallback;
  /** Maximum time to wait for CLI readiness hints before falling back to delay. */
  readinessTimeoutMs?: number;
  /** Upstream handoff payload, if this node is downstream in a chain. */
  upstreamHandoff?: string | null;
}

export interface LaunchMissionOptions {
  mission: CompiledMission;
  onStatus?: StatusCallback;
  readinessTimeoutMs?: number;
}

const DEFAULT_READINESS_TIMEOUT_MS = 10000;
const READINESS_POLL_INTERVAL_MS = 500;
const MAX_TERMINAL_OUTPUT_BYTES = 16384;

async function writePty(terminalId: string, data: string): Promise<void> {
  await invoke('write_to_pty', { id: terminalId, data });
}

async function readPty(terminalId: string): Promise<string> {
  try {
    return await invoke<string>('get_pty_recent_output', {
      id: terminalId,
      maxBytes: MAX_TERMINAL_OUTPUT_BYTES,
    });
  } catch {
    return '';
  }
}

function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Poll the PTY buffer until any readiness hint appears, or until either
 * the readiness timeout OR the adapter's fallback `startupDelayMs` elapses.
 * Returns true if a hint matched, false if we fell back to the delay.
 */
async function waitForCliReadiness(
  terminalId: string,
  hints: string[],
  readinessTimeoutMs: number,
  fallbackDelayMs: number,
): Promise<boolean> {
  const deadline = Date.now() + Math.max(readinessTimeoutMs, fallbackDelayMs);
  const loweredHints = hints.map(h => h.toLowerCase()).filter(h => h.length > 0);
  while (Date.now() < deadline) {
    if (loweredHints.length > 0) {
      const buffer = (await readPty(terminalId)).toLowerCase();
      if (loweredHints.some(hint => buffer.includes(hint))) return true;
    }
    await delay(READINESS_POLL_INTERVAL_MS);
  }
  return false;
}

export async function launchAgentNode(
  mission: CompiledMission,
  node: CompiledMissionNode,
  opts: LaunchAgentOptions = {},
): Promise<AgentLaunchResult> {
  const { onStatus, upstreamHandoff } = opts;
  const readinessTimeoutMs = opts.readinessTimeoutMs ?? DEFAULT_READINESS_TIMEOUT_MS;
  const terminalId = node.terminal.terminalId;
  const cli = node.terminal.cli;

  const adapter = getCliAdapter(cli);
  if (!adapter) {
    const error = `No runtime adapter registered for CLI "${cli}". Supported: claude, codex, gemini, opencode.`;
    onStatus?.(node.id, 'failed', error);
    return { nodeId: node.id, terminalId, cli, status: 'failed', error };
  }

  try {
    onStatus?.(node.id, 'terminal_ready');

    const state = useWorkspaceStore.getState();
    const pane = state.tabs.flatMap(t => t.panes).find(p => p.id === terminalId);
    const isCliRunning = pane?.data?.cli === cli;

    if (!isCliRunning) {
      onStatus?.(node.id, 'cli_launching', `Launching ${adapter.displayName}`);
      await writePty(terminalId, adapter.launchCommand() + '\r');
      // Give it a brief moment to start outputting
      await delay(500);
    } else {
      onStatus?.(node.id, 'cli_launching', `Waiting for ${adapter.displayName}`);
    }

    const readyByHint = await waitForCliReadiness(
      terminalId,
      adapter.readinessHints(),
      readinessTimeoutMs,
      adapter.startupDelayMs,
    );
    onStatus?.(
      node.id,
      'cli_ready_guess',
      readyByHint ? 'Readiness hint detected' : 'Fell back to startup delay',
    );

    onStatus?.(node.id, 'prompt_sending');
    const prompt = adapter.formatPrompt({
      missionGoal: mission.task.prompt,
      roleId: node.roleId,
      roleInstructions: node.instructionOverride,
      workspaceDir: mission.task.workspaceDir,
      upstreamHandoff,
    });

    await writePty(terminalId, prompt);
    await delay(adapter.submitDelayMs);
    await writePty(terminalId, '\r');

    onStatus?.(node.id, 'running');
    onStatus?.(node.id, 'waiting_for_completion');
    return { nodeId: node.id, terminalId, cli, status: 'waiting_for_completion' };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    onStatus?.(node.id, 'failed', error);
    return { nodeId: node.id, terminalId, cli, status: 'failed', error };
  }
}

export async function launchMissionStartNodes(
  options: LaunchMissionOptions,
): Promise<AgentLaunchResult[]> {
  const { mission, onStatus, readinessTimeoutMs } = options;
  const nodeById = new Map(mission.nodes.map(node => [node.id, node]));
  const startNodes = mission.metadata.startNodeIds
    .map(id => nodeById.get(id))
    .filter((node): node is CompiledMissionNode => Boolean(node));

  if (startNodes.length === 0) {
    throw new Error('Mission has no start nodes to activate.');
  }

  return Promise.all(
    startNodes.map(node => launchAgentNode(mission, node, { onStatus, readinessTimeoutMs })),
  );
}

/**
 * Capture the latest terminal buffer for a node. Used by Output Capture
 * (Phase 4) when the user marks a node complete.
 */
export async function captureTerminalOutput(terminalId: string): Promise<string> {
  return readPty(terminalId);
}

export interface CompleteAgentNodeOptions {
  mission: CompiledMission;
  nodeId: string;
  outcome: NodeOutcome;
  summary?: string;
  onStatus?: StatusCallback;
  readinessTimeoutMs?: number;
}

export interface CompleteAgentNodeResult {
  capturedOutput: string;
  launchedNext: AgentLaunchResult[];
  summary: string;
}

/**
 * Mark a node complete, capture its terminal output, and activate the
 * downstream agents according to the mission graph edges.
 */
export async function completeAgentNode(
  options: CompleteAgentNodeOptions,
): Promise<CompleteAgentNodeResult> {
  const { mission, nodeId, outcome, onStatus, readinessTimeoutMs } = options;
  const node = mission.nodes.find(candidate => candidate.id === nodeId);
  if (!node) {
    throw new Error(`Node ${nodeId} is not part of mission ${mission.missionId}.`);
  }

  const capturedOutput = await captureTerminalOutput(node.terminal.terminalId);
  const summary = (options.summary ?? capturedOutput).slice(-4000);
  onStatus?.(nodeId, outcome === 'success' ? 'completed' : 'failed', 'Completion captured');

  const nextNodes = resolveNextNodes(mission, nodeId, outcome);
  const launchedNext = await Promise.all(
    nextNodes.map(next =>
      launchAgentNode(mission, next, {
        onStatus,
        readinessTimeoutMs,
        upstreamHandoff: summary,
      }),
    ),
  );

  return { capturedOutput, launchedNext, summary };
}
