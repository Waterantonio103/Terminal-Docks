import assert from 'node:assert/strict';
import {
  activePaneIdAfterReplacingTabPanes,
  activePaneIdForPanes,
  activePaneIdForTab,
  activeTabIdForTabs,
  arrayMoveSafely,
  clampPaneInsertIndex,
  currentDirectoryForPane,
  nextTerminalTitle,
  nextUntitledEditorTitle,
  normalizeWorkspaceGridPos,
} from '../.tmp-tests/lib/workspaceTabs.js';

const tabs = [
  { id: 'workspace-a', panes: [{ id: 'a-terminal' }, { id: 'a-editor' }] },
  { id: 'workspace-b', panes: [{ id: 'b-editor' }] },
  { id: 'workspace-empty', panes: [] },
];

assert.equal(activePaneIdForTab(tabs, 'workspace-a'), 'a-terminal');
assert.equal(activePaneIdForTab(tabs, 'workspace-a', 'a-editor'), 'a-editor');
assert.equal(activePaneIdForTab(tabs, ' workspace-a\u0000 ', ' a-editor\u0000 '), 'a-editor');
assert.equal(activePaneIdForTab(tabs, 'workspace-a', 'b-editor'), 'a-terminal');
assert.equal(activePaneIdForTab(tabs, 'workspace-b', 'a-terminal'), 'b-editor');
assert.equal(activePaneIdForTab(tabs, 'workspace-empty'), null);
assert.equal(activePaneIdForTab(tabs, 'missing'), null);
assert.equal(activePaneIdForTab(null, 'workspace-a'), null);
assert.equal(activePaneIdForTab([{ id: 'workspace-dirty', panes: [{}, { id: '' }, { id: 'valid-pane' }] }], 'workspace-dirty'), 'valid-pane');
assert.equal(activePaneIdForTab([null, 'bad-tab', { id: 'workspace-safe', panes: [{ id: 'safe-pane' }] }], 'workspace-safe'), 'safe-pane');
assert.equal(activePaneIdForTab([{ id: 'workspace-malformed', panes: null }], 'workspace-malformed'), null);
assert.equal(activePaneIdForTab([{ id: 'workspace-malformed', panes: 'not panes' }], 'workspace-malformed'), null);
assert.equal(activePaneIdForTab([{ id: 'workspace-malformed', panes: [null, 'bad-pane', { id: 'safe-pane' }] }], 'workspace-malformed'), 'safe-pane');
assert.equal(activePaneIdAfterReplacingTabPanes(tabs, 'workspace-a'), 'a-terminal');
assert.equal(activePaneIdAfterReplacingTabPanes(tabs, 'workspace-empty'), null);
assert.equal(activeTabIdForTabs(tabs, 'workspace-b'), 'workspace-b');
assert.equal(activeTabIdForTabs(tabs, ' workspace-b\u0000 '), 'workspace-b');
assert.equal(activeTabIdForTabs(tabs, 'missing', 'workspace-a'), 'workspace-a');
assert.equal(activeTabIdForTabs(tabs, 'missing', ' workspace-a\u0000 '), 'workspace-a');
assert.equal(activeTabIdForTabs(tabs, 'missing'), 'workspace-a');
assert.equal(activeTabIdForTabs([{ id: '' }, {}, { id: 'workspace-c' }], 'missing'), 'workspace-c');
assert.equal(activeTabIdForTabs([null, 'bad-tab', { id: 'workspace-c' }], 'missing'), 'workspace-c');
assert.equal(activeTabIdForTabs(null, 'missing'), null);
assert.equal(activeTabIdForTabs([], 'missing'), null);
assert.equal(activePaneIdForPanes([{ id: 'first-pane' }, { id: 'second-pane' }], 'second-pane'), 'second-pane');
assert.equal(activePaneIdForPanes([{ id: 'first-pane' }, { id: 'second-pane' }], ' second-pane\u0000 '), 'second-pane');
assert.equal(activePaneIdForPanes([{ id: 'first-pane' }, { id: 'second-pane' }], 'stale-pane'), 'first-pane');
assert.equal(activePaneIdForPanes([null, 'bad-pane', { id: '' }, { id: 'safe-pane' }], 'stale-pane'), 'safe-pane');
assert.equal(activePaneIdForPanes(null, 'stale-pane'), null);
assert.equal(activePaneIdForPanes([], 'stale-pane'), null);
assert.deepEqual(arrayMoveSafely(['a', 'b', 'c'], 0, 2), ['b', 'c', 'a']);
assert.deepEqual(arrayMoveSafely(['a', 'b', 'c'], -1, 1), ['a', 'b', 'c']);
assert.deepEqual(arrayMoveSafely(['a', 'b', 'c'], 1, -1), ['a', 'b', 'c']);
assert.deepEqual(arrayMoveSafely(['a', 'b', 'c'], 0.5, 2), ['a', 'b', 'c']);
assert.deepEqual(arrayMoveSafely(['a', 'b', 'c'], 0, Number.NaN), ['a', 'b', 'c']);
assert.deepEqual(arrayMoveSafely(['a', 'b', 'c'], 1, 1), ['a', 'b', 'c']);
assert.equal(clampPaneInsertIndex(3, 0), 0);
assert.equal(clampPaneInsertIndex(3, 2), 2);
assert.equal(clampPaneInsertIndex(3, 3), 3);
assert.equal(clampPaneInsertIndex(3, 4), 3);
assert.equal(clampPaneInsertIndex(3, -1), 0);
assert.equal(clampPaneInsertIndex(3, Number.NaN), 3);
assert.equal(clampPaneInsertIndex(0, 2), 0);
assert.equal(clampPaneInsertIndex(Number.NaN, 2), 0);
assert.deepEqual(
  normalizeWorkspaceGridPos({ x: 99.9, y: -1, w: 20.8, h: 1 }, { x: 5, y: 6, w: 25, h: 40 }),
  { x: 80, y: 0, w: 20, h: 2 },
);
assert.deepEqual(
  normalizeWorkspaceGridPos({ x: Number.NaN, y: 2.9, w: 500, h: Number.POSITIVE_INFINITY }, { x: 5, y: 6, w: 25, h: 40 }),
  { x: 0, y: 2, w: 100, h: 40 },
);
assert.deepEqual(
  normalizeWorkspaceGridPos(null, { x: 5, y: 6, w: 25, h: 40 }),
  { x: 5, y: 6, w: 25, h: 40 },
);

assert.equal(currentDirectoryForPane({ data: { cwd: ' C:\\repo\\packages\\app ' } }, 'C:\\repo'), 'C:\\repo\\packages\\app');
assert.equal(currentDirectoryForPane({ data: { cwd: ' C:\\repo\\\\packages\\.\\app\\..\\tooling ' } }, 'C:\\repo'), 'C:\\repo\\packages\\tooling');
assert.equal(currentDirectoryForPane({ data: { workspaceDir: 'C:\\other-repo', cwd: 'packages\\app' } }, 'C:\\repo'), 'C:\\other-repo\\packages\\app');
assert.equal(currentDirectoryForPane({ data: { cwd: 'packages\\app' } }, 'C:\\repo'), 'C:\\repo\\packages\\app');
assert.equal(currentDirectoryForPane({ data: { cwd: 'C:packages\\app' } }, 'C:\\repo'), 'C:\\repo');
assert.equal(currentDirectoryForPane({ data: { cwd: 'packages/app' } }, '/repo'), '/repo/packages/app');
assert.equal(currentDirectoryForPane({ data: { cwd: 'packages/app' } }, ''), null);
assert.equal(currentDirectoryForPane({ data: { cwd: 'packages/../app' } }, '/repo'), '/repo/app');
assert.equal(currentDirectoryForPane({ data: { cwd: '../outside' } }, '/repo'), '/repo');
assert.equal(currentDirectoryForPane({ data: { cwd: 'packages/app\u0000' } }, '/repo'), '/repo/packages/app');
assert.equal(currentDirectoryForPane({ data: { filePath: 'C:\\repo\\src\\App.tsx' } }, 'C:\\repo'), 'C:\\repo\\src');
assert.equal(currentDirectoryForPane({ data: { filePath: 'C:\\repo\\\\src\\.\\nested\\..\\App.tsx' } }, 'C:\\repo'), 'C:\\repo\\src');
assert.equal(currentDirectoryForPane({ data: { filePath: 'C:src\\App.tsx' } }, 'C:\\repo'), 'C:\\repo');
assert.equal(currentDirectoryForPane({ data: { cwd: '', filePath: '/repo/src/App.tsx' } }, '/repo'), '/repo/src');
assert.equal(currentDirectoryForPane({ data: { filePath: 'src/App.tsx' } }, '/repo'), '/repo/src');
assert.equal(currentDirectoryForPane({ data: { filePath: 'src/App.tsx' } }, null), null);
assert.equal(currentDirectoryForPane({ data: { filePath: 'src/../App.tsx' } }, '/repo'), '/repo');
assert.equal(currentDirectoryForPane({ data: { filePath: '../outside/App.tsx' } }, '/repo'), '/repo');
assert.equal(currentDirectoryForPane({ data: { workspaceDir: '/other-repo', filePath: 'src/App.tsx' } }, '/repo'), '/other-repo/src');
assert.equal(currentDirectoryForPane({ data: { filePath: 'src/App.tsx\u0000' } }, '/repo\u0000'), '/repo/src');
assert.equal(currentDirectoryForPane({ data: { filePath: 'src\\App.tsx' } }, 'C:\\repo'), 'C:\\repo\\src');
assert.equal(currentDirectoryForPane({ data: { filePath: 'README.md' } }, '/repo'), '/repo');
assert.equal(currentDirectoryForPane({ data: { workspaceDir: '/pane-repo' } }, '/repo'), '/pane-repo');
assert.equal(currentDirectoryForPane({ data: {} }, '/repo'), '/repo');
assert.equal(currentDirectoryForPane({ data: {} }, '/repo/./nested/..'), '/repo');
assert.equal(currentDirectoryForPane(null, ' /repo '), '/repo');
assert.equal(currentDirectoryForPane({ data: { cwd: '', filePath: '' } }, ''), null);

assert.equal(nextUntitledEditorTitle([]), 'Untitled');
assert.equal(nextUntitledEditorTitle(null), 'Untitled');
assert.equal(nextUntitledEditorTitle([{ type: 'editor', title: 'Untitled' }]), 'Untitled 2');
assert.equal(nextUntitledEditorTitle([{ type: 'editor', title: 'Untitled' }, { type: 'editor', title: 'Untitled 2' }]), 'Untitled 3');
assert.equal(nextUntitledEditorTitle([{ type: 'terminal', title: 'Untitled' }, { type: 'editor', title: 'Untitled 2' }]), 'Untitled');
assert.equal(nextUntitledEditorTitle([{ type: 'editor', title: 'Untitled' }, { type: 'editor', title: 'Untitled 3' }]), 'Untitled 2');
assert.equal(nextUntitledEditorTitle([{ type: 'editor', title: 'Untitled 0' }, { type: 'editor', title: 'Untitled' }]), 'Untitled 2');
assert.equal(nextUntitledEditorTitle([{ type: 'editor', title: 'Untitled\u0000   2' }, { type: 'editor', title: ' Untitled ' }]), 'Untitled 3');
assert.equal(nextUntitledEditorTitle([null, 'bad-pane', { type: 'editor', title: 'Untitled' }]), 'Untitled 2');
assert.equal(nextTerminalTitle([]), 'Terminal 1');
assert.equal(nextTerminalTitle(null), 'Terminal 1');
assert.equal(nextTerminalTitle([{ type: 'terminal', title: 'Terminal 1' }]), 'Terminal 2');
assert.equal(nextTerminalTitle([{ type: 'terminal', title: 'Terminal 1' }, { type: 'terminal', title: 'Terminal 3' }]), 'Terminal 2');
assert.equal(nextTerminalTitle([{ type: 'editor', title: 'Terminal 1' }, { type: 'terminal', title: 'Terminal' }]), 'Terminal 2');
assert.equal(nextTerminalTitle([{ type: 'terminal', title: 'Terminal 0' }, { type: 'terminal', title: 'Terminal 1' }]), 'Terminal 2');
assert.equal(nextTerminalTitle([{ type: 'terminal', title: 'Terminal\u0000   2' }, { type: 'terminal', title: ' Terminal ' }]), 'Terminal 3');
assert.equal(nextTerminalTitle([null, 'bad-pane', { type: 'terminal', title: 'Terminal 1' }]), 'Terminal 2');

console.log('PASS workspace tab helpers keep active panes inside the active tab');
