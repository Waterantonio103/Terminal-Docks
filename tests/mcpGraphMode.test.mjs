import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'starlink-mcp-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';

const { db } = await import('../mcp-server/src/db/index.mjs');
const { buildTaskDetails, ackAndEmitTaskFetch } = await import('../mcp-server/src/tools/task-details.mjs');
const { executeHandoffTask, executeCompleteTask } = await import('../mcp-server/src/tools/handoff-complete.mjs');
const { executeGetCurrentTask, executeGetTaskDetails, executeRecordProgress } = await import('../mcp-server/src/tools/tasks.mjs');
const { registerArtifactTools } = await import('../mcp-server/src/tools/artifacts.mjs');
const { registerWorkspaceTools } = await import('../mcp-server/src/tools/workspace.mjs');
const {
  validateGraphHandoff,
  executeReceiveMessages,
  executeRegisterWorkerCapabilities,
  executeAssignTaskByRequirements,
  seedConnectedSession,
  seedFileLock,
  appendAdaptivePatch,
  resetStarlinkState,
  seedCompiledMission,
  seedMissionNodeRuntime,
  seedAgentRuntimeSession,
  getBroadcastHistory,
} = await import('../mcp-server/src/utils/test-helpers.mjs');

function demoMission() {
  return {
    missionId: 'mission-graph',
    graphId: 'graph-graph',
    task: {
      nodeId: 'task-1',
      prompt: 'Route handoffs to the correct downstream node',
      mode: 'build',
      workspaceDir: 'C:/workspace',
    },
    metadata: {
      compiledAt: 1,
      sourceGraphId: 'graph-graph',
      startNodeIds: ['builder'],
      executionLayers: [['builder'], ['reviewer-a', 'reviewer-b']],
      authoringMode: 'graph',
      presetId: null,
      runVersion: 1,
    },
    nodes: [
      {
        id: 'builder',
        roleId: 'builder',
        instructionOverride: '',
        terminal: {
          terminalId: 'term-builder',
          terminalTitle: 'Builder',
          cli: 'claude',
          paneId: 'pane-builder',
          reusedExisting: true,
        },
      },
      {
        id: 'reviewer-a',
        roleId: 'reviewer',
        instructionOverride: '',
        terminal: {
          terminalId: 'term-reviewer-a',
          terminalTitle: 'Reviewer A',
          cli: 'claude',
          paneId: 'pane-reviewer-a',
          reusedExisting: true,
        },
      },
      {
        id: 'reviewer-b',
        roleId: 'reviewer',
        instructionOverride: '',
        terminal: {
          terminalId: 'term-reviewer-b',
          terminalTitle: 'Reviewer B',
          cli: 'claude',
          paneId: 'pane-reviewer-b',
          reusedExisting: true,
        },
      },
    ],
    edges: [
      {
        id: 'edge:builder:always:reviewer-a',
        fromNodeId: 'builder',
        toNodeId: 'reviewer-a',
        condition: 'always',
      },
      {
        id: 'edge:builder:always:reviewer-b',
        fromNodeId: 'builder',
        toNodeId: 'reviewer-b',
        condition: 'always',
      },
    ],
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function extractTaskIdFromHandoffResult(result) {
  const text = result?.content?.[0]?.text ?? '';
  try {
    const payload = JSON.parse(text);
    if (payload.taskId) return payload.taskId;
  } catch {}
  const match = text.match(/task\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

try {
  await run('get_task_details exposes exact legal same-role targets', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'dispatched',
    });

    const details = buildTaskDetails('mission-graph', 'builder');
    assert.ok(details);
    assert.deepEqual(
      details.legalNextTargets.map(target => target.targetNodeId),
      ['reviewer-a', 'reviewer-b'],
    );
    assert.ok(details.legalNextTargets.every(target => target.targetRoleId === 'reviewer'));
    assert.equal(details.node.status, 'running');
    assert.equal(details.node.attempt, 1);
    assert.equal(details.completionContract.requiredTool, 'complete_task');
    assert.match(details.completionContract.note, /Natural-language final answers do not complete/);
    assert.equal(details.progressReportingContract.requiredTool, 'record_progress');
    assert.equal(details.progressReportingContract.eventShape.nodeId, 'builder');
  });

  await run('record_progress persists a structured workflow event and rejects unknown node ids', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    const invalid = executeRecordProgress({
      missionId: 'mission-graph',
      nodeId: 'reviewer',
      status: 'progress',
      title: 'Wrong node id',
    }, 'session-progress');
    assert.equal(invalid.isError, true);

    const result = executeRecordProgress({
      missionId: 'mission-graph',
      nodeId: 'builder',
      status: 'progress',
      title: 'Inspecting inputs',
      detail: 'Task details loaded and implementation path selected.',
      filePaths: ['src/App.tsx'],
      percentHint: 40,
    }, 'session-progress');
    assert.match(result.content[0].text, /Progress recorded/);

    const row = db.prepare('SELECT * FROM workflow_events WHERE mission_id = ? AND type = ?').get('mission-graph', 'agent_progress');
    assert.equal(row.node_id, 'builder');
    assert.equal(row.session_id, 'session-progress');
    const payload = JSON.parse(row.payload_json);
    assert.equal(payload.status, 'progress');
    assert.deepEqual(payload.filePaths, ['src/App.tsx']);
  });

  await run('get_task_details includes frontend framework for strict UI missions', async () => {
    resetStarlinkState();
    const mission = demoMission();
    mission.metadata.frontendMode = 'strict_ui';
    mission.metadata.frontendCategory = 'admin_internal_tool';
    mission.metadata.specProfile = 'frontend_three_file';
    seedCompiledMission(mission);
    db.prepare(
      'INSERT INTO workspace_context (mission_id, key, value, updated_by) VALUES (?, ?, ?, ?)'
    ).run('mission-graph', 'frontendSpecs', JSON.stringify({ acceptedProduct: 'PRD.md' }), 'frontend_product');
    db.prepare(
      'INSERT INTO workspace_context (mission_id, key, value, updated_by) VALUES (?, ?, ?, ?)'
    ).run('other-mission', 'architecture', JSON.stringify({ stale: true }), 'old_agent');
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });

    const details = buildTaskDetails('mission-graph', 'builder');
    assert.equal(details.frontendMode, 'strict_ui');
    assert.equal(details.specProfile, 'frontend_three_file');
    assert.equal(details.frontendFramework.categoryId, 'admin_internal_tool');
    assert.deepEqual(details.frontendFramework.modeConfig.durableArtifacts, ['PRD.md', 'DESIGN.md', 'structure.md', 'README.md']);
    assert.ok(details.frontendFramework.schemas['PRD.md'].requiredSections.includes('Target Users'));
    assert.equal(details.assignment.frontendFramework.categoryId, 'admin_internal_tool');
    assert.ok(details.frontendToolHints.exactTools.includes('update_workspace_context'));
    assert.equal(details.frontendToolHints.outputBudgets['DESIGN.md'], '110-170 lines');
    assert.equal(details.assignment.frontendToolHints.validationPolicy, 'Validate once after writing required spec files; if accepted, do not re-run the same full-text validation.');
    assert.equal(details.workspaceContext.frontendSpecs.value.acceptedProduct, 'PRD.md');
    assert.equal(details.assignment.workspaceContext.frontendSpecs.updatedBy, 'frontend_product');
    assert.equal(details.workspaceContext.architecture, undefined);
  });

  await run('get_task_details includes preset framework for all framework-backed presets', async () => {
    const cases = [
      ['patch_build_expanded', 'build', 'Patch / Build', 'Patch summary', 'block_on_missing_build_evidence'],
      ['parallel_delivery', 'build', 'Delivery', 'Delivery summary', 'block_on_missing_build_evidence'],
      ['research_scout_expanded', 'research', 'Research Scout', 'Key findings', 'block_on_missing_evidence'],
      ['architecture_plan_expanded', 'plan', 'Architecture Plan', 'File/module ownership map', 'block_on_missing_plan'],
      ['code_review_expanded', 'review', 'Code Review', 'Findings ordered by severity', 'block_on_missing_verdict'],
      ['regression_sweep_expanded', 'verify', 'Regression Sweep', 'Verification matrix', 'block_on_missing_verification'],
      ['security_review_expanded', 'secure', 'Security Review', 'Threat model', 'block_on_missing_security_evidence'],
      ['docs_refresh_expanded', 'document', 'Docs Refresh', 'Documentation change summary', 'block_on_missing_doc_evidence'],
    ];

    for (const [presetId, mode, subMode, requiredOutput, gateLevel] of cases) {
      resetStarlinkState();
      const mission = demoMission();
      mission.metadata.authoringMode = 'preset';
      mission.metadata.presetId = presetId;
      mission.nodes[0].roleId = 'coordinator';
      seedCompiledMission(mission);
      seedMissionNodeRuntime({
        missionId: 'mission-graph',
        nodeId: 'builder',
        roleId: 'coordinator',
        status: 'running',
        attempt: 1,
        currentWaveId: 'root:mission-graph',
      });
      seedAgentRuntimeSession({
        sessionId: 'session:mission-graph:builder:1',
        agentId: 'agent:mission-graph:builder:term-builder',
        missionId: 'mission-graph',
        nodeId: 'builder',
        attempt: 1,
        terminalId: 'term-builder',
        status: 'running',
      });

      const details = buildTaskDetails('mission-graph', 'builder');
      assert.equal(details.presetFramework.mode, mode, `${presetId}: framework mode`);
      assert.equal(details.presetFramework.subMode, subMode, `${presetId}: framework sub-mode`);
      assert.ok(details.presetFramework.framework.requiredOutputs.some(item => item.includes(requiredOutput)), `${presetId}: required output`);
      assert.ok(details.presetToolHints.exactTools.includes('update_workspace_context'), `${presetId}: tool hints`);
      assert.ok(details.node.instructionOverride.includes(`Preset framework: ${mode} / ${subMode}`), `${presetId}: instruction override`);
      assert.equal(details.assignment.presetFramework.modeConfig.gateLevel, gateLevel, `${presetId}: gate level`);
    }
  });

  await run('submit_summary persists an artifact without server.callTool support', async () => {
    resetStarlinkState();
    const tools = new Map();
    registerArtifactTools({
      registerTool(name, _config, handler) {
        tools.set(name, handler);
      },
    }, () => 'session-summary');

    const result = await tools.get('submit_summary')({
      missionId: 'mission-graph',
      nodeId: 'builder',
      summary: 'Progress is recorded.',
      isFinal: true,
    });
    assert.equal(result.isError, undefined);

    const row = db.prepare(
      "SELECT kind, title, content_text FROM artifacts WHERE mission_id = ? AND node_id = ?"
    ).get('mission-graph', 'builder');
    assert.equal(row.kind, 'summary');
    assert.equal(row.title, 'Final Summary');
    assert.equal(row.content_text, 'Progress is recorded.');
  });

  await run('workspace context tools scope rows to the caller mission', async () => {
    resetStarlinkState();
    seedConnectedSession('session-a', {
      runtimeSessionId: 'session-a',
      missionId: 'mission-a',
      nodeId: 'node-a',
    });
    seedConnectedSession('session-b', {
      runtimeSessionId: 'session-b',
      missionId: 'mission-b',
      nodeId: 'node-b',
    });
    const tools = new Map();
    let callerSessionId = 'session-a';
    registerWorkspaceTools({
      registerTool(name, _config, handler) {
        tools.set(name, handler);
      },
    }, () => callerSessionId);

    await tools.get('update_workspace_context')({
      key: 'frontendSpecs',
      value: { product: 'A' },
      updatedBy: 'node-a',
    });
    callerSessionId = 'session-b';
    await tools.get('update_workspace_context')({
      key: 'frontendSpecs',
      value: { product: 'B' },
      updatedBy: 'node-b',
    });

    const scopedA = JSON.parse((await tools.get('get_workspace_context')({ missionId: 'mission-a' })).content[0].text);
    const scopedB = JSON.parse((await tools.get('get_workspace_context')({ missionId: 'mission-b' })).content[0].text);
    assert.equal(scopedA.frontendSpecs.value.product, 'A');
    assert.equal(scopedA.frontendSpecs.missionId, 'mission-a');
    assert.equal(scopedB.frontendSpecs.value.product, 'B');
    assert.equal(scopedB.frontendSpecs.missionId, 'mission-b');
  });

  await run('get_task_details exposes theme picker direction only for App/Site presets', async () => {
    resetStarlinkState();
    const mission = demoMission();
    mission.metadata.presetId = 'frontend_ui_delivery';
    mission.metadata.frontendMode = 'strict_ui';
    mission.metadata.specProfile = 'frontend_three_file';
    mission.metadata.frontendDirection = {
      kind: 'app_site_frontend_direction',
      version: 1,
      layout: 'dashboard',
      density: 'compact',
      palette: {
        kind: 'custom',
        id: 'custom_palette',
        label: 'Custom palette',
        colors: ['#2563EB', '#14B8A6', '#F97316'],
      },
      shape: 'slightly_rounded',
      effects: ['subtle_hover_motion'],
      assets: 'data_visualization',
      interaction: ['filtering_and_search'],
      tone: 'technical',
      delegatedSections: [],
      summary: 'Layout: Dashboard; Density: Compact; Palette: Custom palette (#2563EB, #14B8A6, #F97316)',
      agentGuidance: {
        do: ['Use a dense app-shell layout.'],
        avoid: ['Do not create a marketing landing page.'],
      },
      preview: {
        label: 'Dashboard low-fidelity preview',
        note: 'Preview is secondary only.',
        lowFidelity: true,
        nonAuthoritative: true,
      },
    };
    seedCompiledMission(mission);
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });

    const details = buildTaskDetails('mission-graph', 'builder');
    assert.equal(details.frontendDirection.layout, 'dashboard');
    assert.deepEqual(details.assignment.frontendDirection.palette.colors, ['#2563EB', '#14B8A6', '#F97316']);
    assert.deepEqual(details.frontendDirection.delegatedSections, []);
    assert.match(details.assignment.roleInstructions, /App\/Site theme picker direction/);
    assert.equal(details.frontendDirectionReview.flagDelegatedWithoutReason, true);

    const nonAppMission = demoMission();
    nonAppMission.metadata.presetId = 'rapid_patch';
    nonAppMission.metadata.frontendDirection = mission.metadata.frontendDirection;
    seedCompiledMission(nonAppMission);
    const nonAppDetails = buildTaskDetails('mission-graph', 'builder');
    assert.equal(nonAppDetails.frontendDirection, null);
    assert.equal(nonAppDetails.assignment.frontendDirection, null);
    assert.doesNotMatch(nonAppDetails.assignment.roleInstructions, /App\/Site theme picker direction/);
  });

  await run('get_task_details includes final README guidance only for selected owner', async () => {
    resetStarlinkState();
    const mission = demoMission();
    mission.metadata.presetId = 'frontend_ui_delivery';
    mission.metadata.finalReadmeEnabled = true;
    mission.metadata.finalReadmeOwnerNodeId = 'reviewer-a';
    mission.task.finalReadmeEnabled = true;
    mission.task.finalReadmeOwnerNodeId = 'reviewer-a';
    seedCompiledMission(mission);
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'reviewer-a',
      roleId: 'reviewer',
      status: 'running',
      attempt: 1,
      currentWaveId: 'wave:review',
    });
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'reviewer-b',
      roleId: 'reviewer',
      status: 'running',
      attempt: 1,
      currentWaveId: 'wave:review',
    });

    const ownerDetails = buildTaskDetails('mission-graph', 'reviewer-a');
    assert.equal(ownerDetails.finalReadmeEnabled, true);
    assert.equal(ownerDetails.finalReadmeOwnerNodeId, 'reviewer-a');
    assert.match(ownerDetails.assignment.roleInstructions, /Final README instruction/);
    assert.match(ownerDetails.node.instructionOverride, /create INSTRUCTIONS\.md instead/);

    const otherDetails = buildTaskDetails('mission-graph', 'reviewer-b');
    assert.equal(otherDetails.finalReadmeEnabled, true);
    assert.equal(otherDetails.finalReadmeOwnerNodeId, 'reviewer-a');
    assert.doesNotMatch(otherDetails.assignment.roleInstructions, /Final README instruction/);
    assert.doesNotMatch(otherDetails.node.instructionOverride, /Final README instruction/);
  });

  await run('get_current_task resolves the bound runtime session', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });

    const result = executeGetCurrentTask({ sessionId: 'session:mission-graph:builder:1' }, 'transport-session');
    assert.equal(result.isError, undefined);
    const details = JSON.parse(result.content[0].text);
    assert.equal(details.missionId, 'mission-graph');
    assert.equal(details.nodeId, 'builder');
    assert.equal(details.completionContract.requiredTool, 'complete_task');
  });

  await run('get_current_task always returns compact frontend framework', async () => {
    resetStarlinkState();
    const mission = demoMission();
    mission.metadata.frontendMode = 'strict_ui';
    mission.metadata.frontendCategory = 'marketing_site';
    mission.metadata.specProfile = 'frontend_three_file';
    mission.task.frontendFramework = {
      schemas: {
        'DESIGN.md': {
          canonicalTemplate: { frontmatter: { colors: { primary: 'Exact hex' } } },
        },
      },
    };
    seedCompiledMission(mission);
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });

    const result = executeGetCurrentTask({
      sessionId: 'session:mission-graph:builder:1',
      includeFullFramework: true,
    }, 'transport-session');
    const details = JSON.parse(result.content[0].text);
    assert.equal(details.frontendFramework.schemas['DESIGN.md'].outputBudget, '110-170 concise lines for generated App/Site handoffs.');
    assert.equal(details.frontendFramework.schemas['DESIGN.md'].canonicalTemplate, undefined);
    assert.equal(details.task.frontendFramework.schemas['DESIGN.md'].canonicalTemplate, undefined);
    assert.equal(details.recentTasks, undefined);
    assert.equal(details.relevantEvents, undefined);
  });

  await run('get_task_details tool defaults to compact frontend framework', async () => {
    resetStarlinkState();
    const mission = demoMission();
    mission.metadata.frontendMode = 'strict_ui';
    mission.metadata.frontendCategory = 'marketing_site';
    mission.metadata.specProfile = 'frontend_three_file';
    seedCompiledMission(mission);
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });

    const compact = JSON.parse(executeGetTaskDetails({
      missionId: 'mission-graph',
      nodeId: 'builder',
    }, 'transport-session').content[0].text);
    assert.equal(compact.frontendFramework.schemas['DESIGN.md'].canonicalTemplate, undefined);
    assert.equal(compact.relevantEvents, undefined);

    const full = JSON.parse(executeGetTaskDetails({
      missionId: 'mission-graph',
      nodeId: 'builder',
      includeFullFramework: true,
    }, 'transport-session').content[0].text);
    assert.ok(full.frontendFramework.schemas['DESIGN.md'].canonicalTemplate);
  });

  await run('get_task_details ack persists activation state', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'ready',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'ready',
    });

    const details = buildTaskDetails('mission-graph', 'builder');
    assert.ok(details);
    ackAndEmitTaskFetch(details, 'transport-session');

    const sessionRow = db.prepare(
      'SELECT status FROM agent_runtime_sessions WHERE session_id = ?',
    ).get('session:mission-graph:builder:1');
    const nodeRow = db.prepare(
      'SELECT status FROM mission_node_runtime WHERE mission_id = ? AND node_id = ?',
    ).get('mission-graph', 'builder');
    assert.equal(sessionRow.status, 'activation_acked');
    assert.equal(nodeRow.status, 'activation_acked');
  });

  await run('validateGraphHandoff rejects off-graph routes and bad outcomes', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'dispatched',
    });

    const illegalTarget = validateGraphHandoff({
      missionId: 'mission-graph',
      fromNodeId: 'builder',
      fromAttempt: 1,
      targetNodeId: 'missing-node',
      outcome: 'success',
    });
    assert.match(illegalTarget.error, /Target node missing-node is not part of mission/);

    const illegalOutcome = validateGraphHandoff({
      missionId: 'mission-graph',
      fromNodeId: 'builder',
      fromAttempt: 1,
      targetNodeId: 'reviewer-a',
      outcome: 'maybe',
    });
    assert.match(illegalOutcome.error, /Invalid outcome/);
  });

  await run('handoff_task rejects stale fromAttempt values', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 2,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:2',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 2,
      terminalId: 'term-builder',
      status: 'dispatched',
    });

    const staleAttempt = executeHandoffTask({
      missionId: 'mission-graph',
      fromNodeId: 'builder',
      fromAttempt: 1,
      targetNodeId: 'reviewer-a',
      outcome: 'success',
      title: 'stale handoff',
    }, 'builder-session');

    assert.equal(staleAttempt.isError, true);
    assert.match(staleAttempt.content[0].text, /Stale handoff attempt/);
  });

  await run('handoff_task persists the chosen target node deterministically', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'dispatched',
    });

    const result = executeHandoffTask({
      missionId: 'mission-graph',
      fromNodeId: 'builder',
      fromAttempt: 1,
      targetNodeId: 'reviewer-b',
      outcome: 'success',
      title: 'Send to the second reviewer',
      payload: { files: ['src/lib/buildPrompt.ts'], verdict: 'ready' },
    }, 'builder-session');

    assert.equal(result.isError, undefined);

    const targetDetails = buildTaskDetails('mission-graph', 'reviewer-b');
    assert.ok(targetDetails.latestTask);
    assert.equal(targetDetails.latestTask.node_id, 'reviewer-b');
    assert.equal(targetDetails.latestTask.agent_id, 'reviewer');

    const otherTargetDetails = buildTaskDetails('mission-graph', 'reviewer-a');
    assert.equal(otherTargetDetails.latestTask, null);

    const inbox = executeReceiveMessages({
      missionId: 'mission-graph',
      nodeId: 'reviewer-b',
      afterSeq: 0,
    }, 'reviewer-session');
    const inboxPayload = JSON.parse(inbox.content[0].text);
    assert.equal(inboxPayload.missionId, 'mission-graph');
    assert.equal(inboxPayload.nodeId, 'reviewer-b');
    assert.equal(inboxPayload.messages.length, 1);
    assert.match(inboxPayload.messages[0].content, /Send to the second reviewer/);
    assert.match(inboxPayload.messages[0].content, /"targetNodeId":"reviewer-b"/);

    const noInbox = executeReceiveMessages({
      missionId: 'mission-graph',
      nodeId: 'reviewer-a',
      afterSeq: 0,
    }, 'reviewer-a-session');
    const noInboxPayload = JSON.parse(noInbox.content[0].text);
    assert.equal(noInboxPayload.messages.length, 0);

    const broadcasts = getBroadcastHistory();
    assert.ok(broadcasts.some(message => message.type === 'handoff'));
    assert.ok(broadcasts.some(message => message.type === 'task_update'));
  });

  await run('complete_task resolves all legal downstream graph targets', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });

    const result = executeCompleteTask({
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      outcome: 'success',
      title: 'Builder completed all work',
      summary: 'Implementation is ready for both reviewers.',
      filesChanged: ['src/lib/missionRuntime.ts'],
      downstreamPayload: { verdict: 'ready' },
    }, 'session:mission-graph:builder:1');

    assert.equal(result.isError, undefined);
    const payload = JSON.parse(result.content[0].text);
    assert.equal(payload.status, 'completed');
    assert.deepEqual(
      payload.routed.map(entry => entry.targetNodeId).sort(),
      ['reviewer-a', 'reviewer-b'],
    );

    const reviewerA = buildTaskDetails('mission-graph', 'reviewer-a');
    const reviewerB = buildTaskDetails('mission-graph', 'reviewer-b');
    assert.ok(reviewerA.latestTask);
    assert.ok(reviewerB.latestTask);
    assert.match(reviewerA.latestTask.payload, /Implementation is ready/);
    assert.match(reviewerB.latestTask.payload, /src\/lib\/missionRuntime\.ts/);

    const broadcasts = getBroadcastHistory();
    assert.equal(
      broadcasts.filter(message => message.type === 'handoff').length,
      2,
    );

    const runtimeRow = db.prepare(
      `SELECT status, ended_at, failure_reason
         FROM agent_runtime_sessions
        WHERE session_id = ?`,
    ).get('session:mission-graph:builder:1');
    assert.equal(runtimeRow.status, 'completed');
    assert.ok(runtimeRow.ended_at, 'complete_task should stamp runtime end time for run history');
    assert.equal(runtimeRow.failure_reason, null);
  });

  await run('strict UI complete_task rejects success without required durable output', async () => {
    resetStarlinkState();
    const workspace = mkdtempSync(join(tempRoot, 'strict-ui-workspace-'));
    const mission = demoMission();
    mission.task.workspaceDir = workspace;
    mission.metadata.presetId = 'app_site_expanded';
    mission.metadata.frontendMode = 'strict_ui';
    mission.metadata.specProfile = 'frontend_three_file';
    mission.nodes[0].id = 'frontend_product';
    mission.nodes[0].roleId = 'frontend_product';
    mission.nodes[1].id = 'frontend_designer';
    mission.nodes[1].roleId = 'frontend_designer';
    mission.nodes[2].id = 'frontend_architect';
    mission.nodes[2].roleId = 'frontend_architect';
    mission.edges = [{
      id: 'edge:frontend_product:on_success:frontend_designer',
      fromNodeId: 'frontend_product',
      toNodeId: 'frontend_designer',
      condition: 'on_success',
    }];
    seedCompiledMission(mission);
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'frontend_product',
      roleId: 'frontend_product',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:frontend_product:1',
      agentId: 'agent:mission-graph:frontend_product:term-builder',
      missionId: 'mission-graph',
      nodeId: 'frontend_product',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });

    const blocked = executeCompleteTask({
      missionId: 'mission-graph',
      nodeId: 'frontend_product',
      attempt: 1,
      outcome: 'success',
      summary: 'Product accepted.',
    }, 'session:mission-graph:frontend_product:1');
    assert.equal(blocked.isError, true);
    assert.match(blocked.content[0].text, /requires durable PRD\.md/);

    writeFileSync(join(workspace, 'PRD.md'), '# StarV PRD\n');
    const accepted = executeCompleteTask({
      missionId: 'mission-graph',
      nodeId: 'frontend_product',
      attempt: 1,
      outcome: 'success',
      summary: 'Product accepted.',
      filesChanged: ['PRD.md'],
    }, 'session:mission-graph:frontend_product:1');
    assert.equal(accepted.isError, undefined);
    assert.match(accepted.content[0].text, /completed/);
  });

  await run('handoff_task rejects graph-mode role-only handoffs', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });

    const result = executeHandoffTask({
      missionId: 'mission-graph',
      fromRole: 'builder',
      targetRole: 'reviewer',
      outcome: 'success',
      title: 'Legacy role-only handoff',
      completion: { status: 'success', summary: 'This should not complete a graph node.' },
    }, 'session:mission-graph:builder:1');

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /Graph handoff requires missionId, fromNodeId, fromAttempt/);
  });

  await run('handoff_task rejects graph-mode routing without targetNodeId', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });

    const result = executeHandoffTask({
      missionId: 'mission-graph',
      fromNodeId: 'builder',
      fromAttempt: 1,
      outcome: 'success',
      title: 'Ambiguous graph handoff',
      completion: { status: 'success', summary: 'This has more than one legal target.' },
    }, 'session:mission-graph:builder:1');

    assert.equal(result.isError, true);
    assert.match(result.content[0].text, /requires an exact targetNodeId/);
    assert.match(result.content[0].text, /reviewer-a/);
    assert.match(result.content[0].text, /reviewer-b/);
  });

  await run('complete_task heals active runtime status drift before routing', async () => {
    resetStarlinkState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'activation_acked',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });
    seedAgentRuntimeSession({
      sessionId: 'session:mission-graph:builder:1',
      agentId: 'agent:mission-graph:builder:term-builder',
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });

    const result = executeCompleteTask({
      missionId: 'mission-graph',
      nodeId: 'builder',
      attempt: 1,
      outcome: 'success',
      title: 'Builder completed after drift',
      summary: 'Runtime session stayed active while node status drifted.',
    }, 'session:mission-graph:builder:1');

    assert.equal(result.isError, undefined);
    assert.equal(JSON.parse(result.content[0].text).status, 'completed');
  });

  await run('assign_task_by_requirements picks the best available worker', async () => {
    resetStarlinkState();
    seedConnectedSession('worker-a', { role: 'builder' });
    seedConnectedSession('worker-b', { role: 'builder' });

    executeRegisterWorkerCapabilities({
      profileId: 'builder_profile',
      capabilities: [{ id: 'coding', level: 3 }],
      availability: 'available',
    }, 'worker-a');
    executeRegisterWorkerCapabilities({
      profileId: 'builder_profile',
      capabilities: [{ id: 'coding', level: 2 }, { id: 'testing', level: 3 }],
      availability: 'available',
    }, 'worker-b');

    const handoff = executeHandoffTask({
      fromRole: 'coordinator',
      targetRole: 'builder',
      title: 'Implement assignment policy',
      description: 'Create deterministic assignment scoring',
      payload: { fileScope: ['src/lib/graphCompiler.ts'] },
    }, 'coordinator-session');
    const taskId = extractTaskIdFromHandoffResult(handoff);
    assert.ok(taskId, 'handoff should create a task');

    const assignment = executeAssignTaskByRequirements({
      taskId,
      requiredCapabilities: ['coding'],
      preferredCapabilities: ['testing'],
      writeAccess: true,
      fileScope: ['src/lib/graphCompiler.ts'],
    }, 'coordinator-session');
    assert.equal(assignment.isError, undefined);

    const assignmentPayload = JSON.parse(assignment.content[0].text);
    assert.equal(assignmentPayload.status, 'assigned');
    assert.equal(assignmentPayload.targetSessionId, 'worker-b');

    const workerInbox = executeReceiveMessages({}, 'worker-b');
    assert.match(workerInbox.content[0].text, /\[ASSIGNED\] Task/);
    assert.match(workerInbox.content[0].text, /requiredCapabilities/);
  });

  await run('assign_task_by_requirements reports queued when write scope is contended', async () => {
    resetStarlinkState();
    seedConnectedSession('worker-c', { role: 'builder' });
    executeRegisterWorkerCapabilities({
      capabilities: [{ id: 'coding', level: 3 }],
      availability: 'available',
    }, 'worker-c');
    seedFileLock({
      filePath: 'src/components/Launcher/LauncherPane.tsx',
      agentId: 'mission:demo:node:other',
      sessionId: 'holder-session',
    });

    const handoff = executeHandoffTask({
      fromRole: 'coordinator',
      targetRole: 'builder',
      title: 'Refactor launcher',
      payload: { files: ['src/components/Launcher/LauncherPane.tsx'] },
    }, 'coordinator-session');
    const taskId = extractTaskIdFromHandoffResult(handoff);
    assert.ok(taskId, 'handoff should create a task');

    const queued = executeAssignTaskByRequirements({
      taskId,
      requiredCapabilities: ['coding'],
      fileScope: ['src/components/Launcher/LauncherPane.tsx'],
      writeAccess: true,
    }, 'coordinator-session');
    assert.equal(queued.isError, undefined);
    const queuedPayload = JSON.parse(queued.content[0].text);
    assert.equal(queuedPayload.status, 'queued');
    assert.equal(queuedPayload.reason, 'file_contention');
  });

  await run('assign_task_by_requirements can reassign by excluding the previous worker', async () => {
    resetStarlinkState();
    seedConnectedSession('worker-old', { role: 'builder' });
    seedConnectedSession('worker-new', { role: 'builder' });
    executeRegisterWorkerCapabilities({
      capabilities: [{ id: 'coding', level: 3 }],
      availability: 'available',
    }, 'worker-old');
    executeRegisterWorkerCapabilities({
      capabilities: [{ id: 'coding', level: 2 }],
      availability: 'available',
    }, 'worker-new');

    const handoff = executeHandoffTask({
      fromRole: 'coordinator',
      targetRole: 'builder',
      title: 'Retry task',
    }, 'coordinator-session');
    const taskId = extractTaskIdFromHandoffResult(handoff);
    assert.ok(taskId, 'handoff should create a task');

    const firstAssignment = executeAssignTaskByRequirements({
      taskId,
      requiredCapabilities: ['coding'],
      writeAccess: false,
    }, 'coordinator-session');
    const firstPayload = JSON.parse(firstAssignment.content[0].text);
    assert.equal(firstPayload.targetSessionId, 'worker-old');

    const reassignment = executeAssignTaskByRequirements({
      taskId,
      requiredCapabilities: ['coding'],
      excludeSessionIds: ['worker-old'],
      previousSessionId: 'worker-old',
      writeAccess: false,
    }, 'coordinator-session');
    const reassignmentPayload = JSON.parse(reassignment.content[0].text);
    assert.equal(reassignmentPayload.targetSessionId, 'worker-new');
  });

  await run('adaptive patch appends legal nodes and bumps runVersion', async () => {
    resetStarlinkState();
    seedCompiledMission({
      ...demoMission(),
      metadata: {
        ...demoMission().metadata,
        authoringMode: 'adaptive',
        runVersion: 1,
      },
    });

    const patchResult = appendAdaptivePatch({
      missionId: 'mission-graph',
      runVersion: 1,
      patch: {
        nodes: [{
          id: 'doc-node',
          roleId: 'builder',
          instructionOverride: 'write docs',
          terminal: {
            terminalId: 'term-doc',
            terminalTitle: 'Doc Node',
            cli: 'claude',
            paneId: 'pane-doc',
            reusedExisting: true,
          },
        }],
        edges: [{
          fromNodeId: 'reviewer-b',
          toNodeId: 'doc-node',
          condition: 'on_success',
        }],
      },
    });

    assert.equal(patchResult.error, undefined);
    assert.equal(patchResult.previousRunVersion, 1);
    assert.equal(patchResult.runVersion, 2);
    assert.ok(patchResult.appendedNodeIds.includes('doc-node'));

    const mission = buildTaskDetails('mission-graph', 'doc-node');
    assert.ok(mission, 'newly patched node should be queryable');
    assert.equal(mission.missionStatus, 'active');
  });

  await run('adaptive patch rejects stale runVersion', async () => {
    resetStarlinkState();
    seedCompiledMission({
      ...demoMission(),
      metadata: {
        ...demoMission().metadata,
        authoringMode: 'adaptive',
        runVersion: 3,
      },
    });

    const stale = appendAdaptivePatch({
      missionId: 'mission-graph',
      runVersion: 2,
      patch: {
        nodes: [{
          id: 'stale-node',
          roleId: 'builder',
          terminal: {
            terminalId: 'term-stale',
            terminalTitle: 'Stale Node',
            cli: 'claude',
          },
        }],
        edges: [],
      },
    });

    assert.match(stale.error, /Stale adaptive patch runVersion/);
  });
} finally {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // better-sqlite3 can keep the temp DB open until process exit on Windows
  }
}
