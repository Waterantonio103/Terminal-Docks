/**
 * WorkflowTypes.ts — Shared types used by both WorkflowDefinition and WorkflowRun.
 *
 * These types represent the domain vocabulary for the workflow system.
 * They are designed to be CLI-agnostic and independent of any specific runtime.
 *
 * Phase 2 — Wave 2 / Agent A
 */

// ──────────────────────────────────────────────
// Node Kinds
// ──────────────────────────────────────────────

export type WorkflowNodeKind =
  | 'task'
  | 'agent'
  | 'barrier'
  | 'frame'
  | 'reroute';

// ──────────────────────────────────────────────
// Edge Conditions
// ──────────────────────────────────────────────

export type EdgeCondition = 'always' | 'on_success' | 'on_failure';

// ──────────────────────────────────────────────
// CLI Identifiers — canonical source is cliIdentity.ts
// ──────────────────────────────────────────────

export type { CliId } from '../cliIdentity.js';
export { normalizeCliId, isValidCliId, CANONICAL_CLI_IDS, assertCliIdConsistency } from '../cliIdentity.js';

// ──────────────────────────────────────────────
// Execution Modes
// ──────────────────────────────────────────────

export type ExecutionMode =
  | 'headless'
  | 'streaming_headless'
  | 'interactive_pty';

// ──────────────────────────────────────────────
// Authoring Modes
// ──────────────────────────────────────────────

export type AuthoringMode = 'preset' | 'graph' | 'adaptive';

// ──────────────────────────────────────────────
// Launch Mode
// ──────────────────────────────────────────────

export type LaunchMode = 'build' | 'edit';

// ──────────────────────────────────────────────
// Completion Outcome
// ──────────────────────────────────────────────

export type CompletionOutcome = 'success' | 'failure';

// ──────────────────────────────────────────────
// Worker Capabilities
// ──────────────────────────────────────────────

export type CapabilityId =
  | 'planning'
  | 'coding'
  | 'testing'
  | 'review'
  | 'security'
  | 'repo_analysis'
  | 'shell_execution';

export interface CapabilityEntry {
  id: CapabilityId;
  level?: 0 | 1 | 2 | 3;
  verifiedBy?: 'profile' | 'runtime';
}

export interface TaskRequirements {
  requiredCapabilities?: CapabilityId[];
  preferredCapabilities?: CapabilityId[];
  fileScope?: string[];
  workingDir?: string;
  writeAccess?: boolean;
  parallelSafe?: boolean;
}

// ──────────────────────────────────────────────
// Node Lifecycle States
//
// These represent the canonical lifecycle of an executable
// node during a workflow run. Not every CLI uses every state.
// ──────────────────────────────────────────────

export type NodeLifecycleState =
  | 'idle'
  | 'queued'
  | 'launching_runtime'
  | 'awaiting_cli_ready'
  | 'registering_mcp'
  | 'bootstrap_injecting'
  | 'bootstrap_sent'
  | 'awaiting_mcp_ready'
  | 'injecting_task'
  | 'awaiting_ack'
  | 'running'
  | 'awaiting_permission'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ──────────────────────────────────────────────
// Run-Level Status
// ──────────────────────────────────────────────

export type RunStatus =
  | 'idle'
  | 'running'
  | 'completed'
  | 'failed'
  | 'cancelled';

// ──────────────────────────────────────────────
// Permission Types
// ──────────────────────────────────────────────

export type PermissionCategory =
  | 'shell_execution'
  | 'file_edit'
  | 'file_read'
  | 'network_access'
  | 'package_install'
  | 'unknown';

export type PermissionDecision = 'approve' | 'deny';

export interface PermissionRequest {
  permissionId: string;
  nodeId: string;
  category: PermissionCategory;
  description: string;
  rawPrompt?: string;
  detectedAt: number;
}

// ──────────────────────────────────────────────
// Artifact Types
// ──────────────────────────────────────────────

export type ArtifactKind = 'file_change' | 'summary' | 'reference';

export interface Artifact {
  id: string;
  kind: ArtifactKind;
  label: string;
  content?: string;
  path?: string;
  timestamp: number;
}

// ──────────────────────────────────────────────
// Legal Target (used in assignment payloads)
// ──────────────────────────────────────────────

export interface LegalTarget {
  targetNodeId: string;
  targetRoleId: string;
  condition: EdgeCondition;
  allowedOutcomes: CompletionOutcome[];
}

// ──────────────────────────────────────────────
// Utility — categorize node status for UI
// ──────────────────────────────────────────────

export type NodeStatusCategory = 'idle' | 'online' | 'success' | 'failure';

export function categorizeNodeStatus(status: NodeLifecycleState | undefined): NodeStatusCategory {
  if (!status || status === 'idle') return 'idle';
  if (status === 'completed') return 'success';
  if (status === 'failed' || status === 'cancelled') return 'failure';
  return 'online';
}
