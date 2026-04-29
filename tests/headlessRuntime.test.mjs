import assert from 'node:assert/strict';
import {
  buildCliRunCommand,
  buildCodexFollowupTaskSignal,
  buildCodexInteractiveLaunchCommand,
} from '../.tmp-tests/lib/cliCommandBuilders.js';
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

run('codex headless command uses true stdin and global flags before exec', () => {
  const command = buildCliRunCommand(payload({ cliType: 'codex' }));
  assert.equal(command.command, 'codex');
  assert.equal(command.promptDelivery, 'stdin');
  assert.deepEqual(command.args, ['--ask-for-approval', 'never', '--sandbox', 'workspace-write', 'exec', '--json', '--skip-git-repo-check', '-']);
  assert.equal(command.env.CODEX_HOME, undefined);
});

run('codex selected model is placed before exec', () => {
  const command = buildCliRunCommand(payload({ cliType: 'codex' }), { model: 'gpt-5.3-codex' });
  assert.equal(command.command, 'codex');
  assert.deepEqual(command.args.slice(0, 4), ['--model', 'gpt-5.3-codex', '--ask-for-approval', 'never']);
  assert.ok(command.args.indexOf('--model') < command.args.indexOf('exec'));
});

run('codex interactive launch flattens the bootstrap prompt before shell quoting', () => {
  const command = buildCodexInteractiveLaunchCommand({
    modelId: 'gpt-5.4-mini',
    yolo: false,
    bootstrapPrompt: 'You are a Terminal-Docks Codex runtime.\nA workflow task is ready for you.',
  });

  assert.equal(command.startsWith('codex --model gpt-5.4-mini --ask-for-approval never --sandbox workspace-write '), true);
  assert.equal(command.includes('\n'), false);
  assert.equal(command.includes('You are a Terminal-Docks Codex runtime. A workflow task is ready for you.'), true);
});

run('codex follow-up task signal is tiny and session-aware', () => {
  assert.equal(
    buildCodexFollowupTaskSignal(),
    'NEW_TASK. call get_current_task(), execute it, then complete_task().',
  );
  assert.equal(
    buildCodexFollowupTaskSignal({ sessionId: 'session-123' }),
    'NEW_TASK. call get_current_task({ sessionId: "session-123" }), execute it, then complete_task().',
  );
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
