import assert from 'node:assert/strict';
import { loadLanguageExtensionForPath } from '../.tmp-tests/lib/editorLanguageExtensions.js';

const paths = [
  '/repo/package.json',
  '/repo/src/App.tsx',
  '/repo/src/index.ts',
  '/repo/src/view.jsx',
  '/repo/src/main.js',
  '/repo/README.md',
  '/repo/src/styles.css',
  '/repo/src/theme.scss',
  '/repo/src/theme.sass',
  '/repo/src/index.html',
  '/repo/src/layout.xml',
  '/repo/src/App.vue',
  '/repo/src/App.svelte',
  '/repo/src/main.rs',
  '/repo/src/app.py',
  '/repo/src/main.go',
  '/repo/src/Main.java',
  '/repo/src/Main.kt',
  '/repo/src/App.swift',
  '/repo/src/native.c',
  '/repo/src/native.cpp',
  '/repo/src/Program.cs',
  '/repo/src/index.php',
  '/repo/src/script.rb',
  '/repo/scripts/build.sh',
  '/repo/scripts/build.ps1',
  '/repo/db/schema.sql',
  '/repo/Dockerfile',
  '/repo/Makefile',
  '/repo/changes.patch',
  '/repo/Cargo.toml',
  '/repo/.github/workflows/build.yml',
  '/repo/docker-compose.yaml',
  '/repo/.npmrc',
  '/repo/.env.local',
];

for (const path of paths) {
  const extension = await loadLanguageExtensionForPath(path);
  assert.ok(extension, `${path}: CodeMirror language extension should load`);
}

const plain = await loadLanguageExtensionForPath('/repo/LICENSE');
assert.deepEqual(plain, [], 'plain text files should not load a syntax extension');

console.log('PASS editor CodeMirror language extensions load for supported modes');
