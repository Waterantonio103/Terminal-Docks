import type { FrontendWorkflowMode, WorkflowAgentCli, WorkflowEdgeCondition, WorkflowExecutionMode, WorkflowMode } from '../store/workspace.js';
import { defaultPresetReadmeEnabled } from './workflowReadme.js';

export type WorkflowPresetMode =
  | 'build'
  | 'research'
  | 'plan'
  | 'review'
  | 'verify'
  | 'secure'
  | 'document';

export type PresetPreviewShape =
  | 'chain'
  | 'fanout'
  | 'parallel_review'
  | 'gate';

export type PresetSpecProfile =
  | 'none'
  | 'frontend_three_file';

export type PresetSize =
  | 'small'
  | 'standard'
  | 'expanded';

export interface WorkflowPresetModeOption {
  value: WorkflowPresetMode;
  label: string;
  description: string;
}

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
  mode: WorkflowPresetMode;
  subMode: string;
  size: PresetSize;
  agentCount: number;
  tags: string[];
  previewShape: PresetPreviewShape;
  specProfile?: PresetSpecProfile;
  frontendMode?: FrontendWorkflowMode;
  finalReadmeDefault?: boolean;
  nodes: PresetNodeDefinition[];
  edges: PresetEdgeDefinition[];
}

interface TerminalBindingLike {
  terminalId: string;
  terminalTitle: string;
  paneId?: string;
  cli?: WorkflowAgentCli | null;
  model?: string | null;
  executionMode?: WorkflowExecutionMode | null;
}

export const WORKFLOW_PRESET_MODES: WorkflowPresetModeOption[] = [
  { value: 'build', label: 'Build', description: 'Create, modify, fix, refactor, or deliver software.' },
  { value: 'research', label: 'Research', description: 'Investigate code, architecture, bugs, libraries, migrations, or unknowns.' },
  { value: 'plan', label: 'Plan', description: 'Turn vague intent into specs, architecture, task breakdowns, or implementation strategy.' },
  { value: 'review', label: 'Review', description: 'Review existing code, generated changes, architecture, product fit, or final quality.' },
  { value: 'verify', label: 'Verify', description: 'Run tests, smoke checks, UI QA, regression sweeps, or release validation.' },
  { value: 'secure', label: 'Secure', description: 'Threat model, audit, dependency review, or secure patching.' },
  { value: 'document', label: 'Document', description: 'Write or refresh docs, changelogs, migration guides, READMEs, or agent docs.' },
];

const SIZE_ORDER: Record<PresetSize, number> = {
  small: 0,
  standard: 1,
  expanded: 2,
};

function chainEdges(nodeIds: string[], condition: WorkflowEdgeCondition = 'always'): PresetEdgeDefinition[] {
  return nodeIds.slice(0, -1).map((fromNodeId, index) => ({
    fromNodeId,
    toNodeId: nodeIds[index + 1],
    condition,
  }));
}

function node(id: string, roleId: string): PresetNodeDefinition {
  return { id, roleId };
}

export const WORKFLOW_PRESETS: PresetDefinition[] = [
  {
    id: 'rapid_patch',
    name: 'Rapid Patch',
    description: 'Lean implementation pass with a reviewer gate.',
    mode: 'build',
    subMode: 'Patch / Build',
    size: 'small',
    agentCount: 2,
    tags: ['Fast fix'],
    previewShape: 'chain',
    nodes: [node('builder', 'builder'), node('reviewer', 'reviewer')],
    edges: chainEdges(['builder', 'reviewer']),
  },
  {
    id: 'scout_build_review',
    name: 'Scout Build Review',
    description: 'Scout analysis fans out to implementation and test planning, then reviewer gates the result.',
    mode: 'build',
    subMode: 'Patch / Build',
    size: 'standard',
    agentCount: 4,
    tags: ['Codebase aware'],
    previewShape: 'fanout',
    nodes: [node('scout', 'scout'), node('builder', 'builder'), node('tester', 'tester'), node('reviewer', 'reviewer')],
    edges: [
      { fromNodeId: 'scout', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'scout', toNodeId: 'tester', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'tester', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'patch_build_expanded',
    name: 'Patch Build Expanded',
    description: 'Broader patch workflow with parallel implementation, testing, security, and final review passes.',
    mode: 'build',
    subMode: 'Patch / Build',
    size: 'expanded',
    agentCount: 10,
    tags: ['Broad coverage'],
    previewShape: 'gate',
    nodes: [
      node('scout', 'scout'),
      node('coordinator', 'coordinator'),
      node('builder_api', 'builder'),
      node('builder_ui', 'builder'),
      node('builder_integration', 'builder'),
      node('tester_unit', 'tester'),
      node('tester_regression', 'tester'),
      node('security', 'security'),
      node('reviewer_quality', 'reviewer'),
      node('reviewer_final', 'reviewer'),
    ],
    edges: [
      ...chainEdges(['scout', 'coordinator']),
      { fromNodeId: 'coordinator', toNodeId: 'builder_api', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'builder_ui', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'builder_integration', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester_unit', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security', condition: 'always' },
      { fromNodeId: 'builder_api', toNodeId: 'tester_regression', condition: 'always' },
      { fromNodeId: 'builder_ui', toNodeId: 'tester_regression', condition: 'always' },
      { fromNodeId: 'builder_integration', toNodeId: 'tester_regression', condition: 'always' },
      { fromNodeId: 'tester_unit', toNodeId: 'reviewer_quality', condition: 'always' },
      { fromNodeId: 'tester_regression', toNodeId: 'reviewer_quality', condition: 'always' },
      { fromNodeId: 'security', toNodeId: 'reviewer_quality', condition: 'always' },
      { fromNodeId: 'reviewer_quality', toNodeId: 'reviewer_final', condition: 'always' },
    ],
  },
  {
    id: 'delivery_small',
    name: 'Delivery Small',
    description: 'Coordinator-led build and review for compact delivery tasks.',
    mode: 'build',
    subMode: 'Delivery',
    size: 'small',
    agentCount: 3,
    tags: ['Coordinated'],
    previewShape: 'chain',
    nodes: [node('coordinator', 'coordinator'), node('builder', 'builder'), node('reviewer', 'reviewer')],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'delivery_standard',
    name: 'Delivery Standard',
    description: 'Coordinator fans out to build and test, then reviewer gates the result.',
    mode: 'build',
    subMode: 'Delivery',
    size: 'standard',
    agentCount: 4,
    tags: ['Build + test'],
    previewShape: 'fanout',
    nodes: [node('coordinator', 'coordinator'), node('builder', 'builder'), node('tester', 'tester'), node('reviewer', 'reviewer')],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'tester', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'parallel_delivery',
    name: 'Parallel Delivery',
    description: 'Coordinator fans out to builder, tester, and security, then reviewer gates.',
    mode: 'build',
    subMode: 'Delivery',
    size: 'expanded',
    agentCount: 5,
    tags: ['Security pass'],
    previewShape: 'fanout',
    nodes: [
      node('coordinator', 'coordinator'),
      node('builder', 'builder'),
      node('tester', 'tester'),
      node('security', 'security'),
      node('reviewer', 'reviewer'),
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
    id: 'app_site_small',
    name: 'App Site Small',
    description: 'Lean frontend delivery with architecture, build, and interaction QA.',
    mode: 'build',
    subMode: 'App / Site',
    size: 'small',
    agentCount: 3,
    tags: ['Visual QA'],
    previewShape: 'chain',
    specProfile: 'frontend_three_file',
    frontendMode: 'aligned',
    finalReadmeDefault: true,
    nodes: [
      node('frontend_architect', 'frontend_architect'),
      node('frontend_builder', 'frontend_builder'),
      node('interaction_qa', 'interaction_qa'),
    ],
    edges: chainEdges(['frontend_architect', 'frontend_builder', 'interaction_qa'], 'on_success'),
  },
  {
    id: 'frontend_ui_delivery',
    name: 'Frontend UI Delivery',
    description: 'Explicit UI workflow with product intake, parallel design and architecture, build, interaction QA, and accessibility review.',
    mode: 'build',
    subMode: 'App / Site',
    size: 'standard',
    agentCount: 6,
    tags: ['Visual QA'],
    previewShape: 'fanout',
    specProfile: 'frontend_three_file',
    frontendMode: 'strict_ui',
    finalReadmeDefault: true,
    nodes: [
      node('frontend_product', 'frontend_product'),
      node('frontend_designer', 'frontend_designer'),
      node('frontend_architect', 'frontend_architect'),
      node('frontend_builder', 'frontend_builder'),
      node('interaction_qa', 'interaction_qa'),
      node('accessibility_reviewer', 'accessibility_reviewer'),
    ],
    edges: [
      { fromNodeId: 'frontend_product', toNodeId: 'frontend_designer', condition: 'on_success' },
      { fromNodeId: 'frontend_product', toNodeId: 'frontend_architect', condition: 'on_success' },
      { fromNodeId: 'frontend_architect', toNodeId: 'frontend_builder', condition: 'on_success' },
      { fromNodeId: 'frontend_designer', toNodeId: 'frontend_builder', condition: 'on_success' },
      { fromNodeId: 'frontend_builder', toNodeId: 'interaction_qa', condition: 'on_success' },
      { fromNodeId: 'frontend_builder', toNodeId: 'accessibility_reviewer', condition: 'on_success' },
    ],
  },
  {
    id: 'app_site_expanded',
    name: 'App Site Expanded',
    description: 'Full frontend delivery with product, design, architecture, parallel builders, QA, accessibility, and polish review.',
    mode: 'build',
    subMode: 'App / Site',
    size: 'expanded',
    agentCount: 10,
    tags: ['Spec docs'],
    previewShape: 'gate',
    specProfile: 'frontend_three_file',
    frontendMode: 'strict_ui',
    finalReadmeDefault: true,
    nodes: [
      node('frontend_product', 'frontend_product'),
      node('frontend_designer', 'frontend_designer'),
      node('frontend_architect', 'frontend_architect'),
      node('frontend_builder_core', 'frontend_builder'),
      node('frontend_builder_states', 'frontend_builder'),
      node('frontend_builder_responsive', 'frontend_builder'),
      node('interaction_qa', 'interaction_qa'),
      node('accessibility_reviewer', 'accessibility_reviewer'),
      node('visual_polish_reviewer', 'visual_polish_reviewer'),
      node('reviewer_final', 'reviewer'),
    ],
    edges: [
      ...chainEdges(['frontend_product', 'frontend_designer', 'frontend_architect'], 'on_success'),
      { fromNodeId: 'frontend_architect', toNodeId: 'frontend_builder_core', condition: 'on_success' },
      { fromNodeId: 'frontend_architect', toNodeId: 'frontend_builder_states', condition: 'on_success' },
      { fromNodeId: 'frontend_architect', toNodeId: 'frontend_builder_responsive', condition: 'on_success' },
      { fromNodeId: 'frontend_builder_core', toNodeId: 'interaction_qa', condition: 'on_success' },
      { fromNodeId: 'frontend_builder_states', toNodeId: 'interaction_qa', condition: 'on_success' },
      { fromNodeId: 'frontend_builder_responsive', toNodeId: 'interaction_qa', condition: 'on_success' },
      { fromNodeId: 'interaction_qa', toNodeId: 'accessibility_reviewer', condition: 'on_success' },
      { fromNodeId: 'interaction_qa', toNodeId: 'visual_polish_reviewer', condition: 'on_success' },
      { fromNodeId: 'accessibility_reviewer', toNodeId: 'reviewer_final', condition: 'on_success' },
      { fromNodeId: 'visual_polish_reviewer', toNodeId: 'reviewer_final', condition: 'on_success' },
    ],
  },
  {
    id: 'research_scout_small',
    name: 'Research Scout Small',
    description: 'Fast investigation and recommendation path.',
    mode: 'research',
    subMode: 'Research Scout',
    size: 'small',
    agentCount: 2,
    tags: ['Discovery'],
    previewShape: 'chain',
    nodes: [node('scout', 'scout'), node('reviewer', 'reviewer')],
    edges: chainEdges(['scout', 'reviewer']),
  },
  {
    id: 'research_scout_standard',
    name: 'Research Scout Standard',
    description: 'Coordinator guides scout analysis, focused testing, and review synthesis.',
    mode: 'research',
    subMode: 'Research Scout',
    size: 'standard',
    agentCount: 5,
    tags: ['Synthesis'],
    previewShape: 'fanout',
    nodes: [node('coordinator', 'coordinator'), node('scout', 'scout'), node('tester', 'tester'), node('security', 'security'), node('reviewer', 'reviewer')],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'scout', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security', condition: 'always' },
      { fromNodeId: 'scout', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'tester', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'security', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'research_scout_expanded',
    name: 'Research Scout Expanded',
    description: 'Deep research sweep with parallel scouts, validation passes, risk review, and final synthesis.',
    mode: 'research',
    subMode: 'Research Scout',
    size: 'expanded',
    agentCount: 10,
    tags: ['Deep dive'],
    previewShape: 'parallel_review',
    nodes: [
      node('coordinator', 'coordinator'),
      node('scout_architecture', 'scout'),
      node('scout_history', 'scout'),
      node('scout_dependencies', 'scout'),
      node('tester_repro', 'tester'),
      node('tester_fixture', 'tester'),
      node('security_risk', 'security'),
      node('reviewer_synthesis', 'reviewer'),
      node('reviewer_gaps', 'reviewer'),
      node('reviewer_final', 'reviewer'),
    ],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'scout_architecture', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'scout_history', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'scout_dependencies', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester_repro', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security_risk', condition: 'always' },
      { fromNodeId: 'scout_architecture', toNodeId: 'tester_fixture', condition: 'always' },
      { fromNodeId: 'scout_history', toNodeId: 'reviewer_synthesis', condition: 'always' },
      { fromNodeId: 'scout_dependencies', toNodeId: 'reviewer_synthesis', condition: 'always' },
      { fromNodeId: 'tester_repro', toNodeId: 'reviewer_gaps', condition: 'always' },
      { fromNodeId: 'tester_fixture', toNodeId: 'reviewer_gaps', condition: 'always' },
      { fromNodeId: 'security_risk', toNodeId: 'reviewer_gaps', condition: 'always' },
      { fromNodeId: 'reviewer_synthesis', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'reviewer_gaps', toNodeId: 'reviewer_final', condition: 'always' },
    ],
  },
  {
    id: 'architecture_plan_small',
    name: 'Architecture Plan Small',
    description: 'Scout and coordinator produce a lean implementation plan.',
    mode: 'plan',
    subMode: 'Architecture Plan',
    size: 'small',
    agentCount: 2,
    tags: ['Task map'],
    previewShape: 'chain',
    nodes: [node('scout', 'scout'), node('coordinator', 'coordinator')],
    edges: chainEdges(['scout', 'coordinator']),
  },
  {
    id: 'architecture_plan_standard',
    name: 'Architecture Plan Standard',
    description: 'Scout, coordinator, builder, tester, and reviewer shape a practical plan.',
    mode: 'plan',
    subMode: 'Architecture Plan',
    size: 'standard',
    agentCount: 5,
    tags: ['Design review'],
    previewShape: 'chain',
    nodes: [node('scout', 'scout'), node('coordinator', 'coordinator'), node('builder', 'builder'), node('tester', 'tester'), node('reviewer', 'reviewer')],
    edges: [
      ...chainEdges(['scout', 'coordinator']),
      { fromNodeId: 'coordinator', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'tester', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'architecture_plan_expanded',
    name: 'Architecture Plan Expanded',
    description: 'Full planning pass with multiple research, implementation, QA, security, and review perspectives.',
    mode: 'plan',
    subMode: 'Architecture Plan',
    size: 'expanded',
    agentCount: 11,
    tags: ['Full blueprint'],
    previewShape: 'gate',
    nodes: [
      node('scout_codebase', 'scout'),
      node('scout_runtime', 'scout'),
      node('coordinator', 'coordinator'),
      node('builder_api', 'builder'),
      node('builder_ui', 'builder'),
      node('tester_strategy', 'tester'),
      node('tester_regression', 'tester'),
      node('security', 'security'),
      node('reviewer_architecture', 'reviewer'),
      node('reviewer_delivery', 'reviewer'),
      node('reviewer_final', 'reviewer'),
    ],
    edges: [
      { fromNodeId: 'scout_codebase', toNodeId: 'coordinator', condition: 'always' },
      { fromNodeId: 'scout_runtime', toNodeId: 'coordinator', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'builder_api', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'builder_ui', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester_strategy', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security', condition: 'always' },
      { fromNodeId: 'builder_api', toNodeId: 'reviewer_architecture', condition: 'always' },
      { fromNodeId: 'builder_ui', toNodeId: 'reviewer_architecture', condition: 'always' },
      { fromNodeId: 'tester_strategy', toNodeId: 'tester_regression', condition: 'always' },
      { fromNodeId: 'tester_regression', toNodeId: 'reviewer_delivery', condition: 'always' },
      { fromNodeId: 'security', toNodeId: 'reviewer_delivery', condition: 'always' },
      { fromNodeId: 'reviewer_architecture', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'reviewer_delivery', toNodeId: 'reviewer_final', condition: 'always' },
    ],
  },
  {
    id: 'code_review_small',
    name: 'Code Review Small',
    description: 'Single reviewer pass after scout context.',
    mode: 'review',
    subMode: 'Code Review',
    size: 'small',
    agentCount: 2,
    tags: ['Findings'],
    previewShape: 'chain',
    nodes: [node('scout', 'scout'), node('reviewer', 'reviewer')],
    edges: chainEdges(['scout', 'reviewer']),
  },
  {
    id: 'code_review_standard',
    name: 'Code Review Standard',
    description: 'Parallel test, security, and review passes coordinated into one verdict.',
    mode: 'review',
    subMode: 'Code Review',
    size: 'standard',
    agentCount: 5,
    tags: ['Quality gate'],
    previewShape: 'parallel_review',
    nodes: [node('coordinator', 'coordinator'), node('tester', 'tester'), node('security', 'security'), node('reviewer_code', 'reviewer'), node('reviewer_final', 'reviewer')],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'tester', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'reviewer_code', condition: 'always' },
      { fromNodeId: 'tester', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'security', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'reviewer_code', toNodeId: 'reviewer_final', condition: 'always' },
    ],
  },
  {
    id: 'code_review_expanded',
    name: 'Code Review Expanded',
    description: 'Large review sweep across architecture, tests, security, implementation quality, and final synthesis.',
    mode: 'review',
    subMode: 'Code Review',
    size: 'expanded',
    agentCount: 10,
    tags: ['Review board'],
    previewShape: 'parallel_review',
    nodes: [
      node('coordinator', 'coordinator'),
      node('scout_context', 'scout'),
      node('tester_unit', 'tester'),
      node('tester_regression', 'tester'),
      node('security_auth', 'security'),
      node('security_data', 'security'),
      node('reviewer_logic', 'reviewer'),
      node('reviewer_architecture', 'reviewer'),
      node('builder_fix_scope', 'builder'),
      node('reviewer_final', 'reviewer'),
    ],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'scout_context', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester_unit', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security_auth', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'reviewer_logic', condition: 'always' },
      { fromNodeId: 'scout_context', toNodeId: 'reviewer_architecture', condition: 'always' },
      { fromNodeId: 'tester_unit', toNodeId: 'tester_regression', condition: 'always' },
      { fromNodeId: 'security_auth', toNodeId: 'security_data', condition: 'always' },
      { fromNodeId: 'reviewer_logic', toNodeId: 'builder_fix_scope', condition: 'always' },
      { fromNodeId: 'tester_regression', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'security_data', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'reviewer_architecture', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'builder_fix_scope', toNodeId: 'reviewer_final', condition: 'always' },
    ],
  },
  {
    id: 'regression_sweep_small',
    name: 'Regression Sweep Small',
    description: 'Focused tester pass with reviewer summary.',
    mode: 'verify',
    subMode: 'Regression Sweep',
    size: 'small',
    agentCount: 2,
    tags: ['Smoke'],
    previewShape: 'chain',
    nodes: [node('tester', 'tester'), node('reviewer', 'reviewer')],
    edges: chainEdges(['tester', 'reviewer']),
  },
  {
    id: 'regression_sweep_standard',
    name: 'Regression Sweep Standard',
    description: 'Coordinator runs test, build verification, and review paths in parallel.',
    mode: 'verify',
    subMode: 'Regression Sweep',
    size: 'standard',
    agentCount: 5,
    tags: ['Regression'],
    previewShape: 'fanout',
    nodes: [node('coordinator', 'coordinator'), node('tester_smoke', 'tester'), node('tester_regression', 'tester'), node('builder', 'builder'), node('reviewer', 'reviewer')],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'tester_smoke', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester_regression', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'tester_smoke', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'tester_regression', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'regression_sweep_expanded',
    name: 'Regression Sweep Expanded',
    description: 'Broad verification sweep across smoke, unit, integration, UI, security, and final release review.',
    mode: 'verify',
    subMode: 'Regression Sweep',
    size: 'expanded',
    agentCount: 10,
    tags: ['Release check'],
    previewShape: 'gate',
    nodes: [
      node('coordinator', 'coordinator'),
      node('tester_smoke', 'tester'),
      node('tester_unit', 'tester'),
      node('tester_integration', 'tester'),
      node('interaction_qa', 'interaction_qa'),
      node('accessibility_reviewer', 'accessibility_reviewer'),
      node('security', 'security'),
      node('builder_fix_probe', 'builder'),
      node('reviewer_quality', 'reviewer'),
      node('reviewer_release', 'reviewer'),
    ],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'tester_smoke', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester_unit', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester_integration', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'interaction_qa', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security', condition: 'always' },
      { fromNodeId: 'tester_smoke', toNodeId: 'builder_fix_probe', condition: 'always' },
      { fromNodeId: 'tester_unit', toNodeId: 'reviewer_quality', condition: 'always' },
      { fromNodeId: 'tester_integration', toNodeId: 'reviewer_quality', condition: 'always' },
      { fromNodeId: 'interaction_qa', toNodeId: 'accessibility_reviewer', condition: 'always' },
      { fromNodeId: 'accessibility_reviewer', toNodeId: 'reviewer_release', condition: 'always' },
      { fromNodeId: 'security', toNodeId: 'reviewer_release', condition: 'always' },
      { fromNodeId: 'builder_fix_probe', toNodeId: 'reviewer_release', condition: 'always' },
      { fromNodeId: 'reviewer_quality', toNodeId: 'reviewer_release', condition: 'always' },
    ],
  },
  {
    id: 'security_review_small',
    name: 'Security Review Small',
    description: 'Focused security pass with reviewer confirmation.',
    mode: 'secure',
    subMode: 'Security Review',
    size: 'small',
    agentCount: 2,
    tags: ['Threats'],
    previewShape: 'chain',
    nodes: [node('security', 'security'), node('reviewer', 'reviewer')],
    edges: chainEdges(['security', 'reviewer']),
  },
  {
    id: 'security_review_standard',
    name: 'Security Review Standard',
    description: 'Scout, security, tester, builder, and reviewer collaborate on risk review and fix scope.',
    mode: 'secure',
    subMode: 'Security Review',
    size: 'standard',
    agentCount: 5,
    tags: ['Risk + fix'],
    previewShape: 'fanout',
    nodes: [node('scout', 'scout'), node('security', 'security'), node('tester', 'tester'), node('builder', 'builder'), node('reviewer', 'reviewer')],
    edges: [
      { fromNodeId: 'scout', toNodeId: 'security', condition: 'always' },
      { fromNodeId: 'scout', toNodeId: 'tester', condition: 'always' },
      { fromNodeId: 'security', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'tester', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'security_review_expanded',
    name: 'Security Review Expanded',
    description: 'Deep security workflow spanning threat model, auth, data, dependencies, tests, fixes, and final signoff.',
    mode: 'secure',
    subMode: 'Security Review',
    size: 'expanded',
    agentCount: 10,
    tags: ['Secure patch'],
    previewShape: 'gate',
    nodes: [
      node('scout_surface', 'scout'),
      node('coordinator', 'coordinator'),
      node('security_threat_model', 'security'),
      node('security_auth', 'security'),
      node('security_data', 'security'),
      node('security_dependency', 'security'),
      node('tester_exploit', 'tester'),
      node('builder_fix', 'builder'),
      node('reviewer_security', 'reviewer'),
      node('reviewer_final', 'reviewer'),
    ],
    edges: [
      ...chainEdges(['scout_surface', 'coordinator']),
      { fromNodeId: 'coordinator', toNodeId: 'security_threat_model', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security_auth', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security_data', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'security_dependency', condition: 'always' },
      { fromNodeId: 'security_threat_model', toNodeId: 'tester_exploit', condition: 'always' },
      { fromNodeId: 'security_auth', toNodeId: 'builder_fix', condition: 'always' },
      { fromNodeId: 'security_data', toNodeId: 'builder_fix', condition: 'always' },
      { fromNodeId: 'security_dependency', toNodeId: 'reviewer_security', condition: 'always' },
      { fromNodeId: 'tester_exploit', toNodeId: 'reviewer_security', condition: 'always' },
      { fromNodeId: 'builder_fix', toNodeId: 'reviewer_security', condition: 'always' },
      { fromNodeId: 'reviewer_security', toNodeId: 'reviewer_final', condition: 'always' },
    ],
  },
  {
    id: 'docs_refresh_small',
    name: 'Docs Refresh Small',
    description: 'Scout context and builder docs update with review.',
    mode: 'document',
    subMode: 'Docs Refresh',
    size: 'small',
    agentCount: 3,
    tags: ['Docs'],
    previewShape: 'chain',
    nodes: [node('scout', 'scout'), node('builder', 'builder'), node('reviewer', 'reviewer')],
    edges: chainEdges(['scout', 'builder', 'reviewer']),
  },
  {
    id: 'docs_refresh_standard',
    name: 'Docs Refresh Standard',
    description: 'Coordinator splits docs discovery, writing, testing, and review.',
    mode: 'document',
    subMode: 'Docs Refresh',
    size: 'standard',
    agentCount: 5,
    tags: ['Agent docs'],
    previewShape: 'fanout',
    nodes: [node('coordinator', 'coordinator'), node('scout', 'scout'), node('builder', 'builder'), node('tester', 'tester'), node('reviewer', 'reviewer')],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'scout', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'tester', condition: 'always' },
      { fromNodeId: 'scout', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'always' },
      { fromNodeId: 'tester', toNodeId: 'reviewer', condition: 'always' },
    ],
  },
  {
    id: 'docs_refresh_expanded',
    name: 'Docs Refresh Expanded',
    description: 'Full documentation sweep with discovery, multiple doc writers, validation, and final review.',
    mode: 'document',
    subMode: 'Docs Refresh',
    size: 'expanded',
    agentCount: 10,
    tags: ['Docs suite'],
    previewShape: 'gate',
    nodes: [
      node('coordinator', 'coordinator'),
      node('scout_current_docs', 'scout'),
      node('scout_code_paths', 'scout'),
      node('builder_readme', 'builder'),
      node('builder_architecture', 'builder'),
      node('builder_changelog', 'builder'),
      node('tester_commands', 'tester'),
      node('tester_links', 'tester'),
      node('reviewer_accuracy', 'reviewer'),
      node('reviewer_final', 'reviewer'),
    ],
    edges: [
      { fromNodeId: 'coordinator', toNodeId: 'scout_current_docs', condition: 'always' },
      { fromNodeId: 'coordinator', toNodeId: 'scout_code_paths', condition: 'always' },
      { fromNodeId: 'scout_current_docs', toNodeId: 'builder_readme', condition: 'always' },
      { fromNodeId: 'scout_current_docs', toNodeId: 'builder_architecture', condition: 'always' },
      { fromNodeId: 'scout_code_paths', toNodeId: 'builder_changelog', condition: 'always' },
      { fromNodeId: 'builder_readme', toNodeId: 'tester_commands', condition: 'always' },
      { fromNodeId: 'builder_architecture', toNodeId: 'tester_links', condition: 'always' },
      { fromNodeId: 'builder_changelog', toNodeId: 'reviewer_accuracy', condition: 'always' },
      { fromNodeId: 'tester_commands', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'tester_links', toNodeId: 'reviewer_final', condition: 'always' },
      { fromNodeId: 'reviewer_accuracy', toNodeId: 'reviewer_final', condition: 'always' },
    ],
  },
];

export function listWorkflowPresetModes(): WorkflowPresetModeOption[] {
  return WORKFLOW_PRESET_MODES;
}

export function listWorkflowPresets(): PresetDefinition[] {
  return WORKFLOW_PRESETS;
}

export function getWorkflowPreset(presetId: string | null | undefined): PresetDefinition | null {
  if (!presetId) return null;
  return WORKFLOW_PRESETS.find(preset => preset.id === presetId) ?? null;
}

export function listWorkflowPresetsByMode(mode: WorkflowPresetMode): PresetDefinition[] {
  return sortWorkflowPresets(WORKFLOW_PRESETS.filter(preset => preset.mode === mode));
}

export function groupWorkflowPresetsByMode(presets: PresetDefinition[] = WORKFLOW_PRESETS): Map<WorkflowPresetMode, PresetDefinition[]> {
  const grouped = new Map<WorkflowPresetMode, PresetDefinition[]>();
  for (const option of WORKFLOW_PRESET_MODES) {
    grouped.set(option.value, []);
  }
  for (const preset of presets) {
    grouped.set(preset.mode, [...(grouped.get(preset.mode) ?? []), preset]);
  }
  for (const [mode, values] of grouped) {
    grouped.set(mode, sortWorkflowPresets(values));
  }
  return grouped;
}

export function groupWorkflowPresetsBySubMode(presets: PresetDefinition[]): Map<string, PresetDefinition[]> {
  const grouped = new Map<string, PresetDefinition[]>();
  for (const preset of presets) {
    grouped.set(preset.subMode, [...(grouped.get(preset.subMode) ?? []), preset]);
  }
  for (const [subMode, values] of grouped) {
    grouped.set(subMode, sortWorkflowPresets(values));
  }
  return grouped;
}

export function sortWorkflowPresets(presets: PresetDefinition[]): PresetDefinition[] {
  return [...presets].sort((left, right) => {
    const subMode = left.subMode.localeCompare(right.subMode);
    if (subMode !== 0) return subMode;
    const size = SIZE_ORDER[left.size] - SIZE_ORDER[right.size];
    if (size !== 0) return size;
    return left.name.localeCompare(right.name);
  });
}

export function getRecommendedWorkflowPreset(presets: PresetDefinition[]): PresetDefinition | null {
  return presets.find(preset => preset.size === 'standard') ?? presets[0] ?? null;
}

export function getPresetSpecMetadata(preset: PresetDefinition): {
  specProfile: PresetSpecProfile;
  frontendMode: FrontendWorkflowMode;
} {
  return {
    specProfile: preset.specProfile ?? 'none',
    frontendMode: preset.frontendMode ?? 'off',
  };
}

export function getPresetReadmeDefault(preset: PresetDefinition): boolean {
  return preset.finalReadmeDefault ?? defaultPresetReadmeEnabled({
    mode: preset.mode,
    subMode: preset.subMode,
    specProfile: preset.specProfile,
  });
}

export function getPresetStartNodeIds(preset: PresetDefinition): string[] {
  const hasIncoming = new Set(preset.edges.map(edge => edge.toNodeId));
  return preset.nodes
    .map(presetNode => presetNode.id)
    .filter(nodeId => !hasIncoming.has(nodeId));
}

function getPresetExecutionLayers(preset: PresetDefinition): string[][] {
  const nodeOrder = new Map(preset.nodes.map((presetNode, index) => [presetNode.id, index]));
  const incoming = new Map<string, string[]>();
  const outgoing = new Map<string, string[]>();
  const indegree = new Map<string, number>();
  const layerByNode = new Map<string, number>();

  for (const presetNode of preset.nodes) {
    incoming.set(presetNode.id, []);
    outgoing.set(presetNode.id, []);
    indegree.set(presetNode.id, 0);
    layerByNode.set(presetNode.id, 0);
  }

  for (const edge of preset.edges) {
    if (!indegree.has(edge.fromNodeId) || !indegree.has(edge.toNodeId)) continue;
    outgoing.set(edge.fromNodeId, [...(outgoing.get(edge.fromNodeId) ?? []), edge.toNodeId]);
    incoming.set(edge.toNodeId, [...(incoming.get(edge.toNodeId) ?? []), edge.fromNodeId]);
    indegree.set(edge.toNodeId, (indegree.get(edge.toNodeId) ?? 0) + 1);
  }

  const queue = preset.nodes
    .filter(presetNode => (indegree.get(presetNode.id) ?? 0) === 0)
    .map(presetNode => presetNode.id);

  for (let index = 0; index < queue.length; index += 1) {
    const nodeId = queue[index];
    const nextNodes = [...(outgoing.get(nodeId) ?? [])].sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0));
    for (const nextNodeId of nextNodes) {
      const parentLayers = (incoming.get(nextNodeId) ?? []).map(parentId => layerByNode.get(parentId) ?? 0);
      layerByNode.set(nextNodeId, Math.max(0, ...parentLayers) + 1);
      const nextIndegree = (indegree.get(nextNodeId) ?? 0) - 1;
      indegree.set(nextNodeId, nextIndegree);
      if (nextIndegree === 0) queue.push(nextNodeId);
    }
  }

  const layers = new Map<number, string[]>();
  for (const presetNode of preset.nodes) {
    const layer = layerByNode.get(presetNode.id) ?? 0;
    layers.set(layer, [...(layers.get(layer) ?? []), presetNode.id]);
  }

  return [...layers.entries()]
    .sort(([left], [right]) => left - right)
    .map(([, nodeIds]) => nodeIds.sort((left, right) => (nodeOrder.get(left) ?? 0) - (nodeOrder.get(right) ?? 0)));
}

function getPresetNodePositions(preset: PresetDefinition): Map<string, { x: number; y: number }> {
  const layers = getPresetExecutionLayers(preset);
  const baseY = 360;
  const agentStartX = 440;
  const layerSpacingX = 460;
  const branchSpacingY = 520;
  const positions = new Map<string, { x: number; y: number }>();

  layers.forEach((nodeIds, layerIndex) => {
    const columnOffset = (nodeIds.length - 1) / 2;
    nodeIds.forEach((nodeId, rowIndex) => {
      positions.set(nodeId, {
        x: agentStartX + layerIndex * layerSpacingX,
        y: baseY + (rowIndex - columnOffset) * branchSpacingY,
      });
    });
  });

  return positions;
}

export function buildPresetFlowGraph(options: {
  preset: PresetDefinition;
  missionId: string;
  prompt: string;
  mode: WorkflowMode;
  workspaceDir: string | null;
  bindingsByRole: Record<string, TerminalBindingLike>;
  instructionOverrides?: Record<string, string>;
  frontendMode?: FrontendWorkflowMode;
  finalReadmeEnabled?: boolean;
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

  const frontendMode = options.frontendMode ?? preset.frontendMode ?? 'off';
  const finalReadmeEnabled = options.finalReadmeEnabled ?? getPresetReadmeDefault(preset);
  const taskNodeId = `task-${missionId}`;
  const startNodeIds = getPresetStartNodeIds(preset);
  const agentPositions = getPresetNodePositions(preset);

  const nodes = [
    {
      id: taskNodeId,
      type: 'task',
      position: { x: 100, y: 360 },
      data: {
        roleId: 'task',
        prompt,
        mode,
        workspaceDir: workspaceDir ?? '',
        frontendMode,
        specProfile: preset.specProfile ?? 'none',
        finalReadmeEnabled,
        authoringMode: 'preset',
        presetId: preset.id,
        runVersion: 1,
      },
    },
    ...preset.nodes.map((presetNode, index) => {
      const binding = bindingsByRole[presetNode.roleId];
      return {
        id: presetNode.id,
        type: 'agent',
        position: agentPositions.get(presetNode.id) ?? { x: 440 + index * 360, y: 360 },
        data: {
          roleId: presetNode.roleId,
          instructionOverride: instructionOverrides[presetNode.roleId] ?? '',
          terminalId: binding?.terminalId ?? '',
          terminalTitle: binding?.terminalTitle ?? '',
          paneId: binding?.paneId ?? '',
          cli: binding?.cli ?? 'claude',
          model: binding?.model ?? '',
          executionMode: binding?.executionMode ?? 'interactive_pty',
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
