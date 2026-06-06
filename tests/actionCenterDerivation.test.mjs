import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { countNeedsYou, deriveActionCenterItems, normalizeActionCenterInboxItems } from '../.tmp-tests/lib/actionCenter/index.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const actionCenterPane = readFileSync(resolve(root, 'src/components/ActionCenter/ActionCenterPane.tsx'), 'utf8');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

const now = Date.parse('2026-05-09T12:00:00Z');

run('runtime permission remains an active runtime item while dock handles approval', () => {
  const items = deriveActionCenterItems({
    now,
    sessions: [{
      sessionId: 'session-1',
      nodeId: 'node-1',
      terminalId: 'terminal-1',
      status: 'running',
      activePermission: {
        permissionId: 'permission-1',
        category: 'file_write',
        rawPrompt: 'Allow write?',
        detail: 'Write src/App.tsx',
        detectedAt: now - 1000,
        sessionId: 'session-1',
        nodeId: 'node-1',
      },
    }],
  });

  assert.equal(items[0].id, 'active-runtime:session-1');
  assert.equal(items[0].section, 'active_now');
  assert.equal(items[0].kind, 'active_runtime');
  assert.equal(countNeedsYou(items), 0);
});

run('codex update permission does not duplicate docked permission actions', () => {
  const items = deriveActionCenterItems({
    now,
    sessions: [{
      sessionId: 'session-update',
      nodeId: 'node-update',
      terminalId: 'terminal-update',
      status: 'awaiting_permission',
      activePermission: {
        permissionId: 'codex-update-1',
        category: 'package_install',
        rawPrompt: [
          'Update available! 0.136.0 -> 0.137.0',
          '› 1. Update now (runs npm install -g @openai/codex)',
          '  2. Skip',
          'Press enter to continue',
        ].join('\n'),
        detail: 'Codex CLI update available. Update now?',
        detectedAt: now - 1000,
        sessionId: 'session-update',
        nodeId: 'node-update',
      },
    }],
  });

  assert.equal(items[0].kind, 'active_runtime');
  assert.equal(items[0].section, 'active_now');
  assert.equal(items[0].actions.some(action => action.id === 'approve_permission'), false);
  assert.equal(items[0].actions.some(action => action.id === 'deny_permission'), false);
});

run('pending and approved inbox items are actionable delegations', () => {
  const items = deriveActionCenterItems({
    now,
    inboxItems: [
      { id: 1, title: 'Review patch', status: 'pending', created_at: new Date(now - 2000).toISOString() },
      { id: 2, title: 'Claim follow-up', status: 'approved', created_at: new Date(now - 1000).toISOString() },
    ],
  });

  assert.equal(countNeedsYou(items), 2);
  assert.equal(items.find(item => item.id === 'delegation:1')?.actions.some(action => action.id === 'approve_delegation'), true);
  assert.equal(items.find(item => item.id === 'delegation:2')?.actions.some(action => action.id === 'claim_delegation'), true);
});

run('inbox normalization drops malformed Starlink payload rows', () => {
  const items = normalizeActionCenterInboxItems([
    {
      id: 7,
      status: ' Pending\0 ',
      title: '  Review\0\npatch  ',
      from_session_id: ' session\0-1 ',
      recipient_session_id: null,
      recipient_node_id: '',
      role_id: ' reviewer\nlead ',
      created_at: '2026-05-09T12:00:00Z',
    },
    { id: 8, status: 'unknown', title: 'bad status' },
    { id: 0, status: 'pending', title: 'bad id' },
    null,
  ]);

  assert.deepEqual(items, [{
    id: 7,
    status: 'pending',
    title: 'Review patch',
    from_session_id: 'session-1',
    recipient_session_id: null,
    recipient_node_id: undefined,
    role_id: 'reviewer lead',
    objective: undefined,
    mission_id: undefined,
    created_at: '2026-05-09T12:00:00Z',
  }]);

  assert.deepEqual(normalizeActionCenterInboxItems([
    { id: 10, status: ' APPROVED ', title: 'Claimable' },
  ]).map(item => item.status), ['approved']);
});

run('running runtime appears in active-now, not needs-you', () => {
  const items = deriveActionCenterItems({
    now,
    sessions: [{
      sessionId: 'session-2',
      nodeId: 'node-2',
      terminalId: 'terminal-2',
      roleId: 'coder',
      cli: 'codex',
      status: 'running',
      currentAction: 'Editing files',
      startedAt: now - 5000,
    }],
  });

  assert.equal(items[0].id, 'active-runtime:session-2');
  assert.equal(items[0].section, 'active_now');
  assert.equal(countNeedsYou(items), 0);
});

run('runtime items require a usable session id', () => {
  const items = deriveActionCenterItems({
    now,
    sessions: [
      { sessionId: '', status: 'failed', title: 'Missing session' },
      { sessionId: '   ', status: 'running', title: 'Blank session' },
      { sessionId: 'session-valid', status: 'running', title: 'Valid session' },
    ],
  });

  assert.deepEqual(items.map(item => item.id), ['active-runtime:session-valid']);
});

run('failed and manual-takeover runtimes require human intervention', () => {
  const items = deriveActionCenterItems({
    now,
    sessions: [
      { sessionId: 'session-3', status: 'failed', title: 'Tester', lastActivityAt: now - 1000 },
      { sessionId: 'session-4', status: 'manual_takeover', title: 'Reviewer', lastActivityAt: now - 2000 },
    ],
  });

  assert.equal(countNeedsYou(items), 2);
  assert.equal(items.find(item => item.id === 'runtime-blocker:session-3:failed')?.section, 'needs_you');
  assert.equal(items.find(item => item.id === 'runtime-blocker:session-4:manual_takeover')?.actions.some(action => action.id === 'resume_node'), true);
});

run('recent items are capped by window and limit', () => {
  const items = deriveActionCenterItems({
    now,
    recentLimit: 1,
    recentWindowMs: 30 * 60 * 1000,
    recentEvents: [
      { id: 'old', source: 'runtime', eventType: 'permission_resolved', title: 'Old', createdAt: now - 31 * 60 * 1000 },
      { id: 'newer', source: 'runtime', eventType: 'session_completed', title: 'Newer', createdAt: now - 1000 },
      { id: 'new', source: 'runtime', eventType: 'permission_resolved', title: 'New', createdAt: now - 500 },
    ],
  });

  assert.equal(items.length, 1);
  assert.equal(items[0].id, 'recent:runtime:new');
  assert.equal(items[0].section, 'recently_resolved');
});

run('recent derivation clamps invalid limits and timestamps', () => {
  const noRecent = deriveActionCenterItems({
    now,
    recentLimit: -1,
    recentEvents: [
      { id: 'new', source: 'runtime', eventType: 'session_completed', title: 'New', createdAt: now - 1000 },
    ],
  });
  assert.equal(noRecent.length, 0);

  const items = deriveActionCenterItems({
    now: Number.NaN,
    recentLimit: Number.NaN,
    recentWindowMs: -1,
    sessions: [
      { sessionId: 'session-invalid-time', status: 'running', startedAt: Number.NaN },
    ],
    inboxItems: [
      { id: 9, title: 'Bad date', status: 'completed', created_at: 'not a date' },
    ],
    recentEvents: [
      { id: 'future', source: 'runtime', eventType: 'session_completed', title: 'Future', createdAt: now + 1000 },
      { id: 'invalid', source: 'runtime', eventType: 'session_completed', title: 'Invalid', createdAt: Number.NaN },
    ],
  });

  assert.equal(items.some(item => item.id === 'recent:runtime:future'), false);
  assert.equal(items.some(item => item.id === 'recent:runtime:invalid'), false);
  assert.equal(items.find(item => item.id === 'active-runtime:session-invalid-time')?.createdAt > 0, true);
  assert.equal(items.find(item => item.id === 'delegation:9')?.createdAt > 0, true);
});

run('action center controls expose accessible state and labels', () => {
  for (const value of [
    'aria-expanded={rawExpanded}',
    'aria-controls={`action-raw-prompt-${item.id}`}',
    'id={`action-raw-prompt-${item.id}`}',
    'aria-label="Refresh delegations"',
    'aria-label="Clear recent"',
  ]) {
    assert.ok(actionCenterPane.includes(value), `missing ${value}`);
  }
});
