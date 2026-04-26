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

import { listen } from '@tauri-apps/api/event';
import { RuntimeSession } from './RuntimeSession.js';
import type {
  CreateRuntimeArgs,
  RuntimeManagerEvent,
  RuntimeManagerSnapshot,
  SendTaskArgs,
  SendInputArgs,
  StopRuntimeArgs,
  ResolvePermissionArgs,
} from './RuntimeTypes.js';
import { getCliAdapter } from './adapters/index.js';

import {
  checkMcpHealth,
  getMcpBaseUrl,
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
import { useWorkspaceStore } from '../../store/workspace.js';
import { emit } from '@tauri-apps/api/event';

// ──────────────────────────────────────────────
// Constants
// ──────────────────────────────────────────────

const CLI_LAUNCH_DELAY_MS = 500;
const CLI_STARTUP_WAIT_MS = 2_000;
const PASTE_SUBMIT_GAP_MS = 150;
const BOOTSTRAP_EVENT_TIMEOUT_MS = 8_000;
const TASK_ACK_TIMEOUT_MS = 30_000;

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

        // The legacy pipeline needed this wired.
        this.wireMcpEvents(session.sessionId);
        this.wirePtyEvents(payload.terminalId, session.sessionId);

        await this.launchCli(session.sessionId, payload);
      } catch (error) {
        console.error(`[RuntimeManager] Failed to launch CLI for ${node_id}:`, error);
      }
    });
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
        useWorkspaceStore.getState().setNodeRuntimeBinding(session.nodeId, {
          terminalId: session.terminalId,
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

    const { paste, submit } = adapter.buildActivationInput(signal);
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
   * Stop a runtime session. Destroys the PTY if interactive.
   */
  async stopRuntime(args: StopRuntimeArgs): Promise<void> {
    const session = this.getSession(args.sessionId);
    if (!session) return;

    try {
      if (session.isTerminal) {
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

    listen<{ id: string }>('pty-spawned', event => {
      if (event.payload.id !== terminalId) return;
      const session = this.sessions.get(sessionId);
      if (!session) return;
    }).then(fn => {
      unlistenSpawn = fn;
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
      const existing = this.ptyCleanupFns.get(sessionId);
      this.ptyCleanupFns.set(sessionId, () => {
        existing?.();
        fn();
      });
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
      unlistenExit = fn;
    });

    return () => {
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
        // Wait up to 5s for the PTY to spawn (the pane must be added before launchCli is called)
        const ptyDeadline = Date.now() + 5_000;
        while (!(await isTerminalActive(session.terminalId))) {
          if (Date.now() >= ptyDeadline) break;
          await sleep(100);
        }
        await sleep(CLI_LAUNCH_DELAY_MS);
        try {
          await writeToTerminal(session.terminalId, `${session.cliId}\r`);
        } catch {
          // PTY still not available — user can interact with the terminal manually
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

    // 3. For interactive PTY: launch CLI in terminal
    if (session.isTerminal) {
      session.transitionTo('awaiting_cli_ready');
      await sleep(CLI_LAUNCH_DELAY_MS);
      await writeToTerminal(session.terminalId, `${session.cliId}\r`);
      await sleep(CLI_STARTUP_WAIT_MS);
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

    // 5. Wait for agent:ready handshake
    session.transitionTo('awaiting_mcp_ready');
    await mcpReadyPromise;
    session.transitionTo('ready');

    await acknowledgeActivation({
      missionId: session.missionId,
      nodeId: session.nodeId,
      attempt: session.attempt,
      status: 'ready',
    });

    // 6. Build NEW_TASK signal
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

    // 7. Inject task
    session.transitionTo('injecting_task');

    if (session.isHeadless) {
      await this.launchHeadless(session, activationPayload, signal, baseUrl);
    } else {
      await this.injectInteractiveTask(session, signal);
    }

    // 8. Wait for ACK
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
        `Agent did not call get_task_details within ${Math.round(TASK_ACK_TIMEOUT_MS / 1000)}s. Check terminal for errors.`,
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
    const { paste, submit } = adapter.buildActivationInput(signal);
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
          reject(new Error(`Timed out waiting for ${eventType} on ${sessionId}`));
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
