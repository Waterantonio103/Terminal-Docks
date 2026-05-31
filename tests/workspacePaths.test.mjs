import assert from 'node:assert/strict';
import {
  dirname,
  joinWorkspacePath,
  normalizeWorkspacePath,
  rebaseWorkspacePath,
  relativeWorkspacePath,
  workspacePathContains,
  workspacePathEquals,
} from '../.tmp-tests/lib/workspacePaths.js';

assert.equal(dirname('C:\\repo\\src\\App.tsx'), 'C:\\repo\\src');
assert.equal(dirname(' C:\\repo\\src\\App.tsx\u0000 '), 'C:\\repo\\src');
assert.equal(dirname('C:\\repo\\'), 'C:\\');
assert.equal(dirname('C:\\'), 'C:\\');
assert.equal(dirname('/repo/src/App.tsx'), '/repo/src');
assert.equal(dirname('/repo/src/'), '/repo');
assert.equal(dirname('/README.md'), '/');
assert.equal(dirname('/'), '/');
assert.equal(dirname('\\\\server\\share\\dir\\file.txt'), '\\\\server\\share\\dir');
assert.equal(dirname('\\\\server\\share\\dir\\'), '\\\\server\\share');
assert.equal(dirname('\\\\server\\share\\'), '\\\\server\\share');
assert.equal(dirname('//server/share/dir/file.txt'), '//server/share/dir');
assert.equal(dirname('//server/share/'), '//server/share');
assert.equal(dirname('README.md'), 'README.md');

assert.equal(joinWorkspacePath('C:\\repo', 'src'), 'C:\\repo\\src');
assert.equal(joinWorkspacePath('C:\\repo\\', 'src'), 'C:\\repo\\src');
assert.equal(joinWorkspacePath('C:\\repo', 'src/App.tsx'), 'C:\\repo\\src\\App.tsx');
assert.equal(joinWorkspacePath('C:\\repo', '\\src\\App.tsx'), 'C:\\repo\\src\\App.tsx');
assert.equal(joinWorkspacePath(' C:\\repo\\\u0000 ', 'src'), 'C:\\repo\\src');
assert.equal(joinWorkspacePath('C:\\repo', ' src/App.tsx\u0000 '), 'C:\\repo\\src\\App.tsx');
assert.equal(joinWorkspacePath('/repo', 'src'), '/repo/src');
assert.equal(joinWorkspacePath('/repo', 'src\\App.tsx'), '/repo/src/App.tsx');
assert.equal(joinWorkspacePath('/repo', '/src/App.tsx'), '/repo/src/App.tsx');
assert.equal(joinWorkspacePath('/repo', ' src\\App.tsx\u0000 '), '/repo/src/App.tsx');
assert.equal(joinWorkspacePath('/repo', ''), '/repo');
assert.equal(joinWorkspacePath('/repo', ' \u0000 '), '/repo');
assert.equal(joinWorkspacePath('', 'src/App.tsx'), 'src/App.tsx');
assert.equal(normalizeWorkspacePath('C:\\repo\\src\\'), 'C:/repo/src');
assert.equal(normalizeWorkspacePath(' C:\\repo\\src\\\u0000 '), 'C:/repo/src');
assert.equal(normalizeWorkspacePath('C:\\repo\\.\\src\\\\App.tsx'), 'C:/repo/src/App.tsx');
assert.equal(normalizeWorkspacePath('C:\\repo\\src\\..\\App.tsx'), 'C:/repo/App.tsx');
assert.equal(normalizeWorkspacePath('C:\\'), 'C:/');
assert.equal(normalizeWorkspacePath('/'), '/');
assert.equal(normalizeWorkspacePath('/repo//src/./App.tsx'), '/repo/src/App.tsx');
assert.equal(normalizeWorkspacePath('/repo/src/../App.tsx'), '/repo/App.tsx');
assert.equal(normalizeWorkspacePath('\\\\server\\share\\dir\\.\\file.txt'), '//server/share/dir/file.txt');
assert.equal(workspacePathContains('C:\\repo', 'C:\\repo\\src\\App.tsx'), true);
assert.equal(workspacePathContains('C:\\', 'C:\\repo\\src\\App.tsx'), true);
assert.equal(workspacePathContains('C:\\Repo', 'c:\\repo\\src\\App.tsx'), true);
assert.equal(workspacePathContains('C:\\repo', 'C:\\repository\\App.tsx'), false);
assert.equal(workspacePathContains('C:\\repo\\src', 'C:\\repo\\src\\..\\secret.txt'), false);
assert.equal(workspacePathContains('\\\\Server\\Share', '\\\\server\\share\\dir\\file.txt'), true);
assert.equal(workspacePathContains('/', '/repo/src/App.tsx'), true);
assert.equal(workspacePathContains('/repo/src', '/repo/src'), true);
assert.equal(workspacePathContains('/repo/src', '/repo/src/../secret.txt'), false);
assert.equal(workspacePathContains('/Repo', '/repo/src'), false);
assert.equal(workspacePathContains('', '/repo/src/App.tsx'), false);
assert.equal(workspacePathContains('/repo/src', ''), false);
assert.equal(workspacePathEquals('C:\\', 'c:/'), true);
assert.equal(workspacePathEquals('C:\\Repo\\src\\App.tsx', 'c:/repo/src/App.tsx'), true);
assert.equal(workspacePathEquals(' C:\\Repo\\src\\App.tsx\u0000 ', 'c:/repo/src/App.tsx'), true);
assert.equal(workspacePathEquals('C:\\Repo\\', 'c:/repo'), true);
assert.equal(workspacePathEquals('C:\\Repo\\.\\src\\..\\App.tsx', 'c:/repo/App.tsx'), true);
assert.equal(workspacePathEquals('/Repo/src/App.tsx', '/repo/src/App.tsx'), false);
assert.equal(workspacePathEquals('', ''), false);
assert.equal(workspacePathEquals(' \u0000 ', ''), false);
assert.equal(relativeWorkspacePath('C:\\', 'C:\\repo\\src\\App.tsx'), 'repo/src/App.tsx');
assert.equal(relativeWorkspacePath('C:\\repo', 'C:\\repo\\src\\App.tsx'), 'src/App.tsx');
assert.equal(relativeWorkspacePath('C:\\Repo', 'c:\\repo\\src\\App.tsx'), 'src/App.tsx');
assert.equal(relativeWorkspacePath('C:\\repo', 'C:\\repo'), '');
assert.equal(relativeWorkspacePath('C:\\repo', 'C:\\repository\\App.tsx'), null);
assert.equal(relativeWorkspacePath('/', '/repo/src/App.tsx'), 'repo/src/App.tsx');
assert.equal(relativeWorkspacePath('/repo', '/repo/src/App.tsx'), 'src/App.tsx');
assert.equal(relativeWorkspacePath('', '/repo/src/App.tsx'), null);
assert.equal(relativeWorkspacePath('/repo', ''), null);
assert.equal(rebaseWorkspacePath('C:\\repo\\src', 'C:\\repo\\renamed', 'C:\\repo\\src\\App.tsx'), 'C:\\repo\\renamed\\App.tsx');
assert.equal(rebaseWorkspacePath('C:\\repo\\src', 'C:\\repo\\renamed', 'C:\\repo\\src\\nested\\App.tsx'), 'C:\\repo\\renamed\\nested\\App.tsx');
assert.equal(rebaseWorkspacePath('C:\\repo\\src', ' C:\\repo\\renamed\u0000 ', 'C:\\repo\\src\\App.tsx'), 'C:\\repo\\renamed\\App.tsx');
assert.equal(rebaseWorkspacePath('C:\\Repo\\src', 'C:\\Repo\\renamed', 'c:\\repo\\src\\App.tsx'), 'C:\\Repo\\renamed\\App.tsx');
assert.equal(rebaseWorkspacePath('C:\\repo\\src', '', 'C:\\repo\\src\\App.tsx'), null);
assert.equal(rebaseWorkspacePath('C:\\repo\\src', 'C:\\repo\\renamed', 'C:\\repository\\src\\App.tsx'), null);

console.log('PASS workspace path helpers cover editor and terminal directory cases');
