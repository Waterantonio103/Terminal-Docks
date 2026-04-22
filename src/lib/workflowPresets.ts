import type { WorkflowAgentCli, WorkflowEdgeCondition, WorkflowMode } from '../store/workspace.js';

export interface PresetNodeDefinition {
  id: string;
  roleId: string;
}

export interface PresetEdgeDefinition {
  fromNodeId: string;
  toNodeId: string;
  condition?: WorkflowEdgeCondition;
}

export interface PresetDefinition {
  id: string;
  name: string;
  description: string;
  nodes: PresetNodeDefinition[];
  edges: PresetEdgeDefinition[];
}

interface TerminalBindingLike {
  terminalId: string;
  terminalTitle: string;
  paneId?: string;
  cli?: WorkflowAgentCli | null;
}

export const WORKFLOW_PRESETS: PresetDefinition[] = [
  {
    id: 'scout_build_review',
    name: 'Scout -> Build -> Review',
    description: 'Sequential analysis, implementation, then quality gate.',
    nodes: [
      { id: 'scout', roleId: 'scout' },
      { id: 'builder', roleId: 'builder' },
      { id: 'reviewer', roleId: 'reviewer' },
    ],
    edges: [
      { fromNodeId: 'scout', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'parallel_delivery',
    name: 'Coordinate + Parallel Delivery',
    description: 'Coordinator fans out to builder/tester/security, then reviewer gates.',
    nodes: [
      { id: 'coordinator', roleId: 'coordinator' },
      { id: 'builder', roleId: 'builder' },
      { id: 'tester', roleId: 'tester' },
      { id: 'security', roleId: 'security' },
      { id: 'reviewer', roleId: 'reviewer' },
    ],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'tester', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'security', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'rapid_patch',
    name: 'Rapid Patch',
    description: 'Single executor with optional reviewer fail loop.',
    nodes: [
      { id: 'builder', roleId: 'builder' },
      { id: 'reviewer', roleId: 'reviewer' },
    ],
    edges: [
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
];

export function listWorkflowPresets(): PresetDefinition[] {
  return WORKFLOW_PRESETS;
}

export function getWorkflowPreset(presetId: string | null | undefined): PresetDefinition | null {
  if (!presetId) return null;
  return WORKFLOW_PRESETS.find(preset => preset.id === presetId) ?? null;
}

export function getPresetStartNodeIds(preset: PresetDefinition): string[] {
  const hasIncoming = new Set(preset.edges.map(edge => edge.toNodeId));
  return preset.nodes
    .map(node => node.id)
    .filter(nodeId => !hasIncoming.has(nodeId));
}

export function buildPresetFlowGraph(options: {
  preset: PresetDefinition;
  missionId: string;
  prompt: string;
  mode: WorkflowMode;
  workspaceDir: string | null;
  bindingsByRole: Record<string, TerminalBindingLike>;
  instructionOverrides?: Record<string, string>;
}) {
  const {
    preset,
    missionId,
    prompt,
    mode,
    workspaceDir,
    bindingsByRole,
    instructionOverrides = {},
  } = options;

  const taskNodeId = `task-${missionId}`;
  const startNodeIds = getPresetStartNodeIds(preset);

  const nodes = [
    {
      id: taskNodeId,
      type: 'task',
      position: { x: 120, y: 120 },
      data: {
        roleId: 'task',
        prompt,
        mode,
        workspaceDir: workspaceDir ?? '',
      },
    },
    ...preset.nodes.map((node, index) => {
      const binding = bindingsByRole[node.roleId];
      return {
        id: node.id,
        type: 'agent',
        position: { x: 420 + (index % 2) * 280, y: 120 + Math.floor(index / 2) * 190 },
        data: {
          roleId: node.roleId,
          instructionOverride: instructionOverrides[node.roleId] ?? '',
          terminalId: binding?.terminalId ?? '',
          terminalTitle: binding?.terminalTitle ?? '',
          paneId: binding?.paneId ?? '',
          autoLinked: true,
        },
      };
    }),
  ];

  const edges = [
    ...startNodeIds.map(nodeId => ({
      id: `edge:${taskNodeId}:always:${nodeId}`,
      source: taskNodeId,
      target: nodeId,
      data: { condition: 'always' as WorkflowEdgeCondition },
    })),
    ...preset.edges.map(edge => ({
      id: `edge:${edge.fromNodeId}:${edge.condition ?? 'always'}:${edge.toNodeId}`,
      source: edge.fromNodeId,
      target: edge.toNodeId,
      data: { condition: edge.condition ?? 'always' },
    })),
  ];

  return { taskNodeId, nodes, edges };
}
