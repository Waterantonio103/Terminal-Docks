import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const editorPane = readFileSync(resolve(root, 'src/components/Editor/EditorPane.tsx'), 'utf8');
const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8');

for (const value of [
  'aria-label={filePath ? "Open current directory" : "Open file"}',
  'aria-label="Reload file"',
  "aria-label={filePath ? 'Save' : 'Save as'}",
]) {
  assert.ok(editorPane.includes(value), `missing ${value}`);
}

assert.ok(
  packageJson.includes('node ./tests/editorPaneUiSmoke.test.mjs'),
  'test:graph should run the editor pane UI smoke test',
);

console.log('PASS editor pane icon buttons expose accessible labels');
