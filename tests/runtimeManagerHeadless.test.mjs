import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { build } from 'esbuild';

const source = readFileSync(new URL('../src/lib/runtime/RuntimeManager.ts', import.meta.url), 'utf8');
const types = readFileSync(new URL('../src/lib/runtime/RuntimeTypes.ts', import.meta.url), 'utf8');

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function baseArgs(overrides = {}) {
  return {
    missionId: 'mission-1',
    nodeId: 'node-1',
    attempt: 1,
    role: 'builder',
    agentId: 'agent-1',
    profileId: null,
    cliId: 'codex',
    executionMode: 'interactive_pty',
    terminalId: 'terminal-1',
    paneId: 'pane-1',
    workspaceDir: '/tmp/runtime-manager-test',
    goal: 'exercise runtime manager behavior',
    ...overrides,
  };
}

async function loadRuntimeManagerModule() {
  const result = await build({
    entryPoints: [new URL('../src/lib/runtime/RuntimeManager.ts', import.meta.url).pathname],
    bundle: true,
    format: 'esm',
    platform: 'node',
    write: false,
    logLevel: 'silent',
    plugins: [runtimeManagerMockPlugin()],
  });

  const code = result.outputFiles[0].text;
  const url = `data:text/javascript;base64,${Buffer.from(code).toString('base64')}`;
  return import(url);
}

function runtimeManagerMockPlugin() {
  const mocks = new Map([
    ['../desktopApi', desktopApiMock()],
    ['./adapters/index.js', adapterIndexMock()],
    ['./TerminalRuntime.js', terminalRuntimeMock()],
    ['../missionRuntime.js', missionRuntimeMock()],
    ['../runtimeDispatcher.js', runtimeDispatcherMock()],
    ['../runtimeBootstrap.js', runtimeBootstrapMock()],
    ['../workers/mcpEventBus.js', mcpEventBusMock()],
    ['../cliDetection.js', cliDetectionMock()],
  ]);

  return {
    name: 'runtime-manager-test-mocks',
    setup(pluginBuild) {
      pluginBuild.onResolve({ filter: /.*/ }, args => {
        if (mocks.has(args.path)) {
          return { path: args.path, namespace: 'runtime-manager-test-mock' };
        }
        if (args.path === './RuntimeSession.js') {
          return { path: new URL('../src/lib/runtime/RuntimeSession.ts', import.meta.url).pathname };
        }
        return null;
      });

      pluginBuild.onLoad({ filter: /.*/, namespace: 'runtime-manager-test-mock' }, args => ({
        contents: mocks.get(args.path),
        loader: 'js',
      }));
    },
  };
}

function desktopApiMock() {
  return `
    const deps = () => globalThis.__runtimeManagerTestDeps;
    export async function listen(event, cb) {
      deps().desktopListeners.push({ event, cb });
      return () => deps().desktopUnlistened.push(event);
    }
    export async function invoke(cmd, payload) {
      deps().desktopInvocations.push({ cmd, payload });
      return null;
    }
  `;
}

function adapterIndexMock() {
  return `
    function adapterFor(cliId) {
      const id = cliId || 'codex';
      return {
        id,
        label: id,
        capabilities: {
          supportsHeadless: true,
          supportsMcpConfig: true,
          supportsHardToolRestrictions: false,
          supportsPermissions: true,
          requiresTrustPromptHandling: false,
          completionAuthority: 'mcp_tool',
        },
        buildLaunchCommand(context) {
          return {
            command: id,
            args: [],
            env: {},
            promptDelivery: context.executionMode === 'interactive_pty' ? 'interactive_pty' : 'stdin',
          };
        },
        detectReady(output) {
          return { ready: output.includes('ready'), confidence: output.includes('ready') ? 'high' : 'low' };
        },
        buildInitialPrompt(context) {
          return context.prompt;
        },
        detectPermissionRequest(output) {
          if (!output.includes('permission')) return null;
          return {
            detected: true,
            request: {
              permissionId: 'perm-1',
              category: 'shell_execution',
              rawPrompt: output,
              detail: 'permission requested',
            },
          };
        },
        buildPermissionResponse(decision) {
          return { input: decision === 'approve' ? 'y\\r' : 'n\\r' };
        },
        detectCompletion(output) {
          return output.includes('done') ? { detected: true, outcome: 'success' } : null;
        },
        normalizeOutput() {
          return [];
        },
        buildActivationInput(signal) {
          return { paste: signal, submit: '\\r' };
        },
      };
    }
    export function getCliAdapter(cliId) {
      if (!cliId) return null;
      return adapterFor(cliId);
    }
  `;
}

function terminalRuntimeMock() {
  return `
    const deps = () => globalThis.__runtimeManagerTestDeps;
    export async function checkMcpHealth() { return true; }
    export async function getMcpBaseUrl() { return 'http://localhost:3741'; }
    export async function getRecentTerminalOutput(terminalId) {
      deps().recentOutputRequests.push(terminalId);
      return deps().recentOutput || '';
    }
    export async function registerMcpSession(request) {
      deps().mcpRegistrations.push(request);
      return { ok: true };
    }
    export async function registerActivationDispatch(args) {
      deps().activationDispatches.push(args);
    }
    export async function acknowledgeActivation(args) {
      deps().activationAcks.push(args);
    }
    export async function startHeadlessRun(request) {
      deps().headlessRuns.push(request);
    }
    export async function writeToTerminal(terminalId, data) {
      deps().terminalWrites.push({ terminalId, data });
    }
    export async function isTerminalActive(terminalId) {
      deps().terminalActiveChecks.push(terminalId);
      return deps().terminalActive;
    }
    export async function registerTerminalMetadata(args) {
      deps().terminalMetadata.push(args);
    }
    export async function notifyMcpDisconnected(args) {
      deps().mcpDisconnects.push(args);
    }
  `;
}

function missionRuntimeMock() {
  return `
    export function buildNewTaskSignal(payload, baseUrl) {
      return JSON.stringify({ type: 'NEW_TASK', payload, baseUrl });
    }
  `;
}

function runtimeDispatcherMock() {
  return `
    export function buildStartAgentRunRequest(activationPayload, signal, config) {
      return {
        request: {
          runId: activationPayload.runId || 'run-1',
          missionId: activationPayload.missionId,
          nodeId: activationPayload.nodeId,
          attempt: activationPayload.attempt,
          sessionId: activationPayload.sessionId,
          agentId: activationPayload.agentId,
          cli: activationPayload.cliType,
          executionMode: activationPayload.executionMode,
          cwd: activationPayload.workspaceDir || null,
          command: activationPayload.cliType,
          args: [],
          env: {},
          prompt: signal,
          config,
        },
        error: null,
      };
    }
  `;
}

function runtimeBootstrapMock() {
  return `
    export function getRuntimeBootstrapContract() {
      return { handshakeEvent: 'agent:ready' };
    }
    export function buildRuntimeBootstrapRegistrationRequest(payload) {
      return {
        sessionId: payload.sessionId,
        missionId: payload.missionId,
        nodeId: payload.nodeId,
        attempt: payload.attempt,
        role: payload.role,
        agentId: payload.agentId,
        terminalId: payload.terminalId,
        cli: payload.cliType,
      };
    }
  `;
}

function mcpEventBusMock() {
  return `
    const deps = () => globalThis.__runtimeManagerTestDeps;
    export const mcpBus = {
      subscribe(sessionId, handler) {
        deps().mcpSubscriptions.push({ sessionId, handler });
        return () => deps().mcpUnsubscriptions.push(sessionId);
      },
    };
  `;
}

function cliDetectionMock() {
  return `
    export function detectCliFromTerminalOutput(output) {
      return output.includes('codex') ? { cli: 'codex' } : {};
    }
  `;
}

function resetRuntimeTestDeps(overrides = {}) {
  globalThis.__runtimeManagerTestDeps = {
    desktopListeners: [],
    desktopUnlistened: [],
    desktopInvocations: [],
    mcpSubscriptions: [],
    mcpUnsubscriptions: [],
    mcpRegistrations: [],
    activationDispatches: [],
    activationAcks: [],
    headlessRuns: [],
    terminalWrites: [],
    terminalActiveChecks: [],
    terminalMetadata: [],
    recentOutputRequests: [],
    mcpDisconnects: [],
    terminalActive: true,
    recentOutput: '',
    ...overrides,
  };
  return globalThis.__runtimeManagerTestDeps;
}

const { RuntimeManager } = await loadRuntimeManagerModule();

await run('RuntimeManager creates sessions and snapshots with an in-memory bridge', async () => {
  const deps = resetRuntimeTestDeps();
  const events = [];
  const snapshots = [];
  const bridgeTransitions = [];

  const manager = new RuntimeManager({
    onSessionStateChanged(session, from, to) {
      bridgeTransitions.push({ session, from, to });
    },
  });
  manager.subscribe(event => events.push(event));
  manager.subscribeSnapshot(snapshot => snapshots.push(snapshot));

  const session = await manager.createRuntimeForNode(baseArgs());
  session.transitionTo('running');

  assert.equal(deps.mcpSubscriptions.length, 1);
  assert.equal(events[0].type, 'session_created');
  assert.equal(events[0].sessionId, session.sessionId);
  assert.equal(events.at(-1).type, 'session_state_changed');
  assert.equal(events.at(-1).from, 'creating');
  assert.equal(events.at(-1).to, 'running');
  assert.equal(snapshots[0].sessions.length, 1);
  assert.equal(snapshots.at(-1).sessions[0].state, 'running');
  assert.deepEqual(bridgeTransitions, [{
    session: {
      sessionId: session.sessionId,
      nodeId: 'node-1',
      attempt: 1,
      terminalId: 'terminal-1',
      role: 'builder',
      cliId: 'codex',
    },
    from: 'creating',
    to: 'running',
  }]);

  manager.dispose();
});

await run('RuntimeManager sends terminal binding requests through the bridge', async () => {
  resetRuntimeTestDeps();
  const bindings = [];
  const manager = new RuntimeManager({
    bindRuntimeToTerminalPane(session) {
      bindings.push(session);
    },
    getTerminalState() {
      return { cli: 'codex', cliSource: 'stdout', liveRuntimeSessionIds: [] };
    },
  });
  const session = await manager.createRuntimeForNode(baseArgs({ missionId: 'adhoc-mission' }));

  await manager.launchCli(session.sessionId);

  assert.equal(session.state, 'running');
  assert.deepEqual(bindings, [{
    sessionId: session.sessionId,
    nodeId: 'node-1',
    attempt: 1,
    terminalId: 'terminal-1',
    role: 'builder',
    cliId: 'codex',
  }]);

  manager.dispose();
});

await run('RuntimeManager core behavior works with no bridge installed', async () => {
  resetRuntimeTestDeps();
  const events = [];
  const manager = new RuntimeManager();
  manager.subscribe(event => events.push(event));

  const session = await manager.createRuntimeForNode(baseArgs({
    missionId: 'adhoc-headless',
    executionMode: 'headless',
  }));

  await manager.launchCli(session.sessionId);

  assert.equal(session.state, 'running');
  assert.equal(manager.snapshot().activeCount, 1);
  assert.equal(events[0].type, 'session_created');
  assert.equal(events.at(-1).type, 'session_state_changed');

  manager.setBridge(null);
  session.transitionTo('completed');
  assert.equal(manager.snapshot().sessions[0].state, 'completed');

  manager.dispose();
});

await run('RuntimeManager keeps UI dependencies out of the core source', () => {
  assert.doesNotMatch(source, /store\/workspace/);
  assert.doesNotMatch(source, /useWorkspaceStore/);
  assert.match(types, /export interface RuntimeManagerBridge/);
  assert.match(source, /setBridge\(bridge: RuntimeManagerBridge \| null \| undefined\)/);
  assert.match(source, /this\.bridge\.onSessionStateChanged/);
  assert.match(source, /this\.bridge\.bindRuntimeToTerminalPane/);
  assert.doesNotMatch(source, /workflow-node-update/);
});
