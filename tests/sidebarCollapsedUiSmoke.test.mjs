import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileTree = readFileSync(resolve(root, 'src/components/Sidebar/FileTree.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8');

for (const value of [
  "className={iconOnly ? 'td-sidebar-empty-icon-only'",
  '{!iconOnly && <Folder size={28}',
  'type="button"',
  "className={iconOnly ? 'td-sidebar-open-folder-button'",
  '{iconOnly ? <Folder size={11} strokeWidth={1.9} /> :',
]) {
  assert.ok(fileTree.includes(value), `missing collapsed sidebar source marker: ${value}`);
}

assert.ok(
  readFileSync(resolve(root, 'src/components/Sidebar/Sidebar.tsx'), 'utf8').includes('className="td-sidebar-collapsed-workspace-button"'),
  'missing collapsed workspace header button class',
);

for (const value of [
  '.td-sidebar-empty-icon-only',
  '.td-sidebar-open-folder-button',
  '.td-sidebar-collapsed-workspace-button',
  'height: 18px;',
  'width: 18px;',
  'min-height: 18px;',
  'min-width: 18px;',
  'flex: 0 0 18px;',
  'box-sizing: border-box;',
  'display: inline-flex;',
  'align-items: center;',
  'justify-content: center;',
  'line-height: 0;',
  'height: 11px;',
  'width: 11px;',
  '.td-sidebar-icon-only-item svg',
  'height: 22px;',
  'width: 22px;',
]) {
  assert.ok(css.includes(value), `missing collapsed sidebar CSS marker: ${value}`);
}

console.log('PASS collapsed sidebar open-folder affordance stays compact and centered');
