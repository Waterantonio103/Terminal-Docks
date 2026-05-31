import assert from 'node:assert/strict';
import {
  getFileExtension,
  getImageMimeType,
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
assert.equal(getImageMimeType('/repo/assets/icon.ico'), 'image/x-icon');
assert.equal(getImageMimeType('/repo/assets/photo.jfif'), 'image/jpeg');
assert.equal(getImageMimeType('/repo/assets/vector.svg\u0000'), 'image/svg+xml');

console.log('PASS file icon helpers normalize extensions and image mime types');
