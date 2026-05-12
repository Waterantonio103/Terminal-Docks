/**
 * RuntimeManager.ts — Centralized runtime lifecycle owner.
 *
 * Owns all live RuntimeSession instances. Provides methods to create,
 * launch, send tasks to, and stop runtimes. Routes PTY output through
 * CLI adapters. Emits events for UI and Orchestrator subscription.
 *
 * INVARIANT: There is exactly one active RuntimeSession owner for a
 * terminalId at a time. All workflow activation goes through
 * ensureRuntimeReadyForTask(...). No code path may call
 * createRuntimeForNode(...) + launchCli(...) directly for workflow
 * activation.
 *
 * Phase 4 — Wave 3 / Agent B
 */

import { listen } from '@tauri-apps/api/event';
import { RuntimeSession } from './RuntimeSession.js';
import type {
  CliRuntimeStrategy,
  CreateRuntimeArgs,
  RuntimeManagerEvent,
  RuntimeManagerSnapshot,
  RuntimeReuseExpectation,
  RuntimeSessionDescriptor,
  RuntimeSessionState,
  RuntimePermissionRequest,
  SendTaskArgs,
  SendInputArgs,
  SessionLivenessResult,
  StopRuntimeArgs,
  ResolvePermissionArgs,
} from './RuntimeTypes.js';
import { isRuntimeSessionTerminal } from './RuntimeTypes.js';
import { getCliAdapter } from './adapters/index.js';
import type { CompletionDetectionResult, StatusDetectionResult } from './adapters/CliAdapter.js';
import {
  buildCliReadinessDiagnostic,
  evaluateCliReadiness,
  isStrictCliStatusGateEnabled,
} from './RuntimeReadinessGate.js';

import {
  checkMcpHealthDetailed,
  destroyTerminal,
  getMcpBaseUrl,
  getMcpUrl,
  getRecentTerminalOutput,
  registerMcpSession,
  registerActivationDispatch,
  acknowledgeActivation,
  spawnTerminal,
  startHeadlessRun,
  writeToTerminal,
  isTerminalActive,
  registerTerminalMetadata,
  notifyMcpDisconnected,
  resizeTerminal,
} from './TerminalRuntime.js';
import { buildNewTaskSignal } from '../missionRuntime.js';
import { buildStartAgentRunRequest } from '../runtimeDispatcher.js';
import {
  buildCodexInteractiveLaunchArgs,
  buildCodexFollowupTaskSignal,
  buildGeminiInteractiveLaunchCommand,
  buildPtyLaunchCommand,
  formatLaunchArgsForLog,
  normalizeCodexModelId,
  redactSensitiveLaunchValue,
  resolveCodexYoloFlag,
} from '../cliCommandBuilders.js';
import { getRuntimeBootstrapContract, buildRuntimeBootstrapRegistrationRequest } from '../runtimeBootstrap.js';
import { mcpBus } from '../workers/mcpEventBus.js';
import { detectCliFromTerminalOutput } from '../cliDetection.js';
import { useWorkspaceStore } from '../../store/workspace.js';
import { emit } from '@tauri-apps/api/event';
import { terminalOutputBus } from './TerminalOutputBus.js';
import { missionRepository } from '../missionRepository.js';
import { FINAL_README_INSTRUCTION } from '../workflowReadme.js';
import {
  assessPostAckTerminalProgress,
  evaluatePostAckWatchdog,
  isMeaningfulPostAckMcpEvent,
  type PostAckProgressSnapshot,
  type PostAckProgressSource,
  type PostAckWatchdogReason,
} from './RuntimeProgressWatchdog.js';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CLI_LAUNCH_DELAY_MS = 500;
const SHELL_LAUNCH_SETTLE_MS = 700;
const CLI_STARTUP_WAIT_MS = 2_000;
const CLI_READY_WAIT_MS = 20_000;
const CLAUDE_MANAGED_INJECTION_READY_WAIT_MS = readRuntimeEnvNumber(
  'VITE_RUNTIME_CLAUDE_MANAGED_INJECTION_READY_WAIT_MS',
  75_000,
  CLI_READY_WAIT_MS,
);
const OPENCODE_MANAGED_INJECTION_READY_WAIT_MS = readRuntimeEnvNumber(
  'VITE_RUNTIME_OPENCODE_MANAGED_INJECTION_READY_WAIT_MS',
  75_000,
  CLI_READY_WAIT_MS,
);
const PASTE_SUBMIT_GAP_MS = 150;
const GEMINI_PASTE_SUBMIT_GAP_MS = 1_500;
const PRE_CLEAR_SETTLE_MS = 300;
const BOOTSTRAP_EVENT_TIMEOUT_MS = 8_000;
const MCP_HEALTH_TIMEOUT_MS = 5_000;
const MCP_HEALTH_RETRY_ATTEMPTS = 3;
const MCP_HEALTH_RETRY_DELAY_MS = 1_000;
const MCP_REGISTRATION_TIMEOUT_MS = 8_000;
const TASK_ACK_TIMEOUT_MS = readRuntimeEnvNumber('VITE_RUNTIME_TASK_ACK_TIMEOUT_MS', 60_000, 30_000);
const CODEX_TASK_ACK_TIMEOUT_MS = readRuntimeEnvNumber(
  'VITE_RUNTIME_CODEX_TASK_ACK_TIMEOUT_MS',
  180_000,
  TASK_ACK_TIMEOUT_MS,
);
const GEMINI_TASK_ACK_TIMEOUT_MS = readRuntimeEnvNumber(
  'VITE_RUNTIME_GEMINI_TASK_ACK_TIMEOUT_MS',
  180_000,
  TASK_ACK_TIMEOUT_MS,
);
const CLAUDE_TASK_ACK_TIMEOUT_MS = readRuntimeEnvNumber(
  'VITE_RUNTIME_CLAUDE_TASK_ACK_TIMEOUT_MS',
  120_000,
  TASK_ACK_TIMEOUT_MS,
);
const BOOTSTRAP_INJECTION_TIMEOUT_MS = 10_000;
const MISSING_MCP_COMPLETION_RENUDGE_MS = 4_000;
const PERMISSION_REDETECT_SUPPRESSION_MS = 2_500;
const MISSING_MCP_COMPLETION_FAIL_MS = 90_000;
const POST_ACK_NO_PROGRESS_WINDOW_MS = readRuntimeEnvNumber('VITE_RUNTIME_POST_ACK_NO_PROGRESS_WINDOW_MS', 60_000, 1_000);
const POST_ACK_NO_MCP_COMPLETION_MAX_MS = readRuntimeEnvNumber('VITE_RUNTIME_POST_ACK_NO_MCP_COMPLETION_MAX_MS', 180_000, 30_000);
const MAX_RETAINED_RUNTIME_VIEW_SESSIONS = readRuntimeEnvNumber('VITE_RUNTIME_RETAINED_VIEW_SESSIONS', 16, 0);
const RUNTIME_COMPLETION_POLL_MS = 2_000;
const CODEX_IDLE_WAIT_MS = 1_000;
const CODEX_IDLE_TIMEOUT_MS = 8_000;
const CODEX_BOOTSTRAP_RETRY_DELAY_MS = 3_500;
const CODEX_TYPE_CHUNK_SIZE = 48;
const CODEX_TYPE_CHUNK_DELAY_MS = 20;
const PTY_DESTROY_WAIT_MS = 5_000;
const PTY_DESTROY_POLL_MS = 100;
const CLI_AUTH_WAIT_MS = readRuntimeEnvNumber('VITE_RUNTIME_AUTH_WAIT_MS', 120_000, CLI_READY_WAIT_MS);
const APP_REGISTERED_BOOTSTRAP_CLIS = new Set(['gemini', 'opencode']);

function readRuntimeEnvNumber(key: string, fallback: number, minimum = 0): number {
  const env = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env;
  const value = Number(env?.[key] ?? fallback);
  return Number.isFinite(value) ? Math.max(minimum, value) : fallback;
}

function pasteSubmitGapMsForCli(cliId: string): number {
  return cliId === 'gemini' ? GEMINI_PASTE_SUBMIT_GAP_MS : PASTE_SUBMIT_GAP_MS;
}

function managedInjectionReadyWaitMsForCli(cliId: string): number {
  if (cliId === 'claude') return CLAUDE_MANAGED_INJECTION_READY_WAIT_MS;
  if (cliId === 'opencode') return OPENCODE_MANAGED_INJECTION_READY_WAIT_MS;
  return CLI_READY_WAIT_MS;
}

function taskAckTimeoutMsForCli(cliId: string): number {
  if (cliId === 'codex') return CODEX_TASK_ACK_TIMEOUT_MS;
  if (cliId === 'claude') return CLAUDE_TASK_ACK_TIMEOUT_MS;
  return cliId === 'gemini' ? GEMINI_TASK_ACK_TIMEOUT_MS : TASK_ACK_TIMEOUT_MS;
}

function joinRuntimePath(...parts: string[]): string {
  return parts
    .filter(Boolean)
    .join('\\')
    .replace(/[\\\/]+/g, '\\');
}

function inferCodexTrustedProjectDir(workspaceDir: string | null | undefined): string | null {
  const workspace = workspaceDir?.trim();
  if (!workspace) return null;
  const normalized = workspace.replace(/[\\\/]+/g, '\\').replace(/\\+$/g, '');
  const marker = '\\docks-testing\\';
  const markerIndex = normalized.toLowerCase().indexOf(marker);
  const trustedPath = markerIndex > 0 ? normalized.slice(0, markerIndex) : normalized;
  return trustedPath.toLowerCase();
}

function isManagedCliActiveWorkStatus(status: StatusDetectionResult | null | undefined): boolean {
  return status?.status === 'processing' &&
    status.confidence === 'high' &&
    /active work|queued input|pending turn|completing current tasks/i.test(status.detail ?? '');
}

function escapeGeminiStartupPromptValue(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

// ──────────────────────────────────────────────
// CLI Runtime Strategies
// ──────────────────────────────────────────────

const CLI_STRATEGIES: Record<string, CliRuntimeStrategy> = {
  codex: {
    cliId: 'codex',
    workflowMode: 'fresh_process',
    supportsMcpHandshake: true,
    supportsPromptInjection: true,
    requiresPty: true,
  },
  claude: {
    cliId: 'claude',
    workflowMode: 'fresh_process',
    supportsMcpHandshake: true,
    supportsPromptInjection: true,
    requiresPty: true,
  },
  gemini: {
    cliId: 'gemini',
    workflowMode: 'fresh_process',
    supportsMcpHandshake: true,
    supportsPromptInjection: true,
    requiresPty: true,
  },
  opencode: {
    cliId: 'opencode',
    workflowMode: 'fresh_process',
    supportsMcpHandshake: true,
    supportsPromptInjection: true,
    requiresPty: true,
  },
};

function getCliStrategy(cliId: string): CliRuntimeStrategy {
  return CLI_STRATEGIES[cliId] ?? {
    cliId: cliId as any,
    workflowMode: 'fresh_process',
    supportsMcpHandshake: false,
    supportsPromptInjection: false,
    requiresPty: true,
  };
}

// ──────────────────────────────────────────────
// Listeners
// ──────────────────────────────────────────────

type ManagerListener = (event: RuntimeManagerEvent) => void;
type SnapshotListener = (snapshot: RuntimeManagerSnapshot) => void;

function normalizeModelForReuse(value: string | null | undefined): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  return trimmed || null;
}

function normalizeModelForCli(cliId: string, value: string | null | undefined): string | null {
  if (cliId === 'codex') return normalizeCodexModelId(value);
  return normalizeModelForReuse(value);
}

function previewText(value: string | null | undefined, limit = 280): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}...`;
}

function extractExpectedOutputFiles(value: string | null | undefined): string[] {
  const text = typeof value === 'string' ? value : '';
  const match = /Expected files:\s*([^.\r\n]+)/i.exec(text);
  if (!match?.[1]) return [];

  const seen = new Set<string>();
  return match[1]
    .split(/,|\band\b/i)
    .map(item => item.trim().replace(/^["'`]+|["'`]+$/g, ''))
    .map(item => item.replace(/^[\\/]+/, '').replace(/[\\/]+$/g, ''))
    .filter(item =>
      item.length > 0 &&
      item.length <= 160 &&
      !item.includes('..') &&
      !/^[A-Za-z]:/.test(item) &&
      !/[<>:"|?*]/.test(item)
    )
    .filter(item => {
      const key = item.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 20);
}

function joinWorkspaceOutputPath(workspaceDir: string, relativePath: string): string {
  const root = workspaceDir.replace(/[\\/]+$/g, '');
  const child = relativePath.replace(/^[\\/]+/g, '');
  return `${root}\\${child}`;
}

function fileContentSignature(content: string): string {
  return `${content.length}:${content.slice(0, 80)}:${content.slice(-80)}`;
}

// ──────────────────────────────────────────────
// Per-Terminal Mutex
// ──────────────────────────────────────────────

class TerminalLock {
  private locks = new Map<string, Promise<void>>();

  async acquire(terminalId: string, label: string): Promise<() => void> {
    const existing = this.locks.get(terminalId);
    let release!: () => void;
    const next = new Promise<void>((resolve) => {
      release = resolve;
    });

    this.locks.set(terminalId, next);

    if (existing) {
      console.log(`[runtime] acquiring terminal lock terminal=${terminalId} op=${label} (waiting)`);
      await existing;
    } else {
      console.log(`[runtime] acquiring terminal lock terminal=${terminalId} op=${label}`);
    }

    return () => {
      if (this.locks.get(terminalId) === next) {
        this.locks.delete(terminalId);
      }
      release();
      console.log(`[runtime] released terminal lock terminal=${terminalId} op=${label}`);
    };
  }

  isLocked(terminalId: string): boolean {
    return this.locks.has(terminalId);
  }
}

interface PostAckNoProgressWatchdogState extends PostAckProgressSnapshot {
  expectedFiles: string[];
  expectedFileSignatures: Map<string, string>;
  lastExpectedFile?: string;
  lastMcpEventType?: string;
  lastTerminalProgressPreview?: string;
  lastTerminalSignature?: string;
  nudgeTimer?: ReturnType<typeof setTimeout>;
  failTimer?: ReturnType<typeof setTimeout>;
}

// ──────────────────────────────────────────────
// RuntimeManager
// ──────────────────────────────────────────────

class RuntimeManager {
  private sessions = new Map<string, RuntimeSession>();
  private retainedSessions = new Map<string, RuntimeSessionDescriptor>();
  private sessionsByNode = new Map<string, string>();
  private terminalOwners = new Map<string, string>();
  private listeners = new Set<ManagerListener>();
  private snapshotListeners = new Set<SnapshotListener>();
  private ptyCleanupFns = new Map<string, () => void>();
  private suppressedPtyExitUntil = new Map<string, number>();
  private completionContractTimers = new Map<string, {
    nudgeTimer?: ReturnType<typeof setTimeout>;
    failTimer?: ReturnType<typeof setTimeout>;
  }>();
  private postAckNoProgressWatchdogs = new Map<string, PostAckNoProgressWatchdogState>();
  private cliReadinessDiagnostics = new Map<string, string>();
  private recentPermissionSignatures = new Map<string, number>();
  private runtimeCompletionPollers = new Map<string, {
    timer: ReturnType<typeof setInterval>;
    inFlight: boolean;
  }>();
  private terminalLocks = new TerminalLock();
  private nativeListenerUnsub?: () => void;
  private disposed = false;

  async startListening(): Promise<void> {
    if (this.nativeListenerUnsub) return;

    const unlistenActivation = await listen<{
      mission_id: string;
      node_id: string;
      attempt: number;
      status: string;
      payload: import('../missionRuntime.js').RuntimeActivationPayload & { yolo?: boolean };
    }>('workflow-runtime-activation-requested', async (event) => {
      const { mission_id, node_id, attempt, payload } = event.payload;

      try {
        await this.ensureRuntimeReadyForTask({
          missionId: mission_id,
          nodeId: node_id,
          attempt,
          role: payload.role,
          agentId: payload.agentId,
          profileId: payload.profileId ?? null,
          cliId: payload.cliType as import('../workflow/WorkflowTypes.js').CliId,
          executionMode: payload.executionMode as import('../workflow/WorkflowTypes.js').ExecutionMode,
          terminalId: payload.terminalId,
          paneId: payload.paneId ?? undefined,
          workspaceDir: payload.workspaceDir ?? null,
          goal: payload.goal,
          inputPayload: payload.inputPayload,
          runId: payload.runId,
          modelId: payload.modelId ?? null,
          yolo: Boolean(payload.yolo),
          activationPayload: payload,
        });
      } catch (error) {
        const reason = error instanceof Error ? error.message : String(error);
        console.error(`[RuntimeManager] Failed to launch CLI for ${node_id}:`, error);
        acknowledgeActivation({
          missionId: mission_id,
          nodeId: node_id,
          attempt,
          status: 'failed',
          reason,
        }).catch(() => {});
        emit('workflow-node-update', {
          id: node_id,
          status: 'failed',
          attempt,
        }).catch(() => {});
      }
    });

    const unlistenNodeUpdate = await listen<{
      id: string;
      status: string;
      attempt?: number;
      outcome?: 'success' | 'failure';
      reason?: string;
    }>('workflow-node-update', (event) => {
      this.handleNativeNodeUpdate(event.payload);
    });

    this.nativeListenerUnsub = () => {
      unlistenActivation();
      unlistenNodeUpdate();
    };

    listen<{
      runId: string;
      missionId: string;
      nodeId: string;
      cli?: string;
      status: string;
      exitCode?: number | null;
      command?: string;
      args?: string[];
      promptDelivery?: string;
      stdoutPath?: string | null;
      stderrPath?: string | null;
      stdoutPreview?: string | null;
      stderrPreview?: string | null;
      stdoutTurnCompleted?: boolean;
      error?: string | null;
      at: number;
    }>('agent-run-exit', async (event) => {
      const { missionId, nodeId, status, error, exitCode, command, args, promptDelivery, stdoutPreview, stderrPreview, stdoutTurnCompleted } = event.payload;
      const sessionKey = Array.from(this.sessionsByNode.entries()).find(
        ([key]) => key.startsWith(`${missionId}:${nodeId}:`)
      );
      if (!sessionKey) return;
      const session = this.sessions.get(sessionKey[1]);
      if (!session) return;

      if (!this.isCurrentOwner(session)) {
        console.log(
          `[runtime] stale agent-run-exit ignored session=${session.sessionId} terminal=${session.terminalId}`,
        );
        return;
      }

      const isMcpCompletingCli = session.cliId === 'claude' || session.cliId === 'ollama' || session.cliId === 'lmstudio';
      if (status === 'completed' && isMcpCompletingCli) return;
      if (session.state === 'completed' || session.state === 'failed') return;

      const reason = status === 'completed'
        ? `Process exited before MCP handoff. cli=${session.cliId} model=${session.model || '<default>'} yolo=${session.yolo} command=${command ?? session.cliId} ${(args ?? []).join(' ')}`.trim()
        : [
            `${session.cliId} exited with code ${exitCode ?? 'unknown'}.`,
            `Model: ${session.model || '<default>'}.`,
            `YOLO: ${session.yolo}.`,
            `Prompt delivery: ${promptDelivery ?? 'unknown'}.`,
            `Command: ${[command ?? session.cliId, ...(args ?? [])].join(' ')}`.trim(),
            stdoutTurnCompleted ? 'stdout contained turn.completed.' : null,
            error ? `Error: ${error}` : null,
            stderrPreview ? `stderr preview: ${previewText(stderrPreview)}` : null,
            stdoutPreview ? `stdout preview: ${previewText(stdoutPreview)}` : null,
          ]
            .filter(Boolean)
            .join(' ');

      console.warn(`[runtime] headless exit failed ${reason}`);

      await acknowledgeActivation({
        missionId: session.missionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
        status: 'failed',
        reason,
      });
    }).catch(console.error);
  }

  private handleNativeNodeUpdate(update: {
    id: string;
    status: string;
    attempt?: number;
    outcome?: 'success' | 'failure';
    reason?: string;
  }): void {
    const status = update.status?.toLowerCase();
    if (status !== 'completed' && status !== 'failed') return;

    const session = Array.from(this.sessions.values()).find(candidate =>
      candidate.nodeId === update.id &&
      (update.attempt == null || candidate.attempt === update.attempt) &&
      !isRuntimeSessionTerminal(candidate.state),
    );
    if (!session || !this.isCurrentOwner(session)) return;

    if (status === 'completed') {
      const outcome = update.outcome ?? 'success';
      session.markCompleted();
      this.emit({
        type: 'session_completed',
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        outcome,
      });
      this.cleanupSession(session);
      if (session.cliId === 'codex' && session.terminalId) {
        this.destroyAndWaitForTerminal(session.terminalId).catch(err =>
          console.warn(`[codex] PTY destroy after native completion failed terminal=${session.terminalId}`, err),
        );
      }
      return;
    }

    const reason = update.reason || `Node ${session.nodeId} reported failed from native workflow update.`;
    session.markFailed(reason);
    this.emit({
      type: 'session_failed',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      error: reason,
    });
    this.cleanupSession(session);
  }

  // ── Public API ──────────────────────────────────────────────────

  async createRuntimeForNode(args: CreateRuntimeArgs): Promise<RuntimeSession> {
    let adapter = getCliAdapter(args.cliId);

    // If 'api' or 'streaming_headless' mode, we use the special streaming adapter
    // which handles tool calls directly via MCP without a PTY.
    if (args.executionMode === 'api' || args.executionMode === 'streaming_headless') {
      adapter = getCliAdapter('streaming');
    }

    if (!adapter) {
      throw new Error(`No CLI adapter registered for "${args.cliId}"`);
    }

    console.log(
      `[runtime] create cli=${args.cliId} model=${normalizeModelForCli(args.cliId, args.modelId ?? args.model) ?? '<default>'} yolo=${Boolean(args.yolo)} executionMode=${args.executionMode} workspace=${args.workspaceDir ?? '<none>'}`,
    );

    this.forgetRetainedSessionsForRuntime(args.missionId, args.nodeId, args.terminalId);

    const session = new RuntimeSession(adapter, {
      missionId: args.missionId,
      nodeId: args.nodeId,
      attempt: args.attempt,
      role: args.role,
      agentId: args.agentId,
      profileId: args.profileId,
      cliId: args.cliId,
      executionMode: args.executionMode,
      terminalId: args.terminalId,
      paneId: args.paneId,
      workspaceDir: args.workspaceDir,
      goal: args.goal ?? undefined,
      frontendMode: args.frontendMode,
      frontendCategory: args.frontendCategory,
      specProfile: args.specProfile,
      finalReadmeEnabled: args.finalReadmeEnabled,
      finalReadmeOwnerNodeId: args.finalReadmeOwnerNodeId,
      instructionOverride: args.instructionOverride ?? undefined,
      legalTargets: args.legalTargets,
      upstreamPayloads: args.upstreamPayloads,
      model: normalizeModelForCli(args.cliId, args.modelId ?? args.model),
      yolo: args.yolo,
    });

    this.sessions.set(session.sessionId, session);
    this.sessionsByNode.set(`${args.missionId}:${args.nodeId}:${args.attempt}`, session.sessionId);
    this.wireMcpEvents(session.sessionId);

    missionRepository.appendWorkflowEvent({
      missionId: args.missionId,
      nodeId: args.nodeId,
      sessionId: session.sessionId,
      eventType: 'runtime_created',
      severity: 'info',
      message: `Runtime session created: ${session.sessionId}`,
      payloadJson: JSON.stringify({ cliId: args.cliId, executionMode: args.executionMode }),
    }).catch(() => {});

    session.onStateChange((from: RuntimeSessionState, to: RuntimeSessionState) => {
      this.emit({
        type: 'session_state_changed',
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        from,
        to,
      });

      const existingBinding = useWorkspaceStore.getState().nodeRuntimeBindings[session.nodeId];
      if (existingBinding?.adapterStatus !== to || existingBinding?.runtimeSessionId !== session.sessionId) {
        const existingTerminalId = existingBinding?.terminalId;
        useWorkspaceStore.getState().setNodeRuntimeBinding(session.nodeId, {
          terminalId: session.terminalId || existingTerminalId || '',
          runtimeSessionId: session.sessionId,
          adapterStatus: to as any,
        });
      }

      emit('workflow-node-update', {
        id: session.nodeId,
        status: to,
        attempt: session.attempt,
      }).catch(() => {});

      this.notifySnapshot();
    });

    this.emit({
      type: 'session_created',
      sessionId: session.sessionId,
      nodeId: args.nodeId,
      missionId: args.missionId,
    });

    this.notifySnapshot();
    return session;
  }

  async launchCli(sessionId: string, externalPayload?: import('../missionRuntime.js').RuntimeActivationPayload): Promise<void> {
    const session = this.getSession(sessionId);
    if (!session) throw new Error(`No runtime session: ${sessionId}`);

    console.log(
      `[RuntimeManager] launchCli: sessionId="${sessionId}", nodeId="${session.nodeId}", cliId="${session.cliId}", missionId="${session.missionId}", attempt=${session.attempt}`,
    );

    const activationPayload = externalPayload ?? this.buildActivationPayload(session);
    try {
      await this.runActivationPipeline(session, activationPayload);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (this.isTerminalNotFoundError(error)) {
        if (session.state !== 'failed') {
          await this.failRuntimeForMissingPty(session, error);
        }
        return;
      }
      session.markFailed(message);
      this.emit({
        type: 'session_failed',
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        error: message,
      });
      throw error;
    }
  }

  async sendTask(args: SendTaskArgs): Promise<void> {
    const session = this.getSession(args.sessionId);
    if (!session) throw new Error(`No runtime session: ${args.sessionId}`);

    console.log(
      `[RuntimeManager] sendTask: sessionId="${args.sessionId}", nodeId="${session.nodeId}", promptLength=${args.prompt.length}`,
    );

    session.transitionTo('injecting_task');

    const signal = args.prompt;
    const adapter = session.adapter;

    if (session.isHeadless) {
      const launchCommand = adapter.buildLaunchCommand({
        sessionId: session.sessionId,
        missionId: session.missionId,
        nodeId: session.nodeId,
        role: session.role,
        agentId: session.agentId,
        profileId: session.profileId,
        workspaceDir: session.workspaceDir,
        mcpUrl: await getMcpBaseUrl(),
        executionMode: session.executionMode,
        model: session.model || null,
        yolo: session.yolo,
      });

      if (launchCommand.promptDelivery === 'unsupported') {
        throw new Error(launchCommand.unsupportedReason ?? 'Headless execution unsupported');
      }

      this.emit({
        type: 'task_injected',
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
        promptBytes: new TextEncoder().encode(signal).length,
        promptPreview: previewText(signal, 320) ?? '',
      });
      missionRepository.appendWorkflowEvent({
        missionId: session.missionId,
        nodeId: session.nodeId,
        sessionId: session.sessionId,
        eventType: 'task_injected',
        severity: 'info',
        message: `Task injected into session ${session.sessionId}`,
      }).catch(() => {});
      return;
    }

    await this.waitForManagedInjectionReadyOrThrow(session, CLI_READY_WAIT_MS, 'sendTask');

    const { preClear, paste, submit } = adapter.buildActivationInput(signal);
    if (preClear) {
      await this.writeToTerminalOrFail(session, preClear);
      await sleep(PRE_CLEAR_SETTLE_MS);
    }
    await this.writeToTerminalOrFail(session, paste);
    await sleep(pasteSubmitGapMsForCli(session.cliId));
    await this.writeToTerminalOrFail(session, submit);

    this.emit({
      type: 'task_injected',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      promptBytes: new TextEncoder().encode(signal).length,
      promptPreview: previewText(signal, 320) ?? '',
    });
    missionRepository.appendWorkflowEvent({
      missionId: session.missionId,
      nodeId: session.nodeId,
      sessionId: session.sessionId,
      eventType: 'task_injected',
      severity: 'info',
      message: `Task injected into session ${session.sessionId}`,
    }).catch(() => {});
  }

  async sendInput(args: SendInputArgs): Promise<void> {
    const session = this.getSession(args.sessionId);
    if (!session) throw new Error(`No runtime session: ${args.sessionId}`);

    if (session.isHeadless) {
      throw new Error('Cannot send raw input to a headless session');
    }

    await this.writeToTerminalOrFail(session, args.input);
  }

  async writeBootstrapToTerminal(terminalId: string, data: string, caller: string): Promise<void> {
    console.log(
      `[RuntimeManager] writeBootstrapToTerminal: caller="${caller}", terminalId="${terminalId}", dataLength=${data.length}`,
    );

    const sessions = this.getActiveSessions();
    const matchingSession = sessions.find(s => s.terminalId === terminalId);
    if (matchingSession) {
      console.warn(
        `[RuntimeManager] writeBootstrapToTerminal: terminal ${terminalId} already has active session ${matchingSession.sessionId} (state: ${matchingSession.state}). ` +
        `This may indicate a duplicate prompt injection. Caller: ${caller}`,
      );
    }

    if (matchingSession) {
      await this.writeToTerminalOrFail(matchingSession, data);
    } else {
      await this.writeToTerminalByIdOrFail(terminalId, data);
    }
  }

  async stopRuntime(args: StopRuntimeArgs): Promise<void> {
    const session = this.getSession(args.sessionId);
    if (!session) return;

    const strategy = getCliStrategy(session.cliId);
    const terminalId = session.terminalId;

    await this.withTerminalLock(terminalId, `stop:${args.sessionId.slice(0, 12)}`, async () => {
      await this.stopRuntimeInner(session, args.reason ?? 'Stopped by user', strategy);
    });
  }

  async resolvePermission(args: ResolvePermissionArgs): Promise<void> {
    const session = this.getSession(args.sessionId);
    if (!session) throw new Error(`No runtime session: ${args.sessionId}`);

    const perm = session.activePermission;
    if (!perm || perm.permissionId !== args.permissionId) {
      throw new Error(`No active permission ${args.permissionId} on session ${args.sessionId}`);
    }

    const adapter = session.adapter;
    const response = adapter.buildPermissionResponse(args.decision, {
      permissionId: perm.permissionId,
      category: perm.category,
      rawPrompt: perm.rawPrompt,
      detail: perm.detail,
    });

    if (session.isTerminal) {
      await this.writeToTerminalOrFail(session, response.input);
    }

    this.rememberPermissionSignature(session, perm);
    session.clearPermission();
    this.recordPostAckProgress(session, 'manual_input');

    this.emit({
      type: 'permission_resolved',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      permissionId: args.permissionId,
      decision: args.decision,
    });
    this.notifySnapshot();
  }

  // ── Session Liveness Validation ────────────────────

  async validateSessionForReuse(
    sessionId: string,
    expected: RuntimeReuseExpectation,
  ): Promise<SessionLivenessResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: 'stale', details: 'Session object no longer exists in RuntimeManager.' };
    }

    if (isRuntimeSessionTerminal(session.state)) {
      return {
        status: 'wrong_state',
        details: `Session is in terminal state "${session.state}".`,
      };
    }

    const midPipelineStates: RuntimeSessionState[] = [
      'creating', 'launching_cli', 'awaiting_cli_ready', 'waiting_auth', 'registering_mcp',
      'bootstrap_injecting', 'bootstrap_sent', 'awaiting_mcp_ready',
      'injecting_task', 'awaiting_ack',
    ];
    if (midPipelineStates.includes(session.state)) {
      return {
        status: 'wrong_state',
        details: `Session is stuck mid-pipeline in state "${session.state}".`,
      };
    }

    if (session.state === 'awaiting_permission') {
      return {
        status: 'wrong_state',
        details: `Session is blocked on a permission prompt.`,
      };
    }
    if (session.state === 'running' && session.cliId !== 'codex') {
      return {
        status: 'wrong_state',
        details: `Session is still marked running for CLI "${session.cliId}".`,
      };
    }

    if (session.cliId !== expected.cliId) {
      return {
        status: 'cli_mismatch',
        details: `Session CLI is "${session.cliId}" but expected "${expected.cliId}".`,
      };
    }

    const currentModel = normalizeModelForReuse(session.model);
    const expectedModel = normalizeModelForReuse(expected.model);
    if (currentModel !== expectedModel) {
      return {
        status: 'model_mismatch',
        details: `Session model is "${currentModel ?? '<default>'}" but expected "${expectedModel ?? '<default>'}".`,
      };
    }

    if (Boolean(session.yolo) !== Boolean(expected.yolo)) {
      return {
        status: 'yolo_mismatch',
        details: `Session yolo is "${Boolean(session.yolo)}" but expected "${Boolean(expected.yolo)}".`,
      };
    }

    if (expected.executionMode && session.executionMode !== expected.executionMode) {
      return {
        status: 'execution_mode_mismatch',
        details: `Session execution mode is "${session.executionMode}" but expected "${expected.executionMode}".`,
      };
    }

    if ((session.workspaceDir ?? null) !== (expected.workspaceDir ?? null)) {
      return {
        status: 'workspace_mismatch',
        details: `Session workspace is "${session.workspaceDir ?? '<none>'}" but expected "${expected.workspaceDir ?? '<none>'}".`,
      };
    }

    if (session.isTerminal) {
      try {
        const alive = await isTerminalActive(session.terminalId);
        if (!alive) {
          return {
            status: 'stale',
            details: `Terminal "${session.terminalId}" is no longer active.`,
          };
        }
      } catch {
        return {
          status: 'stale',
          details: `Cannot verify liveness of terminal "${session.terminalId}".`,
        };
      }

      try {
        const output = await getRecentTerminalOutput(session.terminalId, 12_288);
        if (output) {
          const detected = detectCliFromTerminalOutput(output);
          if (detected.cli && detected.cli !== session.cliId) {
            return {
              status: 'cli_mismatch',
              details: `Terminal is running "${detected.cli}" instead of "${session.cliId}".`,
            };
          }

          if (isStrictCliStatusGateEnabled(session.cliId)) {
            const readiness = this.evaluateSessionReadiness(session, output);
            if (!readiness.ready) {
              return {
                status: 'wrong_state',
                details: this.buildSessionReadinessDiagnostic(session, readiness.status, readiness.strictGateEnabled, output),
              };
            }
          }
        }
      } catch {
        // If we can't read output but the terminal is alive, proceed
      }
    }

    return { status: 'reusable', details: 'Session is alive and CLI is ready.' };
  }

  /**
   * Ensure a runtime is ready for a task.
   * This is the ONLY method that workflow activation may call.
   *
   * For fresh_process CLIs: always stops old sessions and launches fresh.
   * For reusable_interactive CLIs: validates existing session and reuses
   * only if idle/ready is provable.
   */
  async ensureRuntimeReadyForTask(args: CreateRuntimeArgs): Promise<RuntimeSession> {
    const strategy = getCliStrategy(args.cliId);
    const terminalId = args.terminalId;

    console.log(
      `[runtime] ensureRuntimeReadyForTask: cli=${args.cliId} mode=${strategy.workflowMode} terminal=${terminalId} node=${args.nodeId}`,
    );

    return this.withTerminalLock(terminalId, `ensure:${args.nodeId}`, () =>
      this.ensureRuntimeReadyForTaskInner(args, strategy),
    );
  }

  async startNodeRun(args: CreateRuntimeArgs): Promise<RuntimeSession> {
    return this.ensureRuntimeReadyForTask(args);
  }

  private async ensureRuntimeReadyForTaskInner(
    args: CreateRuntimeArgs,
    strategy: CliRuntimeStrategy,
  ): Promise<RuntimeSession> {
    const terminalId = args.terminalId;

    const expectedReuse: RuntimeReuseExpectation = {
      cliId: args.cliId,
      model: args.modelId ?? args.model ?? null,
      yolo: args.yolo,
      executionMode: args.executionMode,
      workspaceDir: args.workspaceDir ?? null,
    };

    const isWorkflowRun = !args.missionId.startsWith('adhoc-');
    let needsPtyDestroy = false;

    if (isWorkflowRun) {
      this.pruneRetainedSessionsForWorkflowRun(args.missionId);
    }

    const existing = this.findReusableSessionCandidate(args);
    if (existing && strategy.workflowMode === 'reusable_interactive' && !isWorkflowRun) {
      const validation = await this.validateSessionForReuse(existing.sessionId, expectedReuse);
      if (validation.status === 'reusable') {
        console.log(
          `[runtime] reusable runtime found; sending follow-up signal session=${existing.sessionId} terminal=${terminalId}`,
        );
        this.retireSession(existing);
        const reused = await this.createRuntimeForNode(args);
        this.claimTerminalOwnership(terminalId, reused.sessionId);
        this.wirePtyEvents(terminalId, reused.sessionId);
        await this.launchCli(reused.sessionId, args.activationPayload);
        return reused;
      }

      console.warn(
        `[runtime] existing session not reusable reason=${validation.status} cli=${args.cliId}; stopping and relaunching`,
      );
      await this.stopRuntimeAndWait(existing, `Session not reusable: ${validation.details}`, strategy);
      needsPtyDestroy = true;
    } else if (existing) {
      console.log(
        `[runtime] existing session found; stopping for fresh launch cli=${args.cliId} strategy=${strategy.workflowMode}`,
      );
      await this.stopRuntimeAndWait(existing, `Strategy ${strategy.workflowMode} requires fresh process`, strategy);
      needsPtyDestroy = true;
    }

    const conflictingSessions = Array.from(this.sessions.values()).filter(session =>
      session.terminalId === terminalId ||
      (session.missionId === args.missionId && session.nodeId === args.nodeId),
    );
    for (const conflict of conflictingSessions) {
      console.warn(
        `[runtime] stopping conflicting session session=${conflict.sessionId} cli=${conflict.cliId} model=${normalizeModelForReuse(conflict.model) ?? '<default>'} yolo=${conflict.yolo} terminal=${conflict.terminalId}`,
      );
      await this.stopRuntimeAndWait(
        conflict,
        `Conflicting runtime replaced by cli=${args.cliId} model=${normalizeModelForReuse(args.modelId ?? args.model) ?? '<default>'} yolo=${Boolean(args.yolo)}`,
        strategy,
      );
      needsPtyDestroy = true;
    }

    if (strategy.requiresPty) {
      if (isWorkflowRun) {
        // Flag the pane as runtime-managed BEFORE destroying the PTY.
        // TerminalPane reads this on remount — if set after destroy it always reads false.
        useWorkspaceStore.getState().updatePaneDataByTerminalId(terminalId, {
          runtimeManaged: true,
        });
        console.log(`[runtime] workflow run: unconditionally destroying terminal=${terminalId}`);
        await this.destroyAndWaitForTerminal(terminalId);
        terminalOutputBus.clear(terminalId);
      } else if (needsPtyDestroy) {
        const active = await isTerminalActive(terminalId);
        if (active) {
          console.warn(`[runtime] terminal ${terminalId} still active after stopping sessions; destroying for fresh launch`);
          await this.destroyAndWaitForTerminal(terminalId);
          terminalOutputBus.clear(terminalId);
        }
      }
    }

    const session = await this.createRuntimeForNode(args);
    this.claimTerminalOwnership(terminalId, session.sessionId);
    this.wirePtyEvents(terminalId, session.sessionId);
    this.bindRuntimeToTerminalPane(session);
    await this.launchCli(session.sessionId, args.activationPayload);
    return session;
  }

  async reinjectTask(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session) throw new Error(`No runtime session: ${sessionId}`);

    console.log(
      `[RuntimeManager] reinjectTask: sessionId="${sessionId}", nodeId="${session.nodeId}", cliId="${session.cliId}"`,
    );

    const activationPayload = this.buildActivationPayload(session);
    const baseUrl = await getMcpBaseUrl();
    const signal = session.cliId === 'codex'
      ? buildCodexFollowupTaskSignal({
          sessionId: session.sessionId,
          missionId: session.missionId,
          nodeId: session.nodeId,
          attempt: session.attempt,
        })
      : buildNewTaskSignal({
          missionId: session.missionId,
          nodeId: session.nodeId,
          roleId: session.role,
          sessionId: session.sessionId,
          agentId: session.agentId,
          terminalId: session.terminalId,
          activatedAt: Date.now(),
          attempt: session.attempt,
          payload: null,
          runId: `run-${session.sessionId}`,
          cliType: session.cliId,
          modelId: session.model || null,
          yolo: session.yolo,
          executionMode: session.executionMode,
          goal: session.goal,
          workspaceDir: session.workspaceDir,
          frontendMode: session.frontendMode,
          frontendCategory: session.frontendCategory,
          specProfile: session.specProfile,
          finalReadmeEnabled: session.finalReadmeEnabled,
          finalReadmeOwnerNodeId: session.finalReadmeOwnerNodeId,
          assignment: activationPayload.assignment,
        }, baseUrl);

    session.transitionTo('injecting_task');

    if (session.isHeadless) {
      await this.launchHeadless(session, activationPayload, signal, baseUrl);
    } else {
      await this.injectInteractiveTask(session, signal, false);
    }

    session.transitionTo('awaiting_ack');

    const taskAckTimeoutMs = taskAckTimeoutMsForCli(session.cliId);

    try {
      await this.waitForMcpState(
        session.sessionId,
        session.missionId,
        session.nodeId,
        session.attempt,
        'activation:acked',
        new Set(['activation_acked', 'running', 'completed', 'done']),
        taskAckTimeoutMs,
      );

      session.transitionTo('running');
      this.startRuntimeCompletionPoller(session);
      this.startPostAckNoProgressWatchdog(session);

      await acknowledgeActivation({
        missionId: session.missionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
        status: 'activation_acked',
      });

      this.emit({
        type: 'task_acked',
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
      });
      missionRepository.appendWorkflowEvent({
        missionId: session.missionId,
        nodeId: session.nodeId,
        sessionId: session.sessionId,
        eventType: 'task_acknowledged',
        severity: 'info',
        message: `Task acknowledged by agent in session ${session.sessionId}`,
      }).catch(() => {});
    } catch {
      throw new Error(
        `Agent for CLI "${session.cliId}" on node "${session.nodeId}" did not ACK re-injected task within ${Math.round(taskAckTimeoutMs / 1000)}s.`,
      );
    }
  }

  // ── Query Methods ──────────────────────────────────────────────

  getSession(sessionId: string): RuntimeSession | undefined {
    return this.sessions.get(sessionId);
  }

  getSessionForNode(missionId: string, nodeId: string, attempt: number): RuntimeSession | undefined {
    const key = `${missionId}:${nodeId}:${attempt}`;
    const sessionId = this.sessionsByNode.get(key);
    if (!sessionId) return undefined;
    return this.sessions.get(sessionId);
  }

  getActiveSessions(): RuntimeSession[] {
    return Array.from(this.sessions.values()).filter(
      s => !isRuntimeSessionTerminal(s.state),
    );
  }

  getAllSessions(): RuntimeSession[] {
    return Array.from(this.sessions.values());
  }

  snapshot(): RuntimeManagerSnapshot {
    const sessions = Array.from(this.sessions.values()).map(s => {
      const d = s.toDescriptor();
      return {
        sessionId: d.sessionId,
        missionId: d.missionId,
        nodeId: d.nodeId,
        attempt: d.attempt,
        role: d.role,
        agentId: d.agentId,
        cliId: d.cliId,
        executionMode: d.executionMode,
        terminalId: d.terminalId,
        paneId: d.paneId,
        workspaceDir: d.workspaceDir,
        state: d.state,
        lastHeartbeatAt: d.lastHeartbeatAt,
        lastError: d.lastError,
        activePermission: d.activePermission,
        createdAt: d.createdAt,
      };
    });
    const liveSessionIds = new Set(sessions.map(s => s.sessionId));
    const retainedSessions = Array.from(this.retainedSessions.values())
      .filter(d => !liveSessionIds.has(d.sessionId))
      .map(d => ({
        sessionId: d.sessionId,
        missionId: d.missionId,
        nodeId: d.nodeId,
        attempt: d.attempt,
        role: d.role,
        agentId: d.agentId,
        cliId: d.cliId,
        executionMode: d.executionMode,
        terminalId: d.terminalId,
        paneId: d.paneId,
        workspaceDir: d.workspaceDir,
        state: d.state,
        lastHeartbeatAt: d.lastHeartbeatAt,
        lastError: d.lastError,
        activePermission: d.activePermission,
        createdAt: d.createdAt,
      }));

    return {
      sessions: [...sessions, ...retainedSessions],
      activeCount: sessions.filter(s =>
        !isRuntimeSessionTerminal(s.state),
      ).length,
    };
  }

  // ── Subscription ──────────────────────────────────────────────

  subscribe(listener: ManagerListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  subscribeSnapshot(listener: SnapshotListener): () => void {
    this.snapshotListeners.add(listener);
    return () => {
      this.snapshotListeners.delete(listener);
    };
  }

  // ── MCP Event Wiring ──────────────────────────────────────────

  wireMcpEvents(sessionId: string): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) return () => {};

    return mcpBus.subscribe(sessionId, event => {
      if (!this.isCurrentOwner(session)) {
        console.log(
          `[runtime] stale MCP event ignored type=${event.type} session=${sessionId}`,
        );
        return;
      }

      this.emit({
        type: 'mcp_event_observed',
        sessionId,
        nodeId: session.nodeId,
        mcpType: event.type,
        at: event.at,
      });
      this.recordPostAckMcpProgress(session, event.type);

      if (event.type === 'agent:heartbeat') {
        session.updateHeartbeat(event.at);
        this.emit({ type: 'heartbeat', sessionId, nodeId: session.nodeId, at: event.at });
      }

      if (event.type === 'task:completed') {
        this.clearPostAckNoProgressWatchdog(session.sessionId);
        const outcome = (event.outcome === 'success' || event.outcome === 'failure')
          ? (event.outcome as 'success' | 'failure')
          : 'success';
        session.markCompleted();
        this.emit({
          type: 'session_completed',
          sessionId,
          nodeId: session.nodeId,
          outcome,
        });
        this.cleanupSession(session);
        if (session.cliId === 'codex' && session.terminalId) {
          this.destroyAndWaitForTerminal(session.terminalId).catch(err =>
            console.warn(`[codex] PTY destroy after task completion failed terminal=${session.terminalId}`, err),
          );
        }
        return;
      }

      if (event.type === 'agent:artifact') {
        const artifact = {
          id: event.key || `art-${event.at}-${Math.random().toString(36).slice(2, 7)}`,
          kind: (event.artifactType ?? 'reference') as any,
          label: event.label ?? 'Artifact',
          content: event.content,
          path: event.path,
          timestamp: event.at || Date.now(),
        };
        this.emit({
          type: 'artifact_published',
          sessionId,
          nodeId: session.nodeId,
          artifact,
        });
      }

      if (event.type === 'agent:disconnected') {
        const reason = event.reason ?? 'Runtime session disconnected from MCP.';
        session.markDisconnected(reason);
        this.emit({
          type: 'session_disconnected',
          sessionId,
          nodeId: session.nodeId,
          reason,
        });
        this.cleanupSession(session);
      }
    });
  }

  /**
   * Wire PTY spawn/exit listeners for a terminal.
   * Includes stale event protection: if the terminalId has been assigned
   * to a newer sessionId, old exit events are silently ignored.
   */
  wirePtyEvents(terminalId: string, sessionId: string): () => void {
    let unlistenSpawn: (() => void) | undefined;
    let unlistenExit: (() => void) | undefined;
    let disposed = false;

    listen<{ id: string }>('pty-spawned', event => {
      if (event.payload.id !== terminalId) return;
      const session = this.sessions.get(sessionId);
      if (!session) return;
    }).then(fn => {
      if (disposed) {
        fn();
      } else {
        unlistenSpawn = fn;
      }
    });

    const unlistenOutputBus = terminalOutputBus.subscribe(terminalId, event => {
      const session = this.sessions.get(sessionId);
      if (!session || isRuntimeSessionTerminal(session.state)) return;

      session.updateHeartbeat();
      this.emit({ type: 'heartbeat', sessionId, nodeId: session.nodeId, at: Date.now() });

      this.emit({
        type: 'output_captured',
        sessionId,
        nodeId: session.nodeId,
        text: event.text,
      });
      this.recordPostAckTerminalProgress(session, event.text);

      const perm = session.adapter.detectPermissionRequest(event.text);
      if (perm && session.state !== 'awaiting_permission') {
        const request = {
          ...perm.request,
          sessionId,
          nodeId: session.nodeId,
          detectedAt: Date.now(),
        };
        if (this.shouldSuppressPermissionDetection(session, request)) {
          return;
        }
        if (session.yolo) {
          void this.autoApproveYoloPermission(session, request);
          return;
        }
        session.setPermission(request);
        this.emit({
          type: 'permission_requested',
          sessionId,
          nodeId: session.nodeId,
          request,
        });
        this.recordPostAckProgress(session, 'permission_prompt');
      }

      const comp = session.adapter.detectCompletion(event.text);
      if (comp && session.state === 'running') {
        this.scheduleMissingMcpCompletionWatchdog(session, comp);
      }
    });
    const existingPtyCleanup = this.ptyCleanupFns.get(sessionId);
    this.ptyCleanupFns.set(sessionId, () => {
      existingPtyCleanup?.();
      unlistenOutputBus();
    });

    listen<{ id: string }>('pty-exit', async event => {
      if (event.payload.id !== terminalId) return;

      if (!this.isCurrentOwnerForTerminal(terminalId, sessionId)) {
        console.log(
          `[runtime] stale pty-exit ignored terminal=${terminalId} oldSession=${sessionId} (newer owner active)`,
        );
        return;
      }

      const session = this.sessions.get(sessionId);
      if (!session) return;

      const suppressUntil = this.suppressedPtyExitUntil.get(terminalId) ?? 0;
      if (Date.now() < suppressUntil) {
        console.warn(`[runtime] ignoring expected pty-exit during CLI relaunch terminal=${terminalId} cli=${session.cliId}`);
        return;
      }

      try {
        const stillAlive = await isTerminalActive(terminalId);
        if (stillAlive) return;
      } catch {
        // proceed — PTY was destroyed
      }

      const recentOutput = await getRecentTerminalOutput(terminalId, 12_288);
      const reason = session.cliId === 'codex'
        ? this.buildCodexCrashDiagnostic(session, {
            promptBytes: null,
            recentOutput,
            directPty: true,
          })
        : 'Terminal process exited.';
      const shouldFailForMissingCompletion = !isRuntimeSessionTerminal(session.state);
      session.markDisconnected(reason);

      if (shouldFailForMissingCompletion) {
        const failureReason = `pty_exited_without_completion: ${reason}`;
        session.markFailed(failureReason);
        this.emit({
          type: 'session_failed',
          sessionId,
          nodeId: session.nodeId,
          error: failureReason,
        });
      }

      await acknowledgeActivation({
        missionId: session.missionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
        status: shouldFailForMissingCompletion ? 'failed' : 'disconnected',
        reason: shouldFailForMissingCompletion ? `pty_exited_without_completion: ${reason}` : reason,
      });

      await notifyMcpDisconnected({
        sessionId,
        missionId: session.missionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
        reason,
      });

      this.cleanupSession(session);
    }).then(fn => {
      if (disposed) {
        fn();
      } else {
        unlistenExit = fn;
      }
    });

    return () => {
      disposed = true;
      unlistenSpawn?.();
      unlistenExit?.();
    };
  }

  private scheduleMissingMcpCompletionWatchdog(
    session: RuntimeSession,
    completion: CompletionDetectionResult,
  ): void {
    if (this.completionContractTimers.has(session.sessionId)) return;
    if (session.missionId.startsWith('adhoc-')) return;

    const nudgeTimer = setTimeout(() => {
      this.renudgeMissingMcpCompletion(session.sessionId, completion).catch(err => {
        console.warn(`[runtime] missing completion nudge failed session=${session.sessionId}`, err);
      });
    }, MISSING_MCP_COMPLETION_RENUDGE_MS);

    const failTimer = setTimeout(() => {
      this.failMissingMcpCompletion(session.sessionId, completion).catch(err => {
        console.warn(`[runtime] missing completion failure handling failed session=${session.sessionId}`, err);
      });
    }, MISSING_MCP_COMPLETION_FAIL_MS);

    this.completionContractTimers.set(session.sessionId, { nudgeTimer, failTimer });
  }

  private clearCompletionContractWatchdog(sessionId: string): void {
    const timers = this.completionContractTimers.get(sessionId);
    if (!timers) return;
    if (timers.nudgeTimer) clearTimeout(timers.nudgeTimer);
    if (timers.failTimer) clearTimeout(timers.failTimer);
    this.completionContractTimers.delete(sessionId);
  }

  private startPostAckNoProgressWatchdog(session: RuntimeSession): void {
    if (session.missionId.startsWith('adhoc-')) return;

    this.clearPostAckNoProgressWatchdog(session.sessionId);
    const now = Date.now();
    const expectedFiles = extractExpectedOutputFiles(
      `${session.goal ?? ''}\n${session.instructionOverride ?? ''}`,
    );
    this.postAckNoProgressWatchdogs.set(session.sessionId, {
      acknowledgedAt: now,
      lastProgressAt: now,
      progressCount: 0,
      mcpEventCount: 0,
      terminalProgressCount: 0,
      expectedFileOutputCount: 0,
      permissionPromptCount: 0,
      expectedFiles,
      expectedFileSignatures: new Map(),
      warnedAt: null,
    });
    this.schedulePostAckNoProgressWatchdog(session.sessionId);
  }

  private clearPostAckNoProgressWatchdog(sessionId: string): void {
    const state = this.postAckNoProgressWatchdogs.get(sessionId);
    if (!state) return;
    if (state.nudgeTimer) clearTimeout(state.nudgeTimer);
    if (state.failTimer) clearTimeout(state.failTimer);
    this.postAckNoProgressWatchdogs.delete(sessionId);
  }

  private schedulePostAckNoProgressWatchdog(sessionId: string): void {
    const state = this.postAckNoProgressWatchdogs.get(sessionId);
    if (!state) return;
    if (state.nudgeTimer) clearTimeout(state.nudgeTimer);
    if (state.failTimer) clearTimeout(state.failTimer);

    const now = Date.now();
    const nudgeAt = state.lastProgressAt + POST_ACK_NO_PROGRESS_WINDOW_MS;
    const failAt = state.lastProgressAt + (POST_ACK_NO_PROGRESS_WINDOW_MS * 2);
    state.nudgeTimer = setTimeout(() => {
      this.handlePostAckNoProgressNudge(sessionId).catch(error => {
        console.warn(`[runtime] post-ack no-progress nudge failed session=${sessionId}`, error);
      });
    }, Math.max(0, nudgeAt - now));
    state.failTimer = setTimeout(() => {
      this.handlePostAckNoProgressFailure(sessionId).catch(error => {
        console.warn(`[runtime] post-ack no-progress failure handling failed session=${sessionId}`, error);
      });
    }, Math.max(0, failAt - now));
  }

  private getPostAckSnapshot(state: PostAckNoProgressWatchdogState): PostAckProgressSnapshot {
    return {
      acknowledgedAt: state.acknowledgedAt,
      lastProgressAt: state.lastProgressAt,
      progressCount: state.progressCount,
      mcpEventCount: state.mcpEventCount,
      terminalProgressCount: state.terminalProgressCount,
      expectedFileOutputCount: state.expectedFileOutputCount,
      permissionPromptCount: state.permissionPromptCount,
      lastProgressSource: state.lastProgressSource,
      warnedAt: state.warnedAt,
    };
  }

  private recordPostAckProgress(
    session: RuntimeSession,
    source: PostAckProgressSource,
    detail: { mcpType?: string; file?: string; terminalPreview?: string } = {},
  ): void {
    const state = this.postAckNoProgressWatchdogs.get(session.sessionId);
    if (!state || isRuntimeSessionTerminal(session.state) || !this.isCurrentOwner(session)) return;

    state.lastProgressAt = Date.now();
    state.progressCount += 1;
    state.lastProgressSource = source;
    state.warnedAt = null;

    if (source === 'mcp_event') {
      state.mcpEventCount += 1;
      state.lastMcpEventType = detail.mcpType;
    } else if (source === 'terminal_output' || source === 'known_long_running_progress') {
      state.terminalProgressCount += 1;
      state.lastTerminalProgressPreview = detail.terminalPreview;
    } else if (source === 'expected_file_output') {
      state.expectedFileOutputCount += 1;
      state.lastExpectedFile = detail.file;
    } else if (source === 'permission_prompt') {
      state.permissionPromptCount += 1;
    }

    this.schedulePostAckNoProgressWatchdog(session.sessionId);
  }

  private recordPostAckMcpProgress(session: RuntimeSession, mcpType: string): void {
    if (mcpType === 'task:completed') return;
    if (!isMeaningfulPostAckMcpEvent(mcpType)) return;
    this.recordPostAckProgress(session, 'mcp_event', { mcpType });
  }

  private recordPostAckTerminalProgress(session: RuntimeSession, text: string): void {
    const state = this.postAckNoProgressWatchdogs.get(session.sessionId);
    if (!state) return;

    const assessment = assessPostAckTerminalProgress(text);
    if (!assessment.useful || !assessment.signature || !assessment.source) return;
    if (assessment.signature === state.lastTerminalSignature && assessment.source !== 'known_long_running_progress') return;

    state.lastTerminalSignature = assessment.signature;
    this.recordPostAckProgress(session, assessment.source, {
      terminalPreview: assessment.preview,
    });
  }

  private async maybeRecordExpectedFileProgress(
    session: RuntimeSession,
    state: PostAckNoProgressWatchdogState,
  ): Promise<boolean> {
    if (!session.workspaceDir || state.expectedFiles.length === 0) return false;

    let invokeFn: <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    try {
      const core = await import('@tauri-apps/api/core');
      invokeFn = core.invoke as <T>(cmd: string, args?: Record<string, unknown>) => Promise<T>;
    } catch {
      return false;
    }

    for (const file of state.expectedFiles) {
      const path = joinWorkspaceOutputPath(session.workspaceDir, file);
      try {
        const content = await invokeFn<string>('workspace_read_text_file', { path });
        const signature = fileContentSignature(content);
        if (state.expectedFileSignatures.get(file) !== signature) {
          state.expectedFileSignatures.set(file, signature);
          this.recordPostAckProgress(session, 'expected_file_output', { file });
          return true;
        }
      } catch {
        // Missing or unreadable expected output is not progress.
      }
    }

    return false;
  }

  private async maybeRecordManagedCliActiveWorkProgress(session: RuntimeSession): Promise<boolean> {
    if (!new Set(['gemini', 'opencode']).has(session.cliId) || !session.terminalId) return false;

    let recentOutput = '';
    try {
      recentOutput = await getRecentTerminalOutput(session.terminalId, 12_288);
    } catch {
      return false;
    }

    const status = session.adapter.detectStatus(recentOutput);
    if (!isManagedCliActiveWorkStatus(status)) return false;

    this.recordPostAckProgress(session, 'known_long_running_progress', {
      terminalPreview: status.detail,
    });
    this.appendPostAckWatchdogWorkflowEvent(
      session,
      'warning',
      'post_ack_watchdog_cli_active_work',
      `${session.cliId} is still reporting active work: ${status.detail}`,
      'post_ack_no_mcp_completion',
      0,
      this.postAckNoProgressWatchdogs.get(session.sessionId) ?? {
        acknowledgedAt: Date.now(),
        lastProgressAt: Date.now(),
        progressCount: 0,
        mcpEventCount: 0,
        terminalProgressCount: 0,
        expectedFileOutputCount: 0,
        permissionPromptCount: 0,
        expectedFiles: [],
        expectedFileSignatures: new Map(),
        warnedAt: null,
      },
    );
    return true;
  }

  private async handlePostAckNoProgressNudge(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const state = this.postAckNoProgressWatchdogs.get(sessionId);
    if (!session || !state || !this.isCurrentOwner(session) || isRuntimeSessionTerminal(session.state)) {
      this.clearPostAckNoProgressWatchdog(sessionId);
      return;
    }
    if (this.completionContractTimers.has(sessionId)) return;
    if (await this.settleSessionFromRuntimeRecord(sessionId, 'post_ack_no_progress_pre_nudge')) return;
    if (session.state === 'awaiting_permission' || session.activePermission) {
      this.recordPostAckProgress(session, 'permission_prompt');
      return;
    }
    if (await this.maybeRecordExpectedFileProgress(session, state)) return;
    if (await this.maybeRecordManagedCliActiveWorkProgress(session)) return;

    const decision = evaluatePostAckWatchdog({
      snapshot: this.getPostAckSnapshot(state),
      now: Date.now(),
      windowMs: POST_ACK_NO_PROGRESS_WINDOW_MS,
      maxRuntimeMs: POST_ACK_NO_MCP_COMPLETION_MAX_MS,
      blockedOnPermission: Boolean(session.activePermission),
    });
    if (decision.action !== 'nudge' || !decision.reason) {
      this.schedulePostAckNoProgressWatchdog(sessionId);
      return;
    }

    const reason = decision.reason;
    state.warnedAt = Date.now();
    const message = this.buildPostAckWatchdogMessage(session, reason, decision.idleMs);
    this.emit({
      type: 'post_ack_watchdog',
      sessionId,
      nodeId: session.nodeId,
      action: 'nudge',
      reason,
      idleMs: decision.idleMs,
      windowMs: POST_ACK_NO_PROGRESS_WINDOW_MS,
      progress: this.getPostAckSnapshot(state),
      message,
    });
    this.appendPostAckWatchdogWorkflowEvent(session, 'warning', `${reason}_nudge`, message, reason, decision.idleMs, state);

    if (!session.isTerminal) return;
    if (session.cliId === 'gemini' && reason === 'post_ack_no_mcp_completion') {
      const recentOutput = session.terminalId
        ? await getRecentTerminalOutput(session.terminalId, 12_288).catch(() => '')
        : '';
      const readiness = recentOutput ? this.evaluateSessionReadiness(session, recentOutput) : null;
      if (readiness?.ready) {
        this.appendPostAckWatchdogWorkflowEvent(
          session,
          'warning',
          'post_ack_watchdog_nudge_resumed',
          'Gemini is idle, so the post-ACK completion nudge will be injected instead of deferred.',
          reason,
          decision.idleMs,
          state,
        );
      } else {
        this.appendPostAckWatchdogWorkflowEvent(
          session,
          'warning',
          'post_ack_watchdog_nudge_deferred',
          'Gemini post-ACK completion nudge was deferred because Gemini queues managed input while a turn is still running.',
          reason,
          decision.idleMs,
          state,
        );
        return;
      }
    }
    const prompt = this.buildPostAckNudgePrompt(session, reason, decision.idleMs);
    await this.injectInteractivePrompt(session, prompt, true).catch(error => {
      const errorMessage = error instanceof Error ? error.message : String(error);
      this.appendPostAckWatchdogWorkflowEvent(
        session,
        'warning',
        'post_ack_watchdog_nudge_injection_failed',
        `Post-ACK watchdog could not inject a nudge: ${errorMessage}`,
        reason,
        decision.idleMs,
        state,
      );
    });
  }

  private async handlePostAckNoProgressFailure(sessionId: string): Promise<void> {
    const session = this.sessions.get(sessionId);
    const state = this.postAckNoProgressWatchdogs.get(sessionId);
    if (!session || !state || !this.isCurrentOwner(session) || isRuntimeSessionTerminal(session.state)) {
      this.clearPostAckNoProgressWatchdog(sessionId);
      return;
    }
    if (this.completionContractTimers.has(sessionId)) return;
    if (await this.settleSessionFromRuntimeRecord(sessionId, 'post_ack_no_progress_pre_fail')) return;
    if (session.state === 'awaiting_permission' || session.activePermission) {
      this.recordPostAckProgress(session, 'permission_prompt');
      return;
    }
    if (await this.maybeRecordExpectedFileProgress(session, state)) return;
    if (await this.maybeRecordManagedCliActiveWorkProgress(session)) return;

    const decision = evaluatePostAckWatchdog({
      snapshot: this.getPostAckSnapshot(state),
      now: Date.now(),
      windowMs: POST_ACK_NO_PROGRESS_WINDOW_MS,
      maxRuntimeMs: POST_ACK_NO_MCP_COMPLETION_MAX_MS,
      blockedOnPermission: Boolean(session.activePermission),
    });
    if (decision.action === 'nudge') {
      await this.handlePostAckNoProgressNudge(sessionId);
      return;
    }
    if (decision.action !== 'fail' || !decision.reason) {
      this.schedulePostAckNoProgressWatchdog(sessionId);
      return;
    }

    const reason = this.buildPostAckWatchdogMessage(session, decision.reason, decision.idleMs);
    session.markFailed(reason);
    this.emit({
      type: 'post_ack_watchdog',
      sessionId,
      nodeId: session.nodeId,
      action: 'fail',
      reason: decision.reason,
      idleMs: decision.idleMs,
      windowMs: POST_ACK_NO_PROGRESS_WINDOW_MS,
      progress: this.getPostAckSnapshot(state),
      message: reason,
    });
    this.emit({
      type: 'session_failed',
      sessionId,
      nodeId: session.nodeId,
      error: reason,
    });

    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'failed',
      reason,
    }).catch(() => {});
    await emit('workflow-node-update', {
      id: session.nodeId,
      status: 'failed',
      attempt: session.attempt,
      message: reason,
    }).catch(() => {});

    this.appendPostAckWatchdogWorkflowEvent(session, 'error', decision.reason, reason, decision.reason, decision.idleMs, state);
    this.cleanupSession(session);
    if (session.terminalId) {
      this.destroyAndWaitForTerminal(session.terminalId).catch(err =>
        console.warn(`[runtime] PTY destroy after post-ack watchdog failure failed terminal=${session.terminalId}`, err),
      );
    }
  }

  private buildPostAckWatchdogMessage(
    session: RuntimeSession,
    reason: PostAckWatchdogReason,
    idleMs: number,
  ): string {
    const seconds = Math.round(idleMs / 1000);
    if (reason === 'post_ack_no_mcp_completion') {
      return `post_ack_no_mcp_completion: Node "${session.nodeId}" acknowledged the task and produced progress, but no task:completed MCP event arrived and activity then stalled for ${seconds}s.`;
    }
    return `post_ack_no_progress: Node "${session.nodeId}" acknowledged the task but produced no MCP completion, meaningful MCP progress, expected file output, permission prompt, or useful terminal progress for ${seconds}s.`;
  }

  private buildPostAckNudgePrompt(
    session: RuntimeSession,
    reason: PostAckWatchdogReason,
    idleMs: number,
  ): string {
    const seconds = Math.round(idleMs / 1000);
    const base = `Terminal Docks still has missionId="${session.missionId}" nodeId="${session.nodeId}" attempt=${session.attempt} marked running.`;
    if (reason === 'post_ack_no_mcp_completion') {
      return [
        base,
        `It has seen progress but no complete_task MCP call for ${seconds}s.`,
        'If the node is done, call complete_task now. If you are still working, produce concrete terminal/tool progress or write a progress artifact.',
      ].join(' ');
    }
    return [
      base,
      `It has not seen useful progress for ${seconds}s after task acknowledgement.`,
      'If you are working, produce concrete terminal/tool progress or write a progress artifact. If the node is done, call complete_task now.',
    ].join(' ');
  }

  private appendPostAckWatchdogWorkflowEvent(
    session: RuntimeSession,
    severity: 'warning' | 'error',
    eventType: string,
    message: string,
    reason: PostAckWatchdogReason,
    idleMs: number,
    state: PostAckNoProgressWatchdogState,
  ): void {
    missionRepository.appendWorkflowEvent({
      missionId: session.missionId,
      nodeId: session.nodeId,
      sessionId: session.sessionId,
      terminalId: session.terminalId,
      eventType,
      severity,
      message,
      payloadJson: JSON.stringify({
        reason,
        idleMs,
        windowMs: POST_ACK_NO_PROGRESS_WINDOW_MS,
        progress: this.getPostAckSnapshot(state),
        expectedFiles: state.expectedFiles,
        lastExpectedFile: state.lastExpectedFile ?? null,
        lastMcpEventType: state.lastMcpEventType ?? null,
        lastTerminalProgressPreview: state.lastTerminalProgressPreview ?? null,
      }),
    }).catch(() => {});
  }

  private startRuntimeCompletionPoller(session: RuntimeSession): void {
    if (session.missionId.startsWith('adhoc-')) return;
    if (this.runtimeCompletionPollers.has(session.sessionId)) return;

    const sessionId = session.sessionId;
    const timer = setInterval(() => {
      const entry = this.runtimeCompletionPollers.get(sessionId);
      const current = this.sessions.get(sessionId);
      if (!entry || !current || isRuntimeSessionTerminal(current.state) || !this.isCurrentOwner(current)) {
        this.clearRuntimeCompletionPoller(sessionId);
        return;
      }
      if (entry.inFlight) return;

      entry.inFlight = true;
      this.settleSessionFromRuntimeRecord(sessionId, 'runtime_completion_poll')
        .catch(error => {
          console.warn(`[runtime] runtime completion poll failed session=${sessionId}`, error);
        })
        .finally(() => {
          const latest = this.runtimeCompletionPollers.get(sessionId);
          if (latest) latest.inFlight = false;
        });
    }, RUNTIME_COMPLETION_POLL_MS);

    this.runtimeCompletionPollers.set(sessionId, { timer, inFlight: false });
  }

  private clearRuntimeCompletionPoller(sessionId: string): void {
    const poller = this.runtimeCompletionPollers.get(sessionId);
    if (!poller) return;
    clearInterval(poller.timer);
    this.runtimeCompletionPollers.delete(sessionId);
  }

  private async renudgeMissingMcpCompletion(
    sessionId: string,
    completion: CompletionDetectionResult,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.isCurrentOwner(session) || isRuntimeSessionTerminal(session.state)) return;
    if (await this.settleSessionFromRuntimeRecord(sessionId, 'missing_mcp_completion_pre_nudge')) return;

    this.emit({
      type: 'completion_contract_missing',
      sessionId,
      nodeId: session.nodeId,
      outcome: completion.outcome,
      action: 'renudge',
      summary: completion.summary,
    });

    missionRepository.appendWorkflowEvent({
      missionId: session.missionId,
      nodeId: session.nodeId,
      sessionId: session.sessionId,
      terminalId: session.terminalId,
      eventType: 'missing_mcp_completion_nudge',
      severity: 'warning',
      message: `Agent output appeared complete but MCP complete_task has not succeeded for ${session.nodeId}.`,
      payloadJson: JSON.stringify({
        outcome: completion.outcome,
        summary: completion.summary ?? null,
      }),
    }).catch(() => {});

    if (!session.isTerminal) return;
    const prompt = [
      `Terminal Docks still has missionId="${session.missionId}" nodeId="${session.nodeId}" attempt=${session.attempt} marked running.`,
      'A normal final answer does not complete a graph node.',
      `Call the Terminal Docks MCP tool complete_task with missionId="${session.missionId}", nodeId="${session.nodeId}", attempt=${session.attempt}, outcome="success" or "failure", and a concise summary now.`,
    ].join(' ');
    await this.injectInteractivePrompt(session, prompt, true);
  }

  private async failMissingMcpCompletion(
    sessionId: string,
    completion: CompletionDetectionResult,
  ): Promise<void> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.isCurrentOwner(session) || isRuntimeSessionTerminal(session.state)) return;
    if (await this.settleSessionFromRuntimeRecord(sessionId, 'missing_mcp_completion_pre_fail')) return;

    const reason = `missing_mcp_completion: CLI output indicated "${completion.outcome}" but MCP complete_task did not arrive within ${MISSING_MCP_COMPLETION_FAIL_MS}ms.`;
    session.markFailed(reason);
    this.emit({
      type: 'completion_contract_missing',
      sessionId,
      nodeId: session.nodeId,
      outcome: completion.outcome,
      action: 'failed',
      summary: completion.summary,
      error: reason,
    });
    this.emit({
      type: 'session_failed',
      sessionId,
      nodeId: session.nodeId,
      error: reason,
    });

    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'failed',
      reason,
    }).catch(() => {});
    await emit('workflow-node-update', {
      id: session.nodeId,
      status: 'failed',
      attempt: session.attempt,
      message: reason,
    }).catch(() => {});

    missionRepository.appendWorkflowEvent({
      missionId: session.missionId,
      nodeId: session.nodeId,
      sessionId: session.sessionId,
      terminalId: session.terminalId,
      eventType: 'missing_mcp_completion',
      severity: 'error',
      message: reason,
      payloadJson: JSON.stringify({
        outcome: completion.outcome,
        summary: completion.summary ?? null,
      }),
    }).catch(() => {});

    this.cleanupSession(session);
    if (session.terminalId) {
      this.destroyAndWaitForTerminal(session.terminalId).catch(err =>
        console.warn(`[runtime] PTY destroy after missing completion failed terminal=${session.terminalId}`, err),
      );
    }
  }

  private async settleSessionFromRuntimeRecord(sessionId: string, source: string): Promise<boolean> {
    const session = this.sessions.get(sessionId);
    if (!session || !this.isCurrentOwner(session)) return false;
    if (isRuntimeSessionTerminal(session.state)) return true;

    try {
      const { invoke } = await import('@tauri-apps/api/core');
      type ActivationRecord = { status?: string; status_reason?: string | null };
      const record = await invoke<ActivationRecord | null>('get_runtime_activation', {
        missionId: session.missionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
      });
      const status = record?.status?.toLowerCase() ?? '';
      if (status !== 'completed' && status !== 'done' && status !== 'failed') return false;

      this.clearCompletionContractWatchdog(session.sessionId);
      const outcome: 'success' | 'failure' = status === 'failed' ? 'failure' : 'success';
      const message = `Recovered ${session.nodeId} completion from runtime database after missed MCP event (${source}).`;

      missionRepository.appendWorkflowEvent({
        missionId: session.missionId,
        nodeId: session.nodeId,
        sessionId: session.sessionId,
        terminalId: session.terminalId,
        eventType: 'runtime_completion_recovered',
        severity: outcome === 'failure' ? 'warning' : 'info',
        message,
        payloadJson: JSON.stringify({
          source,
          status,
          statusReason: record?.status_reason ?? null,
        }),
      }).catch(() => {});

      if (outcome === 'success') {
        session.markCompleted();
        this.emit({
          type: 'session_completed',
          sessionId: session.sessionId,
          nodeId: session.nodeId,
          outcome,
        });
      } else {
        const reason = record?.status_reason || `Runtime database reports node ${session.nodeId} failed.`;
        session.markFailed(reason);
        this.emit({
          type: 'session_failed',
          sessionId: session.sessionId,
          nodeId: session.nodeId,
          error: reason,
        });
      }

      this.cleanupSession(session);
      if (session.cliId === 'codex' && session.terminalId) {
        this.destroyAndWaitForTerminal(session.terminalId).catch(err =>
          console.warn(`[codex] PTY destroy after recovered completion failed terminal=${session.terminalId}`, err),
        );
      }
      return true;
    } catch (error) {
      console.warn(`[runtime] failed to inspect runtime activation record session=${sessionId}`, error);
      return false;
    }
  }

  // ── Terminal Ownership ──────────────────────────────────────────

  private claimTerminalOwnership(terminalId: string, sessionId: string): void {
    const prev = this.terminalOwners.get(terminalId);
    if (prev && prev !== sessionId) {
      console.log(
        `[runtime] terminal ownership transferred terminal=${terminalId} from=${prev.slice(0, 12)} to=${sessionId.slice(0, 12)}`,
      );
    }
    this.terminalOwners.set(terminalId, sessionId);
  }

  private releaseTerminalOwnership(terminalId: string, sessionId: string): void {
    if (this.terminalOwners.get(terminalId) === sessionId) {
      this.terminalOwners.delete(terminalId);
      console.log(`[runtime] terminal ownership released terminal=${terminalId} session=${sessionId.slice(0, 12)}`);
    }
  }

  private isCurrentOwner(session: RuntimeSession): boolean {
    return this.terminalOwners.get(session.terminalId) === session.sessionId;
  }

  private isCurrentOwnerForTerminal(terminalId: string, sessionId: string): boolean {
    return this.terminalOwners.get(terminalId) === sessionId;
  }

  // ── Safe PTY Operations ──────────────────────────────────────────

  private async safeSpawnTerminal(
    terminalId: string,
    opts: { rows: number; cols: number; cwd?: string | null; command?: string; args?: string[]; env?: Record<string, string> },
  ): Promise<void> {
    const active = await isTerminalActive(terminalId);
    if (active) {
      // TerminalPane's initPty() may have raced between our destroyAndWaitForTerminal call
      // and this check, spawning a new PTY. Destroy it and continue — we own this terminal.
      console.warn(`[runtime] terminal ${terminalId} still active at spawn (TerminalPane race); destroying before retry`);
      await this.destroyAndWaitForTerminal(terminalId);
      await sleep(150);
    }

    console.log(`[runtime] spawning CLI terminal=${terminalId} command=${opts.command ?? '<shell>'}`);
    missionRepository.appendWorkflowEvent({
      missionId: 'system',
      terminalId,
      eventType: 'terminal_spawn_requested',
      severity: 'info',
      message: `Terminal spawn requested for ${terminalId}`,
      payloadJson: JSON.stringify(opts),
    }).catch(() => {});

    try {
      await spawnTerminal({ id: terminalId, ...opts });
      missionRepository.appendWorkflowEvent({
        missionId: 'system',
        terminalId,
        eventType: 'terminal_spawn_success',
        severity: 'info',
        message: `Terminal ${terminalId} spawned successfully.`,
      }).catch(() => {});
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.includes('already exists')) {
        console.warn(`[runtime] PTY already exists on spawn; destroying and retrying terminal=${terminalId}`);
        await this.destroyAndWaitForTerminal(terminalId);
        await sleep(250);
        await spawnTerminal({ id: terminalId, ...opts });
      } else {
        throw err;
      }
    }
    console.log(`[runtime] spawn success terminal=${terminalId}`);
  }

  private async destroyAndWaitForTerminal(terminalId: string): Promise<void> {
    console.log(`[runtime] destroying terminal terminal=${terminalId}`);
    try {
      await destroyTerminal(terminalId);
    } catch (err) {
      console.warn(`[runtime] destroy terminal failed (may already be gone) terminal=${terminalId}`, err);
    }

    const deadline = Date.now() + PTY_DESTROY_WAIT_MS;
    while (Date.now() < deadline) {
      try {
        const active = await isTerminalActive(terminalId);
        if (!active) {
          console.log(`[runtime] PTY destroyed terminal=${terminalId}`);
          return;
        }
      } catch {
        return;
      }
      await sleep(PTY_DESTROY_POLL_MS);
    }
    console.warn(`[runtime] PTY destroy wait timed out terminal=${terminalId}`);
  }

  // ── Session Stop (inner, no lock) ──────────────────────────────

  private async stopRuntimeInner(
    session: RuntimeSession,
    reason: string,
    _strategy: CliRuntimeStrategy,
  ): Promise<void> {
    const alreadyTerminal = isRuntimeSessionTerminal(session.state);
    try {
      if (session.isTerminal && !alreadyTerminal) {
        await this.writeToTerminalOrFail(session, '\x03');
        await sleep(200);
        await this.writeToTerminalOrFail(session, '\x03');
      }
      session.markCancelled(reason);
    } catch {
      session.markCancelled(reason);
    }

    this.releaseTerminalOwnership(session.terminalId, session.sessionId);
    this.cleanupSession(session);
  }

  private async stopRuntimeAndWait(
    session: RuntimeSession,
    reason: string,
    strategy: CliRuntimeStrategy,
  ): Promise<void> {
    try {
      await this.stopRuntimeInner(session, reason, strategy);
    } catch {
      // best effort
    }

    if (strategy.requiresPty && session.terminalId) {
      try {
        const deadline = Date.now() + 3_000;
        while (Date.now() < deadline) {
          const active = await isTerminalActive(session.terminalId);
          if (!active) break;
          await sleep(100);
        }
      } catch {
        // ignore
      }
    }
  }

  private async withTerminalLock<T>(terminalId: string, label: string, fn: () => Promise<T>): Promise<T> {
    const release = await this.terminalLocks.acquire(terminalId, label);
    try {
      return await fn();
    } finally {
      release();
    }
  }

  // ── Internal: Activation Pipeline ──────────────────────────────────

  private async runActivationPipeline(
    session: RuntimeSession,
    activationPayload: import('../missionRuntime.js').RuntimeActivationPayload,
  ): Promise<void> {
    if (session.missionId.startsWith('adhoc-')) {
      session.transitionTo('launching_cli');
      if (session.isTerminal) {
        session.transitionTo('awaiting_cli_ready');
        this.bindRuntimeToTerminalPane(session);
        const terminalReady = await this.waitForTerminalReady(session.terminalId, 5_000);
        if (terminalReady && await this.shouldLaunchCliInTerminal(session)) {
          await sleep(CLI_LAUNCH_DELAY_MS);
          try {
            const launchCmd = buildPtyLaunchCommand(session.cliId, {
              model: session.model,
              yolo: session.yolo,
              workspaceDir: session.workspaceDir,
            });
            await this.writeToTerminalOrFail(session, `${launchCmd}\r`);
            useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
              cliSource: 'connect_agent',
              cli: session.cliId,
              model: session.model,
            });
          } catch {
            // PTY still not available — user can interact with the terminal manually
          }
        }
      }
      session.transitionTo('running');
      return;
    }

    const contract = getRuntimeBootstrapContract(session.cliId);
    const bootstrapRequest = contract
      ? buildRuntimeBootstrapRegistrationRequest(activationPayload)
      : null;

    session.transitionTo('launching_cli');

    // 1. Register dispatch with backend
    await registerActivationDispatch({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      sessionId: session.sessionId,
      agentId: session.agentId,
      terminalId: session.terminalId,
      activatedAt: Date.now(),
    });

    await registerTerminalMetadata({
      terminalId: session.terminalId,
      nodeId: session.nodeId,
      runtimeSessionId: session.sessionId,
      cli: session.cliId,
    });

    // 2. Check MCP health
    session.transitionTo('registering_mcp');
    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'mcp_connecting',
    });

    let mcpHealth = await checkMcpHealthDetailed({ timeoutMs: MCP_HEALTH_TIMEOUT_MS });
    for (let attempt = 1; !mcpHealth.ok && attempt < MCP_HEALTH_RETRY_ATTEMPTS; attempt += 1) {
      console.warn(
        `[runtime] MCP health check failed for node=${session.nodeId} session=${session.sessionId}; ` +
        `retrying ${attempt + 1}/${MCP_HEALTH_RETRY_ATTEMPTS}`,
        mcpHealth,
      );
      await sleep(MCP_HEALTH_RETRY_DELAY_MS);
      mcpHealth = await checkMcpHealthDetailed({ timeoutMs: MCP_HEALTH_TIMEOUT_MS });
    }
    if (!mcpHealth.ok) {
      const category = mcpHealth.timedOut ? 'mcp_health_timeout' : 'mcp_health_unavailable';
      const detail = mcpHealth.error ?? (mcpHealth.status ? `HTTP ${mcpHealth.status}` : 'unknown error');
      const message = `${category}: MCP health preflight failed after ${MCP_HEALTH_RETRY_ATTEMPTS} attempt(s) at ${mcpHealth.baseUrl}/health (${detail}); continuing to runtime registration.`;
      console.warn(`[runtime] ${message}`);
      missionRepository.appendWorkflowEvent({
        missionId: session.missionId,
        nodeId: session.nodeId,
        sessionId: session.sessionId,
        terminalId: session.terminalId,
        eventType: 'mcp_health_preflight_failed',
        severity: 'warning',
        message,
        payloadJson: JSON.stringify(mcpHealth),
      }).catch(() => {});
    }

    if (activationPayload.executionMode === 'manual') {
      console.log(`[RuntimeManager] Manual takeover for node ${session.nodeId}`);
      session.transitionTo('manual_takeover');
      missionRepository.appendWorkflowEvent({
        missionId: session.missionId,
        nodeId: session.nodeId,
        sessionId: session.sessionId,
        terminalId: session.terminalId,
        eventType: 'manual_takeover_requested',
        severity: 'warning',
        message: `Manual takeover requested for node ${session.nodeId}.`,
        payloadJson: JSON.stringify({
          attempt: session.attempt,
          cliId: session.cliId,
          executionMode: session.executionMode,
        }),
      }).catch(() => {});
      return;
    }

    let launchedCli = false;
    let startupPromptDeliveredViaLaunch = false;

    // 3. For interactive PTY: launch CLI in terminal if needed.
    if (session.isTerminal) {
      const isWorkflowRun = !session.missionId.startsWith('adhoc-');
      session.transitionTo('awaiting_cli_ready');

      if (!isWorkflowRun) {
        const terminalReady = await this.waitForTerminalReady(session.terminalId, 5_000);
        if (!terminalReady) {
          throw new Error(`Terminal ${session.terminalId} did not become active before CLI launch (state: awaiting_cli_ready, node: ${session.nodeId}).`);
        }
      }

      // Workflow runs always spawn fresh; adhoc checks if CLI is already running.
      const shouldLaunchCli = isWorkflowRun
        ? true
        : await this.shouldLaunchCliInTerminal(session);

      if (shouldLaunchCli) {
        await sleep(CLI_LAUNCH_DELAY_MS);
        if (isWorkflowRun) {
          const launchResult = await this.launchInteractiveWorkflowCliViaShell(session, activationPayload);
          startupPromptDeliveredViaLaunch = launchResult.promptDeliveredAtLaunch;
        } else {
          const launchCmd = buildPtyLaunchCommand(session.cliId, {
            model: session.model,
            yolo: session.yolo,
            workspaceDir: session.workspaceDir,
          });
          console.log(`[runtime] launch command=${redactSensitiveLaunchValue(launchCmd)}`);
          await this.writeToTerminalOrFail(session, `${launchCmd}\r`);
        }
        await sleep(CLI_STARTUP_WAIT_MS);
        launchedCli = true;
        useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
          cliSource: 'connect_agent',
          cli: session.cliId,
          model: session.model,
        });
      }
      if (isWorkflowRun && launchedCli) {
        // launchInteractiveWorkflowCliViaShell already waited for adapter readiness.
      } else {
        const cliReady = await this.waitForCliReady(session, CLI_READY_WAIT_MS);
        if (!cliReady) {
          const reason = launchedCli
            ? `CLI "${session.cliId}" did not report ready state within ${CLI_READY_WAIT_MS}ms after launch.`
            : `CLI "${session.cliId}" is not ready and launch was skipped by gate logic.`;
          throw new Error(this.readinessFailureReason(session, reason));
        }
      }
    }

    console.log(`[runtime] CLI ready cli=${session.cliId} terminal=${session.terminalId}`);

    // 4. Register session with MCP
    if (!contract || !bootstrapRequest) {
      throw new Error(`CLI "${session.cliId}" does not have a runtime bootstrap contract.`);
    }

    session.transitionTo('registering_mcp');
    console.log(`[runtime] registering MCP session session=${session.sessionId}`);

    const mcpReadyPromise = this.waitForMcpState(
      session.sessionId,
      session.missionId,
      session.nodeId,
      session.attempt,
      contract.handshakeEvent,
      new Set(['registered', 'ready', 'activation_acked', 'running', 'completed', 'done']),
      BOOTSTRAP_EVENT_TIMEOUT_MS,
    );

    const registration = await registerMcpSession(
      bootstrapRequest as import('./TerminalRuntime.js').McpRegistrationRequest,
      { timeoutMs: MCP_REGISTRATION_TIMEOUT_MS },
    );
    if (!registration?.ok) {
      void mcpReadyPromise.catch(() => {});
      const reason = registration?.message ?? registration?.error ?? 'Runtime registration was rejected by MCP.';
      throw new Error(reason.includes('mcp_registration_timeout') ? reason : `mcp_registration_failed: ${reason}`);
    }
    console.log(`[runtime] MCP registration result session=${session.sessionId} ok=${registration.ok} message=${registration.message ?? ''}`);

    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'registered',
    });

    let bootstrapPromptBody: string | null = null;
    if (session.isTerminal && !startupPromptDeliveredViaLaunch && !APP_REGISTERED_BOOTSTRAP_CLIS.has(session.cliId)) {
      session.transitionTo('bootstrap_injecting');

      let bootstrapPrompt: string | null = null;
      try {
        bootstrapPrompt = this.buildInteractiveBootstrapPrompt(
          session,
          activationPayload,
          await getMcpBaseUrl(),
        );
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `Bootstrap prompt build failed for CLI "${session.cliId}" on node "${session.nodeId}": ${msg}`,
        );
      }

      if (bootstrapPrompt) {
        try {
          bootstrapPromptBody = bootstrapPrompt.replace(/\r$/, '');
          console.log(`[runtime] injecting bootstrap prompt cli=${session.cliId} session=${session.sessionId}`);
          const injectResult = await Promise.race([
            this.injectInteractivePrompt(session, bootstrapPromptBody, false).then(() => true),
            sleep(BOOTSTRAP_INJECTION_TIMEOUT_MS).then(() => false),
          ]);

          if (!injectResult) {
            throw new Error(
              `Bootstrap prompt injection timed out (${BOOTSTRAP_INJECTION_TIMEOUT_MS}ms) for CLI "${session.cliId}" on node "${session.nodeId}".`,
            );
          }
          console.log(`[runtime] bootstrap prompt injected cli=${session.cliId} session=${session.sessionId}`);
        } catch (err) {
          const msg = err instanceof Error ? err.message : String(err);
          throw new Error(
            `Bootstrap prompt injection failed for CLI "${session.cliId}" on node "${session.nodeId}": ${msg}`,
          );
        }
      }

      session.transitionTo('bootstrap_sent');
    }

    session.transitionTo('awaiting_mcp_ready');
    console.log(`[runtime] waiting for agent:ready session=${session.sessionId}`);

    try {
      if (session.cliId === 'codex' && session.isTerminal && bootstrapPromptBody) {
        const bootstrapRace = await Promise.race([
          mcpReadyPromise.then(() => 'ready' as const),
          sleep(CODEX_BOOTSTRAP_RETRY_DELAY_MS).then(() => 'retry' as const),
        ]);
        if (bootstrapRace === 'retry') {
          await this.injectInteractivePrompt(session, bootstrapPromptBody, true);
        }
      }
      await mcpReadyPromise;
      console.log(`[runtime] agent ready received session=${session.sessionId}`);
    } catch {
      throw new Error(
        `Timed out waiting for "${contract.handshakeEvent}" from CLI "${session.cliId}" on node "${session.nodeId}" (${BOOTSTRAP_EVENT_TIMEOUT_MS}ms). ` +
        'The bootstrap prompt may not have been received or the agent failed to connect to MCP.',
      );
    }

    session.transitionTo('ready');

    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'ready',
    });

    session.transitionTo('injecting_task');

    const baseUrl = await getMcpBaseUrl();
    const signal = buildNewTaskSignal({
      missionId: session.missionId,
      nodeId: session.nodeId,
      roleId: session.role,
      sessionId: session.sessionId,
      agentId: session.agentId,
      terminalId: session.terminalId,
      activatedAt: Date.now(),
      attempt: session.attempt,
      payload: activationPayload.inputPayload ?? null,
      runId: activationPayload.runId,
      cliType: session.cliId,
      modelId: session.model || null,
      yolo: session.yolo,
      executionMode: session.executionMode,
      goal: activationPayload.goal,
      workspaceDir: session.workspaceDir,
      frontendMode: activationPayload.frontendMode,
      frontendCategory: activationPayload.frontendCategory,
      specProfile: activationPayload.specProfile,
      finalReadmeEnabled: activationPayload.finalReadmeEnabled,
      finalReadmeOwnerNodeId: activationPayload.finalReadmeOwnerNodeId,
      assignment: activationPayload.assignment,
    }, baseUrl);

    if (session.isHeadless) {
      await this.launchHeadless(session, activationPayload, signal, baseUrl);
    } else {
      const taskAlreadyFetched = await this.hasRuntimeActivationStatus(
        session,
        new Set(['activation_acked', 'running', 'completed', 'done']),
      );
      if (startupPromptDeliveredViaLaunch && session.cliId === 'gemini') {
        console.log(
          `[runtime] skipping task prompt injection cli=${session.cliId} session=${session.sessionId}; startup prompt carries MCP task context`,
        );
        this.emit({
          type: 'task_injected',
          sessionId: session.sessionId,
          nodeId: session.nodeId,
          attempt: session.attempt,
          promptBytes: 0,
          promptPreview: '<startup prompt carried task context>',
        });
      } else if (taskAlreadyFetched) {
        console.log(
          `[runtime] skipping task prompt injection cli=${session.cliId} session=${session.sessionId}; task already fetched from MCP`,
        );
        this.emit({
          type: 'task_injected',
          sessionId: session.sessionId,
          nodeId: session.nodeId,
          attempt: session.attempt,
          promptBytes: 0,
          promptPreview: '<task already fetched from MCP>',
        });
      } else {
        console.log(`[runtime] injecting task prompt cli=${session.cliId} session=${session.sessionId}`);
        await this.injectInteractiveTask(session, signal, false);
      }
    }

    session.transitionTo('awaiting_ack');

    const taskAckTimeoutMs = taskAckTimeoutMsForCli(session.cliId);

    try {
      await this.waitForTaskAckAndMarkRunning(session, taskAckTimeoutMs);
    } catch {
      if (startupPromptDeliveredViaLaunch && session.cliId === 'gemini') {
        const taskAlreadyFetched = await this.hasRuntimeActivationStatus(
          session,
          new Set(['activation_acked', 'running', 'completed', 'done']),
        );
        if (taskAlreadyFetched) {
          await this.waitForTaskAckAndMarkRunning(session, 1_000);
          return;
        }

        missionRepository.appendWorkflowEvent({
          missionId: session.missionId,
          nodeId: session.nodeId,
          sessionId: session.sessionId,
          terminalId: session.terminalId,
          eventType: 'gemini_startup_task_ack_retry',
          severity: 'warning',
          message: 'Gemini did not acknowledge the launch-time task prompt; retrying with managed prompt injection.',
        }).catch(() => {});
        await this.injectInteractiveTask(session, signal, true);
        session.transitionTo('awaiting_ack');
        try {
          await this.waitForTaskAckAndMarkRunning(session, taskAckTimeoutMs);
          return;
        } catch {
          // Fall through to the standard ACK error below.
        }
      }

      throw new Error(
        session.cliId === 'codex'
          ? `Codex did not fetch the current task from MCP. Try New Runtime or check MCP connection.`
          : `Agent for CLI "${session.cliId}" on node "${session.nodeId}" did not call get_task_details within ${Math.round(taskAckTimeoutMs / 1000)}s (state: awaiting_ack). Check terminal for errors.`,
      );
    }
  }

  private async waitForTaskAckAndMarkRunning(session: RuntimeSession, timeoutMs: number): Promise<void> {
    await this.waitForMcpState(
      session.sessionId,
      session.missionId,
      session.nodeId,
      session.attempt,
      'activation:acked',
      new Set(['activation_acked', 'running', 'completed', 'done']),
      timeoutMs,
    );

    session.transitionTo('running');
    this.startRuntimeCompletionPoller(session);
    this.startPostAckNoProgressWatchdog(session);

    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'activation_acked',
    });
    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'running',
    });

    this.emit({
      type: 'task_acked',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
    });
    missionRepository.appendWorkflowEvent({
      missionId: session.missionId,
      nodeId: session.nodeId,
      sessionId: session.sessionId,
      eventType: 'task_acknowledged',
      severity: 'info',
      message: `Task acknowledged by agent in session ${session.sessionId}`,
    }).catch(() => {});
  }

  private async launchHeadless(
    session: RuntimeSession,
    activationPayload: import('../missionRuntime.js').RuntimeActivationPayload,
    signal: string,
    mcpUrl: string,
  ): Promise<void> {
    const terminalConfig = this.getTerminalRuntimeConfig(session.terminalId);
    const { request, error } = buildStartAgentRunRequest(activationPayload, signal, {
      ...terminalConfig,
      mcpUrl,
      model: session.model || null,
      yolo: session.yolo,
    });

    if (!request || error) {
      throw new Error(error ?? 'Headless execution is not configured for this node.');
    }

    console.log(
      `[runtime] launch command=${redactSensitiveLaunchValue(request.command)} args=${formatLaunchArgsForLog(request.args)} cli=${session.cliId} model=${session.model || '<default>'} yolo=${session.yolo} promptDelivery=${request.promptDelivery} mode=${request.executionMode}`,
    );
    await startHeadlessRun(request as import('./TerminalRuntime.js').HeadlessRunRequest);
  }

  private async injectInteractiveTask(session: RuntimeSession, signal: string, retry: boolean): Promise<void> {
    const terminalAlive = await isTerminalActive(session.terminalId);
    if (!terminalAlive) {
      throw new Error(`Terminal process for ${session.nodeId} has exited.`);
    }

    if (session.cliId === 'codex' && !retry) {
      console.log(
        `[runtime] skipping follow-up task prompt injection cli=codex terminal=${session.terminalId}; startup prompt carries MCP task context`,
      );
      this.emit({
        type: 'task_injected',
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
        promptBytes: 0,
        promptPreview: '<startup prompt carried task context>',
      });
      return;
    }

    await sleep(CLI_STARTUP_WAIT_MS);
    if (!retry && await this.hasRuntimeActivationStatus(session, new Set(['activation_acked', 'running', 'completed', 'done']))) {
      console.log(
        `[runtime] skipping task prompt injection cli=${session.cliId} terminal=${session.terminalId}; task already fetched from MCP`,
      );
      this.emit({
        type: 'task_injected',
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
        promptBytes: 0,
        promptPreview: '<task already fetched from MCP>',
      });
      return;
    }
    console.log(`[runtime] injecting task prompt cli=${session.cliId} terminal=${session.terminalId}`);
    await this.injectInteractivePrompt(session, signal, retry);

    this.emit({
      type: 'task_injected',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      promptBytes: new TextEncoder().encode(signal).length,
      promptPreview: previewText(signal, 320) ?? '',
    });
  }

  private async launchInteractiveWorkflowCliViaShell(
    session: RuntimeSession,
    activationPayload: import('../missionRuntime.js').RuntimeActivationPayload,
  ): Promise<{ promptDeliveredAtLaunch: boolean }> {
    this.suppressedPtyExitUntil.set(session.terminalId, Date.now() + 5_000);

    await this.destroyAndWaitForTerminal(session.terminalId);

    const { rows, cols } = this.getTerminalDimensions(session.terminalId);
    const env: Record<string, string> = {
      TD_SESSION_ID: session.sessionId,
      TD_AGENT_ID: session.agentId,
      TD_MISSION_ID: session.missionId,
      TD_NODE_ID: session.nodeId,
      TD_ATTEMPT: String(session.attempt),
      TD_WORKSPACE: session.workspaceDir ?? '',
      TD_KIND: session.cliId,
    };
    if (session.cliId === 'codex' && session.workspaceDir?.trim()) {
      env.CODEX_HOME = joinRuntimePath(session.workspaceDir.trim(), '.terminal-docks', 'codex-home');
    }

    const launch = await this.buildInteractiveWorkflowShellLaunchCommand(session, activationPayload);
    const directLaunch = launch.command === 'codex' && launch.args?.length;

    if (directLaunch) {
      console.log(`[runtime] spawning workflow CLI directly terminal=${session.terminalId} cli=${session.cliId} args=${formatLaunchArgsForLog(launch.args ?? [], { redactLastArg: true })}`);
      await this.safeSpawnTerminal(session.terminalId, {
        rows,
        cols,
        cwd: session.workspaceDir ?? null,
        command: launch.command,
        args: launch.args,
        env,
      });
    } else {
      console.log('[runtime] spawning workflow shell', {
        terminalId: session.terminalId,
        cli: session.cliId,
      });

      await this.safeSpawnTerminal(session.terminalId, {
        rows,
        cols,
        cwd: session.workspaceDir ?? null,
        env,
      });
    }

    console.log(`[runtime] ${directLaunch ? 'direct CLI' : 'shell'} spawn success terminal=${session.terminalId} cli=${session.cliId}`);
    await resizeTerminal(session.terminalId, rows, cols).catch(() => {});
    await emit('terminal-refit-requested', { terminalId: session.terminalId }).catch(() => {});

    const terminalReady = await this.waitForTerminalReady(session.terminalId, 5_000);
    if (!terminalReady) {
      throw new Error(`Terminal ${session.terminalId} did not become active after ${directLaunch ? 'direct CLI' : 'shell'} spawn for CLI "${session.cliId}" (node: ${session.nodeId}).`);
    }

    if (!directLaunch) {
      await sleep(SHELL_LAUNCH_SETTLE_MS);
      const launchCmd = launch.command;

      console.log(`[runtime] writing CLI launch command: ${launch.promptDeliveredAtLaunch ? `${session.cliId} <startup-prompt:redacted>` : launchCmd}`);
      await this.writeToTerminalOrFail(session, `${launchCmd}\r`);
      await sleep(150);
    }
    await resizeTerminal(session.terminalId, rows, cols).catch(() => {});

    useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
      runtimeManaged: true,
      cli: session.cliId,
      cliSource: 'runtime_shell_launch',
      runtimeSessionId: session.sessionId,
      model: session.model,
    });

    await emit('terminal-refit-requested', { terminalId: session.terminalId }).catch(() => {});

    await sleep(CLI_STARTUP_WAIT_MS);
    if (launch.promptDeliveredAtLaunch) {
      console.log(`[runtime] CLI launch prompt already delivered cli=${session.cliId} terminal=${session.terminalId}; skipping idle prompt wait`);
    } else {
      const cliReady = await this.waitForCliReady(session, CLI_READY_WAIT_MS);
      if (!cliReady) {
        throw new Error(this.readinessFailureReason(
          session,
          `CLI "${session.cliId}" did not report ready state within ${CLI_READY_WAIT_MS}ms after shell launch.`,
        ));
      }
    }
    console.log(`[runtime] CLI ready cli=${session.cliId} terminal=${session.terminalId}`);
    missionRepository.appendWorkflowEvent({
      missionId: session.missionId,
      nodeId: session.nodeId,
      sessionId: session.sessionId,
      terminalId: session.terminalId,
      eventType: 'cli_ready',
      severity: 'info',
      message: `CLI ${session.cliId} reported ready in terminal ${session.terminalId}`,
    }).catch(() => {});

    setTimeout(() => {
      const suppressUntil = this.suppressedPtyExitUntil.get(session.terminalId) ?? 0;
      if (Date.now() >= suppressUntil - 4_000) {
        this.suppressedPtyExitUntil.delete(session.terminalId);
      }
    }, 6_000);

    return { promptDeliveredAtLaunch: launch.promptDeliveredAtLaunch };
  }

  private async buildInteractiveWorkflowShellLaunchCommand(
    session: RuntimeSession,
    activationPayload: import('../missionRuntime.js').RuntimeActivationPayload,
  ): Promise<{ command: string; args?: string[]; promptDeliveredAtLaunch: boolean }> {
    if (session.cliId === 'gemini') {
      const missionId = escapeGeminiStartupPromptValue(session.missionId);
      const nodeId = escapeGeminiStartupPromptValue(session.nodeId);
      const signal = [
        `NEW_TASK. First call get_task_details({ missionId: "${missionId}", nodeId: "${nodeId}" }) through the Terminal Docks MCP server.`,
        'Use the returned role instructions, task payload, inbox, and legal targets as the source of truth.',
        'Finish by calling complete_task or handoff_task through Terminal Docks MCP; do not stop after a normal final answer.',
      ].join(' ');
      return {
        command: buildGeminiInteractiveLaunchCommand({
          modelId: session.model || null,
          yolo: session.yolo,
          workspaceDir: session.workspaceDir,
          prompt: signal,
          shellKind: 'windows',
        }),
        promptDeliveredAtLaunch: true,
      };
    }

    if (session.cliId !== 'codex') {
      return {
        command: buildPtyLaunchCommand(session.cliId, {
          model: session.model,
          yolo: session.yolo,
          workspaceDir: session.workspaceDir,
        }),
        promptDeliveredAtLaunch: false,
      };
    }

    const bootstrapPrompt = this.buildInteractiveBootstrapPrompt(
      session,
      activationPayload,
      await getMcpBaseUrl(),
    ).replace(/\r$/, '');
    const resolvedYoloFlag = session.yolo ? await resolveCodexYoloFlag() : null;
    const trustedProjectDir = inferCodexTrustedProjectDir(session.workspaceDir);
    return {
      command: 'codex',
      args: buildCodexInteractiveLaunchArgs({
        modelId: session.model || null,
        yolo: session.yolo,
        workspaceDir: session.workspaceDir,
        mcpUrl: await getMcpUrl(),
        bootstrapPrompt,
        resolvedYoloFlag,
        disableKnownGlobalMcps: false,
        trustedProjectDir,
      }),
      promptDeliveredAtLaunch: true,
    };
  }

  private getTerminalDimensions(terminalId: string): { rows: number; cols: number } {
    const fallback = { rows: 24, cols: 80 };
    const panes = useWorkspaceStore.getState().tabs.flatMap(tab => tab.panes);
    const pane = panes.find(candidate =>
      candidate.type === 'terminal' && candidate.data?.terminalId === terminalId,
    );
    const rows = Number(pane?.data?.terminalRows);
    const cols = Number(pane?.data?.terminalCols);
    return {
      rows: Number.isFinite(rows) && rows >= 2 ? Math.floor(rows) : fallback.rows,
      cols: Number.isFinite(cols) && cols >= 20 ? Math.floor(cols) : fallback.cols,
    };
  }

  private formatCodexArgsForLog(args: string[] = []): string {
    return formatLaunchArgsForLog(args, { redactLastArg: true });
  }

  private buildCodexCrashDiagnostic(
    session: RuntimeSession,
    details: {
      args?: string[] | null;
      promptBytes?: number | null;
      recentOutput?: string | null;
      directPty?: boolean;
    } = {},
  ): string {
    const recentOutput = previewText(details.recentOutput, 1200) ?? '<none>';
    const args = details.args
      ? this.formatCodexArgsForLog(details.args)
      : '[<unknown>, <prompt:redacted>]';
    return [
      'Codex terminal exited early.',
      'command=codex',
      `args=${args}`,
      `model=${session.model || '<default>'}`,
      `yolo=${session.yolo}`,
      `cwd=${session.workspaceDir ?? '<none>'}`,
      `promptBytes=${details.promptBytes ?? '<unknown>'}`,
      `directPtyCommandSpawn=${details.directPty ?? true}`,
      `recentOutput=${recentOutput}`,
    ].join(' ');
  }

  private findReusableSessionCandidate(args: CreateRuntimeArgs): RuntimeSession | undefined {
    if (args.cliId !== 'codex') {
      return this.getSessionForNode(args.missionId, args.nodeId, args.attempt);
    }

    return Array.from(this.sessions.values()).find(session =>
      session.cliId === 'codex' &&
      !isRuntimeSessionTerminal(session.state) &&
      session.terminalId === args.terminalId &&
      (session.workspaceDir ?? null) === (args.workspaceDir ?? null),
    );
  }

  private permissionSignature(session: RuntimeSession, request: Pick<RuntimePermissionRequest, 'category' | 'rawPrompt' | 'detail'>): string {
    const prompt = (request.rawPrompt || request.detail || '')
      .replace(/\s+/g, ' ')
      .trim()
      .slice(-400);
    return `${session.sessionId}:${request.category}:${prompt}`;
  }

  private rememberPermissionSignature(session: RuntimeSession, request: Pick<RuntimePermissionRequest, 'category' | 'rawPrompt' | 'detail'>): void {
    const now = Date.now();
    this.recentPermissionSignatures.set(
      this.permissionSignature(session, request),
      now + PERMISSION_REDETECT_SUPPRESSION_MS,
    );

    for (const [key, expiresAt] of this.recentPermissionSignatures.entries()) {
      if (expiresAt <= now) this.recentPermissionSignatures.delete(key);
    }
  }

  private shouldSuppressPermissionDetection(session: RuntimeSession, request: RuntimePermissionRequest): boolean {
    const key = this.permissionSignature(session, request);
    const expiresAt = this.recentPermissionSignatures.get(key) ?? 0;
    if (expiresAt > Date.now()) return true;
    this.recentPermissionSignatures.delete(key);
    return false;
  }

  private async autoApproveYoloPermission(session: RuntimeSession, request: RuntimePermissionRequest): Promise<void> {
    this.rememberPermissionSignature(session, request);
    this.recordPostAckProgress(session, 'manual_input');

    if (!session.isTerminal) return;

    const response = session.adapter.buildPermissionResponse('approve', {
      permissionId: request.permissionId,
      category: request.category,
      rawPrompt: request.rawPrompt,
      detail: request.detail,
    });

    try {
      await this.writeToTerminalOrFail(session, response.input);
      missionRepository.appendWorkflowEvent({
        missionId: session.missionId,
        nodeId: session.nodeId,
        sessionId: session.sessionId,
        eventType: 'permission_auto_approved',
        severity: 'info',
        message: `YOLO mode auto-approved ${request.category} permission.`,
        payloadJson: JSON.stringify({ category: request.category, prompt: request.rawPrompt.slice(0, 500) }),
      }).catch(() => {});
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      console.warn(`[runtime] failed to auto-approve yolo permission session=${session.sessionId}: ${detail}`);
    }
  }

  private retainSessionForRuntimeView(session: RuntimeSession): void {
    if (session.missionId.startsWith('adhoc-')) return;
    if (MAX_RETAINED_RUNTIME_VIEW_SESSIONS <= 0) return;
    this.retainedSessions.set(session.sessionId, session.toDescriptor());
    this.pruneRetainedSessionsForWorkflowRun(session.missionId);
  }

  private pruneRetainedSessionsForWorkflowRun(activeMissionId: string): void {
    let changed = false;
    for (const [sessionId, descriptor] of this.retainedSessions.entries()) {
      if (descriptor.missionId !== activeMissionId) {
        this.retainedSessions.delete(sessionId);
        changed = true;
      }
    }

    const entries = Array.from(this.retainedSessions.entries())
      .sort((a, b) => (a[1].createdAt ?? 0) - (b[1].createdAt ?? 0));
    if (entries.length <= MAX_RETAINED_RUNTIME_VIEW_SESSIONS) {
      if (changed) this.notifySnapshot();
      return;
    }
    for (const [sessionId] of entries.slice(0, entries.length - MAX_RETAINED_RUNTIME_VIEW_SESSIONS)) {
      this.retainedSessions.delete(sessionId);
      changed = true;
    }
    if (changed) this.notifySnapshot();
  }

  private forgetRetainedSessionsForRuntime(missionId: string, nodeId: string, terminalId: string): void {
    for (const [sessionId, descriptor] of this.retainedSessions.entries()) {
      if (
        descriptor.terminalId === terminalId ||
        (descriptor.missionId === missionId && descriptor.nodeId === nodeId)
      ) {
        this.retainedSessions.delete(sessionId);
      }
    }
  }

  private retireSession(session: RuntimeSession): void {
    session.markCompleted();
    this.releaseTerminalOwnership(session.terminalId, session.sessionId);
    this.cleanupSession(session);
  }

  private buildInteractiveBootstrapPrompt(
    session: RuntimeSession,
    activationPayload: import('../missionRuntime.js').RuntimeActivationPayload,
    mcpUrl: string,
  ): string {
    const role = session.role;
    const profileId = session.profileId ?? role;
    const payload = activationPayload.inputPayload ? JSON.stringify(activationPayload.inputPayload) : null;
    const payloadSuffix = payload ? `, payload=${payload}` : '';
    const prompt =
      `Connect to MCP before task activation. MCP URL: ${mcpUrl}. ` +
      `Call connect_agent with role="${role}", agentId="${session.agentId}", terminalId="${session.terminalId}", ` +
      `cli="${session.cliId}", profileId="${profileId}", sessionId="${session.sessionId}", runtimeSessionId="${session.sessionId}", ` +
      `missionId="${session.missionId}", nodeId="${session.nodeId}", attempt=${session.attempt}${payloadSuffix}. ` +
      'Use the configured Terminal Docks MCP tools in this Codex session; do not search the web for the local MCP URL. ' +
      'After connection, wait for NEW_TASK. If get_current_task or get_task_details returns an active task, execute the actual task payload immediately and call complete_task as your final MCP action. Do not stop after connecting or after reporting that the task is ready.';
    return `${prompt}\r`;
  }

  // ── Internal: Helpers ──────────────────────────────────────────────

  private buildActivationPayload(session: RuntimeSession): import('../missionRuntime.js').RuntimeActivationPayload {
    const upstreamOutputs = session.upstreamPayloads?.map(h => ({
      fromNodeId: h.fromNodeId,
      outcome: h.outcome,
      payload: h.payload,
      summary: h.summary,
    })) ?? [];

    const fromNodeIds = Array.from(new Set(session.upstreamPayloads?.map(h => h.fromNodeId) ?? []));

    const legalTargets: import('../missionRuntime.js').RuntimeAssignmentLegalTarget[] = session.legalTargets?.map(t => ({
      targetNodeId: t.targetNodeId,
      targetRoleId: t.targetRoleId,
      condition: t.condition.toLowerCase() as any,
      allowedOutcomes: ['success', 'failure'],
    })) ?? [];

    const isFinalReadmeOwner = Boolean(session.finalReadmeEnabled && session.finalReadmeOwnerNodeId === session.nodeId);
    const roleInstructions = [
      session.instructionOverride ?? '',
      isFinalReadmeOwner ? FINAL_README_INSTRUCTION : '',
    ].filter(Boolean).join(' ');

    const assignment: import('../missionRuntime.js').RuntimeAssignmentPayload = {
      roleInstructions,
      missionGoal: session.goal || '',
      upstreamOutputs,
      workspaceContext: {
        workspaceDir: session.workspaceDir,
        missionId: session.missionId,
        nodeId: session.nodeId,
        runId: `run-${session.sessionId}`,
        attempt: session.attempt,
        frontendMode: session.frontendMode ?? 'off',
        frontendCategory: session.frontendCategory ?? 'marketing_site',
        specProfile: session.specProfile ?? 'none',
        finalReadmeEnabled: Boolean(session.finalReadmeEnabled),
        finalReadmeOwnerNodeId: session.finalReadmeOwnerNodeId ?? null,
      },
      expectedDeliverable: {
        schema: 'completion_payload_v1',
        requiredFields: ['status', 'summary', 'artifactReferences', 'filesChanged', 'downstreamPayload'],
        statusOptions: ['success', 'failure'],
        notes: 'Return structured completion data and route downstream only through explicit graph targets.',
      },
      handoff: {
        fromNodeIds,
        legalTargets,
      },
    };

    return {
      activationId: `act-${session.sessionId}`,
      missionId: session.missionId,
      runId: `run-${session.sessionId}`,
      nodeId: session.nodeId,
      role: session.role,
      profileId: session.profileId,
      capabilities: null,
      cliType: session.cliId,
      modelId: session.model || null,
      yolo: session.yolo,
      executionMode: session.executionMode,
      terminalId: session.terminalId,
      paneId: session.paneId ?? null,
      sessionId: session.sessionId,
      agentId: session.agentId,
      attempt: session.attempt,
      goal: session.goal || '',
      workspaceDir: session.workspaceDir,
      frontendMode: session.frontendMode ?? 'off',
      frontendCategory: session.frontendCategory ?? 'marketing_site',
      specProfile: session.specProfile ?? 'none',
      finalReadmeEnabled: Boolean(session.finalReadmeEnabled),
      finalReadmeOwnerNodeId: session.finalReadmeOwnerNodeId ?? null,
      assignment,
      expectedNextAction: {
        signal: 'NEW_TASK',
        requiredFollowUp: ['get_task_details'],
        handoffContract: 'complete_task | handoff_task',
      },
      emittedAt: Date.now(),
    };
  }

  private waitForMcpState(
    sessionId: string,
    missionId: string,
    nodeId: string,
    attempt: number,
    eventType: string,
    acceptedStatuses: Set<string>,
    timeoutMs: number,
  ): Promise<void> {
    return new Promise((resolve, reject) => {
      let settled = false;
      const deadline = Date.now() + timeoutMs;

      const unsub = mcpBus.subscribe(sessionId, event => {
        if (settled) return;
        if (event.type !== eventType) return;
        if (event.missionId && event.missionId !== missionId) return;
        if (event.nodeId && event.nodeId !== nodeId) return;
        if (typeof event.attempt === 'number' && event.attempt !== attempt) return;
        settled = true;
        unsub();
        resolve();
      });

      const pollInterval = setInterval(async () => {
        if (settled) {
          clearInterval(pollInterval);
          return;
        }
        if (Date.now() >= deadline) {
          clearInterval(pollInterval);
          settled = true;
          unsub();
          reject(new Error(`Timed out waiting for ${eventType} on session ${sessionId} (node: ${nodeId}, timeout: ${timeoutMs}ms)`));
          return;
        }

        try {
          const { invoke } = await import('@tauri-apps/api/core');
          type ActivationRecord = { status?: string };
          const record = await invoke<ActivationRecord | null>('get_runtime_activation', {
            missionId,
            nodeId,
            attempt,
          });
          if (record?.status && acceptedStatuses.has(record.status)) {
            settled = true;
            clearInterval(pollInterval);
            unsub();
            resolve();
          }
        } catch {
          // keep polling
        }
      }, 250);
    });
  }

  private async hasRuntimeActivationStatus(session: RuntimeSession, statuses: Set<string>): Promise<boolean> {
    try {
      const { invoke } = await import('@tauri-apps/api/core');
      type ActivationRecord = { status?: string };
      const record = await invoke<ActivationRecord | null>('get_runtime_activation', {
        missionId: session.missionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
      });
      const status = record?.status?.trim().toLowerCase();
      return Boolean(status && statuses.has(status));
    } catch {
      return false;
    }
  }

  private getTerminalRuntimeConfig(terminalId: string): Record<string, unknown> {
    const state = useWorkspaceStore.getState();
    for (const tab of state.tabs) {
      const terminalPane = tab.panes.find(candidate =>
        candidate.type === 'terminal' && candidate.data?.terminalId === terminalId,
      );
      if (terminalPane) {
        return {
          customCommand: terminalPane.data?.customCliCommand ?? null,
          customArgs: Array.isArray(terminalPane.data?.customCliArgs) ? terminalPane.data?.customCliArgs : null,
          customEnv: terminalPane.data?.customCliEnv ?? null,
        };
      }
    }
    return {};
  }

  private bindRuntimeToTerminalPane(session: RuntimeSession): void {
    const isWorkflowRun = !session.missionId.startsWith('adhoc-');
    useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
      runtimeSessionId: session.sessionId,
      nodeId: session.nodeId,
      roleId: session.role,
      cli: session.cliId,
      model: session.model,
      ...(isWorkflowRun ? { runtimeManaged: true } : {}),
    });
  }

  private isTerminalNotFoundError(error: unknown): boolean {
    const message = error instanceof Error ? error.message : String(error);
    return message.includes('not found in active PTY state');
  }

  private async writeToTerminalByIdOrFail(terminalId: string, data: string): Promise<void> {
    const active = await isTerminalActive(terminalId).catch(() => false);
    if (!active) {
      throw new Error(`Terminal ID ${terminalId} not found in active PTY state.`);
    }
    await writeToTerminal(terminalId, data);
  }

  private async writeToTerminalOrFail(session: RuntimeSession, data: string): Promise<void> {
    try {
      await this.writeToTerminalByIdOrFail(session.terminalId, data);
    } catch (error) {
      if (this.isTerminalNotFoundError(error)) {
        await this.failRuntimeForMissingPty(session, error);
      }
      throw error;
    }
  }

  private async failRuntimeForMissingPty(session: RuntimeSession, error: unknown): Promise<void> {
    if (session.state === 'manual_takeover') {
      console.warn(
        `[runtime] ignoring missing PTY for manual takeover session=${session.sessionId} terminal=${session.terminalId}`,
      );
      return;
    }
    if (isRuntimeSessionTerminal(session.state)) {
      console.warn(
        `[runtime] ignoring missing PTY for terminal session session=${session.sessionId} state=${session.state}`,
      );
      return;
    }
    const message = error instanceof Error ? error.message : String(error);
    const reason = `Terminal process disappeared during runtime launch or injection: ${message}`;
    session.markFailed(reason);
    this.emit({
      type: 'session_failed',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      error: reason,
    });
    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'failed',
      reason,
    }).catch(() => {});
    await emit('workflow-node-update', {
      id: session.nodeId,
      status: 'failed',
      attempt: session.attempt,
      message: reason,
    }).catch(() => {});
  }

  private async waitForTerminalReady(terminalId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!(await isTerminalActive(terminalId))) {
      if (Date.now() >= deadline) return false;
      await sleep(100);
    }
    return true;
  }

  private evaluateSessionReadiness(session: RuntimeSession, output: string) {
    return evaluateCliReadiness(
      session.cliId,
      output,
      value => session.adapter.detectStatus(value),
      value => session.adapter.detectReady(value),
    );
  }

  private buildSessionReadinessDiagnostic(
    session: RuntimeSession,
    status: StatusDetectionResult,
    strictGateEnabled: boolean,
    recentOutput: string,
    timeoutMs?: number,
  ): string {
    return buildCliReadinessDiagnostic({
      cliId: session.cliId,
      terminalId: session.terminalId,
      nodeId: session.nodeId,
      sessionId: session.sessionId,
      timeoutMs,
      status,
      strictGateEnabled,
      recentOutput: previewText(recentOutput, 1_200) ?? '',
    });
  }

  private readinessFailureReason(session: RuntimeSession, fallback: string): string {
    return this.cliReadinessDiagnostics.get(session.sessionId) ?? fallback;
  }

  private updateCliReadinessWaitState(session: RuntimeSession, status: StatusDetectionResult): void {
    if (status.status === 'waiting_auth') {
      if (session.state === 'awaiting_cli_ready') {
        session.transitionTo('waiting_auth');
        missionRepository.appendWorkflowEvent({
          missionId: session.missionId,
          nodeId: session.nodeId,
          sessionId: session.sessionId,
          terminalId: session.terminalId,
          eventType: 'provider_auth_required',
          severity: 'warning',
          message: `${session.cliId} is waiting for provider authentication before task injection.`,
          payloadJson: JSON.stringify({ detail: status.detail }),
        }).catch(() => {});
      }
      return;
    }

    if (session.state === 'waiting_auth') {
      session.transitionTo('awaiting_cli_ready');
    }
  }

  private async waitForCliReady(session: RuntimeSession, timeoutMs: number): Promise<boolean> {
    const startedAt = Date.now();
    let deadline = startedAt + timeoutMs;
    let authDeadline: number | null = null;
    let lastDetail: string | null = null;
    let lastOutputLength = 0;
    let lastStatus: StatusDetectionResult = {
      status: 'processing',
      confidence: 'low',
      detail: 'No terminal output observed yet',
    };
    let lastStrictGateEnabled = isStrictCliStatusGateEnabled(session.cliId);
    while (Date.now() < deadline) {
      const output = await getRecentTerminalOutput(session.terminalId, 12_288);
      if (output) {
        lastOutputLength = output.length;
        const readiness = this.evaluateSessionReadiness(session, output);
        lastStatus = readiness.status;
        lastStrictGateEnabled = readiness.strictGateEnabled;
        this.updateCliReadinessWaitState(session, readiness.status);
        if (readiness.status.status === 'waiting_auth' && authDeadline === null) {
          authDeadline = startedAt + Math.max(timeoutMs, CLI_AUTH_WAIT_MS);
          deadline = Math.max(deadline, authDeadline);
          console.log(
            `[runtime] cli-ready auth wait extended cli=${session.cliId} delayMs=${Math.max(timeoutMs, CLI_AUTH_WAIT_MS)}`,
          );
        }
        const detail = readiness.strictGateEnabled
          ? readiness.status.detail
          : readiness.legacyReady?.detail ?? readiness.status.detail;
        if (detail && detail !== lastDetail) {
          console.log(
            `[runtime] cli-ready cli=${session.cliId} ready=${readiness.ready} status=${readiness.status.status} confidence=${readiness.status.confidence} strictGate=${readiness.strictGateEnabled} detail="${detail}"`,
          );
          lastDetail = detail;
        }
        if (readiness.ready) {
          const settleMs = session.adapter.postReadySettleDelayMs ?? 0;
          if (settleMs > 0) {
            console.log(`[runtime] cli-ready settle cli=${session.cliId} delayMs=${settleMs}`);
            await sleep(settleMs);
            if (isRuntimeSessionTerminal(session.state) || !this.isCurrentOwner(session)) {
              return false;
            }
            const settledOutput = await getRecentTerminalOutput(session.terminalId, 12_288).catch(() => '');
            const settledReadiness = settledOutput ? this.evaluateSessionReadiness(session, settledOutput) : readiness;
            lastStatus = settledReadiness.status;
            lastStrictGateEnabled = settledReadiness.strictGateEnabled;
            this.updateCliReadinessWaitState(session, settledReadiness.status);
            if (!settledReadiness.ready) {
              const settledDetail = settledReadiness.strictGateEnabled
                ? settledReadiness.status.detail
                : settledReadiness.legacyReady?.detail ?? settledReadiness.status.detail;
              console.log(
                `[runtime] cli-ready settle recheck cli=${session.cliId} ready=false status=${settledReadiness.status.status} confidence=${settledReadiness.status.confidence} detail="${settledDetail}"`,
              );
              lastDetail = settledDetail ?? lastDetail;
              continue;
            }
          }
          this.cliReadinessDiagnostics.delete(session.sessionId);
          return true;
        }
      }
      await sleep(200);
    }
    const recentOutput = await getRecentTerminalOutput(session.terminalId, 2_000).catch(() => '');
    const diagnostic = this.buildSessionReadinessDiagnostic(
      session,
      lastStatus,
      lastStrictGateEnabled,
      recentOutput,
      timeoutMs,
    );
    this.cliReadinessDiagnostics.set(session.sessionId, diagnostic);
    console.warn(
      `[runtime] cli-ready timeout ${diagnostic} lastDetail="${lastDetail ?? 'none'}" outputLength=${lastOutputLength}`,
    );
    return false;
  }

  private async waitForManagedInjectionReadyOrThrow(
    session: RuntimeSession,
    timeoutMs: number,
    reason: string,
  ): Promise<void> {
    if (!session.isTerminal || !isStrictCliStatusGateEnabled(session.cliId)) return;
    if (isRuntimeSessionTerminal(session.state) || !this.isCurrentOwner(session)) return;

    const ready = await this.waitForCliReady(session, timeoutMs);
    if (isRuntimeSessionTerminal(session.state) || !this.isCurrentOwner(session)) return;
    if (ready) return;

    throw new Error(
      `${reason} failed because the CLI was not idle before managed prompt injection. ` +
      this.readinessFailureReason(session, `cli=${session.cliId} terminalId=${session.terminalId} nodeId=${session.nodeId}`),
    );
  }

  private async waitForTerminalOutputIdle(
    terminalId: string,
    idleMs: number,
    timeoutMs: number,
  ): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let lastOutput = '';
    let lastChangeAt = Date.now();

    while (Date.now() < deadline) {
      const output = await getRecentTerminalOutput(terminalId, 12_288);
      if (output !== lastOutput) {
        lastOutput = output;
        lastChangeAt = Date.now();
      } else if (Date.now() - lastChangeAt >= idleMs) {
        return true;
      }
      await sleep(150);
    }
    return false;
  }

  private async injectInteractivePrompt(
    session: RuntimeSession,
    signal: string,
    retry: boolean,
  ): Promise<void> {
    if (isRuntimeSessionTerminal(session.state) || !this.isCurrentOwner(session)) return;
    await this.waitForManagedInjectionReadyOrThrow(
      session,
      managedInjectionReadyWaitMsForCli(session.cliId),
      'managed prompt injection',
    );
    if (isRuntimeSessionTerminal(session.state) || !this.isCurrentOwner(session)) return;

    const adapter = session.adapter;
    const { preClear, paste, submit } = adapter.buildActivationInput(signal);

    if (session.cliId === 'codex') {
      await this.waitForTerminalOutputIdle(
        session.terminalId,
        CODEX_IDLE_WAIT_MS,
        CODEX_IDLE_TIMEOUT_MS,
      );
      if (retry) {
        await this.writeToTerminalOrFail(session, '\x15');
        await sleep(PRE_CLEAR_SETTLE_MS);
      }
      await this.writeTerminalLikeTyping(session.terminalId, paste);
      await sleep(pasteSubmitGapMsForCli(session.cliId));
      await this.writeToTerminalOrFail(session, submit);
      return;
    }

    if (preClear) {
      await this.writeToTerminalOrFail(session, preClear);
      await sleep(PRE_CLEAR_SETTLE_MS);
    }
    await this.writeToTerminalOrFail(session, paste);
    await sleep(pasteSubmitGapMsForCli(session.cliId));
    await this.writeToTerminalOrFail(session, submit);
  }

  private async writeTerminalLikeTyping(terminalId: string, value: string): Promise<void> {
    if (!value) return;
    for (let index = 0; index < value.length; index += CODEX_TYPE_CHUNK_SIZE) {
      const chunk = value.slice(index, index + CODEX_TYPE_CHUNK_SIZE);
      await this.writeToTerminalByIdOrFail(terminalId, chunk);
      await sleep(CODEX_TYPE_CHUNK_DELAY_MS);
    }
  }

  private hasDifferentLiveSessionOnTerminal(current: RuntimeSession): boolean {
    const state = useWorkspaceStore.getState();
    const allPanes = state.tabs.flatMap(t => t.panes);
    const pane = allPanes.find(p => p.data?.terminalId === current.terminalId);
    const paneSessionId = typeof pane?.data?.runtimeSessionId === 'string' ? pane.data.runtimeSessionId : null;
    if (paneSessionId && paneSessionId !== current.sessionId && this.sessions.has(paneSessionId)) {
      return true;
    }

    for (const binding of Object.values(state.nodeRuntimeBindings)) {
      if (!binding || binding.terminalId !== current.terminalId) continue;
      const sessionId = binding.runtimeSessionId;
      if (typeof sessionId !== 'string') continue;
      if (sessionId !== current.sessionId && this.sessions.has(sessionId)) {
        return true;
      }
    }
    return false;
  }

  private async shouldLaunchCliInTerminal(session: RuntimeSession): Promise<boolean> {
    const state = useWorkspaceStore.getState();
    const allPanes = state.tabs.flatMap(t => t.panes);
    const pane = allPanes.find(p => p.data?.terminalId === session.terminalId);

    const paneCli = typeof pane?.data?.cli === 'string' ? pane.data.cli : null;
    const paneCliSource = typeof pane?.data?.cliSource === 'string' ? pane.data.cliSource : null;

    const isKnownRunning =
      (paneCliSource === 'stdout' || paneCliSource === 'connect_agent' || paneCliSource === 'runtime_shell_launch') &&
      paneCli === session.cliId;
    if (isKnownRunning) return false;

    if (this.hasDifferentLiveSessionOnTerminal(session)) return false;

    if (paneCliSource == null) {
      const active = await isTerminalActive(session.terminalId).catch(() => false);
      if (!active) return false;

      console.log(`[runtime] pane has no active cliSource; forcing fresh CLI launch cli=${session.cliId} terminal=${session.terminalId}`);
      return true;
    }

    const recentOutput = await getRecentTerminalOutput(session.terminalId, 12_288);
    if (!recentOutput) return true;

    const ready = session.adapter.detectReady(recentOutput);
    if (ready.ready) return false;

    const detected = detectCliFromTerminalOutput(recentOutput);
    if (detected.cli && detected.cli === session.cliId) return false;

    return true;
  }

  private cleanupSession(session: RuntimeSession): void {
    this.clearCompletionContractWatchdog(session.sessionId);
    this.clearPostAckNoProgressWatchdog(session.sessionId);
    this.clearRuntimeCompletionPoller(session.sessionId);
    this.cliReadinessDiagnostics.delete(session.sessionId);

    const ptyCleanup = this.ptyCleanupFns.get(session.sessionId);
    if (ptyCleanup) {
      ptyCleanup();
      this.ptyCleanupFns.delete(session.sessionId);
    }

    if (session.terminalId) {
      useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
        cliSource: undefined,
        cli: undefined,
        model: undefined,
        runtimeSessionId: undefined,
      });
    }

    this.releaseTerminalOwnership(session.terminalId, session.sessionId);
    if (session.terminalId) {
      this.captureTerminalLogArtifact(session);
      if (session.missionId.startsWith('adhoc-')) {
        terminalOutputBus.clear(session.terminalId);
      }
    }

    this.retainSessionForRuntimeView(session);
    this.sessions.delete(session.sessionId);
    const nodeKey = `${session.missionId}:${session.nodeId}:${session.attempt}`;
    if (this.sessionsByNode.get(nodeKey) === session.sessionId) {
      this.sessionsByNode.delete(nodeKey);
    }
    this.notifySnapshot();
  }

  private captureTerminalLogArtifact(session: RuntimeSession): void {
    if (session.missionId.startsWith('adhoc-')) return;
    const terminalLog = terminalOutputBus.getTail(session.terminalId, 32_000);
    if (!terminalLog) return;

    const artifactId = `log-${session.sessionId}`;
    missionRepository.writeArtifact({
      id: artifactId,
      missionId: session.missionId,
      nodeId: session.nodeId,
      kind: 'terminal_log',
      title: `Terminal log — ${session.cliId} attempt ${session.attempt}`,
      contentText: terminalLog,
      metadataJson: JSON.stringify({
        sessionId: session.sessionId,
        cliId: session.cliId,
        attempt: session.attempt,
        role: session.role,
        terminalId: session.terminalId,
        finalState: session.state,
        error: session.lastError ?? null,
      }),
    }).catch(() => {});

    missionRepository.appendWorkflowEvent({
      missionId: session.missionId,
      nodeId: session.nodeId,
      sessionId: session.sessionId,
      terminalId: session.terminalId,
      eventType: 'terminal_log_captured',
      severity: 'info',
      message: `Terminal log artifact captured for session ${session.sessionId} (${terminalLog.length} chars).`,
      payloadJson: JSON.stringify({ artifactId, charCount: terminalLog.length }),
    }).catch(() => {});
  }

  private emit(event: RuntimeManagerEvent): void {
    if (this.disposed) return;
    for (const listener of this.listeners) {
      try {
        listener(event);
      } catch {
        // swallow listener errors
      }
    }
  }

  private notifySnapshot(): void {
    if (this.disposed) return;
    const snap = this.snapshot();
    for (const listener of this.snapshotListeners) {
      try {
        listener(snap);
      } catch {
        // swallow listener errors
      }
    }
  }

  dispose(): void {
    this.disposed = true;
    for (const cleanup of this.ptyCleanupFns.values()) {
      try { cleanup(); } catch { /* swallow */ }
    }
    this.ptyCleanupFns.clear();
    for (const sessionId of this.completionContractTimers.keys()) {
      this.clearCompletionContractWatchdog(sessionId);
    }
    for (const sessionId of this.postAckNoProgressWatchdogs.keys()) {
      this.clearPostAckNoProgressWatchdog(sessionId);
    }
    for (const sessionId of this.runtimeCompletionPollers.keys()) {
      this.clearRuntimeCompletionPoller(sessionId);
    }
    this.sessions.clear();
    this.retainedSessions.clear();
    this.sessionsByNode.clear();
    this.terminalOwners.clear();
    this.listeners.clear();
    this.snapshotListeners.clear();
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

// ──────────────────────────────────────────────
// Singleton
// ──────────────────────────────────────────────

export const runtimeManager = new RuntimeManager();
export { RuntimeManager };
