import { invoke } from '@tauri-apps/api/core';
import { Window } from '@tauri-apps/api/window';
import type { CompiledMission, WorkflowAgentCli } from '../../store/workspace.js';
import { missionOrchestrator } from '../workflow/MissionOrchestrator.js';
import { workflowOrchestrator } from '../workflow/WorkflowOrchestrator.js';
import { runtimeManager } from '../runtime/RuntimeManager.js';
import { destroyTerminal, getRecentTerminalOutput } from '../runtime/TerminalRuntime.js';

type LiveWorkflowPhase = 'single' | 'double' | 'triple';
type LiveWorkflowStatus = 'passed' | 'failed' | 'timeout' | 'rate_limited' | 'blocked';
type LiveWorkflowTaskType = 'handshake' | 'metadata' | 'handoff';

interface LiveWorkflowHarnessOptions {
  repoRoot: string;
  outputPath: string;
  clis: WorkflowAgentCli[];
  phases: LiveWorkflowPhase[];
  cliSequences: WorkflowAgentCli[][];
  taskTypes: LiveWorkflowTaskType[];
  workflowTimeoutMs: number;
  closeWhenDone: boolean;
}

interface LiveWorkflowResult {
  cli: string;
  cliSequence: WorkflowAgentCli[];
  phase: LiveWorkflowPhase;
  taskType: LiveWorkflowTaskType;
  missionId: string;
  status: LiveWorkflowStatus;
  outcome?: string;
  durationMs: number;
  nodeIds: string[];
  terminalIds: string[];
  sessionEvents: Array<Record<string, unknown>>;
  orchestratorEvents: Array<Record<string, unknown>>;
  terminalTails: Record<string, string>;
  error?: string;
}

const VALID_CLIS: WorkflowAgentCli[] = ['claude', 'codex', 'gemini', 'opencode'];
const VALID_PHASES: LiveWorkflowPhase[] = ['single', 'double', 'triple'];
const VALID_TASK_TYPES: LiveWorkflowTaskType[] = ['handshake', 'metadata', 'handoff'];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withTimeout<T>(promise: Promise<T>, ms: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | null = null;
  try {
    return await Promise.race([
      promise,
      new Promise<T>(resolve => {
        timer = setTimeout(() => resolve(fallback), ms);
      }),
    ]);
  } finally {
    if (timer) clearTimeout(timer);
  }
}

function parseCsv<T extends string>(value: string | undefined, allowed: readonly T[], fallback: T[]): T[] {
  const selected = (value ?? '')
    .split(',')
    .map(item => item.trim().toLowerCase())
    .filter(Boolean) as T[];
  const filtered = selected.filter(item => allowed.includes(item));
  return filtered.length ? filtered : fallback;
}

function phaseFromSequence(sequence: WorkflowAgentCli[]): LiveWorkflowPhase | null {
  if (sequence.length === 1) return 'single';
  if (sequence.length === 2) return 'double';
  if (sequence.length === 3) return 'triple';
  return null;
}

function parseCliSequences(value: string | undefined): WorkflowAgentCli[][] {
  if (!value?.trim()) return [];
  return value
    .split(';')
    .map(sequence =>
      sequence
        .split(/[+,>]/)
        .map(item => item.trim().toLowerCase())
        .filter(Boolean) as WorkflowAgentCli[],
    )
    .filter(sequence => sequence.length > 0 && sequence.length <= 3 && sequence.every(cli => VALID_CLIS.includes(cli)));
}

function isRateLimitText(text: string): boolean {
  const lower = text.toLowerCase();
  return (
    lower.includes('rate limit') ||
    lower.includes('rate_limit') ||
    lower.includes('quota') ||
    lower.includes('limit exhausted') ||
    lower.includes('limit will reset') ||
    lower.includes('too many requests') ||
    lower.includes('429')
  );
}

function truncateText(value: string, limit = 1_000): string {
  return value.length <= limit ? value : `${value.slice(0, limit)}...[truncated ${value.length - limit} chars]`;
}

function compactEvent(event: Record<string, unknown>): Record<string, unknown> {
  const next = { ...event };
  if (typeof next.text === 'string') {
    next.text = truncateText(next.text);
  }
  return next;
}

function buildTaskPrompt(cliSequence: WorkflowAgentCli[], phase: LiveWorkflowPhase, taskType: LiveWorkflowTaskType): string {
  const sequenceLabel = cliSequence.join('>');
  const base = [
    `LIVE_WORKFLOW_TEST clis=${sequenceLabel} phase=${phase} task=${taskType}.`,
    'Do not edit files and do not run shell commands.',
    'Use the Terminal Docks MCP tools only.',
    'First call get_task_details with this missionId and your nodeId.',
  ];
  if (taskType === 'metadata') {
    base.push('Check that the task details include a mission id, node id, and prompt text before completing.');
  } else if (taskType === 'handoff') {
    base.push('If task details include upstream context, mention that you inspected it in the completion summary.');
  } else {
    base.push('This is a minimal tool handshake task.');
  }
  base.push(
    `Then call complete_task with outcome "success" and summary "LIVE_WORKFLOW_OK ${taskType}".`,
    'If the provider blocks the request, stop and report the provider message in the terminal output.',
  );
  return base.join(' ');
}

function buildMission(
  cliSequence: WorkflowAgentCli[],
  phase: LiveWorkflowPhase,
  taskType: LiveWorkflowTaskType,
  repoRoot: string,
): CompiledMission {
  const sequenceLabel = cliSequence.join('-');
  const suffix = `${sequenceLabel}-${phase}-${taskType}-${Date.now().toString(36)}`;
  const missionId = `live-workflow-${suffix}`;
  const graphId = `live-graph-${suffix}`;
  const nodeCount = cliSequence.length;
  const nodeIds = Array.from({ length: nodeCount }, (_, index) =>
    index === nodeCount - 1 && nodeCount > 1 ? 'live-output-agent' : `live-agent-${String.fromCharCode(97 + index)}`,
  );
  const terminalIds = nodeIds.map((_, index) => `live-term-${suffix}-${index + 1}`);
  const prompt = buildTaskPrompt(cliSequence, phase, taskType);

  return {
    missionId,
    graphId,
    task: {
      nodeId: 'live-task',
      prompt,
      mode: 'build',
      workspaceDir: repoRoot,
    },
    metadata: {
      compiledAt: Date.now(),
      sourceGraphId: graphId,
      startNodeIds: [nodeIds[0]],
      executionLayers: nodeIds.map(nodeId => [nodeId]),
      authoringMode: 'graph',
      presetId: `live:${phase}`,
      runVersion: 1,
    },
    nodes: nodeIds.map((nodeId, index) => ({
      id: nodeId,
      roleId: index === nodeIds.length - 1 && nodeIds.length > 1 ? 'debug-output' : 'debug-agent',
      instructionOverride: [
        'You are executing an automated live Terminal Docks workflow test.',
        'Do not make code changes.',
        'A successful result is only: get_task_details, then complete_task with outcome success.',
      ].join(' '),
      terminal: {
        terminalId: terminalIds[index],
        terminalTitle: `Live ${cliSequence[index]} ${phase} ${index + 1}`,
        cli: cliSequence[index],
        yolo: true,
        executionMode: 'interactive_pty',
        paneId: `pane-${terminalIds[index]}`,
        reusedExisting: false,
      },
    })),
    edges: nodeIds.slice(0, -1).map((nodeId, index) => ({
      id: `edge:${nodeId}:always:${nodeIds[index + 1]}`,
      fromNodeId: nodeId,
      toNodeId: nodeIds[index + 1],
      condition: 'always',
    })),
  };
}

async function writeReport(outputPath: string, report: Record<string, unknown>): Promise<void> {
  await invoke('workspace_write_text_file', {
    path: outputPath,
    content: JSON.stringify(report, null, 2),
  });
}

async function collectTerminalTails(terminalIds: string[]): Promise<Record<string, string>> {
  const entries: Array<[string, string]> = [];
  for (const terminalId of terminalIds) {
    entries.push([terminalId, await withTimeout(getRecentTerminalOutput(terminalId, 12_000), 2_500, '<tail collection timed out>')]);
  }
  return Object.fromEntries(entries);
}

async function cleanupMission(terminalIds: string[]): Promise<void> {
  const sessions = runtimeManager.getAllSessions();
  for (const session of sessions) {
    if (!terminalIds.includes(session.terminalId)) continue;
    await withTimeout(
      runtimeManager.stopRuntime({ sessionId: session.sessionId, reason: 'live workflow harness cleanup' }).catch(() => {}),
      5_000,
      undefined,
    );
  }
  for (const terminalId of terminalIds) {
    await withTimeout(destroyTerminal(terminalId).catch(() => {}), 2_500, undefined);
  }
}

async function runOneWorkflow(
  cliSequence: WorkflowAgentCli[],
  phase: LiveWorkflowPhase,
  taskType: LiveWorkflowTaskType,
  options: LiveWorkflowHarnessOptions,
): Promise<LiveWorkflowResult> {
  const startedAt = Date.now();
  const mission = buildMission(cliSequence, phase, taskType, options.repoRoot);
  const cliLabel = cliSequence.join('>');
  const sessionEvents: Array<Record<string, unknown>> = [];
  const orchestratorEvents: Array<Record<string, unknown>> = [];
  const sessionIds = new Set<string>();
  let terminalTails: Record<string, string> = {};
  let terminalStatus: LiveWorkflowStatus | null = null;

  const runtimeUnsub = runtimeManager.subscribe(event => {
    if ('missionId' in event && event.missionId !== mission.missionId) return;
    if ('sessionId' in event && typeof event.sessionId === 'string') {
      if (event.type === 'session_created') {
        sessionIds.add(event.sessionId);
      } else if (!sessionIds.has(event.sessionId)) {
        return;
      }
    }
    if (!('nodeId' in event) || !mission.nodes.some(node => node.id === event.nodeId)) return;
    sessionEvents.push(compactEvent({ ...event, at: Date.now() }));
    if (event.type === 'permission_requested') {
      void runtimeManager.resolvePermission({
        sessionId: event.sessionId,
        permissionId: event.request.permissionId,
        decision: 'approve',
      }).catch(error => {
        sessionEvents.push({
          type: 'permission_auto_approve_failed',
          sessionId: event.sessionId,
          error: error instanceof Error ? error.message : String(error),
          at: Date.now(),
        });
      });
    }
  });

  const orchestratorSub = workflowOrchestrator.subscribeForRun(mission.missionId, event => {
    orchestratorEvents.push({ ...event, at: Date.now() });
  });

  try {
    await withTimeout(
      invoke('seed_mission_to_db', { missionId: mission.missionId, graph: mission }),
      10_000,
      undefined,
    );
    await withTimeout(missionOrchestrator.launchMission(mission), 30_000, undefined);

    const deadline = Date.now() + options.workflowTimeoutMs;
    while (Date.now() < deadline) {
      const run = workflowOrchestrator.getRun(mission.missionId);
      terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
      if (Object.values(terminalTails).some(isRateLimitText)) {
        terminalStatus = 'rate_limited';
        break;
      }
      if (run?.status === 'completed') {
        const failures = Object.values(run.nodeStates).filter(node => node.state === 'failed');
        return {
          cli: cliLabel,
          cliSequence,
          phase,
          taskType,
          missionId: mission.missionId,
          status: failures.length ? 'failed' : 'passed',
          outcome: failures.length ? 'failure' : 'success',
          durationMs: Date.now() - startedAt,
          nodeIds: mission.nodes.map(node => node.id),
          terminalIds: mission.nodes.map(node => node.terminal.terminalId),
          sessionEvents,
          orchestratorEvents,
          terminalTails,
          error: failures.map(node => `${node.nodeId}: failed`).join('; ') || undefined,
        };
      }
      if (orchestratorEvents.some(event => event.type === 'node_failed')) {
        break;
      }
      await sleep(1_000);
    }

    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    const failedEvent = orchestratorEvents.find(event => event.type === 'node_failed');
    return {
      cli: cliLabel,
      cliSequence,
      phase,
      taskType,
      missionId: mission.missionId,
      status: terminalStatus ?? (failedEvent ? 'failed' : 'timeout'),
      durationMs: Date.now() - startedAt,
      nodeIds: mission.nodes.map(node => node.id),
      terminalIds: mission.nodes.map(node => node.terminal.terminalId),
      sessionEvents,
      orchestratorEvents,
      terminalTails,
      error: typeof failedEvent?.error === 'string' ? failedEvent.error : undefined,
    };
  } catch (error) {
    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    return {
      cli: cliLabel,
      cliSequence,
      phase,
      taskType,
      missionId: mission.missionId,
      status: Object.values(terminalTails).some(isRateLimitText) ? 'rate_limited' : 'failed',
      durationMs: Date.now() - startedAt,
      nodeIds: mission.nodes.map(node => node.id),
      terminalIds: mission.nodes.map(node => node.terminal.terminalId),
      sessionEvents,
      orchestratorEvents,
      terminalTails,
      error: error instanceof Error ? error.message : String(error),
    };
  } finally {
    runtimeUnsub();
    orchestratorSub.unsubscribe();
    await cleanupMission(mission.nodes.map(node => node.terminal.terminalId));
  }
}

export async function runLiveWorkflowHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    options: {
      clis: options.clis,
      phases: options.phases,
      cliSequences: options.cliSequences,
      taskTypes: options.taskTypes,
      workflowTimeoutMs: options.workflowTimeoutMs,
    },
    results: [] as LiveWorkflowResult[],
  };

  await writeReport(options.outputPath, report);
  const plan =
    options.cliSequences.length > 0
      ? options.cliSequences
          .map(sequence => ({ sequence, phase: phaseFromSequence(sequence) }))
          .filter((item): item is { sequence: WorkflowAgentCli[]; phase: LiveWorkflowPhase } => item.phase !== null)
      : options.phases.flatMap(phase =>
          options.clis.map(cli => ({
            sequence: Array.from({ length: phase === 'single' ? 1 : phase === 'double' ? 2 : 3 }, () => cli),
            phase,
          })),
        );

  for (const taskType of options.taskTypes) {
    for (const { sequence, phase } of plan) {
      const result = await runOneWorkflow(sequence, phase, taskType, options);
      report.results.push(result);
      await writeReport(options.outputPath, report);
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

export function liveWorkflowHarnessOptionsFromEnv(): LiveWorkflowHarnessOptions {
  const env = import.meta.env;
  const repoRoot = env.VITE_LIVE_WORKFLOW_REPO_ROOT || 'C:\\VSCODE\\terminal-docks';
  return {
    repoRoot,
    outputPath: env.VITE_LIVE_WORKFLOW_REPORT || `${repoRoot}\\.tmp-tests\\live-workflow-report.json`,
    clis: parseCsv(env.VITE_LIVE_WORKFLOW_CLIS, VALID_CLIS, VALID_CLIS),
    phases: parseCsv(env.VITE_LIVE_WORKFLOW_PHASES, VALID_PHASES, VALID_PHASES),
    cliSequences: parseCliSequences(env.VITE_LIVE_WORKFLOW_COMBOS),
    taskTypes: parseCsv(env.VITE_LIVE_WORKFLOW_TASKS, VALID_TASK_TYPES, ['handshake']),
    workflowTimeoutMs: Math.max(30_000, Number(env.VITE_LIVE_WORKFLOW_TIMEOUT_MS || 180_000)),
    closeWhenDone: env.VITE_LIVE_WORKFLOW_CLOSE !== '0',
  };
}
