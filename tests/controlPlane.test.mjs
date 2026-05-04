import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { BackendRpcClient, ControlPlaneClient } from '../scripts/control-plane-client.mjs';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-control-plane-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const tdctlPath = resolve(repoRoot, 'scripts/tdctl.mjs');
const backendManifestPath = resolve(repoRoot, 'backend/Cargo.toml');
const backendBinPath = resolve(repoRoot, 'backend/target/debug/backend');
let builtBackendPath = null;

const {
  executeInspectAgentRun,
  executeListAgentRuns,
  executeListRuntimeSessions,
  resetStarlinkState,
  seedAgentRun,
  seedAgentRuntimeSession,
} = await import('../mcp-server/server.mjs');

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

function extractText(result) {
  return result?.content?.[0]?.text ?? '';
}

function ensureBackendBinary() {
  if (!builtBackendPath) {
    execFileSync('cargo', ['build', '--manifest-path', backendManifestPath], {
      cwd: repoRoot,
      stdio: 'inherit',
    });
    assert.ok(existsSync(backendBinPath), `Expected backend binary at ${backendBinPath}`);
    builtBackendPath = backendBinPath;
  }
  return builtBackendPath;
}

function sampleMissionGraph(missionId) {
  return {
    missionId,
    graphId: `graph:${missionId}`,
    task: {
      nodeId: 'builder',
      prompt: 'Verify the control-plane workflow launch path.',
      mode: 'build',
      workspaceDir: null,
    },
    metadata: {
      compiledAt: 1710000000000,
      sourceGraphId: `graph:${missionId}`,
      startNodeIds: ['builder'],
      executionLayers: [['builder']],
      authoringMode: 'graph',
      presetId: null,
      runVersion: 1,
    },
    nodes: [
      {
        id: 'builder',
        roleId: 'builder',
        profileId: null,
        instructionOverride: 'Record a pending activation only.',
        capabilities: [],
        requirements: null,
        terminal: {
          terminalId: 'term-builder',
          terminalTitle: 'Builder',
          cli: 'custom',
          executionMode: 'streaming_headless',
          paneId: null,
          reusedExisting: false,
        },
      },
    ],
    edges: [],
  };
}

function headlessRunRequest(root, runId = 'run:e2e:headless:1') {
  return {
    runId,
    missionId: 'mission-e2e-headless',
    nodeId: 'headless',
    attempt: 1,
    sessionId: 'session:mission-e2e-headless:headless:1',
    agentId: 'agent:mission-e2e-headless:headless:term-headless',
    cli: 'custom',
    executionMode: 'headless',
    cwd: root,
    command: process.execPath,
    args: ['-e', 'setTimeout(() => {}, 10000)'],
    env: {},
    prompt: 'Hold until the control plane kills this run.',
    timeoutMs: 30000,
  };
}

function runTdctl(args, options = {}) {
  return execFileSync('node', [tdctlPath, ...args], {
    cwd: options.cwd ?? repoRoot,
    env: { ...process.env, ...(options.env ?? {}) },
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
}

function assertTdctlFails(args, match, options = {}) {
  assert.throws(
    () => runTdctl(args, options),
    error => {
      const output = `${error.stdout ?? ''}${error.stderr ?? ''}`;
      assert.match(output, match);
      return true;
    },
  );
}

class FakeRpc {
  constructor() {
    this.calls = [];
  }

  request(cmd, payload) {
    this.calls.push({ cmd, payload });
    return Promise.resolve({ cmd, payload });
  }

  close() {
    this.closed = true;
  }
}

try {
  await run('ControlPlaneClient delegates workflow, headless, session list, inspect, and kill to backend RPC', async () => {
    const rpc = new FakeRpc();
    const client = new ControlPlaneClient(rpc);

    await client.launchWorkflow('mission-1', { missionId: 'mission-1' });
    await client.startHeadlessRun({ runId: 'run-1' });
    await client.listSessions({ missionId: 'mission-1' });
    await client.inspectSession('run-1');
    await client.killSession('run-1', 'test');

    assert.deepEqual(rpc.calls.map(call => call.cmd), [
      'start_mission_graph',
      'start_agent_run',
      'list_agent_runs',
      'get_agent_run',
      'cancel_agent_run',
    ]);
    assert.deepEqual(rpc.calls[0].payload, { missionId: 'mission-1', graph: { missionId: 'mission-1' } });
    assert.deepEqual(rpc.calls[4].payload, { runId: 'run-1', reason: 'test' });
  });

  await run('tdctl exposes documented commands without starting backend for help', () => {
    const output = runTdctl(['--help']);
    assert.match(output, /workflow launch/);
    assert.match(output, /run headless/);
    assert.match(output, /sessions list/);
    assert.match(output, /sessions inspect/);
    assert.match(output, /sessions kill/);
  });

  await run('MCP supervisor ops expose persisted runtime sessions and agent runs', () => {
    resetStarlinkState();
    seedAgentRuntimeSession({
      sessionId: 'session:mission-1:builder:1',
      agentId: 'agent:mission-1:builder',
      missionId: 'mission-1',
      nodeId: 'builder',
      attempt: 1,
      terminalId: 'term-builder',
      status: 'running',
    });
    seedAgentRun({
      runId: 'run:mission-1:builder:1',
      missionId: 'mission-1',
      nodeId: 'builder',
      sessionId: 'session:mission-1:builder:1',
      agentId: 'agent:mission-1:builder',
      cli: 'codex',
      executionMode: 'headless',
      command: 'codex',
      args: ['exec', '-'],
      env: { TD_MISSION_ID: 'mission-1' },
      status: 'running',
    });

    const sessions = JSON.parse(extractText(executeListRuntimeSessions({ missionId: 'mission-1' })));
    assert.equal(sessions.length, 1);
    assert.equal(sessions[0].sessionId, 'session:mission-1:builder:1');

    const runs = JSON.parse(extractText(executeListAgentRuns({ missionId: 'mission-1' })));
    assert.equal(runs.length, 1);
    assert.equal(runs[0].runId, 'run:mission-1:builder:1');

    const inspected = JSON.parse(extractText(executeInspectAgentRun({ runId: 'run:mission-1:builder:1' })));
    assert.deepEqual(inspected.args, ['exec', '-']);
    assert.equal(inspected.env.TD_MISSION_ID, 'mission-1');

    const missing = executeInspectAgentRun({ runId: 'missing' });
    assert.equal(missing.isError, true);
  });

  await run('tdctl workflow launch, list, and inspect use real backend JSON-RPC responses', () => {
    const backendPath = ensureBackendBinary();
    const root = mkdtempSync(join(tmpdir(), 'terminal-docks-tdctl-e2e-'));
    try {
      const missionId = 'mission-e2e-workflow';
      const missionPath = join(root, 'compiled-mission.json');
      writeFileSync(missionPath, JSON.stringify(sampleMissionGraph(missionId), null, 2));

      const env = { TD_BACKEND_BIN: backendPath, TD_BACKEND_CWD: root };
      assert.equal(runTdctl(['workflow', 'launch', '--mission', missionPath], { env }).trim(), 'null');

      const runs = JSON.parse(runTdctl(['sessions', 'list', '--mission-id', missionId], { env }));
      assert.equal(runs.length, 1);
      assert.equal(runs[0].runId, `run:${missionId}:builder:1`);
      assert.equal(runs[0].status, 'queued');

      const inspected = JSON.parse(runTdctl(['sessions', 'inspect', `run:${missionId}:builder:1`], { env }));
      assert.equal(inspected.missionId, missionId);
      assert.equal(inspected.command, 'custom');
      assert.equal(inspected.executionMode, 'streaming_headless');
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  await run('ControlPlaneClient drives real backend headless list, inspect, and kill paths', async () => {
    const backendPath = ensureBackendBinary();
    const root = mkdtempSync(join(tmpdir(), 'terminal-docks-backend-e2e-'));
    const rpc = new BackendRpcClient({ backendPath, cwd: root });
    const client = new ControlPlaneClient(rpc);
    try {
      const request = headlessRunRequest(root);
      const started = await client.startHeadlessRun(request);
      assert.equal(started.runId, request.runId);
      assert.equal(started.status, 'running');

      const runs = await client.listSessions({ missionId: request.missionId });
      assert.equal(runs.length, 1);
      assert.equal(runs[0].runId, request.runId);

      const inspected = await client.inspectSession(request.runId);
      assert.equal(inspected.command, process.execPath);
      assert.deepEqual(inspected.args, request.args);

      assert.equal(await client.killSession(request.runId, 'test_control_plane_kill'), null);
      const killed = await client.inspectSession(request.runId);
      assert.equal(killed.status, 'cancelled');
      assert.equal(killed.error, 'test_control_plane_kill');
    } finally {
      client.close();
      rmSync(root, { recursive: true, force: true });
    }
  });

  await run('tdctl reports missing backend, invalid JSON, unknown run ID, and backend command failure', () => {
    const backendPath = ensureBackendBinary();
    const root = mkdtempSync(join(tmpdir(), 'terminal-docks-tdctl-errors-'));
    try {
      const env = { TD_BACKEND_BIN: backendPath, TD_BACKEND_CWD: root };
      const invalidPath = join(root, 'invalid.json');
      const failingRunPath = join(root, 'failing-run.json');
      writeFileSync(invalidPath, '{not-json');
      writeFileSync(failingRunPath, JSON.stringify({
        ...headlessRunRequest(root, 'run:e2e:failing:1'),
        command: '__terminal_docks_missing_command__',
        args: [],
      }));

      assertTdctlFails(['sessions', 'list'], /Backend binary not found/, {
        env: { TD_BACKEND_BIN: join(root, 'missing-backend'), TD_BACKEND_CWD: root },
      });
      assertTdctlFails(['run', 'headless', '--request', invalidPath], /Unexpected token|JSON/, { env });
      assertTdctlFails(['sessions', 'inspect', 'run:missing'], /Agent run run:missing not found/, { env });
      assertTdctlFails(['run', 'headless', '--request', failingRunPath], /CLI launch failed/, { env });
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
} finally {
  rmSync(tempRoot, { recursive: true, force: true });
}
