import assert from 'node:assert/strict';

globalThis.EventSource = class {
  addEventListener() {}
  close() {}
};

const { compileMission } = await import('../.tmp-tests/lib/graphCompiler.js');
const { buildPresetFlowGraph, getPresetReadmeDefault, listWorkflowPresets } = await import('../.tmp-tests/lib/workflowPresets.js');
const { compiledMissionToDefinition } = await import('../.tmp-tests/lib/workflow/WorkflowDefinition.js');
const { WorkflowOrchestrator } = await import('../.tmp-tests/lib/workflow/WorkflowOrchestrator.js');
const { buildWorkflowPresetFramework } = await import('../mcp-server/src/utils/workflow-preset-framework.mjs');

const PRESET_RUNS = 2;
const RUN_TIMEOUT_MS = 2_500;
const SLOW_RUN_MS = 750;

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function bindingsForPreset(preset, runIndex) {
  return {
    bindingsByNodeId: Object.fromEntries(preset.nodes.map(node => [
      node.id,
      {
        terminalId: `term-${preset.id}-${runIndex}-${node.id}`,
        terminalTitle: `${preset.name} ${runIndex} ${node.id}`,
        cli: 'codex',
        executionMode: 'interactive_pty',
        paneId: `pane-${preset.id}-${runIndex}-${node.id}`,
      },
    ])),
  };
}

function promptForPreset(preset, runIndex) {
  if (preset.subMode === 'Patch / Build') {
    return `Patch/build sweep ${runIndex}: update the workflow preset framework mapping, preserve unrelated worktree changes, run the smallest graph and MCP checks, and report changed files, verification evidence, and review verdict.`;
  }
  if (preset.subMode === 'Delivery') {
    return `Delivery sweep ${runIndex}: deliver a coordinated workflow preset framework improvement with acceptance criteria, implementation evidence, validation commands, risk notes, and final handoff guidance.`;
  }
  return `Preset sweep run ${runIndex} for ${preset.name}`;
}

function createDeterministicRuntimeManager() {
  const listeners = new Set();
  let sessionCounter = 0;

  function emit(event) {
    for (const listener of listeners) listener(event);
  }

  return {
    starts: [],
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSessionForNode() {
      return undefined;
    },
    async validateSessionForReuse() {
      return { status: 'stale', details: 'preset sweep starts fresh deterministic sessions' };
    },
    async ensureRuntimeReadyForTask(args) {
      return this.startNodeRun(args);
    },
    async startNodeRun(args) {
      this.starts.push(args);
      const session = {
        sessionId: `preset-sweep-session-${++sessionCounter}-${args.nodeId}`,
        terminalId: args.terminalId,
        cliId: args.cliId,
        executionMode: args.executionMode,
        createdAt: Date.now(),
      };
      emit({
        type: 'session_created',
        sessionId: session.sessionId,
        nodeId: args.nodeId,
        missionId: args.missionId,
      });
      queueMicrotask(() => {
        emit({
          type: 'session_state_changed',
          sessionId: session.sessionId,
          nodeId: args.nodeId,
          from: 'launching_runtime',
          to: 'running',
        });
        emit({
          type: 'task_acked',
          sessionId: session.sessionId,
          nodeId: args.nodeId,
          attempt: args.attempt,
        });
        emit({
          type: 'session_completed',
          sessionId: session.sessionId,
          nodeId: args.nodeId,
          outcome: 'success',
        });
      });
      return session;
    },
    async reinjectTask() {},
    async sendTask() {},
    async sendInput() {},
    async stopRuntime() {},
    async writeBootstrapToTerminal() {},
  };
}

function assertCompiledPresetQuality(preset, mission) {
  assert.equal(mission.metadata.authoringMode, 'preset', `${preset.id}: authoring mode`);
  assert.equal(mission.metadata.presetId, preset.id, `${preset.id}: preset id`);
  assert.equal(mission.metadata.runVersion, 1, `${preset.id}: run version`);
  assert.equal(mission.nodes.length, preset.agentCount, `${preset.id}: compiled agent count`);
  assert.deepEqual(mission.nodes.map(node => node.id), preset.nodes.map(node => node.id), `${preset.id}: node order`);

  const terminalIds = mission.nodes.map(node => node.terminal.terminalId);
  assert.equal(new Set(terminalIds).size, terminalIds.length, `${preset.id}: duplicate terminal binding`);

  const nodeIds = new Set(mission.nodes.map(node => node.id));
  for (const edge of mission.edges) {
    assert.ok(nodeIds.has(edge.fromNodeId), `${preset.id}: edge source ${edge.fromNodeId} exists`);
    assert.ok(nodeIds.has(edge.toNodeId), `${preset.id}: edge target ${edge.toNodeId} exists`);
  }
  for (const startNodeId of mission.metadata.startNodeIds) {
    assert.ok(nodeIds.has(startNodeId), `${preset.id}: start node ${startNodeId} exists`);
  }

  assert.equal(mission.metadata.finalReadmeEnabled, getPresetReadmeDefault(preset), `${preset.id}: README default`);
  if (mission.metadata.finalReadmeEnabled) {
    assert.ok(mission.metadata.finalReadmeOwnerNodeId, `${preset.id}: README owner is set`);
    assert.ok(nodeIds.has(mission.metadata.finalReadmeOwnerNodeId), `${preset.id}: README owner exists`);
  } else {
    assert.equal(mission.metadata.finalReadmeOwnerNodeId, null, `${preset.id}: README owner disabled`);
  }

  if (preset.specProfile === 'frontend_three_file') {
    assert.equal(mission.metadata.specProfile, 'frontend_three_file', `${preset.id}: frontend spec profile`);
    assert.notEqual(mission.metadata.frontendMode, 'off', `${preset.id}: frontend mode enabled`);
  }

  const framework = buildWorkflowPresetFramework({ presetId: preset.id });
  if (framework) {
    assert.ok(framework, `${preset.id}: preset framework exists`);
    assert.equal(framework.mode, preset.mode, `${preset.id}: preset framework mode`);
    assert.equal(framework.subMode, preset.subMode, `${preset.id}: preset framework sub-mode`);
    assert.ok(framework.framework.requiredOutputs.length >= 3, `${preset.id}: preset framework required outputs`);
    assert.ok(framework.framework.qualityRubric.length >= 4, `${preset.id}: preset framework quality rubric`);
    for (const roleId of new Set(preset.nodes.map(node => node.roleId))) {
      assert.ok(framework.framework.laneGuidance[roleId], `${preset.id}: lane guidance for ${roleId}`);
    }
  }
}

async function waitForRun(orchestrator, runId) {
  const deadline = Date.now() + RUN_TIMEOUT_MS;
  while (Date.now() < deadline) {
    const run = orchestrator.getRun(runId);
    if (run?.status === 'completed') return run;
    await sleep(5);
  }
  const run = orchestrator.getRun(runId);
  throw new Error(`${runId} timed out with status ${run?.status ?? 'missing'}`);
}

async function runPresetOnce(preset, runIndex) {
  const flow = buildPresetFlowGraph({
    preset,
    missionId: `preset-sweep-${preset.id}-${runIndex}`,
    prompt: promptForPreset(preset, runIndex),
    mode: 'build',
    workspaceDir: 'C:/workspace',
    instructionOverrides: {},
    ...bindingsForPreset(preset, runIndex),
  });
  const mission = compileMission({
    graphId: `preset:${preset.id}`,
    missionId: `preset-sweep-${preset.id}-${runIndex}`,
    nodes: flow.nodes,
    edges: flow.edges,
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123 + runIndex,
    authoringMode: 'preset',
    presetId: preset.id,
    runVersion: 1,
  });
  assertCompiledPresetQuality(preset, mission);

  const definition = compiledMissionToDefinition(mission, `${preset.name} sweep`);
  const runtime = createDeterministicRuntimeManager();
  const orchestrator = new WorkflowOrchestrator();
  const events = [];
  orchestrator.subscribe(event => events.push(event));
  orchestrator.setRuntimeManager(runtime);

  const startedAt = Date.now();
  orchestrator.startRun(definition, { runId: mission.missionId });
  const run = await waitForRun(orchestrator, mission.missionId);
  const durationMs = Date.now() - startedAt;

  assert.equal(run.status, 'completed', `${preset.id} run ${runIndex}: completed`);
  assert.deepEqual(
    Object.values(run.nodeStates).map(state => [state.nodeId, state.state]),
    preset.nodes.map(node => [node.id, 'completed']),
    `${preset.id} run ${runIndex}: all nodes completed`,
  );
  assert.equal(runtime.starts.length, preset.agentCount, `${preset.id} run ${runIndex}: started every agent exactly once`);
  assert.ok(durationMs < SLOW_RUN_MS, `${preset.id} run ${runIndex}: slow run ${durationMs}ms`);

  const fanInPendingEvents = events.filter(event => event.type === 'fan_in_pending');
  for (const event of fanInPendingEvents) {
    assert.ok(event.pendingFromNodes.length > 0, `${preset.id} run ${runIndex}: pending fan-in should name parents`);
  }

  return {
    presetId: preset.id,
    name: preset.name,
    runIndex,
    durationMs,
    nodeCount: preset.agentCount,
    eventCount: events.length,
    fanInPendingCount: fanInPendingEvents.length,
  };
}

const results = [];
const failures = [];

for (const preset of listWorkflowPresets()) {
  for (let runIndex = 1; runIndex <= PRESET_RUNS; runIndex += 1) {
    try {
      const result = await runPresetOnce(preset, runIndex);
      results.push(result);
      console.log(`PASS ${preset.name} (${preset.id}) run ${runIndex}: ${result.durationMs}ms, ${result.nodeCount} nodes`);
    } catch (error) {
      failures.push({
        presetId: preset.id,
        name: preset.name,
        runIndex,
        error: error instanceof Error ? error.message : String(error),
      });
      console.error(`FAIL ${preset.name} (${preset.id}) run ${runIndex}`);
      console.error(error);
    }
  }
}

console.log(`workflow preset sweep: ${results.length} passed, ${failures.length} failed`);

if (failures.length > 0) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
