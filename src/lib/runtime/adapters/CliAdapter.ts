/**
 * CLI Adapter Interface
 *
 * Generic contract for CLI-specific runtime behavior.
 * The Workflow Orchestrator and Runtime Manager speak to this interface
 * and never directly to any particular CLI.
 *
 * Each adapter encapsulates:
 *   - how to build the launch command
 *   - how to detect the CLI is ready for task injection
 *   - how to format the initial task prompt
 *   - how to detect permission requests from PTY output
 *   - how to build the PTY input that approves/denies a permission
 *   - how to detect task completion from PTY output
 *   - how to normalize raw PTY output into structured events
 */

// ---------------------------------------------------------------------------
// Shared result types
// ---------------------------------------------------------------------------

export type PermissionCategory =
  | 'shell_execution'
  | 'file_edit'
  | 'file_read'
  | 'network_access'
  | 'package_install'
  | 'unknown';

export type CompletionOutcome = 'success' | 'failure';

export type ReadyDetectionConfidence = 'low' | 'medium' | 'high';

export type CliOutputStatus =
  | 'idle'
  | 'processing'
  | 'completed'
  | 'waiting_auth'
  | 'waiting_user_answer'
  | 'error';

import type { ExecutionMode } from '../../workflow/WorkflowTypes.js';

// ---------------------------------------------------------------------------
// Context types passed into adapter methods by the Runtime Manager
// ---------------------------------------------------------------------------

export interface LaunchContext {
  sessionId: string;
  missionId: string;
  nodeId: string;
  role: string;
  agentId: string;
  profileId: string;
  workspaceDir: string | null;
  mcpUrl: string;
  executionMode: ExecutionMode;
  model?: string | null;
  yolo?: boolean;
  envOverrides?: Record<string, string>;
}

export interface TaskContext {
  sessionId: string;
  missionId: string;
  nodeId: string;
  role: string;
  agentId: string;
  attempt: number;
  taskSeq: number;
  prompt: string;
  payloadJson: string;
}

export interface PermissionRequest {
  permissionId: string;
  category: PermissionCategory;
  rawPrompt: string;
  detail: string;
}

export type PermissionDecision = 'approve' | 'deny';

export interface PermissionResponse {
  input: string;
}

// ---------------------------------------------------------------------------
// Detection result types
// ---------------------------------------------------------------------------

export interface ReadyDetectionResult {
  ready: boolean;
  confidence: ReadyDetectionConfidence;
  detail?: string;
}

export interface StatusDetectionResult {
  status: CliOutputStatus;
  confidence: ReadyDetectionConfidence;
  detail: string;
  fixtureGated?: boolean;
}

export interface PermissionDetectionResult {
  detected: true;
  request: PermissionRequest;
}

export interface CompletionDetectionResult {
  detected: true;
  outcome: CompletionOutcome;
  summary?: string;
}

// ---------------------------------------------------------------------------
// Normalized output event
// ---------------------------------------------------------------------------

export type RuntimeOutputEventKind =
  | 'banner'
  | 'ready'
  | 'heartbeat'
  | 'task_acked'
  | 'task_completed'
  | 'permission_request'
  | 'process_exit'
  | 'unknown';

export interface RuntimeOutputEvent {
  kind: RuntimeOutputEventKind;
  cli: string;
  timestamp: number;
  detail?: string;
  confidence?: ReadyDetectionConfidence;
  permissionRequest?: PermissionRequest;
  outcome?: CompletionOutcome;
  taskSeq?: number;
}

// ---------------------------------------------------------------------------
// Launch command result
// ---------------------------------------------------------------------------

export type PromptDelivery = 'arg_file' | 'arg_text' | 'stdin' | 'interactive_pty' | 'unsupported';

export interface LaunchCommand {
  command: string;
  args: string[];
  env: Record<string, string>;
  promptDelivery: PromptDelivery;
  unsupportedReason?: string;
}

// ---------------------------------------------------------------------------
// CLI Adapter interface
// ---------------------------------------------------------------------------

export interface CliAdapter {
  /** Unique CLI identifier, e.g. 'claude', 'codex', 'gemini', 'opencode'. */
  readonly id: string;

  /** Human-readable label, e.g. 'Claude Code'. */
  readonly label: string;

  /**
   * Build the command to launch this CLI.
   * Returns a LaunchCommand with the binary, args, env, and prompt delivery mode.
   */
  buildLaunchCommand(context: LaunchContext): LaunchCommand;

  /**
   * Inspect raw PTY output and determine if the CLI is ready for task injection.
   * The adapter accumulates output across calls if needed.
   */
  detectReady(output: string): ReadyDetectionResult;

  /**
   * Inspect raw PTY output and classify the CLI's output state.
   * Only `idle` is safe for managed task injection. RuntimeManager still owns
   * PTY liveness, ownership, locks, permission state, and timeout policy.
   */
  detectStatus(output: string): StatusDetectionResult;

  /**
   * Build the initial task prompt to inject into the CLI.
   * This is the text the Runtime Manager writes into the PTY or passes as an arg.
   */
  buildInitialPrompt(context: TaskContext): string;

  /**
   * Inspect raw PTY output for a permission prompt.
   * Returns null if no permission request is detected.
   */
  detectPermissionRequest(output: string): PermissionDetectionResult | null;

  /**
   * Given a user decision on a permission request, return the exact PTY input
   * to inject (e.g. 'y\r', 'n\r', '\r', '\x1b[B\r').
   */
  buildPermissionResponse(decision: PermissionDecision, request: PermissionRequest): PermissionResponse;

  /**
   * Inspect raw PTY output for task completion.
   * Returns null if no completion is detected.
   */
  detectCompletion(output: string): CompletionDetectionResult | null;

  /**
   * Normalize a chunk of raw PTY output into structured runtime events.
   */
  normalizeOutput(output: string): RuntimeOutputEvent[];

  /**
   * Build the PTY input for sending a NEW_TASK activation signal.
   * Some CLIs need bracketed paste, some need raw text + enter.
   *
   * Optional `preClear` is written first (e.g. Ctrl+U) with a settle gap before
   * `paste` so that an adapter's line-clear and the pasted text arrive as
   * separate PTY writes rather than a single atomic chunk.
   */
  buildActivationInput(signal: string): { preClear?: string; paste: string; submit: string };

  /**
   * Optional milliseconds RuntimeManager waits after detecting CLI ready
   * before injecting the bootstrap prompt.  Use for CLIs whose readline
   * continues to reset for a short period after the first prompt appears.
   */
  readonly postReadySettleDelayMs?: number;

  /**
   * Execution strategy for this adapter:
   *   'pty'        — launch in an interactive PTY terminal (default for most CLIs)
   *   'exec_stdin' — spawn as a child process with piped stdin; the full prompt
   *                  (bootstrap + task) is written to stdin then stdin is closed.
   *                  This is for explicit legacy/headless adapters only, not for
   *                  normal interactive workflow launches.
   */
  readonly execMode?: 'pty' | 'exec_stdin';
}
