import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import ts from 'typescript';

const root = resolve(new URL('..', import.meta.url).pathname);
const tmpRoot = mkdtempSync(join(tmpdir(), 'td-provider-adapters-'));
const fixtureRoot = resolve(root, 'tests/fixtures/providers');

function transpileAdapter(adapterName) {
  const sourcePath = resolve(root, `src/lib/runtime/adapters/${adapterName}.ts`);
  const source = readFileSync(sourcePath, 'utf8');
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.ES2020,
      target: ts.ScriptTarget.ES2020,
      importsNotUsedAsValues: ts.ImportsNotUsedAsValues.Remove,
    },
    fileName: sourcePath,
  }).outputText;

  const outputPath = join(tmpRoot, `${adapterName}.mjs`);
  writeFileSync(outputPath, compiled);
  return import(pathToFileURL(outputPath));
}

function fixture(provider, name) {
  return readFileSync(resolve(fixtureRoot, provider, name), 'utf8').trimEnd();
}

function assertProviderFixtureSet(provider, expectedNames) {
  const providerDir = resolve(fixtureRoot, provider);
  assert.equal(existsSync(providerDir), true, `${provider} fixture directory should exist`);
  const actual = new Set(readdirSync(providerDir));
  for (const expectedName of expectedNames) {
    assert.equal(actual.has(expectedName), true, `${provider} fixture ${expectedName} should exist`);
    const content = fixture(provider, expectedName);
    assert.ok(content.split(/\r?\n/).length >= 2, `${provider}/${expectedName} should be transcript-shaped`);
  }
}

function launchContext(overrides = {}) {
  return {
    sessionId: 'session-1',
    missionId: 'mission-1',
    nodeId: 'builder',
    role: 'builder',
    agentId: 'agent-1',
    profileId: 'profile-1',
    workspaceDir: '/workspace',
    mcpUrl: 'http://localhost:3741/mcp',
    executionMode: 'interactive_pty',
    ...overrides,
  };
}

function taskContext(overrides = {}) {
  return {
    sessionId: 'session-1',
    missionId: 'mission-1',
    nodeId: 'builder',
    role: 'builder',
    agentId: 'agent-1',
    attempt: 2,
    taskSeq: 4,
    prompt: 'Implement the change',
    payloadJson: '{"objective":"Implement the change"}',
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

function kinds(events) {
  return events.map(event => event.kind);
}

const { codexAdapter } = await transpileAdapter('codex');
const { claudeAdapter } = await transpileAdapter('claude');

run('Provider transcript fixture directories cover required states', () => {
  assertProviderFixtureSet('codex', [
    'idle-ready.txt',
    'running.txt',
    'completed.txt',
    'failed.txt',
    'permission-shell.txt',
    'trust-prompt.txt',
    'interrupted.txt',
    'prompt-truncation-bootstrap.txt',
    'bracketed-paste-newlines.txt',
  ]);
  assertProviderFixtureSet('claude', [
    'idle-ready.txt',
    'running.txt',
    'completed.txt',
    'failed.txt',
    'permission-file.txt',
    'trust-prompt.txt',
    'interrupted.txt',
    'bracketed-paste-newlines.txt',
  ]);
});

run('Codex adapter declares provider capabilities', () => {
  assert.deepEqual(codexAdapter.capabilities, {
    supportsHeadless: true,
    supportsMcpConfig: true,
    supportsHardToolRestrictions: true,
    supportsPermissions: true,
    requiresTrustPromptHandling: true,
    completionAuthority: 'process_exit',
  });
  assert.equal(codexAdapter.execMode, 'exec_stdin');
});

run('Claude adapter declares provider capabilities', () => {
  assert.deepEqual(claudeAdapter.capabilities, {
    supportsHeadless: true,
    supportsMcpConfig: true,
    supportsHardToolRestrictions: false,
    supportsPermissions: true,
    requiresTrustPromptHandling: true,
    completionAuthority: 'mcp_tool',
  });
});

run('Codex readiness and output parsing use transcript fixtures', () => {
  const idle = fixture('codex', 'idle-ready.txt');
  const running = fixture('codex', 'running.txt');

  assert.equal(codexAdapter.detectReady(idle).ready, true);
  assert.equal(codexAdapter.detectReady(idle).confidence, 'high');
  assert.equal(codexAdapter.detectReady(running).ready, false);

  assert.deepEqual(kinds(codexAdapter.normalizeOutput(idle)), ['banner', 'ready']);
  assert.deepEqual(kinds(codexAdapter.normalizeOutput(running)), ['banner']);
});

run('Codex permission, trust, completion, and interruption fixtures classify correctly', () => {
  const permission = codexAdapter.detectPermissionRequest(fixture('codex', 'permission-shell.txt'));
  assert.equal(permission?.request.category, 'shell_execution');
  assert.match(permission?.request.rawPrompt ?? '', /bash command npm test/i);
  assert.equal(codexAdapter.buildPermissionResponse('approve', permission.request).input, 'y\r');
  assert.equal(codexAdapter.buildPermissionResponse('deny', permission.request).input, 'n\r');

  const trust = codexAdapter.detectPermissionRequest(fixture('codex', 'trust-prompt.txt'));
  assert.equal(trust?.request.category, 'unknown');
  assert.match(trust?.request.rawPrompt ?? '', /trust this workspace/i);

  assert.equal(codexAdapter.detectCompletion(fixture('codex', 'completed.txt'))?.outcome, 'success');
  assert.equal(codexAdapter.detectCompletion(fixture('codex', 'failed.txt'))?.outcome, 'failure');
  assert.equal(codexAdapter.detectCompletion(fixture('codex', 'interrupted.txt'))?.outcome, 'failure');
});

run('Claude readiness and output parsing use transcript fixtures', () => {
  const idle = fixture('claude', 'idle-ready.txt');
  const running = fixture('claude', 'running.txt');

  assert.equal(claudeAdapter.detectReady(idle).ready, true);
  assert.equal(claudeAdapter.detectReady(idle).confidence, 'high');
  assert.equal(claudeAdapter.detectReady(running).ready, false);

  assert.deepEqual(kinds(claudeAdapter.normalizeOutput(idle)), ['banner']);
  assert.deepEqual(kinds(claudeAdapter.normalizeOutput(running)), ['unknown']);
});

run('Claude permission, trust, completion, and interruption fixtures classify correctly', () => {
  const permission = claudeAdapter.detectPermissionRequest(fixture('claude', 'permission-file.txt'));
  assert.equal(permission?.request.category, 'file_edit');
  assert.match(permission?.request.rawPrompt ?? '', /approve edit file/i);
  assert.equal(claudeAdapter.buildPermissionResponse('approve', permission.request).input, 'y\r');
  assert.equal(claudeAdapter.buildPermissionResponse('deny', permission.request).input, 'n\r');

  const trust = claudeAdapter.detectPermissionRequest(fixture('claude', 'trust-prompt.txt'));
  assert.equal(trust?.request.category, 'unknown');
  assert.match(trust?.request.rawPrompt ?? '', /grant access/i);

  assert.equal(claudeAdapter.detectCompletion(fixture('claude', 'completed.txt'))?.outcome, 'success');
  assert.equal(claudeAdapter.detectCompletion(fixture('claude', 'failed.txt'))?.outcome, 'failure');
  assert.equal(claudeAdapter.detectCompletion(fixture('claude', 'interrupted.txt'))?.outcome, 'failure');
});

run('Codex input formatting shortens bootstrap and task activation safely', () => {
  const headless = codexAdapter.buildLaunchCommand(launchContext({ executionMode: 'headless' }));
  assert.equal(headless.command, 'codex');
  assert.deepEqual(headless.args, ['exec', '--json', '--skip-git-repo-check', '-a', 'never', '-']);
  assert.equal(headless.promptDelivery, 'stdin');
  assert.equal(headless.env.TD_MCP_URL, 'http://localhost:3741/mcp');

  const taskPrompt = codexAdapter.buildInitialPrompt(taskContext());
  assert.match(taskPrompt, /get_task_details\(\{ missionId: "mission-1", nodeId: "builder" \}\)/);

  const activationInput = codexAdapter.buildActivationInput(fixture('codex', 'bracketed-paste-newlines.txt'));
  assert.equal(activationInput.preClear, '\x15');
  assert.match(activationInput.paste, /^\x1b\[200~/);
  assert.match(activationInput.paste, /get_task_details/);
  assert.doesNotMatch(activationInput.paste, /\n/);
  assert.equal(activationInput.submit, '\r');

  const shortenedBootstrap = codexAdapter.buildActivationInput(fixture('codex', 'prompt-truncation-bootstrap.txt'));
  assert.match(shortenedBootstrap.paste, /Connect to MCP: http:\/\/localhost:3741\/mcp/);
  assert.match(shortenedBootstrap.paste, /connect_agent\(role="builder", agentId="agent-1", terminalId="term-1"/);
  assert.doesNotMatch(shortenedBootstrap.paste, /additional instructions/);
  assert.doesNotMatch(shortenedBootstrap.paste, /\n/);
});

run('Claude launch and activation formatting preserve MCP runtime context', () => {
  const headless = claudeAdapter.buildLaunchCommand(launchContext({ executionMode: 'headless' }));
  assert.equal(headless.command, 'claude');
  assert.deepEqual(headless.args, ['--print', '{prompt}']);
  assert.equal(headless.env.TD_MCP_URL, 'http://localhost:3741/mcp');

  const activationInput = claudeAdapter.buildActivationInput(fixture('claude', 'bracketed-paste-newlines.txt'));
  assert.match(activationInput.paste, /^\x15\x1b\[200~/);
  assert.doesNotMatch(activationInput.paste, /\n/);
  assert.equal(activationInput.submit, '\r');
});

run('RuntimeManager delegates process-exit completion policy to adapter metadata', () => {
  const source = readFileSync(resolve(root, 'src/lib/runtime/RuntimeManager.ts'), 'utf8');
  assert.match(source, /adapter\.capabilities\.completionAuthority === 'mcp_tool'/);
  assert.doesNotMatch(source, /session\.cliId === 'claude'/);
  assert.doesNotMatch(source, /session\.cliId === 'ollama'/);
  assert.doesNotMatch(source, /session\.cliId === 'lmstudio'/);
});
