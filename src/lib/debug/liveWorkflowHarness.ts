import { invoke } from '@tauri-apps/api/core';
import { Window } from '@tauri-apps/api/window';
import type { CompiledMission, WorkflowAgentCli } from '../../store/workspace.js';
import { missionOrchestrator } from '../workflow/MissionOrchestrator.js';
import { workflowOrchestrator } from '../workflow/WorkflowOrchestrator.js';
import { runtimeManager } from '../runtime/RuntimeManager.js';
import { destroyTerminal, getRecentTerminalOutput } from '../runtime/TerminalRuntime.js';

type LiveWorkflowPhase = 'single' | 'double' | 'triple';
type LiveWorkflowStatus = 'passed' | 'failed' | 'timeout' | 'rate_limited' | 'blocked';
type LiveWorkflowTaskType =
  | 'handshake'
  | 'metadata'
  | 'handoff'
  | 'landing'
  | 'blackhole_dx11'
  | 'python_cli'
  | 'data_viz';

interface LiveWorkflowHarnessOptions {
  repoRoot: string;
  outputPath: string;
  clis: WorkflowAgentCli[];
  phases: LiveWorkflowPhase[];
  cliSequences: WorkflowAgentCli[][];
  roleSequences: string[][];
  taskTypes: LiveWorkflowTaskType[];
  workflowTimeoutMs: number;
  closeWhenDone: boolean;
}

interface LiveWorkflowResult {
  cli: string;
  cliSequence: WorkflowAgentCli[];
  roleSequence: string[];
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
  outputDir: string;
  expectedFiles: string[];
  existingFiles: string[];
  missingFiles: string[];
  filePreviews: Record<string, string>;
  error?: string;
}

const VALID_CLIS: WorkflowAgentCli[] = ['claude', 'codex', 'gemini', 'opencode'];
const VALID_PHASES: LiveWorkflowPhase[] = ['single', 'double', 'triple'];
const VALID_TASK_TYPES: LiveWorkflowTaskType[] = [
  'handshake',
  'metadata',
  'handoff',
  'landing',
  'blackhole_dx11',
  'python_cli',
  'data_viz',
];
const VALID_ROLE_IDS = ['scout', 'coordinator', 'builder', 'tester', 'security', 'reviewer', 'debug-agent', 'debug-output'];

const WINDOWS_PATH_SEP_RE = /[\\\/]+/g;

interface LiveWorkflowTaskSpec {
  objective: string;
  expectedFiles: string[];
  acceptance: string[];
}

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

function parseRoleSequences(value: string | undefined): string[][] {
  if (!value?.trim()) return [];
  return value
    .split(';')
    .map(sequence =>
      sequence
        .split(/[+,>]/)
        .map(item => item.trim().toLowerCase())
        .filter(Boolean),
    )
    .filter(sequence => sequence.length > 0 && sequence.length <= 3 && sequence.every(role => VALID_ROLE_IDS.includes(role)));
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

function joinWindowsPath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('\\')
    .replace(WINDOWS_PATH_SEP_RE, '\\');
}

function fileNameForTask(taskType: LiveWorkflowTaskType): string {
  return taskType.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase();
}

function isFileProducingTask(taskType: LiveWorkflowTaskType): boolean {
  return !['handshake', 'metadata', 'handoff'].includes(taskType);
}

function getTaskSpec(taskType: LiveWorkflowTaskType): LiveWorkflowTaskSpec {
  switch (taskType) {
    case 'landing':
      return {
        objective: 'Create a polished web landing page using HTML, JavaScript, and Tailwind CSS.',
        expectedFiles: ['index.html', 'script.js', 'README.md'],
        acceptance: [
          'index.html must load Tailwind from a CDN or include Tailwind-compatible utility classes.',
          'script.js must add at least one small interactive behavior.',
          'README.md must describe how to open the page locally.',
        ],
      };
    case 'blackhole_dx11':
      return {
        objective: 'Create a Python coded program for a rendered black hole using DX11-style rendering concepts.',
        expectedFiles: ['blackhole_dx11.py', 'requirements.txt', 'README.md'],
        acceptance: [
          'blackhole_dx11.py must contain a runnable Python program or clearly isolated DX11/Windows-specific entry point.',
          'The rendering should model accretion disk, lensing, glow, and camera controls or animation.',
          'README.md must explain Windows/DX11 assumptions and any fallback behavior.',
        ],
      };
    case 'python_cli':
      return {
        objective: 'Create a small Python command-line program for tracking project tasks.',
        expectedFiles: ['task_cli.py', 'test_task_cli.py', 'README.md'],
        acceptance: [
          'task_cli.py must support add/list/done commands using only the standard library.',
          'test_task_cli.py must include basic tests or executable assertions.',
          'README.md must show example commands.',
        ],
      };
    case 'data_viz':
      return {
        objective: 'Create a browser-based data visualization dashboard with static sample data.',
        expectedFiles: ['index.html', 'app.js', 'data.json', 'README.md'],
        acceptance: [
          'index.html and app.js must render charts or metric visuals from data.json.',
          'The UI should be usable by opening index.html locally.',
          'README.md must describe the dashboard contents.',
        ],
      };
    default:
      return {
        objective: 'Verify Terminal Docks workflow lifecycle without touching user missions.',
        expectedFiles: [],
        acceptance: ['Complete the MCP handshake and report success.'],
      };
  }
}

function compactEvent(event: Record<string, unknown>): Record<string, unknown> {
  const next = { ...event };
  if (typeof next.text === 'string') {
    next.text = truncateText(next.text);
  }
  return next;
}

function buildTaskPrompt(
  cliSequence: WorkflowAgentCli[],
  phase: LiveWorkflowPhase,
  taskType: LiveWorkflowTaskType,
  workspaceDir: string,
): string {
  const sequenceLabel = cliSequence.join('>');
  const spec = getTaskSpec(taskType);
  if (isFileProducingTask(taskType)) {
    return [
      `LIVE_WORKFLOW_TEST clis=${sequenceLabel} phase=${phase} task=${taskType}.`,
      `Workspace directory: ${workspaceDir}.`,
      spec.objective,
      `Create or update only files inside ${workspaceDir}.`,
      `Expected files: ${spec.expectedFiles.join(', ')}.`,
      `Acceptance criteria: ${spec.acceptance.join(' ')}`,
      'Use shell/file tools as needed. Keep the implementation compact but real.',
      'First call get_task_details with this missionId and your nodeId.',
      'Before completing, verify the expected files exist.',
      'Then call complete_task with outcome "success", include filesChanged, and summarize what was produced.',
      'If you receive upstream context, inspect it before continuing.',
      'If a provider or tool blocks the request, report the provider/tool message in the terminal output.',
    ].join(' ');
  }
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
  roleSequence: string[],
  phase: LiveWorkflowPhase,
  taskType: LiveWorkflowTaskType,
  workspaceDir: string,
  suffixOverride?: string,
): CompiledMission {
  const sequenceLabel = cliSequence.join('-');
  const suffix = suffixOverride ?? `${sequenceLabel}-${phase}-${taskType}-${Date.now().toString(36)}`;
  const missionId = `live-workflow-${suffix}`;
  const graphId = `live-graph-${suffix}`;
  const nodeCount = cliSequence.length;
  const nodeIds = Array.from({ length: nodeCount }, (_, index) =>
    index === nodeCount - 1 && nodeCount > 1 ? 'live-output-agent' : `live-agent-${String.fromCharCode(97 + index)}`,
  );
  const terminalIds = nodeIds.map((_, index) => `live-term-${suffix}-${index + 1}`);
  const prompt = buildTaskPrompt(cliSequence, phase, taskType, workspaceDir);
  const spec = getTaskSpec(taskType);

  return {
    missionId,
    graphId,
    task: {
      nodeId: 'live-task',
      prompt,
      mode: 'build',
      workspaceDir,
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
      roleId: roleSequence[index] ?? (index === nodeIds.length - 1 && nodeIds.length > 1 ? 'debug-output' : 'debug-agent'),
      instructionOverride: [
        'You are executing an automated live Terminal Docks workflow test.',
        `Your test role is ${roleSequence[index] ?? 'debug-agent'}.`,
        isFileProducingTask(taskType)
          ? [
              `Work only inside ${workspaceDir}.`,
              `Objective: ${spec.objective}`,
              `Expected files for this run: ${spec.expectedFiles.join(', ')}.`,
              index === 0
                ? 'Create the initial implementation and complete when the expected files exist.'
                : 'Inspect upstream context and improve or validate the existing output without deleting earlier files.',
              'Use complete_task with outcome success only after file verification.',
            ].join(' ')
          : 'Do not make code changes. A successful result is only: get_task_details, then complete_task with outcome success.',
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

async function ensureWorkflowDirectory(parentDir: string, name: string): Promise<string> {
  const outputDir = joinWindowsPath(parentDir, name);
  await invoke('workspace_create_dir', { parentPath: parentDir, name }).catch(error => {
    if (!String(error).toLowerCase().includes('already exists')) throw error;
  });
  return outputDir;
}

async function validateOutputFiles(outputDir: string, expectedFiles: string[]) {
  const filePreviews: Record<string, string> = {};
  const existingFiles: string[] = [];
  const missingFiles: string[] = [];

  for (const file of expectedFiles) {
    const path = joinWindowsPath(outputDir, file);
    try {
      const content = await invoke<string>('workspace_read_text_file', { path });
      existingFiles.push(file);
      filePreviews[file] = truncateText(content, 800);
    } catch {
      missingFiles.push(file);
    }
  }

  return { existingFiles, missingFiles, filePreviews };
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
  roleSequence: string[],
  phase: LiveWorkflowPhase,
  taskType: LiveWorkflowTaskType,
  options: LiveWorkflowHarnessOptions,
): Promise<LiveWorkflowResult> {
  const startedAt = Date.now();
  const sequenceLabel = cliSequence.join('-');
  const uniqueSuffix = Date.now().toString(36);
  const missionSuffix = `${sequenceLabel}-${phase}-${taskType}-${uniqueSuffix}`;
  const missionDirName = `workflow-${fileNameForTask(taskType)}-${sequenceLabel}-${phase}-${uniqueSuffix}`;
  const outputDir = await ensureWorkflowDirectory(options.repoRoot, missionDirName);
  const expectedFiles = getTaskSpec(taskType).expectedFiles;
  const mission = buildMission(cliSequence, roleSequence, phase, taskType, outputDir, missionSuffix);
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

    const deadline = Date.now() + options.workflowTimeoutMs * Math.max(1, cliSequence.length);
    while (Date.now() < deadline) {
      const run = workflowOrchestrator.getRun(mission.missionId);
      terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
      if (Object.values(terminalTails).some(isRateLimitText)) {
        terminalStatus = 'rate_limited';
        break;
      }
      if (run?.status === 'completed') {
        const failures = Object.values(run.nodeStates).filter(node => node.state === 'failed');
        const validation = await validateOutputFiles(outputDir, expectedFiles);
        const outputMissing = validation.missingFiles.length > 0;
        return {
          cli: cliLabel,
          cliSequence,
          roleSequence,
          phase,
          taskType,
          missionId: mission.missionId,
          status: failures.length || outputMissing ? 'failed' : 'passed',
          outcome: failures.length || outputMissing ? 'failure' : 'success',
          durationMs: Date.now() - startedAt,
          nodeIds: mission.nodes.map(node => node.id),
          terminalIds: mission.nodes.map(node => node.terminal.terminalId),
          sessionEvents,
          orchestratorEvents,
          terminalTails,
          outputDir,
          expectedFiles,
          existingFiles: validation.existingFiles,
          missingFiles: validation.missingFiles,
          filePreviews: validation.filePreviews,
          error: failures.map(node => `${node.nodeId}: failed`).join('; ') || (outputMissing ? `Missing files: ${validation.missingFiles.join(', ')}` : undefined),
        };
      }
      if (orchestratorEvents.some(event => event.type === 'node_failed')) {
        break;
      }
      await sleep(1_000);
    }

    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    const validation = await validateOutputFiles(outputDir, expectedFiles);
    const failedEvent = orchestratorEvents.find(event => event.type === 'node_failed');
    return {
      cli: cliLabel,
      cliSequence,
      roleSequence,
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
      outputDir,
      expectedFiles,
      existingFiles: validation.existingFiles,
      missingFiles: validation.missingFiles,
      filePreviews: validation.filePreviews,
      error: typeof failedEvent?.error === 'string' ? failedEvent.error : undefined,
    };
  } catch (error) {
    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    const validation = await validateOutputFiles(outputDir, expectedFiles);
    return {
      cli: cliLabel,
      cliSequence,
      roleSequence,
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
      outputDir,
      expectedFiles,
      existingFiles: validation.existingFiles,
      missingFiles: validation.missingFiles,
      filePreviews: validation.filePreviews,
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
      roleSequences: options.roleSequences,
      taskTypes: options.taskTypes,
      workflowTimeoutMs: options.workflowTimeoutMs,
    },
    results: [] as LiveWorkflowResult[],
  };

  await writeReport(options.outputPath, report);
  const cliPlan =
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
  const defaultRoleSequenceForPhase = (phase: LiveWorkflowPhase): string[] =>
    phase === 'single' ? ['builder'] : phase === 'double' ? ['builder', 'reviewer'] : ['scout', 'builder', 'reviewer'];
  const plan = cliPlan.flatMap(item => {
    const matchingRoleSequences = options.roleSequences.filter(sequence => sequence.length === item.sequence.length);
    const roleSequences = matchingRoleSequences.length ? matchingRoleSequences : [defaultRoleSequenceForPhase(item.phase)];
    return roleSequences.map(roleSequence => ({ ...item, roleSequence }));
  });

  for (const taskType of options.taskTypes) {
    for (const { sequence, roleSequence, phase } of plan) {
      const result = await runOneWorkflow(sequence, roleSequence, phase, taskType, options);
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
    roleSequences: parseRoleSequences(env.VITE_LIVE_WORKFLOW_ROLE_COMBOS),
    taskTypes: parseCsv(env.VITE_LIVE_WORKFLOW_TASKS, VALID_TASK_TYPES, ['handshake']),
    workflowTimeoutMs: Math.max(30_000, Number(env.VITE_LIVE_WORKFLOW_TIMEOUT_MS || 180_000)),
    closeWhenDone: env.VITE_LIVE_WORKFLOW_CLOSE !== '0',
  };
}
