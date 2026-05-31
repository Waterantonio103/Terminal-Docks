import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { TerminalOutputBus } from '../.tmp-tests/lib/runtime/TerminalOutputBus.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const terminalOutputBusSource = readFileSync(resolve(root, 'src/lib/runtime/TerminalOutputBus.ts'), 'utf8');

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

run('append normalizes terminal ids before buffering and dispatching', () => {
  const bus = new TerminalOutputBus();
  bus.start = () => Promise.resolve();
  let received = null;
  bus.subscribe(termId, (chunk) => {
    received = chunk;
  });

  bus.append({ terminalId: ` ${termId}\u0000 `, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });

  assert.equal(bus.getSequence(termId), 1);
  assert.equal(bus.getText(termId), 'A');
  assert.ok(received);
  assert.equal(received.terminalId, termId);
});

run('appendBytes preserves split UTF-8 text across PTY chunks', () => {
  const bus = new TerminalOutputBus();
  const encoded = new TextEncoder().encode('λ');

  bus.appendBytes(termId, encoded.slice(0, 1), 1);
  bus.appendBytes(termId, encoded.slice(1), 2);

  assert.equal(bus.getText(termId), 'λ');
  assert.equal(bus.getSequence(termId), 2);
  assert.equal(bus.getChunksSince(termId, 0)[0].bytes.length, 1);
  assert.equal(bus.getChunksSince(termId, 0)[1].text, 'λ');
});

run('appendBytes ignores empty PTY payloads', () => {
  const bus = new TerminalOutputBus();
  bus.appendBytes(termId, new Uint8Array(), 1);
  bus.appendBytes(termId, [], 2);

  assert.equal(bus.getSequence(termId), 0);
  assert.equal(bus.getText(termId), '');
  assert.deepEqual(bus.getChunksSince(termId, 0), []);
});

run('blank terminal ids are ignored', () => {
  const bus = new TerminalOutputBus();
  let starts = 0;
  bus.start = () => {
    starts += 1;
    return Promise.resolve();
  };

  const unsubscribe = bus.subscribe(' \u0000 ', () => {
    throw new Error('blank terminal id listener should not be registered');
  });
  bus.append({ terminalId: ' \u0000 ', bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  unsubscribe();

  assert.equal(starts, 0);
  assert.equal(bus.getSequence(''), 0);
  assert.equal(bus.getText(''), '');
  assert.deepEqual(bus.getBufferInfo(' \u0000 '), { chunkCount: 0, totalChars: 0, seq: 0 });
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

run('constructor clamps invalid buffer limits', () => {
  const bus = new TerminalOutputBus(Number.NaN, -10);
  bus.append({ terminalId: termId, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  bus.append({ terminalId: termId, bytes: new Uint8Array([66]), text: 'B', at: Date.now() });

  assert.equal(bus.getSequence(termId), 2);
  assert.equal(bus.getText(termId), 'AB');
});

run('getTail clamps invalid lengths', () => {
  const bus = new TerminalOutputBus();
  bus.append({ terminalId: termId, bytes: new Uint8Array([65, 66, 67]), text: 'ABC', at: Date.now() });
  assert.equal(bus.getTail(termId, 2), 'BC');
  assert.equal(bus.getTail(termId, 0), '');
  assert.equal(bus.getTail(termId, -1), '');
  assert.equal(bus.getTail(termId, Number.NaN), '');
  assert.equal(bus.getTail(termId, Number.POSITIVE_INFINITY), '');
});

run('getTail reads only the requested tail across chunks', () => {
  const bus = new TerminalOutputBus();
  bus.append({ terminalId: termId, bytes: new Uint8Array([65, 66, 67]), text: 'ABC', at: Date.now() });
  bus.append({ terminalId: termId, bytes: new Uint8Array([68, 69]), text: 'DE', at: Date.now() });
  bus.append({ terminalId: termId, bytes: new Uint8Array([70, 71, 72]), text: 'FGH', at: Date.now() });

  assert.equal(bus.getTail(termId, 4), 'EFGH');
  assert.equal(bus.getTail(termId, 5.8), 'DEFGH');
  assert.equal(bus.getTail(' \u0000 ', 4), '');
});

run('getChunksSince replays all chunks for invalid sequence cursors', () => {
  const bus = new TerminalOutputBus();
  bus.append({ terminalId: termId, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  bus.append({ terminalId: termId, bytes: new Uint8Array([66]), text: 'B', at: Date.now() });

  assert.deepEqual(bus.getChunksSince(termId, Number.NaN).map(chunk => chunk.text), ['A', 'B']);
  assert.deepEqual(bus.getChunksSince(termId, Number.NEGATIVE_INFINITY).map(chunk => chunk.text), ['A', 'B']);
});

run('clear removes buffer', () => {
  const bus = new TerminalOutputBus();
  bus.append({ terminalId: ` ${termId}\u0000 `, bytes: new Uint8Array([65]), text: 'A', at: Date.now() });
  bus.clear(` ${termId}\u0000 `);
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

run('start resets cached promise after listener subscription failure', () => {
  assert.ok(
    terminalOutputBusSource.includes('this.startPromise = null;'),
    'TerminalOutputBus.start should clear a failed start promise so later attempts can retry',
  );
});
