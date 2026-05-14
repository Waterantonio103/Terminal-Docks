import assert from 'node:assert/strict';

globalThis.EventSource = class {
  addEventListener() {}
  close() {}
};

const { WorkflowOrchestrator } = await import('../.tmp-tests/lib/workflow/WorkflowOrchestrator.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function definition() {
  return {
    id: 'race-definition',
    name: 'Runtime race regression',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [
      {
        id: 'task',
        kind: 'task',
        roleId: 'task',
        config: {
          prompt: 'Run the race regression',
          mode: 'build',
        },
      },
      {
        id: 'agent-a',
        kind: 'agent',
        roleId: 'builder',
        config: {
          cli: 'codex',
          executionMode: 'interactive_pty',
          terminalId: 'term-a',
        },
      },
    ],
    edges: [{ fromNodeId: 'task', toNodeId: 'agent-a', condition: 'always' }],
  };
}

function fanInDefinition() {
  const agent = (id, roleId = 'builder') => ({
    id,
    kind: 'agent',
    roleId,
    config: {
      cli: 'codex',
      executionMode: 'interactive_pty',
      terminalId: `term-${id}`,
    },
  });

  return {
    id: 'fan-in-definition',
    name: 'Explicit handoff fan-in regression',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [
      {
        id: 'task',
        kind: 'task',
        roleId: 'task',
        config: {
          prompt: 'Run the fan-in regression',
          mode: 'build',
        },
      },
      agent('parent-a', 'scout'),
      agent('parent-b', 'scout'),
      agent('merge', 'builder'),
    ],
    edges: [
      { fromNodeId: 'task', toNodeId: 'parent-a', condition: 'always' },
      { fromNodeId: 'task', toNodeId: 'parent-b', condition: 'always' },
      { fromNodeId: 'parent-a', toNodeId: 'merge', condition: 'on_success' },
      { fromNodeId: 'parent-b', toNodeId: 'merge', condition: 'on_success' },
    ],
  };
}

function twoStepDefinition() {
  return {
    id: 'late-completion-definition',
    name: 'Late completion regression',
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [
      {
        id: 'task',
        kind: 'task',
        roleId: 'task',
        config: {
          prompt: 'Run the late completion regression',
          mode: 'build',
        },
      },
      {
        id: 'builder',
        kind: 'agent',
        roleId: 'builder',
        config: {
          cli: 'codex',
          executionMode: 'interactive_pty',
          terminalId: 'term-builder',
        },
      },
      {
        id: 'reviewer',
        kind: 'agent',
        roleId: 'reviewer',
        config: {
          cli: 'codex',
          executionMode: 'interactive_pty',
          terminalId: 'term-reviewer',
        },
      },
    ],
    edges: [
      { fromNodeId: 'task', toNodeId: 'builder', condition: 'always' },
      { fromNodeId: 'builder', toNodeId: 'reviewer', condition: 'on_success' },
    ],
  };
}

function createFastCompletingRuntimeManager() {
  const listeners = new Set();
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    getSessionForNode() {
      return undefined;
    },
    async validateSessionForReuse() {
      return { status: 'stale', details: 'test' };
    },
    async ensureRuntimeReadyForTask(args) {
      return this.startNodeRun(args);
    },
    async startNodeRun(args) {
      const session = {
        sessionId: 'session-fast',
        terminalId: args.terminalId,
        cliId: args.cliId,
        executionMode: args.executionMode,
        createdAt: Date.now(),
      };
      for (const listener of listeners) {
        listener({ type: 'session_created', sessionId: session.sessionId, nodeId: args.nodeId, missionId: args.missionId });
        listener({ type: 'session_completed', sessionId: session.sessionId, nodeId: args.nodeId, outcome: 'success' });
      }
      await sleep(10);
      return session;
    },
    async reinjectTask() {},
    async sendTask() {},
    async sendInput() {},
    async stopRuntime() {},
    async writeBootstrapToTerminal() {},
  };
}

function createCapturingRuntimeManager(capturedArgs) {
  const manager = createFastCompletingRuntimeManager();
  return {
    ...manager,
    async startNodeRun(args) {
      capturedArgs.push(args);
      return manager.startNodeRun(args);
    },
  };
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (err) {
    console.error(`FAIL ${name}`);
    console.error(err);
    process.exitCode = 1;
  }
}

await run('orchestrator handles runtime completion before runtime_attached', async () => {
  const orchestrator = new WorkflowOrchestrator();
  orchestrator.setRuntimeManager(createFastCompletingRuntimeManager());

  orchestrator.startRun(definition(), { runId: 'race-run' });
  await sleep(50);

  const run = orchestrator.getRun('race-run');
  assert.equal(run?.status, 'completed');
  assert.equal(run?.nodeStates['agent-a']?.state, 'completed');
});

await run('agent runtimes inherit task workspace when node workspace is unset', async () => {
  const orchestrator = new WorkflowOrchestrator();
  const capturedArgs = [];
  orchestrator.setRuntimeManager(createCapturingRuntimeManager(capturedArgs));

  const def = definition();
  def.nodes[0].config.workspaceDir = 'C:/docks-testing/workflow-output';

  orchestrator.startRun(def, { runId: 'workspace-fallback-run' });
  await sleep(50);

  assert.equal(capturedArgs[0]?.workspaceDir, 'C:/docks-testing/workflow-output');
});

await run('explicit MCP handoff waits for all fan-in parents', async () => {
  const orchestrator = new WorkflowOrchestrator();

  orchestrator.startRun(fanInDefinition(), { runId: 'fan-in-run' });
  let run = orchestrator.getRun('fan-in-run');
  assert.equal(run?.nodeStates.merge?.state, 'idle');

  orchestrator.handleNodeCompletion('fan-in-run', {
    nodeId: 'parent-a',
    attempt: 1,
    outcome: 'success',
    summary: 'parent a done',
    targetNodeId: 'merge',
  });

  run = orchestrator.getRun('fan-in-run');
  assert.equal(run?.nodeStates['parent-a']?.state, 'completed');
  assert.equal(run?.nodeStates.merge?.state, 'idle');

  orchestrator.handleNodeCompletion('fan-in-run', {
    nodeId: 'parent-b',
    attempt: 1,
    outcome: 'success',
    summary: 'parent b done',
    targetNodeId: 'merge',
  });

  run = orchestrator.getRun('fan-in-run');
  assert.equal(run?.nodeStates['parent-b']?.state, 'completed');
  assert.equal(run?.nodeStates.merge?.state, 'launching_runtime');
  assert.equal(run?.nodeStates.merge?.attempt, 1);
});

await run('late MCP success heals watchdog failure and routes downstream', async () => {
  const orchestrator = new WorkflowOrchestrator();

  orchestrator.startRun(twoStepDefinition(), { runId: 'late-success-run' });
  orchestrator.handleNodeCompletion('late-success-run', {
    nodeId: 'builder',
    attempt: 1,
    outcome: 'failure',
    summary: 'watchdog timeout',
  });

  let run = orchestrator.getRun('late-success-run');
  assert.equal(run?.nodeStates.builder?.state, 'failed');
  assert.equal(run?.nodeStates.reviewer?.state, 'idle');

  orchestrator.handleNodeCompletion('late-success-run', {
    nodeId: 'builder',
    attempt: 1,
    outcome: 'success',
    summary: 'late complete_task success',
  });

  run = orchestrator.getRun('late-success-run');
  assert.equal(run?.nodeStates.builder?.state, 'completed');
  assert.equal(run?.nodeStates.reviewer?.state, 'launching_runtime');
});
