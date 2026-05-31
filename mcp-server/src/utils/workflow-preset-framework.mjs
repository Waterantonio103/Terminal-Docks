const MODE_CONFIGS = {
  research: {
    label: 'Research preset framework',
    intent: 'Produce current, evidence-backed findings that remove uncertainty before implementation.',
    requiredContext: ['objective', 'workspace evidence', 'source paths', 'risks or unknowns', 'recommendation'],
    durableArtifacts: ['workspace_context:researchFindings', 'completion.downstreamPayload'],
    gateLevel: 'block_on_missing_evidence',
  },
  plan: {
    label: 'Planning preset framework',
    intent: 'Turn objective and codebase evidence into a concrete, low-ambiguity implementation plan.',
    requiredContext: ['objective', 'constraints', 'file ownership', 'sequenced tasks', 'verification commands'],
    durableArtifacts: ['workspace_context:plan', 'completion.downstreamPayload'],
    gateLevel: 'block_on_missing_plan',
  },
  review: {
    label: 'Review preset framework',
    intent: 'Produce an actionable quality verdict grounded in exact files, behavior, tests, and residual risk.',
    requiredContext: ['review scope', 'evidence inspected', 'findings', 'severity', 'verdict'],
    durableArtifacts: ['workspace_context:reviewFindings', 'completion.downstreamPayload'],
    gateLevel: 'block_on_missing_verdict',
  },
  verify: {
    label: 'Verification preset framework',
    intent: 'Prove whether the current work is releasable by running focused checks and reporting exact evidence.',
    requiredContext: ['verification scope', 'commands or manual checks', 'results', 'failures', 'release risk'],
    durableArtifacts: ['workspace_context:testEvidence', 'completion.downstreamPayload'],
    gateLevel: 'block_on_missing_verification',
  },
  secure: {
    label: 'Security preset framework',
    intent: 'Identify exploitable risk, validate impact, and define or verify safe remediation paths.',
    requiredContext: ['trust boundaries', 'attack surfaces', 'evidence', 'severity', 'remediation or acceptance decision'],
    durableArtifacts: ['workspace_context:securityReview', 'completion.downstreamPayload'],
    gateLevel: 'block_on_missing_security_evidence',
  },
  document: {
    label: 'Documentation preset framework',
    intent: 'Refresh user- or agent-facing documentation from current code and verified commands.',
    requiredContext: ['documentation scope', 'current source evidence', 'changed docs', 'verification commands', 'remaining gaps'],
    durableArtifacts: ['workspace_context:docsRefresh', 'completion.downstreamPayload'],
    gateLevel: 'block_on_missing_doc_evidence',
  },
  build: {
    label: 'Build preset framework',
    intent: 'Deliver scoped software changes with implementation evidence, focused verification, and a clear handoff.',
    requiredContext: ['objective', 'current code evidence', 'changed files', 'verification commands', 'handoff or release risk'],
    durableArtifacts: ['workspace_context:buildDelivery', 'completion.downstreamPayload'],
    gateLevel: 'block_on_missing_build_evidence',
  },
};

const SUB_MODE_FRAMEWORKS = {
  'Patch / Build': {
    focus: 'Tightly scoped code changes with fast reviewable verification.',
    laneGuidance: {
      scout: 'Identify the relevant code path, existing conventions, likely blast radius, and any stale docs or assumptions before implementation.',
      coordinator: 'Split implementation, verification, security, and review lanes around exact files or behaviors; keep scope narrow and sequence dependencies clearly.',
      builder: 'Make the smallest coherent code change that satisfies the task, preserve unrelated dirty work, and report changed files plus behavior impact.',
      tester: 'Run the smallest meaningful checks for the touched path, capture command output or exact manual evidence, and call out untested scope.',
      security: 'Inspect the patch for auth, data, file, command, dependency, and permission risks introduced or touched by the change.',
      reviewer: 'Gate the patch with findings by severity, changed-file evidence, verification evidence, and a pass/fail or pass-with-risk verdict.',
    },
    requiredOutputs: [
      'Patch summary with changed files, behavior impact, and scope boundaries.',
      'Verification evidence with exact commands, manual checks, or explicit gaps.',
      'Review verdict covering blockers, residual risk, and next actions.',
    ],
    qualityRubric: [
      'Implementation stays tightly scoped to the requested behavior and existing architecture.',
      'Changed files and important symbols are named precisely enough for downstream review.',
      'Verification is proportional to the touched path and records failures or skipped checks honestly.',
      'Final output separates completed work from remaining risk instead of claiming broad release confidence.',
    ],
  },
  Delivery: {
    focus: 'Coordinated feature or fix delivery across implementation, validation, risk review, and user handoff.',
    laneGuidance: {
      coordinator: 'Translate the objective into delivery lanes, acceptance criteria, ownership, dependencies, and the final handoff expectations.',
      builder: 'Implement the requested delivery increment, keep changes cohesive, document important decisions, and avoid unrelated refactors.',
      tester: 'Validate acceptance criteria with concrete commands or manual workflows, including regression-relevant checks and skipped-scope notes.',
      security: 'Review delivery-sensitive trust boundaries, data flows, permissions, dependencies, and operational risks before signoff.',
      reviewer: 'Synthesize build, test, and security evidence into a delivery verdict with blockers, residual risks, and handoff notes.',
    },
    requiredOutputs: [
      'Delivery summary tied to acceptance criteria and changed files or artifacts.',
      'Validation evidence covering tests, smoke checks, or manual workflow proof.',
      'Handoff notes with run commands, residual risks, and follow-up actions.',
    ],
    qualityRubric: [
      'Acceptance criteria are explicit and traceable to implementation evidence.',
      'Parallel lanes add independent value instead of duplicating the same build summary.',
      'Validation covers the user-visible or integration behavior most likely to regress.',
      'The final handoff is concise, operational, and clear about what is ready versus still risky.',
    ],
  },
  'Research Scout': {
    focus: 'Unknown reduction and recommendation synthesis.',
    laneGuidance: {
      coordinator: 'Define independent research lanes, expected evidence, and the synthesis criteria before fan-out.',
      scout: 'Map current implementation, quote concrete paths or symbols, and distinguish facts from inference.',
      tester: 'Probe reproduction or validation strategy without editing source unless explicitly assigned.',
      security: 'Identify trust, data, dependency, and permission risks that affect the recommendation.',
      reviewer: 'Merge findings into one recommendation, call out confidence, gaps, and next actions.',
    },
    requiredOutputs: [
      'Key findings with file/path evidence or external-source citations when browsing was required.',
      'Decision-ready recommendation with confidence and remaining unknowns.',
      'Validation notes: what was checked, what was not checked, and why.',
    ],
    qualityRubric: [
      'Findings are grounded in current workspace evidence, not stale roadmap text.',
      'Parallel lanes do not duplicate the same question.',
      'Recommendations explain tradeoffs and preserve uncertainty instead of overclaiming.',
      'The final synthesis is concise enough for a builder or planner to act on immediately.',
    ],
  },
  'Architecture Plan': {
    focus: 'Implementation planning and ownership.',
    laneGuidance: {
      scout: 'Identify current architecture, subsystem ownership, conventions, and risky boundaries.',
      coordinator: 'Create a sequenced plan with file ownership, dependencies, acceptance criteria, and verification commands.',
      builder: 'Stress-test the plan for implementation feasibility; do not start broad implementation unless assigned.',
      tester: 'Define the smallest meaningful verification set and fixture needs.',
      security: 'Review the proposed plan for auth, data, secret, injection, and permission risks.',
      reviewer: 'Gate the plan for completeness, proportional testing, and architectural consistency.',
    },
    requiredOutputs: [
      'File/module ownership map with write boundaries.',
      'Step-by-step implementation sequence with dependencies.',
      'Verification plan tied to package scripts or concrete commands.',
      'Risks, non-goals, and assumptions that could change the plan.',
    ],
    qualityRubric: [
      'Plan follows existing architecture boundaries and does not bypass canonical owners.',
      'Tasks are small enough to assign and verify independently.',
      'Testing scope matches the blast radius.',
      'Open questions are explicit rather than hidden inside implementation steps.',
    ],
  },
  'Code Review': {
    focus: 'Bug, risk, and regression discovery.',
    laneGuidance: {
      coordinator: 'Declare review scope, split independent review lanes, and prevent duplicate coverage.',
      scout: 'Summarize relevant code paths and recent changes that reviewers must inspect.',
      tester: 'Run or propose focused verification and report exact commands, results, and gaps.',
      security: 'Audit exploitable surfaces and calibrate severity with a plausible attack path.',
      builder: 'Scope minor fixes only when review evidence shows a low-risk correction.',
      reviewer: 'Lead with findings by severity, include file/line evidence, and give a clear pass/fail verdict.',
    },
    requiredOutputs: [
      'Findings ordered by severity with file/line references.',
      'Test evidence or explicit test gaps.',
      'Security and regression risk notes when in scope.',
      'Final verdict: pass, fail, or pass with residual risk.',
    ],
    qualityRubric: [
      'Findings are actionable and reproducible.',
      'No generic style commentary displaces correctness or risk issues.',
      'Severity is calibrated to concrete impact and likelihood.',
      'A no-finding verdict still names inspected scope and remaining test gaps.',
    ],
  },
  'Regression Sweep': {
    focus: 'Release confidence through fast, targeted verification.',
    laneGuidance: {
      coordinator: 'Define the verification matrix, split smoke, regression, UI, security, and fix-probe lanes, and name the release gate.',
      tester: 'Run or specify concrete commands, capture pass/fail output, isolate regressions, and report exact untested scope.',
      builder: 'Investigate failing checks only far enough to identify likely fix scope; avoid unrelated implementation.',
      security: 'Check security-sensitive regression surfaces and dependency or permission changes that affect release risk.',
      interaction_qa: 'Verify visible behavior, navigation, responsiveness, and state handling with concrete viewport or interaction evidence.',
      accessibility_reviewer: 'Check keyboard flow, focus visibility, semantic labels, contrast, and reduced-motion or screen-reader risks.',
      reviewer: 'Synthesize test evidence into a release verdict with blockers, flakes, gaps, and next verification steps.',
    },
    requiredOutputs: [
      'Verification matrix listing checks run, commands or manual steps, and pass/fail results.',
      'Regression findings with exact files, behaviors, logs, screenshots, or command evidence.',
      'Release verdict that separates blockers, non-blocking risks, flakes, and untested scope.',
    ],
    qualityRubric: [
      'Every claimed pass names the command, viewport, file, or behavior that proved it.',
      'Failures include enough reproduction detail for a builder to act without rerunning broad discovery.',
      'Verification scope matches the preset lane and does not collapse into a generic summary.',
      'The final verdict is fast to consume and does not hide untested risk.',
    ],
  },
  'Security Review': {
    focus: 'Threat discovery, exploitability validation, and remediation confidence.',
    laneGuidance: {
      coordinator: 'Split work by trust boundary, auth/authz, data flow, dependencies, tests, fix scope, and final signoff.',
      scout: 'Map reachable entry points, sensitive data paths, configuration, and recent changes that define the attack surface.',
      security: 'Trace plausible source-to-sink attack paths, calibrate severity, and distinguish theoretical risk from exploitable behavior.',
      tester: 'Create or describe focused exploit, regression, or permission checks that validate the security claim.',
      builder: 'Patch or scope low-risk fixes only when evidence identifies the vulnerable code and expected safe behavior.',
      reviewer: 'Gate the security decision with severity, exploit preconditions, evidence, remediation status, and residual risk.',
    },
    requiredOutputs: [
      'Threat model or attack-surface map with concrete entry points, assets, and trust boundaries.',
      'Validated findings or explicit no-finding evidence with severity and exploit preconditions.',
      'Remediation or acceptance plan with verification commands and residual risk.',
    ],
    qualityRubric: [
      'Severity is tied to realistic impact, reachability, and attacker capability.',
      'Findings include concrete paths, symbols, inputs, or dependency names rather than broad concern categories.',
      'Fix guidance preserves existing architecture boundaries and avoids speculative rewrites.',
      'A clean result still states inspected surfaces and what was not validated.',
    ],
  },
  'Docs Refresh': {
    focus: 'Concise documentation updates grounded in current behavior.',
    laneGuidance: {
      coordinator: 'Define documentation ownership, stale sources, target readers, update order, and verification commands.',
      scout: 'Compare existing docs against current code, package scripts, architecture, and user-facing behavior.',
      builder: 'Write concise doc updates that replace obsolete guidance with current, actionable instructions.',
      tester: 'Verify documented commands, links, paths, examples, and setup steps where practical.',
      reviewer: 'Review docs for accuracy, scope control, reader usefulness, and absence of stale roadmap claims.',
    },
    requiredOutputs: [
      'Documentation change summary with files updated and source evidence used.',
      'Verified commands, links, paths, examples, or explicit gaps for anything not checked.',
      'Reader-focused final note covering current behavior, remaining stale areas, and next doc work.',
    ],
    qualityRubric: [
      'Docs prefer current code and package scripts over stale roadmap or historical notes.',
      'Changes are concise and replace obsolete text instead of preserving contradictory explanations.',
      'Verification evidence covers the docs most likely to mislead future agents or users.',
      'Final output names remaining doc risk without expanding scope into unrelated cleanup.',
    ],
  },
};

const PRESET_TO_FRAMEWORK = {
  rapid_patch: { mode: 'build', subMode: 'Patch / Build' },
  scout_build_review: { mode: 'build', subMode: 'Patch / Build' },
  patch_build_expanded: { mode: 'build', subMode: 'Patch / Build' },
  delivery_small: { mode: 'build', subMode: 'Delivery' },
  delivery_standard: { mode: 'build', subMode: 'Delivery' },
  parallel_delivery: { mode: 'build', subMode: 'Delivery' },
  research_scout_small: { mode: 'research', subMode: 'Research Scout' },
  research_scout_standard: { mode: 'research', subMode: 'Research Scout' },
  research_scout_expanded: { mode: 'research', subMode: 'Research Scout' },
  architecture_plan_small: { mode: 'plan', subMode: 'Architecture Plan' },
  architecture_plan_standard: { mode: 'plan', subMode: 'Architecture Plan' },
  architecture_plan_expanded: { mode: 'plan', subMode: 'Architecture Plan' },
  code_review_small: { mode: 'review', subMode: 'Code Review' },
  code_review_standard: { mode: 'review', subMode: 'Code Review' },
  code_review_expanded: { mode: 'review', subMode: 'Code Review' },
  regression_sweep_small: { mode: 'verify', subMode: 'Regression Sweep' },
  regression_sweep_standard: { mode: 'verify', subMode: 'Regression Sweep' },
  regression_sweep_expanded: { mode: 'verify', subMode: 'Regression Sweep' },
  security_review_small: { mode: 'secure', subMode: 'Security Review' },
  security_review_standard: { mode: 'secure', subMode: 'Security Review' },
  security_review_expanded: { mode: 'secure', subMode: 'Security Review' },
  docs_refresh_small: { mode: 'document', subMode: 'Docs Refresh' },
  docs_refresh_standard: { mode: 'document', subMode: 'Docs Refresh' },
  docs_refresh_expanded: { mode: 'document', subMode: 'Docs Refresh' },
};

export const WORKFLOW_PRESET_FRAMEWORK_MODES = MODE_CONFIGS;
export const WORKFLOW_PRESET_FRAMEWORK_SUB_MODES = SUB_MODE_FRAMEWORKS;
export const WORKFLOW_PRESET_FRAMEWORK_PRESETS = PRESET_TO_FRAMEWORK;

export function resolveWorkflowPresetFrameworkKey({ presetId, mode, subMode } = {}) {
  if (presetId && PRESET_TO_FRAMEWORK[presetId]) return PRESET_TO_FRAMEWORK[presetId];
  if (mode && subMode && MODE_CONFIGS[mode] && SUB_MODE_FRAMEWORKS[subMode]) return { mode, subMode };
  return null;
}

export function buildWorkflowPresetFramework({ presetId, mode, subMode } = {}) {
  const key = resolveWorkflowPresetFrameworkKey({ presetId, mode, subMode });
  if (!key) return null;
  const modeConfig = MODE_CONFIGS[key.mode];
  const subModeConfig = SUB_MODE_FRAMEWORKS[key.subMode];
  if (!modeConfig || !subModeConfig) return null;

  return {
    version: '2026-05-21',
    presetId: presetId ?? null,
    mode: key.mode,
    modeConfig,
    subMode: key.subMode,
    framework: subModeConfig,
    sharedWorkflow: [
      'Call get_task_details first and treat the returned presetFramework as binding role context.',
      'Read only the workspace files and context needed for the lane; record durable summaries in workspace context or downstreamPayload.',
      'Keep role outputs concise, evidence-backed, and directly useful to legal downstream nodes.',
      'Complete with outcome success only when required outputs and rubric checks are satisfied.',
    ],
    completionContract: {
      successRequires: subModeConfig.requiredOutputs,
      downstreamPayloadShape: {
        summary: 'Short role-specific result.',
        evidence: ['Relevant paths, commands, artifacts, or inspected sources.'],
        keyFindings: ['Concrete facts, risks, decisions, or review findings.'],
        gaps: ['Known unverified scope or open questions.'],
        nextActions: ['Only actions downstream roles should actually take.'],
      },
    },
  };
}

export function buildWorkflowPresetToolHints(framework) {
  if (!framework) return null;
  return {
    exactTools: [
      'get_task_details',
      'read_inbox',
      'get_workspace_context',
      'update_workspace_context',
      'request_file_lock',
      'release_file_lock',
      'write_artifact',
      'complete_task',
    ],
    workspaceContextKeys: {
      research: ['researchFindings', 'architecture', 'riskNotes'],
      build: ['buildDelivery', 'plan', 'testEvidence', 'reviewFindings', 'releaseRisk'],
      plan: ['architecture', 'plan', 'testPlan', 'securityReview'],
      review: ['reviewScope', 'reviewFindings', 'testEvidence', 'securityReview'],
      verify: ['verificationPlan', 'testEvidence', 'reviewFindings', 'releaseRisk'],
      secure: ['securityReview', 'threatModel', 'testEvidence', 'riskNotes'],
      document: ['docsRefresh', 'architecture', 'testEvidence', 'reviewFindings'],
    }[framework.mode] ?? [],
    outputBudget: 'Prefer 5-12 high-signal bullets in completion payloads; use artifacts only for durable user-facing summaries.',
    validationPolicy: 'Before success completion, check requiredOutputs and qualityRubric from presetFramework.',
  };
}

export function evaluateWorkflowPresetOutput({ presetId, mode, subMode, output = {} } = {}) {
  const framework = buildWorkflowPresetFramework({ presetId, mode, subMode });
  if (!framework) {
    return {
      status: 'unsupported',
      missing: ['Known workflow preset framework.'],
      nextActions: ['Use a supported build, research, plan, review, verify, secure, or document preset id.'],
    };
  }

  const text = typeof output === 'string' ? output : JSON.stringify(output ?? {});
  const normalized = text.toLowerCase();
  const missing = [];

  for (const requirement of framework.completionContract.successRequires) {
    const terms = requirement.toLowerCase().split(/[^a-z0-9/.-]+/).filter(word => word.length > 3);
    if (!terms.some(term => normalized.includes(term))) missing.push(requirement);
  }

  if (!/(evidence|inspected|checked|path|file|command|test|risk|finding)/i.test(text)) {
    missing.push('Evidence inspected or validation performed.');
  }

  return {
    status: missing.length === 0 ? 'ready' : 'needs_work',
    mode: framework.mode,
    subMode: framework.subMode,
    missing,
    nextActions: missing.length === 0
      ? ['Complete with concise downstreamPayload and explicit outcome.']
      : ['Patch the completion payload or workspace context before reporting success.'],
  };
}
