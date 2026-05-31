import assert from 'node:assert/strict';
import {
  clearLastFatalReport,
  readBreadcrumbs,
  readLastFatalReport,
  recordBreadcrumb,
  writeFatalReport,
} from '../.tmp-tests/lib/diagnostics.js';

const originalWindow = globalThis.window;

function installStorage(seed = {}) {
  const store = new Map(Object.entries(seed));
  globalThis.window = {
    localStorage: {
      getItem(key) {
        return store.has(key) ? store.get(key) : null;
      },
      setItem(key, value) {
        store.set(key, String(value));
      },
      removeItem(key) {
        store.delete(key);
      },
    },
  };
  return store;
}

try {
  installStorage({
    'comet-ai:breadcrumbs': JSON.stringify([
      { ts: 1, label: ' old ', data: { ok: true } },
      { ts: Number.NaN, label: 'recovered-ts' },
      { ts: 3, label: '' },
      'bad',
    ]),
  });

  const recovered = readBreadcrumbs();
  assert.equal(recovered.length, 2);
  assert.deepEqual(recovered[0], { ts: 1, label: 'old', data: { ok: true } });
  assert.equal(recovered[1].label, 'recovered-ts');
  assert.equal(Number.isFinite(recovered[1].ts), true);

  const store = installStorage();
  recordBreadcrumb('  app-ready  ', { pane: 'workspace' });
  recordBreadcrumb('  ');
  const recorded = JSON.parse(store.get('comet-ai:breadcrumbs'));
  assert.equal(recorded.length, 1);
  assert.equal(recorded[0].label, 'app-ready');
  assert.deepEqual(recorded[0].data, { pane: 'workspace' });

  installStorage({
    'comet-ai:last-fatal': JSON.stringify({
      ts: 10,
      kind: 'react',
      message: '  Render failed  ',
      breadcrumbs: [{ ts: 9, label: 'render' }, { ts: 8, missing: 'label' }],
      ignored: true,
    }),
  });
  assert.deepEqual(readLastFatalReport(), {
    ts: 10,
    kind: 'react',
    message: 'Render failed',
    breadcrumbs: [{ ts: 9, label: 'render' }],
  });

  installStorage({ 'comet-ai:last-fatal': JSON.stringify({ ts: 10, kind: 'bad', message: 'nope' }) });
  assert.equal(readLastFatalReport(), null);

  const fatalStore = installStorage();
  writeFatalReport({ ts: Number.NaN, kind: 'error', message: '  fatal  ', breadcrumbs: [{ ts: 1, label: '' }] });
  const fatal = JSON.parse(fatalStore.get('comet-ai:last-fatal'));
  assert.equal(fatal.kind, 'error');
  assert.equal(fatal.message, 'fatal');
  assert.equal(Number.isFinite(fatal.ts), true);
  assert.equal('breadcrumbs' in fatal, false);
  clearLastFatalReport();
  assert.equal(fatalStore.has('comet-ai:last-fatal'), false);

  console.log('PASS diagnostics storage recovers only valid crash evidence');
} finally {
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
}
