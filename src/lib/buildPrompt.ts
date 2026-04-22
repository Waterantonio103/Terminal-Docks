import agentsConfig from '../config/agents';

type AgentDef = (typeof agentsConfig.agents)[number];

export type LaunchMode = 'build' | 'edit';
export type LaunchOutcome = 'success' | 'failure';
export type LaunchTargetCondition = 'always' | 'on_success' | 'on_failure';

export interface LaunchOutgoingTarget {
  targetNodeId: string;
  targetRoleId: string;
  targetRoleName?: string;
  condition: LaunchTargetCondition;
}

export interface LaunchContext {
  workspaceDir: string | null;
  pipeline: string[];
  instanceNum: number;
  totalInstances: number;
  predecessorRole: AgentDef | null;
  successorRole: AgentDef | null;
  missionId?: string | null;
  nodeId?: string | null;
  attempt?: number;
  allowedOutgoingTargets?: LaunchOutgoingTarget[];
  task: string;
  mode: LaunchMode;
}

// Roles inside one group run in parallel once the previous group completes.
export const STAGES: string[][] = [
  ['scout'],
  ['coordinator'],
  ['builder', 'tester', 'security'],
  ['reviewer'],
];

export const EDIT_INSTRUCTIONS: Record<string, string> = {
  scout:
    'Explore the workspace directory to understand the existing codebase. Use shell commands (ls, find, cat, grep) to read existing files - do NOT modify anything. Map out: file structure, naming conventions, tech stack, and which files are directly relevant to the objective. Record findings via `update_workspace_context` so downstream roles can read them without scrolling session history.',
  coordinator:
    'Based on the analysis, create a precise change plan. For each change specify: the exact file path, what currently exists (quote relevant lines if helpful), and exactly what it should become. Be specific enough that a Builder can implement without asking questions. Assign exclusive file ownership to each Builder to prevent edit conflicts. Fan out parallel work by handing off to Tester and Security alongside Builder.',
  builder:
    'Apply the targeted changes from the plan. Before touching any file call `lock_file` - if it returns "queued", keep working on other unlocked files until you receive a [LOCK GRANTED] message. Read each file first, then make MINIMAL targeted edits - change only what is specified. Preserve existing formatting, naming, and style. Do not rewrite files from scratch unless the plan explicitly says to.',
  tester:
    'Write tests for the planned changes in parallel with the Builder. Target the acceptance criteria from the plan, not the Builder\'s in-progress code. Always `lock_file` before editing any test file. Do not modify source files owned by the Builder.',
  security:
    'Audit the planned changes for security issues in parallel with the Builder: auth/authz, input validation, secret handling, injection surfaces, dependency CVEs. Record findings via `update_workspace_context` so the Builder can address them live. Only edit files for clear, low-risk fixes and always `lock_file` first.',
  reviewer:
    'Review the combined output of Builder, Tester, and Security. Verify: (1) the objective was achieved, (2) no existing behaviour was broken, (3) changes follow the project\'s existing conventions, (4) tests cover the acceptance criteria, (5) security findings are addressed. Apply minor fixes yourself. Give a clear pass or fail verdict with specifics; on fail, target the specific specialist responsible via handoff_task.',
};

function outcomesForCondition(condition: LaunchTargetCondition): LaunchOutcome[] {
  if (condition === 'on_success') return ['success'];
  if (condition === 'on_failure') return ['failure'];
  return ['success', 'failure'];
}

function formatOutgoingTargets(targets: readonly LaunchOutgoingTarget[]): string {
  return targets.map(target => {
    const allowed = outcomesForCondition(target.condition).join(' or ');
    const roleLabel = target.targetRoleName ?? target.targetRoleId;
    return `${target.targetNodeId} (${roleLabel}; edge=${target.condition}; outcomes=${allowed})`;
  }).join('; ');
}

export function buildLaunchPrompt(agentId: string, ctx: LaunchContext, instructionOverride?: string): string {
  const agent = agentsConfig.agents.find(a => a.id === agentId);
  if (!agent) return '';

  const lines: string[] = [];
  const isSolo = ctx.pipeline.length === 1 && ctx.totalInstances === 1;
  const hasNodeContext = Boolean(ctx.missionId && ctx.nodeId);
  const outgoingTargets = ctx.allowedOutgoingTargets ?? [];

  lines.push('Call the `get_collaboration_protocol` MCP tool and follow the protocol it returns.');

  if (ctx.workspaceDir) {
    if (ctx.mode === 'edit') {
      lines.push(`Existing project: ${ctx.workspaceDir}.`);
      lines.push('This is an EXISTING codebase. Read files before making any changes. Make targeted, minimal edits - do not rewrite from scratch unless the plan explicitly says to.');
    } else {
      lines.push(`Working directory: ${ctx.workspaceDir}.`);
      lines.push('Write ALL output files into this directory using your native file tools. Do not describe code - create actual files on disk.');
    }
  }

  if (isSolo) {
    lines.push(`You are the ${agent.name} (${agent.role}), working solo on this task.`);
  } else {
    const pos = ctx.pipeline.indexOf(agentId) + 1;
    if (ctx.totalInstances > 1) {
      lines.push(`You are ${agent.name} ${ctx.instanceNum} of ${ctx.totalInstances} (${agent.role}) - step ${pos} of ${ctx.pipeline.length} in the pipeline.`);
      lines.push(`You and the other ${agent.name}s work in parallel on this step.`);
    } else {
      lines.push(`You are the ${agent.name} (${agent.role}) - step ${pos} of ${ctx.pipeline.length} in the pipeline.`);
    }
  }

  if (ctx.predecessorRole) {
    lines.push(`Your predecessor, the ${ctx.predecessorRole.name}, has finished and sent you a structured handoff. Call the \`receive_messages\` MCP tool to read their payload before proceeding.`);
  } else {
    lines.push('No predecessor - start work immediately from the objective below.');
  }

  if (hasNodeContext) {
    lines.push(`Mission: ${ctx.missionId}. Node: ${ctx.nodeId}. Current attempt: ${ctx.attempt ?? 1}.`);
    lines.push('Treat `get_task_details` as the canonical source of truth for your current node context, incoming payloads, attempt number, and legal next targets. Call it whenever you receive a NEW_TASK activation and before any handoff if anything is unclear.');
    if (outgoingTargets.length > 0) {
      lines.push(`Legal outgoing targets for this node: ${formatOutgoingTargets(outgoingTargets)}.`);
    } else {
      lines.push('This node currently has no legal outgoing targets. If your chosen outcome has no legal target in `get_task_details`, publish your result and stop instead of guessing a successor.');
    }
  }

  lines.push(`Objective: ${ctx.task}.`);

  const modeDefault = ctx.mode === 'edit' ? EDIT_INSTRUCTIONS[agentId] : undefined;
  lines.push(instructionOverride ?? modeDefault ?? agent.coreInstructions);
  if (hasNodeContext) {
    lines.push('Graph-routing override: ignore any older role-level instructions that mention `targetRole`, `successorRole`, or handing off to `done`. In graph mode you must route by exact node IDs from `get_task_details`, not by guessing from role names.');
  }

  lines.push('CRITICAL: If you receive a raw JSON message starting with {"signal":"NEW_TASK"...}, you MUST parse it and immediately call the `get_task_details` tool using the provided missionId and nodeId, and then call `receive_messages` with that nodeId to process your inbox. Do this on every activation, including retries.');

  lines.push('When your work is complete:');
  let step = 1;
  if (hasNodeContext) {
    if (outgoingTargets.length > 0) {
      lines.push(`${step++}. Decide your explicit outcome: \`success\` or \`failure\`. Use \`get_task_details\` as the canonical list of which target nodes are legal for that outcome.`);
      lines.push(`${step++}. If there is a legal next target for that outcome, call the \`handoff_task\` MCP tool with \`missionId="${ctx.missionId}"\`, \`fromNodeId="${ctx.nodeId}"\`, the exact \`targetNodeId\`, an explicit \`outcome\`, a short title, and a structured JSON payload. Do not guess the next hop from a role name.`);
    } else {
      lines.push(`${step++}. This is a terminal node unless \`get_task_details\` reports otherwise. Do not call \`handoff_task\` without an exact legal \`targetNodeId\`.`);
    }
  } else if (!isSolo && ctx.successorRole) {
    lines.push(`${step++}. Call the \`handoff_task\` MCP tool with fromRole="${agent.id}", targetRole="${ctx.successorRole.id}", a short title, and a structured JSON payload summarizing your output for the next stage. This advances the pipeline - do not announce literal phrases.`);
  }
  lines.push(`${step}. Call the \`publish_result\` MCP tool with \`content\` = "${agent.name} Summary: <your summary>" and \`type\` = "markdown" so the user sees your work in Mission Control.`);

  // Join with a space - never newlines, as \n in PTY input is treated as Enter on Windows
  return lines.join(' ');
}
