import assert from 'node:assert/strict';
import { compileMission, validateGraph } from '../.tmp-tests/lib/graphCompiler.js';

function taskNode(id = 'task-1') {
  return {
    id,
    type: 'task',
    position: { x: 0, y: 0 },
    data: {
      roleId: 'task',
      status: 'idle',
      prompt: 'Ship the feature',
      mode: 'build',
      workspaceDir: 'C:/workspace',
    },
  };
}

function agentNode(id, roleId) {
  return {
    id,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      roleId,
      status: 'idle',
      cli: 'claude',
      instructionOverride: '',
      terminalId: `term-${id}`,
      terminalTitle: `Terminal ${id}`,
      autoLinked: false,
    },
  };
}

function barrierNode(id) {
  return {
    id,
    type: 'barrier',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      roleId: 'barrier',
      status: 'idle',
    },
  };
}

function edge(source, target, condition = 'always') {
  return {
    id: `${source}-${condition}-${target}`,
    source,
    target,
    data: { condition },
  };
}

function compileCase(nodes, edges) {
  return compileMission({
    graphId: 'graph-1',
    missionId: 'mission-1',
    nodes,
    edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
  });
}

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run('linear chain compiles into a single start node and edge', () => {
  const mission = compileCase(
    [taskNode(), agentNode('agent-a', 'scout'), agentNode('agent-b', 'reviewer')],
    [edge('task-1', 'agent-a'), edge('agent-a', 'agent-b')]
  );

  assert.deepEqual(mission.metadata.startNodeIds, ['agent-a']);
  assert.deepEqual(mission.metadata.executionLayers, [['agent-a'], ['agent-b']]);
  assert.deepEqual(
    mission.edges.map(entry => ({ from: entry.fromNodeId, to: entry.toNodeId, condition: entry.condition })),
    [{ from: 'agent-a', to: 'agent-b', condition: 'always' }]
  );
});

run('fan-out preserves multiple downstream targets', () => {
  const mission = compileCase(
    [taskNode(), agentNode('coord', 'coordinator'), agentNode('builder', 'builder'), agentNode('tester', 'tester')],
    [edge('task-1', 'coord'), edge('coord', 'builder'), edge('coord', 'tester', 'on_success')]
  );

  assert.deepEqual(mission.metadata.executionLayers, [['coord'], ['builder', 'tester']]);
  assert.deepEqual(
    mission.edges.map(entry => `${entry.fromNodeId}:${entry.condition}:${entry.toNodeId}`),
    ['coord:always:builder', 'coord:on_success:tester']
  );
});

run('fan-in through a barrier emits direct agent-to-agent edges', () => {
  const mission = compileCase(
    [
      taskNode(),
      agentNode('builder', 'builder'),
      agentNode('tester', 'tester'),
      barrierNode('gate'),
      agentNode('reviewer', 'reviewer'),
    ],
    [
      edge('task-1', 'builder'),
      edge('task-1', 'tester'),
      edge('builder', 'gate'),
      edge('tester', 'gate'),
      edge('gate', 'reviewer'),
    ]
  );

  assert.deepEqual(mission.metadata.startNodeIds, ['builder', 'tester']);
  assert.deepEqual(mission.metadata.executionLayers, [['builder', 'tester'], ['reviewer']]);
  assert.deepEqual(
    mission.edges.map(entry => `${entry.fromNodeId}:${entry.toNodeId}`),
    ['builder:reviewer', 'tester:reviewer']
  );
});

run('duplicate roles stay as distinct runtime nodes', () => {
  const mission = compileCase(
    [
      taskNode(),
      agentNode('builder-a', 'builder'),
      agentNode('builder-b', 'builder'),
      agentNode('reviewer', 'reviewer'),
    ],
    [
      edge('task-1', 'builder-a'),
      edge('task-1', 'builder-b'),
      edge('builder-a', 'reviewer'),
      edge('builder-b', 'reviewer'),
    ]
  );

  assert.deepEqual(mission.metadata.executionLayers, [['builder-a', 'builder-b'], ['reviewer']]);
  assert.equal(mission.nodes.filter(node => node.roleId === 'builder').length, 2);
});

run('same-role downstream nodes keep separate graph edges', () => {
  const mission = compileCase(
    [
      taskNode(),
      agentNode('builder', 'builder'),
      agentNode('reviewer-a', 'reviewer'),
      agentNode('reviewer-b', 'reviewer'),
    ],
    [
      edge('task-1', 'builder'),
      edge('builder', 'reviewer-a'),
      edge('builder', 'reviewer-b'),
    ]
  );

  assert.deepEqual(mission.metadata.executionLayers, [['builder'], ['reviewer-a', 'reviewer-b']]);
  assert.deepEqual(
    mission.edges.map(entry => entry.toNodeId),
    ['reviewer-a', 'reviewer-b']
  );
});

run('conditional paths survive helper-node compilation', () => {
  const mission = compileCase(
    [taskNode(), agentNode('builder', 'builder'), barrierNode('gate'), agentNode('reviewer', 'reviewer')],
    [edge('task-1', 'builder'), edge('builder', 'gate'), edge('gate', 'reviewer', 'on_failure')]
  );

  assert.deepEqual(
    mission.edges.map(entry => ({ from: entry.fromNodeId, to: entry.toNodeId, condition: entry.condition })),
    [{ from: 'builder', to: 'reviewer', condition: 'on_failure' }]
  );
});

run('cycles are rejected before runtime terminals are prepared', () => {
  assert.throws(
    () => validateGraph(
      [taskNode(), agentNode('builder', 'builder'), agentNode('reviewer', 'reviewer')],
      [edge('task-1', 'builder'), edge('builder', 'reviewer'), edge('reviewer', 'builder', 'on_failure')]
    ),
    /cycle/i
  );
});
