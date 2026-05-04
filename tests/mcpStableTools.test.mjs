import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-mcp-tools-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';

const {
  executeAssignTask,
  executeCompleteTask,
  executeConnectAgent,
  executeGetTaskDetails,
  executeHandoffTask,
  executeReceiveMessages,
  executeSendMessage,
  resetStarlinkState,
  seedCompiledMission,
  seedConnectedSession,
  seedAgentRuntimeSession,
  seedMissionNodeRuntime,
} = await import('../mcp-server/server.mjs');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function missionFixture() {
  return {
    missionId: 'stable-tools-mission',
    graphId: 'stable-tools-graph',
    task: {
      nodeId: 'task-root',
      prompt: 'Exercise stable MCP tool contracts',
      mode: 'build',
      workspaceDir: '/workspace',
    },
    metadata: {
      compiledAt: 1,
      sourceGraphId: 'stable-tools-graph',
      startNodeIds: ['builder'],
      executionLayers: [['builder'], ['reviewer']],
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
        id: 'reviewer',
        roleId: 'reviewer',
        instructionOverride: '',
        terminal: {
          terminalId: 'term-reviewer',
          terminalTitle: 'Reviewer',
          cli: 'claude',
          paneId: 'pane-reviewer',
          reusedExisting: true,
        },
      },
    ],
    edges: [
      {
        id: 'edge:builder:success:reviewer',
        fromNodeId: 'builder',
        toNodeId: 'reviewer',
        condition: 'on_success',
      },
    ],
  };
}

function extractText(result) {
  return result?.content?.[0]?.text ?? '';
}

function extractEnvelope(result) {
  return JSON.parse(extractText(result));
}

function extractData(result) {
  return extractEnvelope(result).data;
}

function extractTaskId(result) {
  const match = extractText(result).match(/task\s+(\d+)/i);
  return match ? Number(match[1]) : null;
}

try {
  run('baseline MCP tools support connect, get task, handoff, assign, send message, and complete', () => {
    resetStarlinkState();
    seedCompiledMission(missionFixture());
    seedMissionNodeRuntime({
      missionId: 'stable-tools-mission',
      nodeId: 'builder',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:stable-tools-mission',
    });
    seedAgentRuntimeSession({
      sessionId: 'runtime:stable-tools-mission:builder:1',
      agentId: 'agent:stable-tools-mission:builder',
      missionId: 'stable-tools-mission',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });

    const connect = executeConnectAgent({
      role: 'reviewer',
      agentId: 'reviewer-agent',
      terminalId: 'term-reviewer',
      cli: 'claude',
      capabilities: ['review'],
      workingDir: '/workspace',
    }, 'session-reviewer');
    assert.match(extractText(connect), /Successfully connected/);
    assert.equal(extractEnvelope(connect).ok, true);
    assert.equal(extractData(connect).sessionId, 'session-reviewer');
    seedConnectedSession('session-reviewer', { role: 'reviewer', availability: 'available' });

    const detailsResult = executeGetTaskDetails({
      missionId: 'stable-tools-mission',
      nodeId: 'builder',
    }, 'runtime:stable-tools-mission:builder:1');
    assert.equal(detailsResult.isError, undefined);
    const details = extractData(detailsResult);
    assert.equal(details.node.nodeId, 'builder');
    assert.deepEqual(details.legalNextTargets.map(target => target.targetNodeId), ['reviewer']);

    const handoff = executeHandoffTask({
      missionId: 'stable-tools-mission',
      fromNodeId: 'builder',
      fromAttempt: 1,
      targetNodeId: 'reviewer',
      outcome: 'success',
      title: 'Review implementation',
      payload: { filesChanged: ['src/example.ts'] },
    }, 'runtime:stable-tools-mission:builder:1');
    assert.equal(handoff.isError, undefined);
    const taskId = extractTaskId(handoff);
    assert.ok(taskId);

    const assign = executeAssignTask({
      taskId,
      targetSessionId: 'session-reviewer',
      agentId: 'reviewer-agent',
    }, 'coordinator-session');
    assert.equal(assign.isError, undefined);
    assert.match(extractText(assign), /assigned to reviewer-agent/);

    const directInbox = executeReceiveMessages({}, 'session-reviewer');
    assert.match(extractText(directInbox), /\[ASSIGNED\] Task/);

    const message = executeSendMessage({
      missionId: 'stable-tools-mission',
      targetNodeId: 'reviewer',
      message: 'Please verify the exported executor contracts.',
    }, 'runtime:stable-tools-mission:builder:1');
    assert.equal(message.isError, undefined);
    assert.match(extractText(message), /Message delivered to node reviewer/);

    const graphInbox = executeReceiveMessages({
      missionId: 'stable-tools-mission',
      nodeId: 'reviewer',
      afterSeq: 0,
    }, 'session-reviewer');
    const graphInboxPayload = JSON.parse(extractText(graphInbox));
    assert.ok(
      graphInboxPayload.messages.some(entry => entry.content.includes('exported executor contracts')),
      'node-scoped inbox should include send_message content',
    );

    seedMissionNodeRuntime({
      missionId: 'stable-tools-mission',
      nodeId: 'reviewer',
      roleId: 'reviewer',
      status: 'running',
      attempt: 1,
      currentWaveId: 'root:stable-tools-mission',
    });
    seedAgentRuntimeSession({
      sessionId: 'runtime:stable-tools-mission:reviewer:1',
      agentId: 'agent:stable-tools-mission:reviewer',
      missionId: 'stable-tools-mission',
      nodeId: 'reviewer',
      attempt: 1,
      terminalId: 'term-reviewer',
      status: 'running',
    });

    const complete = executeCompleteTask({
      missionId: 'stable-tools-mission',
      nodeId: 'reviewer',
      attempt: 1,
      outcome: 'success',
      summary: 'Review passed.',
      keyFindings: ['Stable baseline contracts are callable.'],
    }, 'runtime:stable-tools-mission:reviewer:1');
    assert.equal(complete.isError, undefined);
    const completionPayload = extractData(complete);
    assert.equal(completionPayload.status, 'completed');
    assert.equal(completionPayload.terminal, true);
  });

  run('baseline MCP tools reject bad executor input with typed error envelopes', () => {
    resetStarlinkState();

    const badInputs = [
      ['connect_agent', executeConnectAgent({}, 'bad-connect'), /role/i],
      ['get_task_details', executeGetTaskDetails({ missionId: 'm' }, 'bad-details'), /nodeId/i],
      ['handoff_task', executeHandoffTask({ fromRole: 'builder', targetRole: 'reviewer' }, 'bad-handoff'), /title/i],
      ['assign_task', executeAssignTask({ taskId: 'not-a-number', targetSessionId: 'worker' }, 'bad-assign'), /taskId/i],
      ['send_message', executeSendMessage({ message: 'hello' }, 'bad-message'), /targetSessionId/i],
      ['complete_task', executeCompleteTask({ missionId: 'm', nodeId: 'n', attempt: 0, outcome: 'success' }, 'bad-complete'), /attempt/i],
    ];

    for (const [tool, result, pattern] of badInputs) {
      assert.equal(result.isError, true, `${tool} should be an MCP error result`);
      const envelope = extractEnvelope(result);
      assert.equal(envelope.schema, 'mcp_tool_response_v1');
      assert.equal(envelope.ok, false);
      assert.equal(envelope.tool, tool);
      assert.equal(envelope.error.code, 'bad_input');
      assert.match(envelope.error.message, pattern);
    }
  });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
