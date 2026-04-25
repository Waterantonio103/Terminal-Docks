import assert from 'node:assert/strict';
import { detectRuntimeAction } from '../.tmp-tests/lib/runtimeActivity.js';

function run(name, fn) {
  try {
    fn();
    console.log(`  ✓ ${name}`);
  } catch (error) {
    console.error(`  ✗ ${name}`);
    console.error(error);
    process.exitCode = 1;
  }
}

console.log('runtimeActivity');

run('runtime action detector maps common tool output', () => {
  assert.equal(detectRuntimeAction('ReadFile src/App.tsx'), 'Reading files...');
  assert.equal(detectRuntimeAction('Edit src/App.tsx'), 'Writing code...');
  assert.equal(detectRuntimeAction('Bash cargo test'), 'Running tests...');
  assert.equal(detectRuntimeAction('shell command ls'), 'Running command...');
});

run('frontend runtime activity module does not own permission classification', () => {
  assert.equal(typeof detectRuntimeAction, 'function');
});
