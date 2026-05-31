import assert from 'node:assert/strict';
import {
  clearCachedEditorDirty,
  getCachedDirtyEditorContent,
  getCachedEditorContent,
  getCachedEditorViewState,
  listCachedDirtyEditorPaths,
  markCachedEditorDirty,
  resetEditorSessionCacheForTests,
  setCachedEditorContent,
  setCachedEditorViewState,
} from '../.tmp-tests/lib/editorSessionCache.js';

resetEditorSessionCacheForTests();

const path = 'C:\\repo\\src\\large.ts';
const largeContent = Array.from({ length: 25000 }, (_, index) => `export const value${index} = ${index};`).join('\n');

setCachedEditorContent(path, 'initial');
assert.equal(getCachedEditorContent(path), 'initial');
assert.equal(getCachedDirtyEditorContent(path), undefined);

setCachedEditorContent(' \u0000 ', 'ignored');
markCachedEditorDirty(' \u0000 ', 'ignored dirty');
setCachedEditorViewState(' \u0000 ', { cursor: 1, scrollTop: 2, scrollLeft: 3 });
assert.equal(getCachedEditorContent(''), undefined);
assert.equal(getCachedDirtyEditorContent(''), undefined);
assert.equal(getCachedEditorViewState(''), undefined);

markCachedEditorDirty(path, largeContent);
assert.equal(getCachedEditorContent(path), largeContent);
assert.equal(getCachedDirtyEditorContent(path), largeContent);
assert.equal(getCachedDirtyEditorContent('C:/repo/src/large.ts'), largeContent);
assert.equal(getCachedDirtyEditorContent(' C:/repo/src/large.ts\u0000 '), largeContent);
assert.equal(getCachedDirtyEditorContent('C:/repo/src/./nested/../large.ts'), largeContent);
assert.deepEqual(listCachedDirtyEditorPaths(), [path]);

markCachedEditorDirty('c:/repo/src/LARGE.ts', 'new large content');
assert.equal(getCachedDirtyEditorContent(path), 'new large content');
assert.deepEqual(listCachedDirtyEditorPaths(), ['c:/repo/src/LARGE.ts']);
setCachedEditorContent('C:\\repo\\src\\large.ts', 'saved large content');
assert.equal(getCachedEditorContent('c:/repo/src/large.ts'), 'saved large content');
assert.equal(getCachedDirtyEditorContent(path), 'new large content');
clearCachedEditorDirty('C:/repo/src/large.ts');
assert.deepEqual(listCachedDirtyEditorPaths(), []);
markCachedEditorDirty(path, largeContent);

markCachedEditorDirty(' C:/repo/src/trimmed.ts\u0000 ', 'trimmed');
assert.equal(getCachedDirtyEditorContent('C:\\repo\\src\\trimmed.ts'), 'trimmed');
clearCachedEditorDirty('C:/repo/src/trimmed.ts');

markCachedEditorDirty('/repo/src/CaseSensitive.ts', 'upper');
markCachedEditorDirty('/repo/src/casesensitive.ts', 'lower');
assert.equal(getCachedDirtyEditorContent('/repo/src/CaseSensitive.ts'), 'upper');
assert.equal(getCachedDirtyEditorContent('/repo/src/casesensitive.ts'), 'lower');
clearCachedEditorDirty('/repo/src/casesensitive.ts');
assert.equal(getCachedDirtyEditorContent('/repo/src/CaseSensitive.ts'), 'upper');
assert.equal(getCachedDirtyEditorContent('/repo/src/casesensitive.ts'), undefined);
clearCachedEditorDirty('/repo/src/CaseSensitive.ts');

markCachedEditorDirty('\\\\Server\\Share\\MixedCase.ts', 'unc');
assert.equal(getCachedDirtyEditorContent('\\\\server\\share\\mixedcase.ts'), 'unc');
clearCachedEditorDirty('//SERVER/SHARE/MIXEDCASE.ts');
assert.equal(getCachedDirtyEditorContent('\\\\Server\\Share\\MixedCase.ts'), undefined);

setCachedEditorViewState(path, { cursor: largeContent.length - 1, scrollTop: 4096, scrollLeft: 12 });
assert.deepEqual(getCachedEditorViewState(path), { cursor: largeContent.length - 1, scrollTop: 4096, scrollLeft: 12 });
assert.deepEqual(getCachedEditorViewState('c:/repo/src/large.ts'), { cursor: largeContent.length - 1, scrollTop: 4096, scrollLeft: 12 });
assert.deepEqual(getCachedEditorViewState('c:/repo/src/./large.ts'), { cursor: largeContent.length - 1, scrollTop: 4096, scrollLeft: 12 });
setCachedEditorViewState('C:/repo/src/LARGE.ts', { cursor: 10, scrollTop: 20, scrollLeft: 30 });
assert.deepEqual(getCachedEditorViewState(path), { cursor: 10, scrollTop: 20, scrollLeft: 30 });
setCachedEditorViewState('C:/repo/src/LARGE.ts', { cursor: Number.NaN, scrollTop: -20, scrollLeft: Infinity });
assert.deepEqual(getCachedEditorViewState(path), { cursor: 0, scrollTop: 0, scrollLeft: 0 });
setCachedEditorViewState('C:/repo/src/LARGE.ts', { cursor: 10.8, scrollTop: 20.2, scrollLeft: 30.9 });
assert.deepEqual(getCachedEditorViewState(path), { cursor: 10, scrollTop: 20, scrollLeft: 30 });

clearCachedEditorDirty('C:/repo/src/./nested/../large.ts');
assert.equal(getCachedDirtyEditorContent(path), undefined);
assert.deepEqual(listCachedDirtyEditorPaths(), []);
assert.equal(getCachedEditorContent(path), largeContent);

console.log('PASS editor session cache tracks large dirty buffers and view state');
