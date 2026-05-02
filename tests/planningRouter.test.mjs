import assert from 'node:assert/strict';
import { planMission, routeTaskType } from '../.tmp-tests/lib/workflow/PlanningRouter.js';

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
