import assert from 'node:assert/strict';

const { normalizeWorkflowEventRecord, normalizeWorkflowEventRecords } = await import('../.tmp-tests/lib/workflowEvents.js');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run('normalizes workflow event fields at the UI boundary', () => {
  const record = normalizeWorkflowEventRecord({
    id: 4.8,
    missionId: ' mission-1 ',
    nodeId: ' builder ',
    sessionId: '',
    terminalId: ' term-\n1\u0000 ',
    eventType: ' agent_progress ',
    severity: '',
    message: '  ',
    payloadJson: ' {"ok":true} ',
    createdAt: '2026-05-24T10:00:00.000Z',
  });

  assert.equal(record.id, 4);
  assert.equal(record.missionId, 'mission-1');
  assert.equal(record.nodeId, 'builder');
  assert.equal(record.sessionId, null);
  assert.equal(record.terminalId, 'term-1');
  assert.equal(record.eventType, 'agent_progress');
  assert.equal(record.severity, 'info');
  assert.equal(record.message, 'agent_progress');
  assert.equal(record.payloadJson, '{"ok":true}');
});

run('drops malformed events and dedupes repeated ids', () => {
  const records = normalizeWorkflowEventRecords([
    null,
    { id: Number.NaN, missionId: 'mission-1', eventType: 'a', message: 'bad', severity: 'info', createdAt: '2026-01-01' },
    { id: 0, missionId: 'mission-1', eventType: 'a', message: 'bad', severity: 'info', createdAt: '2026-01-01' },
    { id: -2, missionId: 'mission-1', eventType: 'a', message: 'bad', severity: 'info', createdAt: '2026-01-01' },
    { id: 1, missionId: '', eventType: 'a', message: 'ok', severity: 'info', createdAt: 'not a date' },
    { id: 1, missionId: 'mission-1', eventType: 'duplicate', message: 'skip', severity: 'info', createdAt: '2026-01-02' },
    { id: 2, missionId: 'mission-1', eventType: '', message: 'bad', severity: 'info', createdAt: '2026-01-03' },
  ], 'mission-fallback');

  assert.equal(records.length, 1);
  assert.equal(records[0].id, 1);
  assert.equal(records[0].missionId, 'mission-fallback');
  assert.equal(records[0].createdAt, new Date(0).toISOString());
});
