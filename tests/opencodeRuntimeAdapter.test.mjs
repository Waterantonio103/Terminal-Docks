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

run('opencode ask-anything input screen maps to idle', () => {
  const inputScreen = '\u001b]0;OpenCode\u0007OpenCode\n┃  Ask anything... "What is the tech stack of this project?"\n┃  Build · Step 3.5 Flash Nvidia · medium\n~:master ⊙ 2 MCP/status';
  const status = opencodeAdapter.detectStatus(inputScreen);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(opencodeAdapter.detectReady(inputScreen).ready, true);
});

run('opencode visible input prompt wins over stale spinner glyphs', () => {
  const output = [
    '\u001b]0;OpenCode\u0007OpenCode',
    '\u001b[?25l⠧\u001b[?25h',
    '┃  Ask anything... "What should I build next?"',
    '┃  Build · GLM-5.1 · medium',
    '~:master ⊙ 2 MCP/status',
  ].join('\n');
  const status = opencodeAdapter.detectStatus(output);
  assert.equal(status.status, 'idle', status.detail);
  assert.equal(status.confidence, 'high');
  assert.equal(opencodeAdapter.detectReady(output).ready, true);
});

run('opencode invalid flag help maps to error', () => {
  const help = 'opencode --yolo\nUnknown option: --yolo\nUsage: opencode [options]\nC:\\Users\\user>';
  assert.equal(opencodeAdapter.detectStatus(help).status, 'error');
  assert.equal(opencodeAdapter.detectReady(help).ready, false);
});

run('opencode file preview text does not masquerade as CLI completion', () => {
  const preview = [
    '# Wrote opencode_completion_probe.txt',
    '1 OpenCode MCP completion probe',
    '2 Task completed successfully',
    'Thinking: Good, I have created the required file. Now I need to call complete_task.',
  ].join('\n');
  assert.equal(opencodeAdapter.detectCompletion(preview), null);
  assert.notEqual(opencodeAdapter.detectStatus(preview).status, 'completed');
});

run('opencode activation prompt is reduced to direct MCP task acknowledgement', () => {
  const input = opencodeAdapter.buildActivationInput(
    [
      '### MISSION_CONTROL_ACTIVATION_REQUEST ###',
      'Please call get_task_details.',
      '--- ENVELOPE ---',
      '{"signal":"NEW_TASK","missionId":"mission-1","nodeId":"builder","sessionId":"session-123","attempt":2}',
      '--- END ENVELOPE ---',
    ].join('\n'),
  );

  assert.equal(input.preClear, '\x15');
  assert.match(input.paste, /NEW_TASK\. call get_task_details/);
  assert.match(input.paste, /missionId: "mission-1"/);
  assert.match(input.paste, /nodeId: "builder"/);
  assert.match(input.paste, /attempt: 2/);
  assert.match(input.paste, /complete_task/);
  assert.doesNotMatch(input.paste, /ENVELOPE/);
  assert.doesNotMatch(input.paste, /\x1b\[200~/);
  assert.equal(input.submit, '\r');
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
  assert.equal(launch.args.includes('--yolo'), false);
  assert.equal(launch.args.includes('--dangerously-skip-permissions'), false);
});

run('opencode headless launch uses run subcommand and supported non-interactive flags', () => {
  const launch = opencodeAdapter.buildLaunchCommand({
    sessionId: 'session-1',
    missionId: 'mission-1',
    nodeId: 'node-1',
    role: 'builder',
    agentId: 'agent-1',
    profileId: 'profile-1',
    workspaceDir: 'C:/workspace',
    mcpUrl: 'http://127.0.0.1:3741/mcp',
    executionMode: 'streaming_headless',
    model: 'anthropic/claude-sonnet-4',
    yolo: true,
  });

  assert.equal(launch.command, 'opencode');
  assert.equal(launch.promptDelivery, 'arg_text');
  assert.deepEqual(launch.args, [
    'run',
    '--format',
    'json',
    '--dir',
    'C:/workspace',
    '--model',
    'anthropic/claude-sonnet-4',
    '--dangerously-skip-permissions',
    '{prompt}',
  ]);
  assert.equal(launch.args.includes('--yolo'), false);
  assert.equal(launch.args.includes('--no-alt-screen'), false);
  assert.equal(JSON.parse(launch.env.OPENCODE_CONFIG_CONTENT).mcp['terminal-docks'].url, 'http://127.0.0.1:3741/mcp');
});
