import assert from 'node:assert/strict';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

globalThis.EventSource = class {
  addEventListener() {}
  close() {}
};

const { WorkflowOrchestrator } = await import('../.tmp-tests/lib/workflow/WorkflowOrchestrator.js');

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

class ManualRuntimeManager {
  constructor() {
    this.listeners = new Set();
    this.sessions = new Map();
    this.events = [];
    this.reinjectCalls = [];
    this.stopCalls = [];
  }

  subscribe(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  emit(event) {
    this.events.push(event);
    for (const listener of this.listeners) listener(event);
  }

  getSessionForNode(missionId, nodeId, attempt) {
    return [...this.sessions.values()].find(
      session => session.missionId === missionId && session.nodeId === nodeId && session.attempt === attempt,
    );
  }

  async validateSessionForReuse() {
    return { status: 'missing', reason: 'manual test never reuses sessions' };
  }

  async ensureRuntimeReadyForTask(args) {
    return this.startNodeRun(args);
  }

  async startNodeRun(args) {
    const session = {
      sessionId: `${args.nodeId}:${args.attempt}:${this.sessions.size + 1}`,
      terminalId: args.terminalId || `term-${args.nodeId}-${args.attempt}`,
      cliId: args.cliId,
      executionMode: args.executionMode,
      missionId: args.missionId,
      nodeId: args.nodeId,
      attempt: args.attempt,
      createdAt: Date.now(),
    };
    this.sessions.set(session.sessionId, session);
    this.emit({
      type: 'session_created',
      sessionId: session.sessionId,
      nodeId: args.nodeId,
      missionId: args.missionId,
    });

    const targetState = args.executionMode === 'manual' ? 'manual_takeover' : 'running';
    this.emit({
      type: 'session_state_changed',
      sessionId: session.sessionId,
      nodeId: args.nodeId,
      from: 'launching_runtime',
      to: targetState,
    });
    if (targetState === 'manual_takeover') {
      this.events.push({
        type: 'manual_takeover_requested',
        missionId: args.missionId,
        nodeId: args.nodeId,
        sessionId: session.sessionId,
        terminalId: session.terminalId,
      });
    }
    return session;
  }

  async reinjectTask(sessionId) {
    this.reinjectCalls.push(sessionId);
    const session = this.sessions.get(sessionId);
    assert.ok(session, `missing session ${sessionId}`);
    this.emit({
      type: 'session_state_changed',
      sessionId,
      nodeId: session.nodeId,
      from: 'injecting_task',
      to: 'running',
    });
  }

  async sendTask() {}
  async sendInput() {}

  async stopRuntime({ sessionId }) {
    this.stopCalls.push(sessionId);
    const session = this.sessions.get(sessionId);
    if (!session) return;
    this.emit({
      type: 'session_state_changed',
      sessionId,
      nodeId: session.nodeId,
      from: 'running',
      to: 'cancelled',
    });
  }

  async writeBootstrapToTerminal() {}
}

function manualDefinition(id, edges = []) {
  return {
    id,
    name: id,
    createdAt: new Date(0).toISOString(),
    updatedAt: new Date(0).toISOString(),
    nodes: [
      {
        id: 'task',
        kind: 'task',
        roleId: 'task',
        config: { prompt: id, mode: 'build' },
      },
      {
        id: 'agent',
        kind: 'agent',
        roleId: 'builder',
        config: {
          cli: 'codex',
          executionMode: 'manual',
          terminalId: `term-${id}-agent`,
          retryPolicy: { maxRetries: 1, retryOn: ['unknown'], backoffMs: 0 },
        },
      },
      ...edges.map(edgeNode => ({
        id: edgeNode,
        kind: 'agent',
        roleId: 'reviewer',
        config: {
          cli: 'codex',
          executionMode: 'manual',
          terminalId: `term-${id}-${edgeNode}`,
        },
      })),
    ],
    edges: [
      { fromNodeId: 'task', toNodeId: 'agent', condition: 'always' },
      ...edges.map(edgeNode => ({ fromNodeId: 'agent', toNodeId: edgeNode, condition: 'on_success' })),
    ],
  };
}

async function startManualRun(id, definition = manualDefinition(id)) {
  const orchestrator = new WorkflowOrchestrator();
  const runtime = new ManualRuntimeManager();
  orchestrator.setRuntimeManager(runtime);
  const run = orchestrator.startRun(definition, { runId: id });
  await sleep(0);
  return { orchestrator, runtime, run };
}

const evidence = [];

{
  const { runtime, run } = await startManualRun('manual-wf-01-takeover');
  assert.equal(run.nodeStates.agent.state, 'manual_takeover');
  assert.equal(run.nodeStates.agent.runtimeSession.terminalId, 'term-manual-wf-01-takeover-agent');
  assert.ok(runtime.events.some(event => event.type === 'manual_takeover_requested'));
  evidence.push({
    workflow: 'Start workflow then pause/manual takeover terminal',
    result: 'passed',
    state: run.nodeStates.agent.state,
    terminalId: run.nodeStates.agent.runtimeSession.terminalId,
  });
}

{
  const { orchestrator, runtime, run } = await startManualRun('manual-wf-02-resume');
  assert.equal(run.nodeStates.agent.state, 'manual_takeover');
  assert.equal(orchestrator.transitionNodeState(run, 'agent', 'injecting_task'), true);
  await runtime.reinjectTask(run.nodeStates.agent.runtimeSession.sessionId);
  assert.equal(run.nodeStates.agent.state, 'running');
  orchestrator.completeNode({ nodeId: 'agent', attempt: 1, outcome: 'success', summary: 'manual resume completed' });
  assert.equal(run.status, 'completed');
  evidence.push({
    workflow: 'Resume after takeover',
    result: 'passed',
    reinjectCalls: runtime.reinjectCalls.length,
    finalState: run.nodeStates.agent.state,
  });
}

{
  const { orchestrator, run } = await startManualRun('manual-wf-03-force-complete');
  orchestrator.completeNode({ nodeId: 'agent', attempt: 1, outcome: 'success', summary: 'manually marked complete' });
  assert.equal(run.nodeStates.agent.state, 'completed');
  assert.equal(run.status, 'completed');
  assert.ok(run.events.some(event => event.type === 'node_completed' && event.nodeId === 'agent'));
  evidence.push({
    workflow: 'Mark node completed manually',
    result: 'passed',
    finalState: run.nodeStates.agent.state,
    audited: true,
  });
}

{
  const { orchestrator, runtime, run } = await startManualRun(
    'manual-wf-04-fail-retry-cancel',
    manualDefinition('manual-wf-04-fail-retry-cancel', ['reviewer']),
  );
  orchestrator.completeNode({ nodeId: 'agent', attempt: 1, outcome: 'failure', summary: 'manual failure' });
  assert.equal(run.nodeStates.agent.state, 'failed');
  assert.equal(run.nodeStates.reviewer.state, 'idle');
  orchestrator.activateNodeInternal(run, 'agent');
  await sleep(0);
  assert.equal(run.nodeStates.agent.attempt, 2);
  assert.equal(run.nodeStates.agent.state, 'manual_takeover');
  orchestrator.cancelRun(run.runId);
  await sleep(0);
  assert.equal(run.status, 'cancelled');
  assert.notEqual(run.nodeStates.reviewer.state, 'completed');
  evidence.push({
    workflow: 'Mark failed manually, retry, then cancel before dependent proceeds',
    result: 'passed',
    retryAttempt: run.nodeStates.agent.attempt,
    dependentState: run.nodeStates.reviewer.state,
    stopCalls: runtime.stopCalls.length,
  });
}

if (process.env.MANUAL_INTERVENTION_EVIDENCE_PATH) {
  mkdirSync(dirname(process.env.MANUAL_INTERVENTION_EVIDENCE_PATH), { recursive: true });
  writeFileSync(process.env.MANUAL_INTERVENTION_EVIDENCE_PATH, JSON.stringify({
    generatedAt: new Date().toISOString(),
    totalWorkflowsTested: evidence.length,
    successfulWorkflows: evidence.filter(item => item.result === 'passed').length,
    failedWorkflows: evidence.filter(item => item.result !== 'passed').length,
    executionPath: 'workflow_orchestrator_manual_state_regression',
    liveRuntimeLaunched: false,
    note: 'Prompt 05 manual intervention behavior exercised with WorkflowOrchestrator plus a fake RuntimeManager; no live CLI was required because the prompt focuses on manual control state.',
    evidence,
  }, null, 2));
}

console.log('PASS manual intervention workflows cover takeover, resume, manual completion, failure retry, and cancel guard');
