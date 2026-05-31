import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  cleanPaneTitle,
  cleanSavedLayoutName,
  cleanWorkspaceTabName,
  isWorkflowNodeStatus,
  nodeRuntimeBindingsFromTerminalBindings,
  selectActivePanes,
  WORKFLOW_NODE_STATUS_SET,
  WORKFLOW_NODE_STATUS_VALUES,
} from '../.tmp-tests/store/workspace.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const workspaceStoreSource = readFileSync(resolve(root, 'src/store/workspace.ts'), 'utf8');

assert.equal(WORKFLOW_NODE_STATUS_VALUES.length, WORKFLOW_NODE_STATUS_SET.size);
assert.equal(isWorkflowNodeStatus('idle'), true);
assert.equal(isWorkflowNodeStatus('manual_takeover'), true);
assert.equal(isWorkflowNodeStatus(''), false);
assert.equal(isWorkflowNodeStatus('manual-takeover'), false);
assert.equal(isWorkflowNodeStatus(undefined), false);
assert.equal(isWorkflowNodeStatus(null), false);
assert.equal(cleanPaneTitle('  Dev\u0000  server \n preview  '), 'Dev server preview');
assert.equal(cleanPaneTitle(' \u0000 ', ' Terminal\u0000 1 '), 'Terminal 1');
assert.equal(cleanPaneTitle(null, ''), 'Untitled');
assert.equal(cleanPaneTitle('x'.repeat(140)), 'x'.repeat(120));
assert.equal(cleanWorkspaceTabName('  Build\u0000  workspace \n tab  '), 'Build workspace tab');
assert.equal(cleanWorkspaceTabName(' \u0000 ', ' Workspace\u0000 4 '), 'Workspace 4');
assert.equal(cleanSavedLayoutName('  Review\u0000  layout \n A  '), 'Review layout A');
assert.equal(cleanSavedLayoutName(' \u0000 '), 'Workspace layout');
assert.equal(workspaceStoreSource.includes(`'${String.fromCharCode(115, 119, 97, 114, 109)}'`), false);

const stablePane = {
  id: 'pane-1',
  type: 'editor',
  title: 'Editor',
  gridPos: { x: 0, y: 0, w: 100, h: 100 },
};
const stablePanes = [stablePane];
const selectedPanes = selectActivePanes({
  tabs: [{ id: 'tab-1', panes: stablePanes }],
  activeTabId: 'tab-1',
});
assert.equal(selectedPanes, stablePanes);
assert.equal(
  selectActivePanes({ tabs: [{ id: 'tab-1', panes: stablePanes }], activeTabId: 'missing' }),
  stablePanes,
);
assert.equal(
  selectActivePanes({ tabs: [], activeTabId: 'missing' }),
  selectActivePanes({ tabs: [], activeTabId: 'other-missing' }),
);
assert.deepEqual(
  selectActivePanes({
    tabs: [{ id: 'tab-1', panes: [stablePane, null, { id: '', type: 'editor' }] }],
    activeTabId: 'tab-1',
  }),
  [stablePane],
);

assert.deepEqual(
  nodeRuntimeBindingsFromTerminalBindings({
    ' nodeA\u0000 ': ' term-a\u0000 ',
    '\u0000 ': 'term-blank-node',
    nodeBlank: ' \u0000 ',
    nodeOther: 12,
  }),
  {
    nodeA: { terminalId: 'term-a', runtimeSessionId: null, adapterStatus: null },
  },
);

console.log('PASS workspace workflow status guard');
