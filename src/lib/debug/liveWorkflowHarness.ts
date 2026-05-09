import { invoke } from '@tauri-apps/api/core';
import { Window } from '@tauri-apps/api/window';
import type { CompiledMission, WorkflowAgentCli } from '../../store/workspace.js';
import { useWorkspaceStore } from '../../store/workspace.js';
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
  screenwatchDir: string;
  screenwatchEnabled: boolean;
  screenwatchIntervalMs: number;
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
  uiScreenwatch?: UiScreenwatchSummary;
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
const LIVE_WORKFLOW_CLI_MODELS: Partial<Record<WorkflowAgentCli, string>> = {
  codex: import.meta.env.VITE_LIVE_WORKFLOW_CODEX_MODEL || LIVE_WORKFLOW_MODEL,
  claude: import.meta.env.VITE_LIVE_WORKFLOW_CLAUDE_MODEL || undefined,
  gemini: import.meta.env.VITE_LIVE_WORKFLOW_GEMINI_MODEL || undefined,
  opencode: import.meta.env.VITE_LIVE_WORKFLOW_OPENCODE_MODEL || undefined,
};
const LIVE_WORKFLOW_FILTER: string | undefined =
  typeof import.meta.env.VITE_LIVE_WORKFLOW_FILTER === 'string' && import.meta.env.VITE_LIVE_WORKFLOW_FILTER.trim()
    ? import.meta.env.VITE_LIVE_WORKFLOW_FILTER
    : undefined;

function liveWorkflowModelForCli(cli: WorkflowAgentCli): string | undefined {
  return LIVE_WORKFLOW_CLI_MODELS[cli];
}

interface LiveWorkflowTaskSpec {
  objective: string;
  expectedFiles: string[];
  acceptance: string[];
}

interface UiScreenwatchSummary {
  enabled: boolean;
  directory?: string;
  snapshots: string[];
  totalSnapshots: number;
  latest?: UiScreenwatchSnapshot;
  issueCounts: Record<string, number>;
  errors: string[];
  visualReview: UiScreenwatchVisualReview;
}

interface UiScreenwatchSnapshot {
  schemaVersion: 1;
  capturedAt: string;
  label: string;
  missionId: string;
  url: string;
  viewport: { width: number; height: number };
  document: {
    title: string;
    visibilityState: string;
    bodyTextLength: number;
    bodyTextPreview: string;
    bodyRect: RectSummary | null;
  };
  terminals: TerminalUiSummary[];
  artifacts: {
    visibleIndicators: number;
    emptyWaitingIndicators: number;
    textPreview: string;
  };
  errorIndicators: string[];
  issues: string[];
  visualReview: UiScreenwatchVisualReview;
}

interface UiScreenwatchVisualReview {
  required: true;
  reason: string;
  instruction: string;
  screenshotTool: 'debug_capture_app_screenshot';
  screenshotContract: {
    captureTarget: 'matched_app_window_handle';
    occlusionIndependent: true;
    foregroundWindowRequired: false;
    capturesDesktop: false;
  };
}

interface RectSummary {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface TerminalUiSummary {
  index: number;
  rect: RectSummary | null;
  textLength: number;
  rowsTextLength: number;
  canvasCount: number;
  canvasPaintedCount: number | null;
  looksBlank: boolean;
  textPreview: string;
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
    lower.includes('rate_limit') ||
    lower.includes('rate limited') ||
    lower.includes('rate limit exceeded') ||
    lower.includes('rate limit reached') ||
    lower.includes('quota exceeded') ||
    lower.includes('quota exhausted') ||
    lower.includes('quota limit') ||
    lower.includes('limit exhausted') ||
    lower.includes('limit will reset') ||
    lower.includes('too many requests') ||
    lower.includes('resource_exhausted') ||
    /\b(?:http|status|error|code)\s*[:= -]?\s*429\b/.test(lower)
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
        model: liveWorkflowModelForCli(cliSequence[index]),
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

function rectSummary(rect: DOMRect | null | undefined): RectSummary | null {
  if (!rect) return null;
  return {
    x: Math.round(rect.x),
    y: Math.round(rect.y),
    width: Math.round(rect.width),
    height: Math.round(rect.height),
  };
}

function countPaintedCanvases(root: Element): { count: number; readable: boolean } {
  const canvases = Array.from(root.querySelectorAll('canvas'));
  let painted = 0;
  let readable = true;
  for (const canvas of canvases) {
    try {
      const context = canvas.getContext('2d', { willReadFrequently: true });
      if (!context || canvas.width <= 0 || canvas.height <= 0) {
        continue;
      }
      const width = Math.min(canvas.width, 32);
      const height = Math.min(canvas.height, 32);
      const data = context.getImageData(0, 0, width, height).data;
      for (let index = 3; index < data.length; index += 4) {
        if (data[index] !== 0 || data[index - 1] !== 0 || data[index - 2] !== 0 || data[index - 3] !== 0) {
          painted += 1;
          break;
        }
      }
    } catch {
      readable = false;
    }
  }
  return { count: painted, readable };
}

function buildUiScreenwatchVisualReview(): UiScreenwatchVisualReview {
  return {
    required: true,
    reason: 'Screenwatch JSON uses DOM and xterm heuristics only; it is not a visual UI classifier.',
    instruction: 'Explicitly capture the running CometAI app with debug_capture_app_screenshot, analyze the PNG, and report perceivable UI errors such as broken layout, overlapping panes, clipped text, blank areas, stale prompts, or incorrect CLI surfaces. The screenshot tool captures the matched app window handle, not foreground desktop pixels, so other windows being open or in front should not affect the image.',
    screenshotTool: 'debug_capture_app_screenshot',
    screenshotContract: {
      captureTarget: 'matched_app_window_handle',
      occlusionIndependent: true,
      foregroundWindowRequired: false,
      capturesDesktop: false,
    },
  };
}

function collectUiScreenwatchSnapshot(label: string, missionId: string): UiScreenwatchSnapshot {
  const bodyText = document.body?.innerText ?? '';
  const lowerBodyText = bodyText.toLowerCase();
  const terminals = Array.from(document.querySelectorAll('.xterm')).map((terminal, index): TerminalUiSummary => {
    const rowsText = Array.from(terminal.querySelectorAll('.xterm-rows')).map(node => node.textContent ?? '').join('\n');
    const terminalText = terminal.textContent ?? '';
    const rect = terminal.getBoundingClientRect();
    const canvasInfo = countPaintedCanvases(terminal);
    const canvasCount = terminal.querySelectorAll('canvas').length;
    const hasArea = rect.width > 120 && rect.height > 60;
    const hasReadablePaint = canvasInfo.readable ? canvasInfo.count > 0 : true;
    const looksBlank = hasArea && terminalText.trim().length < 8 && rowsText.trim().length < 8 && !hasReadablePaint;
    return {
      index,
      rect: rectSummary(rect),
      textLength: terminalText.trim().length,
      rowsTextLength: rowsText.trim().length,
      canvasCount,
      canvasPaintedCount: canvasInfo.readable ? canvasInfo.count : null,
      looksBlank,
      textPreview: truncateText((rowsText || terminalText).replace(/\s+/g, ' ').trim(), 240),
    };
  });
  const artifactText = Array.from(document.querySelectorAll('[class*="artifact" i], [title*="artifact" i]'))
    .map(node => (node.textContent ?? '').trim())
    .filter(Boolean)
    .join('\n');
  const errorIndicators = [
    'react error',
    'error boundary',
    'unhandledrejection',
    'uncaught',
    'failed to render',
  ].filter(pattern => lowerBodyText.includes(pattern));
  const issues = [
    ...terminals.filter(terminal => terminal.looksBlank).map(terminal => `blank_terminal_${terminal.index}`),
    ...errorIndicators.map(pattern => `error_indicator_${pattern.replace(/\s+/g, '_')}`),
  ];
  if ((document.body?.getBoundingClientRect().width ?? 0) < 100 || bodyText.trim().length < 20) {
    issues.push('app_surface_mostly_empty');
  }
  if (lowerBodyText.includes('waiting for artifacts')) {
    issues.push('artifact_waiting_indicator_visible');
  }

  return {
    schemaVersion: 1,
    capturedAt: new Date().toISOString(),
    label,
    missionId,
    url: window.location.href,
    viewport: {
      width: window.innerWidth,
      height: window.innerHeight,
    },
    document: {
      title: document.title,
      visibilityState: document.visibilityState,
      bodyTextLength: bodyText.length,
      bodyTextPreview: truncateText(bodyText.replace(/\s+/g, ' ').trim(), 500),
      bodyRect: rectSummary(document.body?.getBoundingClientRect()),
    },
    terminals,
    artifacts: {
      visibleIndicators: artifactText ? artifactText.split('\n').length : 0,
      emptyWaitingIndicators: lowerBodyText.includes('waiting for artifacts') ? 1 : 0,
      textPreview: truncateText(artifactText.replace(/\s+/g, ' ').trim(), 500),
    },
    errorIndicators,
    issues,
    visualReview: buildUiScreenwatchVisualReview(),
  };
}

class UiScreenwatchController {
  private readonly snapshots: string[] = [];
  private readonly errors: string[] = [];
  private readonly issueCounts = new Map<string, number>();
  private latest: UiScreenwatchSnapshot | undefined;
  private timer: ReturnType<typeof setInterval> | null = null;
  private sequence = 0;

  constructor(
    private readonly enabled: boolean,
    private readonly directory: string,
    private readonly missionId: string,
    private readonly intervalMs: number,
  ) {}

  start(): void {
    if (!this.enabled) return;
    void this.capture('start');
    this.timer = setInterval(() => {
      void this.capture('interval');
    }, Math.max(1_000, this.intervalMs));
  }

  async capture(label: string): Promise<void> {
    if (!this.enabled) return;
    try {
      await ensureNestedDirectory(this.directory);
      const snapshot = collectUiScreenwatchSnapshot(label, this.missionId);
      this.latest = snapshot;
      for (const issue of snapshot.issues) {
        this.issueCounts.set(issue, (this.issueCounts.get(issue) ?? 0) + 1);
      }
      this.sequence += 1;
      const fileName = `${String(this.sequence).padStart(3, '0')}-${label.replace(/[^a-z0-9_-]+/gi, '-').toLowerCase()}.json`;
      const path = joinWindowsPath(this.directory, fileName);
      await invoke('workspace_write_text_file', {
        path,
        content: JSON.stringify(snapshot, null, 2),
      });
      this.snapshots.push(path);
    } catch (error) {
      this.errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  async stop(label = 'stop'): Promise<void> {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    await this.capture(label);
  }

  summary(): UiScreenwatchSummary {
    return {
      enabled: this.enabled,
      directory: this.enabled ? this.directory : undefined,
      snapshots: [...this.snapshots],
      totalSnapshots: this.snapshots.length,
      latest: this.latest,
      issueCounts: Object.fromEntries(this.issueCounts),
      errors: [...this.errors],
      visualReview: buildUiScreenwatchVisualReview(),
    };
  }
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
  const eventTypes = sessionEvents.map(event => String(event.type ?? ''));
  const mcpEventTypes = sessionEvents
    .filter(event => event.type === 'mcp_event_observed')
    .map(event => String(event.mcpType ?? ''));
  const hasObservedCompletion = eventTypes.includes('session_completed') || mcpEventTypes.includes('task:completed');
  const combined = [
    error ?? '',
    ...sessionEvents.map(event => String(event.error ?? event.reason ?? event.message ?? event.type ?? '')),
    ...Object.values(terminalTails),
  ].join('\n').toLowerCase();

  if (!combined.trim()) return undefined;
  if (!error && hasObservedCompletion) return undefined;
  if (combined.includes('did not call get_task_details') || combined.includes('did not fetch the current task')) return 'task_ack_timeout';
  if (combined.includes('waiting_auth') || combined.includes('authentication flow detected') || combined.includes('waiting for authentication')) {
    return 'provider_auth_required';
  }
  if (combined.includes('rate limit') || combined.includes('rate_limit') || combined.includes('429')) return 'rate_limited';
  if (combined.includes('mcp_health_timeout')) return 'mcp_health_timeout';
  if (combined.includes('mcp_health_unavailable')) return 'mcp_health_unavailable';
  if (combined.includes('mcp_registration_timeout')) return 'mcp_registration_timeout';
  if (combined.includes('mcp_registration_failed')) return 'mcp_registration_failed';
  if (combined.includes('post_ack_no_progress')) return 'post_ack_no_progress';
  if (combined.includes('post_ack_no_mcp_completion')) return 'post_ack_no_mcp_completion';
  if (combined.includes('missing_mcp_completion')) return 'missing_mcp_completion';
  if (combined.includes('pty_exited_without_completion')) return 'pty_exited_without_completion';
  if (
    eventTypes.includes('task_acked') &&
    !eventTypes.includes('session_completed') &&
    !mcpEventTypes.includes('task:completed')
  ) {
    return 'post_ack_no_mcp_completion';
  }
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
  const screenwatch = new UiScreenwatchController(
    options.screenwatchEnabled,
    joinWindowsPath(options.screenwatchDir, mission.missionId),
    mission.missionId,
    options.screenwatchIntervalMs,
  );
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
    screenwatch.start();
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
        await screenwatch.capture('completed');
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
          uiScreenwatch: screenwatch.summary(),
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
    await screenwatch.capture(terminalStatus ?? (failedEvent ? 'failed' : 'timeout'));
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
      uiScreenwatch: screenwatch.summary(),
      nodeFinalStates: buildNodeFinalStates(mission.missionId),
      error,
    };
  } catch (error) {
    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    await screenwatch.capture('error');
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
      uiScreenwatch: screenwatch.summary(),
      nodeFinalStates: buildNodeFinalStates(mission.missionId),
      error: message,
    };
  } finally {
    await screenwatch.stop('cleanup');
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
  cli?: WorkflowAgentCli;
}

interface Prompt06WorkflowSpec {
  name: string;
  title: string;
  task: string;
  expectedFiles: string[];
  runInstruction: string;
  agents: Prompt06AgentSpec[];
  edges: Array<{ fromNodeId: string; toNodeId: string; condition?: 'always' | 'on_success' | 'on_failure' }>;
  startNodeIds?: string[];
  nodeTreeOperations?: string[];
  promptNumber?: string;
  suiteSlug?: string;
  suiteDirName?: string;
  expectedFailure?: boolean;
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
      prompt06Agent('coordinator', 'coordinator', 'Codex Coordinator', 'Define the landing page sections and branch acceptance criteria.', 'codex'),
      prompt06Agent('builder-copy', 'builder', 'Claude Copy Builder', 'Create branch copy, messaging, and README notes.', 'claude'),
      prompt06Agent('builder-interaction', 'builder', 'Gemini Interaction Builder', 'Create the interactive script and wire it into the page.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Reviewer', 'Merge both branch contributions into the final openable page and verify expected files.', 'opencode'),
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
      prompt06Agent('coordinator', 'coordinator', 'Claude Coordinator', 'Set the event guide scope and acceptance criteria.', 'claude'),
      prompt06Agent('scout-agenda', 'scout', 'Gemini Agenda Scout', 'Define schedule, location, and attendee flow.', 'gemini'),
      prompt06Agent('scout-vendors', 'scout', 'OpenCode Vendor Scout', 'Define vendor categories and highlights.', 'opencode'),
      prompt06Agent('builder', 'builder', 'Codex Builder', 'Build the guide page from both scout artifacts.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Claude Reviewer', 'Verify both scout inputs are represented in the final page.', 'claude'),
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
      prompt06Agent('scout', 'scout', 'Gemini Scout', 'Define the CLI user story and sample task fields.', 'gemini'),
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Coordinator', 'Split command parsing, data model, and documentation responsibilities.', 'opencode'),
      prompt06Agent('builder-cli', 'builder', 'Codex CLI Builder', 'Implement argparse command handling.', 'codex'),
      prompt06Agent('builder-data', 'builder', 'Claude Data Builder', 'Create sample_tasks.json and load/validation behavior.', 'claude'),
      prompt06Agent('builder-docs', 'builder', 'Gemini Docs Builder', 'Write concise usage examples in README.md.', 'gemini'),
      prompt06Agent('tester', 'tester', 'OpenCode Tester', 'Verify the CLI entry point and expected files.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Reviewer', 'Confirm all branch work is integrated and complete.', 'codex'),
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
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Coordinator', 'Define dashboard metrics, branch boundaries, and merge criteria.', 'opencode'),
      prompt06Agent('builder-data', 'builder', 'Gemini Data Builder', 'Create realistic support queue data.json.', 'gemini'),
      prompt06Agent('builder-ui', 'builder', 'Claude UI Builder', 'Create index.html and app.js rendering behavior.', 'claude'),
      prompt06Agent('tester-data', 'tester', 'Codex Data Tester', 'Validate data shape and branch artifact coverage.', 'codex'),
      prompt06Agent('tester-ui', 'tester', 'OpenCode UI Tester', 'Validate the page can render the metrics from data.json.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Reviewer', 'Merge tester findings and finalize the dashboard.', 'gemini'),
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
      prompt06Agent('coordinator', 'coordinator', 'Codex Coordinator', 'Define checklist scope and branch outputs.', 'codex'),
      prompt06Agent('scout-risks', 'scout', 'Claude Risk Scout', 'Define security and privacy checklist categories.', 'claude'),
      prompt06Agent('scout-ux', 'scout', 'Gemini UX Scout', 'Define usable filter and status behavior.', 'gemini'),
      prompt06Agent('builder-data', 'builder', 'OpenCode Data Builder', 'Create checklist.json from risk categories.', 'opencode'),
      prompt06Agent('builder-ui', 'builder', 'Codex UI Builder', 'Create page and JavaScript filter behavior.', 'codex'),
      prompt06Agent('security-reviewer', 'security', 'Claude Security Reviewer', 'Check that risk categories are represented and no unsafe output is created.', 'claude'),
      prompt06Agent('tester', 'tester', 'Gemini Tester', 'Verify expected files and local-open instructions.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Reviewer', 'Finalize the app after consuming security and tester outputs.', 'opencode'),
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
      prompt06Agent('planner', 'planner', 'Gemini Planner', 'Define calculator inputs, formula, and branch deliverables.', 'gemini'),
      prompt06Agent('builder-logic', 'builder', 'Codex Logic Builder', 'Create the calculation behavior in app.js.', 'codex'),
      prompt06Agent('builder-ui', 'builder', 'Claude UI Builder', 'Create the HTML structure and controls.', 'claude'),
      prompt06Agent('integrator', 'builder', 'OpenCode Integrator', 'Merge UI and logic into a cohesive demo.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Reviewer', 'Verify the integrated calculator and README.', 'codex'),
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
      prompt06Agent('coordinator', 'coordinator', 'Claude Coordinator', 'Define demo behavior, controls, and branch responsibilities.', 'claude'),
      prompt06Agent('builder-canvas', 'builder', 'OpenCode Canvas Builder', 'Create canvas drawing and animation loop.', 'opencode'),
      prompt06Agent('builder-controls', 'builder', 'Gemini Controls Builder', 'Create start, pause, and reset controls.', 'gemini'),
      prompt06Agent('builder-copy', 'builder', 'Codex Copy Builder', 'Create concise on-page copy and README instructions.', 'codex'),
      prompt06Agent('tester', 'tester', 'Claude Tester', 'Verify the demo files are present and wired together.', 'claude'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Reviewer', 'Confirm all branches are represented in the final demo.', 'opencode'),
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
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Coordinator', 'Define the repro scenario and expected behavior.', 'opencode'),
      prompt06Agent('builder-repro', 'builder', 'Gemini Repro Builder', 'Create repro.py with clear output.', 'gemini'),
      prompt06Agent('builder-fixture', 'builder', 'Claude Fixture Builder', 'Create the CSV fixture and README context.', 'claude'),
      prompt06Agent('tester', 'tester', 'Codex Tester', 'Run or reason through the repro command and verify files.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Reviewer', 'Confirm repro and fixture branches are both consumed.', 'gemini'),
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
      prompt06Agent('coordinator', 'coordinator', 'Codex Coordinator', 'Define visualizer scope and merge criteria.', 'codex'),
      prompt06Agent('builder-data', 'builder', 'Claude Data Builder', 'Create inventory.json with realistic item rows.', 'claude'),
      prompt06Agent('builder-render', 'builder', 'OpenCode Render Builder', 'Create page rendering and summary cards.', 'opencode'),
      prompt06Agent('builder-filter', 'builder', 'Gemini Filter Builder', 'Create category filtering behavior.', 'gemini'),
      prompt06Agent('tester', 'tester', 'Claude Tester', 'Verify data, rendering, and filtering are represented.', 'claude'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Reviewer', 'Finalize the integrated visualizer.', 'codex'),
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
      prompt06Agent('coordinator', 'coordinator', 'Gemini Coordinator', 'Define FAQ categories, branch outputs, and merge criteria.', 'gemini'),
      prompt06Agent('builder-copy', 'builder', 'Codex Copy Builder', 'Create FAQ content and README guidance.', 'codex'),
      prompt06Agent('builder-style', 'builder', 'Claude Style Builder', 'Create styles.css and layout polish.', 'claude'),
      prompt06Agent('integrator', 'builder', 'OpenCode Integrator', 'Create index.html and search.js from both branch inputs.', 'opencode'),
      prompt06Agent('tester', 'tester', 'Gemini Tester', 'Verify search behavior wiring and expected files.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'Claude Reviewer', 'Finalize the integrated microsite after tester evidence.', 'claude'),
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

const PROMPT_05_MID_MIXED_CLI_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'merge-release-notes-cli',
    title: 'Coordinator to two builders to reviewer release notes CLI',
    task: 'Create a small standard-library Python CLI that merges two changelog JSON inputs into user-facing release notes grouped by feature, fix, and operations impact.',
    expectedFiles: ['release_notes.py', 'sample_changes_a.json', 'sample_changes_b.json', 'README.md'],
    runInstruction: 'Run python release_notes.py --left sample_changes_a.json --right sample_changes_b.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define the release-note merge contract and assign Builder1 to CLI behavior and Builder2 to sample data and README.', 'codex'),
      prompt06Agent('builder1', 'builder', 'Builder1', 'Implement release_notes.py with argparse, JSON loading, grouping, duplicate handling, and readable terminal output.', 'claude'),
      prompt06Agent('builder2', 'builder', 'Builder2', 'Create realistic sample_changes_a.json, sample_changes_b.json, and README usage examples without overwriting Builder1 code.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Inspect both builder outputs, run or reason through the documented command, and fix small integration gaps before completing.', 'opencode'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder1'),
      prompt06Edge('coordinator', 'builder2'),
      prompt06Edge('builder1', 'reviewer'),
      prompt06Edge('builder2', 'reviewer'),
    ],
  },
  {
    name: 'mixed-branch-api-docs',
    title: 'Coordinator to Claude and Gemini builders to OpenCode reviewer API docs',
    task: 'Create a compact API documentation package for a fictional incident intake service with endpoints, schemas, examples, error handling, and assumptions.',
    expectedFiles: ['api_reference.md', 'schemas.json', 'examples.http', 'README.md'],
    runInstruction: 'Read README.md, validate schemas.json parses as JSON, and inspect examples.http.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define the API doc scope, split endpoint reference and schemas/examples between branches, and record assumptions.', 'codex'),
      prompt06Agent('claude-builder', 'builder', 'Claude Builder', 'Write api_reference.md with endpoints, authentication, request/response examples, and errors.', 'claude'),
      prompt06Agent('gemini-builder', 'builder', 'Gemini Builder', 'Create schemas.json and examples.http with realistic incident intake payloads and responses.', 'gemini'),
      prompt06Agent('opencode-reviewer', 'reviewer', 'OpenCode Reviewer', 'Merge-review the docs package, ensure files agree, and complete only after schemas.json is valid.', 'opencode'),
    ],
    edges: [
      prompt06Edge('coordinator', 'claude-builder'),
      prompt06Edge('coordinator', 'gemini-builder'),
      prompt06Edge('claude-builder', 'opencode-reviewer'),
      prompt06Edge('gemini-builder', 'opencode-reviewer'),
    ],
  },
  {
    name: 'delegated-research-dashboard',
    title: 'Codex coordinator to Claude and Gemini scouts to OpenCode builder to Codex reviewer',
    task: 'Create a research-backed recommendation package for choosing a lightweight project status metric set. Include source-style assumptions, sample metric data, and a concise final recommendation.',
    expectedFiles: ['metric_recommendations.md', 'metrics.json', 'research_notes.md', 'README.md'],
    runInstruction: 'Validate metrics.json parses as JSON and read metric_recommendations.md.',
    agents: [
      prompt06Agent('codex-coordinator', 'coordinator', 'Codex Coordinator', 'Frame the research questions and assign one scout to metric definitions and one scout to assumptions and limitations.', 'codex'),
      prompt06Agent('claude-scout', 'scout', 'Claude Scout', 'Produce branch-artifacts/claude-scout.md with candidate metric definitions and concise rationale.', 'claude'),
      prompt06Agent('gemini-scout', 'scout', 'Gemini Scout', 'Produce branch-artifacts/gemini-scout.md with assumptions, source-style notes, and risks for the metric set.', 'gemini'),
      prompt06Agent('opencode-builder', 'builder', 'OpenCode Builder', 'Build metric_recommendations.md, metrics.json, research_notes.md, and README.md from both scout artifacts.', 'opencode'),
      prompt06Agent('codex-reviewer', 'reviewer', 'Codex Reviewer', 'Review the integrated dashboard package, validate JSON consistency, and complete the final handoff.', 'codex'),
    ],
    edges: [
      prompt06Edge('codex-coordinator', 'claude-scout'),
      prompt06Edge('codex-coordinator', 'gemini-scout'),
      prompt06Edge('claude-scout', 'opencode-builder'),
      prompt06Edge('gemini-scout', 'opencode-builder'),
      prompt06Edge('opencode-builder', 'codex-reviewer'),
    ],
  },
  {
    name: 'implementation-review-bug-repro',
    title: 'Gemini coordinator to Codex and Claude builders to OpenCode tester to Codex reviewer',
    task: 'Create a bug reproduction package for CSV import duplicate IDs, including a repro script, fixture data, expected output notes, and a README.',
    expectedFiles: ['repro_duplicate_ids.py', 'fixtures\\duplicate_ids.csv', 'expected_output.txt', 'README.md'],
    runInstruction: 'Run python repro_duplicate_ids.py fixtures\\duplicate_ids.csv.',
    agents: [
      prompt06Agent('gemini-coordinator', 'coordinator', 'Gemini Coordinator', 'Define the bug scenario, split script and fixture/docs responsibilities, and require a real runnable repro.', 'gemini'),
      prompt06Agent('codex-builder', 'builder', 'Codex Builder', 'Implement repro_duplicate_ids.py using only the standard library, with clear duplicate detection output.', 'codex'),
      prompt06Agent('claude-builder', 'builder', 'Claude Builder', 'Create fixtures/duplicate_ids.csv, expected_output.txt, and README.md without overwriting the script.', 'claude'),
      prompt06Agent('opencode-tester', 'tester', 'OpenCode Tester', 'Inspect both branch outputs, run or reason through the repro command, and record verification in branch-artifacts/opencode-tester.md.', 'opencode'),
      prompt06Agent('codex-reviewer', 'reviewer', 'Codex Reviewer', 'Finalize the package and complete only after expected files exist and the README command is correct.', 'codex'),
    ],
    edges: [
      prompt06Edge('gemini-coordinator', 'codex-builder'),
      prompt06Edge('gemini-coordinator', 'claude-builder'),
      prompt06Edge('codex-builder', 'opencode-tester'),
      prompt06Edge('claude-builder', 'opencode-tester'),
      prompt06Edge('opencode-tester', 'codex-reviewer'),
    ],
  },
  {
    name: 'fan-in-runbook-package',
    title: 'Codex coordinator to Claude and Gemini scouts to Codex and OpenCode builders to Claude reviewer',
    task: 'Create a compact operational runbook package for triaging a static-site deployment incident. Keep the runbook and README concise so the final fan-in can complete quickly.',
    expectedFiles: ['runbook.md', 'triage_helper.py', 'sample_incident.json', 'README.md'],
    runInstruction: 'Run python triage_helper.py --incident sample_incident.json.',
    agents: [
      prompt06Agent('codex-coordinator', 'coordinator', 'Codex Coordinator', 'Define the incident scope, scout questions, builder ownership, and final merge criteria.', 'codex'),
      prompt06Agent('claude-scout', 'scout', 'Claude Scout', 'Produce branch-artifacts/claude-scout.md covering likely symptoms, signals, and stakeholder notes.', 'claude'),
      prompt06Agent('gemini-scout', 'scout', 'Gemini Scout', 'Produce branch-artifacts/gemini-scout.md covering assumptions, risks, and rollback considerations.', 'gemini'),
      prompt06Agent('codex-builder', 'builder', 'Codex Builder', 'Create triage_helper.py, sample_incident.json, and a concise runbook.md using the scout artifacts as inputs. The helper must accept both "--incident sample_incident.json" and "--incident=sample_incident.json".', 'codex'),
      prompt06Agent('opencode-builder', 'builder', 'OpenCode Builder', 'Create only README.md plus branch-artifacts/opencode-builder.md. Keep README under 60 lines, document the helper command, and call complete_task immediately after README.md exists.', 'opencode'),
      prompt06Agent('claude-reviewer', 'reviewer', 'Claude Reviewer', 'Inspect expected files and branch artifacts, fix only small doc inconsistencies, then call complete_task immediately. Do not keep polishing once files exist.', 'claude'),
    ],
    edges: [
      prompt06Edge('codex-coordinator', 'claude-scout'),
      prompt06Edge('codex-coordinator', 'gemini-scout'),
      prompt06Edge('claude-scout', 'codex-builder'),
      prompt06Edge('gemini-scout', 'codex-builder'),
      prompt06Edge('claude-scout', 'opencode-builder'),
      prompt06Edge('gemini-scout', 'opencode-builder'),
      prompt06Edge('codex-builder', 'claude-reviewer'),
      prompt06Edge('opencode-builder', 'claude-reviewer'),
    ],
  },
];

const OPENCODE_POST_ACK_REPRO_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'single-opencode-file-completion',
    title: 'Single OpenCode node creates one file and completes via MCP',
    task: 'Create the smallest possible completion probe: write one text file named opencode_completion_probe.txt with two short lines, then stop work and complete the node through Terminal Docks MCP.',
    expectedFiles: ['opencode_completion_probe.txt'],
    runInstruction: 'Read opencode_completion_probe.txt and confirm it mentions OpenCode MCP completion.',
    agents: [
      prompt06Agent(
        'opencode-probe',
        'builder',
        'OpenCode Probe',
        [
          'Call get_task_details first.',
          'Create only opencode_completion_probe.txt in the output directory.',
          'The file must mention OpenCode and MCP completion.',
          'After the file exists, immediately call complete_task with outcome="success".',
          'Do not create README.md, branch artifacts, screenshots, or any extra files.',
          'Do not end with only a normal final answer.',
        ].join(' '),
        'opencode',
      ),
    ],
    edges: [],
    startNodeIds: ['opencode-probe'],
  },
  {
    name: 'codex-upstream-to-opencode-file-completion',
    title: 'Codex upstream hands one tiny task to OpenCode builder',
    task: 'Create a minimal handoff completion probe. The Codex upstream node should write one short branch note. The OpenCode builder should use that handoff to create one final text file named opencode_handoff_probe.txt, then immediately complete the node through Terminal Docks MCP.',
    expectedFiles: ['opencode_handoff_probe.txt'],
    runInstruction: 'Read opencode_handoff_probe.txt and confirm it mentions Codex upstream handoff and OpenCode MCP completion.',
    agents: [
      prompt06Agent(
        'codex-upstream',
        'scout',
        'Codex Upstream',
        [
          'Call get_task_details first.',
          'Create only branch-artifacts/codex-upstream.md.',
          'Keep the note under 8 lines and mention that OpenCode must create opencode_handoff_probe.txt.',
          'After the branch note exists, immediately call complete_task with outcome="success".',
        ].join(' '),
        'codex',
      ),
      prompt06Agent(
        'opencode-builder',
        'builder',
        'OpenCode Builder',
        [
          'Call get_task_details first.',
          'Read the upstream handoff context.',
          'Create only opencode_handoff_probe.txt in the output directory.',
          'The file must mention Codex upstream handoff and OpenCode MCP completion.',
          'After the file exists, immediately call complete_task with outcome="success".',
          'Do not create README.md, screenshots, dashboards, branch artifacts, or any extra final files.',
          'Do not end with only a normal final answer.',
        ].join(' '),
        'opencode',
      ),
    ],
    edges: [
      prompt06Edge('codex-upstream', 'opencode-builder'),
    ],
    startNodeIds: ['codex-upstream'],
  },
];

const PROMPT_04_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'edited-scout-output',
    title: 'Edited prompt linear scout output',
    task: 'Create a compact technical brief for a fictional terminal productivity feature called Focus Dock. The scout prompt has been edited before run to require a runnable/openable HTML brief rather than markdown-only notes.',
    expectedFiles: ['index.html', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    nodeTreeOperations: [
      'create_workflow_from_nodetree_graph',
      'edit_node_prompt_before_run',
      'verify_output_linked_to_output_node',
    ],
    agents: [
      prompt06Agent('scout', 'scout', 'Scout', 'Create the initial brief content and HTML structure.'),
      prompt06Agent('output', 'reviewer', 'Output', 'Verify the brief is openable and README links the output files.'),
    ],
    edges: [
      prompt06Edge('scout', 'output'),
    ],
  },
  {
    name: 'branch-merge-landing',
    title: 'Coordinator branch and merge landing page',
    task: 'Create a static landing page for a fictional indie software launch named Signal Yard, with one builder responsible for page content and another for a small JavaScript interaction.',
    expectedFiles: ['index.html', 'script.js', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    nodeTreeOperations: [
      'add_branch_coordinator_to_two_builders',
      'add_merge_two_builders_to_reviewer',
      'verify_branch_status_and_reviewer_output_link',
    ],
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define branch responsibilities and acceptance criteria.'),
      prompt06Agent('builder-copy', 'builder', 'Copy Builder', 'Create page copy and layout structure.'),
      prompt06Agent('builder-js', 'builder', 'Interaction Builder', 'Create script.js and wire it to the page.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Merge both branches and verify the final output.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-copy'),
      prompt06Edge('coordinator', 'builder-js'),
      prompt06Edge('builder-copy', 'reviewer'),
      prompt06Edge('builder-js', 'reviewer'),
    ],
  },
  {
    name: 'cli-model-node-setting',
    title: 'Codex CLI/model node setting Python CLI',
    task: 'Create a standard-library Python CLI named note_rollup.py that reads a JSON notes file and prints grouped summaries.',
    expectedFiles: ['note_rollup.py', 'sample_notes.json', 'README.md'],
    runInstruction: 'Run python note_rollup.py --help.',
    nodeTreeOperations: [
      'change_node_cli_to_codex_before_run',
      'change_node_model_setting_before_run',
      'verify_runtime_terminal_binding',
    ],
    agents: [
      prompt06Agent('builder', 'builder', 'Builder', 'Implement the CLI, sample data, and README usage.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Verify the CLI contract and expected files.'),
    ],
    edges: [
      prompt06Edge('builder', 'reviewer'),
    ],
  },
  {
    name: 'subtree-dashboard',
    title: 'Run subtree dashboard builder path',
    task: 'Create a browser mini-dashboard for a fictional release queue. This run starts from the builder subtree after upstream planning was skipped, so the builder must create the complete compact output directly.',
    expectedFiles: ['index.html', 'app.js', 'data.json', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    startNodeIds: ['builder'],
    nodeTreeOperations: [
      'run_subtree_only_from_builder_node',
      'verify_skipped_upstream_nodes_do_not_block_subtree',
      'verify_output_linked_to_subtree_node',
    ],
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Skipped in subtree run; would normally define dashboard scope.'),
      prompt06Agent('builder', 'builder', 'Builder', 'Build the full dashboard from the task prompt because this subtree run starts here.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Verify the subtree output and README.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder'),
      prompt06Edge('builder', 'reviewer'),
    ],
  },
  {
    name: 'triple-with-tester',
    title: 'Scout coordinator builder tester reviewer docs app',
    task: 'Create a small searchable help center microsite for a fictional desktop app, with FAQ data embedded or represented in JavaScript.',
    expectedFiles: ['index.html', 'search.js', 'README.md'],
    runInstruction: 'Open index.html in a browser and use the search input.',
    nodeTreeOperations: [
      'create_deep_nodetree_graph',
      'verify_pending_to_running_to_completed_statuses',
      'verify_tester_to_reviewer_output_linking',
    ],
    agents: [
      prompt06Agent('scout', 'scout', 'Scout', 'Define FAQ categories and user needs.'),
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Split build and test responsibilities.'),
      prompt06Agent('builder', 'builder', 'Builder', 'Build the microsite and search behavior.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Verify search wiring and expected files.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Finalize after tester evidence.'),
    ],
    edges: [
      prompt06Edge('scout', 'coordinator'),
      prompt06Edge('coordinator', 'builder'),
      prompt06Edge('builder', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'parallel-review-split',
    title: 'Coordinator scouts builders reviewer tester split',
    task: 'Create a browser inventory checklist for a fictional hardware lab, with static JSON data and category filtering.',
    expectedFiles: ['index.html', 'app.js', 'inventory.json', 'README.md'],
    runInstruction: 'Open index.html in a browser.',
    nodeTreeOperations: [
      'add_parallel_scouts',
      'add_parallel_builders',
      'merge_to_reviewer_and_tester',
      'verify_multi_target_output_links',
    ],
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Coordinator', 'Define scout and builder branch ownership.'),
      prompt06Agent('scout-data', 'scout', 'Data Scout', 'Define inventory fields and sample rows.'),
      prompt06Agent('scout-ux', 'scout', 'UX Scout', 'Define filtering and checklist behavior.'),
      prompt06Agent('builder-data', 'builder', 'Data Builder', 'Create inventory.json.'),
      prompt06Agent('builder-ui', 'builder', 'UI Builder', 'Create page and filtering behavior.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Verify final integrated output.'),
      prompt06Agent('tester', 'tester', 'Tester', 'Validate data and interaction wiring.'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-data'),
      prompt06Edge('coordinator', 'scout-ux'),
      prompt06Edge('scout-data', 'builder-data'),
      prompt06Edge('scout-ux', 'builder-ui'),
      prompt06Edge('builder-data', 'reviewer'),
      prompt06Edge('builder-ui', 'reviewer'),
      prompt06Edge('builder-data', 'tester'),
      prompt06Edge('builder-ui', 'tester'),
    ],
  },
  {
    name: 'retry-node-package',
    title: 'Retry node repro package',
    task: 'Create a compact Python repro package for a fictional CSV validation issue, including a script, fixture, and README. If a node fails because of provider/runtime issues, the harness should record the failed status and retry path evidence before cleanup.',
    expectedFiles: ['repro.py', 'fixtures\\bad_rows.csv', 'README.md'],
    runInstruction: 'Run python repro.py fixtures\\bad_rows.csv.',
    nodeTreeOperations: [
      'retry_failed_node_when_available',
      'verify_failed_status_display_when_retry_needed',
      'verify_completed_status_after_successful_retry_or_report_blocker',
    ],
    agents: [
      prompt06Agent('builder-repro', 'builder', 'Repro Builder', 'Create repro.py and README context.'),
      prompt06Agent('builder-fixture', 'builder', 'Fixture Builder', 'Create fixtures\\bad_rows.csv.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Verify script, fixture, and README are linked.'),
    ],
    edges: [
      prompt06Edge('builder-repro', 'reviewer'),
      prompt06Edge('builder-fixture', 'reviewer'),
    ],
  },
  {
    name: 'debug-tagged-workflow',
    title: 'Debug-tagged workflow output linking',
    task: 'Create a tiny browser calculator for estimating focus session time savings, with inputs and JavaScript calculation behavior.',
    expectedFiles: ['index.html', 'app.js', 'README.md'],
    runInstruction: 'Open index.html in a browser and change the inputs.',
    nodeTreeOperations: [
      'tag_workflow_as_debug',
      'verify_debug_identifier_in_mission_id_and_preset',
      'verify_final_output_artifacts_link_to_reviewer',
    ],
    agents: [
      prompt06Agent('planner', 'planner', 'Planner', 'Define calculator inputs and formula.'),
      prompt06Agent('builder', 'builder', 'Builder', 'Build the calculator page and app.js.'),
      prompt06Agent('reviewer', 'reviewer', 'Reviewer', 'Verify debug-tagged output links and README.'),
    ],
    edges: [
      prompt06Edge('planner', 'builder'),
      prompt06Edge('builder', 'reviewer'),
    ],
  },
];

const PROMPT_07_10_CAPPED_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'artifact-cli-fire-animation',
    title: 'Prompt 07 artifact-organized CLI fire animation',
    promptNumber: '07',
    suiteSlug: 'prompt07',
    suiteDirName: 'artifact-organization',
    task: 'Create a standard-library Python terminal fire animation package. The CLI should render bounded ANSI flame frames in the terminal, support --frames, --width, --height, --seed, and --no-color flags, and include per-agent branch artifacts that explain ownership and verification.',
    expectedFiles: ['fire_anim.py', 'palettes.json', 'README.md', 'branch-artifacts\\coordinator.md', 'branch-artifacts\\builder-render.md', 'branch-artifacts\\builder-data.md', 'branch-artifacts\\reviewer.md'],
    runInstruction: 'Run python fire_anim.py --frames 8 --width 48 --height 14 --seed 7 --no-color.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Coordinator', 'Define output folder structure, branch artifact requirements, CLI contract, and file-size guardrails.', 'codex'),
      prompt06Agent('builder-render', 'builder', 'Claude Renderer Builder', 'Create fire_anim.py with bounded ANSI/fire rendering, argparse flags, deterministic seed handling, and a small terminal demo path.', 'claude'),
      prompt06Agent('builder-data', 'builder', 'Gemini Palette Builder', 'Create palettes.json plus README usage details and branch artifact notes without overwriting fire_anim.py.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Artifact Reviewer', 'Inspect all branch artifacts, verify expected files, ensure README links concrete output paths, and run or reason through the CLI command.', 'opencode'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-render'),
      prompt06Edge('coordinator', 'builder-data'),
      prompt06Edge('builder-render', 'reviewer'),
      prompt06Edge('builder-data', 'reviewer'),
    ],
  },
  {
    name: 'failure-recovery-fire-probe',
    title: 'Prompt 08 controlled failure recovery package',
    promptNumber: '08',
    suiteSlug: 'prompt08',
    suiteDirName: 'failure-recovery',
    expectedFailure: true,
    task: 'Exercise controlled failure and recovery with a small terminal fire diagnostics package. The first node must intentionally fail after writing failure evidence; the on_failure recovery path must create a runnable retry_probe.py script, recovery notes, and README explaining the expected failure versus app behavior.',
    expectedFiles: ['failure-evidence.md', 'retry_probe.py', 'recovery_plan.md', 'README.md', 'branch-artifacts\\failure-probe.md', 'branch-artifacts\\recovery-builder.md', 'branch-artifacts\\reviewer.md'],
    runInstruction: 'Run python retry_probe.py --frames 5 and confirm it prints bounded diagnostic frames.',
    agents: [
      prompt06Agent('failure-probe', 'tester', 'Codex Controlled Failure Probe', 'Call get_task_details, write failure-evidence.md and branch-artifacts/failure-probe.md, then intentionally call complete_task with outcome "failure" and a clear expected-failure summary. Do not create retry_probe.py.', 'codex'),
      prompt06Agent('recovery-builder', 'builder', 'Claude Recovery Builder', 'Consume the failed upstream context from failure-probe, create retry_probe.py, recovery_plan.md, README.md, and branch-artifacts/recovery-builder.md, then complete successfully.', 'claude'),
      prompt06Agent('recovery-tester', 'tester', 'Gemini Recovery Tester', 'Verify retry_probe.py behavior, record branch-artifacts/recovery-tester.md, and confirm the failure was expected and recovered.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Recovery Reviewer', 'Inspect failure evidence, recovery artifacts, and tester notes; keep expected failure distinct from broken app behavior before completing.', 'opencode'),
    ],
    edges: [
      prompt06Edge('failure-probe', 'recovery-builder', 'on_failure'),
      prompt06Edge('recovery-builder', 'recovery-tester'),
      prompt06Edge('recovery-tester', 'reviewer'),
    ],
  },
  {
    name: 'terminal-pty-verbose-fire',
    title: 'Prompt 09 PTY output visibility fire benchmark',
    promptNumber: '09',
    suiteSlug: 'prompt09',
    suiteDirName: 'terminal-output',
    task: 'Create a terminal output visibility benchmark around a bounded CLI fire renderer. The package must include a Python script that prints deterministic multi-frame output, a verifier that can emit a larger but reasonable log, and README notes for terminal buffering/replay observations.',
    expectedFiles: ['terminal_fire.py', 'verify_terminal_output.py', 'README.md', 'branch-artifacts\\scout.md', 'branch-artifacts\\builder.md', 'branch-artifacts\\tester.md', 'branch-artifacts\\reviewer.md'],
    runInstruction: 'Run python verify_terminal_output.py --frames 16 --width 52 --height 12.',
    agents: [
      prompt06Agent('scout', 'scout', 'Claude Terminal Scout', 'Define terminal visibility checks, expected bounded output volume, and write branch-artifacts/scout.md.', 'claude'),
      prompt06Agent('builder', 'builder', 'Codex PTY Builder', 'Create terminal_fire.py and verify_terminal_output.py with deterministic frame output and no unbounded loops.', 'codex'),
      prompt06Agent('tester', 'tester', 'Gemini PTY Tester', 'Run or reason through the verifier, create branch-artifacts/tester.md, and make terminal-visible progress while keeping output bounded.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode PTY Reviewer', 'Inspect terminal tails and output files, create branch-artifacts/reviewer.md, and summarize visibility/replay evidence in README.md.', 'opencode'),
    ],
    edges: [
      prompt06Edge('scout', 'builder'),
      prompt06Edge('builder', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'nodetree-fire-control-panel',
    title: 'Prompt 10 NodeTree mission-control fire toolkit',
    promptNumber: '10',
    suiteSlug: 'prompt10',
    suiteDirName: 'nodetree-mission-control',
    task: 'Create a NodeTree-style mission-control toolkit for a terminal fire animation. The workflow should exercise edited node prompts, mixed CLI settings, branch and merge behavior, subtree-style builder ownership, status evidence, and output links to concrete project files.',
    expectedFiles: ['fire_control.py', 'fire_config.json', 'status_matrix.md', 'README.md', 'branch-artifacts\\coordinator.md', 'branch-artifacts\\builder-core.md', 'branch-artifacts\\builder-config.md', 'branch-artifacts\\tester.md', 'branch-artifacts\\reviewer.md'],
    runInstruction: 'Run python fire_control.py --config fire_config.json --frames 6 --plain.',
    nodeTreeOperations: [
      'create_workflow_from_nodetree_like_graph',
      'edit_node_prompt_before_run',
      'change_cli_setting_on_node_before_run',
      'add_branch_coordinator_to_builder_core_and_builder_config',
      'add_merge_builders_to_tester_and_reviewer',
      'verify_status_matrix_pending_running_completed_failed_cancelled',
      'verify_output_artifacts_link_to_exact_node_ids',
      'tag_debug_workflow_in_report',
    ],
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex NodeTree Coordinator', 'Record the NodeTree operation contract in branch-artifacts/coordinator.md and assign exact node ID ownership.', 'codex'),
      prompt06Agent('builder-core', 'builder', 'Claude Core Builder', 'Create fire_control.py with argparse, deterministic frame generation, and --plain support.', 'claude'),
      prompt06Agent('builder-config', 'builder', 'Gemini Config Builder', 'Create fire_config.json and status_matrix.md covering pending, queued, starting, running, completed, failed, and cancelled status expectations.', 'gemini'),
      prompt06Agent('tester', 'tester', 'OpenCode NodeTree Tester', 'Verify builder outputs, create branch-artifacts/tester.md, and ensure output links map to exact node IDs.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex NodeTree Reviewer', 'Finalize README.md with concrete output links, run command, DEBUG tag, and NodeTree operation coverage.', 'codex'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-core'),
      prompt06Edge('coordinator', 'builder-config'),
      prompt06Edge('builder-core', 'tester'),
      prompt06Edge('builder-config', 'tester'),
      prompt06Edge('builder-core', 'reviewer'),
      prompt06Edge('builder-config', 'reviewer'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
];

const PROMPT_11_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'single-claude-risk-simulator',
    title: 'Single-agent Claude Monte Carlo risk simulator',
    task: 'Create a standard-library Python CLI named risk_simulator.py that runs a deterministic Monte Carlo portfolio risk simulation with configurable trials, seed, and percentile outputs. Include a sample JSON portfolio and concise README.',
    expectedFiles: ['risk_simulator.py', 'sample_portfolio.json', 'README.md'],
    runInstruction: 'Run python risk_simulator.py --portfolio sample_portfolio.json --trials 2000 --seed 42.',
    agents: [
      prompt06Agent('agent', 'builder', 'Claude Builder', 'Create the full Python CLI, sample portfolio, and README, then complete the MCP task.', 'claude'),
    ],
    edges: [],
  },
  {
    name: 'gemini-opencode-queue-calculator',
    title: 'Gemini scout to OpenCode queue calculator CLI',
    task: 'Create a standard-library Python CLI named queue_capacity.py that models multi-server queue capacity using Erlang C style calculations, prints utilization, wait probability, expected wait, and scenario recommendations from a JSON input file.',
    expectedFiles: ['queue_capacity.py', 'sample_scenarios.json', 'README.md'],
    runInstruction: 'Run python queue_capacity.py --scenarios sample_scenarios.json.',
    agents: [
      prompt06Agent('scout', 'scout', 'Gemini Scout', 'Define the calculation contract, JSON scenario shape, and numeric acceptance checks.', 'gemini'),
      prompt06Agent('builder', 'builder', 'OpenCode Builder', 'Build the CLI and README from the scout context.', 'opencode'),
    ],
    edges: [
      prompt06Edge('scout', 'builder'),
    ],
  },
  {
    name: 'mixed-branch-scheduler-analysis',
    title: 'Mixed CLI branch and review scheduler analysis package',
    task: 'Create a standard-library Python analysis package for comparing job-shop scheduling heuristics. Preserve exact branch ownership by node ID: builder-copy creates only jobs.json plus README/verification notes for heuristic and metric requirements; builder-data creates the runnable scheduler_analysis.py implementation and must not replace it with a placeholder; reviewer verifies the integrated CLI output.',
    expectedFiles: ['scheduler_analysis.py', 'jobs.json', 'README.md', 'verification_notes.md'],
    runInstruction: 'Run python scheduler_analysis.py --jobs jobs.json --heuristics shortest,longest,weighted.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Coordinator', 'Route by exact node IDs: builder-copy owns jobs.json/README/verification_notes.md requirements; builder-data owns scheduler_analysis.py implementation; do not swap branch responsibilities.', 'codex'),
      prompt06Agent('builder-copy', 'builder', 'Claude Dataset Builder', 'Create jobs.json and document heuristic/metric expectations in README.md or verification_notes.md. Do not create or overwrite scheduler_analysis.py.', 'claude'),
      prompt06Agent('builder-data', 'builder', 'Gemini Scheduler Builder', 'Create the complete runnable scheduler_analysis.py CLI with deterministic job-shop heuristic calculations over jobs that contain ordered operations arrays with machine and duration fields. Do not assume a flat job.duration field. Calculate makespan, machine utilization, and per-operation schedules, support argparse --jobs and --heuristics, and print results. Do not leave main() as pass.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Reviewer', 'Inspect both branch outputs, verify all expected files, and finalize README instructions.', 'opencode'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-copy'),
      prompt06Edge('coordinator', 'builder-data'),
      prompt06Edge('builder-copy', 'reviewer'),
      prompt06Edge('builder-data', 'reviewer'),
    ],
  },
  {
    name: 'consecutive-opencode-network-flow',
    title: 'Consecutive single-agent run A with OpenCode',
    task: 'Create a standard-library Python CLI named max_flow.py that computes max flow on a small directed network from JSON using Edmonds-Karp and prints min-cut edges plus total flow.',
    expectedFiles: ['max_flow.py', 'network.json', 'README.md'],
    runInstruction: 'Run python max_flow.py --network network.json.',
    agents: [
      prompt06Agent('agent', 'builder', 'OpenCode Builder', 'Create the full Python max-flow CLI, sample network, and README, then complete the MCP task.', 'opencode'),
    ],
    edges: [],
  },
  {
    name: 'consecutive-codex-matrix-solver',
    title: 'Consecutive single-agent run B with Codex',
    task: 'Create a standard-library Python CLI named matrix_solver.py that solves linear systems with Gaussian elimination, reports determinant and residual error, and reads a sample JSON matrix problem.',
    expectedFiles: ['matrix_solver.py', 'matrix_problem.json', 'README.md'],
    runInstruction: 'Run python matrix_solver.py --problem matrix_problem.json.',
    agents: [
      prompt06Agent('agent', 'builder', 'Codex Builder', 'Create the full Python solver CLI, sample problem, and README, then complete the MCP task.', 'codex'),
    ],
    edges: [],
  },
  {
    name: 'planner-etl-dashboard',
    title: 'Template-generated ETL dashboard package',
    task: 'Create a compact multi-stack operations analytics package: a Python ETL script reads transactions.csv and writes summary.json, and a plain JavaScript/HTML dashboard opens summary.json and renders revenue, category, and anomaly summaries. Include README instructions.',
    expectedFiles: ['etl_transactions.py', 'transactions.csv', 'summary.json', 'dashboard.html', 'dashboard.js', 'README.md', 'branch-artifacts\\planner.md', 'branch-artifacts\\builder-etl.md', 'branch-artifacts\\builder-ui.md', 'branch-artifacts\\reviewer.md'],
    runInstruction: 'Run python etl_transactions.py --input transactions.csv --output summary.json, then open dashboard.html.',
    agents: [
      prompt06Agent('planner', 'coordinator', 'Codex Planner', 'Define the ETL contract, file ownership, and dashboard data schema under branch-artifacts/planner.md.', 'codex'),
      prompt06Agent('builder-etl', 'builder', 'Claude ETL Builder', 'Create transactions.csv, etl_transactions.py, summary.json, and branch-artifacts/builder-etl.md. Do not create dashboard files.', 'claude'),
      prompt06Agent('builder-ui', 'builder', 'Gemini Dashboard Builder', 'Create dashboard.html and dashboard.js that consume summary.json, plus branch-artifacts/builder-ui.md. Do not overwrite ETL files.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Reviewer', 'Verify both stacks, inspect all branch artifacts, and finalize README.md with concrete commands.', 'opencode'),
    ],
    edges: [
      prompt06Edge('planner', 'builder-etl'),
      prompt06Edge('planner', 'builder-ui'),
      prompt06Edge('builder-etl', 'reviewer'),
      prompt06Edge('builder-ui', 'reviewer'),
    ],
  },
  {
    name: 'planner-sqlite-log-audit',
    title: 'Template-generated SQLite log audit toolkit',
    task: 'Create a log audit toolkit that combines Python data loading, SQLite querying, and a generated Markdown findings report. It must load sample_events.csv into audit.db, run deterministic queries, and write findings.md plus README.',
    expectedFiles: ['load_audit_db.py', 'sample_events.csv', 'queries.sql', 'findings.md', 'README.md', 'branch-artifacts\\scout.md', 'branch-artifacts\\builder.md', 'branch-artifacts\\tester.md'],
    runInstruction: 'Run python load_audit_db.py --csv sample_events.csv --db audit.db --queries queries.sql.',
    agents: [
      prompt06Agent('scout', 'scout', 'Gemini Audit Scout', 'Define event schema, query expectations, and write branch-artifacts/scout.md.', 'gemini'),
      prompt06Agent('builder', 'builder', 'Codex Audit Builder', 'Create the Python loader, CSV fixture, SQL queries, findings output path, and README.', 'codex'),
      prompt06Agent('tester', 'tester', 'Claude Audit Tester', 'Verify the loader and query artifacts, then write branch-artifacts/tester.md with evidence.', 'claude'),
    ],
    edges: [
      prompt06Edge('scout', 'builder'),
      prompt06Edge('builder', 'tester'),
    ],
  },
  {
    name: 'planner-node-python-forecast',
    title: 'Template-generated Node/Python forecast package',
    task: 'Create a compact forecasting package where Python generates normalized forecast.json from demand.csv and a Node.js verifier reads forecast.json to validate totals and thresholds. Include README and verification notes.',
    expectedFiles: ['forecast.py', 'demand.csv', 'forecast.json', 'verify_forecast.mjs', 'verification_notes.md', 'README.md', 'branch-artifacts\\coordinator.md', 'branch-artifacts\\python-builder.md', 'branch-artifacts\\node-builder.md', 'branch-artifacts\\reviewer.md'],
    runInstruction: 'Run python forecast.py --input demand.csv --output forecast.json, then node verify_forecast.mjs forecast.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Coordinator', 'Assign exact node ownership and create branch-artifacts/coordinator.md.', 'opencode'),
      prompt06Agent('python-builder', 'builder', 'Claude Python Builder', 'Create demand.csv, forecast.py, forecast.json, and branch-artifacts/python-builder.md.', 'claude'),
      prompt06Agent('node-builder', 'builder', 'Codex Node Builder', 'Create verify_forecast.mjs, verification_notes.md, and branch-artifacts/node-builder.md without overwriting Python artifacts.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Forecast Reviewer', 'Verify cross-stack integration and finalize README.md.', 'gemini'),
    ],
    edges: [
      prompt06Edge('coordinator', 'python-builder'),
      prompt06Edge('coordinator', 'node-builder'),
      prompt06Edge('python-builder', 'reviewer'),
      prompt06Edge('node-builder', 'reviewer'),
    ],
  },
];

function expectedWithArtifacts(files: string[], nodeIds: string[]): string[] {
  return [...files, ...nodeIds.map(nodeId => `branch-artifacts\\${nodeId}.md`)];
}

const PROMPT_12_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'handoff-python-incidents-linear',
    title: 'Linear incident analytics handoff',
    task: 'Create a Python incident analytics package from incidents.json. Scout defines the schema, Builder creates incident_report.py and sample data, and Reviewer verifies the CLI output and README.',
    expectedFiles: expectedWithArtifacts(['incident_report.py', 'incidents.json', 'README.md'], ['scout', 'builder', 'reviewer']),
    runInstruction: 'Run python incident_report.py --input incidents.json.',
    agents: [
      prompt06Agent('scout', 'scout', 'Claude Incident Scout', 'Define the incident schema and hand off exact requirements.', 'claude'),
      prompt06Agent('builder', 'builder', 'Codex Incident Builder', 'Create the Python CLI, JSON fixture, README, and node artifact from scout context.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Incident Reviewer', 'Read scout and builder artifacts, verify files, and complete with handoff evidence.', 'gemini'),
    ],
    edges: [prompt06Edge('scout', 'builder'), prompt06Edge('builder', 'reviewer')],
  },
  {
    name: 'handoff-node-inventory-linear',
    title: 'Linear Node inventory verifier handoff',
    task: 'Create a Node.js inventory verifier that reads inventory.json, computes reorder warnings, and writes reorder_report.json. Include README and exact upstream artifact references.',
    expectedFiles: expectedWithArtifacts(['inventory.json', 'verify_inventory.mjs', 'reorder_report.json', 'README.md'], ['scout', 'builder', 'reviewer']),
    runInstruction: 'Run node verify_inventory.mjs inventory.json reorder_report.json.',
    agents: [
      prompt06Agent('scout', 'scout', 'Gemini Inventory Scout', 'Define inventory shape and reorder thresholds.', 'gemini'),
      prompt06Agent('builder', 'builder', 'OpenCode Inventory Builder', 'Create the Node verifier, fixture, generated report, README, and builder artifact.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Inventory Reviewer', 'Inspect upstream artifacts and verify handoff/session alignment.', 'codex'),
    ],
    edges: [prompt06Edge('scout', 'builder'), prompt06Edge('builder', 'reviewer')],
  },
  {
    name: 'handoff-sqlite-audit-linear',
    title: 'Linear SQLite audit handoff',
    task: 'Create a Python plus SQLite audit workflow. The package must load access_log.csv into audit.db, execute queries.sql, and write audit_findings.md with deterministic counts.',
    expectedFiles: expectedWithArtifacts(['load_access_log.py', 'access_log.csv', 'queries.sql', 'audit_findings.md', 'README.md'], ['scout', 'builder', 'reviewer']),
    runInstruction: 'Run python load_access_log.py --csv access_log.csv --db audit.db --queries queries.sql.',
    agents: [
      prompt06Agent('scout', 'scout', 'Codex Audit Scout', 'Define SQLite schema, query expectations, and acceptance checks.', 'codex'),
      prompt06Agent('builder', 'builder', 'Claude Audit Builder', 'Create loader, fixture, SQL, findings, README, and builder artifact.', 'claude'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Audit Reviewer', 'Verify downstream consumption of scout and builder artifacts.', 'opencode'),
    ],
    edges: [prompt06Edge('scout', 'builder'), prompt06Edge('builder', 'reviewer')],
  },
  {
    name: 'handoff-branch-energy-dashboard',
    title: 'Branch energy dashboard handoff',
    task: 'Create a multi-stack energy dashboard package. One branch owns Python aggregation from meter_readings.csv to energy_summary.json; the other owns dashboard.html/dashboard.js that render the summary.',
    expectedFiles: expectedWithArtifacts(['aggregate_energy.py', 'meter_readings.csv', 'energy_summary.json', 'dashboard.html', 'dashboard.js', 'README.md'], ['coordinator', 'builder-data', 'builder-ui', 'reviewer']),
    runInstruction: 'Run python aggregate_energy.py --input meter_readings.csv --output energy_summary.json, then open dashboard.html.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Energy Coordinator', 'Assign branch ownership and exact target node IDs.', 'codex'),
      prompt06Agent('builder-data', 'builder', 'Claude Data Builder', 'Create Python/CSV/JSON artifacts only.', 'claude'),
      prompt06Agent('builder-ui', 'builder', 'Gemini UI Builder', 'Create dashboard files that consume energy_summary.json only.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Energy Reviewer', 'Consume both branch artifacts and verify integrated output.', 'opencode'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-data'),
      prompt06Edge('coordinator', 'builder-ui'),
      prompt06Edge('builder-data', 'reviewer'),
      prompt06Edge('builder-ui', 'reviewer'),
    ],
  },
  {
    name: 'handoff-branch-api-contract',
    title: 'Branch API contract package handoff',
    task: 'Create an API contract package: two scout branches define request and response fixtures, Builder turns them into validate_contract.mjs, and Reviewer verifies every upstream artifact is consumed.',
    expectedFiles: expectedWithArtifacts(['request_examples.json', 'response_examples.json', 'validate_contract.mjs', 'contract_report.md', 'README.md'], ['coordinator', 'scout-request', 'scout-response', 'builder', 'reviewer']),
    runInstruction: 'Run node validate_contract.mjs request_examples.json response_examples.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Claude Contract Coordinator', 'Define branch ownership and handoff sequence.', 'claude'),
      prompt06Agent('scout-request', 'scout', 'Gemini Request Scout', 'Create request_examples.json and branch artifact.', 'gemini'),
      prompt06Agent('scout-response', 'scout', 'Codex Response Scout', 'Create response_examples.json and branch artifact.', 'codex'),
      prompt06Agent('builder', 'builder', 'OpenCode Contract Builder', 'Create validator, contract report, README, and builder artifact.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Contract Reviewer', 'Verify all upstream artifacts were read and referenced.', 'codex'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-request'),
      prompt06Edge('coordinator', 'scout-response'),
      prompt06Edge('scout-request', 'builder'),
      prompt06Edge('scout-response', 'builder'),
      prompt06Edge('builder', 'reviewer'),
    ],
  },
  {
    name: 'handoff-branch-three-builders',
    title: 'Three-branch forecast package handoff',
    task: 'Create a forecasting package with three branch owners: Python model, JSON fixture, and Node verifier. Reviewer must consume all three branch artifacts and finalize README.',
    expectedFiles: expectedWithArtifacts(['forecast_model.py', 'demand_fixture.json', 'verify_forecast.mjs', 'forecast_report.md', 'README.md'], ['coordinator', 'builder-model', 'builder-fixture', 'builder-verify', 'reviewer']),
    runInstruction: 'Run python forecast_model.py --input demand_fixture.json --output forecast.json, then node verify_forecast.mjs forecast.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Forecast Coordinator', 'Route exact builder node IDs and expected artifacts.', 'opencode'),
      prompt06Agent('builder-model', 'builder', 'Claude Forecast Model Builder', 'Create forecast_model.py and branch artifact.', 'claude'),
      prompt06Agent('builder-fixture', 'builder', 'Gemini Fixture Builder', 'Create demand_fixture.json and branch artifact.', 'gemini'),
      prompt06Agent('builder-verify', 'builder', 'Codex Verifier Builder', 'Create verify_forecast.mjs, forecast_report.md, and branch artifact.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Forecast Reviewer', 'Verify all branch outputs and README.', 'gemini'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-model'),
      prompt06Edge('coordinator', 'builder-fixture'),
      prompt06Edge('coordinator', 'builder-verify'),
      prompt06Edge('builder-model', 'reviewer'),
      prompt06Edge('builder-fixture', 'reviewer'),
      prompt06Edge('builder-verify', 'reviewer'),
    ],
  },
  {
    name: 'handoff-merge-release-notes',
    title: 'Merge release notes toolkit handoff',
    task: 'Create a release notes toolkit. Two builders own changelog.json and render_release_notes.py; Reviewer consumes both to verify release_notes.md and README.',
    expectedFiles: expectedWithArtifacts(['changelog.json', 'render_release_notes.py', 'release_notes.md', 'README.md'], ['coordinator', 'builder-data', 'builder-renderer', 'reviewer']),
    runInstruction: 'Run python render_release_notes.py --input changelog.json --output release_notes.md.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Release Coordinator', 'Define merge criteria and exact node ownership.', 'codex'),
      prompt06Agent('builder-data', 'builder', 'Claude Changelog Builder', 'Create changelog.json and branch artifact.', 'claude'),
      prompt06Agent('builder-renderer', 'builder', 'OpenCode Renderer Builder', 'Create Python renderer, README notes, and branch artifact.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Release Reviewer', 'Verify all handoffs and merged output.', 'gemini'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-data'),
      prompt06Edge('coordinator', 'builder-renderer'),
      prompt06Edge('builder-data', 'reviewer'),
      prompt06Edge('builder-renderer', 'reviewer'),
    ],
  },
  {
    name: 'handoff-merge-risk-scoring',
    title: 'Merge risk scoring package handoff',
    task: 'Create a risk scoring package where one builder owns risks.csv, another owns score_risks.py, Tester validates output, and Reviewer checks all handoffs.',
    expectedFiles: expectedWithArtifacts(['risks.csv', 'score_risks.py', 'risk_scores.json', 'test_results.md', 'README.md'], ['coordinator', 'builder-data', 'builder-score', 'tester', 'reviewer']),
    runInstruction: 'Run python score_risks.py --input risks.csv --output risk_scores.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Gemini Risk Coordinator', 'Assign data and scorer branches with exact node IDs.', 'gemini'),
      prompt06Agent('builder-data', 'builder', 'Codex Risk Data Builder', 'Create risks.csv and branch artifact.', 'codex'),
      prompt06Agent('builder-score', 'builder', 'Claude Risk Scorer Builder', 'Create score_risks.py and branch artifact.', 'claude'),
      prompt06Agent('tester', 'tester', 'OpenCode Risk Tester', 'Run or reason through scorer output and write test_results.md.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Risk Reviewer', 'Verify tester consumed both branch artifacts.', 'codex'),
    ],
    edges: [
      prompt06Edge('coordinator', 'builder-data'),
      prompt06Edge('coordinator', 'builder-score'),
      prompt06Edge('builder-data', 'tester'),
      prompt06Edge('builder-score', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'handoff-merge-geo-visualization',
    title: 'Merge geo visualization package handoff',
    task: 'Create a geo visualization package: scout branches define data and rendering requirements, builders create Python normalization and browser map table output, Tester verifies integration.',
    expectedFiles: expectedWithArtifacts(['locations.csv', 'normalize_locations.py', 'locations.json', 'map_table.html', 'map_table.js', 'test_results.md', 'README.md'], ['coordinator', 'scout-data', 'scout-ui', 'builder-data', 'builder-ui', 'tester', 'reviewer']),
    runInstruction: 'Run python normalize_locations.py --input locations.csv --output locations.json, then open map_table.html.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Claude Geo Coordinator', 'Define exact graph route and branch ownership.', 'claude'),
      prompt06Agent('scout-data', 'scout', 'Gemini Data Scout', 'Define CSV and JSON normalization checks.', 'gemini'),
      prompt06Agent('scout-ui', 'scout', 'Codex UI Scout', 'Define browser table interaction requirements.', 'codex'),
      prompt06Agent('builder-data', 'builder', 'OpenCode Data Builder', 'Create CSV, Python normalizer, JSON output, and branch artifact.', 'opencode'),
      prompt06Agent('builder-ui', 'builder', 'Claude UI Builder', 'Create HTML/JS output and branch artifact.', 'claude'),
      prompt06Agent('tester', 'tester', 'Gemini Geo Tester', 'Verify all upstream artifacts and create test_results.md.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Geo Reviewer', 'Verify handoff counts and finalize README.', 'codex'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-data'),
      prompt06Edge('coordinator', 'scout-ui'),
      prompt06Edge('scout-data', 'builder-data'),
      prompt06Edge('scout-ui', 'builder-ui'),
      prompt06Edge('builder-data', 'tester'),
      prompt06Edge('builder-ui', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'handoff-deep-six-agent',
    title: 'Deep six-agent handoff chain',
    task: 'Create a full compliance checklist generator with two scouts, two builders, tester, and reviewer. The final package must include Python generation, JSON policy inputs, Node verification, and README.',
    expectedFiles: expectedWithArtifacts(['policies.json', 'generate_checklist.py', 'checklist.md', 'verify_checklist.mjs', 'test_results.md', 'README.md'], ['coordinator', 'scout-policy', 'scout-verifier', 'builder-python', 'builder-node', 'tester', 'reviewer']),
    runInstruction: 'Run python generate_checklist.py --policies policies.json --output checklist.md, then node verify_checklist.mjs checklist.md.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Compliance Coordinator', 'Plan the six-plus-agent route and exact node handoffs.', 'codex'),
      prompt06Agent('scout-policy', 'scout', 'Claude Policy Scout', 'Define policy JSON content and acceptance checks.', 'claude'),
      prompt06Agent('scout-verifier', 'scout', 'Gemini Verifier Scout', 'Define verification expectations.', 'gemini'),
      prompt06Agent('builder-python', 'builder', 'OpenCode Python Builder', 'Create policies.json, generate_checklist.py, checklist.md, and branch artifact.', 'opencode'),
      prompt06Agent('builder-node', 'builder', 'Codex Node Builder', 'Create verify_checklist.mjs and branch artifact.', 'codex'),
      prompt06Agent('tester', 'tester', 'Claude Compliance Tester', 'Verify generated checklist and write test_results.md.', 'claude'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Compliance Reviewer', 'Confirm exact handoffs and final README.', 'gemini'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-policy'),
      prompt06Edge('coordinator', 'scout-verifier'),
      prompt06Edge('scout-policy', 'builder-python'),
      prompt06Edge('scout-verifier', 'builder-node'),
      prompt06Edge('builder-python', 'tester'),
      prompt06Edge('builder-node', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'handoff-custom-security-playbook',
    title: 'Custom security playbook handoff',
    task: 'Create a security playbook package with Python checklist generation and Markdown threat register. Branches own assets, automation, and review evidence.',
    expectedFiles: expectedWithArtifacts(['threats.json', 'build_playbook.py', 'security_playbook.md', 'review_verdict.md', 'README.md'], ['coordinator', 'asset-scout', 'automation-builder', 'security-reviewer', 'reviewer']),
    runInstruction: 'Run python build_playbook.py --threats threats.json --output security_playbook.md.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Security Coordinator', 'Define node routing and playbook ownership.', 'opencode'),
      prompt06Agent('asset-scout', 'scout', 'Codex Asset Scout', 'Create threats.json and branch artifact.', 'codex'),
      prompt06Agent('automation-builder', 'builder', 'Claude Automation Builder', 'Create build_playbook.py and generated playbook.', 'claude'),
      prompt06Agent('security-reviewer', 'security', 'Gemini Security Reviewer', 'Review generated risks and create review_verdict.md.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Final Reviewer', 'Verify all upstream artifacts and README.', 'codex'),
    ],
    edges: [
      prompt06Edge('coordinator', 'asset-scout'),
      prompt06Edge('coordinator', 'automation-builder'),
      prompt06Edge('asset-scout', 'security-reviewer'),
      prompt06Edge('automation-builder', 'security-reviewer'),
      prompt06Edge('security-reviewer', 'reviewer'),
    ],
  },
  {
    name: 'handoff-custom-test-plan',
    title: 'Custom test plan package handoff',
    task: 'Create a runnable/checkable test plan package for a CSV transformation tool. Scouts define cases, Builder creates transform_csv.py, Tester writes verification output, Reviewer validates all MCP handoffs.',
    expectedFiles: expectedWithArtifacts(['input.csv', 'expected.csv', 'transform_csv.py', 'test_plan.md', 'test_results.md', 'README.md'], ['scout-cases', 'scout-data', 'builder', 'tester', 'reviewer']),
    runInstruction: 'Run python transform_csv.py --input input.csv --output actual.csv, then compare with expected.csv.',
    agents: [
      prompt06Agent('scout-cases', 'scout', 'Claude Case Scout', 'Define transformation cases and branch artifact.', 'claude'),
      prompt06Agent('scout-data', 'scout', 'Gemini Data Scout', 'Create input.csv and expected.csv with branch artifact.', 'gemini'),
      prompt06Agent('builder', 'builder', 'Codex Transform Builder', 'Create transform_csv.py and README implementation notes.', 'codex'),
      prompt06Agent('tester', 'tester', 'OpenCode Transform Tester', 'Create test_plan.md and test_results.md from upstream outputs.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Transform Reviewer', 'Verify exact source/destination handoffs and artifact reads.', 'gemini'),
    ],
    edges: [
      prompt06Edge('scout-cases', 'builder'),
      prompt06Edge('scout-data', 'builder'),
      prompt06Edge('builder', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
];

const CLI_CYCLE: WorkflowAgentCli[] = ['codex', 'claude', 'gemini', 'opencode'];

function cycleCli(index: number): WorkflowAgentCli {
  return CLI_CYCLE[index % CLI_CYCLE.length];
}

function makePrompt13ConsecutiveWorkflows(): Prompt06WorkflowSpec[] {
  const workflows: Prompt06WorkflowSpec[] = [];
  for (let index = 1; index <= 5; index += 1) {
    const cli = cycleCli(index - 1);
    workflows.push({
      name: `simple-run-${index}`,
      title: `Simple repeated run ${index}`,
      task: `Prompt 13 simple repeated workflow run ${index}: create a fresh multi-stack health snapshot package with Python JSON generation and README. Do not reuse any previous output folder.`,
      expectedFiles: expectedWithArtifacts(['health_snapshot.py', 'snapshot.json', 'README.md'], ['agent']),
      runInstruction: 'Run python health_snapshot.py --output snapshot.json.',
      agents: [
        prompt06Agent('agent', 'builder', `${cli} Health Snapshot Builder`, 'Create fresh run-specific files and a cleanup note artifact.', cli),
      ],
      edges: [],
    });
  }

  for (let index = 1; index <= 5; index += 1) {
    const scoutCli = cycleCli(index);
    const builderCli = cycleCli(index + 1);
    workflows.push({
      name: `two-agent-run-${index}`,
      title: `Two-agent repeated run ${index}`,
      task: `Prompt 13 two-agent repeated workflow run ${index}: Scout defines telemetry CSV requirements, Builder creates a Python summarizer and generated JSON output in this fresh folder only.`,
      expectedFiles: expectedWithArtifacts(['telemetry.csv', 'summarize_telemetry.py', 'telemetry_summary.json', 'README.md'], ['scout', 'builder']),
      runInstruction: 'Run python summarize_telemetry.py --input telemetry.csv --output telemetry_summary.json.',
      agents: [
        prompt06Agent('scout', 'scout', `${scoutCli} Telemetry Scout`, 'Define telemetry columns, acceptance checks, and fresh-run cleanup notes.', scoutCli),
        prompt06Agent('builder', 'builder', `${builderCli} Telemetry Builder`, 'Create CSV, Python summarizer, JSON output, README, and builder artifact.', builderCli),
      ],
      edges: [prompt06Edge('scout', 'builder')],
    });
  }

  for (let index = 1; index <= 5; index += 1) {
    workflows.push({
      name: `branching-run-${index}`,
      title: `Branching repeated run ${index}`,
      task: `Prompt 13 branching repeated workflow run ${index}: Coordinator routes two branches. One branch creates Python processing over orders.csv; the other creates a Node verifier. Reviewer confirms no stale prior-run files were used.`,
      expectedFiles: expectedWithArtifacts(['orders.csv', 'process_orders.py', 'orders_summary.json', 'verify_orders.mjs', 'cleanup_notes.md', 'README.md'], ['coordinator', 'builder-data', 'builder-verify', 'reviewer']),
      runInstruction: 'Run python process_orders.py --input orders.csv --output orders_summary.json, then node verify_orders.mjs orders_summary.json.',
      agents: [
        prompt06Agent('coordinator', 'coordinator', 'Codex Branch Coordinator', 'Assign exact branch ownership and fresh output folder checks.', 'codex'),
        prompt06Agent('builder-data', 'builder', 'Claude Data Builder', 'Create orders.csv, process_orders.py, orders_summary.json, and branch artifact.', 'claude'),
        prompt06Agent('builder-verify', 'builder', 'Gemini Verifier Builder', 'Create verify_orders.mjs, cleanup_notes.md, and branch artifact.', 'gemini'),
        prompt06Agent('reviewer', 'reviewer', 'OpenCode Cleanup Reviewer', 'Verify both branches and note runtime/session cleanup evidence.', 'opencode'),
      ],
      edges: [
        prompt06Edge('coordinator', 'builder-data'),
        prompt06Edge('coordinator', 'builder-verify'),
        prompt06Edge('builder-data', 'reviewer'),
        prompt06Edge('builder-verify', 'reviewer'),
      ],
    });
  }

  for (let index = 1; index <= 3; index += 1) {
    workflows.push({
      name: `deep-run-${index}`,
      title: `Deep repeated run ${index}`,
      task: `Prompt 13 deep repeated workflow run ${index}: build a fresh compliance evidence package with two scouts, two builders, tester, and reviewer using Python plus Node verification.`,
      expectedFiles: expectedWithArtifacts(['controls.json', 'generate_evidence.py', 'evidence.md', 'verify_evidence.mjs', 'test_results.md', 'cleanup_notes.md', 'README.md'], ['coordinator', 'scout-controls', 'scout-verifier', 'builder-python', 'builder-node', 'tester', 'reviewer']),
      runInstruction: 'Run python generate_evidence.py --controls controls.json --output evidence.md, then node verify_evidence.mjs evidence.md.',
      agents: [
        prompt06Agent('coordinator', 'coordinator', 'Codex Deep Coordinator', 'Plan exact node IDs and cleanup expectations.', 'codex'),
        prompt06Agent('scout-controls', 'scout', 'Claude Controls Scout', 'Define controls.json requirements.', 'claude'),
        prompt06Agent('scout-verifier', 'scout', 'Gemini Verifier Scout', 'Define verification requirements.', 'gemini'),
        prompt06Agent('builder-python', 'builder', 'OpenCode Python Builder', 'Create controls.json, generate_evidence.py, evidence.md, and artifact.', 'opencode'),
        prompt06Agent('builder-node', 'builder', 'Codex Node Builder', 'Create verify_evidence.mjs and artifact.', 'codex'),
        prompt06Agent('tester', 'tester', 'Claude Deep Tester', 'Create test_results.md and cleanup notes.', 'claude'),
        prompt06Agent('reviewer', 'reviewer', 'Gemini Deep Reviewer', 'Verify all upstream artifacts and final README.', 'gemini'),
      ],
      edges: [
        prompt06Edge('coordinator', 'scout-controls'),
        prompt06Edge('coordinator', 'scout-verifier'),
        prompt06Edge('scout-controls', 'builder-python'),
        prompt06Edge('scout-verifier', 'builder-node'),
        prompt06Edge('builder-python', 'tester'),
        prompt06Edge('builder-node', 'tester'),
        prompt06Edge('tester', 'reviewer'),
      ],
    });
  }

  ['default-a', 'changed-settings-b', 'default-c'].forEach((label, index) => {
    workflows.push({
      name: `settings-${label}`,
      title: `Settings-change run ${label}`,
      task: `Prompt 13 settings-change workflow ${label}: create a fresh settings evidence package that records the logical setting mode "${label}", builds a Python config normalizer, and verifies with Node.`,
      expectedFiles: expectedWithArtifacts(['settings.json', 'normalize_settings.py', 'normalized_settings.json', 'verify_settings.mjs', 'settings_run_notes.md', 'README.md'], ['coordinator', 'builder', 'tester']),
      runInstruction: 'Run python normalize_settings.py --input settings.json --output normalized_settings.json, then node verify_settings.mjs normalized_settings.json.',
      agents: [
        prompt06Agent('coordinator', 'coordinator', 'Codex Settings Coordinator', `Record this as settings run ${label} and assign ownership.`, 'codex'),
        prompt06Agent('builder', 'builder', `${cycleCli(index + 1)} Settings Builder`, 'Create config normalizer files and branch artifact.', cycleCli(index + 1)),
        prompt06Agent('tester', 'tester', `${cycleCli(index + 2)} Settings Tester`, 'Verify settings files and write settings_run_notes.md.', cycleCli(index + 2)),
      ],
      edges: [prompt06Edge('coordinator', 'builder'), prompt06Edge('builder', 'tester')],
    });
  });

  return workflows;
}

const PROMPT_13_WORKFLOWS = makePrompt13ConsecutiveWorkflows();

const PROMPT_14_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'branch-sales-dashboard',
    title: 'Branch sales dashboard',
    task: 'Create a sales dashboard package with Python aggregation, browser rendering, and integrated README. Data and UI branches must be consumed by Reviewer.',
    expectedFiles: expectedWithArtifacts(['sales.csv', 'aggregate_sales.py', 'sales_summary.json', 'dashboard.html', 'dashboard.js', 'merge_verdict.md', 'README.md'], ['coordinator', 'builder-data', 'builder-ui', 'reviewer']),
    runInstruction: 'Run python aggregate_sales.py --input sales.csv --output sales_summary.json, then open dashboard.html.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Sales Coordinator', 'Assign data/UI branch ownership and merge criteria.', 'codex'),
      prompt06Agent('builder-data', 'builder', 'Claude Sales Data Builder', 'Create CSV, Python aggregation, JSON summary, and branch artifact.', 'claude'),
      prompt06Agent('builder-ui', 'builder', 'Gemini Sales UI Builder', 'Create dashboard HTML/JS and branch artifact.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Sales Reviewer', 'Consume both branch outputs and write merge verdict.', 'opencode'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-data'), prompt06Edge('coordinator', 'builder-ui'), prompt06Edge('builder-data', 'reviewer'), prompt06Edge('builder-ui', 'reviewer')],
  },
  {
    name: 'branch-support-triage',
    title: 'Branch support triage analyzer',
    task: 'Create a support triage analyzer where scouts define taxonomy and fixtures, Builder creates Python classifier, and Reviewer verifies merged evidence.',
    expectedFiles: expectedWithArtifacts(['tickets.json', 'triage_rules.json', 'triage.py', 'triage_report.md', 'README.md'], ['coordinator', 'scout-taxonomy', 'scout-fixtures', 'builder', 'reviewer']),
    runInstruction: 'Run python triage.py --tickets tickets.json --rules triage_rules.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Claude Triage Coordinator', 'Assign scout branches and builder merge expectations.', 'claude'),
      prompt06Agent('scout-taxonomy', 'scout', 'Gemini Taxonomy Scout', 'Create triage_rules.json and artifact.', 'gemini'),
      prompt06Agent('scout-fixtures', 'scout', 'Codex Fixture Scout', 'Create tickets.json and artifact.', 'codex'),
      prompt06Agent('builder', 'builder', 'OpenCode Triage Builder', 'Create triage.py, triage_report.md, and artifact from both scouts.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Triage Reviewer', 'Verify merged branch consumption and README.', 'codex'),
    ],
    edges: [prompt06Edge('coordinator', 'scout-taxonomy'), prompt06Edge('coordinator', 'scout-fixtures'), prompt06Edge('scout-taxonomy', 'builder'), prompt06Edge('scout-fixtures', 'builder'), prompt06Edge('builder', 'reviewer')],
  },
  {
    name: 'branch-simulation-three-builders',
    title: 'Three-builder simulation package',
    task: 'Create a small queue simulation package. Branches own config, Python simulator, and Node verifier; Tester and Reviewer consume all upstream artifacts.',
    expectedFiles: expectedWithArtifacts(['simulation_config.json', 'simulate_queue.py', 'simulation_results.json', 'verify_simulation.mjs', 'test_results.md', 'README.md'], ['scout', 'coordinator', 'builder-config', 'builder-sim', 'builder-verify', 'tester', 'reviewer']),
    runInstruction: 'Run python simulate_queue.py --config simulation_config.json --output simulation_results.json, then node verify_simulation.mjs simulation_results.json.',
    agents: [
      prompt06Agent('scout', 'scout', 'Gemini Simulation Scout', 'Define simulation acceptance checks.', 'gemini'),
      prompt06Agent('coordinator', 'coordinator', 'Codex Simulation Coordinator', 'Route three builder branches.', 'codex'),
      prompt06Agent('builder-config', 'builder', 'Claude Config Builder', 'Create simulation_config.json and artifact.', 'claude'),
      prompt06Agent('builder-sim', 'builder', 'OpenCode Simulator Builder', 'Create Python simulator and artifact.', 'opencode'),
      prompt06Agent('builder-verify', 'builder', 'Codex Verifier Builder', 'Create Node verifier and artifact.', 'codex'),
      prompt06Agent('tester', 'tester', 'Gemini Simulation Tester', 'Create test_results.md by consuming all builder outputs.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'Claude Simulation Reviewer', 'Finalize README and merge verdict.', 'claude'),
    ],
    edges: [
      prompt06Edge('scout', 'coordinator'),
      prompt06Edge('coordinator', 'builder-config'),
      prompt06Edge('coordinator', 'builder-sim'),
      prompt06Edge('coordinator', 'builder-verify'),
      prompt06Edge('builder-config', 'tester'),
      prompt06Edge('builder-sim', 'tester'),
      prompt06Edge('builder-verify', 'tester'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'branch-ab-test-two-testers',
    title: 'A/B test two-tester merge',
    task: 'Create an A/B test analysis package with two builders and two testers. Final Reviewer must reconcile both tester outputs.',
    expectedFiles: expectedWithArtifacts(['experiment.csv', 'analyze_ab.py', 'ab_summary.json', 'verify_stats.mjs', 'tester_stats.md', 'tester_product.md', 'README.md'], ['coordinator', 'builder-data', 'builder-analysis', 'tester-stats', 'tester-product', 'reviewer']),
    runInstruction: 'Run python analyze_ab.py --input experiment.csv --output ab_summary.json, then node verify_stats.mjs ab_summary.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Experiment Coordinator', 'Assign builders and tester fan-out.', 'opencode'),
      prompt06Agent('builder-data', 'builder', 'Gemini Experiment Data Builder', 'Create experiment.csv and artifact.', 'gemini'),
      prompt06Agent('builder-analysis', 'builder', 'Codex Analysis Builder', 'Create analyze_ab.py, ab_summary.json, and artifact.', 'codex'),
      prompt06Agent('tester-stats', 'tester', 'Claude Stats Tester', 'Create verify_stats.mjs and tester_stats.md.', 'claude'),
      prompt06Agent('tester-product', 'tester', 'Gemini Product Tester', 'Create tester_product.md from upstream output.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Experiment Reviewer', 'Reconcile both tester outputs in README.', 'codex'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-data'), prompt06Edge('coordinator', 'builder-analysis'), prompt06Edge('builder-data', 'tester-stats'), prompt06Edge('builder-analysis', 'tester-stats'), prompt06Edge('builder-data', 'tester-product'), prompt06Edge('builder-analysis', 'tester-product'), prompt06Edge('tester-stats', 'reviewer'), prompt06Edge('tester-product', 'reviewer')],
  },
  {
    name: 'branch-risk-quality-wide',
    title: 'Wide risk and quality merge',
    task: 'Create a release readiness package with scout, build, test, security, and review lanes. The final package must include Python checks, Node verification, security notes, and README.',
    expectedFiles: expectedWithArtifacts(['release_manifest.json', 'check_release.py', 'release_check.json', 'verify_release.mjs', 'security_notes.md', 'test_results.md', 'README.md'], ['coordinator', 'scout-risk', 'scout-test', 'builder-python', 'builder-node', 'security-reviewer', 'tester', 'reviewer']),
    runInstruction: 'Run python check_release.py --manifest release_manifest.json --output release_check.json, then node verify_release.mjs release_check.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Release Coordinator', 'Assign risk, test, build, and review lanes.', 'codex'),
      prompt06Agent('scout-risk', 'scout', 'Claude Risk Scout', 'Define security and risk checks.', 'claude'),
      prompt06Agent('scout-test', 'scout', 'Gemini Test Scout', 'Define test acceptance checks.', 'gemini'),
      prompt06Agent('builder-python', 'builder', 'OpenCode Python Builder', 'Create manifest, Python checker, JSON output, and artifact.', 'opencode'),
      prompt06Agent('builder-node', 'builder', 'Codex Node Builder', 'Create Node verifier and artifact.', 'codex'),
      prompt06Agent('security-reviewer', 'security', 'Claude Security Reviewer', 'Create security_notes.md from risk and build artifacts.', 'claude'),
      prompt06Agent('tester', 'tester', 'Gemini Release Tester', 'Create test_results.md from all upstream artifacts.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Release Reviewer', 'Finalize README with all upstream references.', 'opencode'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-risk'),
      prompt06Edge('coordinator', 'scout-test'),
      prompt06Edge('scout-risk', 'builder-python'),
      prompt06Edge('scout-test', 'builder-node'),
      prompt06Edge('builder-python', 'security-reviewer'),
      prompt06Edge('builder-node', 'tester'),
      prompt06Edge('security-reviewer', 'reviewer'),
      prompt06Edge('tester', 'reviewer'),
    ],
  },
  {
    name: 'branch-warehouse-optimizer',
    title: 'Warehouse optimizer merge',
    task: 'Create a warehouse slotting optimizer with Python optimization, JSON fixtures, and Node verification. Branches must not overwrite each other.',
    expectedFiles: expectedWithArtifacts(['warehouse.json', 'optimize_slots.py', 'slot_plan.json', 'verify_slots.mjs', 'review_notes.md', 'README.md'], ['coordinator', 'builder-fixture', 'builder-optimizer', 'builder-verifier', 'reviewer']),
    runInstruction: 'Run python optimize_slots.py --warehouse warehouse.json --output slot_plan.json, then node verify_slots.mjs slot_plan.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Gemini Warehouse Coordinator', 'Assign fixture, optimizer, and verifier branches.', 'gemini'),
      prompt06Agent('builder-fixture', 'builder', 'Claude Fixture Builder', 'Create warehouse.json and artifact.', 'claude'),
      prompt06Agent('builder-optimizer', 'builder', 'Codex Optimizer Builder', 'Create optimize_slots.py and slot_plan.json.', 'codex'),
      prompt06Agent('builder-verifier', 'builder', 'OpenCode Verifier Builder', 'Create verify_slots.mjs and artifact.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Claude Warehouse Reviewer', 'Verify all three branches and README.', 'claude'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-fixture'), prompt06Edge('coordinator', 'builder-optimizer'), prompt06Edge('coordinator', 'builder-verifier'), prompt06Edge('builder-fixture', 'reviewer'), prompt06Edge('builder-optimizer', 'reviewer'), prompt06Edge('builder-verifier', 'reviewer')],
  },
  {
    name: 'branch-usage-forecast',
    title: 'Usage forecast merge',
    task: 'Create a usage forecast package with CSV fixture, Python model, browser chart table, and QA report.',
    expectedFiles: expectedWithArtifacts(['usage.csv', 'forecast_usage.py', 'usage_forecast.json', 'chart.html', 'chart.js', 'qa_report.md', 'README.md'], ['coordinator', 'builder-data', 'builder-model', 'builder-chart', 'tester', 'reviewer']),
    runInstruction: 'Run python forecast_usage.py --input usage.csv --output usage_forecast.json, then open chart.html.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Usage Coordinator', 'Assign data/model/chart branches.', 'codex'),
      prompt06Agent('builder-data', 'builder', 'Gemini Usage Data Builder', 'Create usage.csv and artifact.', 'gemini'),
      prompt06Agent('builder-model', 'builder', 'Claude Forecast Builder', 'Create forecast_usage.py and JSON output.', 'claude'),
      prompt06Agent('builder-chart', 'builder', 'OpenCode Chart Builder', 'Create chart.html/chart.js and artifact.', 'opencode'),
      prompt06Agent('tester', 'tester', 'Codex Usage Tester', 'Create qa_report.md by consuming all builders.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Usage Reviewer', 'Finalize README with branch summary.', 'gemini'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-data'), prompt06Edge('coordinator', 'builder-model'), prompt06Edge('coordinator', 'builder-chart'), prompt06Edge('builder-data', 'tester'), prompt06Edge('builder-model', 'tester'), prompt06Edge('builder-chart', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
  {
    name: 'branch-bug-repro-package',
    title: 'Bug reproduction merge package',
    task: 'Create a bug reproduction package with fixture generator, reproducer script, expected/actual report, and review notes.',
    expectedFiles: expectedWithArtifacts(['fixture.json', 'make_fixture.py', 'reproduce_bug.py', 'actual_vs_expected.md', 'review_notes.md', 'README.md'], ['coordinator', 'builder-fixture', 'builder-repro', 'tester', 'reviewer']),
    runInstruction: 'Run python make_fixture.py --output fixture.json, then python reproduce_bug.py --fixture fixture.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Claude Bug Coordinator', 'Assign fixture and repro branch responsibilities.', 'claude'),
      prompt06Agent('builder-fixture', 'builder', 'Codex Fixture Builder', 'Create make_fixture.py and fixture.json.', 'codex'),
      prompt06Agent('builder-repro', 'builder', 'Gemini Repro Builder', 'Create reproduce_bug.py and artifact.', 'gemini'),
      prompt06Agent('tester', 'tester', 'OpenCode Bug Tester', 'Create actual_vs_expected.md from both branches.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Bug Reviewer', 'Create review_notes.md and final README.', 'codex'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-fixture'), prompt06Edge('coordinator', 'builder-repro'), prompt06Edge('builder-fixture', 'tester'), prompt06Edge('builder-repro', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
  {
    name: 'branch-docs-with-verifier',
    title: 'Documentation deliverable with verifier merge',
    task: 'Create substantial API documentation plus a Node link verifier and Python example generator. This is explicitly a documentation/report deliverable with runnable verification helpers.',
    expectedFiles: expectedWithArtifacts(['api_spec.json', 'generate_examples.py', 'API_GUIDE.md', 'verify_docs.mjs', 'doc_quality.md', 'README.md'], ['coordinator', 'builder-spec', 'builder-docs', 'builder-verifier', 'reviewer']),
    runInstruction: 'Run python generate_examples.py --spec api_spec.json, then node verify_docs.mjs API_GUIDE.md.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Docs Coordinator', 'Assign spec, docs, and verifier branch ownership.', 'opencode'),
      prompt06Agent('builder-spec', 'builder', 'Gemini API Spec Builder', 'Create api_spec.json and artifact.', 'gemini'),
      prompt06Agent('builder-docs', 'builder', 'Claude Docs Builder', 'Create generate_examples.py and API_GUIDE.md.', 'claude'),
      prompt06Agent('builder-verifier', 'builder', 'Codex Docs Verifier Builder', 'Create verify_docs.mjs and doc_quality.md.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Docs Reviewer', 'Verify all branch artifacts and README.', 'gemini'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-spec'), prompt06Edge('coordinator', 'builder-docs'), prompt06Edge('coordinator', 'builder-verifier'), prompt06Edge('builder-spec', 'reviewer'), prompt06Edge('builder-docs', 'reviewer'), prompt06Edge('builder-verifier', 'reviewer')],
  },
  {
    name: 'branch-game-sim-mini',
    title: 'Mini simulation/game merge package',
    task: 'Create a small deterministic grid simulation package with Python state generation, browser playback, test report, and final review.',
    expectedFiles: expectedWithArtifacts(['grid_config.json', 'simulate_grid.py', 'frames.json', 'playback.html', 'playback.js', 'test_results.md', 'README.md'], ['coordinator', 'builder-sim', 'builder-playback', 'tester', 'reviewer']),
    runInstruction: 'Run python simulate_grid.py --config grid_config.json --output frames.json, then open playback.html.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Grid Coordinator', 'Assign simulation and playback branches.', 'codex'),
      prompt06Agent('builder-sim', 'builder', 'Claude Simulation Builder', 'Create config, Python simulator, frames JSON, and artifact.', 'claude'),
      prompt06Agent('builder-playback', 'builder', 'Gemini Playback Builder', 'Create playback HTML/JS and artifact.', 'gemini'),
      prompt06Agent('tester', 'tester', 'OpenCode Grid Tester', 'Verify integration and write test_results.md.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Grid Reviewer', 'Finalize README and branch summary.', 'codex'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-sim'), prompt06Edge('coordinator', 'builder-playback'), prompt06Edge('builder-sim', 'tester'), prompt06Edge('builder-playback', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
];

const PROMPT_15_WORKFLOWS: Prompt06WorkflowSpec[] = [
  {
    name: 'quality-small-config-lint',
    title: 'Small config lint quality gate',
    task: 'Create a small quality-gated config lint package with a JSON config, Python linter, summary artifact, and final output artifact.',
    expectedFiles: expectedWithArtifacts(['config.json', 'lint_config.py', 'summary.md', 'final_output.md', 'README.md'], ['agent']),
    runInstruction: 'Run python lint_config.py --config config.json.',
    agents: [
      prompt06Agent('agent', 'builder', 'Codex Config Quality Builder', 'Create all small workflow required artifacts and complete only after verifying them.', 'codex'),
    ],
    edges: [],
  },
  {
    name: 'quality-small-node-budget',
    title: 'Small Node budget quality gate',
    task: 'Create a small Node.js budget checker with budget.json, check_budget.mjs, summary artifact, final output artifact, and README.',
    expectedFiles: expectedWithArtifacts(['budget.json', 'check_budget.mjs', 'summary.md', 'final_output.md', 'README.md'], ['agent']),
    runInstruction: 'Run node check_budget.mjs budget.json.',
    agents: [
      prompt06Agent('agent', 'builder', 'OpenCode Budget Quality Builder', 'Create Node budget checker and required quality artifacts.', 'opencode'),
    ],
    edges: [],
  },
  {
    name: 'quality-medium-observability',
    title: 'Medium observability quality gate',
    task: 'Create an observability report package. Scout writes context, Builder creates Python log analyzer and fixture output, Reviewer writes verdict referencing upstream artifacts.',
    expectedFiles: expectedWithArtifacts(['logs.jsonl', 'analyze_logs.py', 'observability_report.json', 'scout_context.md', 'builder_output.md', 'reviewer_verdict.md', 'README.md'], ['scout', 'builder', 'reviewer']),
    runInstruction: 'Run python analyze_logs.py --input logs.jsonl --output observability_report.json.',
    agents: [
      prompt06Agent('scout', 'scout', 'Claude Observability Scout', 'Create scout_context.md and branch artifact.', 'claude'),
      prompt06Agent('builder', 'builder', 'Gemini Observability Builder', 'Create logs fixture, analyzer, JSON report, builder_output.md, and artifact.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Observability Reviewer', 'Create reviewer_verdict.md and verify quality gate artifacts.', 'codex'),
    ],
    edges: [prompt06Edge('scout', 'builder'), prompt06Edge('builder', 'reviewer')],
  },
  {
    name: 'quality-medium-contract',
    title: 'Medium contract quality gate',
    task: 'Create a contract validation package with scout/context, builder/output, reviewer verdict, JSON fixtures, and Node validator.',
    expectedFiles: expectedWithArtifacts(['contract_context.md', 'requests.json', 'responses.json', 'validate_contract.mjs', 'builder_output.md', 'reviewer_verdict.md', 'README.md'], ['scout', 'builder', 'reviewer']),
    runInstruction: 'Run node validate_contract.mjs requests.json responses.json.',
    agents: [
      prompt06Agent('scout', 'scout', 'Gemini Contract Scout', 'Create contract_context.md and fixture requirements.', 'gemini'),
      prompt06Agent('builder', 'builder', 'Claude Contract Builder', 'Create fixtures, validator, builder_output.md, and artifact.', 'claude'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Contract Reviewer', 'Create reviewer verdict referencing scout and builder outputs.', 'opencode'),
    ],
    edges: [prompt06Edge('scout', 'builder'), prompt06Edge('builder', 'reviewer')],
  },
  {
    name: 'quality-large-supply-chain',
    title: 'Large supply-chain quality gate',
    task: 'Create a supply-chain quality package with coordinator plan, scout branches, builder branches, tester result, reviewer verdict, quality summary, Python processing, and browser report.',
    expectedFiles: expectedWithArtifacts(['coordinator_plan.md', 'suppliers.csv', 'score_suppliers.py', 'supplier_scores.json', 'supplier_dashboard.html', 'supplier_dashboard.js', 'tester_result.md', 'reviewer_final_verdict.md', 'quality_summary.md', 'README.md'], ['coordinator', 'scout-data', 'scout-risk', 'builder-score', 'builder-dashboard', 'tester', 'reviewer']),
    runInstruction: 'Run python score_suppliers.py --input suppliers.csv --output supplier_scores.json, then open supplier_dashboard.html.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Supply Coordinator', 'Create coordinator_plan.md and assign exact quality artifacts.', 'codex'),
      prompt06Agent('scout-data', 'scout', 'Claude Data Scout', 'Define supplier data requirements and branch artifact.', 'claude'),
      prompt06Agent('scout-risk', 'scout', 'Gemini Risk Scout', 'Define risk scoring requirements and branch artifact.', 'gemini'),
      prompt06Agent('builder-score', 'builder', 'OpenCode Score Builder', 'Create suppliers.csv, score_suppliers.py, supplier_scores.json, and artifact.', 'opencode'),
      prompt06Agent('builder-dashboard', 'builder', 'Codex Dashboard Builder', 'Create dashboard HTML/JS and artifact.', 'codex'),
      prompt06Agent('tester', 'tester', 'Claude Supply Tester', 'Create tester_result.md from both builder outputs.', 'claude'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Supply Reviewer', 'Create reviewer_final_verdict.md and quality_summary.md.', 'gemini'),
    ],
    edges: [prompt06Edge('coordinator', 'scout-data'), prompt06Edge('coordinator', 'scout-risk'), prompt06Edge('scout-data', 'builder-score'), prompt06Edge('scout-risk', 'builder-score'), prompt06Edge('scout-data', 'builder-dashboard'), prompt06Edge('builder-score', 'tester'), prompt06Edge('builder-dashboard', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
  {
    name: 'quality-large-release-gate',
    title: 'Large release readiness quality gate',
    task: 'Create a release readiness package with coordinator plan, three scouts, three builders, two testers, final verdict, and quality summary. Include Python and Node verification.',
    expectedFiles: expectedWithArtifacts(['coordinator_plan.md', 'release_inputs.json', 'build_release_report.py', 'release_report.md', 'verify_release.mjs', 'tester_functional.md', 'tester_security.md', 'reviewer_final_verdict.md', 'quality_summary.md', 'README.md'], ['coordinator', 'scout-product', 'scout-security', 'scout-test', 'builder-report', 'builder-verifier', 'builder-docs', 'tester-functional', 'tester-security', 'reviewer']),
    runInstruction: 'Run python build_release_report.py --input release_inputs.json --output release_report.md, then node verify_release.mjs release_report.md.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Release Coordinator', 'Create coordinator_plan.md and assign quality-gate artifacts.', 'opencode'),
      prompt06Agent('scout-product', 'scout', 'Codex Product Scout', 'Define product checks and artifact.', 'codex'),
      prompt06Agent('scout-security', 'scout', 'Claude Security Scout', 'Define security checks and artifact.', 'claude'),
      prompt06Agent('scout-test', 'scout', 'Gemini Test Scout', 'Define test checks and artifact.', 'gemini'),
      prompt06Agent('builder-report', 'builder', 'Codex Report Builder', 'Create release inputs, Python report builder, release_report.md, and artifact.', 'codex'),
      prompt06Agent('builder-verifier', 'builder', 'OpenCode Verifier Builder', 'Create verify_release.mjs and artifact.', 'opencode'),
      prompt06Agent('builder-docs', 'builder', 'Claude Docs Builder', 'Create README sections and artifact.', 'claude'),
      prompt06Agent('tester-functional', 'tester', 'Gemini Functional Tester', 'Create tester_functional.md from builder outputs.', 'gemini'),
      prompt06Agent('tester-security', 'tester', 'Codex Security Tester', 'Create tester_security.md from security and builder outputs.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Claude Release Reviewer', 'Create final verdict and quality summary referencing all upstream artifacts.', 'claude'),
    ],
    edges: [
      prompt06Edge('coordinator', 'scout-product'),
      prompt06Edge('coordinator', 'scout-security'),
      prompt06Edge('coordinator', 'scout-test'),
      prompt06Edge('scout-product', 'builder-report'),
      prompt06Edge('scout-security', 'builder-verifier'),
      prompt06Edge('scout-test', 'builder-docs'),
      prompt06Edge('builder-report', 'tester-functional'),
      prompt06Edge('builder-verifier', 'tester-security'),
      prompt06Edge('builder-docs', 'tester-functional'),
      prompt06Edge('tester-functional', 'reviewer'),
      prompt06Edge('tester-security', 'reviewer'),
    ],
  },
  {
    name: 'quality-custom-mobile-data',
    title: 'Custom mobile data quality gate',
    task: 'Create a mobile telemetry data quality package with Python normalization, JSON output, browser inspection table, tester result, and quality summary.',
    expectedFiles: expectedWithArtifacts(['mobile_events.csv', 'normalize_mobile.py', 'mobile_events.json', 'inspection.html', 'inspection.js', 'tester_result.md', 'reviewer_final_verdict.md', 'quality_summary.md', 'README.md'], ['coordinator', 'builder-data', 'builder-ui', 'tester', 'reviewer']),
    runInstruction: 'Run python normalize_mobile.py --input mobile_events.csv --output mobile_events.json, then open inspection.html.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Gemini Mobile Coordinator', 'Create plan artifact and assign data/UI branches.', 'gemini'),
      prompt06Agent('builder-data', 'builder', 'Claude Mobile Data Builder', 'Create CSV, Python normalizer, JSON, and artifact.', 'claude'),
      prompt06Agent('builder-ui', 'builder', 'Codex Mobile UI Builder', 'Create inspection HTML/JS and artifact.', 'codex'),
      prompt06Agent('tester', 'tester', 'OpenCode Mobile Tester', 'Create tester_result.md by consuming both branches.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Mobile Reviewer', 'Create verdict and quality summary.', 'gemini'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-data'), prompt06Edge('coordinator', 'builder-ui'), prompt06Edge('builder-data', 'tester'), prompt06Edge('builder-ui', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
  {
    name: 'quality-custom-pricing',
    title: 'Custom pricing quality gate',
    task: 'Create a pricing scenario package with Python scenario evaluation, Node verifier, reviewer verdict, and quality summary.',
    expectedFiles: expectedWithArtifacts(['pricing_scenarios.json', 'evaluate_pricing.py', 'pricing_results.json', 'verify_pricing.mjs', 'tester_result.md', 'reviewer_final_verdict.md', 'quality_summary.md', 'README.md'], ['coordinator', 'builder-python', 'builder-node', 'tester', 'reviewer']),
    runInstruction: 'Run python evaluate_pricing.py --input pricing_scenarios.json --output pricing_results.json, then node verify_pricing.mjs pricing_results.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Pricing Coordinator', 'Plan artifacts and assign Python/Node builders.', 'codex'),
      prompt06Agent('builder-python', 'builder', 'Gemini Pricing Python Builder', 'Create scenarios, Python evaluator, JSON output, and artifact.', 'gemini'),
      prompt06Agent('builder-node', 'builder', 'Claude Pricing Node Builder', 'Create Node verifier and artifact.', 'claude'),
      prompt06Agent('tester', 'tester', 'OpenCode Pricing Tester', 'Create tester_result.md from both builders.', 'opencode'),
      prompt06Agent('reviewer', 'reviewer', 'Codex Pricing Reviewer', 'Create final verdict and quality summary.', 'codex'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-python'), prompt06Edge('coordinator', 'builder-node'), prompt06Edge('builder-python', 'tester'), prompt06Edge('builder-node', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
  {
    name: 'quality-custom-accessibility',
    title: 'Custom accessibility audit quality gate',
    task: 'Create an accessibility audit package with HTML sample, Node audit script, findings report, final verdict, and quality summary.',
    expectedFiles: expectedWithArtifacts(['sample_page.html', 'audit_accessibility.mjs', 'accessibility_findings.json', 'tester_result.md', 'reviewer_final_verdict.md', 'quality_summary.md', 'README.md'], ['scout', 'builder', 'tester', 'reviewer']),
    runInstruction: 'Run node audit_accessibility.mjs sample_page.html accessibility_findings.json.',
    agents: [
      prompt06Agent('scout', 'scout', 'Claude Accessibility Scout', 'Define accessibility checks and branch artifact.', 'claude'),
      prompt06Agent('builder', 'builder', 'Codex Accessibility Builder', 'Create sample page, audit script, findings JSON, and artifact.', 'codex'),
      prompt06Agent('tester', 'tester', 'Gemini Accessibility Tester', 'Create tester_result.md from audit output.', 'gemini'),
      prompt06Agent('reviewer', 'reviewer', 'OpenCode Accessibility Reviewer', 'Create final verdict and quality summary.', 'opencode'),
    ],
    edges: [prompt06Edge('scout', 'builder'), prompt06Edge('builder', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
  {
    name: 'quality-custom-data-contract',
    title: 'Custom data contract quality gate',
    task: 'Create a data contract quality package with JSON schema, Python fixture generator, Node contract checker, tester result, verdict, and quality summary.',
    expectedFiles: expectedWithArtifacts(['schema.json', 'generate_fixtures.py', 'records.json', 'check_contract.mjs', 'tester_result.md', 'reviewer_final_verdict.md', 'quality_summary.md', 'README.md'], ['coordinator', 'builder-fixtures', 'builder-checker', 'tester', 'reviewer']),
    runInstruction: 'Run python generate_fixtures.py --schema schema.json --output records.json, then node check_contract.mjs schema.json records.json.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'OpenCode Contract Coordinator', 'Create coordinator plan and assign contract branches.', 'opencode'),
      prompt06Agent('builder-fixtures', 'builder', 'Claude Fixture Builder', 'Create schema, fixture generator, records, and artifact.', 'claude'),
      prompt06Agent('builder-checker', 'builder', 'Gemini Checker Builder', 'Create Node contract checker and artifact.', 'gemini'),
      prompt06Agent('tester', 'tester', 'Codex Contract Tester', 'Create tester_result.md by consuming both branches.', 'codex'),
      prompt06Agent('reviewer', 'reviewer', 'Claude Contract Reviewer', 'Create final verdict and quality summary.', 'claude'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-fixtures'), prompt06Edge('coordinator', 'builder-checker'), prompt06Edge('builder-fixtures', 'tester'), prompt06Edge('builder-checker', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
  {
    name: 'quality-custom-ops-runbook',
    title: 'Custom ops runbook quality gate',
    task: 'Create an operations runbook package with Python incident generator, Markdown runbook, Node verifier, tester result, final verdict, and quality summary.',
    expectedFiles: expectedWithArtifacts(['incident_inputs.json', 'generate_runbook.py', 'RUNBOOK.md', 'verify_runbook.mjs', 'tester_result.md', 'reviewer_final_verdict.md', 'quality_summary.md', 'README.md'], ['coordinator', 'builder-runbook', 'builder-verifier', 'tester', 'reviewer']),
    runInstruction: 'Run python generate_runbook.py --input incident_inputs.json --output RUNBOOK.md, then node verify_runbook.mjs RUNBOOK.md.',
    agents: [
      prompt06Agent('coordinator', 'coordinator', 'Codex Runbook Coordinator', 'Create coordinator plan and assign runbook/verifier branches.', 'codex'),
      prompt06Agent('builder-runbook', 'builder', 'Gemini Runbook Builder', 'Create inputs, Python generator, RUNBOOK.md, and artifact.', 'gemini'),
      prompt06Agent('builder-verifier', 'builder', 'OpenCode Verifier Builder', 'Create verify_runbook.mjs and artifact.', 'opencode'),
      prompt06Agent('tester', 'tester', 'Claude Runbook Tester', 'Create tester_result.md by consuming both branches.', 'claude'),
      prompt06Agent('reviewer', 'reviewer', 'Gemini Runbook Reviewer', 'Create final verdict and quality summary.', 'gemini'),
    ],
    edges: [prompt06Edge('coordinator', 'builder-runbook'), prompt06Edge('coordinator', 'builder-verifier'), prompt06Edge('builder-runbook', 'tester'), prompt06Edge('builder-verifier', 'tester'), prompt06Edge('tester', 'reviewer')],
  },
];

function prompt06Agent(
  id: string,
  roleId: string,
  title: string,
  responsibility: string,
  cli?: WorkflowAgentCli,
): Prompt06AgentSpec {
  return { id, roleId, title, responsibility, cli };
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
  const startNodeIds = spec.startNodeIds ?? layers[0];
  const branchMergeInstructions = promptNumber === '05'
    ? [
        'Prompt 05 branch/merge requirements: every branch producer must create a distinct artifact under branch-artifacts named for its node, and merge/review agents must inspect all upstream branch artifacts before completing.',
        'The final README must summarize which branch contributions were consumed.',
        'No branch output should overwrite another branch output.',
        'Keep branch artifacts concise and finish the MCP handoff/completion immediately after the required file and branch checks pass.',
      ]
    : [];
  const nodeTreeInstructions = promptNumber === '04'
    ? [
        `Prompt 04 NodeTree Mission Control operations under test: ${(spec.nodeTreeOperations ?? []).join(', ') || 'graph creation and output linking'}.`,
        'Treat this as a NodeTree-authored graph run: preserve branch ownership, consume upstream context, and mention which concrete output files your node produced or verified when completing.',
        'The final reviewer must make sure README lists the concrete files and local verification command so output linking can point to user-facing files, not only node notes.',
      ]
    : [];
  const prompt07Instructions = promptNumber === '07'
    ? [
        'Prompt 07 artifact organization requirements: each agent must create or verify a distinct branch artifact under branch-artifacts using its exact node ID in the filename.',
        'Final outputs must be concrete runnable/openable/readable project files, not only final.md or result.md notes.',
        'The final reviewer must list every user-facing output path in README.md and verify that no output is outside docks-testing.',
      ]
    : [];
  const prompt08Instructions = promptNumber === '08'
    ? [
        'Prompt 08 failure recovery requirements: if your role is the controlled failure probe, intentionally complete the node with outcome "failure" after writing concise failure evidence.',
        'Recovery and review nodes must inspect the failed upstream context, produce recovery artifacts, and clearly distinguish expected failure behavior from broken app behavior.',
        'Do not treat the expected failed node as a reason to stop the workflow; on_failure edges should carry the recovery path.',
      ]
    : [];
  const prompt09Instructions = promptNumber === '09'
    ? [
        'Prompt 09 terminal visibility requirements: produce visible terminal output during verification, including a bounded verbose run of the generated CLI or script.',
        'Keep output large enough to exercise PTY buffering but bounded enough to avoid UI freezes or oversized reports.',
        'The final reviewer must note terminal output visibility, tail separation, and replay/remount observations available from the run evidence.',
      ]
    : [];
  const prompt10Instructions = promptNumber === '10'
    ? [
        `Prompt 10 NodeTree Mission Control operations under test: ${(spec.nodeTreeOperations ?? []).join(', ') || 'create, edit, branch, merge, run, status, output link'}.`,
        'Treat this as a NodeTree-controlled mission model run: preserve exact node IDs, branch ownership, status evidence, and concrete output links.',
        'The final reviewer must ensure README points to concrete deliverable files and summarizes NodeTree operation coverage.',
      ]
    : [];
  const prompt11Instructions = promptNumber === '11'
    ? [
        'Prompt 11 planner/template stress requirements: treat this workflow as generated from a planner/template DAG, verify the DAG shape through exact node IDs, and produce a concrete project deliverable.',
        'Every multi-agent branch must preserve file ownership and write branch-artifacts for node-level evidence when those files are listed.',
      ]
    : [];
  const prompt12Instructions = promptNumber === '12'
    ? [
        'Prompt 12 MCP handoff reliability requirements: every agent must fetch task details, preserve exact source and target node IDs in handoffs/completions, and write its listed branch artifact before completing.',
        'Downstream agents must read upstream files and branch-artifacts, then mention which upstream node artifacts they consumed.',
      ]
    : [];
  const prompt13Instructions = promptNumber === '13'
    ? [
        'Prompt 13 consecutive-run requirements: this execution must write a fresh run-specific deliverable in the provided output directory and must not reuse files from earlier workflow folders.',
        'Agents should note runtime/session cleanup observations in branch-artifacts when those files are listed.',
      ]
    : [];
  const prompt14Instructions = promptNumber === '14'
    ? [
        'Prompt 14 branch/merge requirements: every branch must produce a distinct artifact, merge/review agents must reference all upstream artifacts, and no branch should overwrite another branch output.',
        'Handoff and completion summaries must name exact source and destination node IDs.',
      ]
    : [];
  const prompt15Instructions = promptNumber === '15'
    ? [
        'Prompt 15 quality-gate requirements: all expected gate artifacts must exist before success, quality/reviewer output must reference upstream artifacts, and each workflow needs a concrete integrated deliverable.',
        'At least one non-markdown runnable/openable source file must be present unless this specific task is explicitly a documentation/report deliverable.',
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
    ...nodeTreeInstructions,
    ...prompt07Instructions,
    ...prompt08Instructions,
    ...prompt09Instructions,
    ...prompt10Instructions,
    ...prompt11Instructions,
    ...prompt12Instructions,
    ...prompt13Instructions,
    ...prompt14Instructions,
    ...prompt15Instructions,
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
      startNodeIds,
      executionLayers: layers,
      authoringMode: 'graph',
      presetId: `live:${suiteSlug}:${spec.name}`,
      runVersion: 1,
    },
    nodes: spec.agents.map((agent, index) => {
      const cli = agent.cli ?? 'codex';
      return {
        id: agent.id,
        roleId: agent.roleId,
        instructionOverride: [
          `You are a live Terminal Docks Prompt ${promptNumber} ${cli} workflow agent.`,
        `Role: ${agent.title}.`,
        `Responsibility: ${agent.responsibility}`,
        `Output directory: ${outputDir}.`,
        `Expected files for the overall workflow: ${spec.expectedFiles.join(', ')}.`,
        'Do not write outside the output directory.',
        promptNumber === '05'
          ? `If you are producing branch work, write a distinct artifact under branch-artifacts/${agent.id}.md or a similarly named source fragment. If you are merging, testing, or reviewing, inspect upstream context and branch-artifacts before completing.`
          : '',
        promptNumber === '07'
          ? `Write or verify an artifact under branch-artifacts/${agent.id}.md, and keep all project outputs inside the configured output directory.`
          : '',
        promptNumber === '08'
          ? `This is a failure-recovery workflow. Follow your responsibility exactly; controlled failure nodes should call complete_task with outcome "failure", while recovery/review nodes should consume that failure context and complete normally.`
          : '',
        promptNumber === '09'
          ? 'Make terminal-visible progress during verification, but keep generated output bounded and do not spam unbounded logs.'
          : '',
        promptNumber === '10'
          ? `NodeTree operations under test: ${(spec.nodeTreeOperations ?? []).join(', ') || 'graph run and output linking'}. Mention concrete output files and status evidence when completing.`
          : '',
        ['11', '12', '13', '14', '15'].includes(promptNumber)
          ? `If branch-artifacts/${agent.id}.md is listed or appropriate for your role, write or verify that node-specific artifact. Preserve exact node IDs in handoffs and completion summaries.`
          : '',
        promptNumber === '15'
          ? 'Treat missing expected files as a failed quality gate; reviewers/testers must verify the required artifacts before completing successfully.'
          : '',
        'Keep your contribution compact and finish quickly once your role is satisfied.',
        'Avoid screenshots, preview images, browser automation, and extra generated assets unless your named responsibility is testing and file checks are insufficient.',
        'Complete your node with complete_task or handoff_task after your contribution or verification is done.',
        'Do not end with only a normal final answer; a successful MCP completion/handoff tool call is required.',
        ].join(' '),
        terminal: {
          terminalId: `live-${suiteSlug}-${suffix}-${index + 1}-${agent.id}`,
          terminalTitle: `${agent.title} (${spec.name})`,
          cli,
          model: liveWorkflowModelForCli(cli),
          yolo: true,
          executionMode: 'interactive_pty',
          paneId: `pane-live-${suiteSlug}-${suffix}-${index + 1}`,
          reusedExisting: false,
        },
      };
    }),
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
  const missionCliSequence = mission.nodes.map(node => node.terminal.cli);
  const missionCliLabel = missionCliSequence.join('>');
  const screenwatchDir = joinWindowsPath(options.screenwatchDir, mission.missionId);
  const screenwatch = new UiScreenwatchController(
    options.screenwatchEnabled,
    screenwatchDir,
    mission.missionId,
    options.screenwatchIntervalMs,
  );
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
    screenwatch.start();
    await withTimeout(
      invoke('seed_mission_to_db', { missionId: mission.missionId, graph: mission }),
      10_000,
      undefined,
    );
    await withTimeout(missionOrchestrator.launchMission(mission), 30_000, undefined);

    const deadline = Date.now() + options.workflowTimeoutMs * Math.max(1, mission.nodes.length);
    while (Date.now() < deadline) {
      const run = workflowOrchestrator.getRun(mission.missionId);
      terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
      if (Object.values(terminalTails).some(isRateLimitText)) {
        await screenwatch.capture('rate-limited');
        const validation = await validateOutputFiles(outputDir, spec.expectedFiles);
        const error = 'Provider rate limit detected in terminal output.';
        return {
          cli: missionCliLabel,
          cliSequence: missionCliSequence,
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
          uiScreenwatch: screenwatch.summary(),
          nodeFinalStates: buildNodeFinalStates(mission.missionId),
          error,
        };
      }
      if (run?.status === 'completed') {
        await screenwatch.capture('completed');
        const validation = await validateOutputFiles(outputDir, spec.expectedFiles);
        const failures = Object.values(run.nodeStates).filter(node => node.state === 'failed');
        const error = failures.map(node => `${node.nodeId}: failed`).join('; ') || (validation.missingFiles.length ? `Missing files: ${validation.missingFiles.join(', ')}` : undefined);
        const expectedFailureRecovered = Boolean(spec.expectedFailure && failures.length && validation.missingFiles.length === 0);
        const isSuccessfulResult = expectedFailureRecovered || (!failures.length && validation.missingFiles.length === 0);
        return {
          cli: missionCliLabel,
          cliSequence: missionCliSequence,
          roleSequence: mission.nodes.map(node => node.roleId),
          phase: 'large',
          taskType: 'handoff',
          missionId: mission.missionId,
          status: isSuccessfulResult ? 'passed' : 'failed',
          outcome: isSuccessfulResult ? 'success' : 'failure',
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
          uiScreenwatch: screenwatch.summary(),
          nodeFinalStates: buildNodeFinalStates(mission.missionId),
          error: expectedFailureRecovered ? `Expected failure recovered: ${error}` : error,
        };
      }
      const failedEvent = orchestratorEvents.find(event => event.type === 'node_failed');
      const hasFailureRecoveryEdge = failedEvent && spec.edges.some(edge =>
        edge.fromNodeId === failedEvent.nodeId && edge.condition === 'on_failure',
      );
      if (failedEvent && !hasFailureRecoveryEdge) break;
      await sleep(1_000);
    }

    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    const failedEvent = orchestratorEvents.find(event => event.type === 'node_failed');
    await screenwatch.capture(failedEvent ? 'failed' : 'timeout');
    const validation = await validateOutputFiles(outputDir, spec.expectedFiles);
    const error = typeof failedEvent?.error === 'string' ? failedEvent.error : undefined;
    return {
      cli: missionCliLabel,
      cliSequence: missionCliSequence,
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
      uiScreenwatch: screenwatch.summary(),
      nodeFinalStates: buildNodeFinalStates(mission.missionId),
      error,
    };
  } catch (error) {
    terminalTails = await collectTerminalTails(mission.nodes.map(node => node.terminal.terminalId));
    await screenwatch.capture('error');
    const validation = await validateOutputFiles(outputDir, spec.expectedFiles);
    const message = error instanceof Error ? error.message : String(error);
    return {
      cli: missionCliLabel,
      cliSequence: missionCliSequence,
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
      uiScreenwatch: screenwatch.summary(),
      nodeFinalStates: buildNodeFinalStates(mission.missionId),
      error: message,
    };
  } finally {
    await screenwatch.stop('cleanup');
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
    note: 'Runs Prompt 05 through the app-side MissionOrchestrator / WorkflowOrchestrator / RuntimeManager path with interactive_pty mixed-CLI branching and merge nodes.',
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

async function runPrompt05MidMixedCliHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const selectedWorkflows = selectPromptWorkflows(PROMPT_05_MID_MIXED_CLI_WORKFLOWS);
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'prompt05_branching_merge_mid_mixed_cli',
    workflowFilter: LIVE_WORKFLOW_FILTER ?? null,
    executionPath: 'live_app_harness',
    liveRuntimeLaunched: true,
    note: 'Runs a bounded five-workflow mixed-CLI Prompt 05 branch/merge suite through MissionOrchestrator, WorkflowOrchestrator, RuntimeManager, and interactive PTY sessions.',
    workflows: selectedWorkflows.map(({ spec, index }) => ({
      index: index + 1,
      name: spec.name,
      title: spec.title,
      agentCount: spec.agents.length,
      clis: spec.agents.map(agent => agent.cli ?? 'codex'),
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
      'branching-merge-mid',
      '05',
      'prompt05-mid',
    );
    report.results.push(result);
    await writeReport(options.outputPath, report);
    if (selectedIndex < selectedWorkflows.length - 1) {
      await waitForPrompt06McpHealth('Prompt 05 mid mixed-CLI');
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

async function runOpenCodePostAckReproducerHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const selectedWorkflows = selectPromptWorkflows(OPENCODE_POST_ACK_REPRO_WORKFLOWS);
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'opencode_post_ack_reproducer',
    workflowFilter: LIVE_WORKFLOW_FILTER ?? null,
    executionPath: 'live_app_harness',
    liveRuntimeLaunched: true,
    note: 'Minimal live reproducers for OpenCode post_ack_no_mcp_completion. Runs small OpenCode interactive PTY workflows through MissionOrchestrator, WorkflowOrchestrator, RuntimeManager, and Terminal Docks MCP.',
    workflows: selectedWorkflows.map(({ spec, index }) => ({
      index: index + 1,
      name: spec.name,
      title: spec.title,
      agentCount: spec.agents.length,
      clis: spec.agents.map(agent => agent.cli ?? 'codex'),
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
      'opencode-post-ack-repro',
      'OpenCode post-ACK',
      'opencode-post-ack',
    );
    report.results.push(result);
    await writeReport(options.outputPath, report);
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

async function runPrompt04NodeTreeMissionControlHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const selectedWorkflows = selectPromptWorkflows(PROMPT_04_WORKFLOWS);
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'prompt04_nodetree_mission_control',
    workflowFilter: LIVE_WORKFLOW_FILTER ?? null,
    executionPath: 'live_app_harness',
    liveRuntimeLaunched: true,
    note: 'Runs Prompt 04 through the app-side NodeTree-like graph mission model, MissionOrchestrator, WorkflowOrchestrator, RuntimeManager, and interactive_pty Codex nodes.',
    nodeTreeOperationsTested: Array.from(new Set(PROMPT_04_WORKFLOWS.flatMap(spec => spec.nodeTreeOperations ?? []))),
    workflows: selectedWorkflows.map(({ spec, index }) => ({
      index: index + 1,
      name: spec.name,
      title: spec.title,
      agentCount: spec.agents.length,
      expectedFiles: spec.expectedFiles,
      runInstruction: spec.runInstruction,
      startNodeIds: spec.startNodeIds ?? null,
      nodeTreeOperations: spec.nodeTreeOperations ?? [],
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
      'nodetree-mission-control',
      '04',
      'prompt04',
    );
    report.results.push(result);
    await writeReport(options.outputPath, report);
    if (selectedIndex < selectedWorkflows.length - 1) {
      await waitForPrompt06McpHealth('Prompt 04');
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

async function runPrompt0710CappedHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const selectedWorkflows = selectPromptWorkflows(PROMPT_07_10_CAPPED_WORKFLOWS);
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'prompt07_10_capped',
    workflowFilter: LIVE_WORKFLOW_FILTER ?? null,
    executionPath: 'live_app_harness',
    liveRuntimeLaunched: true,
    note: 'Runs prompts 07-10 as a bounded four-workflow live app/runtime suite per operator cap. Each workflow uses mixed Codex, Claude, Gemini, and OpenCode interactive PTY nodes and produces concrete deliverables under the prompt-specific docks-testing root.',
    workflows: selectedWorkflows.map(({ spec, index }) => ({
      index: index + 1,
      promptNumber: spec.promptNumber,
      suiteDirName: spec.suiteDirName,
      name: spec.name,
      title: spec.title,
      agentCount: spec.agents.length,
      clis: spec.agents.map(agent => agent.cli ?? 'codex'),
      expectedFailure: spec.expectedFailure ?? false,
      expectedFiles: spec.expectedFiles,
      runInstruction: spec.runInstruction,
      nodeTreeOperations: spec.nodeTreeOperations ?? [],
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
      spec.suiteDirName ?? `prompt-${spec.promptNumber ?? '07-10'}`,
      spec.promptNumber ?? '07-10',
      spec.suiteSlug ?? 'prompt07-10',
    );
    report.results.push(result);
    await writeReport(options.outputPath, report);
    if (selectedIndex < selectedWorkflows.length - 1) {
      await waitForPrompt06McpHealth(`Prompt ${spec.promptNumber ?? '07-10'}`);
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

async function runPrompt11MixedCliSmokeHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const selectedWorkflows = selectPromptWorkflows(PROMPT_11_WORKFLOWS);
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'prompt11_mixed_cli_smoke',
    workflowFilter: LIVE_WORKFLOW_FILTER ?? null,
    executionPath: 'live_app_harness',
    liveRuntimeLaunched: true,
    note: 'Runs Prompt 11 through MissionOrchestrator / WorkflowOrchestrator / RuntimeManager with mixed Claude, Gemini, OpenCode, and Codex interactive_pty nodes per the operator override.',
    workflows: selectedWorkflows.map(({ spec, index }) => ({
      index: index + 1,
      name: spec.name,
      title: spec.title,
      agentCount: spec.agents.length,
      clis: spec.agents.map(agent => agent.cli ?? 'codex'),
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
      'smoke',
      '11',
      'prompt11',
    );
    report.results.push(result);
    await writeReport(options.outputPath, report);
    if (selectedIndex < selectedWorkflows.length - 1) {
      await waitForPrompt06McpHealth('Prompt 11');
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

async function runPromptSpecSuiteHarness(
  options: LiveWorkflowHarnessOptions,
  workflows: Prompt06WorkflowSpec[],
  suiteName: string,
  promptNumber: string,
  suiteDirName: string,
  suiteSlug: string,
  note: string,
): Promise<void> {
  const selectedWorkflows = selectPromptWorkflows(workflows);
  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName,
    promptNumber,
    workflowFilter: LIVE_WORKFLOW_FILTER ?? null,
    executionPath: 'live_app_harness',
    liveRuntimeLaunched: true,
    note,
    workflows: selectedWorkflows.map(({ spec, index }) => ({
      index: index + 1,
      name: spec.name,
      title: spec.title,
      agentCount: spec.agents.length,
      clis: spec.agents.map(agent => agent.cli ?? 'codex'),
      expectedFailure: spec.expectedFailure ?? false,
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
      spec.suiteDirName ?? suiteDirName,
      spec.promptNumber ?? promptNumber,
      spec.suiteSlug ?? suiteSlug,
    );
    report.results.push(result);
    await writeReport(options.outputPath, report);
    if (selectedIndex < selectedWorkflows.length - 1) {
      await waitForPrompt06McpHealth(`Prompt ${promptNumber}`);
    }
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

function buildPrompt05ManualDefinition(name: string, nodeIds: string[]) {
  const now = new Date().toISOString();
  return {
    id: `prompt05-${name}`,
    name: `Prompt 05 ${name}`,
    createdAt: now,
    updatedAt: now,
    nodes: [
      {
        id: `${name}-task`,
        kind: 'task',
        roleId: 'task',
        config: {
          prompt: `Prompt 05 manual intervention workflow ${name}.`,
          mode: 'build',
        },
      },
      ...nodeIds.map((nodeId, index) => ({
        id: nodeId,
        kind: 'agent',
        roleId: index === 0 ? 'builder' : 'reviewer',
        config: {
          cli: 'codex',
          executionMode: 'manual',
          terminalId: `prompt05-${name}-${nodeId}`,
          profileId: index === 0 ? 'builder' : 'reviewer',
          retryPolicy: { maxRetries: 1, retryOn: ['unknown'], backoffMs: 0 },
        },
      })),
    ],
    edges: [
      { fromNodeId: `${name}-task`, toNodeId: nodeIds[0], condition: 'always' },
      ...nodeIds.slice(1).map(nodeId => ({ fromNodeId: nodeIds[0], toNodeId: nodeId, condition: 'on_success' })),
    ],
  };
}

async function waitForPrompt05State(missionId: string, nodeId: string, states: string[], timeoutMs = 8_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const run = workflowOrchestrator.getRun(missionId);
    const state = run?.nodeStates[nodeId]?.state;
    if (state && states.includes(state)) return state;
    await sleep(100);
  }
  const run = workflowOrchestrator.getRun(missionId);
  throw new Error(`Timed out waiting for ${nodeId} in ${missionId}; last state=${run?.nodeStates[nodeId]?.state ?? '<missing>'}`);
}

async function runPrompt05ManualWorkflow(
  index: number,
  name: string,
  action: (missionId: string, primaryNodeId: string, extraNodeId: string | null) => Promise<Record<string, unknown>>,
  options: LiveWorkflowHarnessOptions,
) {
  const outputDir = await ensureWorkflowDirectory(
    joinWindowsPath(options.repoRoot, 'docks-testing', 'manual-intervention'),
    `workflow-${String(index).padStart(2, '0')}-${name}-${Date.now().toString(36)}`,
  );
  const primaryNodeId = `${name}-agent`;
  const extraNodeId = name.includes('cancel') ? `${name}-reviewer` : null;
  const definition = buildPrompt05ManualDefinition(name, extraNodeId ? [primaryNodeId, extraNodeId] : [primaryNodeId]) as any;
  const missionId = `live-prompt05-manual-${name}-${Date.now().toString(36)}`;
  const startedAt = Date.now();
  const sessionEvents: Array<Record<string, unknown>> = [];
  const runtimeUnsub = runtimeManager.subscribe(event => {
    if ('missionId' in event && event.missionId !== missionId) return;
    sessionEvents.push(compactEvent({ ...event, at: Date.now() }));
  });

  try {
    const run = workflowOrchestrator.startRun(definition, { runId: missionId, workspaceDir: outputDir });
    await waitForPrompt05State(missionId, primaryNodeId, ['manual_takeover']);
    const actionResult = await action(missionId, primaryNodeId, extraNodeId);
    const finalRun = workflowOrchestrator.getRun(missionId) ?? run;
    return {
      index,
      name,
      missionId,
      status: 'passed',
      durationMs: Date.now() - startedAt,
      outputDir,
      actionResult,
      nodeFinalStates: Object.values(finalRun.nodeStates).map((nodeState: any) => ({
        nodeId: nodeState.nodeId,
        state: nodeState.state,
        attempt: nodeState.attempt,
      })),
      sessionEvents,
    };
  } catch (error) {
    const finalRun = workflowOrchestrator.getRun(missionId);
    return {
      index,
      name,
      missionId,
      status: 'failed',
      durationMs: Date.now() - startedAt,
      outputDir,
      error: error instanceof Error ? error.message : String(error),
      nodeFinalStates: finalRun ? Object.values(finalRun.nodeStates).map((nodeState: any) => ({
        nodeId: nodeState.nodeId,
        state: nodeState.state,
        attempt: nodeState.attempt,
      })) : [],
      sessionEvents,
    };
  } finally {
    runtimeUnsub();
    const run = workflowOrchestrator.getRun(missionId);
    if (run && !['completed', 'failed', 'cancelled'].includes(run.status)) {
      workflowOrchestrator.cancelRun(missionId);
    }
  }
}

async function runPrompt05ManualInterventionHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  await invoke('workspace_create_dir', {
    parentPath: joinWindowsPath(options.repoRoot, 'docks-testing'),
    name: 'manual-intervention',
  }).catch(error => {
    if (!String(error).toLowerCase().includes('already exists')) throw error;
  });

  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'prompt05_manual_intervention',
    workflowFilter: LIVE_WORKFLOW_FILTER ?? null,
    executionPath: 'live_app_harness_manual_runtime',
    liveRuntimeLaunched: true,
    note: 'Runs capped Prompt 05 manual-intervention workflows through WorkflowOrchestrator and the app RuntimeManager manual execution path.',
    results: [] as Array<Record<string, unknown>>,
  };

  await writeReport(options.outputPath, report);
  const workflows = [
    {
      name: 'takeover',
      action: async (missionId: string, nodeId: string) => {
        const run = workflowOrchestrator.getRun(missionId);
        return {
          state: run?.nodeStates[nodeId]?.state,
          terminalId: run?.nodeStates[nodeId]?.runtimeSession?.terminalId ?? null,
          manualTakeoverEvents: run?.events.filter(event => event.type === 'node_state_changed' && event.nodeId === nodeId).length ?? 0,
        };
      },
    },
    {
      name: 'resume',
      action: async (missionId: string, nodeId: string) => {
        const run = workflowOrchestrator.getRun(missionId);
        if (!run) throw new Error(`Missing run ${missionId}`);
        workflowOrchestrator.transitionNodeState(run, nodeId, 'injecting_task');
        workflowOrchestrator.transitionNodeState(run, nodeId, 'running');
        workflowOrchestrator.completeNode({ nodeId, attempt: run.nodeStates[nodeId]?.attempt ?? 1, outcome: 'success', summary: 'manual resume completed' });
        return { finalState: run.nodeStates[nodeId]?.state, runStatus: run.status };
      },
    },
    {
      name: 'force-complete',
      action: async (missionId: string, nodeId: string) => {
        const run = workflowOrchestrator.getRun(missionId);
        if (!run) throw new Error(`Missing run ${missionId}`);
        workflowOrchestrator.completeNode({ nodeId, attempt: run.nodeStates[nodeId]?.attempt ?? 1, outcome: 'success', summary: 'manual completion' });
        return { finalState: run.nodeStates[nodeId]?.state, runStatus: run.status };
      },
    },
    {
      name: 'fail-retry-cancel',
      action: async (missionId: string, nodeId: string, reviewerNodeId: string | null) => {
        const run = workflowOrchestrator.getRun(missionId);
        if (!run) throw new Error(`Missing run ${missionId}`);
        workflowOrchestrator.completeNode({ nodeId, attempt: run.nodeStates[nodeId]?.attempt ?? 1, outcome: 'failure', summary: 'manual failure' });
        const reviewerAfterFailure = reviewerNodeId ? run.nodeStates[reviewerNodeId]?.state : null;
        workflowOrchestrator.activateNodeInternal(run, nodeId);
        await waitForPrompt05State(missionId, nodeId, ['manual_takeover']);
        workflowOrchestrator.cancelRun(missionId);
        return {
          retryAttempt: run.nodeStates[nodeId]?.attempt,
          runStatus: run.status,
          reviewerAfterFailure,
          reviewerFinalState: reviewerNodeId ? run.nodeStates[reviewerNodeId]?.state : null,
        };
      },
    },
  ];

  for (let index = 0; index < workflows.length; index += 1) {
    const workflow = workflows[index];
    const result = await runPrompt05ManualWorkflow(index + 1, workflow.name, workflow.action, options);
    report.results.push(result);
    await writeReport(options.outputPath, report);
  }

  report.finishedAt = new Date().toISOString();
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

async function runRuntimeViewLayoutMockHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  const now = new Date().toISOString();
  const missionId = `runtime-view-layout-mock-${Date.now().toString(36)}`;
  const outputDir = await ensureWorkflowDirectory(
    joinWindowsPath(options.repoRoot, 'docks-testing'),
    `runtime-view-layout-mock-${Date.now().toString(36)}`,
  );
  const agentIds = ['agent-1', 'agent-2', 'agent-3', 'agent-4', 'agent-5'];
  const edges = [
    { fromNodeId: 'agent-1', toNodeId: 'agent-3', condition: 'on_success' as const },
    { fromNodeId: 'agent-2', toNodeId: 'agent-3', condition: 'on_success' as const },
    { fromNodeId: 'agent-3', toNodeId: 'agent-4', condition: 'on_success' as const },
    { fromNodeId: 'agent-3', toNodeId: 'agent-5', condition: 'on_success' as const },
  ];
  const definition = {
    id: 'runtime-view-layout-mock',
    name: 'Runtime View Layout Mock',
    createdAt: now,
    updatedAt: now,
    nodes: agentIds.map((nodeId, index) => ({
      id: nodeId,
      kind: 'agent',
      roleId: `agent${index + 1}`,
      config: {
        cli: 'codex',
        model: liveWorkflowModelForCli('codex'),
        executionMode: 'manual',
        terminalId: `runtime-view-layout-${nodeId}`,
        terminalTitle: `Agent ${index + 1}`,
        profileId: `agent${index + 1}`,
        retryPolicy: { maxRetries: 0, retryOn: ['unknown'], backoffMs: 0 },
      },
    })),
    edges,
  } as any;

  const report = {
    startedAt: new Date().toISOString(),
    finishedAt: null as string | null,
    suiteName: 'runtime_view_layout_mock',
    executionPath: 'live_app_harness_manual_runtime',
    liveRuntimeLaunched: true,
    note: 'Creates a deterministic Codex-only manual-runtime graph shaped as Agent 1 + Agent 2 -> Agent 3 -> Agent 4 + Agent 5 for Runtime view visual validation. Model is applied only when the installed Codex CLI accepts it.',
    missionId,
    outputDir,
    graphShape: 'agent-1 + agent-2 -> agent-3 -> agent-4 + agent-5',
    model: liveWorkflowModelForCli('codex') ?? null,
    nodeFinalStates: [] as Array<Record<string, unknown>>,
  };

  await writeReport(options.outputPath, report);
  const run = workflowOrchestrator.startRun(definition, { runId: missionId, workspaceDir: outputDir });
  useWorkspaceStore.getState().setGlobalGraph({
    id: 'runtime-view-layout-mock',
    nodes: [
      {
        id: 'task',
        type: 'workflow.task',
        data: { label: 'Task' },
        config: { prompt: 'Runtime layout mock task', position: { x: 260, y: 0 } },
      },
      ...agentIds.map((nodeId, index) => ({
        id: nodeId,
        type: 'workflow.agent',
        data: { label: `Agent ${index + 1}` },
        config: {
          roleId: `agent${index + 1}`,
          cli: 'codex',
          executionMode: 'manual',
          position: {
            x: index < 2 ? index * 520 : index === 2 ? 260 : (index - 3) * 520,
            y: index < 2 ? 180 : index === 2 ? 360 : 540,
          },
        },
      })),
    ],
    edges: [
      { fromNodeId: 'task', toNodeId: 'agent-1', condition: 'always' },
      { fromNodeId: 'task', toNodeId: 'agent-2', condition: 'always' },
      ...edges,
    ],
  } as any);
  useWorkspaceStore.getState().setAppMode('runtime');

  for (let index = 0; index < agentIds.length; index += 1) {
    const nodeId = agentIds[index];
    const session = runtimeManager.getSessionForNode(missionId, nodeId, 1)
      ?? await runtimeManager.createRuntimeForNode({
        missionId,
        nodeId,
        attempt: 1,
        role: `agent${index + 1}`,
        agentId: `agent${index + 1}`,
        profileId: `agent${index + 1}`,
        cliId: 'codex',
        executionMode: 'manual',
        terminalId: `runtime-view-layout-${nodeId}`,
        paneId: undefined,
        workspaceDir: outputDir,
        goal: 'Runtime view vertical layout visual validation.',
        instructionOverride: null,
        model: liveWorkflowModelForCli('codex') ?? null,
        yolo: false,
      });
    if (session.state !== 'manual_takeover') {
      session.transitionTo('manual_takeover');
    }
  }

  report.finishedAt = new Date().toISOString();
  report.nodeFinalStates = Object.values(run.nodeStates).map((nodeState: any) => ({
    nodeId: nodeState.nodeId,
    state: nodeState.state,
    attempt: nodeState.attempt,
  }));
  await writeReport(options.outputPath, report);

  if (options.closeWhenDone) {
    await Window.getCurrent().close();
  }
}

export async function runLiveWorkflowHarness(options: LiveWorkflowHarnessOptions): Promise<void> {
  if (options.suiteName === 'runtime_view_layout_mock') {
    await runRuntimeViewLayoutMockHarness(options);
    return;
  }

  if (options.suiteName === 'prompt05_manual_intervention') {
    await runPrompt05ManualInterventionHarness(options);
    return;
  }

  if (options.suiteName === 'prompt04_nodetree_mission_control') {
    await runPrompt04NodeTreeMissionControlHarness(options);
    return;
  }

  if (options.suiteName === 'prompt07_10_capped') {
    await runPrompt0710CappedHarness(options);
    return;
  }

  if (options.suiteName === 'prompt05_branching_merge') {
    await runPrompt05BranchingMergeHarness(options);
    return;
  }

  if (options.suiteName === 'prompt05_branching_merge_mid_mixed_cli') {
    await runPrompt05MidMixedCliHarness(options);
    return;
  }

  if (options.suiteName === 'opencode_post_ack_reproducer') {
    await runOpenCodePostAckReproducerHarness(options);
    return;
  }

  if (options.suiteName === 'prompt06_large_workflows') {
    await runPrompt06LargeWorkflowHarness(options);
    return;
  }

  if (options.suiteName === 'prompt11_mixed_cli_smoke') {
    await runPrompt11MixedCliSmokeHarness(options);
    return;
  }

  if (options.suiteName === 'prompt12_mcp_handoff') {
    await runPromptSpecSuiteHarness(
      options,
      PROMPT_12_WORKFLOWS,
      'prompt12_mcp_handoff',
      '12',
      'mcp-handoff',
      'prompt12',
      'Runs Prompt 12 MCP handoff reliability workflows through MissionOrchestrator, WorkflowOrchestrator, RuntimeManager, and PTY-backed mixed CLI sessions with concrete multi-stack deliverables.',
    );
    return;
  }

  if (options.suiteName === 'prompt13_consecutive_runs') {
    await runPromptSpecSuiteHarness(
      options,
      PROMPT_13_WORKFLOWS,
      'prompt13_consecutive_runs',
      '13',
      'consecutive-runs',
      'prompt13',
      'Runs Prompt 13 consecutive workflow executions through live app runtime paths with fresh run-specific outputs, repeated shapes, and cleanup-focused evidence.',
    );
    return;
  }

  if (options.suiteName === 'prompt14_branching_merge') {
    await runPromptSpecSuiteHarness(
      options,
      PROMPT_14_WORKFLOWS,
      'prompt14_branching_merge',
      '14',
      'branching-merge',
      'prompt14',
      'Runs Prompt 14 branching and merge stress workflows through live mixed CLI runtime sessions with branch-owned artifacts and integrated deliverables.',
    );
    return;
  }

  if (options.suiteName === 'prompt15_quality_gate_sim') {
    await runPromptSpecSuiteHarness(
      options,
      PROMPT_15_WORKFLOWS,
      'prompt15_quality_gate_sim',
      '15',
      'quality-gate-sim',
      'prompt15',
      'Runs Prompt 15 mixed workflow quality-gate simulations through live mixed CLI runtime sessions with required gate artifacts and concrete deliverables.',
    );
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
    screenwatchDir: env.VITE_LIVE_WORKFLOW_SCREENWATCH_DIR || `${repoRoot}\\.tmp-tests\\ui-screenwatch`,
    screenwatchEnabled: env.VITE_LIVE_WORKFLOW_SCREENWATCH !== '0',
    screenwatchIntervalMs: Math.max(1_000, Number(env.VITE_LIVE_WORKFLOW_SCREENWATCH_INTERVAL_MS || 5_000)),
    clis: parseCsv(env.VITE_LIVE_WORKFLOW_CLIS, VALID_CLIS, VALID_CLIS),
    phases: parseCsv(env.VITE_LIVE_WORKFLOW_PHASES, VALID_PHASES, VALID_PHASES),
    cliSequences: parseCliSequences(env.VITE_LIVE_WORKFLOW_COMBOS),
    roleSequences: parseRoleSequences(env.VITE_LIVE_WORKFLOW_ROLE_COMBOS),
    taskTypes: parseCsv(env.VITE_LIVE_WORKFLOW_TASKS, VALID_TASK_TYPES, ['handshake']),
    workflowTimeoutMs: Math.max(30_000, Number(env.VITE_LIVE_WORKFLOW_TIMEOUT_MS || 180_000)),
    closeWhenDone: env.VITE_LIVE_WORKFLOW_CLOSE !== '0',
  };
}
