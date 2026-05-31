import agentsConfig from './agents.json' with { type: 'json' };

type WorkflowAgentDef = (typeof agentsConfig.agents)[number];

export interface PublicAgentRole {
  id: 'code' | 'reasoning' | 'research' | 'review' | 'design';
  profileId: string;
  name: string;
  role: string;
  description: string;
  capabilities: WorkflowAgentDef['capabilities'];
  coreInstructions: string;
}

export const PUBLIC_AGENT_ROLES: PublicAgentRole[] = [
  {
    id: 'code',
    profileId: 'code_profile',
    name: 'Code',
    role: 'Workspace Coding Agent',
    description: 'Implements changes, debugs issues, edits files, and runs commands when useful.',
    capabilities: [
      { id: 'coding', level: 3 },
      { id: 'shell_execution', level: 3 },
      { id: 'repo_analysis', level: 2 },
    ],
    coreInstructions:
      'Help with coding in the current workspace. Inspect files and run commands when helpful. Make focused changes when the user asks for implementation. Answer direct questions directly, and do not look for workflow missions or inbox tasks unless the user explicitly asks about a workflow.',
  },
  {
    id: 'reasoning',
    profileId: 'reasoning_profile',
    name: 'Reasoning',
    role: 'Planning and Architecture Agent',
    description: 'Thinks through plans, architecture, tradeoffs, product shape, and debugging strategy.',
    capabilities: [
      { id: 'planning', level: 3 },
      { id: 'repo_analysis', level: 2 },
      { id: 'review', level: 2 },
    ],
    coreInstructions:
      'Help reason through the problem clearly. Prefer concise plans, tradeoffs, and next actions. Use workspace context when relevant. Do not assume a workflow node assignment or call workflow inbox/task tools unless the user explicitly asks for workflow work.',
  },
  {
    id: 'research',
    profileId: 'research_profile',
    name: 'Research',
    role: 'Research and Discovery Agent',
    description: 'Explores codebases, docs, dependencies, APIs, and external options before decisions.',
    capabilities: [
      { id: 'repo_analysis', level: 3 },
      { id: 'planning', level: 2 },
      { id: 'shell_execution', level: 2 },
    ],
    coreInstructions:
      'Research the current question before recommending action. Inspect the repository, documentation, or external sources when useful and summarize findings plainly. Do not look for assigned workflow tasks unless the user explicitly asks about a workflow.',
  },
  {
    id: 'review',
    profileId: 'review_profile',
    name: 'Review',
    role: 'Quality Review Agent',
    description: 'Checks code, tests, UX, security, accessibility, regressions, and release risk.',
    capabilities: [
      { id: 'review', level: 3 },
      { id: 'testing', level: 2 },
      { id: 'security', level: 2 },
    ],
    coreInstructions:
      'Review work for bugs, missing tests, risky assumptions, UX/accessibility issues, and security concerns. Lead with concrete findings. Do not require a workflow mission context unless the user explicitly asks you to inspect a workflow run.',
  },
  {
    id: 'design',
    profileId: 'design_profile',
    name: 'Design',
    role: 'Product and UI Design Agent',
    description: 'Shapes UI, product flows, visual systems, interaction states, and design critique.',
    capabilities: [
      { id: 'planning', level: 3 },
      { id: 'review', level: 2 },
      { id: 'repo_analysis', level: 1 },
    ],
    coreInstructions:
      'Help with product and UI design decisions. Be concrete about layout, hierarchy, states, accessibility, and product fit. Do not create workflow handoff files or look for workflow inbox tasks unless the user explicitly asks for workflow execution.',
  },
];

export const WORKFLOW_AGENT_ROLES = agentsConfig.agents;

export const WORKFLOW_TO_PUBLIC_ROLE: Record<string, PublicAgentRole['id']> = {
  scout: 'research',
  coordinator: 'reasoning',
  builder: 'code',
  tester: 'review',
  security: 'review',
  reviewer: 'review',
  frontend_product: 'reasoning',
  frontend_designer: 'design',
  frontend_architect: 'reasoning',
  frontend_builder: 'code',
  interaction_qa: 'review',
  accessibility_reviewer: 'review',
  visual_polish_reviewer: 'review',
};

export const PUBLIC_TO_DEFAULT_WORKFLOW_ROLE: Record<PublicAgentRole['id'], string> = {
  code: 'builder',
  reasoning: 'coordinator',
  research: 'scout',
  review: 'reviewer',
  design: 'frontend_designer',
};

export function getPublicAgentRole(roleId: string | null | undefined): PublicAgentRole | undefined {
  const normalized = String(roleId ?? '').trim();
  return PUBLIC_AGENT_ROLES.find(role => role.id === normalized);
}

export function getWorkflowAgentRole(roleId: string | null | undefined): WorkflowAgentDef | undefined {
  const normalized = String(roleId ?? '').trim();
  const direct = WORKFLOW_AGENT_ROLES.find(role => role.id === normalized);
  if (direct) return direct;
  const mappedWorkflowRoleId = PUBLIC_TO_DEFAULT_WORKFLOW_ROLE[normalized as PublicAgentRole['id']];
  return mappedWorkflowRoleId
    ? WORKFLOW_AGENT_ROLES.find(role => role.id === mappedWorkflowRoleId)
    : undefined;
}

export function getPublicRoleForWorkflowRole(roleId: string | null | undefined): PublicAgentRole {
  const normalized = String(roleId ?? '').trim();
  const mappedPublicRoleId = WORKFLOW_TO_PUBLIC_ROLE[normalized] ?? (getPublicAgentRole(normalized)?.id ?? 'code');
  return PUBLIC_AGENT_ROLES.find(role => role.id === mappedPublicRoleId) ?? PUBLIC_AGENT_ROLES[0];
}

export function formatWorkflowRoleLabel(roleId: string | null | undefined): string {
  const workflowRole = getWorkflowAgentRole(roleId);
  const publicRole = getPublicRoleForWorkflowRole(roleId);
  if (!workflowRole) return publicRole.name;
  return `${publicRole.name} / ${workflowRole.name}`;
}
