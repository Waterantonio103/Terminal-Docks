import assert from 'node:assert/strict';
import { buildCliRunCommand } from '../.tmp-tests/lib/cliCommandBuilders.js';
import { buildStartAgentRunRequest } from '../.tmp-tests/lib/runtimeDispatcher.js';

function payload(overrides = {}) {
  return {
    activationId: 'activation:mission:node:1',
    missionId: 'mission',
    runId: 'run:mission:node:1',
    nodeId: 'node',
    role: 'builder',
    cliType: 'custom',
    executionMode: 'streaming_headless',
    terminalId: 'term-node',
    sessionId: 'session:mission:node:1',
    agentId: 'agent:mission:node:term-node',
    attempt: 1,
    goal: 'Ship it',
    workspaceDir: 'C:/workspace',
    expectedNextAction: {
      signal: 'NEW_TASK',
      requiredFollowUp: [],
      handoffContract: 'handoff_task',
    },
    emittedAt: 1710000000000,
    ...overrides,
  };
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

run('custom command builder preserves prompt file and runtime variables', () => {
  const command = buildCliRunCommand(payload(), {
    customCommand: 'node',
    customArgs: ['worker.mjs', '{promptPath}', '{mcpUrl}', '{sessionId}'],
    customEnv: { EXTRA: '{nodeId}' },
    mcpUrl: 'http://localhost:3741',
  });

  assert.equal(command.command, 'node');
  assert.deepEqual(command.args, ['worker.mjs', '{promptPath}', '{mcpUrl}', '{sessionId}']);
  assert.equal(command.promptDelivery, 'arg_file');
  assert.equal(command.env.TD_SESSION_ID, 'session:mission:node:1');
  assert.equal(command.env.TD_EXECUTION_MODE, 'streaming_headless');
});

run('runtime dispatcher materializes non-path variables and keeps promptPath for Rust', () => {
  const { request, error } = buildStartAgentRunRequest(payload(), 'hello', {
    customCommand: 'node',
    customArgs: ['worker.mjs', '{promptPath}', '{mcpUrl}', '{sessionId}', '{attempt}'],
    customEnv: { EXTRA: '{nodeId}' },
    mcpUrl: 'http://localhost:3741',
  });

  assert.equal(error, null);
  assert.ok(request);
  assert.deepEqual(request.args, [
    'worker.mjs',
    '{promptPath}',
    'http://localhost:3741',
    'session:mission:node:1',
    '1',
  ]);
  assert.equal(request.env.EXTRA, 'node');
  assert.equal(request.prompt, 'hello');
});

run('unsupported CLI returns an actionable reason', () => {
  const command = buildCliRunCommand(payload({ cliType: 'codex' }));
  assert.equal(command.promptDelivery, 'unsupported');
  assert.match(command.unsupportedReason ?? '', /interactive PTY|custom command/i);
});

run('local HTTP runtimes share the headless adapter request path', () => {
  const { request, error } = buildStartAgentRunRequest(payload({ cliType: 'ollama' }), 'hello', {
    customEnv: { TD_LOCAL_HTTP_MODEL: 'qwen2.5-coder' },
    mcpUrl: 'http://localhost:3741',
  });

  assert.equal(error, null);
  assert.ok(request);
  assert.equal(request.command, '__terminal_docks_local_http__');
  assert.equal(request.cli, 'ollama');
  assert.equal(request.env.TD_LOCAL_HTTP_URL, 'http://localhost:11434/v1/chat/completions');
  assert.equal(request.env.TD_LOCAL_HTTP_MODEL, 'qwen2.5-coder');
  assert.equal(request.prompt, 'hello');
});
