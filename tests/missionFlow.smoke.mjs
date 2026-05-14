import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-smoke-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';

const [{ buildLaunchPrompt }, { compileMission }, { buildNewTaskSignal, parseNewTaskSignal }] = await Promise.all([
  import('../.tmp-tests/lib/buildPrompt.js'),
  import('../.tmp-tests/lib/graphCompiler.js'),
  import('../.tmp-tests/lib/missionRuntime.js'),
]);

const { buildTaskDetails } = await import('../mcp-server/src/tools/task-details.mjs');
const { executeHandoffTask } = await import('../mcp-server/src/tools/handoff-complete.mjs');
const {
  resetStarlinkState,
  seedCompiledMission,
  seedMissionNodeRuntime,
  seedAgentRuntimeSession,
  executeReceiveMessages,
  getBroadcastHistory,
} = await import('../mcp-server/src/utils/test-helpers.mjs');

function taskNode(id = 'task-1') {
  return {
    id,
    type: 'task',
    position: { x: 0, y: 0 },
    data: {
      roleId: 'task',
      status: 'idle',
      prompt: 'Build the feature and hand off cleanly',
      mode: 'build',
      workspaceDir: 'C:/workspace',
    },
  };
}

function agentNode(id, roleId, terminalTitle) {
  return {
    id,
    type: 'agent',
    position: { x: 0, y: 0 },
    data: {
      nodeId: id,
      roleId,
      status: 'idle',
      cli: 'claude',
      instructionOverride: '',
      terminalId: `term-${id}`,
      terminalTitle,
      paneId: `pane-${id}`,
      autoLinked: true,
    },
  };
}

function edge(source, target, condition = 'always') {
  return {
    id: `${source}-${condition}-${target}`,
    source,
    target,
    data: { condition },
  };
}

function getAllowedOutgoingTargets(mission, nodeId) {
  const nodeById = new Map(mission.nodes.map(node => [node.id, node]));
  return mission.edges
    .filter(link => link.fromNodeId === nodeId)
    .map(link => ({
      targetNodeId: link.toNodeId,
      targetRoleId: nodeById.get(link.toNodeId)?.roleId ?? 'unknown',
      condition: link.condition,
    }));
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

try {
  resetStarlinkState();

  const mission = compileMission({
    graphId: 'smoke-graph',
    missionId: 'smoke-mission',
    nodes: [
      taskNode(),
      agentNode('builder-node', 'builder', 'Builder Terminal'),
      agentNode('reviewer-node', 'reviewer', 'Reviewer Terminal'),
    ],
    edges: [
      edge('task-1', 'builder-node'),
      edge('builder-node', 'reviewer-node'),
    ],
    workspaceDirFallback: 'C:/workspace',
    compiledAt: 123,
  });

  seedCompiledMission(mission);
  seedMissionNodeRuntime({
    missionId: mission.missionId,
    nodeId: 'builder-node',
    roleId: 'builder',
    status: 'running',
    attempt: 1,
    currentWaveId: 'root:smoke-mission',
  });

  seedAgentRuntimeSession({
    sessionId: 'session:smoke-mission:builder-node:1',
    agentId: 'agent:smoke-mission:builder-node:term-builder-node',
    missionId: mission.missionId,
    nodeId: 'builder-node',
    attempt: 1,
    terminalId: 'term-builder-node',
    status: 'dispatched',
  });

  run('buildLaunchPrompt stages graph-mode instructions without protocol-first dependency', () => {
    const prompt = buildLaunchPrompt('builder', {
      workspaceDir: 'C:/workspace',
      missionId: mission.missionId,
      nodeId: 'builder-node',
      attempt: 1,
      allowedOutgoingTargets: getAllowedOutgoingTargets(mission, 'builder-node'),
      authoringMode: 'graph',
      runVersion: 1,
      task: mission.task.prompt,
      mode: mission.task.mode,
    });

    assert.match(prompt, /Treat `get_task_details` as the canonical source of truth/);
    assert.match(prompt, /MCP `complete_task` is the completion authority/);
    assert.match(prompt, /as your final MCP action/);
    assert.match(prompt, /missionId="smoke-mission"/);
    assert.match(prompt, /fromNodeId="builder-node"/);
    assert.match(prompt, /fromAttempt=1/);
    assert.match(prompt, /targetNodeId/);
    assert.doesNotMatch(prompt, /get_collaboration_protocol/);
  });

  run('frontend launch prompts apply mode-aware spec strictness', () => {
    const strictPrompt = buildLaunchPrompt('frontend_builder', {
      workspaceDir: 'C:/workspace',
      missionId: 'strict-ui-mission',
      nodeId: 'frontend_builder',
      attempt: 1,
      allowedOutgoingTargets: [],
      authoringMode: 'preset',
      presetId: 'frontend_ui_delivery',
      runVersion: 1,
      frontendMode: 'strict_ui',
      specProfile: 'frontend_three_file',
      task: 'Build an internal admin dashboard',
      mode: 'build',
    });
    assert.match(strictPrompt, /Frontend\/UI workflow mode: strict_ui/);
    assert.match(strictPrompt, /Spec profile: frontend_three_file/);
    assert.match(strictPrompt, /missing decisions must be sent back for intake\/alignment/);

    const fastPrompt = buildLaunchPrompt('frontend_builder', {
      workspaceDir: 'C:/workspace',
      missionId: 'fast-ui-mission',
      nodeId: 'frontend_builder',
      attempt: 1,
      allowedOutgoingTargets: [],
      authoringMode: 'graph',
      runVersion: 1,
      frontendMode: 'fast',
      task: 'Build a quick settings panel',
      mode: 'build',
    });
    assert.match(fastPrompt, /Frontend\/UI workflow mode: fast/);
    assert.match(fastPrompt, /Missing \.md spec files must not block/);
  });

  run('final README owner receives conservative guidance only when selected', () => {
    const ownerPrompt = buildLaunchPrompt('interaction_qa', {
      workspaceDir: 'C:/workspace/app-test',
      missionId: 'readme-mission',
      nodeId: 'interaction_qa',
      attempt: 1,
      allowedOutgoingTargets: [],
      authoringMode: 'preset',
      presetId: 'frontend_ui_delivery',
      runVersion: 1,
      finalReadmeEnabled: true,
      finalReadmeOwnerNodeId: 'interaction_qa',
      task: 'Build an internal admin dashboard',
      mode: 'build',
    });
    assert.match(ownerPrompt, /Final README instruction/);
    assert.match(ownerPrompt, /If README\.md already exists/);
    assert.match(ownerPrompt, /create INSTRUCTIONS\.md instead/);
    assert.match(ownerPrompt, /completion payload instead of creating another markdown file/);
    assert.doesNotMatch(ownerPrompt, /SUMMARY\.md/);

    const nonOwnerPrompt = buildLaunchPrompt('accessibility_reviewer', {
      workspaceDir: 'C:/workspace/app-test',
      missionId: 'readme-mission',
      nodeId: 'accessibility_reviewer',
      attempt: 1,
      allowedOutgoingTargets: [],
      authoringMode: 'preset',
      presetId: 'frontend_ui_delivery',
      runVersion: 1,
      finalReadmeEnabled: true,
      finalReadmeOwnerNodeId: 'interaction_qa',
      task: 'Build an internal admin dashboard',
      mode: 'build',
    });
    assert.doesNotMatch(nonOwnerPrompt, /Final README instruction/);
  });

  run('Mission Control writes a NEW_TASK signal with runtime bootstrap metadata', () => {
    const prompt = buildNewTaskSignal({
      missionId: mission.missionId,
      nodeId: 'builder-node',
      roleId: 'builder',
      sessionId: 'session:smoke-mission:builder-node:1',
      agentId: 'agent:smoke-mission:builder-node:term-builder-node',
      terminalId: 'term-builder-node',
      activatedAt: 1710000000000,
      attempt: 1,
      payload: JSON.stringify([{ fromNodeId: 'task-1', payload: { scope: 'feature' } }]),
    });
    const envelope = prompt.match(/--- ENVELOPE ---\n([\s\S]+?)\n--- END ENVELOPE ---/);
    assert.ok(envelope, 'activation prompt should contain a JSON envelope');
    const signal = JSON.parse(envelope[1]);

    assert.equal(signal.signal, 'NEW_TASK');
    assert.equal(signal.missionId, mission.missionId);
    assert.equal(signal.nodeId, 'builder-node');
    assert.equal(signal.sessionId, 'session:smoke-mission:builder-node:1');
    assert.equal(signal.agentId, 'agent:smoke-mission:builder-node:term-builder-node');
    assert.equal(signal.terminalId, 'term-builder-node');
    assert.equal(signal.activatedAt, 1710000000000);
    assert.equal(signal.attempt, 1);
    assert.ok(typeof signal.payloadPreview === 'string' && signal.payloadPreview.length > 0);
    assert.equal(signal.payloadPreview, signal.handoffPayloadPreview);
    assert.deepEqual(parseNewTaskSignal(JSON.stringify(signal)), signal);
  });

  run('handoff_task makes the target node queryable end-to-end', () => {
    const result = executeHandoffTask({
      missionId: mission.missionId,
      fromNodeId: 'builder-node',
      fromAttempt: 1,
      targetNodeId: 'reviewer-node',
      outcome: 'success',
      title: 'Builder completed implementation',
      payload: {
        filesChanged: ['src/components/MissionControl/MissionControlPane.tsx'],
        previewUrl: null,
      },
    }, 'builder-session');

    assert.equal(result.isError, undefined);

    const reviewerDetails = buildTaskDetails(mission.missionId, 'reviewer-node');
    assert.ok(reviewerDetails.latestTask);
    assert.equal(reviewerDetails.latestTask.node_id, 'reviewer-node');

    const inbox = executeReceiveMessages({
      missionId: mission.missionId,
      nodeId: 'reviewer-node',
      afterSeq: 0,
    }, 'reviewer-session');
    const inboxPayload = JSON.parse(inbox.content[0].text);
    assert.equal(inboxPayload.messages.length, 1);
    assert.match(inboxPayload.messages[0].content, /Builder completed implementation/);
    assert.match(inboxPayload.messages[0].content, /reviewer-node/);

    const broadcasts = getBroadcastHistory();
    assert.ok(broadcasts.some(message => message.type === 'handoff'));
    assert.ok(broadcasts.some(message => message.type === 'task_update'));
  });
} finally {
  try {
    rmSync(tempRoot, { recursive: true, force: true });
  } catch {
    // better-sqlite3 can keep the temp DB open until process exit on Windows
  }
}
