import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  isTaskBoardStatus,
  normalizeTaskBoardStatus,
  normalizeTaskBoardTasks,
  TASK_BOARD_COLUMNS,
} from '../.tmp-tests/lib/taskBoard.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const taskBoardPane = readFileSync(resolve(root, 'src/components/TaskBoard/TaskBoardPane.tsx'), 'utf8');
const inboxPane = readFileSync(resolve(root, 'src/components/TaskBoard/InboxPane.tsx'), 'utf8');

assert.deepEqual(TASK_BOARD_COLUMNS.map(column => column.id), ['todo', 'in_progress', 'review', 'done']);
assert.equal(isTaskBoardStatus('review'), true);
assert.equal(isTaskBoardStatus(' Review '), true);
assert.equal(isTaskBoardStatus(' review\0 '), true);
assert.equal(isTaskBoardStatus('blocked'), false);
assert.equal(normalizeTaskBoardStatus('done'), 'done');
assert.equal(normalizeTaskBoardStatus(' DONE '), 'done');
assert.equal(normalizeTaskBoardStatus('blocked'), 'todo');

const tasks = normalizeTaskBoardTasks([
  {
    id: 1,
    title: '  Build\0\nUI  ',
    description: '  polish\0\nbuttons ',
    status: 'review',
    created_at: ' 2026-05-30\0\n04:00:00 ',
    parent_id: 10,
    agent_id: ' builder\0 ',
    from_role: ' scout\nlead ',
    target_role: '',
    payload: ' {\n  "keep": "shape"\n}\0 ',
  },
  {
    id: 2,
    title: 'Unknown status stays visible',
    status: ' In_Progress ',
    created_at: null,
  },
  {
    id: 2,
    title: 'Updated duplicate task',
    description: ' latest copy ',
    status: 'done',
    created_at: '2026-05-30 04:01:00',
  },
  {
    id: 0,
    title: 'bad id',
    status: 'todo',
  },
  {
    id: 3,
    title: '   ',
    status: 'todo',
  },
  null,
]);

assert.deepEqual(tasks, [
  {
    id: 1,
    title: 'Build UI',
    description: 'polish buttons',
    status: 'review',
    created_at: '2026-05-30 04:00:00',
    parent_id: 10,
    agent_id: 'builder',
    from_role: 'scout lead',
    target_role: null,
    payload: '{\n  "keep": "shape"\n}',
  },
  {
    id: 2,
    title: 'Updated duplicate task',
    description: 'latest copy',
    status: 'done',
    created_at: '2026-05-30 04:01:00',
    parent_id: null,
    agent_id: null,
    from_role: null,
    target_role: null,
    payload: null,
  },
]);

assert.deepEqual(normalizeTaskBoardTasks({ bad: true }), []);

for (const value of [
  'aria-pressed={selectedAgent === agent.id}',
  'aria-label={`Run task ${task.title}`}',
  'aria-label={`Delete task ${task.title}`}',
  'const workspaceRoot = activeTab?.workspaceDir || storeState.workspaceDir;',
  'const taskCwd = currentDirectoryForPane(activePane, workspaceRoot);',
  'cwd: taskCwd',
  'workspaceDir: workspaceRoot',
]) {
  assert.ok(taskBoardPane.includes(value), `missing ${value}`);
}

for (const value of [
  'aria-label={`Reject delegation ${item.title || item.id}`}',
  'aria-label={`Approve delegation ${item.title || item.id}`}',
  'aria-label={`Claim delegation ${item.title || item.id}`}',
]) {
  assert.ok(inboxPane.includes(value), `missing ${value}`);
}

console.log('PASS task board task normalization keeps board data safe and visible');
