import type { WorkflowPresetMode } from './workflowPresets.js';

export const FINAL_README_INSTRUCTION =
  'Final README instruction: before completing, create a very short user guidance file for the work produced by this workflow. Prefer the generated/target folder. If README.md does not exist there, create README.md. If README.md already exists, do not overwrite or append to it by default; create INSTRUCTIONS.md instead. If INSTRUCTIONS.md also exists, use SUMMARY.md, then REVIEW.md as the last fallback. Keep it concise: summarize the files and folders created or changed, note the main entry points, and include only the concrete run/test commands the user needs, such as cd into the created app folder and npm run dev. Do not write a long architecture rundown.';

export interface ReadmeSelectableNode {
  id: string;
  roleId: string;
}

export interface ReadmeOwnerSelectionContext {
  mode?: WorkflowPresetMode | string;
  subMode?: string;
}

export const GENERIC_README_ROLE_PRIORITY = [
  'visual_polish_reviewer',
  'interaction_qa',
  'accessibility_reviewer',
  'reviewer',
  'tester',
  'security',
  'builder',
  'frontend_builder',
  'frontend_architect',
  'frontend_designer',
  'frontend_product',
  'coordinator',
  'scout',
];

const README_ROLE_PRIORITY_BY_SUB_MODE: Record<string, string[]> = {
  'App / Site': [
    'visual_polish_reviewer',
    'interaction_qa',
    'accessibility_reviewer',
    'reviewer',
    'frontend_builder',
    'frontend_architect',
    'frontend_designer',
    'frontend_product',
  ],
  'Patch / Build': [
    'reviewer',
    'tester',
    'security',
    'builder',
    'coordinator',
    'scout',
  ],
  Delivery: [
    'reviewer',
    'tester',
    'security',
    'builder',
    'coordinator',
  ],
  'Research Scout': [
    'reviewer',
    'security',
    'tester',
    'scout',
    'coordinator',
  ],
  'Architecture Plan': [
    'reviewer',
    'coordinator',
    'tester',
    'security',
    'builder',
    'scout',
  ],
  'Code Review': [
    'reviewer',
    'security',
    'tester',
    'builder',
    'scout',
    'coordinator',
  ],
  'Regression Sweep': [
    'reviewer',
    'accessibility_reviewer',
    'interaction_qa',
    'tester',
    'security',
    'builder',
    'coordinator',
  ],
  'Security Review': [
    'reviewer',
    'security',
    'tester',
    'builder',
    'coordinator',
    'scout',
  ],
  'Docs Refresh': [
    'reviewer',
    'builder',
    'tester',
    'coordinator',
    'scout',
  ],
};

const README_ROLE_PRIORITY_BY_MODE: Record<string, string[]> = {
  build: ['reviewer', 'visual_polish_reviewer', 'interaction_qa', 'accessibility_reviewer', 'tester', 'security', 'builder', 'coordinator', 'scout'],
  research: ['reviewer', 'security', 'tester', 'scout', 'coordinator'],
  plan: ['reviewer', 'coordinator', 'tester', 'security', 'builder', 'scout'],
  review: ['reviewer', 'security', 'tester', 'builder', 'scout', 'coordinator'],
  verify: ['reviewer', 'accessibility_reviewer', 'interaction_qa', 'tester', 'security', 'builder', 'coordinator'],
  secure: ['reviewer', 'security', 'tester', 'builder', 'coordinator', 'scout'],
  document: ['reviewer', 'builder', 'tester', 'coordinator', 'scout'],
};

export function getReadmeRolePriority(context: ReadmeOwnerSelectionContext): string[] {
  return (
    (context.subMode ? README_ROLE_PRIORITY_BY_SUB_MODE[context.subMode] : undefined) ??
    (context.mode ? README_ROLE_PRIORITY_BY_MODE[context.mode] : undefined) ??
    GENERIC_README_ROLE_PRIORITY
  );
}

export function selectFinalReadmeOwner(
  finalNodes: readonly ReadmeSelectableNode[],
  allNodes: readonly ReadmeSelectableNode[],
  context: ReadmeOwnerSelectionContext = {},
): string | null {
  if (finalNodes.length === 0) return null;
  if (finalNodes.length === 1) return finalNodes[0].id;

  const priority = getReadmeRolePriority(context);
  const priorityByRole = new Map(priority.map((roleId, index) => [roleId, index]));
  const orderByNode = new Map(allNodes.map((node, index) => [node.id, index]));

  return [...finalNodes]
    .sort((left, right) => {
      const leftPriority = priorityByRole.get(left.roleId) ?? Number.MAX_SAFE_INTEGER;
      const rightPriority = priorityByRole.get(right.roleId) ?? Number.MAX_SAFE_INTEGER;
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;

      const leftOrder = orderByNode.get(left.id) ?? Number.MAX_SAFE_INTEGER;
      const rightOrder = orderByNode.get(right.id) ?? Number.MAX_SAFE_INTEGER;
      if (leftOrder !== rightOrder) return leftOrder - rightOrder;

      return left.id.localeCompare(right.id);
    })[0]?.id ?? null;
}

export function defaultPresetReadmeEnabled(options: {
  mode: WorkflowPresetMode;
  subMode: string;
  specProfile?: string;
}): boolean {
  if (options.subMode === 'App / Site') return true;
  return false;
}
