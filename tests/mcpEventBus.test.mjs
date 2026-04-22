import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-mcpbus-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';

const bridge = await import('../mcp-server/server.mjs');
const {
  resetBridgeState,
  emitAgentEvent,
  agentEvents,
  getRecentAgentEvents,
  recordTaskPush,
  ackTaskPush,
  executeConnectAgent,
  executeReceiveMessages,
  executeHandoffTask,
  seedCompiledMission,
  seedMissionNodeRuntime,
  seedAgentRuntimeSession,
} = bridge;

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

try {
  resetBridgeState();

  run('recordTaskPush inserts once and replays return duplicate', () => {
    const first = recordTaskPush({
      sessionId: 'sess-1',
      missionId: 'mission-1',
      nodeId: 'node-1',
      taskSeq: 1,
      attempt: 1,
    });
    assert.equal(first.inserted, true);

    const second = recordTaskPush({
      sessionId: 'sess-1',
      missionId: 'mission-1',
      nodeId: 'node-1',
      taskSeq: 1,
      attempt: 1,
    });
    assert.equal(second.inserted, false);
    assert.equal(second.reason, 'duplicate');

    const acked = ackTaskPush({
      sessionId: 'sess-1',
      missionId: 'mission-1',
      nodeId: 'node-1',
      taskSeq: 1,
    });
    assert.equal(acked, true);

    const ackedAgain = ackTaskPush({
      sessionId: 'sess-1',
      missionId: 'mission-1',
      nodeId: 'node-1',
      taskSeq: 1,
    });
    assert.equal(ackedAgain, false);
  });

  run('recordTaskPush rejects malformed input', () => {
    assert.equal(recordTaskPush({ taskSeq: 1 }).inserted, false);
    assert.equal(recordTaskPush({
      sessionId: 'sess-1', missionId: 'm', nodeId: 'n', taskSeq: 0,
    }).inserted, false);
    assert.equal(recordTaskPush({
      sessionId: 'sess-1', missionId: 'm', nodeId: 'n', taskSeq: -5,
    }).inserted, false);
  });

  run('agent:ready event emits when executeConnectAgent is called', () => {
    const received = [];
    const handler = ev => received.push(ev);
    agentEvents.on('sid:connect-sess', handler);

    executeConnectAgent(
      { role: 'builder', agentId: 'builder-1', terminalId: 'term-a', cli: 'claude' },
      'connect-sess',
    );

    agentEvents.off('sid:connect-sess', handler);
    assert.ok(received.some(ev => ev.type === 'agent:ready'));
    assert.ok(received.every(ev => ev.sessionId === 'connect-sess'));
  });

  run('agent:heartbeat emits on non-graph receive_messages', () => {
    const received = [];
    const handler = ev => received.push(ev);
    agentEvents.on('sid:hb-sess', handler);

    executeReceiveMessages({}, 'hb-sess');

    agentEvents.off('sid:hb-sess', handler);
    assert.ok(received.some(ev => ev.type === 'agent:heartbeat'));
  });

  run('task:completed emits from graph-mode handoff_task', () => {
    resetBridgeState();
    const mission = {
      missionId: 'evt-mission',
      graphId: 'evt-graph',
      nodes: [
        { id: 'builder-node', roleId: 'builder', instructionOverride: '', terminal: { terminalId: 'term-b', terminalTitle: 'B', paneId: 'pane-b', cli: 'claude' } },
        { id: 'reviewer-node', roleId: 'reviewer', instructionOverride: '', terminal: { terminalId: 'term-r', terminalTitle: 'R', paneId: 'pane-r', cli: 'claude' } },
      ],
      edges: [{ id: 'e1', fromNodeId: 'builder-node', toNodeId: 'reviewer-node', condition: 'always' }],
      metadata: { executionLayers: [['builder-node'], ['reviewer-node']], authoringMode: 'graph' },
      task: { prompt: 'ship it', mode: 'build', workspaceDir: null },
    };
    seedCompiledMission(mission);
    seedMissionNodeRuntime({
      missionId: 'evt-mission',
      nodeId: 'builder-node',
      roleId: 'builder',
      status: 'running',
      attempt: 1,
    });
    seedAgentRuntimeSession({
      sessionId: 'evt-session',
      agentId: 'builder-1',
      missionId: 'evt-mission',
      nodeId: 'builder-node',
      attempt: 1,
      terminalId: 'term-b',
      status: 'dispatched',
    });

    const received = [];
    const handler = ev => received.push(ev);
    agentEvents.on('sid:evt-session', handler);

    const result = executeHandoffTask({
      missionId: 'evt-mission',
      fromNodeId: 'builder-node',
      fromAttempt: 1,
      targetNodeId: 'reviewer-node',
      outcome: 'success',
      title: 'Builder done',
    }, 'evt-session');

    agentEvents.off('sid:evt-session', handler);
    assert.equal(result.isError, undefined);
    const completed = received.find(ev => ev.type === 'task:completed');
    assert.ok(completed, 'expected a task:completed event');
    assert.equal(completed.outcome, 'success');
    assert.equal(completed.missionId, 'evt-mission');
    assert.equal(completed.nodeId, 'builder-node');
  });

  run('getRecentAgentEvents filters by session id', () => {
    emitAgentEvent({ type: 'agent:heartbeat', sessionId: 'filter-a', at: 1 });
    emitAgentEvent({ type: 'agent:heartbeat', sessionId: 'filter-b', at: 2 });
    const onlyA = getRecentAgentEvents('filter-a');
    assert.ok(onlyA.every(ev => ev.sessionId === 'filter-a'));
    assert.ok(onlyA.some(ev => ev.at === 1));
  });
} finally {
  try { rmSync(tempRoot, { recursive: true, force: true }); } catch {}
}
