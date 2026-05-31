import assert from 'node:assert/strict';

const { deriveMissionProgressRows, parseMissionProgressEvent } = await import('../.tmp-tests/lib/missionProgress.js');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const mission = {
  missionId: 'mission-1',
  graphId: 'graph-1',
  task: { nodeId: 'task', prompt: 'Build thing', mode: 'build', workspaceDir: 'C:/repo' },
  metadata: {
    compiledAt: 1,
    sourceGraphId: 'graph-1',
    startNodeIds: ['builder'],
    executionLayers: [['builder'], ['tester']],
  },
  nodes: [
    { id: 'builder', roleId: 'builder', instructionOverride: '', terminal: { terminalId: 'term-a', terminalTitle: 'Builder', cli: 'codex', executionMode: 'interactive_pty', reusedExisting: false } },
    { id: 'tester', roleId: 'tester', instructionOverride: '', terminal: { terminalId: 'term-b', terminalTitle: 'Tester', cli: 'gemini', executionMode: 'interactive_pty', reusedExisting: false } },
  ],
  edges: [],
};

run('parses structured agent progress events', () => {
  const event = {
    id: 1,
    missionId: 'mission-1',
    nodeId: 'builder',
    sessionId: 'session-a',
    terminalId: 'term-a',
    eventType: 'agent_progress',
    severity: 'info',
    message: 'Implemented shell',
    payloadJson: JSON.stringify({
      missionId: 'mission-1',
      nodeId: 'builder',
      status: 'progress',
      title: 'Implemented shell',
      filePaths: ['src/App.tsx'],
      percentHint: 55,
      timestamp: 10,
    }),
    createdAt: '2026-05-24 10:00:00',
  };

  const parsed = parseMissionProgressEvent(event);
  assert.equal(parsed.nodeId, 'builder');
  assert.equal(parsed.status, 'progress');
  assert.deepEqual(parsed.filePaths, ['src/App.tsx']);
});

run('normalizes noisy progress payload details', () => {
  const event = {
    id: 1,
    missionId: 'mission-1',
    nodeId: 'builder',
    sessionId: 'session-a',
    terminalId: 'term-a',
    eventType: 'agent_progress',
    severity: 'info',
    message: 'Noisy progress',
    payloadJson: JSON.stringify({
      nodeId: ' builder ',
      status: 'progress',
      title: '  Building UI  ',
      detail: '  Main screen is in place  ',
      artifactIds: [' art-a ', '', 'art-a', 12],
      filePaths: [' src/App.tsx ', '', 'src/App.tsx', null],
      percentHint: Number.NaN,
      timestamp: Number.POSITIVE_INFINITY,
    }),
    createdAt: '2026-05-24 10:00:00',
  };

  const parsed = parseMissionProgressEvent(event);
  assert.equal(parsed.nodeId, 'builder');
  assert.equal(parsed.title, 'Building UI');
  assert.equal(parsed.detail, 'Main screen is in place');
  assert.deepEqual(parsed.artifactIds, ['art-a']);
  assert.deepEqual(parsed.filePaths, ['src/App.tsx']);
  assert.equal(parsed.percentHint, null);
  assert.equal(parsed.timestamp, Date.parse('2026-05-24 10:00:00'));
});

run('derives framework phase rows from runtime state, events, and artifacts', () => {
  const rows = deriveMissionProgressRows({
    mission,
    agents: [
      { nodeId: 'builder', terminalId: 'term-a', title: 'Builder', roleId: 'builder', status: 'running', attempt: 1, artifacts: [{ id: 'art-a', type: 'file_change', label: 'App.tsx', path: 'src/App.tsx', timestamp: 1 }] },
      { nodeId: 'tester', terminalId: 'term-b', title: 'Tester', roleId: 'tester', status: 'idle', attempt: 0 },
    ],
    snapshot: {
      missionId: 'mission-1',
      graphId: 'graph-1',
      missionJson: '{}',
      status: 'running',
      nodes: [],
      edges: [],
      runtimeSessions: [],
      artifacts: [],
      fileLocks: [],
      recentEvents: [],
      statusMappings: [],
    },
    events: [{
      id: 1,
      missionId: 'mission-1',
      nodeId: 'builder',
      sessionId: 'session-a',
      terminalId: 'term-a',
      eventType: 'agent_progress',
      severity: 'info',
      message: 'Building UI',
      payloadJson: JSON.stringify({ missionId: 'mission-1', nodeId: 'builder', status: 'progress', title: 'Building UI', detail: 'Main screen is in place', percentHint: 60, timestamp: 100 }),
      createdAt: '2026-05-24 10:00:00',
    }],
  });

  assert.equal(rows.length, 2);
  assert.equal(rows[0].status, 'active');
  assert.equal(rows[0].percent, 65);
  assert.equal(rows[0].detail, 'Main screen is in place');
  assert.equal(rows[0].files[0], 'src/App.tsx');
  assert.equal(rows[1].status, 'pending');
});

run('attaches artifacts referenced by progress events', () => {
  const rows = deriveMissionProgressRows({
    mission,
    agents: [
      { nodeId: 'builder', terminalId: 'term-a', title: 'Builder', roleId: 'builder', status: 'running', attempt: 1 },
    ],
    snapshot: {
      missionId: 'mission-1',
      graphId: 'graph-1',
      missionJson: '{}',
      status: 'running',
      nodes: [],
      edges: [],
      runtimeSessions: [],
      artifacts: [
        {
          id: 'art-progress',
          missionId: 'mission-1',
          nodeId: null,
          kind: 'file_change',
          title: 'Generated report',
          contentUri: 'reports/summary.md',
          contentText: null,
          metadataJson: null,
          createdAt: '2026-05-24 10:01:00',
        },
      ],
      fileLocks: [],
      recentEvents: [],
      statusMappings: [],
    },
    events: [{
      id: 2,
      missionId: 'mission-1',
      nodeId: 'builder',
      sessionId: 'session-a',
      terminalId: 'term-a',
      eventType: 'agent_progress',
      severity: 'info',
      message: 'Published report',
      payloadJson: JSON.stringify({
        missionId: 'mission-1',
        nodeId: 'builder',
        status: 'progress',
        title: 'Published report',
        artifactIds: ['art-progress'],
        timestamp: 101,
      }),
      createdAt: '2026-05-24 10:01:00',
    }],
  });

  assert.deepEqual(rows[0].artifacts, [
    { id: 'art-progress', title: 'Generated report', kind: 'file_change', path: 'reports/summary.md' },
  ]);
  assert.deepEqual(rows[0].files, ['reports/summary.md']);
});
