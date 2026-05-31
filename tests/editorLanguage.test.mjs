import assert from 'node:assert/strict';
import {
  editorLanguageKindForPath,
  extensionForPath,
  fileNameFromPath,
  languageLabelForPath,
} from '../.tmp-tests/lib/editorLanguage.js';

const cases = [
  ['C:\\repo\\package.json', 'json', 'JSON'],
  ['C:\\repo\\package-lock.json', 'json', 'JSON'],
  ['/repo/tsconfig.json', 'json', 'JSON'],
  ['/repo/tsconfig.node.json', 'json', 'JSON'],
  ['/repo/.vscode/settings.jsonc', 'json', 'JSON'],
  ['/repo/src/App.tsx', 'tsx', 'TSX'],
  ['/repo/src/index.ts', 'typescript', 'TypeScript'],
  ['/repo/src/view.jsx', 'jsx', 'JSX'],
  ['/repo/src/main.mjs', 'javascript', 'JavaScript'],
  ['/repo/README.md', 'markdown', 'Markdown'],
  ['/repo/docs/spec.markdown', 'markdown', 'Markdown'],
  ['/repo/src/styles.css', 'css', 'CSS'],
  ['/repo/src/index.html', 'html', 'HTML'],
  ['/repo/src/main.rs', 'rust', 'Rust'],
  ['/repo/Cargo.toml', 'toml', 'TOML'],
  ['/repo/Cargo.lock', 'toml', 'TOML'],
  ['/repo/.github/workflows/build.yml', 'yaml', 'YAML'],
  ['/repo/docker-compose.yaml', 'yaml', 'YAML'],
  ['/repo/.env', 'env', 'ENV'],
  ['/repo/.env.local', 'env', 'ENV'],
  ['/repo/.env-production', 'env', 'ENV'],
];

for (const [path, kind, label] of cases) {
  assert.equal(editorLanguageKindForPath(path), kind, `${path}: language kind`);
  assert.equal(languageLabelForPath(path), label, `${path}: language label`);
}

assert.equal(fileNameFromPath('C:\\repo\\src\\EditorPane.tsx'), 'EditorPane.tsx');
assert.equal(fileNameFromPath(' C:\\repo\\src\\EditorPane.tsx\u0000 '), 'EditorPane.tsx');
assert.equal(fileNameFromPath('C:\\repo\\src\\'), 'src');
assert.equal(extensionForPath('C:\\repo\\src\\EditorPane.tsx'), 'tsx');
assert.equal(extensionForPath(' C:\\repo\\src\\EditorPane.TSX\u0000 '), 'tsx');
assert.equal(extensionForPath('/repo/Makefile'), '');

console.log('PASS editor language mapping covers supported file modes');
