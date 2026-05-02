/**
 * WorkflowStateMachine.ts — Node lifecycle state machine with validation.
 *
 * Defines legal transitions between NodeLifecycleState values.
 * Not every CLI uses every state — the transition table allows
 * skipping optional intermediate states (e.g., MCP registration).
 *
 * Phase 5 — Wave 3 / Agent A
 */

import type { NodeLifecycleState } from './WorkflowTypes.js';

// ──────────────────────────────────────────────
// Transition Table
//
// Each key maps to the set of states it may transition to.
// Terminal states (completed, failed, cancelled) have no exits.
// ──────────────────────────────────────────────

const TRANSITIONS: ReadonlyMap<NodeLifecycleState, ReadonlySet<NodeLifecycleState>> = new Map([
  ['idle', new Set(['queued'])],

  ['queued', new Set([
    'launching_runtime',
    'failed',
    'cancelled',
  ])],

  ['launching_runtime', new Set([
    'awaiting_cli_ready',
    'registering_mcp',
    'injecting_task',
    'failed',
    'cancelled',
  ])],

  ['awaiting_cli_ready', new Set([
    'registering_mcp',
    'injecting_task',
    'failed',
    'cancelled',
  ])],

  ['registering_mcp', new Set([
    'bootstrap_injecting',
    'awaiting_mcp_ready',
    'injecting_task',
    'failed',
    'cancelled',
  ])],

  ['bootstrap_injecting', new Set([
    'bootstrap_sent',
    'failed',
    'cancelled',
  ])],

  ['bootstrap_sent', new Set([
    'awaiting_mcp_ready',
    'failed',
    'cancelled',
  ])],

  ['awaiting_mcp_ready', new Set([
    'manual_takeover',
    'injecting_task',
    'failed',
    'cancelled',
  ])],

  ['manual_takeover', new Set([
    'injecting_task',
    'completed',
    'failed',
    'cancelled',
  ])],

  ['injecting_task', new Set([
    'awaiting_ack',
    'manual_takeover',
    'running',
    'failed',
    'cancelled',
  ])],

  ['awaiting_ack', new Set([
    'manual_takeover',
    'running',
    'failed',
    'cancelled',
  ])],

  ['running', new Set([
    'manual_takeover',
    'awaiting_permission',
    'completed',
    'failed',
    'cancelled',
  ])],

  ['awaiting_permission', new Set([
    'running',
    'completed',
    'failed',
    'cancelled',
  ])],

  ['completed', new Set()],

  ['failed', new Set()],

  ['cancelled', new Set()],
]);

// ──────────────────────────────────────────────
// State Classification
// ──────────────────────────────────────────────

const TERMINAL_STATES: ReadonlySet<NodeLifecycleState> = new Set([
  'completed',
  'failed',
  'cancelled',
]);

const ACTIVE_STATES: ReadonlySet<NodeLifecycleState> = new Set([
  'queued',
  'launching_runtime',
  'awaiting_cli_ready',
  'registering_mcp',
  'bootstrap_injecting',
  'bootstrap_sent',
  'awaiting_mcp_ready',
  'injecting_task',
  'awaiting_ack',
  'manual_takeover',
  'running',
  'awaiting_permission',
]);

// ──────────────────────────────────────────────
// Validation
// ──────────────────────────────────────────────

export interface TransitionValidation {
  legal: boolean;
  reason?: string;
}

export function isValidTransition(
  from: NodeLifecycleState,
  to: NodeLifecycleState,
): boolean {
  if (from === to) return true;
  const allowed = TRANSITIONS.get(from);
  if (!allowed) return false;
  return allowed.has(to);
}

export function validateTransition(
  from: NodeLifecycleState,
  to: NodeLifecycleState,
): TransitionValidation {
  if (from === to) {
    return { legal: true };
  }

  if (TERMINAL_STATES.has(from)) {
    return {
      legal: false,
      reason: `Cannot transition from terminal state "${from}" to "${to}".`,
    };
  }

  const allowed = TRANSITIONS.get(from);
  if (!allowed) {
    return {
      legal: false,
      reason: `Unknown source state "${from}".`,
    };
  }

  if (!allowed.has(to)) {
    const allowedList = Array.from(allowed).join(', ');
    return {
      legal: false,
      reason: `Illegal transition from "${from}" to "${to}". Allowed: ${allowedList}.`,
    };
  }

  return { legal: true };
}

// ──────────────────────────────────────────────
// State Queries
// ──────────────────────────────────────────────

export function isTerminalState(state: NodeLifecycleState): boolean {
  return TERMINAL_STATES.has(state);
}

export function isActiveState(state: NodeLifecycleState): boolean {
  return ACTIVE_STATES.has(state);
}

export function getAllowedTransitions(state: NodeLifecycleState): NodeLifecycleState[] {
  const allowed = TRANSITIONS.get(state);
  return allowed ? Array.from(allowed) : [];
}

// ──────────────────────────────────────────────
// Lifecycle Progression
//
// The "full" linear path a node may follow.
// Adapters may skip optional states.
// ──────────────────────────────────────────────

const LIFECYCLE_ORDER: readonly NodeLifecycleState[] = [
  'idle',
  'queued',
  'launching_runtime',
  'awaiting_cli_ready',
  'registering_mcp',
  'bootstrap_injecting',
  'bootstrap_sent',
  'awaiting_mcp_ready',
  'injecting_task',
  'awaiting_ack',
  'running',
  'awaiting_permission',
  'completed',
];

const LIFECYCLE_INDEX = new Map(LIFECYCLE_ORDER.map((s, i) => [s, i]));

export function getLifecycleIndex(state: NodeLifecycleState): number {
  return LIFECYCLE_INDEX.get(state) ?? -1;
}

export function isProgression(
  from: NodeLifecycleState,
  to: NodeLifecycleState,
): boolean {
  const fromIdx = LIFECYCLE_INDEX.get(from) ?? -1;
  const toIdx = LIFECYCLE_INDEX.get(to) ?? -1;
  if (fromIdx < 0 || toIdx < 0) return false;
  return toIdx > fromIdx;
}

export function getLifecyclePath(): readonly NodeLifecycleState[] {
  return LIFECYCLE_ORDER;
}
