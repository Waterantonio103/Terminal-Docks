import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const editor = readFileSync(resolve(root, 'src/components/Editor/EditorPane.tsx'), 'utf8');
const workspaceGrid = readFileSync(resolve(root, 'src/components/Layout/WorkspaceGrid.tsx'), 'utf8');
const workspaceStore = readFileSync(resolve(root, 'src/store/workspace.ts'), 'utf8');

assert.ok(
  editor.includes("if (isDirty && !window.confirm('Open another file and discard unsaved changes in this editor?')) return;"),
  'opening another file from a dirty editor should require discard confirmation',
);
assert.ok(
  editor.includes("if (isDirty && !window.confirm('Reload this file and discard unsaved changes?')) return;"),
  'reloading a dirty file should keep its discard confirmation',
);
assert.ok(
  workspaceStore.includes("if (existingFile.data?.editorDirty) {\r\n            return { activePaneId: existingFile.id };\r\n          }")
    || workspaceStore.includes("if (existingFile.data?.editorDirty) {\n            return { activePaneId: existingFile.id };\n          }"),
  'opening a file that is already dirty in another pane should focus it without forcing a reload',
);
assert.ok(
  workspaceStore.indexOf('addPaneAt: (type, title, index, data)') < workspaceStore.lastIndexOf('if (existingFile.data?.editorDirty)'),
  'positioned pane adds should also focus existing dirty editors instead of duplicating or reloading them',
);
assert.ok(
  workspaceStore.includes('function refreshedFilePaneData(state: WorkspaceState, type: PaneType, data: any): any'),
  'existing file refreshes should share pane data normalization with new panes',
);
assert.ok(
  workspaceStore.includes('const nextData = refreshedFilePaneData(state, type, data);'),
  'existing file refreshes should normalize incoming data before merging it',
);
assert.ok(
  workspaceStore.includes('? { ...p, title: paneTitle, data: { ...p.data, ...nextData } }'),
  'existing file refreshes should merge normalized pane data',
);
assert.ok(
  workspaceGrid.includes("overPane?.type === 'editor' && !overPane.data?.editorDirty"),
  'dropping a file onto a dirty editor should not replace that editor pane',
);
assert.ok(
  workspaceGrid.includes("updatePaneData(overPane.id, { filePath: data.filePath, editorDirty: false, editorReloadToken: `${Date.now()}` })"),
  'dropping a file onto a clean editor should force the editor to reload the dropped file',
);

console.log('PASS editor open/reload actions guard dirty editor content');
