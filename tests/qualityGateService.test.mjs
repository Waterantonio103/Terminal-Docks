import assert from 'node:assert/strict';
import { qualityGateService } from '../.tmp-tests/lib/workflow/QualityGateService.js';

function makeRun({ prompt, artifacts }) {
  return {
    runId: 'quality-run',
    definitionId: 'quality-definition',
    status: 'completed',
    definition: {
      id: 'quality-definition',
      name: 'Quality gate fixture',
      createdAt: new Date(0).toISOString(),
      updatedAt: new Date(0).toISOString(),
      nodes: [
        {
          id: 'task',
          kind: 'task',
          roleId: 'task',
          config: { prompt },
        },
        {
          id: 'builder',
          kind: 'agent',
          roleId: 'builder',
          config: {},
        },
      ],
      edges: [],
    },
    nodeStates: {
      builder: {
        nodeId: 'builder',
        state: 'completed',
        attempt: 1,
        attempts: [
          {
            attempt: 1,
            state: 'completed',
            artifacts,
            filesChanged: [],
          },
        ],
      },
    },
    runtimeSessions: {},
    events: [],
    handoffs: [],
    activePermissions: [],
  };
}

const docsRun = makeRun({
  prompt: 'Update README docs',
  artifacts: [
    { id: 'a1', kind: 'scout_context', label: 'Context', timestamp: 1 },
    { id: 'a2', kind: 'patch', label: 'Docs patch', timestamp: 2 },
  ],
});

const docsResult = qualityGateService.evaluate(docsRun);
assert.equal(docsResult.passed, true);
assert.deepEqual(docsResult.missingArtifacts, []);

const bugfixRun = makeRun({
  prompt: 'Fix login bug',
  artifacts: [
    { id: 'a1', kind: 'scout_context', label: 'Context', timestamp: 1 },
    { id: 'a2', kind: 'patch', label: 'Bugfix patch', timestamp: 2 },
  ],
});

const bugfixResult = qualityGateService.evaluate(bugfixRun);
assert.equal(bugfixResult.passed, false);
assert.deepEqual(bugfixResult.missingArtifacts, ['test_result']);

const passingTestsRun = makeRun({
  prompt: 'Fix login bug',
  artifacts: [
    { id: 'a1', kind: 'scout_context', label: 'Context', timestamp: 1 },
    { id: 'a2', kind: 'patch', label: 'Bugfix patch', timestamp: 2 },
    { id: 'a3', kind: 'test_result', label: 'Test result', content: '12 tests passed, 0 failures', timestamp: 3 },
  ],
});

const passingTestsResult = qualityGateService.evaluate(passingTestsRun);
assert.equal(passingTestsResult.passed, true);

const failingTestsRun = makeRun({
  prompt: 'Fix login bug',
  artifacts: [
    { id: 'a1', kind: 'scout_context', label: 'Context', timestamp: 1 },
    { id: 'a2', kind: 'patch', label: 'Bugfix patch', timestamp: 2 },
    { id: 'a3', kind: 'test_result', label: 'Test result', content: '12 tests passed, 1 failure', timestamp: 3 },
  ],
});

const failingTestsResult = qualityGateService.evaluate(failingTestsRun);
assert.equal(failingTestsResult.passed, false);
assert.match(failingTestsResult.reasons.join('\n'), /test failure/);

console.log('PASS quality gate evaluates required typed artifacts');
