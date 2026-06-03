import assert from 'node:assert/strict';
import { EditorState } from '@codemirror/state';
import { json } from '@codemirror/lang-json';
import {
  supportsEditorDiagnostics,
  syntaxDiagnosticsForState,
} from '../.tmp-tests/lib/editorDiagnostics.js';

assert.equal(supportsEditorDiagnostics('/repo/src/app.py'), true);
assert.equal(supportsEditorDiagnostics('/repo/src/main.rs'), true);
assert.equal(supportsEditorDiagnostics('/repo/LICENSE'), false);

const invalidJsonState = EditorState.create({
  doc: '{ "name": }',
  extensions: [json()],
});
const invalidDiagnostics = syntaxDiagnosticsForState(invalidJsonState);
assert.ok(invalidDiagnostics.length >= 1, 'invalid JSON should produce syntax diagnostics');
assert.equal(invalidDiagnostics[0].severity, 'error');
assert.equal(invalidDiagnostics[0].message, 'Syntax error');

const validJsonState = EditorState.create({
  doc: '{ "name": "comet" }',
  extensions: [json()],
});
assert.deepEqual(syntaxDiagnosticsForState(validJsonState), []);

console.log('PASS editor diagnostics derive parser syntax errors');
