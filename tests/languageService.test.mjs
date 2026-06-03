import assert from 'node:assert/strict';
import {
  fileUriFromPath,
  languageServiceStatusForPath,
  languageServerDefinitionForPath,
  lspLanguageIdForPath,
} from '../.tmp-tests/lib/languageService.js';

assert.equal(lspLanguageIdForPath('/repo/src/app.py'), 'python');
assert.equal(lspLanguageIdForPath('/repo/src/main.rs'), 'rust');
assert.equal(lspLanguageIdForPath('/repo/src/App.tsx'), 'typescriptreact');
assert.equal(lspLanguageIdForPath('/repo/src/main.go'), 'go');
assert.equal(lspLanguageIdForPath('/repo/LICENSE'), null);

assert.equal(languageServerDefinitionForPath('/repo/src/app.py')?.command, 'pyright-langserver');
assert.equal(languageServerDefinitionForPath('/repo/src/main.rs')?.command, 'rust-analyzer');
assert.equal(languageServerDefinitionForPath('/repo/src/App.tsx')?.command, 'typescript-language-server');
assert.equal(languageServerDefinitionForPath('/repo/src/main.go')?.command, 'gopls');
assert.equal(languageServerDefinitionForPath('/repo/src/Main.java'), null);
assert.equal(languageServiceStatusForPath('/repo/src/app.py').state, 'available');
assert.equal(languageServiceStatusForPath('/repo/src/app.py').label, 'pyright available');
assert.equal(languageServiceStatusForPath('/repo/LICENSE').state, 'none');

assert.equal(fileUriFromPath('C:\\repo\\src\\app.py'), 'file:///C:/repo/src/app.py');
assert.equal(fileUriFromPath('C:\\repo\\space dir\\app.py'), 'file:///C:/repo/space%20dir/app.py');
assert.equal(fileUriFromPath('/home/me/project/src/main.rs'), 'file:///home/me/project/src/main.rs');
assert.equal(fileUriFromPath(''), null);

console.log('PASS language service registry maps editor files to LSP metadata');
