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
  RuntimeSessionState,
  SendTaskArgs,
  SendInputArgs,
  SessionLivenessResult,
  StopRuntimeArgs,
  ResolvePermissionArgs,
} from './RuntimeTypes.js';
import { isRuntimeSessionTerminal } from './RuntimeTypes.js';
import { getCliAdapter } from './adapters/index.js';

import {
  checkMcpHealth,
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
  buildCodexInteractiveLaunchCommand,
  buildCodexFollowupTaskSignal,
  buildPtyLaunchCommand,
  resolveCodexYoloFlag,
} from '../cliCommandBuilders.js';
import { getRuntimeBootstrapContract, buildRuntimeBootstrapRegistrationRequest } from '../runtimeBootstrap.js';
import { mcpBus } from '../workers/mcpEventBus.js';
import { detectCliFromTerminalOutput } from '../cliDetection.js';
import { useWorkspaceStore } from '../../store/workspace.js';
import { emit } from '@tauri-apps/api/event';
import { terminalOutputBus } from './TerminalOutputBus.js';
import { missionRepository } from '../missionRepository.js';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CLI_LAUNCH_DELAY_MS = 500;
const SHELL_LAUNCH_SETTLE_MS = 700;
const CLI_STARTUP_WAIT_MS = 2_000;
const CLI_READY_WAIT_MS = 20_000;
const PASTE_SUBMIT_GAP_MS = 150;
const PRE_CLEAR_SETTLE_MS = 300;
const BOOTSTRAP_EVENT_TIMEOUT_MS = 8_000;
const TASK_ACK_TIMEOUT_MS = 30_000;
const BOOTSTRAP_INJECTION_TIMEOUT_MS = 10_000;
const CODEX_IDLE_WAIT_MS = 1_000;
const CODEX_IDLE_TIMEOUT_MS = 8_000;
const CODEX_BOOTSTRAP_RETRY_DELAY_MS = 3_500;
const CODEX_TYPE_CHUNK_SIZE = 48;
const CODEX_TYPE_CHUNK_DELAY_MS = 20;
const PTY_DESTROY_WAIT_MS = 5_000;
const PTY_DESTROY_POLL_MS = 100;

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

function previewText(value: string | null | undefined, limit = 280): string | null {
  const trimmed = typeof value === 'string' ? value.trim() : '';
  if (!trimmed) return null;
  return trimmed.length <= limit ? trimmed : `${trimmed.slice(0, limit)}...`;
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

// ──────────────────────────────────────────────
// RuntimeManager
// ──────────────────────────────────────────────

class RuntimeManager {
  private sessions = new Map<string, RuntimeSession>();
  private sessionsByNode = new Map<string, string>();
  private terminalOwners = new Map<string, string>();
  private listeners = new Set<ManagerListener>();
  private snapshotListeners = new Set<SnapshotListener>();
  private ptyCleanupFns = new Map<string, () => void>();
  private suppressedPtyExitUntil = new Map<string, number>();
  private terminalLocks = new TerminalLock();
  private nativeListenerUnsub?: () => void;
  private disposed = false;

  async startListening(): Promise<void> {
    if (this.nativeListenerUnsub) return;

    this.nativeListenerUnsub = await listen<{
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

  // ── Public API ──────────────────────────────────────────────────

  async createRuntimeForNode(args: CreateRuntimeArgs): Promise<RuntimeSession> {
    const adapter = getCliAdapter(args.cliId);
    if (!adapter) {
      throw new Error(`No CLI adapter registered for "${args.cliId}"`);
    }

    console.log(
      `[runtime] create cli=${args.cliId} model=${normalizeModelForReuse(args.modelId ?? args.model) ?? '<default>'} yolo=${Boolean(args.yolo)} executionMode=${args.executionMode} workspace=${args.workspaceDir ?? '<none>'}`,
    );

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
      legalTargets: args.legalTargets,
      upstreamPayloads: args.upstreamPayloads,
      model: args.modelId ?? args.model,
      yolo: args.yolo,
    });

    this.sessions.set(session.sessionId, session);
    this.sessionsByNode.set(`${args.missionId}:${args.nodeId}:${args.attempt}`, session.sessionId);
    this.wireMcpEvents(session.sessionId);

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
      });
      return;
    }

    const { preClear, paste, submit } = adapter.buildActivationInput(signal);
    if (preClear) {
      await this.writeToTerminalOrFail(session, preClear);
      await sleep(PRE_CLEAR_SETTLE_MS);
    }
    await this.writeToTerminalOrFail(session, paste);
    await sleep(PASTE_SUBMIT_GAP_MS);
    await this.writeToTerminalOrFail(session, submit);

    this.emit({
      type: 'task_injected',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
    });
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

    session.clearPermission();

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
      'creating', 'launching_cli', 'awaiting_cli_ready', 'registering_mcp',
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
      ? buildCodexFollowupTaskSignal()
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
          assignment: activationPayload.assignment,
        }, baseUrl);

    session.transitionTo('injecting_task');

    if (session.isHeadless) {
      await this.launchHeadless(session, activationPayload, signal, baseUrl);
    } else {
      await this.injectInteractiveTask(session, signal, false);
    }

    session.transitionTo('awaiting_ack');

    try {
      await this.waitForMcpState(
        session.sessionId,
        session.missionId,
        session.nodeId,
        session.attempt,
        'activation:acked',
        new Set(['activation_acked', 'running', 'completed', 'done']),
        TASK_ACK_TIMEOUT_MS,
      );

      session.transitionTo('running');

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
    } catch {
      throw new Error(
        `Agent for CLI "${session.cliId}" on node "${session.nodeId}" did not ACK re-injected task within ${Math.round(TASK_ACK_TIMEOUT_MS / 1000)}s.`,
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

    return {
      sessions,
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

      if (event.type === 'agent:heartbeat') {
        session.updateHeartbeat(event.at);
        this.emit({ type: 'heartbeat', sessionId, nodeId: session.nodeId, at: event.at });
      }

      if (event.type === 'task:completed') {
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

      const perm = session.adapter.detectPermissionRequest(event.text);
      if (perm && session.state !== 'awaiting_permission') {
        const request = {
          ...perm.request,
          sessionId,
          nodeId: session.nodeId,
          detectedAt: Date.now(),
        };
        session.setPermission(request);
        this.emit({
          type: 'permission_requested',
          sessionId,
          nodeId: session.nodeId,
          request,
        });
      }

      const comp = session.adapter.detectCompletion(event.text);
      if (comp && session.state === 'running') {
        // MCP tool 'complete_task' is the authority.
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
      session.markDisconnected(reason);

      if (session.state === 'running' || session.state === 'awaiting_ack' || session.state === 'awaiting_permission') {
        session.markFailed(reason);
        this.emit({
          type: 'session_failed',
          sessionId,
          nodeId: session.nodeId,
          error: reason,
        });
      }

      await acknowledgeActivation({
        missionId: session.missionId,
        nodeId: session.nodeId,
        attempt: session.attempt,
        status: 'disconnected',
        reason,
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
    try {
      await spawnTerminal({ id: terminalId, ...opts });
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
            const launchCmd = buildPtyLaunchCommand(session.cliId, { model: session.model, yolo: session.yolo });
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

    const mcpHealthy = await checkMcpHealth();
    if (!mcpHealthy) {
      throw new Error('MCP server unavailable during activation handshake.');
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
          const launchCmd = buildPtyLaunchCommand(session.cliId, { model: session.model, yolo: session.yolo });
          console.log(`[runtime] launch command=${launchCmd}`);
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
          throw new Error(reason);
        }
      }
    }

    // 4. Register session with MCP
    if (!contract || !bootstrapRequest) {
      throw new Error(`CLI "${session.cliId}" does not have a runtime bootstrap contract.`);
    }

    session.transitionTo('registering_mcp');

    const mcpReadyPromise = this.waitForMcpState(
      session.sessionId,
      session.missionId,
      session.nodeId,
      session.attempt,
      contract.handshakeEvent,
      new Set(['registered', 'ready', 'activation_acked', 'running', 'completed', 'done']),
      BOOTSTRAP_EVENT_TIMEOUT_MS,
    );

    const registration = await registerMcpSession(bootstrapRequest as import('./TerminalRuntime.js').McpRegistrationRequest);
    if (!registration?.ok) {
      void mcpReadyPromise.catch(() => {});
      throw new Error(registration?.message ?? registration?.error ?? 'Runtime registration was rejected by MCP.');
    }

    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'registered',
    });

    let bootstrapPromptBody: string | null = null;
    if (session.isTerminal && !startupPromptDeliveredViaLaunch) {
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
          const injectResult = await Promise.race([
            this.injectInteractivePrompt(session, bootstrapPromptBody, false).then(() => true),
            sleep(BOOTSTRAP_INJECTION_TIMEOUT_MS).then(() => false),
          ]);

          if (!injectResult) {
            throw new Error(
              `Bootstrap prompt injection timed out (${BOOTSTRAP_INJECTION_TIMEOUT_MS}ms) for CLI "${session.cliId}" on node "${session.nodeId}".`,
            );
          }
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

    if (session.isHeadless) {
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
        assignment: activationPayload.assignment,
      }, baseUrl);
      await this.launchHeadless(session, activationPayload, signal, baseUrl);
    } else {
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
        assignment: activationPayload.assignment,
      }, baseUrl);
      await this.injectInteractiveTask(session, signal, false);
    }

    session.transitionTo('awaiting_ack');

    try {
      const ackPromise = this.waitForMcpState(
        session.sessionId,
        session.missionId,
        session.nodeId,
        session.attempt,
        'activation:acked',
        new Set(['activation_acked', 'running', 'completed', 'done']),
        TASK_ACK_TIMEOUT_MS,
      );
      await ackPromise;

      session.transitionTo('running');

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
    } catch {
      throw new Error(
        session.cliId === 'codex'
          ? `Codex did not fetch the current task from MCP. Try New Runtime or check MCP connection.`
          : `Agent for CLI "${session.cliId}" on node "${session.nodeId}" did not call get_task_details within ${Math.round(TASK_ACK_TIMEOUT_MS / 1000)}s (state: awaiting_ack). Check terminal for errors.`,
      );
    }
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
      `[runtime] launch command=${request.command} args=${JSON.stringify(request.args)} cli=${session.cliId} model=${session.model || '<default>'} yolo=${session.yolo} promptDelivery=${request.promptDelivery} mode=${request.executionMode}`,
    );
    await startHeadlessRun(request as import('./TerminalRuntime.js').HeadlessRunRequest);
  }

  private async injectInteractiveTask(session: RuntimeSession, signal: string, retry: boolean): Promise<void> {
    const terminalAlive = await isTerminalActive(session.terminalId);
    if (!terminalAlive) {
      throw new Error(`Terminal process for ${session.nodeId} has exited.`);
    }

    await sleep(CLI_STARTUP_WAIT_MS);
    console.log(`[runtime] injecting task prompt cli=${session.cliId} terminal=${session.terminalId}`);
    await this.injectInteractivePrompt(session, signal, retry);

    this.emit({
      type: 'task_injected',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
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

    console.log(`[runtime] shell spawn success terminal=${session.terminalId} cli=${session.cliId}`);
    await resizeTerminal(session.terminalId, rows, cols).catch(() => {});
    await emit('terminal-refit-requested', { terminalId: session.terminalId }).catch(() => {});

    const terminalReady = await this.waitForTerminalReady(session.terminalId, 5_000);
    if (!terminalReady) {
      throw new Error(`Terminal ${session.terminalId} did not become active after shell spawn for CLI "${session.cliId}" (node: ${session.nodeId}).`);
    }

    await sleep(SHELL_LAUNCH_SETTLE_MS);
    const launch = await this.buildInteractiveWorkflowShellLaunchCommand(session, activationPayload);
    const launchCmd = launch.command;

    console.log(`[runtime] writing CLI launch command: ${launch.promptDeliveredAtLaunch ? 'codex <startup-prompt:redacted>' : launchCmd}`);
    await this.writeToTerminalOrFail(session, `${launchCmd}\r`);
    await sleep(150);
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
    const cliReady = await this.waitForCliReady(session, CLI_READY_WAIT_MS);
    if (!cliReady) {
      throw new Error(`CLI "${session.cliId}" did not report ready state within ${CLI_READY_WAIT_MS}ms after shell launch.`);
    }
    console.log(`[runtime] CLI ready cli=${session.cliId} terminal=${session.terminalId}`);

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
  ): Promise<{ command: string; promptDeliveredAtLaunch: boolean }> {
    if (session.cliId !== 'codex') {
      return {
        command: buildPtyLaunchCommand(session.cliId, {
          model: session.model,
          yolo: session.yolo,
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
    return {
      command: buildCodexInteractiveLaunchCommand({
        modelId: session.model || null,
        yolo: session.yolo,
        workspaceDir: session.workspaceDir,
        mcpUrl: await getMcpUrl(),
        bootstrapPrompt,
        resolvedYoloFlag,
        shellKind: 'windows',
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
    if (!args.length) return '[]';
    return `[${args.map((arg, index) => index === args.length - 1 ? '<prompt:redacted>' : arg).join(', ')}]`;
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
      session.terminalId === args.terminalId &&
      (session.workspaceDir ?? null) === (args.workspaceDir ?? null),
    );
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
      `cli="${session.cliId}", profileId="${profileId}", missionId="${session.missionId}", nodeId="${session.nodeId}", attempt=${session.attempt}${payloadSuffix}. ` +
      'After connection, wait for NEW_TASK and run get_task_details.';
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

    const assignment: import('../missionRuntime.js').RuntimeAssignmentPayload = {
      roleInstructions: '',
      missionGoal: session.goal || '',
      upstreamOutputs,
      workspaceContext: {
        workspaceDir: session.workspaceDir,
        missionId: session.missionId,
        nodeId: session.nodeId,
        runId: `run-${session.sessionId}`,
        attempt: session.attempt,
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

  private async waitForCliReady(session: RuntimeSession, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    let lastDetail: string | null = null;
    let lastOutputLength = 0;
    while (Date.now() < deadline) {
      const output = await getRecentTerminalOutput(session.terminalId, 12_288);
      if (output) {
        lastOutputLength = output.length;
        const ready = session.adapter.detectReady(output);
        if (ready.detail && ready.detail !== lastDetail) {
          console.log(`[runtime] cli-ready cli=${session.cliId} ready=${ready.ready} detail="${ready.detail}"`);
          lastDetail = ready.detail;
        }
        if (ready.ready) return true;
      }
      await sleep(200);
    }
    const recentOutput = await getRecentTerminalOutput(session.terminalId, 2_000).catch(() => '');
    console.warn(
      `[runtime] cli-ready timeout cli=${session.cliId} lastDetail="${lastDetail ?? 'none'}" outputLength=${lastOutputLength} timeoutMs=${timeoutMs} recent="${previewText(recentOutput, 500) ?? '<empty>'}"`,
    );
    return false;
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
      await sleep(PASTE_SUBMIT_GAP_MS);
      await this.writeToTerminalOrFail(session, submit);
      return;
    }

    if (preClear) {
      await this.writeToTerminalOrFail(session, preClear);
      await sleep(PRE_CLEAR_SETTLE_MS);
    }
    await this.writeToTerminalOrFail(session, paste);
    await sleep(PASTE_SUBMIT_GAP_MS);
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
      terminalOutputBus.clear(session.terminalId);
    }

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
    this.sessions.clear();
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
