import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { cleanQuickOpenStatusText, collectQuickOpenFiles, filterQuickOpenFiles } from '../.tmp-tests/lib/quickOpenFiles.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const quickOpen = readFileSync(resolve(root, 'src/components/QuickOpen/QuickOpen.tsx'), 'utf8');

const tree = new Map([
  ['C:\\repo', [
    { name: 'src', isDirectory: true, isFile: false },
    { name: 'node_modules', isDirectory: true, isFile: false },
    { name: 'Node_Modules', isDirectory: true, isFile: false },
    { name: 'build', isDirectory: true, isFile: false },
    { name: 'coverage', isDirectory: true, isFile: false },
    { name: 'out', isDirectory: true, isFile: false },
    { name: '.git', isDirectory: true, isFile: false },
    { name: '.env', isDirectory: false, isFile: true },
    { name: '.gitignore', isDirectory: false, isFile: true },
    { name: '..', isDirectory: true, isFile: false },
    { name: 'src\\escape.ts', isDirectory: false, isFile: true },
    { name: 'nested/escape.ts', isDirectory: false, isFile: true },
    { name: 'nul\u0000file.ts', isDirectory: false, isFile: true },
    { name: ' spaced.txt ', isDirectory: false, isFile: true },
    { name: 'README.md', isDirectory: false, isFile: true },
    { name: 'README.md', isDirectory: false, isFile: true },
  ]],
  ['C:\\repo\\src', [
    { name: 'file10.ts', isDirectory: false, isFile: true },
    { name: 'file2.ts', isDirectory: false, isFile: true },
    { name: 'b.ts', isDirectory: false, isFile: true },
    { name: 'nested', isDirectory: true, isFile: false },
    { name: 'a.ts', isDirectory: false, isFile: true },
  ]],
  ['C:\\repo\\src\\nested', [
    { name: 'deep.ts', isDirectory: false, isFile: true },
  ]],
  ['C:\\repo\\build', [
    { name: 'generated.ts', isDirectory: false, isFile: true },
  ]],
  ['C:\\repo\\coverage', [
    { name: 'lcov.info', isDirectory: false, isFile: true },
  ]],
  ['C:\\repo\\out', [
    { name: 'bundle.js', isDirectory: false, isFile: true },
  ]],
]);

async function readDir(path) {
  const entries = tree.get(path);
  if (!entries) throw new Error(`Missing test directory: ${path}`);
  return entries;
}

{
  assert.equal(cleanQuickOpenStatusText('  Root\u0000   missing \n because access denied  '), 'Root missing because access denied');
  assert.equal(cleanQuickOpenStatusText(null), 'Unable to scan workspace files');
  assert.equal(cleanQuickOpenStatusText('x'.repeat(250)).length, 180);
}

{
  const files = await collectQuickOpenFiles('C:\\repo', readDir, { maxFiles: 10 });
  assert.deepEqual(files.map(file => file.path), [
    'C:\\repo\\src\\nested\\deep.ts',
    'C:\\repo\\src\\a.ts',
    'C:\\repo\\src\\b.ts',
    'C:\\repo\\src\\file2.ts',
    'C:\\repo\\src\\file10.ts',
    'C:\\repo\\.env',
    'C:\\repo\\.gitignore',
    'C:\\repo\\README.md',
    'C:\\repo\\spaced.txt',
  ]);
}

{
  let calls = 0;
  const files = await collectQuickOpenFiles(' \u0000 ', async () => {
    calls += 1;
    return [];
  });
  assert.deepEqual(files, []);
  assert.equal(calls, 0);
}

{
  const files = await collectQuickOpenFiles(' C:\\repo\u0000 ', readDir, { maxFiles: 1 });
  assert.deepEqual(files.map(file => file.path), ['C:\\repo\\src\\nested\\deep.ts']);
}

{
  const files = await collectQuickOpenFiles('C:\\repo', readDir, { maxFiles: 2 });
  assert.equal(files.length, 2);
  assert.deepEqual(files.map(file => file.name), ['deep.ts', 'a.ts']);
}

{
  const files = await collectQuickOpenFiles('C:\\repo', readDir, { maxFiles: Number.NaN, maxDepth: Number.NaN });
  assert.deepEqual(files.map(file => file.path), [
    'C:\\repo\\src\\nested\\deep.ts',
    'C:\\repo\\src\\a.ts',
    'C:\\repo\\src\\b.ts',
    'C:\\repo\\src\\file2.ts',
    'C:\\repo\\src\\file10.ts',
    'C:\\repo\\.env',
    'C:\\repo\\.gitignore',
    'C:\\repo\\README.md',
    'C:\\repo\\spaced.txt',
  ]);
}

{
  const files = await collectQuickOpenFiles('C:\\broken', async () => ({ name: 'README.md' }));
  assert.deepEqual(files, []);
}

{
  await assert.rejects(
    () => collectQuickOpenFiles('C:\\missing', async () => {
      throw new Error('root missing');
    }, { throwOnRootReadError: true }),
    /root missing/,
  );
}

{
  const files = await collectQuickOpenFiles('C:\\repo', async path => {
    if (path === 'C:\\repo\\src') throw new Error('nested unreadable');
    return tree.get(path) ?? [];
  }, { throwOnRootReadError: true });
  assert.ok(files.some(file => file.path === 'C:\\repo\\README.md'));
  assert.equal(files.some(file => file.path === 'C:\\repo\\src\\a.ts'), false);
}

{
  const files = await collectQuickOpenFiles('C:\\mixed', async () => [
    null,
    'README.md',
    { name: 'truthy.ts', isDirectory: 'yes', isFile: false },
    { name: 'both.ts', isDirectory: true, isFile: true },
    { name: 'neither.ts', isDirectory: false, isFile: false },
    { name: 'valid.ts', isDirectory: false, isFile: true },
  ]);
  assert.deepEqual(files, [{ path: 'C:\\mixed\\valid.ts', name: 'valid.ts' }]);
}

{
  const files = await collectQuickOpenFiles('C:\\repo', readDir, { ignoredDirectories: [' SRC\u0000 ', 'nested/path'] });
  assert.deepEqual(files.map(file => file.path), [
    'C:\\repo\\.env',
    'C:\\repo\\.gitignore',
    'C:\\repo\\README.md',
    'C:\\repo\\spaced.txt',
  ]);
}

{
  const controller = new AbortController();
  controller.abort();
  const files = await collectQuickOpenFiles('C:\\repo', readDir, { signal: controller.signal });
  assert.deepEqual(files, []);
}

{
  const files = await collectQuickOpenFiles('C:\\repo', async path => {
    if (path !== 'C:\\repo') throw new Error(`Unexpected nested path: ${path}`);
    return [
      { name: 'README.md', isDirectory: false, isFile: true },
      { name: 'readme.md', isDirectory: false, isFile: true },
      { name: 'README.md', isDirectory: false, isFile: true },
    ];
  });
  assert.deepEqual(files.map(file => file.path), ['C:\\repo\\README.md']);
}

{
  const files = await collectQuickOpenFiles('/repo', async path => {
    if (path !== '/repo') throw new Error(`Unexpected nested path: ${path}`);
    return [
      { name: 'README.md', isDirectory: false, isFile: true },
      { name: 'readme.md', isDirectory: false, isFile: true },
    ];
  });
  assert.deepEqual(files.map(file => file.path), ['/repo/README.md', '/repo/readme.md']);
}

{
  const files = [
    { name: 'README.md', path: 'C:\\repo\\README.md' },
    { name: 'deep.ts', path: 'C:\\repo\\src\\nested\\deep.ts' },
    { name: 'reader.ts', path: 'C:\\repo\\src\\reader.ts' },
    { name: 'package.json', path: 'C:\\repo\\package.json' },
  ];
  assert.deepEqual(filterQuickOpenFiles(files, 'read').map(file => file.path), [
    'C:\\repo\\README.md',
    'C:\\repo\\src\\reader.ts',
  ]);
  assert.deepEqual(filterQuickOpenFiles(files, 'src deep').map(file => file.path), [
    'C:\\repo\\src\\nested\\deep.ts',
  ]);
  assert.deepEqual(filterQuickOpenFiles(files, 'src/reader').map(file => file.path), [
    'C:\\repo\\src\\reader.ts',
  ]);
  assert.deepEqual(filterQuickOpenFiles([{ name: 'App.tsx', path: '/repo/src/App.tsx' }], 'src\\app').map(file => file.path), [
    '/repo/src/App.tsx',
  ]);
  assert.deepEqual(filterQuickOpenFiles(files, '', 2).map(file => file.name), ['README.md', 'deep.ts']);
  assert.deepEqual(filterQuickOpenFiles(files, '', Number.NaN).map(file => file.name), ['README.md', 'deep.ts', 'reader.ts', 'package.json']);
  assert.deepEqual(filterQuickOpenFiles(null, 'read'), []);
  assert.deepEqual(filterQuickOpenFiles([
    null,
    { name: 'README.md', path: 'C:\\repo\\README.md' },
    { name: 42, path: 'C:\\repo\\bad.ts' },
    { name: 'bad.ts', path: '' },
  ], 'read').map(file => file.path), [
    'C:\\repo\\README.md',
  ]);
  assert.deepEqual(filterQuickOpenFiles(files, null, 2).map(file => file.name), ['README.md', 'deep.ts']);
  assert.deepEqual(filterQuickOpenFiles(files, 'read\u0000me').map(file => file.path), [
    'C:\\repo\\README.md',
  ]);
}

assert.ok(quickOpen.includes('const [scanError, setScanError]'), 'Quick Open should track scan failures for user-visible feedback');
assert.ok(quickOpen.includes('throwOnRootReadError: true'), 'Quick Open should surface root scan failures instead of showing empty results');
assert.ok(quickOpen.includes("console.error('Failed to scan workspace files', error);"), 'Quick Open scan failures should be logged with context');
assert.ok(quickOpen.includes('setScanError(cleanQuickOpenStatusText'), 'Quick Open scan failures should be cleaned before rendering');
assert.ok(quickOpen.includes('filtered.length ? Math.min(s + 1, filtered.length - 1) : 0'), 'Quick Open selection should stay at zero when there are no results');
assert.ok(quickOpen.includes('!scanError && filtered.map'), 'Quick Open should not render stale results while showing a scan error');
assert.ok(quickOpen.includes('className="bg-bg-panel border border-border-panel'), 'Quick Open modal should use the real panel background utility');
assert.ok(quickOpen.includes('hover:bg-bg-surface'), 'Quick Open rows should use the real hover background utility');
assert.ok(!quickOpen.includes('background-bg-'), 'Quick Open should not use stale non-Tailwind background utilities');
assert.ok(quickOpen.includes('aria-label="Close Quick Open"'), 'Quick Open close button should expose an accessible label');

console.log('PASS quick open file collection');
