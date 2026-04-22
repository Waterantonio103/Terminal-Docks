import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-mcp-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';

const {
  buildTaskDetails,
  validateGraphHandoff,
  executeHandoffTask,
  executeReceiveMessages,
  resetBridgeState,
  seedCompiledMission,
  seedMissionNodeRuntime,
  getBroadcastHistory,
} = await import('../mcp-server/server.mjs');

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

try {
  await run('get_task_details exposes exact legal same-role targets', async () => {
    resetBridgeState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
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
  });

  await run('validateGraphHandoff rejects off-graph routes and bad outcomes', async () => {
    resetBridgeState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });

    const illegalTarget = validateGraphHandoff({
      missionId: 'mission-graph',
      fromNodeId: 'builder',
      targetNodeId: 'missing-node',
      outcome: 'success',
    });
    assert.match(illegalTarget.error, /Target node missing-node is not part of mission/);

    const illegalOutcome = validateGraphHandoff({
      missionId: 'mission-graph',
      fromNodeId: 'builder',
      targetNodeId: 'reviewer-a',
      outcome: 'maybe',
    });
    assert.match(illegalOutcome.error, /Invalid outcome/);
  });

  await run('handoff_task persists the chosen target node deterministically', async () => {
    resetBridgeState();
    seedCompiledMission(demoMission());
    seedMissionNodeRuntime({
      missionId: 'mission-graph',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:mission-graph',
    });

    const result = executeHandoffTask({
      missionId: 'mission-graph',
      fromNodeId: 'builder',
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

    const inbox = executeReceiveMessages({ nodeId: 'reviewer-b' }, 'reviewer-session');
    assert.match(inbox.content[0].text, /Send to the second reviewer/);
    assert.match(inbox.content[0].text, /"targetNodeId":"reviewer-b"/);

    const noInbox = executeReceiveMessages({ nodeId: 'reviewer-a' }, 'reviewer-a-session');
    assert.equal(noInbox.content[0].text, 'No messages.');

    const broadcasts = getBroadcastHistory();
    assert.ok(broadcasts.some(message => message.type === 'handoff'));
    assert.ok(broadcasts.some(message => message.type === 'task_update'));
  });
} finally {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // better-sqlite3 can keep the temp DB open until process exit on Windows
  }
}
