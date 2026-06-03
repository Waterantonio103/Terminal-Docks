import assert from 'node:assert/strict';
import {
  getFileIconDescriptor,
  getFileExtension,
  getFolderIconDescriptor,
  getImageMimeType,
  isBinaryLikeFile,
  isImageFile,
} from '../.tmp-tests/lib/fileIcons.js';

assert.equal(getFileExtension('C:\\repo\\src\\App.TSX'), 'tsx');
assert.equal(getFileExtension(' /repo/assets/logo.SVG\u0000 '), 'svg');
assert.equal(getFileExtension('/repo/assets/logo.svg?raw'), 'svg');
assert.equal(getFileExtension('/repo/assets/photo.png#preview'), 'png');
assert.equal(getFileExtension('/repo/.env'), 'env');
assert.equal(getFileExtension('/repo/.env.local'), 'env');
assert.equal(getFileExtension('/repo/.env-production'), 'env');
assert.equal(getFileExtension('/repo/.gitignore'), 'gitignore');
assert.equal(getFileExtension(' C:\\repo\\.EDITORCONFIG '), 'editorconfig');
assert.equal(getFileExtension('/repo/archive.'), '');
assert.equal(getFileExtension(null), '');

assert.equal(isImageFile('C:\\repo\\assets\\photo.JPG\u0000'), true);
assert.equal(isImageFile('/repo/assets/photo.webp?cache=1'), true);
assert.equal(isImageFile('/repo/src/App.tsx'), false);
assert.equal(isBinaryLikeFile('/repo/archive.zip'), true);
assert.equal(isBinaryLikeFile('/repo/movie.mp4'), true);
assert.equal(isBinaryLikeFile('/repo/report.pdf'), true);
assert.equal(isBinaryLikeFile('/repo/src/App.tsx'), false);
assert.equal(getImageMimeType('/repo/assets/icon.ico'), 'image/x-icon');
assert.equal(getImageMimeType('/repo/assets/photo.jfif'), 'image/jpeg');
assert.equal(getImageMimeType('/repo/assets/vector.svg\u0000'), 'image/svg+xml');

const iconCases = [
  ['src/app.py', 'material', 'python'],
  ['src/main.rs', 'material', 'rust'],
  ['src/index.html', 'material', 'html'],
  ['src/styles.css', 'material', 'css'],
  ['src/App.tsx', 'material', 'react_ts'],
  ['src/main.go', 'material', 'go'],
  ['src/Main.java', 'material', 'java'],
  ['src/native.cpp', 'material', 'cpp'],
  ['src/Program.cs', 'material', 'csharp'],
  ['src/index.php', 'material', 'php'],
  ['src/script.rb', 'material', 'ruby'],
  ['src/App.vue', 'material', 'vue'],
  ['src/App.svelte', 'material', 'svelte'],
  ['Dockerfile', 'material', 'docker'],
  ['.env.local', 'material', 'tune'],
  ['script.ps1', 'material', 'powershell'],
  ['Makefile', 'material', 'makefile'],
  ['archive.zip', 'material', 'zip'],
  ['song.mp3', 'material', 'audio'],
  ['movie.mp4', 'material', 'video'],
  ['report.pdf', 'material', 'pdf'],
  ['font.woff2', 'material', 'font'],
  ['mesh.gltf', 'material', '3d'],
  ['data.parquet', 'material', 'database'],
  ['sample.geojson', 'material', 'json'],
];

for (const [path, kind, label] of iconCases) {
  const descriptor = getFileIconDescriptor(path);
  assert.equal(descriptor.kind, kind, `${path}: icon kind`);
  assert.equal(descriptor.label, label, `${path}: icon label`);
  assert.ok(descriptor.color, `${path}: icon color`);
  assert.ok(descriptor.src?.startsWith('/vendor/material-icon-theme/icons/'), `${path}: material icon URL`);
  assert.ok(descriptor.src?.endsWith('.svg'), `${path}: material icon SVG`);
}

assert.equal(getFolderIconDescriptor('src').kind, 'material');
assert.equal(getFolderIconDescriptor('src').label, 'folder');
assert.equal(getFolderIconDescriptor('src').src, '/vendor/material-icon-theme/icons/folder.svg');
assert.equal(getFolderIconDescriptor('src', true).label, 'folder-open');
assert.equal(getFolderIconDescriptor('node_modules').label, 'folder');

console.log('PASS file icon helpers normalize extensions and image mime types');
