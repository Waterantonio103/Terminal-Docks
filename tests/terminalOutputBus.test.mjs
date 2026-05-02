import assert from 'node:assert/strict';
import { TerminalOutputBus } from '../.tmp-tests/lib/runtime/TerminalOutputBus.js';

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

const termId = 'test-term';

run('append adds chunks and increments sequence', () => {
  const bus = new TerminalOutputBus();
  bus.append({ terminalId: termId, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  assert.equal(bus.getSequence(termId), 1);
  assert.equal(bus.getText(termId), 'A');
});

run('getChunksSince retrieves only new chunks', () => {
  const bus = new TerminalOutputBus();
  bus.append({ terminalId: termId, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  bus.append({ terminalId: termId, bytes: new Uint8Array([66]), text: 'B', at: Date.now() });
  assert.equal(bus.getSequence(termId), 2);
  
  const since1 = bus.getChunksSince(termId, 1);
  assert.equal(since1.length, 1);
  assert.equal(since1[0].text, 'B');
  assert.equal(since1[0].seq, 2);

  const since0 = bus.getChunksSince(termId, 0);
  assert.equal(since0.length, 2);
  assert.equal(since0[0].text, 'A');
  assert.equal(since0[1].text, 'B');
});

run('trimBuffer respects maxChunks', () => {
  const bus = new TerminalOutputBus(2, 1000); // Max 2 chunks
  bus.append({ terminalId: termId, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  bus.append({ terminalId: termId, bytes: new Uint8Array([66]), text: 'B', at: Date.now() });
  bus.append({ terminalId: termId, bytes: new Uint8Array([67]), text: 'C', at: Date.now() });
  
  assert.equal(bus.getSequence(termId), 3);
  assert.equal(bus.getText(termId), 'BC');
  const chunks = bus.getChunksSince(termId, 0);
  assert.equal(chunks.length, 2);
  assert.equal(chunks[0].text, 'B');
  assert.equal(chunks[1].text, 'C');
});

run('trimBuffer respects maxChars', () => {
  const bus = new TerminalOutputBus(10, 5); // Max 5 chars
  bus.append({ terminalId: termId, bytes: new Uint8Array([65, 65, 65]), text: 'AAA', at: Date.now() });
  bus.append({ terminalId: termId, bytes: new Uint8Array([66, 66, 66]), text: 'BBB', at: Date.now() });
  
  // Total 6 chars, exceeds 5. AAA should be removed.
  assert.equal(bus.getText(termId), 'BBB');
  
  bus.append({ terminalId: termId, bytes: new Uint8Array([67, 67]), text: 'CC', at: Date.now() });
  // Total 5 chars (BBB + CC). Both should stay.
  assert.equal(bus.getText(termId), 'BBBCC');

  bus.append({ terminalId: termId, bytes: new Uint8Array([68]), text: 'D', at: Date.now() });
  // Total 6 chars. BBB should be removed.
  assert.equal(bus.getText(termId), 'CCD');
});

run('clear removes buffer', () => {
  const bus = new TerminalOutputBus();
  bus.append({ terminalId: termId, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  bus.clear(termId);
  assert.equal(bus.getSequence(termId), 0);
  assert.equal(bus.getText(termId), '');
});

run('listeners receive chunks', () => {
  const bus = new TerminalOutputBus();
  bus.start = () => Promise.resolve();
  let received = null;
  bus.subscribe(termId, (chunk) => {
    received = chunk;
  });
  
  bus.append({ terminalId: termId, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  assert.ok(received);
  assert.equal(received.text, 'A');
  assert.equal(received.seq, 1);
});
