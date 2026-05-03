import assert from 'node:assert/strict';
import {
  buildCliRunCommand,
  buildCodexFollowupTaskSignal,
  buildCodexInteractiveLaunchArgs,
  buildCodexInteractiveLaunchCommand,
} from '../.tmp-tests/lib/cliCommandBuilders.js';
import { codexAdapter } from '../.tmp-tests/lib/runtime/adapters/codex.js';
import { checkMcpHealthDetailed } from '../.tmp-tests/lib/runtime/TerminalRuntime.js';
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

async function runAsync(name, fn) {
  try {
    await fn();
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

run('codex headless command is disabled for normal workflow safety', () => {
  const command = buildCliRunCommand(payload({ cliType: 'codex' }));
  assert.equal(command.command, '');
  assert.equal(command.promptDelivery, 'unsupported');
  assert.match(command.unsupportedReason, /interactive PTY/);
});

run('codex interactive argv places model and yolo before final prompt', () => {
  const args = buildCodexInteractiveLaunchArgs({
    modelId: 'gpt-5.5',
    yolo: true,
    workspaceDir: 'C:/workspace',
    mcpUrl: 'http://127.0.0.1:3741/mcp?token=abc',
    bootstrapPrompt: 'Say "hello"',
  });

  assert.deepEqual(args, [
    '-c',
    'mcp_servers.pencil.enabled=false',
    '-c',
    'mcp_servers.excalidraw.enabled=false',
    '-c',
    'mcp_servers.terminal-docks.url="http://127.0.0.1:3741/mcp?token=abc"',
    '--model',
    'gpt-5.5',
    '--cd',
    'C:/workspace',
    '--no-alt-screen',
    '--dangerously-bypass-approvals-and-sandbox',
    'Say "hello"',
  ]);
  assert.equal(args.at(-1), 'Say "hello"');
});

run('codex interactive argv preserves complex prompt as final argument', () => {
  const prompt = 'Say "hello"\nit\'s broken\n{"key":"value"}\n`backtick`';
  const args = buildCodexInteractiveLaunchArgs({
    modelId: null,
    yolo: false,
    bootstrapPrompt: prompt,
  });

  assert.deepEqual(args, [
    '-c',
    'mcp_servers.pencil.enabled=false',
    '-c',
    'mcp_servers.excalidraw.enabled=false',
    '--no-alt-screen',
    prompt,
  ]);
  assert.equal(args.at(-1), prompt);
});

run('codex shell fallback flattens the bootstrap prompt before shell quoting', () => {
  const command = buildCodexInteractiveLaunchCommand({
    modelId: 'gpt-5.4-mini',
    yolo: false,
    bootstrapPrompt: 'You are a Terminal-Docks Codex runtime.\nA workflow task is ready for you.',
  });

  assert.equal(
    command.startsWith(
      'codex -c mcp_servers.pencil.enabled=false -c mcp_servers.excalidraw.enabled=false --model gpt-5.4-mini --no-alt-screen ',
    ),
    true,
  );
  assert.equal(command.includes('\n'), false);
  assert.equal(command.includes('You are a Terminal-Docks Codex runtime. A workflow task is ready for you.'), true);
});

run('codex follow-up task signal is tiny and session-aware', () => {
  assert.equal(
    buildCodexFollowupTaskSignal(),
    'NEW_TASK. call get_current_task(), execute it, then call complete_task as the final MCP action. Do not stop after a normal final answer.',
  );
  assert.equal(
    buildCodexFollowupTaskSignal({ sessionId: 'session-123' }),
    'NEW_TASK. call get_current_task({ sessionId: "session-123" }), execute it, then call complete_task as the final MCP action. Do not stop after a normal final answer.',
  );
  assert.equal(
    buildCodexFollowupTaskSignal({ sessionId: 'session-123', missionId: 'mission-1', nodeId: 'builder', attempt: 2 }),
    'NEW_TASK. call get_task_details({ missionId: "mission-1", nodeId: "builder" }), execute it, then call complete_task({ missionId: "mission-1", nodeId: "builder", attempt: 2, outcome: "success" or "failure", summary: "<concise summary>" }) as the final MCP action. Do not stop after a normal final answer.',
  );
});

run('codex activation prompt uses registered graph task tool', () => {
  const input = codexAdapter.buildActivationInput(
    [
      '### MISSION_CONTROL_ACTIVATION_REQUEST ###',
      '--- ENVELOPE ---',
      '{"signal":"NEW_TASK","missionId":"mission-1","nodeId":"builder","sessionId":"session-123","attempt":2}',
      '--- END ENVELOPE ---',
    ].join('\n'),
  );

  assert.match(input.paste, /get_task_details/);
  assert.doesNotMatch(input.paste, /get_current_task/);
  assert.match(input.paste, /missionId: "mission-1"/);
  assert.match(input.paste, /nodeId: "builder"/);
  assert.match(input.paste, /attempt: 2/);
});

run('codex permission detector ignores ordinary status output', () => {
  assert.equal(
    codexAdapter.detectPermissionRequest('gpt-5.5 high · Context 94% left · Context 6% used'),
    null,
  );
});

run('codex permission detector accepts MCP tool approval prompts', () => {
  const request = codexAdapter.detectPermissionRequest(
    'Allow the terminal-docks MCP server to run tool "connect_agent"?\n' +
      '  1. Allow\n' +
      '  2. Allow for this session\n' +
      '  3. Always allow\n' +
      '  4. Cancel\n' +
      'enter to submit | esc to cancel',
  );

  assert.equal(request?.detected, true);
  assert.match(request?.request.rawPrompt ?? '', /connect_agent/);
});

run('codex completion detector ignores contract instructions', () => {
  assert.equal(
    codexAdapter.detectCompletion('Use complete_task only after your contribution or verification is done.'),
    null,
  );
  assert.equal(
    codexAdapter.detectCompletion('A normal final answer does not complete the node or advance the workflow.'),
    null,
  );
});

run('codex completion detector recognizes completed turn footer', () => {
  const completion = codexAdapter.detectCompletion('\n────────────────\n─ Worked for 1m 02s ─\n');
  assert.equal(completion?.detected, true);
  assert.equal(completion?.outcome, 'success');
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

await runAsync('MCP health check times out stalled fetches', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init = {}) => new Promise((_resolve, reject) => {
    init.signal?.addEventListener('abort', () => {
      const err = new Error('aborted');
      err.name = 'AbortError';
      reject(err);
    });
  });

  try {
    const result = await checkMcpHealthDetailed({
      baseUrl: 'http://127.0.0.1:3741',
      timeoutMs: 10,
    });
    assert.equal(result.ok, false);
    assert.equal(result.timedOut, true);
    assert.match(result.error ?? '', /mcp_health_timeout/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});
