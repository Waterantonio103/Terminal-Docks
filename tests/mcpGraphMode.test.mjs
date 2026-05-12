import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-mcp-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';

const { db } = await import('../mcp-server/src/db/index.mjs');
const { buildTaskDetails, ackAndEmitTaskFetch } = await import('../mcp-server/src/tools/task-details.mjs');
const { executeHandoffTask, executeCompleteTask } = await import('../mcp-server/src/tools/handoff-complete.mjs');
const { executeGetCurrentTask } = await import('../mcp-server/src/tools/tasks.mjs');
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
  });

  await run('get_task_details includes frontend framework for strict UI missions', async () => {
    resetStarlinkState();
    const mission = demoMission();
    mission.metadata.frontendMode = 'strict_ui';
    mission.metadata.frontendCategory = 'admin_internal_tool';
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

    const details = buildTaskDetails('mission-graph', 'builder');
    assert.equal(details.frontendMode, 'strict_ui');
    assert.equal(details.specProfile, 'frontend_three_file');
    assert.equal(details.frontendFramework.categoryId, 'admin_internal_tool');
    assert.ok(details.frontendFramework.schemas['PRD.md'].requiredSections.includes('Target Users'));
    assert.equal(details.assignment.frontendFramework.categoryId, 'admin_internal_tool');
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
