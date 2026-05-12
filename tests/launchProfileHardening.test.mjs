import assert from 'node:assert/strict';
import {
  buildGeminiInteractiveLaunchCommand,
  buildPtyLaunchCommand,
  buildPtyLaunchCommandParts,
  formatLaunchArgsForLog,
} from '../.tmp-tests/lib/cliCommandBuilders.js';
import { claudeAdapter } from '../.tmp-tests/lib/runtime/adapters/claude.js';
import { codexAdapter } from '../.tmp-tests/lib/runtime/adapters/codex.js';
import { geminiAdapter } from '../.tmp-tests/lib/runtime/adapters/gemini.js';
import { opencodeAdapter } from '../.tmp-tests/lib/runtime/adapters/opencode.js';

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function launchContext(overrides = {}) {
  return {
    sessionId: 'session-1',
    missionId: 'mission-1',
    nodeId: 'node-1',
    role: 'builder',
    agentId: 'agent-1',
    profileId: 'profile-1',
    workspaceDir: 'C:/workspace',
    mcpUrl: 'http://127.0.0.1:3741/mcp?token=abc&api_key=secret',
    executionMode: 'interactive',
    model: null,
    yolo: false,
    ...overrides,
  };
}

run('codex PTY launch preserves workspace, no alt screen, and supported yolo flag', () => {
  const { command, args } = buildPtyLaunchCommandParts('codex', {
    model: 'gpt-5.5',
    yolo: true,
    workspaceDir: 'C:/workspace',
  });

  assert.equal(command, 'codex');
  assert.deepEqual(args, [
    '--model',
    'gpt-5.5',
    '--cd',
    'C:/workspace',
    '--no-alt-screen',
    '--dangerously-bypass-approvals-and-sandbox',
  ]);
  assert.equal(args.includes('--yolo'), false);
});

run('codex adapter launch preserves MCP config shape without unsupported yolo alias', () => {
  const launch = codexAdapter.buildLaunchCommand(launchContext({
    model: 'gpt-5.5',
    yolo: true,
  }));

  assert.equal(launch.command, 'codex');
  assert.equal(launch.promptDelivery, 'interactive_pty');
  assert.equal(launch.args.includes('--no-alt-screen'), true);
  assert.equal(launch.args.includes('--cd'), true);
  assert.equal(launch.args.includes('--dangerously-bypass-approvals-and-sandbox'), true);
  assert.equal(launch.args.includes('--yolo'), false);
  assert.equal(launch.args.some(arg => arg.startsWith('mcp_servers.terminal-docks.url=')), true);
  assert.equal(launch.args.includes('mcp_servers.terminal-docks.startup_timeout_sec=30'), true);
  assert.equal(launch.args.includes('mcp_servers.terminal-docks.tool_timeout_sec=120'), true);
});

run('opencode TUI launch uses project positional and avoids invented stability flags', () => {
  const { command, args } = buildPtyLaunchCommandParts('opencode', {
    model: 'anthropic/claude-sonnet-4',
    yolo: true,
    workspaceDir: 'C:/workspace',
  });

  assert.equal(command, 'opencode');
  assert.deepEqual(args, ['C:/workspace', '--model', 'anthropic/claude-sonnet-4']);
  assert.equal(args.includes('--yolo'), false);
  assert.equal(args.includes('--dangerously-skip-permissions'), false);
  assert.equal(args.includes('--no-alt-screen'), false);
  assert.equal(args.includes('--mouse'), false);
  assert.equal(args.includes('--pure'), false);
});

run('opencode shell command quotes project paths with spaces', () => {
  assert.equal(
    buildPtyLaunchCommand('opencode', {
      model: 'anthropic/claude-sonnet-4',
      workspaceDir: 'C:/Work Space',
    }),
    'opencode "C:/Work Space" --model anthropic/claude-sonnet-4',
  );
});

run('claude launch uses supported model and permission flags only', () => {
  const { command, args } = buildPtyLaunchCommandParts('claude', {
    model: 'sonnet',
    yolo: true,
    workspaceDir: 'C:/workspace',
  });

  assert.equal(command, 'claude');
  assert.deepEqual(args, ['--model', 'sonnet', '--dangerously-skip-permissions']);
  assert.equal(args.includes('--bare'), false);
  assert.equal(args.includes('--screen-reader'), false);

  const launch = claudeAdapter.buildLaunchCommand(launchContext({ model: 'sonnet', yolo: true }));
  assert.deepEqual(launch.args, args);
});

run('gemini launch preserves model and yolo approval mode without screen-reader mode', () => {
  const { command, args } = buildPtyLaunchCommandParts('gemini', {
    model: 'gemini-2.5-pro',
    yolo: true,
    workspaceDir: 'C:/workspace',
  });

  assert.equal(command, 'gemini');
  assert.deepEqual(args, ['--model', 'gemini-2.5-pro', '--approval-mode', 'yolo']);
  assert.equal(args.includes('--screen-reader'), false);
  assert.equal(args.includes('--skip-trust'), false);

  const launch = geminiAdapter.buildLaunchCommand(launchContext({ model: 'gemini-2.5-pro', yolo: true }));
  assert.deepEqual(launch.args, args);
});

run('gemini prompt-interactive launch quotes startup prompt and preserves yolo mode', () => {
  const command = buildGeminiInteractiveLaunchCommand({
    modelId: 'gemini-2.5-pro',
    yolo: true,
    workspaceDir: 'C:/workspace',
    prompt: 'NEW_TASK. call get_task_details({ missionId: "m1", nodeId: "n1" })',
  });

  assert.match(command, /^gemini /);
  assert.match(command, /--model gemini-2\.5-pro/);
  assert.match(command, /--approval-mode yolo/);
  assert.match(command, /--prompt-interactive/);
  assert.match(command, /"NEW_TASK\. call get_task_details/);
  assert.doesNotMatch(command, /--screen-reader/);
});

run('runtime launch arg logging redacts MCP secrets and startup prompt', () => {
  const formatted = formatLaunchArgsForLog([
    '-c',
    'mcp_servers.terminal-docks.url="http://127.0.0.1:3741/mcp?token=abc&api_key=secret"',
    'initial prompt',
  ], { redactLastArg: true });

  assert.match(formatted, /token=<redacted>/);
  assert.match(formatted, /api_key=<redacted>/);
  assert.doesNotMatch(formatted, /abc|secret|initial prompt/);
  assert.match(formatted, /<prompt:redacted>/);
});

run('opencode adapter launch matches shared hardening builder', () => {
  const launch = opencodeAdapter.buildLaunchCommand(launchContext({
    model: 'anthropic/claude-sonnet-4',
    yolo: true,
  }));

  assert.deepEqual(launch.args, ['C:/workspace', '--model', 'anthropic/claude-sonnet-4']);
});
