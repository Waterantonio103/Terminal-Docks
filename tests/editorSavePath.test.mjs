import assert from 'node:assert/strict';
import {
  defaultEditorSavePath,
  sanitizeEditorSaveName,
} from '../.tmp-tests/lib/editorSavePath.js';

assert.equal(sanitizeEditorSaveName(' Untitled '), 'Untitled');
assert.equal(sanitizeEditorSaveName(null), 'Untitled');
assert.equal(sanitizeEditorSaveName({ title: 'notes.md' }), 'Untitled');
assert.equal(sanitizeEditorSaveName('notes: friday / draft?'), 'notes- friday - draft');
assert.equal(sanitizeEditorSaveName('...   '), 'Untitled');
assert.equal(sanitizeEditorSaveName('report.txt'), 'report.txt');
assert.equal(sanitizeEditorSaveName('report.md?'), 'report.md');
assert.equal(sanitizeEditorSaveName('../secret.md'), 'secret.md');
assert.equal(sanitizeEditorSaveName('..\\secret.md'), 'secret.md');
assert.equal(sanitizeEditorSaveName('.gitignore'), '.gitignore');
assert.equal(sanitizeEditorSaveName('CON'), '_CON');
assert.equal(sanitizeEditorSaveName('lpt1.txt'), '_lpt1.txt');
assert.equal(sanitizeEditorSaveName('company.txt'), 'company.txt');
assert.equal(sanitizeEditorSaveName(`${'a'.repeat(140)}.tsx`).length, 120);
assert.equal(sanitizeEditorSaveName(`${'a'.repeat(140)}.tsx`).endsWith('.tsx'), true);
assert.equal(sanitizeEditorSaveName('b'.repeat(140)).length, 120);

assert.equal(defaultEditorSavePath(null, 'Untitled'), 'Untitled.txt');
assert.equal(defaultEditorSavePath(null, null), 'Untitled.txt');
assert.equal(defaultEditorSavePath(null, 'CON'), '_CON.txt');
assert.equal(defaultEditorSavePath(null, 'LPT1.txt'), '_LPT1.txt');
assert.equal(defaultEditorSavePath('\u0000', 'Untitled'), 'Untitled.txt');
assert.equal(defaultEditorSavePath('C:\\repo\\app\\', 'notes: friday / draft?'), 'C:\\repo\\app\\notes- friday - draft.txt');
assert.equal(defaultEditorSavePath('C:\\repo\\app\\', '../secret.md'), 'C:\\repo\\app\\secret.md');
assert.equal(defaultEditorSavePath('C:\\repo\\app\\', 'report.md?'), 'C:\\repo\\app\\report.md');
assert.equal(defaultEditorSavePath(' C:\\repo\\app\u0000\\ ', 'draft'), 'C:\\repo\\app\\draft.txt');
assert.equal(defaultEditorSavePath('/repo/app/', 'report.md'), '/repo/app/report.md');
assert.equal(defaultEditorSavePath('/repo/app/', `${'a'.repeat(140)}.md`).length, '/repo/app/'.length + 120);
assert.equal(defaultEditorSavePath('/repo/app/', `${'a'.repeat(140)}.md`).endsWith('.md'), true);

console.log('PASS editor save paths sanitize untitled pane titles');
