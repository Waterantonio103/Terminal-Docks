/**
 * WorkflowDefinition.ts — Persisted workflow design model.
 *
 * A WorkflowDefinition is a saved graph design that contains ONLY static
 * configuration. It must never contain runtime state such as terminal IDs,
 * process IDs, session IDs, statuses, attempts, or permission state.
 *
 * Conversion helpers bridge the existing `WorkflowGraph` type (from workspace.ts)
 * to this clean definition model.
 *
 * Phase 2 — Wave 2 / Agent A
 */

import type {
  AuthoringMode,
  CapabilityEntry,
  CliId,
  EdgeCondition,
  ExecutionMode,
  LaunchMode,
  TaskRequirements,
  WorkflowNodeKind,
} from './WorkflowTypes.js';
import type {
  WorkflowEdge,
  WorkflowGraph,
  WorkflowNode,
} from '../../store/workspace.js';

// ──────────────────────────────────────────────
// Definition Types
// ──────────────────────────────────────────────

export interface WorkflowNodeDefinition {
  readonly id: string;
  readonly kind: WorkflowNodeKind;
  readonly roleId: string;

  readonly config: {
    readonly prompt?: string;
    readonly mode?: LaunchMode;
    readonly workspaceDir?: string;
    readonly instructionOverride?: string;
    readonly cli?: CliId;
    readonly executionMode?: ExecutionMode;
    readonly authoringMode?: AuthoringMode;
    readonly presetId?: string | null;
    readonly runVersion?: number;
    readonly adaptiveSeed?: boolean;
    readonly profileId?: string;
    readonly capabilities?: CapabilityEntry[];
    readonly requirements?: TaskRequirements;
    readonly parentId?: string;
    readonly extent?: 'parent';
    readonly width?: number;
    readonly height?: number;
    readonly label?: string;
    readonly position?: { x: number; y: number };
    readonly autoLinked?: boolean;
  };
}

export interface WorkflowEdgeDefinition {
  readonly fromNodeId: string;
  readonly toNodeId: string;
  readonly condition: EdgeCondition;
}

export interface WorkflowDefinition {
  readonly id: string;
  readonly name: string;
  readonly nodes: readonly WorkflowNodeDefinition[];
  readonly edges: readonly WorkflowEdgeDefinition[];
  readonly createdAt: string;
  readonly updatedAt: string;
}

// ──────────────────────────────────────────────
// Runtime-only field denylist
//
// These fields must NEVER appear in a persisted
// WorkflowDefinition. They exist only in WorkflowRun.
// ──────────────────────────────────────────────

const RUNTIME_CONFIG_FIELDS: ReadonlySet<string> = new Set([
  'terminalId',
  'terminalTitle',
  'paneId',
]);

const RUNTIME_NODE_FIELDS: ReadonlySet<string> = new Set([
  'status',
  'mcpState',
]);

// ──────────────────────────────────────────────
// Node Kind Detection
// ──────────────────────────────────────────────

function detectNodeKind(node: WorkflowNode): WorkflowNodeKind {
  const roleId = node.roleId;
  if (roleId === 'task') return 'task';
  if (roleId === 'barrier') return 'barrier';
  if (roleId === 'frame') return 'frame';
  if (roleId === 'reroute') return 'reroute';
  return 'agent';
}

// ──────────────────────────────────────────────
// Sanitize — strip runtime fields from a node config
// ──────────────────────────────────────────────

function sanitizeNodeConfig(
  config: WorkflowNode['config'],
): WorkflowNodeDefinition['config'] {
  if (!config) return {};

  const clean: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(config)) {
    if (RUNTIME_CONFIG_FIELDS.has(key)) continue;
    if (value === undefined) continue;
    clean[key] = value;
  }
  return clean as WorkflowNodeDefinition['config'];
}

// ──────────────────────────────────────────────
// Conversion: WorkflowGraph → WorkflowDefinition
// ──────────────────────────────────────────────

export function workflowGraphToDefinition(
  graph: WorkflowGraph,
  name?: string,
): WorkflowDefinition {
  const now = new Date().toISOString();

  const nodes: WorkflowNodeDefinition[] = graph.nodes.map(node => ({
    id: node.id,
    kind: detectNodeKind(node),
    roleId: node.roleId,
    config: sanitizeNodeConfig(node.config),
  }));

  const edges: WorkflowEdgeDefinition[] = graph.edges.map(edge => ({
    fromNodeId: edge.fromNodeId,
    toNodeId: edge.toNodeId,
    condition: edge.condition ?? 'always',
  }));

  return {
    id: graph.id,
    name: name ?? graph.id,
    nodes,
    edges,
    createdAt: now,
    updatedAt: now,
  };
}

// ──────────────────────────────────────────────
// Conversion: WorkflowDefinition → WorkflowGraph
//
// Reconstructs a WorkflowGraph suitable for the existing graph UI.
// All nodes get status='idle' since definitions carry no runtime state.
// ──────────────────────────────────────────────

export function definitionToWorkflowGraph(
  def: WorkflowDefinition,
): WorkflowGraph {
  const nodes: WorkflowNode[] = def.nodes.map(nodeDef => ({
    id: nodeDef.id,
    roleId: nodeDef.roleId,
    status: 'idle' as const,
    config: { ...nodeDef.config },
  }));

  const edges: WorkflowEdge[] = def.edges.map(edgeDef => ({
    fromNodeId: edgeDef.fromNodeId,
    toNodeId: edgeDef.toNodeId,
    condition: edgeDef.condition,
  }));

  return { id: def.id, nodes, edges };
}

// ──────────────────────────────────────────────
// Validation — ensure no runtime fields leaked in
// ──────────────────────────────────────────────

export interface DefinitionValidationIssue {
  nodeId: string;
  field: string;
  reason: 'runtime_field_in_config' | 'runtime_field_on_node';
}

export function validateDefinition(
  def: WorkflowDefinition,
): DefinitionValidationIssue[] {
  const issues: DefinitionValidationIssue[] = [];

  for (const node of def.nodes) {
    for (const field of RUNTIME_NODE_FIELDS) {
      if ((node as unknown as Record<string, unknown>)[field] !== undefined) {
        issues.push({
          nodeId: node.id,
          field,
          reason: 'runtime_field_on_node',
        });
      }
    }

    if (node.config) {
      for (const field of RUNTIME_CONFIG_FIELDS) {
        if ((node.config as Record<string, unknown>)[field] !== undefined) {
          issues.push({
            nodeId: node.id,
            field,
            reason: 'runtime_field_in_config',
          });
        }
      }
    }
  }

  return issues;
}

// ──────────────────────────────────────────────
// Sanitize a full definition (strips runtime fields)
// ──────────────────────────────────────────────

export function sanitizeDefinition(
  def: WorkflowDefinition,
): WorkflowDefinition {
  return {
    ...def,
    nodes: def.nodes.map(node => ({
      ...node,
      config: sanitizeNodeConfig(
        node.config as unknown as WorkflowNode['config'],
      ),
    })),
  };
}

// ──────────────────────────────────────────────
// Extract executable node IDs (agents only)
// ──────────────────────────────────────────────

export function getExecutableNodeIds(def: WorkflowDefinition): string[] {
  return def.nodes
    .filter(n => n.kind === 'agent')
    .map(n => n.id);
}

// ──────────────────────────────────────────────
// Extract task node
// ──────────────────────────────────────────────

export function getTaskNode(
  def: WorkflowDefinition,
): WorkflowNodeDefinition | undefined {
  return def.nodes.find(n => n.kind === 'task');
}

// ──────────────────────────────────────────────
// Extract edges outgoing from a specific node
// ──────────────────────────────────────────────

export function getOutgoingEdges(
  def: WorkflowDefinition,
  nodeId: string,
): readonly WorkflowEdgeDefinition[] {
  return def.edges.filter(e => e.fromNodeId === nodeId);
}

// ──────────────────────────────────────────────
// Extract edges incoming to a specific node
// ──────────────────────────────────────────────

export function getIncomingEdges(
  def: WorkflowDefinition,
  nodeId: string,
): readonly WorkflowEdgeDefinition[] {
  return def.edges.filter(e => e.toNodeId === nodeId);
}
