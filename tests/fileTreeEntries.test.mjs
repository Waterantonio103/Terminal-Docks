import assert from 'node:assert/strict';
import { fileTreeLockMatchesPath, normalizeFileTreeEntries } from '../.tmp-tests/lib/fileTreeEntries.js';

{
  const entries = normalizeFileTreeEntries([
    { name: 'zeta.ts', isDirectory: false, isFile: true },
    { name: 'src', isDirectory: true, isFile: false },
    { name: '  README.md  ', isDirectory: false, isFile: true },
    { name: 'nested/path.ts', isDirectory: false, isFile: true },
    { name: 'escape\\path.ts', isDirectory: false, isFile: true },
    { name: '..', isDirectory: true, isFile: false },
    { name: 'nul\u0000name.ts', isDirectory: false, isFile: true },
    { name: '', isDirectory: false, isFile: true },
    { name: 'empty-kind', isDirectory: false, isFile: false },
    { name: 'components', isDirectory: true, isFile: false },
  ]);

  assert.deepEqual(entries, [
    { name: 'components', isDirectory: true, isFile: false },
    { name: 'src', isDirectory: true, isFile: false },
    { name: 'README.md', isDirectory: false, isFile: true },
    { name: 'zeta.ts', isDirectory: false, isFile: true },
  ]);
}

{
  assert.deepEqual(normalizeFileTreeEntries(null), []);
  assert.deepEqual(normalizeFileTreeEntries({ name: 'README.md' }), []);
  assert.deepEqual(normalizeFileTreeEntries([{ name: 42, isDirectory: false, isFile: true }]), []);
}

{
  const entries = normalizeFileTreeEntries([
    { name: 'file.txt', isDirectory: true, isFile: true },
  ]);

  assert.deepEqual(entries, [
    { name: 'file.txt', isDirectory: true, isFile: false },
  ]);
}

{
  const entries = normalizeFileTreeEntries([
    { name: ' README.md ', isDirectory: false, isFile: true },
    { name: 'README.md', isDirectory: false, isFile: true },
    { name: 'App.tsx', isDirectory: false, isFile: true },
    { name: 'app.tsx', isDirectory: false, isFile: true },
    { name: 'src', isDirectory: false, isFile: true },
    { name: 'src', isDirectory: true, isFile: false },
  ]);

  assert.deepEqual(entries, [
    { name: 'src', isDirectory: true, isFile: false },
    { name: 'App.tsx', isDirectory: false, isFile: true },
    { name: 'app.tsx', isDirectory: false, isFile: true },
    { name: 'README.md', isDirectory: false, isFile: true },
  ]);
}

{
  const entries = normalizeFileTreeEntries([
    { name: 'README.md', isDirectory: false, isFile: true },
    { name: 'readme.md', isDirectory: false, isFile: true },
    { name: 'src', isDirectory: false, isFile: true },
    { name: 'SRC', isDirectory: true, isFile: false },
  ], { parentPath: 'C:\\repo' });

  assert.deepEqual(entries, [
    { name: 'SRC', isDirectory: true, isFile: false },
    { name: 'README.md', isDirectory: false, isFile: true },
  ]);
}

{
  const entries = normalizeFileTreeEntries([
    { name: 'README.md', isDirectory: false, isFile: true },
    { name: 'readme.md', isDirectory: false, isFile: true },
  ], { parentPath: '/repo' });

  assert.deepEqual(entries, [
    { name: 'README.md', isDirectory: false, isFile: true },
    { name: 'readme.md', isDirectory: false, isFile: true },
  ]);
}

assert.equal(fileTreeLockMatchesPath('C:\\repo\\src\\README.md', 'C:\\repo\\src\\README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath('C:\\repo\\src\\.\\README.md', 'C:\\repo\\src\\README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath('C:\\Repo\\SRC\\readme.md', 'C:\\repo\\src\\README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath('/repo/src/README.md', '/repo/src/README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath('/repo/src/readme.md', '/repo/src/README.md', 'README.md'), false);
assert.equal(fileTreeLockMatchesPath('README.md', '/repo/src/README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath('src/README.md', '/repo/src/README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath('SRC/readme.md', 'C:\\repo\\src\\README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath('other/README.md', '/repo/src/README.md', 'README.md'), false);
assert.equal(fileTreeLockMatchesPath('readme.md', 'C:\\repo\\src\\README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath('/other/README.md', '/repo/src/README.md', 'README.md'), false);
assert.equal(fileTreeLockMatchesPath('/repo/src/myREADME.md', '/repo/src/README.md', 'README.md'), false);
assert.equal(fileTreeLockMatchesPath('/repo/src/README.md.bak', '/repo/src/README.md', 'README.md'), false);
assert.equal(fileTreeLockMatchesPath('/repo/src/README.md\u0000', '/repo/src/README.md', 'README.md'), true);
assert.equal(fileTreeLockMatchesPath(null, '/repo/src/README.md', 'README.md'), false);

console.log('PASS file tree entry normalization');
