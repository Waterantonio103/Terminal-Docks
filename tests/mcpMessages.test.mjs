import assert from 'node:assert/strict';
import {
  isMcpMessageType,
  normalizeAgentConnectedPayload,
  normalizeMcpMessage,
} from '../.tmp-tests/lib/mcpMessages.js';

const now = Date.parse('2026-05-30T04:10:00Z');

assert.equal(normalizeMcpMessage(null, now), null);
assert.equal(normalizeMcpMessage({ from: 'agent' }, now), null);

assert.deepEqual(normalizeMcpMessage({
  id: Number.NaN,
  from: '  ',
  content: { ok: true },
  type: ' result:markdown ',
  timestamp: Infinity,
}, now), {
  id: now,
  from: 'starlink',
  content: '{"ok":true}',
  type: 'result:markdown',
  timestamp: now,
});

assert.deepEqual(normalizeMcpMessage({
  id: 7.8,
  from: ' scout\u0000 \n lead ',
  content: 'hello',
  type: ' message\u0000 event ',
  timestamp: 12.9,
}, now), {
  id: 7,
  from: 'scout lead',
  content: 'hello',
  type: 'message event',
  timestamp: 12,
});

assert.deepEqual(normalizeMcpMessage({
  id: 0,
  from: 'agent',
  content: 'hello',
  type: 'message',
  timestamp: -3,
}, now), {
  id: now,
  from: 'agent',
  content: 'hello',
  type: 'message',
  timestamp: now,
});

assert.equal(isMcpMessageType({ type: ' task_update ' }, 'task_update'), true);
assert.equal(isMcpMessageType({ type: ' task_update ' }, ' task_update '), true);
assert.equal(isMcpMessageType({ type: ' task_update ' }, ' \u0000 '), false);
assert.equal(isMcpMessageType({ type: '' }, 'task_update'), false);

assert.deepEqual(normalizeAgentConnectedPayload(JSON.stringify({
  terminalId: ' term-1\u0000 ',
  cli: ' codex\u0000 ',
  role: ' reviewer\nlead ',
})), {
  terminalId: 'term-1',
  cli: 'codex',
  role: 'reviewer lead',
});
assert.equal(normalizeAgentConnectedPayload('{bad json'), null);
assert.equal(normalizeAgentConnectedPayload(JSON.stringify({ cli: 'codex' })), null);
assert.equal(normalizeAgentConnectedPayload(JSON.stringify({ terminalId: ' \u0000 ', cli: 'codex' })), null);

console.log('PASS MCP message normalization protects UI event handlers');
