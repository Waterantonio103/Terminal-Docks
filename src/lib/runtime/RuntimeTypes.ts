/**
 * RuntimeTypes.ts — Shared types for the runtime layer.
 *
 * Defines the contracts used by RuntimeManager, RuntimeSession,
 * TerminalRuntime, and CLI adapters.
 *
 * Phase 4 — Wave 3 / Agent B
 */

import type { CliId, ExecutionMode, PermissionCategory, PermissionDecision } from '../workflow/WorkflowTypes.js';
import type { RuntimeActivationPayload } from '../missionRuntime.js';


// ──────────────────────────────────────────────
// Session Lifecycle States
// ──────────────────────────────────────────────

export type RuntimeSessionState =
  | 'creating'
  | 'launching_cli'
  | 'awaiting_cli_ready'
  | 'registering_mcp'
  | 'awaiting_mcp_ready'
  | 'ready'
  | 'injecting_task'
  | 'awaiting_ack'
  | 'running'
  | 'awaiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ──────────────────────────────────────────────
// Create Runtime Arguments
// ──────────────────────────────────────────────
export interface CreateRuntimeArgs {
  missionId: string;
  nodeId: string;
  attempt: number;
  role: string;
  agentId: string;
  profileId: string | null;
  cliId: CliId;
  executionMode: ExecutionMode;
  terminalId: string;
  paneId?: string;
  workspaceDir: string | null;
  goal?: string | null;
  inputPayload?: unknown;
  legalTargets?: import('../workflow/WorkflowTypes.js').LegalTarget[];
  upstreamPayloads?: import('../workflow/WorkflowRun.js').HandoffRecord[];
  runId?: string | null;
  activationPayload?: RuntimeActivationPayload;
  capabilities?: Array<{ id: string; level?: number; verifiedBy?: string }> | null;
}

// ──────────────────────────────────────────────
// Runtime Session Descriptor
// ──────────────────────────────────────────────

export interface RuntimeSessionDescriptor {
  readonly sessionId: string;
  readonly missionId: string;
  readonly nodeId: string;
  readonly attempt: number;
  readonly role: string;
  readonly agentId: string;
  readonly profileId: string;
  readonly cliId: CliId;
  readonly executionMode: ExecutionMode;
  readonly terminalId: string;
  readonly paneId?: string;
  readonly workspaceDir: string | null;
  readonly createdAt: number;

  state: RuntimeSessionState;
  lastHeartbeatAt?: number;
  disconnectedAt?: number;
  lastError?: string;
  activePermission?: RuntimePermissionRequest;
  goal?: string;
  legalTargets?: import('../workflow/WorkflowTypes.js').LegalTarget[];
  upstreamPayloads?: import('../workflow/WorkflowRun.js').HandoffRecord[];
}

// ──────────────────────────────────────────────
// Permission Types
// ──────────────────────────────────────────────

export interface RuntimePermissionRequest {
  readonly permissionId: string;
  readonly category: PermissionCategory;
  readonly rawPrompt: string;
  readonly detail: string;
  readonly detectedAt: number;
  readonly sessionId: string;
  readonly nodeId: string;
}

// ──────────────────────────────────────────────
// Runtime Events
//
// Emitted by RuntimeManager for UI and Orchestrator subscription.
// ──────────────────────────────────────────────

export type RuntimeManagerEvent =
  | { type: 'session_created'; sessionId: string; nodeId: string; missionId: string }
  | { type: 'session_state_changed'; sessionId: string; nodeId: string; from: RuntimeSessionState; to: RuntimeSessionState }
  | { type: 'session_completed'; sessionId: string; nodeId: string; outcome: 'success' | 'failure' }
  | { type: 'session_failed'; sessionId: string; nodeId: string; error: string }
  | { type: 'session_disconnected'; sessionId: string; nodeId: string; reason: string }
  | { type: 'permission_requested'; sessionId: string; nodeId: string; request: RuntimePermissionRequest }
  | { type: 'permission_resolved'; sessionId: string; nodeId: string; permissionId: string; decision: PermissionDecision }
  | { type: 'task_injected'; sessionId: string; nodeId: string; attempt: number }
  | { type: 'task_acked'; sessionId: string; nodeId: string; attempt: number }
  | { type: 'output_captured'; sessionId: string; nodeId: string; text: string }
  | { type: 'heartbeat'; sessionId: string; nodeId: string; at: number }
  | { type: 'artifact_published'; sessionId: string; nodeId: string; artifact: { id: string; kind: import('../workflow/WorkflowTypes.js').ArtifactKind; label: string; content?: string; path?: string; timestamp: number } };

// ──────────────────────────────────────────────
// Health Check
// ──────────────────────────────────────────────

export interface McpHealthStatus {
  available: boolean;
  baseUrl: string;
  checkedAt: number;
}

// ──────────────────────────────────────────────
// Send Task Arguments
// ──────────────────────────────────────────────

export interface SendTaskArgs {
  sessionId: string;
  prompt: string;
  payloadJson: string;
}

// ──────────────────────────────────────────────
// Send Input Arguments
// ──────────────────────────────────────────────

export interface SendInputArgs {
  sessionId: string;
  input: string;
}

// ──────────────────────────────────────────────
// Stop Runtime Arguments
// ──────────────────────────────────────────────

export interface StopRuntimeArgs {
  sessionId: string;
  reason?: string;
}

// ──────────────────────────────────────────────
// Resolve Permission Arguments
// ──────────────────────────────────────────────

export interface ResolvePermissionArgs {
  sessionId: string;
  permissionId: string;
  decision: PermissionDecision;
}

// ──────────────────────────────────────────────
// Snapshot for UI consumers
// ──────────────────────────────────────────────

export interface RuntimeManagerSnapshot {
  sessions: Array<{
    sessionId: string;
    missionId: string;
    nodeId: string;
    attempt: number;
    role: string;
    agentId: string;
    cliId: CliId;
    executionMode: ExecutionMode;
    terminalId: string;
    paneId?: string;
    workspaceDir: string | null;
    state: RuntimeSessionState;
    lastHeartbeatAt?: number;
    lastError?: string;
    activePermission?: RuntimePermissionRequest;
    createdAt: number;
  }>;
  activeCount: number;
}
