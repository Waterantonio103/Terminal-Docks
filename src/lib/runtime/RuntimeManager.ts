/**
 * RuntimeManager.ts — Centralized runtime lifecycle owner.
 *
 * Owns all live RuntimeSession instances. Provides methods to create,
 * launch, send tasks to, and stop runtimes. Routes PTY output through
 * CLI adapters. Emits events for UI and Orchestrator subscription.
 *
 * This is the single owner of terminal/runtime creation responsibility.
 * Code that previously called Tauri PTY commands or drove MCP registration
 * from UI components should now call RuntimeManager instead.
 *
 * Phase 4 — Wave 3 / Agent B
 */

import {  listen  } from '../desktopApi';
import { RuntimeSession } from './RuntimeSession.js';
import type {
  CreateRuntimeArgs,
  RuntimeManagerEvent,
  RuntimeManagerSnapshot,
  SendTaskArgs,
  SendInputArgs,
  StopRuntimeArgs,
  ResolvePermissionArgs,
  SessionLivenessResult,
} from './RuntimeTypes.js';
import { getCliAdapter } from './adapters/index.js';

import {
  checkMcpHealth,
  getMcpBaseUrl,
  getRecentTerminalOutput,
  registerMcpSession,
  registerActivationDispatch,
  acknowledgeActivation,
  startHeadlessRun,
  writeToTerminal,
  isTerminalActive,
  registerTerminalMetadata,
  notifyMcpDisconnected,
} from './TerminalRuntime.js';
import { buildNewTaskSignal } from '../missionRuntime.js';
import { buildStartAgentRunRequest } from '../runtimeDispatcher.js';
import { getRuntimeBootstrapContract, buildRuntimeBootstrapRegistrationRequest } from '../runtimeBootstrap.js';
import { mcpBus } from '../workers/mcpEventBus.js';
import { detectCliFromTerminalOutput } from '../cliDetection.js';
import { useWorkspaceStore } from '../../store/workspace.js';
import {  emit  } from '../desktopApi';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CLI_LAUNCH_DELAY_MS = 500;
const CLI_STARTUP_WAIT_MS = 2_000;
const PASTE_SUBMIT_GAP_MS = 150;
const PRE_CLEAR_SETTLE_MS = 300;
const BOOTSTRAP_EVENT_TIMEOUT_MS = 8_000;
const TASK_ACK_TIMEOUT_MS = 30_000;
const BOOTSTRAP_INJECTION_TIMEOUT_MS = 10_000;

// ──────────────────────────────────────────────
// Listeners
// ──────────────────────────────────────────────

type ManagerListener = (event: RuntimeManagerEvent) => void;
type SnapshotListener = (snapshot: RuntimeManagerSnapshot) => void;

// ──────────────────────────────────────────────
// RuntimeManager
// ──────────────────────────────────────────────

class RuntimeManager {
  private sessions = new Map<string, RuntimeSession>();
  private sessionsByNode = new Map<string, string>();
  private listeners = new Set<ManagerListener>();
  private snapshotListeners = new Set<SnapshotListener>();
  private ptyCleanupFns = new Map<string, () => void>();
  private nativeListenerUnsub?: () => void;
  private disposed = false;

  async startListening(): Promise<void> {
    if (this.nativeListenerUnsub) return;

    this.nativeListenerUnsub = await listen<{
      mission_id: string;
      node_id: string;
      attempt: number;
      status: string;
      payload: import('../missionRuntime.js').RuntimeActivationPayload;
    }>('workflow-runtime-activation-requested', async (event) => {
      const { mission_id, node_id, attempt, payload } = event.payload;

      try {
        const session = await this.createRuntimeForNode({
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
          activationPayload: payload,
        });

        // wireMcpEvents is now called inside createRuntimeForNode.
        this.wirePtyEvents(payload.terminalId, session.sessionId);

        await this.launchCli(session.sessionId, payload);
      } catch (error) {
        console.error(`[RuntimeManager] Failed to launch CLI for ${node_id}:`, error);
      }
    });

    // Acknowledge headless run exits that complete without going through MCP.
    // Skipped for interactive CLIs (claude/ollama/lmstudio) which complete via MCP tools.
    listen<{
      runId: string;
      missionId: string;
      nodeId: string;
      status: string;
      exitCode?: number | null;
      error?: string | null;
      at: number;
    }>('agent-run-exit', async (event) => {
      const { missionId, nodeId, status, error } = event.payload;
      const sessionKey = Array.from(this.sessionsByNode.entries()).find(
        ([key]) => key.startsWith(`${missionId}:${nodeId}:`)
      );
      if (!sessionKey) return;
      const session = this.sessions.get(sessionKey[1]);
      if (!session) return;

      const isInteractiveCli = session.cliId === 'claude' || session.cliId === 'ollama' || session.cliId === 'lmstudio';
      if (status === 'completed' && isInteractiveCli) return;
      if (session.state === 'completed' || session.state === 'failed') return;

      const reason = status === 'completed'
        ? 'process_exited_without_handoff'
        : (error ?? status ?? 'Agent run exited before completing via MCP.');

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

  /**
   * Create a new runtime session for a workflow node.
   * Does NOT launch the CLI yet — call launchCli() separately.
   */
  async createRuntimeForNode(args: CreateRuntimeArgs): Promise<RuntimeSession> {
    const adapter = getCliAdapter(args.cliId);
    if (!adapter) {
      throw new Error(`No CLI adapter registered for "${args.cliId}"`);
    }

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
    });

    this.sessions.set(session.sessionId, session);
    this.sessionsByNode.set(`${args.missionId}:${args.nodeId}:${args.attempt}`, session.sessionId);
    this.wireMcpEvents(session.sessionId);

    session.onStateChange((from: import('./RuntimeTypes.js').RuntimeSessionState, to: import('./RuntimeTypes.js').RuntimeSessionState) => {
      this.emit({
        type: 'session_state_changed',
        sessionId: session.sessionId,
        nodeId: session.nodeId,
        from,
        to,
      });

      // UI Bridge: Sync to Workspace Store (only when status actually changes to avoid re-render loops)
      const existingBinding = useWorkspaceStore.getState().nodeRuntimeBindings[session.nodeId];
      if (existingBinding?.adapterStatus !== to || existingBinding?.runtimeSessionId !== session.sessionId) {
        const existingTerminalId = existingBinding?.terminalId;
        useWorkspaceStore.getState().setNodeRuntimeBinding(session.nodeId, {
          terminalId: session.terminalId || existingTerminalId || '',
          runtimeSessionId: session.sessionId,
          adapterStatus: to as any,
        });
      }

      // UI Bridge: Emit legacy Tauri event for NodeTreePane
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

  /**
   * Launch the CLI for a session and complete the full activation pipeline:
   *  1. Register dispatch with backend
   *  2. Check MCP health
   *  3. For interactive PTY: launch CLI in terminal
   *  4. Register session with MCP
   *  5. Wait for agent:ready handshake
   *  6. Build and inject NEW_TASK signal
   *  7. Wait for task ACK
   */
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

  /**
   * Send a task prompt to an already-running session.
   */
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
      await writeToTerminal(session.terminalId, preClear);
      await sleep(PRE_CLEAR_SETTLE_MS);
    }
    await writeToTerminal(session.terminalId, paste);
    await sleep(PASTE_SUBMIT_GAP_MS);
    await writeToTerminal(session.terminalId, submit);

    this.emit({
      type: 'task_injected',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
    });
  }

  /**
   * Send raw input to the PTY for a session.
   */
  async sendInput(args: SendInputArgs): Promise<void> {
    const session = this.getSession(args.sessionId);
    if (!session) throw new Error(`No runtime session: ${args.sessionId}`);

    if (session.isHeadless) {
      throw new Error('Cannot send raw input to a headless session');
    }

    await writeToTerminal(session.terminalId, args.input);
  }

  /**
   * Write a raw bootstrap/connect prompt to a terminal by terminalId.
   * This is the single gateway for Connect-mode prompt injection.
   * All callers must use this instead of writing to the PTY directly.
   */
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

    await writeToTerminal(terminalId, data);
  }

  /**
   * Stop a runtime session. Destroys the PTY if interactive.
   */
  async stopRuntime(args: StopRuntimeArgs): Promise<void> {
    const session = this.getSession(args.sessionId);
    if (!session) return;

    const alreadyTerminal = session.state === 'completed' || session.state === 'failed' || session.state === 'cancelled';
    try {
      if (session.isTerminal && !alreadyTerminal) {
        await writeToTerminal(session.terminalId, '\x03');
        await sleep(200);
        await writeToTerminal(session.terminalId, '\x03');
      }
      session.markCancelled(args.reason ?? 'Stopped by user');
    } catch {
      session.markCancelled(args.reason ?? 'Stopped by user');
    }

    this.cleanupSession(session);
  }

  /**
   * Resolve a permission request for a session.
   */
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
      await writeToTerminal(session.terminalId, response.input);
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

  // ── Session Liveness Validation (Group 5) ────────────────────

  async validateSessionForReuse(
    sessionId: string,
    expectedCliId: import('../workflow/WorkflowTypes.js').CliId,
  ): Promise<SessionLivenessResult> {
    const session = this.sessions.get(sessionId);
    if (!session) {
      return { status: 'stale', details: 'Session object no longer exists in RuntimeManager.' };
    }

    const terminalStates: import('./RuntimeTypes.js').RuntimeSessionState[] = [
      'completed', 'failed', 'cancelled',
    ];
    if (terminalStates.includes(session.state)) {
      return {
        status: 'wrong_state',
        details: `Session is in terminal state "${session.state}".`,
      };
    }

    const midPipelineStates: import('./RuntimeTypes.js').RuntimeSessionState[] = [
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

    // A running or permission-blocked session means the agent is still active from a
    // previous run that was not properly cleaned up. Stop and recreate instead of
    // re-injecting into a session whose MCP connection may be gone.
    if (session.state === 'running' || session.state === 'awaiting_permission') {
      return {
        status: 'wrong_state',
        details: `Session is in active state "${session.state}" and was not cleaned up after the previous run.`,
      };
    }

    if (session.cliId !== expectedCliId) {
      return {
        status: 'cli_mismatch',
        details: `Session CLI is "${session.cliId}" but expected "${expectedCliId}".`,
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
   * Ensure a runtime is ready for a task. (Group 5)
   * If a reusable session exists, it re-injects the task.
   * If not, it stops the old session and creates/launches a new one.
   */
  async ensureRuntimeReadyForTask(args: CreateRuntimeArgs): Promise<RuntimeSession> {
    const existing = this.getSessionForNode(args.missionId, args.nodeId, args.attempt);
    if (existing) {
      const validation = await this.validateSessionForReuse(existing.sessionId, args.cliId);
      if (validation.status === 'reusable') {
        console.log(`[RuntimeManager] Reusing session ${existing.sessionId} for node ${args.nodeId}`);
        await this.reinjectTask(existing.sessionId);
        return existing;
      }

      console.warn(
        `[RuntimeManager] Existing session ${existing.sessionId} not reusable (${validation.status}: ${validation.details}), stopping and recreating.`
      );
      try {
        await this.stopRuntime({
          sessionId: existing.sessionId,
          reason: `Session not reusable: ${validation.details}`,
        });
      } catch {
        // ignore errors stopping stale session
      }
    }

    const session = await this.createRuntimeForNode(args);
    // wireMcpEvents is now called inside createRuntimeForNode.
    this.wirePtyEvents(args.terminalId, session.sessionId);
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
      executionMode: session.executionMode,
      goal: activationPayload.goal,
      workspaceDir: session.workspaceDir,
      assignment: activationPayload.assignment,
    }, baseUrl);

    session.transitionTo('injecting_task');

    if (session.isHeadless) {
      await this.launchHeadless(session, activationPayload, signal, baseUrl);
    } else {
      await this.injectInteractiveTask(session, signal);
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
      s => s.state !== 'completed' && s.state !== 'failed' && s.state !== 'cancelled',
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
        s.state !== 'completed' && s.state !== 'failed' && s.state !== 'cancelled',
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

  /**
   * Wire up MCP SSE event subscriptions for a session.
   * Call after creating a session.
   */
  wireMcpEvents(sessionId: string): () => void {
    const session = this.sessions.get(sessionId);
    if (!session) return () => {};

    return mcpBus.subscribe(sessionId, event => {
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
      }
    });
  }

  /**
   * Wire PTY spawn/exit listeners for a terminal.
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

    listen<{ id: string; data: string }>('pty-data', event => {
      if (event.payload.id !== terminalId) return;
      const session = this.sessions.get(sessionId);
      if (!session || session.state === 'completed' || session.state === 'failed') return;

      session.updateHeartbeat();
      this.emit({ type: 'heartbeat', sessionId, nodeId: session.nodeId, at: Date.now() });

      // Permission Detection (Phase 10)
      const perm = session.adapter.detectPermissionRequest(event.payload.data);
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

      // Completion Detection Fallback
      const comp = session.adapter.detectCompletion(event.payload.data);
      if (comp && session.state === 'running') {
        // We don't auto-complete here yet, but we could emit a hint.
        // Usually MCP tool 'complete_task' is the authority.
      }
    }).then(fn => {
      if (disposed) {
        fn();
      } else {
        const existing = this.ptyCleanupFns.get(sessionId);
        this.ptyCleanupFns.set(sessionId, () => {
          existing?.();
          fn();
        });
      }
    });

    listen<{ id: string }>('pty-exit', async event => {
      if (event.payload.id !== terminalId) return;
      const session = this.sessions.get(sessionId);
      if (!session) return;

      try {
        const stillAlive = await isTerminalActive(terminalId);
        if (stillAlive) return;
      } catch {
        // proceed — PTY was destroyed
      }

      const reason = 'Terminal process exited.';
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

  // ── Internal: Activation Pipeline ──────────────────────────────────

  private async runActivationPipeline(
    session: RuntimeSession,
    activationPayload: import('../missionRuntime.js').RuntimeActivationPayload,
  ): Promise<void> {
    // Ad-hoc sessions (launched directly from the UI without a compiled mission) bypass
    // the full MCP handshake pipeline — there is no graph agent to ACK the task.
    if (session.missionId.startsWith('adhoc-')) {
      session.transitionTo('launching_cli');
      if (session.isTerminal) {
        session.transitionTo('awaiting_cli_ready');
        this.bindRuntimeToTerminalPane(session);
        const terminalReady = await this.waitForTerminalReady(session.terminalId, 5_000);
        if (terminalReady && await this.shouldLaunchCliInTerminal(session)) {
          await sleep(CLI_LAUNCH_DELAY_MS);
          try {
            await writeToTerminal(session.terminalId, `${session.cliId}\r`);
            useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
              cliSource: 'connect_agent',
              cli: session.cliId,
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

    // Register terminal metadata
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

    const isExecStdin = session.adapter.execMode === 'exec_stdin';

    // 3. For interactive PTY: launch CLI in terminal (skip if already running, or exec_stdin)
    if (session.isTerminal && !isExecStdin) {
      session.transitionTo('awaiting_cli_ready');
      this.bindRuntimeToTerminalPane(session);
      const terminalReady = await this.waitForTerminalReady(session.terminalId, 5_000);
      if (!terminalReady) {
        throw new Error(`Terminal ${session.terminalId} did not become active before CLI launch (state: awaiting_cli_ready, node: ${session.nodeId}).`);
      }
      if (await this.shouldLaunchCliInTerminal(session)) {
        await sleep(CLI_LAUNCH_DELAY_MS);
        await writeToTerminal(session.terminalId, `${session.cliId}\r`);
        await sleep(CLI_STARTUP_WAIT_MS);
        useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
          cliSource: 'connect_agent',
          cli: session.cliId,
        });
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

    // 5. Inject bootstrap prompt
    // exec_stdin path: build a combined bootstrap+task prompt and spawn `codex exec -`
    // with the full text piped to stdin.  This avoids the interactive TUI readiness
    // race entirely — no PTY write, no timing tricks needed.
    if (isExecStdin) {
      session.transitionTo('bootstrap_injecting');
      try {
        const execBaseUrl = await getMcpBaseUrl();
        const bootstrapPart = this.buildExecStdinBootstrapPrompt(session, execBaseUrl);
        const taskSignal = buildNewTaskSignal({
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
          executionMode: session.executionMode,
          goal: activationPayload.goal,
          workspaceDir: session.workspaceDir,
          assignment: activationPayload.assignment,
        }, execBaseUrl);
        const combinedPrompt = `${bootstrapPart}\n\n${taskSignal}`;
        await this.launchHeadless(session, activationPayload, combinedPrompt, execBaseUrl);
      } catch (err) {
        const msg = err instanceof Error ? err.message : String(err);
        throw new Error(
          `exec-stdin launch failed for CLI "${session.cliId}" on node "${session.nodeId}": ${msg}`,
        );
      }
      session.transitionTo('bootstrap_sent');
    }

    // PTY path: inject bootstrap prompt into interactive terminal (explicit state)
    if (session.isTerminal && !isExecStdin) {
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
          const promptBody = bootstrapPrompt.replace(/\r$/, '');
          const { preClear, paste, submit } = session.adapter.buildActivationInput(promptBody);
          const settleDelay = session.adapter.postReadySettleDelayMs ?? 0;

          const injectResult = await Promise.race([
            (async () => {
              if (settleDelay > 0) await sleep(settleDelay);
              if (preClear) {
                await writeToTerminal(session.terminalId, preClear);
                await sleep(PRE_CLEAR_SETTLE_MS);
              }
              await writeToTerminal(session.terminalId, paste);
              await sleep(PASTE_SUBMIT_GAP_MS);
              await writeToTerminal(session.terminalId, submit);
              return true;
            })(),
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

    // 6. Wait for agent:ready handshake — only reached if bootstrap was injected (or sent) successfully
    session.transitionTo('awaiting_mcp_ready');

    try {
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

    // 7. Build NEW_TASK signal
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
      executionMode: session.executionMode,
      goal: activationPayload.goal,
      workspaceDir: session.workspaceDir,
      assignment: activationPayload.assignment,
    }, baseUrl);

    // 8. Inject task (exec_stdin path already delivered the task in the combined prompt)
    session.transitionTo('injecting_task');

    if (!isExecStdin) {
      if (session.isHeadless) {
        await this.launchHeadless(session, activationPayload, signal, baseUrl);
      } else {
        await this.injectInteractiveTask(session, signal);
      }
    }

    // 9. Wait for ACK
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
        `Agent for CLI "${session.cliId}" on node "${session.nodeId}" did not call get_task_details within ${Math.round(TASK_ACK_TIMEOUT_MS / 1000)}s (state: awaiting_ack). Check terminal for errors.`,
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
    });

    if (!request || error) {
      throw new Error(error ?? 'Headless execution is not configured for this node.');
    }

    await startHeadlessRun(request as import('./TerminalRuntime.js').HeadlessRunRequest);
  }

  private async injectInteractiveTask(session: RuntimeSession, signal: string): Promise<void> {
    const terminalAlive = await isTerminalActive(session.terminalId);
    if (!terminalAlive) {
      throw new Error(`Terminal process for ${session.nodeId} has exited.`);
    }

    await sleep(CLI_STARTUP_WAIT_MS);

    const adapter = session.adapter;
    const { preClear, paste, submit } = adapter.buildActivationInput(signal);
    if (preClear) {
      await writeToTerminal(session.terminalId, preClear);
      await sleep(PRE_CLEAR_SETTLE_MS);
    }
    await writeToTerminal(session.terminalId, paste);
    await sleep(PASTE_SUBMIT_GAP_MS);
    await writeToTerminal(session.terminalId, submit);

    this.emit({
      type: 'task_injected',
      sessionId: session.sessionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
    });
  }

  private buildExecStdinBootstrapPrompt(
    session: RuntimeSession,
    mcpUrl: string,
  ): string {
    const role = session.role;
    const profileId = session.profileId ?? role;
    // Do NOT say "wait for NEW_TASK" — the task signal is appended directly below this
    // in the combined prompt, so Codex should proceed immediately after connecting.
    return (
      `Connect to MCP before task activation. MCP URL: ${mcpUrl}. ` +
      `Call connect_agent with role="${role}", agentId="${session.agentId}", terminalId="${session.terminalId}", ` +
      `cli="${session.cliId}", profileId="${profileId}", missionId="${session.missionId}", nodeId="${session.nodeId}", attempt=${session.attempt}. ` +
      `After connection, immediately proceed to execute the task described below and call get_task_details to receive your full assignment.`
    );
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
      roleInstructions: '', // Could be enriched from node definition later
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
          const { invoke } = await import('../desktopApi');
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
    useWorkspaceStore.getState().updatePaneDataByTerminalId(session.terminalId, {
      runtimeSessionId: session.sessionId,
      nodeId: session.nodeId,
      roleId: session.role,
      cli: session.cliId,
    });
  }

  private async waitForTerminalReady(terminalId: string, timeoutMs: number): Promise<boolean> {
    const deadline = Date.now() + timeoutMs;
    while (!(await isTerminalActive(terminalId))) {
      if (Date.now() >= deadline) return false;
      await sleep(100);
    }
    return true;
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

    const isKnownRunning = (paneCliSource === 'stdout' || paneCliSource === 'connect_agent') && paneCli === session.cliId;
    if (isKnownRunning) return false;

    if (this.hasDifferentLiveSessionOnTerminal(session)) return false;

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
    this.sessions.delete(session.sessionId);
    const nodeKey = `${session.missionId}:${session.nodeId}:${session.attempt}`;
    if (this.sessionsByNode.get(nodeKey) === session.sessionId) {
      this.sessionsByNode.delete(nodeKey);
    }
    this.notifySnapshot();
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
