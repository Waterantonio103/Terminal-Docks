import assert from 'node:assert/strict';
import {
  buildCliRunCommand,
  buildOpenCodeWorkflowConfigContent,
  buildCodexFollowupTaskSignal,
  buildCodexInteractiveLaunchArgs,
  buildCodexInteractiveLaunchCommand,
} from '../.tmp-tests/lib/cliCommandBuilders.js';
import { normalizeCliId, supportsHeadless } from '../.tmp-tests/lib/cliIdentity.js';
import { isModelCliId } from '../.tmp-tests/lib/models/modelTypes.js';
import { codexAdapter } from '../.tmp-tests/lib/runtime/adapters/codex.js';
import {
  assessPostAckTerminalProgress,
  evaluatePostAckWatchdog,
  isMeaningfulPostAckMcpEvent,
} from '../.tmp-tests/lib/runtime/RuntimeProgressWatchdog.js';
import { checkMcpHealthDetailed } from '../.tmp-tests/lib/runtime/TerminalRuntime.js';
import { buildCometRuntimeEnv, readCometEnv } from '../.tmp-tests/lib/runtimeEnv.js';
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
  assert.equal(command.env.COMET_SESSION_ID, 'session:mission:node:1');
  assert.equal(command.env.COMET_EXECUTION_MODE, 'streaming_headless');
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

run('Comet runtime env reads prefixed keys without dropping legacy compatibility', () => {
  const env = buildCometRuntimeEnv({
    sessionId: 'session-1',
    mcpUrl: 'http://localhost:3741/mcp',
    attempt: 2,
  });

  assert.equal(env.COMET_SESSION_ID, 'session-1');
  assert.equal(env.TD_SESSION_ID, 'session-1');
  assert.equal(readCometEnv(env, 'COMET_MCP_URL'), 'http://localhost:3741/mcp');
  assert.equal(readCometEnv(env, 'td_attempt'), '2');
  assert.equal(readCometEnv({ LOCAL_HTTP_URL: 'http://localhost:11434/v1' }, 'COMET_LOCAL_HTTP_URL', 'LOCAL_HTTP_URL'), 'http://localhost:11434/v1');
});

run('Comet runtime env sanitizes blank and nul-containing values', () => {
  const env = buildCometRuntimeEnv({
    sessionId: ' session-1\u0000 ',
    agentId: ' \u0000 ',
    missionId: 'mission-1',
    nodeId: '\u0000node-1 ',
    attempt: 0,
  });

  assert.equal(env.COMET_SESSION_ID, 'session-1');
  assert.equal(env.TD_SESSION_ID, 'session-1');
  assert.equal(env.COMET_NODE_ID, 'node-1');
  assert.equal(env.COMET_ATTEMPT, '0');
  assert.equal(env.COMET_AGENT_ID, undefined);
  assert.equal(readCometEnv({ COMET_SESSION_ID: ' session-2\u0000 ' }, 'COMET_SESSION_ID'), 'session-2');
  assert.equal(readCometEnv({ FALLBACK_KEY: ' fallback\u0000 ' }, ' \u0000 ', 'FALLBACK_KEY'), 'fallback');
});

run('codex headless command is disabled for normal workflow safety', () => {
  const command = buildCliRunCommand(payload({ cliType: 'codex' }));
  assert.equal(command.command, '');
  assert.equal(command.promptDelivery, 'unsupported');
  assert.match(command.unsupportedReason, /interactive PTY/);
});

run('CLI identity normalizes common separator variants', () => {
  assert.equal(normalizeCliId('open-code'), 'opencode');
  assert.equal(normalizeCliId('Open Code'), 'opencode');
  assert.equal(normalizeCliId('\u001b[36mOpen\u0000 Code\u001b[39m'), 'opencode');
  assert.equal(normalizeCliId('LM Studio'), 'lmstudio');
});

run('model discovery support follows canonical CLI aliases without enabling local runtimes', () => {
  assert.equal(isModelCliId('open-code'), true);
  assert.equal(isModelCliId('LM Studio'), false);
  assert.equal(isModelCliId('ollama'), false);
});

run('post-ack watchdog fails acknowledged stalled sessions as post_ack_no_progress', () => {
  const decision = evaluatePostAckWatchdog({
    snapshot: {
      acknowledgedAt: 0,
      lastProgressAt: 0,
      progressCount: 0,
      mcpEventCount: 0,
      terminalProgressCount: 0,
      expectedFileOutputCount: 0,
      permissionPromptCount: 0,
      warnedAt: 60_000,
    },
    now: 120_000,
    windowMs: 60_000,
  });

  assert.equal(decision.action, 'fail');
  assert.equal(decision.reason, 'post_ack_no_progress');
});

run('post-ack watchdog ignores acknowledged sessions that completed', () => {
  const decision = evaluatePostAckWatchdog({
    snapshot: {
      acknowledgedAt: 0,
      lastProgressAt: 0,
      progressCount: 0,
      mcpEventCount: 0,
      terminalProgressCount: 0,
      expectedFileOutputCount: 0,
      permissionPromptCount: 0,
      warnedAt: 60_000,
    },
    now: 180_000,
    windowMs: 60_000,
    completed: true,
  });

  assert.equal(decision.action, 'none');
});

run('post-ack watchdog treats zero warnedAt as an existing warning timestamp', () => {
  const decision = evaluatePostAckWatchdog({
    snapshot: {
      acknowledgedAt: 0,
      lastProgressAt: 0,
      progressCount: 0,
      mcpEventCount: 0,
      terminalProgressCount: 0,
      expectedFileOutputCount: 0,
      permissionPromptCount: 0,
      warnedAt: 0,
    },
    now: 120_000,
    windowMs: 60_000,
  });

  assert.equal(decision.action, 'fail');
  assert.equal(decision.reason, 'post_ack_no_progress');
});

run('post-ack watchdog treats progress as an extension and classifies later stalls separately', () => {
  const activeDecision = evaluatePostAckWatchdog({
    snapshot: {
      acknowledgedAt: 0,
      lastProgressAt: 70_000,
      progressCount: 1,
      mcpEventCount: 0,
      terminalProgressCount: 1,
      expectedFileOutputCount: 0,
      permissionPromptCount: 0,
      lastProgressSource: 'terminal_output',
      warnedAt: null,
    },
    now: 120_000,
    windowMs: 60_000,
  });
  assert.equal(activeDecision.action, 'none');

  const stalledDecision = evaluatePostAckWatchdog({
    snapshot: {
      acknowledgedAt: 0,
      lastProgressAt: 70_000,
      progressCount: 1,
      mcpEventCount: 0,
      terminalProgressCount: 1,
      expectedFileOutputCount: 0,
      permissionPromptCount: 0,
      lastProgressSource: 'terminal_output',
      warnedAt: 130_000,
    },
    now: 190_000,
    windowMs: 60_000,
  });
  assert.equal(stalledDecision.action, 'fail');
  assert.equal(stalledDecision.reason, 'post_ack_no_mcp_completion');
});

run('post-ack watchdog fails active sessions at the absolute no-completion cap', () => {
  const decision = evaluatePostAckWatchdog({
    snapshot: {
      acknowledgedAt: 0,
      lastProgressAt: 175_000,
      progressCount: 12,
      mcpEventCount: 2,
      terminalProgressCount: 8,
      expectedFileOutputCount: 2,
      permissionPromptCount: 0,
      lastProgressSource: 'terminal_output',
      warnedAt: null,
    },
    now: 181_000,
    windowMs: 60_000,
    maxRuntimeMs: 180_000,
  });

  assert.equal(decision.action, 'fail');
  assert.equal(decision.reason, 'post_ack_no_mcp_completion');
});

run('post-ack terminal progress ignores spinner-only output but accepts concrete tool progress', () => {
  assert.equal(assessPostAckTerminalProgress('\u001b[?25l\u001b[?2026h / \\ -').useful, false);
  const progress = assessPostAckTerminalProgress('Running command: npm test -- --runInBand');
  assert.equal(progress.useful, true);
  assert.equal(progress.source, 'known_long_running_progress');
  assert.equal(isMeaningfulPostAckMcpEvent('activation:acked'), false);
  assert.equal(isMeaningfulPostAckMcpEvent('agent:heartbeat'), true);
});

run('opencode is eligible for headless workflow execution', () => {
  assert.equal(supportsHeadless('opencode'), true);
});

run('opencode headless command uses official run mode with inline workflow config', () => {
  const command = buildCliRunCommand(payload({ cliType: 'opencode' }), {
    mcpUrl: 'http://127.0.0.1:3741#local',
    model: 'anthropic/claude-sonnet-4',
  });

  assert.equal(command.command, 'opencode');
  assert.equal(command.promptDelivery, 'arg_text');
  assert.deepEqual(command.args, [
    'run',
    '--format',
    'json',
    '--dir',
    'C:/workspace',
    '--model',
    'anthropic/claude-sonnet-4',
    '{prompt}',
  ]);
  assert.equal(command.args.includes('--yolo'), false);
  assert.equal(command.args.includes('--no-alt-screen'), false);

  const config = JSON.parse(command.env.OPENCODE_CONFIG_CONTENT);
  assert.equal(config.mcp['starlink'].type, 'remote');
  assert.equal(config.mcp['starlink'].url, 'http://127.0.0.1:3741/mcp');
  assert.equal(config.mcp['starlink'].enabled, true);
  assert.equal(config.permission, undefined);
});

run('opencode headless full access uses official dangerous skip flag', () => {
  const command = buildCliRunCommand(payload({ cliType: 'opencode' }), {
    mcpUrl: 'http://127.0.0.1:3741#local',
    model: 'anthropic/claude-sonnet-4',
    permissionMode: 'full',
  });

  assert.equal(command.command, 'opencode');
  assert.deepEqual(command.args, [
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
  assert.equal(JSON.parse(command.env.OPENCODE_CONFIG_CONTENT).permission, 'allow');
});

run('opencode headless dispatcher materializes activation prompt as final message arg', () => {
  const { request, error } = buildStartAgentRunRequest(
    payload({ cliType: 'opencode' }),
    'NEW_TASK. call get_task_details, then complete_task.',
    {
      mcpUrl: 'http://127.0.0.1:3741/mcp',
      model: 'anthropic/claude-sonnet-4',
    },
  );

  assert.equal(error, null);
  assert.ok(request);
  assert.equal(request.command, 'opencode');
  assert.equal(request.promptDelivery, 'arg_text');
  assert.equal(request.args.at(-1), 'NEW_TASK. call get_task_details, then complete_task.');
  assert.equal(request.args.includes('{prompt}'), false);
  assert.equal(JSON.parse(request.env.OPENCODE_CONFIG_CONTENT).mcp['starlink'].url, 'http://127.0.0.1:3741/mcp');
});

run('opencode workflow config preserves explicit OPENCODE_CONFIG_CONTENT override', () => {
  const customConfig = JSON.stringify({ permission: { bash: 'ask' } });
  const command = buildCliRunCommand(payload({ cliType: 'opencode' }), {
    customEnv: { OPENCODE_CONFIG_CONTENT: customConfig },
    mcpUrl: 'http://127.0.0.1:3741',
  });

  assert.equal(command.env.OPENCODE_CONFIG_CONTENT, customConfig);
  assert.equal(JSON.parse(buildOpenCodeWorkflowConfigContent('http://127.0.0.1:3741')).mcp['starlink'].url, 'http://127.0.0.1:3741/mcp');
});

run('codex interactive argv normalizes model and places yolo before final prompt', () => {
  const args = buildCodexInteractiveLaunchArgs({
    modelId: 'GPT-5.5',
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
    'mcp_servers.terminal-docks.enabled=false',
    '-c',
    'mcp_servers.node_repl.enabled=false',
    '--disable',
    'apps',
    '-c',
    'mcp_servers.starlink.url="http://127.0.0.1:3741/mcp?token=abc"',
    '-c',
    'mcp_servers.starlink.enabled=true',
    '-c',
    'mcp_servers.starlink.startup_timeout_sec=30',
    '-c',
    'mcp_servers.starlink.tool_timeout_sec=120',
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

run('codex interactive argv can omit global MCP disables for isolated CODEX_HOME', () => {
  const args = buildCodexInteractiveLaunchArgs({
    yolo: false,
    mcpUrl: 'http://127.0.0.1:3741/mcp?token=abc',
    bootstrapPrompt: 'Connect only to Comet-AI.',
    disableKnownGlobalMcps: false,
  });

  assert.equal(args.includes('mcp_servers.pencil.enabled=false'), false);
  assert.equal(args.includes('mcp_servers.excalidraw.enabled=false'), false);
  assert.equal(args.includes('mcp_servers.terminal-docks.enabled=false'), false);
  assert.equal(args.includes('mcp_servers.node_repl.enabled=false'), false);
  assert.equal(args.includes('--disable'), false);
  assert.equal(args.includes('approval_policy="never"'), false);
  assert.equal(args.includes('sandbox_mode="danger-full-access"'), false);
  assert.equal(args.includes('--sandbox'), true);
  assert.equal(args.includes('workspace-write'), true);
  assert.equal(args.includes('--ask-for-approval'), true);
  assert.equal(args.includes('mcp_servers.starlink.enabled=true'), true);
  assert.equal(args.at(-1), 'Connect only to Comet-AI.');
});

run('codex interactive argv maps restricted to official read-only approval flags', () => {
  const args = buildCodexInteractiveLaunchArgs({
    permissionMode: 'restricted',
    bootstrapPrompt: 'Inspect only.',
  });

  assert.deepEqual(args, [
    '-c',
    'mcp_servers.pencil.enabled=false',
    '-c',
    'mcp_servers.excalidraw.enabled=false',
    '-c',
    'mcp_servers.terminal-docks.enabled=false',
    '-c',
    'mcp_servers.node_repl.enabled=false',
    '--disable',
    'apps',
    '--sandbox',
    'read-only',
    '--ask-for-approval',
    'untrusted',
    '--no-alt-screen',
    'Inspect only.',
  ]);
});

run('codex interactive argv can trust an isolated workflow project', () => {
  const args = buildCodexInteractiveLaunchArgs({
    yolo: false,
    trustedProjectDir: 'C:\\VSCODE\\comet-ai',
    bootstrapPrompt: 'Fetch the task.',
    disableKnownGlobalMcps: false,
  });

  assert.equal(args.includes('projects."C:\\VSCODE\\comet-ai".trust_level="trusted"'), true);
  assert.equal(args.at(-1), 'Fetch the task.');
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
    '-c',
    'mcp_servers.terminal-docks.enabled=false',
    '-c',
    'mcp_servers.node_repl.enabled=false',
    '--disable',
    'apps',
    '--sandbox',
    'workspace-write',
    '--ask-for-approval',
    'untrusted',
    '--no-alt-screen',
    prompt,
  ]);
  assert.equal(args.at(-1), prompt);
});

run('codex shell fallback flattens the bootstrap prompt before shell quoting', () => {
  const command = buildCodexInteractiveLaunchCommand({
    modelId: 'gpt-5.4-mini',
    reasoningEffort: 'medium',
    yolo: false,
    bootstrapPrompt: 'You are a Comet-AI Codex runtime.\nA workflow task is ready for you.',
  });

  assert.equal(
    command.startsWith(
      'set "CODEX_HOME=%USERPROFILE%\\.codex" && codex -c mcp_servers.pencil.enabled=false -c mcp_servers.excalidraw.enabled=false -c mcp_servers.terminal-docks.enabled=false -c mcp_servers.node_repl.enabled=false --disable apps --sandbox workspace-write --ask-for-approval untrusted -c model_reasoning_effort=medium --model gpt-5.4-mini --no-alt-screen ',
    ),
    true,
  );
  assert.equal(command.includes('model_reasoning_effort=\\"medium\\"'), false);
  assert.equal(command.includes('\n'), false);
  assert.equal(command.includes('You are a Comet-AI Codex runtime. A workflow task is ready for you.'), true);
});

run('codex follow-up task signal is tiny and session-aware', () => {
  assert.equal(
    buildCodexFollowupTaskSignal(),
    'NEW_TASK. call get_current_task(); the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call complete_task as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.',
  );
  assert.equal(
    buildCodexFollowupTaskSignal({ sessionId: 'session-123' }),
    'NEW_TASK. call get_current_task({ sessionId: "session-123" }); the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call complete_task as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.',
  );
  assert.equal(
    buildCodexFollowupTaskSignal({ sessionId: 'session-123', missionId: 'mission-1', nodeId: 'builder', attempt: 2 }),
    'NEW_TASK. call get_task_details({ missionId: "mission-1", nodeId: "builder" }); the returned objective, assignment, roleInstructions, inbox, and legal targets are the actual task payload, even if no separate inbox payload exists. Execute that task, create the required output, then call complete_task({ missionId: "mission-1", nodeId: "builder", attempt: 2, outcome: "success" or "failure", summary: "<concise summary>" }) as the final MCP action. Do not stop after connecting, after reading task details, or after a normal final answer.',
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

  assert.equal(input.preClear, '\x15');
  assert.match(input.paste, /get_task_details/);
  assert.doesNotMatch(input.paste, /get_current_task/);
  assert.match(input.paste, /missionId: "mission-1"/);
  assert.match(input.paste, /nodeId: "builder"/);
  assert.match(input.paste, /attempt: 2/);
  assert.equal(input.submit, '\r');
});

run('codex permission detector ignores ordinary status output', () => {
  assert.equal(
    codexAdapter.detectPermissionRequest('gpt-5.5 high · Context 94% left · Context 6% used'),
    null,
  );
});

run('codex permission detector accepts MCP tool approval prompts', () => {
  const request = codexAdapter.detectPermissionRequest(
    'Allow the Starlink MCP server to run tool "connect_agent"?\n' +
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
    customEnv: { COMET_LOCAL_HTTP_MODEL: 'qwen2.5-coder' },
    mcpUrl: 'http://localhost:3741',
  });

  assert.equal(error, null);
  assert.ok(request);
  assert.equal(request.command, '__comet_ai_local_http__');
  assert.equal(request.cli, 'ollama');
  assert.equal(request.env.COMET_LOCAL_HTTP_URL, 'http://localhost:11434/v1/chat/completions');
  assert.equal(request.env.COMET_LOCAL_HTTP_MODEL, 'qwen2.5-coder');
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
