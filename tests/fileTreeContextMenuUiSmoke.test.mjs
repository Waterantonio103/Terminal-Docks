import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const fileTree = readFileSync(resolve(root, 'src/components/Sidebar/FileTree.tsx'), 'utf8');

for (const value of [
  "if (!contextMenu) return;",
  "const cleanPromptName = (value: string) => value.replace(/\\0/g, '').replace(/\\s+/g, ' ').trim();",
  'const openContextMenuAt = (file: DirEntry, parentPath: string, x: number, y: number)',
  'openContextMenuAt(file, parentPath, e.clientX, e.clientY);',
  "event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')",
  'const rect = selectedRow.getBoundingClientRect();',
  'openContextMenuAt(selected.file, selected.parentPath, rect.left + 12, rect.top + Math.min(24, rect.height));',
  "if (event.key === 'Escape')",
  "window.addEventListener('keydown', handleKeyDown);",
  'const contextMenuRef = useRef<HTMLDivElement>(null);',
  'contextMenuRef.current?.querySelector<HTMLButtonElement>',
  'handleContextMenuKeyDown',
  "['ArrowDown', 'ArrowUp', 'Home', 'End']",
  'menuItems[nextIndex].focus();',
  'const destPath = joinWorkspacePath(targetDir, fileName);',
  'const nextName = cleanPromptName(promptValue);',
  'ref={contextMenuRef}',
  'onKeyDown={handleContextMenuKeyDown}',
  'role="menu"',
  "aria-label={isRoot ? 'Workspace actions'",
  'type="button"',
  'role="menuitem"',
  'aria-disabled={disabled || undefined}',
]) {
  assert.ok(fileTree.includes(value), `missing file-tree context menu marker: ${value}`);
}

console.log('PASS file tree context menu exposes menu semantics and closes on Escape');
