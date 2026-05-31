import assert from 'node:assert/strict';
import { convertPlannedDagToWorkflowGraph, planMission, routeTaskType } from '../.tmp-tests/lib/workflow/PlanningRouter.js';

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}:`);
    console.error(error);
    process.exit(1);
  }
}

run('routeTaskType identifies task types correctly', () => {
  assert.equal(routeTaskType('Fix the sidebar bug'), 'bugfix');
  assert.equal(routeTaskType('Add a new feature for user auth'), 'security'); // auth priority
  assert.equal(routeTaskType('Implement dark mode'), 'feature');
  assert.equal(routeTaskType('Refactor the state management'), 'refactor');
  assert.equal(routeTaskType('Update the README.md'), 'docs');
  assert.equal(routeTaskType('Just some generic work'), 'generic');
});

run('planMission generates a DAG with at least Scout and Reviewer', () => {
  const goal = 'Fix the sidebar bug';
  const missionId = 'm1';
  const planned = planMission(goal, missionId);
  
  assert.equal(planned.missionId, missionId);
  assert.equal(planned.goal, goal);
  
  const roles = planned.nodes.map(n => n.role);
  assert.ok(roles.includes('scout'));
  assert.ok(roles.includes('reviewer'));
  
  // Bugfix should have builder and tester
  assert.ok(roles.includes('builder'));
  assert.ok(roles.includes('tester'));
  
  // Check edges
  assert.ok(planned.edges.length > 0);
  assert.ok(planned.edges.some(e => e.to === 'reviewer'));
});

run('planMission generates docs-specific DAG', () => {
  const planned = planMission('Update the guide', 'm2');
  const roles = planned.nodes.map(n => n.role);
  
  assert.ok(roles.includes('scout'));
  assert.ok(roles.includes('builder'));
  assert.ok(roles.includes('reviewer'));
  assert.ok(!roles.includes('coordinator'));
  assert.ok(!roles.includes('tester'));
});

run('convertPlannedDagToWorkflowGraph normalizes suggested CLI ids', () => {
  const planned = {
    missionId: 'cli-normalization',
    goal: 'Check CLI normalization',
    nodes: [
      {
        id: 'scout',
        role: 'scout',
        title: 'Scout',
        objective: 'Inspect',
        expectedOutput: 'Context',
        acceptanceCriteria: [],
        suggestedCli: 'OpenCode',
        dependencies: [],
      },
      {
        id: 'builder',
        role: 'builder',
        title: 'Builder',
        objective: 'Build',
        expectedOutput: 'Patch',
        acceptanceCriteria: [],
        suggestedCli: 'not-a-cli',
        dependencies: ['scout'],
      },
    ],
    edges: [{ from: 'scout', to: 'builder', reason: 'handoff', condition: 'on_success' }],
    assumptions: [],
    risks: [],
  };

  const graph = convertPlannedDagToWorkflowGraph(planned);
  const agentNodes = graph.nodes.filter(node => node.roleId !== 'task');

  assert.equal(agentNodes[0]?.config?.cli, 'opencode');
  assert.equal(agentNodes[1]?.config?.cli, 'claude');
});
