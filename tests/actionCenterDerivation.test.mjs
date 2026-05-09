import assert from 'node:assert/strict';
import { countNeedsYou, deriveActionCenterItems } from '../.tmp-tests/lib/actionCenter/index.js';

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

run('runtime permission is a needs-you item and drives badge count', () => {
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

  assert.equal(items[0].id, 'permission:permission-1');
  assert.equal(items[0].section, 'needs_you');
  assert.equal(items[0].kind, 'permission');
  assert.equal(countNeedsYou(items), 1);
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
