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
  ['/repo/src/theme.scss', 'scss', 'SCSS'],
  ['/repo/src/theme.sass', 'sass', 'Sass'],
  ['/repo/src/index.html', 'html', 'HTML'],
  ['/repo/src/layout.xml', 'xml', 'XML'],
  ['/repo/src/App.vue', 'vue', 'Vue'],
  ['/repo/src/App.svelte', 'svelte', 'Svelte'],
  ['/repo/src/main.rs', 'rust', 'Rust'],
  ['/repo/src/app.py', 'python', 'Python'],
  ['/repo/src/main.go', 'go', 'Go'],
  ['/repo/src/Main.java', 'java', 'Java'],
  ['/repo/src/Main.kt', 'kotlin', 'Kotlin'],
  ['/repo/src/App.swift', 'swift', 'Swift'],
  ['/repo/src/native.c', 'c', 'C'],
  ['/repo/src/native.h', 'c', 'C'],
  ['/repo/src/native.cpp', 'cpp', 'C++'],
  ['/repo/src/native.hpp', 'cpp', 'C++'],
  ['/repo/src/Program.cs', 'csharp', 'C#'],
  ['/repo/src/index.php', 'php', 'PHP'],
  ['/repo/src/script.rb', 'ruby', 'Ruby'],
  ['/repo/scripts/build.sh', 'shell', 'Shell'],
  ['/repo/scripts/build.ps1', 'powershell', 'PowerShell'],
  ['/repo/db/schema.sql', 'sql', 'SQL'],
  ['/repo/Dockerfile', 'dockerfile', 'Dockerfile'],
  ['/repo/Makefile', 'makefile', 'Makefile'],
  ['/repo/changes.patch', 'diff', 'Diff'],
  ['/repo/Cargo.toml', 'toml', 'TOML'],
  ['/repo/Cargo.lock', 'toml', 'TOML'],
  ['/repo/.github/workflows/build.yml', 'yaml', 'YAML'],
  ['/repo/docker-compose.yaml', 'yaml', 'YAML'],
  ['/repo/.npmrc', 'ini', 'INI'],
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
assert.equal(languageLabelForPath('/repo/notebook.ipynb'), 'Jupyter Notebook');
assert.equal(languageLabelForPath('/repo/archive.zip'), 'ZIP Archive');
assert.equal(languageLabelForPath('/repo/report.pdf'), 'PDF');
assert.equal(languageLabelForPath('/repo/song.mp3'), 'MP3 Audio');
assert.equal(languageLabelForPath('/repo/movie.mp4'), 'MP4 Video');
assert.equal(languageLabelForPath('/repo/model.gltf'), 'glTF');
assert.equal(languageLabelForPath('/repo/font.woff2'), 'Web Font');
assert.equal(languageLabelForPath('/repo/README'), 'README');

console.log('PASS editor language mapping covers supported file modes');
