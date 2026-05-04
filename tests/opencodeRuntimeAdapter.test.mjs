import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { opencodeAdapter } from '../.tmp-tests/lib/runtime/adapters/opencode.js';

const fixtureDir = join(process.cwd(), 'tests', 'fixtures', 'runtime-adapters', 'opencode');
const cases = [
  ['idle.ansi.txt', 'idle'],
  ['processing.ansi.txt', 'processing'],
  ['completed.ansi.txt', 'completed'],
  ['waiting_user_answer.ansi.txt', 'waiting_user_answer'],
  ['error_or_stale.ansi.txt', 'error'],
];

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

for (const [fileName, expectedStatus] of cases) {
  run(`opencode status fixture ${fileName} maps to ${expectedStatus}`, () => {
    const fixture = readFileSync(join(fixtureDir, fileName), 'utf8');
    const status = opencodeAdapter.detectStatus(fixture);
    assert.equal(status.status, expectedStatus, status.detail);
    assert.equal(opencodeAdapter.detectReady(fixture).ready, expectedStatus === 'idle');
  });
}

run('opencode startup title alone does not imply idle', () => {
  const titleOnly = '\u001b]0;OpenCode\u0007';
  const status = opencodeAdapter.detectStatus(titleOnly);
  assert.notEqual(status.status, 'idle');
  assert.equal(opencodeAdapter.detectReady(titleOnly).ready, false);
});

run('opencode invalid flag help maps to error', () => {
  const help = 'opencode --yolo\nUnknown option: --yolo\nUsage: opencode [options]\nC:\\Users\\user>';
  assert.equal(opencodeAdapter.detectStatus(help).status, 'error');
  assert.equal(opencodeAdapter.detectReady(help).ready, false);
});

run('opencode TUI launch does not emit unsupported yolo flag', () => {
  const launch = opencodeAdapter.buildLaunchCommand({
    sessionId: 'session-1',
    missionId: 'mission-1',
    nodeId: 'node-1',
    role: 'builder',
    agentId: 'agent-1',
    profileId: 'profile-1',
    workspaceDir: 'C:/workspace',
    mcpUrl: 'http://127.0.0.1:3741/mcp',
    executionMode: 'interactive',
    model: 'anthropic/claude-sonnet-4',
    yolo: true,
  });

  assert.equal(launch.command, 'opencode');
  assert.equal(launch.promptDelivery, 'interactive_pty');
  assert.deepEqual(launch.args, ['C:/workspace', '--model', 'anthropic/claude-sonnet-4']);
});
