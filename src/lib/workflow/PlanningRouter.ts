/**
 * PlanningRouter.ts — Planning Router and DAG Builder.
 *
 * This module turns user goals into a concrete, inspectable job map.
 * It starts with deterministic templates and can be expanded to LLM planning.
 *
 * Phase 7 — Planning Router and DAG Builder
 */

import type { WorkflowEdgeCondition, WorkflowGraph, WorkflowNode, WorkflowEdge, RetryPolicy } from '../../store/workspace.js';
import { generateId } from '../graphUtils.js';

export const ROLE_CONTRACTS: Record<string, string> = {
  scout: `
OUTPUT CONTRACT:
1. Context summary: High-level understanding of the goal and codebase.
2. Relevant files/modules: List of files that need to be read or modified.
3. Risk list: Any potential side effects or technical debt identified.
4. Recommended next tasks: Suggestions for the Coordinator or Builder.
5. Confidence level: (1-5) How well you understand the task.

REQUIRED ARTIFACT: write_artifact(kind: 'scout_context', ...)
`.trim(),
  coordinator: `
OUTPUT CONTRACT:
1. Delegation plan: How to split work between Builder, Tester, and Security.
2. Task boundaries: Specific scopes for each specialist.
3. File lock recommendations: Which files should be locked for writing.
4. Retry/reroute conditions: When should a specialist attempt be considered a failure.

REQUIRED ARTIFACT: write_artifact(kind: 'summary', title: 'Implementation Plan', ...)
`.trim(),
  builder: `
OUTPUT CONTRACT:
1. Patch artifact: Use propose_patch for all code changes.
2. Files changed: List of paths modified.
3. Explanation: Why these changes were made.
4. Known risks: Any remaining edge cases or potential bugs.
5. Suggested tests: Specific things for the Tester to verify.

REQUIRED ARTIFACT: propose_patch(kind: 'patch', ...)
`.trim(),
  tester: `
OUTPUT CONTRACT:
1. Test commands run: The exact shell commands used for verification.
2. Pass/fail result: Use submit_test_result for each test suite.
3. Logs: Relevant stdout/stderr from test runs.
4. Repro notes: How to manually reproduce the verification.
5. Missing coverage: Any areas not covered by automated tests.

REQUIRED ARTIFACT: submit_test_result(kind: 'test_result', ...)
`.trim(),
  security: `
OUTPUT CONTRACT:
1. Risk report: Use submit_risk_report for identified vulnerabilities.
2. Severity: Low, Medium, High, or Critical.
3. Required changes: Specific modifications needed to mitigate risks.
4. Approval or rejection: A clear security verdict.

REQUIRED ARTIFACT: submit_risk_report(kind: 'risk_report', ...)
`.trim(),
  reviewer: `
OUTPUT CONTRACT:
1. Final review summary: Synthesis of all specialists' results.
2. Acceptance criteria checklist: Verify each criterion from the original plan.
3. Artifact bundle: References to the key patches and test results.
4. Go/no-go recommendation: Final merge approval verdict.

REQUIRED ARTIFACT: write_artifact(kind: 'review_verdict', ...)
`.trim(),
};

export interface PlannedNode {
  id: string;
  role: string;
  title: string;
  objective: string;
  expectedOutput: string;
  acceptanceCriteria: string[];
  suggestedCli?: string;
  suggestedModel?: string;
  dependencies: string[]; // Node IDs
  suggestedRetryPolicy?: RetryPolicy;
}

export interface PlannedDag {
  missionId: string;
  goal: string;
  nodes: PlannedNode[];
  edges: { from: string; to: string; reason: string; condition?: WorkflowEdgeCondition }[];
  assumptions: string[];
  risks: string[];
}

export type TaskType = 'bugfix' | 'feature' | 'refactor' | 'security' | 'docs' | 'generic';

/**
 * Basic router that maps task type keywords to roles.
 */
export function routeTaskType(goal: string): TaskType {
  const low = goal.toLowerCase();
  if (low.includes('security') || low.includes('vulnerability') || low.includes('auth')) return 'security';
  if (low.includes('fix') || low.includes('bug') || low.includes('error') || low.includes('crash')) return 'bugfix';
  if (low.includes('add') || low.includes('new') || low.includes('feature') || low.includes('implement')) return 'feature';
  if (low.includes('refactor') || low.includes('clean') || low.includes('simplify')) return 'refactor';
  if (low.includes('doc') || low.includes('readme') || low.includes('guide')) return 'docs';
  return 'generic';
}

/**
 * Creates a PlannedDag from a goal using deterministic templates.
 */
export function planMission(goal: string, missionId: string): PlannedDag {
  const taskType = routeTaskType(goal);
  
  const nodes: PlannedNode[] = [];
  const edges: { from: string; to: string; reason: string; condition?: WorkflowEdgeCondition }[] = [];
  const assumptions: string[] = ['Workspace directory is correct', 'Project dependencies are installed'];
  const risks: string[] = [];

  const defaultRetryPolicy: RetryPolicy = {
    maxAttempts: 2,
    retryOn: ['runtime_launch_failed', 'cli_ready_timeout', 'task_ack_timeout', 'unknown'],
    backoffMs: 2000,
  };

  const technicalRetryPolicy: RetryPolicy = {
    ...defaultRetryPolicy,
    maxAttempts: 3,
    retryOn: [...defaultRetryPolicy.retryOn, 'tool_error', 'patch_failed', 'test_failed'],
  };

  // 1. Always start with a Scout
  nodes.push({
    id: 'scout',
    role: 'scout',
    title: 'Codebase Analysis',
    objective: 'Explore the codebase to understand the context of the requested change.',
    expectedOutput: 'Summary of relevant files and logic flows.',
    acceptanceCriteria: [
      'Identified all files needing modification',
      'Found potential side effects in related modules',
      'Documented existing logic and unknowns',
    ],
    dependencies: [],
    suggestedRetryPolicy: defaultRetryPolicy,
  });

  // 2. Add Coordinator if it's not a documentation task
  if (taskType !== 'docs') {
    nodes.push({
      id: 'coordinator',
      role: 'coordinator',
      title: 'Implementation Planning',
      objective: 'Define the implementation strategy and coordinate specialists.',
      expectedOutput: 'Detailed implementation plan.',
      acceptanceCriteria: [
        'Plan covers all functional requirements',
        'Work split is logical and non-overlapping',
        'File locks identified for safe concurrent work',
        'Retry/reroute conditions defined for failures',
      ],
      dependencies: ['scout'],
      suggestedRetryPolicy: defaultRetryPolicy,
    });
    edges.push({ from: 'scout', to: 'coordinator', reason: 'Planning requires analysis', condition: 'on_success' });
  }

  // 3. Add Specialists based on task type
  const upstream = taskType === 'docs' ? 'scout' : 'coordinator';

  if (taskType === 'bugfix' || taskType === 'feature' || taskType === 'refactor' || taskType === 'generic') {
    nodes.push({
      id: 'builder',
      role: 'builder',
      title: 'Implementation',
      objective: 'Apply the requested changes to the codebase.',
      expectedOutput: 'Modified source files.',
      acceptanceCriteria: [
        'Code matches implementation plan',
        'No new lint or type errors introduced',
        'Logic matches functional goal',
        'Edge cases identified by Scout are handled',
      ],
      dependencies: [upstream],
      suggestedRetryPolicy: technicalRetryPolicy,
    });
    edges.push({ from: upstream, to: 'builder', reason: 'Implementation follows plan', condition: 'always' });

    if (taskType !== 'refactor') {
      nodes.push({
        id: 'tester',
        role: 'tester',
        title: 'Verification',
        objective: 'Verify the changes through automated tests.',
        expectedOutput: 'Test results and coverage report.',
        acceptanceCriteria: [
          'Test cases cover all requirements',
          'All new and existing tests pass',
          'Logs attached to results for debugging',
          'Verified in environment matching target',
        ],
        dependencies: ['builder'],
        suggestedRetryPolicy: technicalRetryPolicy,
      });
      edges.push({ from: 'builder', to: 'tester', reason: 'Verification follows implementation', condition: 'on_success' });
    }
  }

  if (taskType === 'security') {
    nodes.push({
      id: 'security',
      role: 'security',
      title: 'Security Audit',
      objective: 'Review changes for security vulnerabilities.',
      expectedOutput: 'Security assessment report.',
      acceptanceCriteria: [
        'No secrets exposed in code or logs',
        'No unsafe shell executions or injection risks',
        'Permissions and access controls verified',
        'Data loss and corruption risks assessed',
      ],
      dependencies: [upstream],
      suggestedRetryPolicy: technicalRetryPolicy,
    });
    edges.push({ from: upstream, to: 'security', reason: 'Security audit follows plan', condition: 'always' });
  }

  if (taskType === 'docs') {
    nodes.push({
      id: 'builder',
      role: 'builder',
      title: 'Documentation Update',
      objective: 'Update documentation files.',
      expectedOutput: 'Modified markdown files.',
      acceptanceCriteria: [
        'Documentation is accurate and clear',
        'All links and references are valid',
        'Code examples are up to date',
      ],
      dependencies: ['scout'],
      suggestedRetryPolicy: defaultRetryPolicy,
    });
    edges.push({ from: 'scout', to: 'builder', reason: 'Docs follow analysis', condition: 'always' });
  }

  // 4. Always end with a Reviewer
  const lastSpecialists = nodes.filter(n => n.role === 'tester' || n.role === 'security' || (n.role === 'builder' && taskType === 'docs') || (n.role === 'builder' && taskType === 'refactor'));
  const reviewDeps = lastSpecialists.length > 0 ? lastSpecialists.map(n => n.id) : [upstream];

  nodes.push({
    id: 'reviewer',
    role: 'reviewer',
    title: 'Quality Gate',
    objective: 'Final review of all artifacts and decision to merge.',
    expectedOutput: 'Final verdict and merge approval.',
    acceptanceCriteria: [
      'All quality signals (tests, security) are green',
      'Original goal is fully satisfied',
      'Artifact bundle is complete and organized',
      'Acceptance criteria for all nodes verified',
    ],
    dependencies: reviewDeps,
    suggestedRetryPolicy: defaultRetryPolicy,
  });

  for (const dep of reviewDeps) {
    edges.push({ from: dep, to: 'reviewer', reason: 'Final review requires all artifacts', condition: 'on_success' });
  }

  return {
    missionId,
    goal,
    nodes,
    edges,
    assumptions,
    risks,
  };
}

/**
 * Converts a PlannedDag into a WorkflowGraph that can be loaded into the UI.
 */
export function convertPlannedDagToWorkflowGraph(planned: PlannedDag): WorkflowGraph {
  const taskNodeId = `task-${planned.missionId}`;
  
  const nodes: WorkflowNode[] = [
    {
      id: taskNodeId,
      roleId: 'task',
      status: 'idle',
      config: {
        prompt: planned.goal,
        mode: 'build',
        position: { x: 100, y: 100 },
      },
    },
  ];

  const edges: WorkflowEdge[] = [];

  // Map planned node IDs to generated IDs for the graph
  const idMap = new Map<string, string>();
  idMap.set('task', taskNodeId);

  planned.nodes.forEach((pn, index) => {
    const nodeId = generateId();
    idMap.set(pn.id, nodeId);

    nodes.push({
      id: nodeId,
      roleId: pn.role,
      status: 'idle',
      config: {
        label: pn.title,
        instructionOverride: pn.objective,
        acceptanceCriteria: pn.acceptanceCriteria,
        outputContract: ROLE_CONTRACTS[pn.role] || '',
        retryPolicy: pn.suggestedRetryPolicy,
        position: { x: 400 + (index % 2) * 300, y: 100 + Math.floor(index / 2) * 200 },
        cli: (pn.suggestedCli as any) || 'claude',
        model: pn.suggestedModel,
      },
    });
  });

  // Connect task node to start nodes (nodes with no dependencies)
  planned.nodes.filter(n => n.dependencies.length === 0).forEach(n => {
    edges.push({
      fromNodeId: taskNodeId,
      toNodeId: idMap.get(n.id)!,
      condition: 'always',
    });
  });

  // Connect planned edges
  planned.edges.forEach(pe => {
    const fromId = idMap.get(pe.from);
    const toId = idMap.get(pe.to);
    if (fromId && toId) {
      edges.push({
        fromNodeId: fromId,
        toNodeId: toId,
        condition: pe.condition || 'always',
      });
    }
  });

  return {
    id: `planned-${planned.missionId}`,
    nodes,
    edges,
  };
}
