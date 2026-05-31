import assert from 'node:assert/strict';
import { detectCliForPane, detectCliFromTerminalOutput, detectCliFromText } from '../.tmp-tests/lib/cliDetection.js';
import { normalizeTerminalId } from '../.tmp-tests/lib/terminalIds.js';

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}:`);
    console.error(error);
    process.exit(1);
  }
}

run('normalizes terminal detection ids for backend lookups', () => {
  assert.equal(normalizeTerminalId(' term-a\u0000 '), 'term-a');
  assert.equal(normalizeTerminalId('\u0000term-b\u0000'), 'term-b');
  assert.equal(normalizeTerminalId('term-\n c\r'), 'term-c');
  assert.equal(normalizeTerminalId('term-\u007fhidden'), 'term-hidden');
  assert.equal(normalizeTerminalId('\u001b[36mterm-c\u001b[39m'), 'term-c');
  assert.equal(normalizeTerminalId('\u001b]0;term-d\u0007term-d'), 'term-d');
});

run('rejects blank or non-string terminal detection ids', () => {
  assert.equal(normalizeTerminalId(' \u0000 '), null);
  assert.equal(normalizeTerminalId(' \n\r\t '), null);
  assert.equal(normalizeTerminalId(''), null);
  assert.equal(normalizeTerminalId('term-' + 'x'.repeat(129)), null);
  assert.equal(normalizeTerminalId(null), null);
  assert.equal(normalizeTerminalId(42), null);
});

run('detects CLI ids from common command variants', () => {
  assert.equal(detectCliFromText('open-code run task'), 'opencode');
  assert.equal(detectCliFromText('Open Code run task'), 'opencode');
  assert.equal(detectCliFromText('LM Studio --serve'), 'lmstudio');
  assert.equal(detectCliFromText('ollama run llama3.1'), 'ollama');
  assert.equal(detectCliForPane({ data: { initialCommand: 'open-code run task' } }), 'opencode');
});

run('detects local CLI ids from terminal titles and banners', () => {
  assert.deepEqual(detectCliFromTerminalOutput('\x1b]0;LM Studio server\x07'), {
    cli: 'lmstudio',
    confidence: 'high',
  });
  assert.deepEqual(detectCliFromTerminalOutput('time=2026 level=INFO msg="Ollama server listening"'), {
    cli: 'ollama',
    confidence: 'medium',
  });
});
