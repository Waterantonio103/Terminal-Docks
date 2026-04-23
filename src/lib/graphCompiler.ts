import type { Edge, Node } from '@xyflow/react';
import type {
  CompiledMission,
  CompiledMissionEdge,
  CompiledMissionNode,
  TaskRequirements,
  WorkerCapability,
  WorkerCapabilityId,
  WorkflowAuthoringMode,
  WorkflowAgentCli,
  WorkflowEdgeCondition,
  WorkflowExecutionMode,
  WorkflowGraph,
  WorkflowMode,
  WorkflowNode,
  WorkflowNodeStatus,
} from '../store/workspace.js';
import { deriveExecutionLayers } from './graphUtils.js';
import agentsConfig from '../config/agents.js';

type FlowNodeLike = Pick<Node, 'id' | 'type' | 'position' | 'parentId' | 'extent' | 'style'> & {
  data?: Record<string, unknown>;
};

type FlowEdgeLike = Pick<Edge, 'id' | 'source' | 'target' | 'label'> & {
  data?: Record<string, unknown>;
};

type RuntimeNodeKind = 'task' | 'agent' | 'barrier' | 'frame' | 'reroute';

const CONDITION_SORT_ORDER: Record<WorkflowEdgeCondition, number> = {
  always: 0,
  on_success: 1,
  on_failure: 2,
};

const NODE_STATUS_FALLBACK: WorkflowNodeStatus = 'idle';
const AGENT_CLI_FALLBACK: WorkflowAgentCli = 'claude';
const EXECUTION_MODE_FALLBACK: WorkflowExecutionMode = 'streaming_headless';
const MODE_FALLBACK: WorkflowMode = 'build';
const WORKER_CAPABILITY_IDS: WorkerCapabilityId[] = ['planning', 'coding', 'testing', 'review', 'security', 'repo_analysis', 'shell_execution'];
const CORE_INSTRUCTION_BY_ROLE = new Map(
  agentsConfig.agents.map(agent => [agent.id, agent.coreInstructions ?? ''])
);

function asString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}

function trimToUndefined(value: unknown): string | undefined {
  const str = asString(value)?.trim();
  return str ? str : undefined;
}

function normalizeCapabilityId(value: unknown): WorkerCapabilityId | undefined {
  if (typeof value !== 'string') return undefined;
  const normalized = value.trim().toLowerCase();
  return WORKER_CAPABILITY_IDS.find(capability => capability === normalized);
}

function normalizeCapabilities(value: unknown): WorkerCapability[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const seen = new Set<string>();
  const normalized: WorkerCapability[] = [];
  for (const entry of value) {
    const obj = entry as { id?: unknown; level?: unknown; verifiedBy?: unknown };
    const id = normalizeCapabilityId(obj?.id);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    const levelRaw = typeof obj.level === 'number' && Number.isFinite(obj.level) ? Math.floor(obj.level) : undefined;
    const level = typeof levelRaw === 'number'
      ? (Math.max(0, Math.min(3, levelRaw)) as 0 | 1 | 2 | 3)
      : undefined;
    const verifiedBy = obj.verifiedBy === 'runtime' || obj.verifiedBy === 'profile'
      ? obj.verifiedBy
      : undefined;
    normalized.push({ id, level, verifiedBy });
  }
  return normalized.length > 0 ? normalized : undefined;
}

function normalizeTaskRequirements(value: unknown): TaskRequirements | undefined {
  if (!value || typeof value !== 'object') return undefined;
  const input = value as Record<string, unknown>;
  const requiredCapabilities = Array.isArray(input.requiredCapabilities)
    ? Array.from(new Set(input.requiredCapabilities.map(normalizeCapabilityId).filter(Boolean))) as WorkerCapabilityId[]
    : undefined;
  const preferredCapabilities = Array.isArray(input.preferredCapabilities)
    ? Array.from(new Set(input.preferredCapabilities.map(normalizeCapabilityId).filter(Boolean))) as WorkerCapabilityId[]
    : undefined;
  const fileScope = Array.isArray(input.fileScope)
    ? input.fileScope.filter(path => typeof path === 'string' && path.trim()).map(path => String(path))
    : undefined;
  const workingDir = trimToUndefined(input.workingDir);
  const writeAccess = typeof input.writeAccess === 'boolean' ? input.writeAccess : undefined;
  const parallelSafe = typeof input.parallelSafe === 'boolean' ? input.parallelSafe : undefined;

  if (
    !requiredCapabilities?.length &&
    !preferredCapabilities?.length &&
    !fileScope?.length &&
    !workingDir &&
    typeof writeAccess !== 'boolean' &&
    typeof parallelSafe !== 'boolean'
  ) {
    return undefined;
  }

  return {
    requiredCapabilities: requiredCapabilities?.length ? requiredCapabilities : undefined,
    preferredCapabilities: preferredCapabilities?.length ? preferredCapabilities : undefined,
    fileScope: fileScope?.length ? fileScope : undefined,
    workingDir,
    writeAccess,
    parallelSafe,
  };
}

function getNodeKind(node: FlowNodeLike): RuntimeNodeKind {
  const type = node.type ?? '';
  if (type === 'task' || type === 'workflow.task') return 'task';
  if (type === 'agent' || type === 'workflow.agent') return 'agent';
  if (type === 'barrier' || type === 'workflow.barrier') return 'barrier';
  if (type === 'frame' || type === 'workflow.frame') return 'frame';
  if (type === 'reroute' || type === 'workflow.reroute') return 'reroute';

  const roleId = trimToUndefined(node.data?.roleId);
  if (roleId === 'task' || roleId === 'barrier' || roleId === 'frame' || roleId === 'reroute') {
    return roleId;
  }
  return 'agent';
}

function getNodeStatus(node: FlowNodeLike): WorkflowNodeStatus {
  const status = node.data?.status;
  if (
    status === 'unbound' ||
    status === 'launching' ||
    status === 'connecting' ||
    status === 'ready' ||
    status === 'handoff_pending' ||
    status === 'waiting' ||
    status === 'running' ||
    status === 'done' ||
    status === 'completed' ||
    status === 'failed'
  ) {
    return status;
  }
  return NODE_STATUS_FALLBACK;
}

function getWorkflowMode(node: FlowNodeLike): WorkflowMode {
  const mode = node.data?.mode;
  return mode === 'edit' ? 'edit' : MODE_FALLBACK;
}

function normalizeExecutionMode(value: unknown): WorkflowExecutionMode {
  if (value === 'headless' || value === 'streaming_headless' || value === 'interactive_pty') {
    return value;
  }
  return EXECUTION_MODE_FALLBACK;
}

function getAuthoringMode(value: unknown): WorkflowAuthoringMode | undefined {
  if (value === 'preset' || value === 'adaptive' || value === 'graph') {
    return value;
  }
  return undefined;
}

function getRunVersion(value: unknown): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const normalized = Math.floor(value);
  return normalized > 0 ? normalized : undefined;
}

export function normalizeEdgeCondition(value: unknown): WorkflowEdgeCondition {
  if (value === 'on_success' || value === 'on_failure') return value;
  return 'always';
}

function combineEdgeCondition(
  left: WorkflowEdgeCondition,
  right: WorkflowEdgeCondition
): WorkflowEdgeCondition | null {
  if (left === right) return left;
  if (left === 'always') return right;
  if (right === 'always') return left;
  return null;
}

function makeCompiledEdgeId(fromNodeId: string, toNodeId: string, condition: WorkflowEdgeCondition): string {
  return `edge:${fromNodeId}:${condition}:${toNodeId}`;
}

function buildAdjacency(edges: ReadonlyArray<FlowEdgeLike>) {
  const outgoing = new Map<string, Array<{ to: string; condition: WorkflowEdgeCondition }>>();
  const incoming = new Map<string, Array<{ from: string; condition: WorkflowEdgeCondition }>>();

  for (const edge of edges) {
    const condition = normalizeEdgeCondition(edge.data?.condition ?? edge.label);

    const out = outgoing.get(edge.source) ?? [];
    out.push({ to: edge.target, condition });
    outgoing.set(edge.source, out);

    const ins = incoming.get(edge.target) ?? [];
    ins.push({ from: edge.source, condition });
    incoming.set(edge.target, ins);
  }

  return { outgoing, incoming };
}

function walkReachableNodes(startNodeId: string, outgoing: Map<string, Array<{ to: string }>>): Set<string> {
  const visited = new Set<string>([startNodeId]);
  const queue = [startNodeId];

  while (queue.length > 0) {
    const currentId = queue.shift();
    if (!currentId) continue;

    for (const next of outgoing.get(currentId) ?? []) {
      if (visited.has(next.to)) continue;
      visited.add(next.to);
      queue.push(next.to);
    }
  }

  return visited;
}

function collectReachableAgentTargets(
  startNodeId: string,
  originKind: 'task' | 'agent',
  nodeKinds: Map<string, RuntimeNodeKind>,
  outgoing: Map<string, Array<{ to: string; condition: WorkflowEdgeCondition }>>
): Map<string, Set<WorkflowEdgeCondition>> {
  const found = new Map<string, Set<WorkflowEdgeCondition>>();
  const visited = new Set<string>();
  const queue = (outgoing.get(startNodeId) ?? []).map(({ to, condition }) => ({
    id: to,
    condition,
  }));

  while (queue.length > 0) {
    const current = queue.shift();
    if (!current) continue;

    const visitKey = `${current.id}:${current.condition}`;
    if (visited.has(visitKey)) continue;
    visited.add(visitKey);

    const kind = nodeKinds.get(current.id);
    if (!kind) {
      throw new Error(`Graph contains an edge to an unknown node: ${current.id}`);
    }

    if (kind === 'agent') {
      if (originKind === 'agent' && current.id === startNodeId) {
        continue;
      }
      const conditions = found.get(current.id) ?? new Set<WorkflowEdgeCondition>();
      conditions.add(current.condition);
      found.set(current.id, conditions);
      continue;
    }

    for (const next of outgoing.get(current.id) ?? []) {
      const merged = combineEdgeCondition(current.condition, next.condition);
      if (!merged) {
        throw new Error(
          `Conflicting edge conditions on the path from ${startNodeId} through ${current.id}. ` +
          'Do not mix on_success and on_failure on the same route.'
        );
      }
      queue.push({ id: next.to, condition: merged });
    }
  }

  return found;
}

interface CompiledMissionStructure {
  taskNodeId: string;
  agentNodeIds: string[];
  compiledEdges: CompiledMissionEdge[];
  startNodeIds: string[];
  executionLayers: string[][];
}

function compileMissionStructure(
  nodes: ReadonlyArray<FlowNodeLike>,
  edges: ReadonlyArray<FlowEdgeLike>
): CompiledMissionStructure {
  const nodeById = new Map(nodes.map(node => [node.id, node]));
  const nodeKinds = new Map(nodes.map(node => [node.id, getNodeKind(node)]));
  const { outgoing, incoming } = buildAdjacency(edges);
  const errors: string[] = [];

  for (const edge of edges) {
    if (!nodeById.has(edge.source) || !nodeById.has(edge.target)) {
      errors.push(`Edge ${edge.source} -> ${edge.target} references a missing node.`);
      continue;
    }

    const sourceKind = nodeKinds.get(edge.source);
    const targetKind = nodeKinds.get(edge.target);
    if (sourceKind === 'frame' || targetKind === 'frame') {
      errors.push(`Frames cannot participate in workflow execution edges (${edge.source} -> ${edge.target}).`);
    }
  }

  const taskNodes = nodes.filter(node => getNodeKind(node) === 'task');
  if (taskNodes.length !== 1) {
    errors.push(`Graph must contain exactly one Task node, found ${taskNodes.length}.`);
  }

  const taskNode = taskNodes[0];
  if (taskNode) {
    const taskIncoming = incoming.get(taskNode.id) ?? [];
    if (taskIncoming.length > 0) {
      errors.push('Task node cannot have incoming edges.');
    }
    const conditionalStartEdges = (outgoing.get(taskNode.id) ?? []).filter(edge => edge.condition !== 'always');
    if (conditionalStartEdges.length > 0) {
      errors.push('Task node edges must use the "always" condition.');
    }
  }

  const agentNodes = nodes.filter(node => getNodeKind(node) === 'agent');
  if (agentNodes.length === 0) {
    errors.push('Graph must contain at least one Agent node.');
  }

  const barrierNodes = nodes.filter(node => getNodeKind(node) === 'barrier');
  for (const barrier of barrierNodes) {
    const incomingCount = (incoming.get(barrier.id) ?? []).length;
    const outgoingCount = (outgoing.get(barrier.id) ?? []).length;
    if (incomingCount === 0 || outgoingCount === 0) {
      errors.push(`Barrier ${barrier.id} must have at least one incoming and one outgoing edge.`);
    }
  }

  if (errors.length > 0) {
    throw new Error(errors.join(' '));
  }
  if (!taskNode) {
    throw new Error('Graph must contain exactly one Task node.');
  }

  const reachableNodeIds = walkReachableNodes(
    taskNode.id,
    new Map(Array.from(outgoing.entries()).map(([nodeId, values]) => [nodeId, values.map(value => ({ to: value.to }))]))
  );
  const unreachableAgents = agentNodes.filter(node => !reachableNodeIds.has(node.id));
  if (unreachableAgents.length > 0) {
    const labels = unreachableAgents.map(node => `${trimToUndefined(node.data?.roleId) ?? node.id} (${node.id})`);
    throw new Error(`Every Agent node must be reachable from the Task node. Unreachable: ${labels.join(', ')}.`);
  }

  const edgeTuples = new Map<string, CompiledMissionEdge>();
  for (const agentNode of agentNodes) {
    const targets = collectReachableAgentTargets(agentNode.id, 'agent', nodeKinds, outgoing);
    for (const [targetNodeId, conditions] of targets) {
      for (const condition of conditions) {
        const edgeId = makeCompiledEdgeId(agentNode.id, targetNodeId, condition);
        edgeTuples.set(edgeId, {
          id: edgeId,
          fromNodeId: agentNode.id,
          toNodeId: targetNodeId,
          condition,
        });
      }
    }
  }

  const startTargets = collectReachableAgentTargets(taskNode.id, 'task', nodeKinds, outgoing);
  const startNodeIds = Array.from(startTargets.entries())
    .flatMap(([nodeId, conditions]) => {
      const values = Array.from(conditions);
      if (values.some(condition => condition !== 'always')) {
        throw new Error(`Task node can only activate start nodes through "always" edges. Invalid start path targets ${nodeId}.`);
      }
      return nodeId;
    });

  const order = new Map(nodes.map((node, index) => [node.id, index]));
  const compiledEdges = Array.from(edgeTuples.values()).sort((left, right) => {
    if (left.fromNodeId !== right.fromNodeId) {
      return (order.get(left.fromNodeId) ?? 0) - (order.get(right.fromNodeId) ?? 0);
    }
    if (left.toNodeId !== right.toNodeId) {
      return (order.get(left.toNodeId) ?? 0) - (order.get(right.toNodeId) ?? 0);
    }
    return CONDITION_SORT_ORDER[left.condition] - CONDITION_SORT_ORDER[right.condition];
  });

  const executionLayers = deriveExecutionLayers(
    agentNodes.map(node => ({ id: node.id })),
    compiledEdges
  );

  return {
    taskNodeId: taskNode.id,
    agentNodeIds: agentNodes.map(node => node.id),
    compiledEdges,
    startNodeIds: executionLayers[0] ?? startNodeIds,
    executionLayers,
  };
}

export interface GraphValidationResult {
  taskNodeId: string;
  agentNodeIds: string[];
}

export function validateGraph(
  nodes: ReadonlyArray<FlowNodeLike>,
  edges: ReadonlyArray<FlowEdgeLike>
): GraphValidationResult {
  const structure = compileMissionStructure(nodes, edges);
  return {
    taskNodeId: structure.taskNodeId,
    agentNodeIds: structure.agentNodeIds,
  };
}

export function serializeWorkflowGraph(
  graphId: string,
  nodes: ReadonlyArray<FlowNodeLike>,
  edges: ReadonlyArray<FlowEdgeLike>
): WorkflowGraph {
  // ReactFlow may reorder `nodes`/`edges` for z-indexing/selection rendering.
  // Persisting that order causes needless store churn and can create update loops.
  // Keep snapshots deterministic by sorting by stable keys.
  const sortedNodes = [...nodes].sort((a, b) => String(a.id).localeCompare(String(b.id)));
  const sortedEdges = [...edges].sort((a, b) => {
    const aCond = normalizeEdgeCondition(a.data?.condition ?? a.label);
    const bCond = normalizeEdgeCondition(b.data?.condition ?? b.label);
    const bySource = String(a.source).localeCompare(String(b.source));
    if (bySource !== 0) return bySource;
    const byTarget = String(a.target).localeCompare(String(b.target));
    if (byTarget !== 0) return byTarget;
    return String(CONDITION_SORT_ORDER[aCond]).localeCompare(String(CONDITION_SORT_ORDER[bCond]));
  });

  return {
    id: graphId,
    nodes: sortedNodes.map(node => {
      const kind = getNodeKind(node);
      const status = getNodeStatus(node);

      if (kind === 'task') {
        return {
          id: node.id,
          roleId: 'task',
          status,
          config: {
            prompt: asString(node.data?.prompt) ?? '',
            mode: getWorkflowMode(node),
            workspaceDir: asString(node.data?.workspaceDir) ?? '',
            authoringMode: getAuthoringMode(node.data?.authoringMode),
            presetId: asString(node.data?.presetId) ?? undefined,
            runVersion: getRunVersion(node.data?.runVersion),
            position: node.position,
            parentId: node.parentId,
            extent: node.extent as 'parent' | undefined,
          },
        } satisfies WorkflowNode;
      }

      if (kind === 'barrier') {
        return {
          id: node.id,
          roleId: 'barrier',
          status,
          config: {
            position: node.position,
            parentId: node.parentId,
            extent: node.extent as 'parent' | undefined,
          },
        } satisfies WorkflowNode;
      }

      if (kind === 'frame') {
        return {
          id: node.id,
          roleId: 'frame',
          status: NODE_STATUS_FALLBACK,
          config: {
            label: asString(node.data?.label) ?? 'Frame',
            position: node.position,
            width: typeof node.style?.width === 'number' ? node.style.width : undefined,
            height: typeof node.style?.height === 'number' ? node.style.height : undefined,
            parentId: node.parentId,
            extent: node.extent as 'parent' | undefined,
          },
        } satisfies WorkflowNode;
      }

      if (kind === 'reroute') {
        return {
          id: node.id,
          roleId: 'reroute',
          status: NODE_STATUS_FALLBACK,
          config: {
            position: node.position,
            parentId: node.parentId,
            extent: node.extent as 'parent' | undefined,
          },
        } satisfies WorkflowNode;
      }

      return {
        id: node.id,
        roleId: trimToUndefined(node.data?.roleId) ?? 'agent',
        status,
        config: {
          instructionOverride: asString(node.data?.instructionOverride) ?? '',
          terminalId: trimToUndefined(node.data?.terminalId),
          terminalTitle: trimToUndefined(node.data?.terminalTitle),
          paneId: trimToUndefined(node.data?.paneId),
          executionMode: normalizeExecutionMode(node.data?.executionMode),
          autoLinked: Boolean(node.data?.autoLinked),
          authoringMode: getAuthoringMode(node.data?.authoringMode),
          presetId: asString(node.data?.presetId) ?? undefined,
          runVersion: getRunVersion(node.data?.runVersion),
          adaptiveSeed: Boolean(node.data?.adaptiveSeed),
          position: node.position,
          parentId: node.parentId,
          extent: node.extent as 'parent' | undefined,
        },
      } satisfies WorkflowNode;
    }),
    edges: sortedEdges
      .map(edge => ({
        fromNodeId: edge.source,
        toNodeId: edge.target,
        condition: normalizeEdgeCondition(edge.data?.condition ?? edge.label),
      }))
      .sort((a, b) => {
        const byFrom = String(a.fromNodeId).localeCompare(String(b.fromNodeId));
        if (byFrom !== 0) return byFrom;
        const byTo = String(a.toNodeId).localeCompare(String(b.toNodeId));
        if (byTo !== 0) return byTo;
        return String(CONDITION_SORT_ORDER[a.condition]).localeCompare(String(CONDITION_SORT_ORDER[b.condition]));
      }),
  };
}

export interface CompileMissionOptions {
  graphId: string;
  missionId: string;
  nodes: ReadonlyArray<FlowNodeLike>;
  edges: ReadonlyArray<FlowEdgeLike>;
  workspaceDirFallback?: string | null;
  compiledAt?: number;
  terminalClis?: Record<string, WorkflowAgentCli>;
  authoringMode?: WorkflowAuthoringMode;
  presetId?: string | null;
  runVersion?: number;
}

export function compileMission({
  graphId,
  missionId,
  nodes,
  edges,
  workspaceDirFallback = null,
  compiledAt = Date.now(),
  terminalClis = {},
  authoringMode,
  presetId,
  runVersion,
}: CompileMissionOptions): CompiledMission {
  const structure = compileMissionStructure(nodes, edges);
  const taskNode = nodes.find(node => node.id === structure.taskNodeId);
  if (!taskNode) {
    throw new Error(`Task node ${structure.taskNodeId} could not be found during mission compilation.`);
  }
  const resolvedAuthoringMode = authoringMode ?? getAuthoringMode(taskNode.data?.authoringMode);
  const resolvedPresetId = presetId ?? trimToUndefined(taskNode.data?.presetId) ?? null;
  const resolvedRunVersion = runVersion ?? getRunVersion(taskNode.data?.runVersion) ?? 1;

  const compiledNodes: CompiledMissionNode[] = structure.agentNodeIds.map(nodeId => {
    const node = nodes.find(candidate => candidate.id === nodeId);
    if (!node) {
      throw new Error(`Agent node ${nodeId} could not be found during mission compilation.`);
    }

    const terminalId = trimToUndefined(node.data?.terminalId);
    const terminalTitle = trimToUndefined(node.data?.terminalTitle);
    if (!terminalId || !terminalTitle) {
      throw new Error(`Agent node ${nodeId} is missing a terminal binding. Please select a terminal in the node properties.`);
    }

    const roleId = trimToUndefined(node.data?.roleId) ?? 'agent';
    const instructionOverride = asString(node.data?.instructionOverride) ?? '';
    const roleInstructions = instructionOverride.trim() || CORE_INSTRUCTION_BY_ROLE.get(roleId)?.trim() || '';

    return {
      id: node.id,
      roleId,
      profileId: trimToUndefined(node.data?.profileId),
      instructionOverride: roleInstructions,
      capabilities: normalizeCapabilities(node.data?.capabilities),
      requirements: normalizeTaskRequirements(node.data?.requirements),
      terminal: {
        terminalId,
        terminalTitle,
        cli: terminalClis[terminalId] ?? AGENT_CLI_FALLBACK,
        executionMode: normalizeExecutionMode(node.data?.executionMode),
        paneId: trimToUndefined(node.data?.paneId),
        reusedExisting: Boolean(node.data?.autoLinked),
      },
    };
  });

  return {
    missionId,
    graphId,
    task: {
      nodeId: taskNode.id,
      prompt: asString(taskNode.data?.prompt)?.trim() ?? '',
      mode: getWorkflowMode(taskNode),
      workspaceDir: trimToUndefined(taskNode.data?.workspaceDir) ?? workspaceDirFallback,
    },
    metadata: {
      compiledAt,
      sourceGraphId: graphId,
      startNodeIds: structure.startNodeIds,
      executionLayers: structure.executionLayers,
      authoringMode: resolvedAuthoringMode,
      presetId: resolvedPresetId,
      runVersion: resolvedRunVersion,
    },
    nodes: compiledNodes,
    edges: structure.compiledEdges,
  };
}
