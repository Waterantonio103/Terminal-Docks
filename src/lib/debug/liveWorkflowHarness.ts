import { invoke } from '@tauri-apps/api/core';
import { Window } from '@tauri-apps/api/window';
import type { CompiledMission, WorkflowAgentCli } from '../../store/workspace.js';
import { missionOrchestrator } from '../workflow/MissionOrchestrator.js';
import { workflowOrchestrator } from '../workflow/WorkflowOrchestrator.js';
import { runtimeManager } from '../runtime/RuntimeManager.js';
import { checkMcpHealthDetailed, destroyTerminal, getRecentTerminalOutput, isTerminalActive } from '../runtime/TerminalRuntime.js';

type LiveWorkflowPhase = 'single' | 'double' | 'triple' | 'large';
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
  suiteName?: string | null;
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
  failureCategory?: string;
  nodeFinalStates?: Array<{
    nodeId: string;
    state: string;
    attempt: number;
    durationMs?: number;
    error?: string;
  }>;
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
const LIVE_WORKFLOW_MODEL = import.meta.env.VITE_LIVE_WORKFLOW_MODEL || undefined;
const LIVE_WORKFLOW_FILTER = import.meta.env.VITE_LIVE_WORKFLOW_FILTER || undefined;

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
  if (sequence.length >= 7 && sequence.length <= 12) return 'large';
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
        model: LIVE_WORKFLOW_MODEL,
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

function classifyFailureCategory(
  error: string | undefined,
  sessionEvents: Array<Record<string, unknown>>,
  terminalTails: Record<string, string>,
): string | undefined {
  const combined = [
    error ?? '',
    ...sessionEvents.map(event => String(event.error ?? event.type ?? '')),
    ...Object.values(terminalTails),
  ].join('\n').toLowerCase();

  if (!combined.trim()) return undefined;
  if (combined.includes('rate limit') || combined.includes('rate_limit') || combined.includes('429')) return 'rate_limited';
  if (combined.includes('mcp_health_timeout')) return 'mcp_health_timeout';
  if (combined.includes('mcp_health_unavailable')) return 'mcp_health_unavailable';
  if (combined.includes('mcp_registration_timeout')) return 'mcp_registration_timeout';
  if (combined.includes('mcp_registration_failed')) return 'mcp_registration_failed';
  if (combined.includes('missing_mcp_completion')) return 'missing_mcp_completion';
  if (combined.includes('pty_exited_without_completion')) return 'pty_exited_without_completion';
  if (combined.includes('did not call get_task_details') || combined.includes('did not fetch the current task')) return 'task_ack_timeout';
  return undefined;
}

function buildNodeFinalStates(missionId: string) {
  const run = workflowOrchestrator.getRun(missionId);
  if (!run) return [];
  return Object.values(run.nodeStates).map(node => {
    const latestAttempt = node.attempts[node.attempts.length - 1];
    const startedAt = latestAttempt?.startedAt ?? node.activatedAt;
    const completedAt = latestAttempt?.completedAt ?? node.completedAt;
    const endedAt = completedAt ?? Date.now();
    return {
      nodeId: node.nodeId,
      state: node.state,
      attempt: node.attempt,
      durationMs: startedAt ? Math.max(0, endedAt - startedAt) : undefined,
      error: latestAttempt?.error,
    };
  });
}

async function cleanupMission(missionId: string, terminalIds: string[]): Promise<string[]> {
  const cleanupErrors: string[] = [];
  const run = workflowOrchestrator.getRun(missionId);
  if (run && run.status !== 'completed' && run.status !== 'failed' && run.status !== 'cancelled') {
    workflowOrchestrator.cancelRun(missionId);
  }

  const sessions = runtimeManager.getAllSessions();
  for (const session of sessions) {
    if (!terminalIds.includes(session.terminalId)) continue;
    const stopped = await withTimeout(
      runtimeManager.stopRuntime({ sessionId: session.sessionId, reason: 'live workflow harness cleanup' }).catch(() => {}),
      5_000,
      undefined,
    );
    void stopped;
  }
  for (const terminalId of terminalIds) {
    await withTimeout(destroyTerminal(terminalId).catch(() => {}), 2_500, undefined);
    const stillActive = await withTimeout(isTerminalActive(terminalId).catch(() => false), 1_000, false);
    if (stillActive) cleanupErrors.push(`Terminal ${terminalId} remained active after cleanup.`);
  }
  const remaining = runtimeManager.getAllSessions().filter(session => terminalIds.includes(session.terminalId));
  for (const session of remaining) {
    cleanupErrors.push(`Runtime session ${session.sessionId} remained in state ${session.state} after cleanup.`);
  }
  return cleanupErrors;
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
        const error = failures.map(node => `${node.nodeId}: failed`).join('; ') || (outputMissing ? `Missing files: ${validation.missingFiles.join(', ')}` : undefined);
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
          failureCategory: classifyFailureCategory(error, sessionEvents, terminalTails),
          nodeFinalStates: buildNodeFinalStates(mission.missionId),
          error,
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
    const error = typeof failedEvent?.error === 'string' ? failedEvent.error : undefined;
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
      failureCategory: classifyFailureCategory(error, sessionEvents, terminalTails),
      nodeFinalStates: buildNodeFinalStates(mission.missionId),
      error,
    };
  } catch (error) {
    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    const validation = await validateOutputFiles(outputDir, expectedFiles);
    const message = error instanceof Error ? error.message : String(error);
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
      failureCategory: classifyFailureCategory(message, sessionEvents, terminalTails),
      nodeFinalStates: buildNodeFinalStates(mission.missionId),
      error: message,
    };
  } finally {
    runtimeUnsub();
    orchestratorSub.unsubscribe();
    const cleanupErrors = await cleanupMission(mission.missionId, mission.nodes.map(node => node.terminal.terminalId));
    if (cleanupErrors.length) {
      sessionEvents.push({ type: 'cleanup_incomplete', errors: cleanupErrors, at: Date.now() });
    }
  }
}

interface Prompt06AgentSpec {
  id: string;
  roleId: string;
  title: string;
  responsibility: string;
}

interface Prompt06WorkflowSpec {
  name: string;
  title: string;
  task: string;
  expectedFiles: string[];
  runInstruction: string;
  agents: Prompt06AgentSpec[];
  edges: Array<{ fromNodeId: string; toNodeId: string; condition?: 'always' | 'on_success' | 'on_failure' }>;
}

const PROMPT_06_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'landing-page-7-agent',
    title: 'Seven-agent landing page workflow',
    task: 'Create a polished static landing page for a fictional launch event called Harbor Lights Summit.',
    expectedFiles: ['index.html', 'script.js', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define page sections, branch responsibilities, and final acceptance criteria.'),
      prompt06Agent('scout-copy', 'scout', 'Copy Scout', 'Draft concise event messaging and calls to action.'),
      prompt06Agent('scout-content', 'scout', 'Content Scout', 'Define agenda, speaker, and venue content.'),
      prompt06Agent('builder-structure', 'builder', 'Structure Builder', 'Create the HTML structure and responsive layout.'),
      prompt06Agent('builder-interaction', 'builder', 'Interaction Builder', 'Create script.js with a real interaction.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Verify files exist, links/scripts are wired, and README can be followed.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Perform final polish and complete only after the page can be opened locally.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-copy'),
      prompt06Edge('coordinator', 'scout-content'),
      prompt06Edge('scout-copy', 'builder-structure'),
      prompt06Edge('scout-content', 'builder-structure'),
      prompt06Edge('scout-copy', 'builder-interaction'),
      prompt06Edge('builder-structure', 'tester'),
      prompt06Edge('builder-interaction', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'python-cli-8-agent',
    title: 'Eight-agent Python CLI workflow',
    task: 'Create a standard-library Python CLI for tracking small project tasks with add/list/done commands and sample data.',
    expectedFiles: ['task_cli.py', 'sample_tasks.json', 'README.md'],
    runInstruction: 'Run python task_cli.py --help.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define the CLI command contract and split implementation tracks.'),
      prompt06Agent('scout-commands', 'scout', 'Command Scout', 'Specify add/list/done behavior and arguments.'),
      prompt06Agent('scout-data', 'scout', 'Data Scout', 'Specify JSON storage format and sample task data.'),
      prompt06Agent('builder-cli', 'builder', 'CLI Builder', 'Implement argparse command handling in task_cli.py.'),
      prompt06Agent('builder-storage', 'builder', 'Storage Builder', 'Implement JSON load/save behavior and sample data.'),
      prompt06Agent('builder-docs', 'builder', 'Docs Builder', 'Write README usage examples.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Run or reason through --help and core commands.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Confirm the CLI is runnable and complete the final handoff.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-commands'),
      prompt06Edge('coordinator', 'scout-data'),
      prompt06Edge('scout-commands', 'builder-cli'),
      prompt06Edge('scout-data', 'builder-storage'),
      prompt06Edge('scout-commands', 'builder-docs'),
      prompt06Edge('builder-cli', 'tester'),
      prompt06Edge('builder-storage', 'tester'),
      prompt06Edge('builder-docs', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'data-dashboard-10-agent',
    title: 'Ten-agent data dashboard workflow',
    task: 'Create a browser-based operations dashboard from static JSON data with filters and metric cards.',
    expectedFiles: ['index.html', 'app.js', 'data.json', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define dashboard scope, branches, and merge criteria.'),
      prompt06Agent('scout-metrics', 'scout', 'Metrics Scout', 'Define useful operational metrics.'),
      prompt06Agent('scout-data', 'scout', 'Data Scout', 'Design realistic static data rows.'),
      prompt06Agent('scout-ux', 'scout', 'UX Scout', 'Define dashboard layout and scan patterns.'),
      prompt06Agent('builder-html', 'builder', 'HTML Builder', 'Create index.html structure.'),
      prompt06Agent('builder-data', 'builder', 'Data Builder', 'Create data.json.'),
      prompt06Agent('builder-js', 'builder', 'JavaScript Builder', 'Create app.js rendering and filtering logic.'),
      prompt06Agent('tester-data', 'tester', 'Data Tester', 'Validate data shape and rendering assumptions.'),
      prompt06Agent('tester-ui', 'tester', 'UI Tester', 'Validate browser-openable behavior and README.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Integrate final dashboard output and complete after local-open instructions are clear.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-metrics'),
      prompt06Edge('coordinator', 'scout-data'),
      prompt06Edge('coordinator', 'scout-ux'),
      prompt06Edge('scout-ux', 'builder-html'),
      prompt06Edge('scout-data', 'builder-data'),
      prompt06Edge('scout-metrics', 'builder-js'),
      prompt06Edge('builder-data', 'builder-js'),
      prompt06Edge('builder-html', 'tester-ui'),
      prompt06Edge('builder-js', 'tester-ui'),
      prompt06Edge('builder-data', 'tester-data'),
      prompt06Edge('tester-data', 'reviewer'),
      prompt06Edge('tester-ui', 'reviewer'),
    ],
  },
  {
    name: 'canvas-game-12-agent',
    title: 'Twelve-agent browser game workflow',
    task: 'Create a small browser canvas game with keyboard controls, scoring, and restart behavior.',
    expectedFiles: ['index.html', 'game.js', 'README.md'],
    runInstruction: 'Open index.html in a browser and play with the keyboard.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define the game concept and branch workstreams.'),
      prompt06Agent('planner', 'planner', 'Planner', 'Create a concise implementation plan.'),
      prompt06Agent('scout-controls', 'scout', 'Controls Scout', 'Define keyboard controls and game loop expectations.'),
      prompt06Agent('scout-visuals', 'scout', 'Visual Scout', 'Define visual style and canvas layout.'),
      prompt06Agent('builder-html', 'builder', 'HTML Builder', 'Create index.html and canvas shell.'),
      prompt06Agent('builder-loop', 'builder', 'Game Loop Builder', 'Implement update/render loop in game.js.'),
      prompt06Agent('builder-controls', 'builder', 'Controls Builder', 'Implement keyboard input and restart behavior.'),
      prompt06Agent('builder-scoring', 'builder', 'Scoring Builder', 'Implement scoring, failure, and status display.'),
      prompt06Agent('tester-controls', 'tester', 'Controls Tester', 'Validate controls and restart expectations.'),
      prompt06Agent('tester-play', 'tester', 'Play Tester', 'Validate game can be opened and played locally.'),
      prompt06Agent('risk-reviewer', 'security', 'Risk Reviewer', 'Check for broken loops, runaway output, and inaccessible controls.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Finalize the game and complete after local play instructions are present.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'planner'),
      prompt06Edge('coordinator', 'scout-controls'),
      prompt06Edge('coordinator', 'scout-visuals'),
      prompt06Edge('planner', 'builder-html'),
      prompt06Edge('scout-visuals', 'builder-html'),
      prompt06Edge('planner', 'builder-loop'),
      prompt06Edge('scout-controls', 'builder-controls'),
      prompt06Edge('builder-loop', 'builder-scoring'),
      prompt06Edge('builder-controls', 'tester-controls'),
      prompt06Edge('builder-html', 'tester-play'),
      prompt06Edge('builder-loop', 'tester-play'),
      prompt06Edge('builder-scoring', 'tester-play'),
      prompt06Edge('builder-controls', 'risk-reviewer'),
      prompt06Edge('builder-loop', 'risk-reviewer'),
      prompt06Edge('tester-controls', 'reviewer'),
      prompt06Edge('tester-play', 'reviewer'),
      prompt06Edge('risk-reviewer', 'reviewer'),
    ],
  },
  {
    name: 'fan-in-product-demo-9-agent',
    title: 'Nine-agent custom fan-in product demo workflow',
    task: 'Create a compact product demo page where four branch builders produce sections that one integrator merges before review.',
    expectedFiles: ['index.html', 'app.js', 'styles.css', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define the fan-in merge contract and section ownership.'),
      prompt06Agent('builder-hero', 'builder', 'Hero Builder', 'Build the hero/product signal section.'),
      prompt06Agent('builder-features', 'builder', 'Features Builder', 'Build feature cards and supporting copy.'),
      prompt06Agent('builder-pricing', 'builder', 'Pricing Builder', 'Build a compact pricing/comparison section.'),
      prompt06Agent('builder-interaction', 'builder', 'Interaction Builder', 'Build app.js interaction and styles hook.'),
      prompt06Agent('integrator', 'builder', 'Integrator', 'Merge all branch sections into one cohesive page.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Verify all branch outputs are represented and openable.'),
      prompt06Agent('risk-reviewer', 'security', 'Risk Reviewer', 'Check for missing branch content or broken assets.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Finalize the demo and complete after verifying run instructions.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-hero'),
      prompt06Edge('coordinator', 'builder-features'),
      prompt06Edge('coordinator', 'builder-pricing'),
      prompt06Edge('coordinator', 'builder-interaction'),
      prompt06Edge('builder-hero', 'integrator'),
      prompt06Edge('builder-features', 'integrator'),
      prompt06Edge('builder-pricing', 'integrator'),
      prompt06Edge('builder-interaction', 'integrator'),
      prompt06Edge('integrator', 'tester'),
      prompt06Edge('integrator', 'risk-reviewer'),
      prompt06Edge('tester', 'reviewer'),
      prompt06Edge('risk-reviewer', 'reviewer'),
    ],
  },
];

const PROMPT_05_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'studio-launch-landing',
    title: 'Coordinator, two builders, reviewer static landing page',
    task: 'Create a compact static landing page for a fictional design studio called North Pier Studio, assembled from branch-owned content and interaction pieces.',
    expectedFiles: ['index.html', 'script.js', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define the landing page sections and branch acceptance criteria.'),
      prompt06Agent('builder-copy', 'builder', 'Copy Builder', 'Create branch copy, messaging, and README notes.'),
      prompt06Agent('builder-interaction', 'builder', 'Interaction Builder', 'Create the interactive script and wire it into the page.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Merge both branch contributions into the final openable page and verify expected files.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-copy'),
      prompt06Edge('coordinator', 'builder-interaction'),
      prompt06Edge('builder-copy', 'reviewer'),
      prompt06Edge('builder-interaction', 'reviewer'),
    ],
  },
  {
    name: 'community-event-guide',
    title: 'Coordinator, two scouts, builder, reviewer event guide',
    task: 'Create a static local event guide for a fictional neighborhood night market, using scout-owned agenda and vendor inputs.',
    expectedFiles: ['index.html', 'app.js', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Set the event guide scope and acceptance criteria.'),
      prompt06Agent('scout-agenda', 'scout', 'Agenda Scout', 'Define schedule, location, and attendee flow.'),
      prompt06Agent('scout-vendors', 'scout', 'Vendor Scout', 'Define vendor categories and highlights.'),
      prompt06Agent('builder', 'builder', 'Builder', 'Build the guide page from both scout artifacts.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Verify both scout inputs are represented in the final page.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-agenda'),
      prompt06Edge('coordinator', 'scout-vendors'),
      prompt06Edge('scout-agenda', 'builder'),
      prompt06Edge('scout-vendors', 'builder'),
      prompt06Edge('builder', 'reviewer'),
    ],
  },
  {
    name: 'task-audit-cli',
    title: 'Scout, coordinator, three builders, tester, reviewer Python CLI',
    task: 'Create a standard-library Python CLI called task_audit.py that loads a small JSON task file, prints status summaries, and flags overdue items.',
    expectedFiles: ['task_audit.py', 'sample_tasks.json', 'README.md'],
    runInstruction: 'Run python task_audit.py --help.',
    agents: [
      prompt06Agent('scout', 'scout', 'Scout', 'Define the CLI user story and sample task fields.'),
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Split command parsing, data model, and documentation responsibilities.'),
      prompt06Agent('builder-cli', 'builder', 'CLI Builder', 'Implement argparse command handling.'),
      prompt06Agent('builder-data', 'builder', 'Data Builder', 'Create sample_tasks.json and load/validation behavior.'),
      prompt06Agent('builder-docs', 'builder', 'Docs Builder', 'Write concise usage examples in README.md.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Verify the CLI entry point and expected files.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Confirm all branch work is integrated and complete.'),
    ],
    edges: [
      prompt06Edge('scout', 'coordinator'),
      prompt06Edge('coordinator', 'builder-cli'),
      prompt06Edge('coordinator', 'builder-data'),
      prompt06Edge('coordinator', 'builder-docs'),
      prompt06Edge('builder-cli', 'tester'),
      prompt06Edge('builder-data', 'tester'),
      prompt06Edge('builder-docs', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'mini-metrics-dashboard',
    title: 'Coordinator, two builders, two testers, reviewer data dashboard',
    task: 'Create a browser mini-dashboard for a fictional support queue with static data, metric cards, and a priority filter.',
    expectedFiles: ['index.html', 'app.js', 'data.json', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define dashboard metrics, branch boundaries, and merge criteria.'),
      prompt06Agent('builder-data', 'builder', 'Data Builder', 'Create realistic support queue data.json.'),
      prompt06Agent('builder-ui', 'builder', 'UI Builder', 'Create index.html and app.js rendering behavior.'),
      prompt06Agent('tester-data', 'tester', 'Data Tester', 'Validate data shape and branch artifact coverage.'),
      prompt06Agent('tester-ui', 'tester', 'UI Tester', 'Validate the page can render the metrics from data.json.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Merge tester findings and finalize the dashboard.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-data'),
      prompt06Edge('coordinator', 'builder-ui'),
      prompt06Edge('builder-data', 'tester-data'),
      prompt06Edge('builder-data', 'tester-ui'),
      prompt06Edge('builder-ui', 'tester-ui'),
      prompt06Edge('tester-data', 'reviewer'),
      prompt06Edge('tester-ui', 'reviewer'),
    ],
  },
  {
    name: 'security-checklist-app',
    title: 'Coordinator, two scouts, two builders, security, tester, reviewer checklist app',
    task: 'Create a small browser security checklist app for reviewing a launch readiness plan, with static checklist data and filter behavior.',
    expectedFiles: ['index.html', 'app.js', 'checklist.json', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define checklist scope and branch outputs.'),
      prompt06Agent('scout-risks', 'scout', 'Risk Scout', 'Define security and privacy checklist categories.'),
      prompt06Agent('scout-ux', 'scout', 'UX Scout', 'Define usable filter and status behavior.'),
      prompt06Agent('builder-data', 'builder', 'Data Builder', 'Create checklist.json from risk categories.'),
      prompt06Agent('builder-ui', 'builder', 'UI Builder', 'Create page and JavaScript filter behavior.'),
      prompt06Agent('security-reviewer', 'security', 'Security Reviewer', 'Check that risk categories are represented and no unsafe output is created.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Verify expected files and local-open instructions.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Finalize the app after consuming security and tester outputs.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-risks'),
      prompt06Edge('coordinator', 'scout-ux'),
      prompt06Edge('scout-risks', 'builder-data'),
      prompt06Edge('scout-ux', 'builder-ui'),
      prompt06Edge('builder-data', 'security-reviewer'),
      prompt06Edge('builder-ui', 'security-reviewer'),
      prompt06Edge('builder-data', 'tester'),
      prompt06Edge('builder-ui', 'tester'),
      prompt06Edge('security-reviewer', 'reviewer'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'roi-calculator-demo',
    title: 'Planner, logic and UI builders, integrator, reviewer calculator',
    task: 'Create a browser ROI calculator demo for a fictional operations tool, with simple form inputs and computed savings.',
    expectedFiles: ['index.html', 'app.js', 'README.md'],
    runInstruction: 'Open index.html in a browser and change the calculator inputs.',
    agents: [
      prompt06Agent('planner', 'planner', 'Planner', 'Define calculator inputs, formula, and branch deliverables.'),
      prompt06Agent('builder-logic', 'builder', 'Logic Builder', 'Create the calculation behavior in app.js.'),
      prompt06Agent('builder-ui', 'builder', 'UI Builder', 'Create the HTML structure and controls.'),
      prompt06Agent('integrator', 'builder', 'Integrator', 'Merge UI and logic into a cohesive demo.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Verify the integrated calculator and README.'),
    ],
    edges: [
      prompt06Edge('planner', 'builder-logic'),
      prompt06Edge('planner', 'builder-ui'),
      prompt06Edge('builder-logic', 'integrator'),
      prompt06Edge('builder-ui', 'integrator'),
      prompt06Edge('integrator', 'reviewer'),
    ],
  },
  {
    name: 'canvas-timing-demo',
    title: 'Coordinator, three builders, tester, reviewer canvas demo',
    task: 'Create a small browser canvas timing demo that animates dots across lanes and includes start/pause/reset controls.',
    expectedFiles: ['index.html', 'canvas_demo.js', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define demo behavior, controls, and branch responsibilities.'),
      prompt06Agent('builder-canvas', 'builder', 'Canvas Builder', 'Create canvas drawing and animation loop.'),
      prompt06Agent('builder-controls', 'builder', 'Controls Builder', 'Create start, pause, and reset controls.'),
      prompt06Agent('builder-copy', 'builder', 'Copy Builder', 'Create concise on-page copy and README instructions.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Verify the demo files are present and wired together.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Confirm all branches are represented in the final demo.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-canvas'),
      prompt06Edge('coordinator', 'builder-controls'),
      prompt06Edge('coordinator', 'builder-copy'),
      prompt06Edge('builder-canvas', 'tester'),
      prompt06Edge('builder-controls', 'tester'),
      prompt06Edge('builder-copy', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'bug-repro-package',
    title: 'Coordinator, repro and fixture builders, tester, reviewer bug package',
    task: 'Create a compact Python bug reproduction package for a fictional CSV parsing edge case, with a repro script, fixture, and README.',
    expectedFiles: ['repro.py', 'fixtures\\bad_rows.csv', 'README.md'],
    runInstruction: 'Run python repro.py fixtures\\bad_rows.csv.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define the repro scenario and expected behavior.'),
      prompt06Agent('builder-repro', 'builder', 'Repro Builder', 'Create repro.py with clear output.'),
      prompt06Agent('builder-fixture', 'builder', 'Fixture Builder', 'Create the CSV fixture and README context.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Run or reason through the repro command and verify files.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Confirm repro and fixture branches are both consumed.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-repro'),
      prompt06Edge('coordinator', 'builder-fixture'),
      prompt06Edge('builder-repro', 'tester'),
      prompt06Edge('builder-fixture', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'inventory-visualizer',
    title: 'Coordinator, data, rendering, interaction builders, tester, reviewer visualizer',
    task: 'Create a browser inventory visualizer for a fictional hardware lab, with static JSON data, summary rendering, and category filtering.',
    expectedFiles: ['index.html', 'app.js', 'inventory.json', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define visualizer scope and merge criteria.'),
      prompt06Agent('builder-data', 'builder', 'Data Builder', 'Create inventory.json with realistic item rows.'),
      prompt06Agent('builder-render', 'builder', 'Render Builder', 'Create page rendering and summary cards.'),
      prompt06Agent('builder-filter', 'builder', 'Filter Builder', 'Create category filtering behavior.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Verify data, rendering, and filtering are represented.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Finalize the integrated visualizer.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-data'),
      prompt06Edge('coordinator', 'builder-render'),
      prompt06Edge('coordinator', 'builder-filter'),
      prompt06Edge('builder-data', 'tester'),
      prompt06Edge('builder-render', 'tester'),
      prompt06Edge('builder-filter', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'help-center-microsite',
    title: 'Coordinator, copy and style builders, integrator, tester, reviewer microsite',
    task: 'Create a small help-center microsite for a fictional desktop app, with searchable FAQ behavior and local-open instructions.',
    expectedFiles: ['index.html', 'search.js', 'styles.css', 'README.md'],
    runInstruction: 'Open index.html in a browser and use the FAQ search input.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define FAQ categories, branch outputs, and merge criteria.'),
      prompt06Agent('builder-copy', 'builder', 'Copy Builder', 'Create FAQ content and README guidance.'),
      prompt06Agent('builder-style', 'builder', 'Style Builder', 'Create styles.css and layout polish.'),
      prompt06Agent('integrator', 'builder', 'Integrator', 'Create index.html and search.js from both branch inputs.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Verify search behavior wiring and expected files.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Finalize the integrated microsite after tester evidence.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-copy'),
      prompt06Edge('coordinator', 'builder-style'),
      prompt06Edge('builder-copy', 'integrator'),
      prompt06Edge('builder-style', 'integrator'),
      prompt06Edge('integrator', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
];

function prompt06Agent(id: string, roleId: string, title: string, responsibility: string): Prompt06AgentSpec {
  return { id, roleId, title, responsibility };
}

function prompt06Edge(fromNodeId: string, toNodeId: string, condition: 'always' | 'on_success' | 'on_failure' = 'on_success') {
  return { fromNodeId, toNodeId, condition };
}

function selectPromptWorkflows<T extends { name: string }>(workflows: T[]): Array<{ spec: T; index: number }> {
  const tokens = (LIVE_WORKFLOW_FILTER ?? '')
    .split(',')
    .map(token => token.trim().toLowerCase())
    .filter(Boolean);
  if (tokens.length === 0) {
    return workflows.map((spec, index) => ({ spec, index }));
  }

  return workflows
    .map((spec, index) => ({ spec, index }))
    .filter(({ spec, index }) => {
      const oneBased = String(index + 1);
      const padded = oneBased.padStart(2, '0');
      const candidates = [
        spec.name.toLowerCase(),
        oneBased,
        padded,
        `workflow-${padded}`,
      ];
      return tokens.some(token => candidates.includes(token));
    });
}

function inferPrompt06Layers(agents: Prompt06AgentSpec[], edges: Prompt06WorkflowSpec['edges']): string[][] {
  const ids = agents.map(agent => agent.id);
  const remaining = new Set(ids);
  const completed = new Set<string>();
  const layers: string[][] = [];

  while (remaining.size > 0) {
    const layer = [...remaining].filter(id =>
      edges.filter(edge => edge.toNodeId === id).every(edge => completed.has(edge.fromNodeId)),
    );
    if (layer.length === 0) throw new Error(`Invalid Prompt 06 workflow graph: ${ids.join(', ')}`);
    layers.push(layer);
    for (const id of layer) {
      remaining.delete(id);
      completed.add(id);
    }
  }

  return layers;
}

function buildPrompt06Mission(
  spec: Prompt06WorkflowSpec,
  outputDir: string,
  suffix: string,
  promptNumber = '06',
  suiteSlug = 'prompt06',
): CompiledMission {
  const layers = inferPrompt06Layers(spec.agents, spec.edges);
  const branchMergeInstructions = promptNumber === '05'
    ? [
        'Prompt 05 branch/merge requirements: every branch producer must create a distinct artifact under branch-artifacts named for its node, and merge/review agents must inspect all upstream branch artifacts before completing.',
        'The final README must summarize which branch contributions were consumed.',
        'No branch output should overwrite another branch output.',
        'Keep branch artifacts concise and finish the MCP handoff/completion immediately after the required file and branch checks pass.',
      ]
    : [];
  const prompt = [
    `LIVE_PROMPT_${promptNumber} workflow=${spec.name}.`,
    `Workspace/output directory: ${outputDir}.`,
    spec.task,
    `Create or update only files inside ${outputDir}.`,
    `Expected concrete project files: ${spec.expectedFiles.join(', ')}.`,
    `Runnable verification: ${spec.runInstruction}`,
    ...branchMergeInstructions,
    'This must be a real runnable/openable project, not markdown-only evidence.',
    'Keep the project compact and bounded: no large embedded assets, no long generated data dumps, and target small text/source files.',
    'Do not create screenshots, preview images, generated media, or dev-server evidence unless this node is explicitly the tester and the project cannot be verified from files alone.',
    'This is a reliability test, so finish the assigned role promptly and do not continue polishing after the expected files exist.',
    'Each agent must call get_task_details, inspect upstream context if present, perform its role, then complete the node with complete_task or handoff_task.',
    'Do not stop after a normal final answer; the workflow only progresses after the MCP completion or handoff tool succeeds.',
    'The final reviewer must ensure expected files exist, README contains the run/open instruction, and the output is ready for a user to open or run locally.',
    'Tester and reviewer nodes should not do extended polish once those checks pass; complete the MCP node promptly.',
  ].join(' ');

  return {
    missionId: `live-${suiteSlug}-${suffix}`,
    graphId: `live-${suiteSlug}-graph-${suffix}`,
    task: {
      nodeId: `live-${suiteSlug}-task`,
      prompt,
      mode: 'build',
      workspaceDir: outputDir,
    },
    metadata: {
      compiledAt: Date.now(),
      sourceGraphId: `live-${suiteSlug}-graph-${suffix}`,
      startNodeIds: layers[0],
      executionLayers: layers,
      authoringMode: 'graph',
      presetId: `live:${suiteSlug}:${spec.name}`,
      runVersion: 1,
    },
    nodes: spec.agents.map((agent, index) => ({
      id: agent.id,
      roleId: agent.roleId,
      instructionOverride: [
        `You are a live Terminal Docks Prompt ${promptNumber} Codex workflow agent.`,
        `Role: ${agent.title}.`,
        `Responsibility: ${agent.responsibility}`,
        `Output directory: ${outputDir}.`,
        `Expected files for the overall workflow: ${spec.expectedFiles.join(', ')}.`,
        'Do not write outside the output directory.',
        promptNumber === '05'
          ? `If you are producing branch work, write a distinct artifact under branch-artifacts/${agent.id}.md or a similarly named source fragment. If you are merging, testing, or reviewing, inspect upstream context and branch-artifacts before completing.`
          : '',
        'Keep your contribution compact and finish quickly once your role is satisfied.',
        'Avoid screenshots, preview images, browser automation, and extra generated assets unless your named responsibility is testing and file checks are insufficient.',
        'Complete your node with complete_task or handoff_task after your contribution or verification is done.',
        'Do not end with only a normal final answer; a successful MCP completion/handoff tool call is required.',
      ].join(' '),
      terminal: {
        terminalId: `live-${suiteSlug}-${suffix}-${index + 1}-${agent.id}`,
        terminalTitle: `${agent.title} (${spec.name})`,
        cli: 'codex',
        model: LIVE_WORKFLOW_MODEL,
        yolo: true,
        executionMode: 'interactive_pty',
        paneId: `pane-live-${suiteSlug}-${suffix}-${index + 1}`,
        reusedExisting: false,
      },
    })),
    edges: spec.edges.map((edge, index) => ({
      id: `edge:${edge.fromNodeId}:${edge.condition ?? 'on_success'}:${edge.toNodeId}:${index}`,
      fromNodeId: edge.fromNodeId,
      toNodeId: edge.toNodeId,
      condition: edge.condition ?? 'on_success',
    })),
  };
}

async function waitForPrompt06McpHealth(label = 'Prompt 06'): Promise<void> {
  for (let attempt = 1; attempt <= 6; attempt += 1) {
    const health = await checkMcpHealthDetailed({ timeoutMs: 10_000 });
    if (health.ok) return;
    console.warn(`[liveWorkflowHarness] MCP health not ready between ${label} workflows; retry ${attempt}/6`, health);
    await sleep(2_000);
  }
}

async function ensureNestedDirectory(path: string): Promise<string> {
  const normalized = path.replace(WINDOWS_PATH_SEP_RE, '\\');
  const parts = normalized.split('\\');
  if (parts.length <= 1) return normalized;
  let current = parts[0].endsWith(':') ? `${parts[0]}\\` : parts[0];
  for (let index = current.endsWith('\\') ? 1 : 1; index < parts.length; index += 1) {
    const name = parts[index];
    if (!name) continue;
    const parent = current;
    current = joinWindowsPath(current, name);
    await invoke('workspace_create_dir', { parentPath: parent, name }).catch(error => {
      if (!String(error).toLowerCase().includes('already exists')) throw error;
    });
  }
  return normalized;
}

async function runPrompt06Workflow(
  spec: Prompt06WorkflowSpec,
  index: number,
  options: LiveWorkflowHarnessOptions,
  suiteDirName = 'live-prompt-06',
  promptNumber = '06',
  suiteSlug = 'prompt06',
): Promise<LiveWorkflowResult> {
  const startedAt = Date.now();
  const suffix = `${index + 1}-${spec.name}-${Date.now().toString(36)}`;
  const suiteDir = joinWindowsPath(options.repoRoot, 'docks-testing', suiteDirName);
  await ensureNestedDirectory(suiteDir);
  const outputDir = await ensureWorkflowDirectory(suiteDir, `workflow-${String(index + 1).padStart(2, '0')}-${spec.name}-${suffix}`);
  const mission = buildPrompt06Mission(spec, outputDir, suffix, promptNumber, suiteSlug);
  const sessionEvents: Array<Record<string, unknown>> = [];
  const orchestratorEvents: Array<Record<string, unknown>> = [];
  const sessionIds = new Set<string>();
  let terminalTails: Record<string, string> = {};

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

    const deadline = Date.now() + options.workflowTimeoutMs * Math.max(1, Math.ceil(mission.nodes.length / 3));
    while (Date.now() < deadline) {
      const run = workflowOrchestrator.getRun(mission.missionId);
      terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
      if (Object.values(terminalTails).some(isRateLimitText)) {
        const validation = await validateOutputFiles(outputDir, spec.expectedFiles);
        const error = 'Provider rate limit detected in terminal output.';
        return {
          cli: 'codex',
          cliSequence: mission.nodes.map(() => 'codex' as WorkflowAgentCli),
          roleSequence: mission.nodes.map(node => node.roleId),
          phase: 'large',
          taskType: 'handoff',
          missionId: mission.missionId,
          status: 'rate_limited',
          durationMs: Date.now() - startedAt,
          nodeIds: mission.nodes.map(node => node.id),
          terminalIds: mission.nodes.map(node => node.terminal.terminalId),
          sessionEvents,
          orchestratorEvents,
          terminalTails,
          outputDir,
          expectedFiles: spec.expectedFiles,
          existingFiles: validation.existingFiles,
          missingFiles: validation.missingFiles,
          filePreviews: validation.filePreviews,
          failureCategory: classifyFailureCategory(error, sessionEvents, terminalTails),
          nodeFinalStates: buildNodeFinalStates(mission.missionId),
          error,
        };
      }
      if (run?.status === 'completed') {
        const validation = await validateOutputFiles(outputDir, spec.expectedFiles);
        const failures = Object.values(run.nodeStates).filter(node => node.state === 'failed');
        const error = failures.map(node => `${node.nodeId}: failed`).join('; ') || (validation.missingFiles.length ? `Missing files: ${validation.missingFiles.join(', ')}` : undefined);
        return {
          cli: 'codex',
          cliSequence: mission.nodes.map(() => 'codex' as WorkflowAgentCli),
          roleSequence: mission.nodes.map(node => node.roleId),
          phase: 'large',
          taskType: 'handoff',
          missionId: mission.missionId,
          status: failures.length || validation.missingFiles.length ? 'failed' : 'passed',
          outcome: failures.length || validation.missingFiles.length ? 'failure' : 'success',
          durationMs: Date.now() - startedAt,
          nodeIds: mission.nodes.map(node => node.id),
          terminalIds: mission.nodes.map(node => node.terminal.terminalId),
          sessionEvents,
          orchestratorEvents,
          terminalTails,
          outputDir,
          expectedFiles: spec.expectedFiles,
          existingFiles: validation.existingFiles,
          missingFiles: validation.missingFiles,
          filePreviews: validation.filePreviews,
          failureCategory: classifyFailureCategory(error, sessionEvents, terminalTails),
          nodeFinalStates: buildNodeFinalStates(mission.missionId),
          error,
        };
      }
      if (orchestratorEvents.some(event => event.type === 'node_failed')) break;
      await sleep(1_000);
    }

    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    const validation = await validateOutputFiles(outputDir, spec.expectedFiles);
    const failedEvent = orchestratorEvents.find(event => event.type === 'node_failed');
    const error = typeof failedEvent?.error === 'string' ? failedEvent.error : undefined;
    return {
      cli: 'codex',
      cliSequence: mission.nodes.map(() => 'codex' as WorkflowAgentCli),
      roleSequence: mission.nodes.map(node => node.roleId),
      phase: 'large',
      taskType: 'handoff',
      missionId: mission.missionId,
      status: failedEvent ? 'failed' : 'timeout',
      durationMs: Date.now() - startedAt,
      nodeIds: mission.nodes.map(node => node.id),
      terminalIds: mission.nodes.map(node => node.terminal.terminalId),
      sessionEvents,
      orchestratorEvents,
      terminalTails,
      outputDir,
      expectedFiles: spec.expectedFiles,
      existingFiles: validation.existingFiles,
      missingFiles: validation.missingFiles,
      filePreviews: validation.filePreviews,
      failureCategory: classifyFailureCategory(error, sessionEvents, terminalTails),
      nodeFinalStates: buildNodeFinalStates(mission.missionId),
      error,
    };
  } catch (error) {
    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    const validation = await validateOutputFiles(outputDir, spec.expectedFiles);
    const message = error instanceof Error ? error.message : String(error);
    return {
      cli: 'codex',
      cliSequence: mission.nodes.map(() => 'codex' as WorkflowAgentCli),
      roleSequence: mission.nodes.map(node => node.roleId),
      phase: 'large',
      taskType: 'handoff',
      missionId: mission.missionId,
      status: Object.values(terminalTails).some(isRateLimitText) ? 'rate_limited' : 'failed',
      durationMs: Date.now() - startedAt,
      nodeIds: mission.nodes.map(node => node.id),
      terminalIds: mission.nodes.map(node => node.terminal.terminalId),
      sessionEvents,
      orchestratorEvents,
      terminalTails,
      outputDir,
      expectedFiles: spec.expectedFiles,
      existingFiles: validation.existingFiles,
      missingFiles: validation.missingFiles,
      filePreviews: validation.filePreviews,
      failureCategory: classifyFailureCategory(message, sessionEvents, terminalTails),
      nodeFinalStates: buildNodeFinalStates(mission.missionId),
      error: message,
    };
  } finally {
    runtimeUnsub();
    orchestratorSub.unsubscribe();
    const cleanupErrors = await cleanupMission(mission.missionId, mission.nodes.map(node => node.terminal.terminalId));
    if (cleanupErrors.length) {
      sessionEvents.push({ type: 'cleanup_incomplete', errors: cleanupErrors, at: Date.now() });
    }
  }
}

async function runPrompt06LargeWorkflowHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'prompt06_large_workflows',
    executionPath: 'live_app_harness',
    liveRuntimeLaunched: true,
    note: 'Runs through the app-side MissionOrchestrator / WorkflowOrchestrator / RuntimeManager path with interactive_pty Codex nodes.',
    workflows: PROMPT_06_WORKFLOWS.map(spec => ({
      name: spec.name,
      title: spec.title,
      agentCount: spec.agents.length,
      expectedFiles: spec.expectedFiles,
      runInstruction: spec.runInstruction,
    })),
    results: [] as LiveWorkflowResult[],
  };

  await writeReport(options.outputPath, report);
  for (let index = 0; index < PROMPT_06_WORKFLOWS.length; index += 1) {
    const result = await runPrompt06Workflow(PROMPT_06_WORKFLOWS[index], index, options);
    report.results.push(result);
    await writeReport(options.outputPath, report);
    if (index < PROMPT_06_WORKFLOWS.length - 1) {
      await waitForPrompt06McpHealth();
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

async function runPrompt05BranchingMergeHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const selectedWorkflows = selectPromptWorkflows(PROMPT_05_WORKFLOWS);
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'prompt05_branching_merge',
    workflowFilter: LIVE_WORKFLOW_FILTER ?? null,
    executionPath: 'live_app_harness',
    liveRuntimeLaunched: true,
    note: 'Runs Prompt 05 through the app-side MissionOrchestrator / WorkflowOrchestrator / RuntimeManager path with interactive_pty Codex branching and merge nodes.',
    workflows: selectedWorkflows.map(({ spec, index }) => ({
      index: index + 1,
      name: spec.name,
      title: spec.title,
      agentCount: spec.agents.length,
      branchCount: spec.agents.filter(agent => ['builder', 'scout', 'tester', 'security'].includes(agent.roleId)).length,
      expectedFiles: spec.expectedFiles,
      runInstruction: spec.runInstruction,
      edges: spec.edges,
    })),
    results: [] as LiveWorkflowResult[],
  };

  await writeReport(options.outputPath, report);
  for (let selectedIndex = 0; selectedIndex < selectedWorkflows.length; selectedIndex += 1) {
    const { spec, index } = selectedWorkflows[selectedIndex];
    const result = await runPrompt06Workflow(
      spec,
      index,
      options,
      'branching-merge',
      '05',
      'prompt05',
    );
    report.results.push(result);
    await writeReport(options.outputPath, report);
    if (selectedIndex < selectedWorkflows.length - 1) {
      await waitForPrompt06McpHealth('Prompt 05');
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

export async function runLiveWorkflowHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  if (options.suiteName === 'prompt05_branching_merge') {
    await runPrompt05BranchingMergeHarness(options);
    return;
  }

  if (options.suiteName === 'prompt06_large_workflows') {
    await runPrompt06LargeWorkflowHarness(options);
    return;
  }

  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    options: {
      suiteName: options.suiteName ?? null,
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
    suiteName: env.VITE_LIVE_WORKFLOW_SUITE || null,
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
