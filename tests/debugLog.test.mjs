import assert from 'node:assert/strict';
import { isDebugScopeEnabled, scopedDebugLog } from '../.tmp-tests/lib/debugLog.js';

const originalWindow = globalThis.window;
const originalDebug = console.debug;

try {
  delete globalThis.window;
  assert.equal(isDebugScopeEnabled('test-scope', 'VITE_TEST_DEBUG'), false);

  let debugCalls = 0;
  console.debug = (...args) => {
    debugCalls += 1;
    assert.deepEqual(args, ['debug message', { ok: true }]);
  };

  globalThis.window = {
    localStorage: {
      getItem(key) {
        return key === 'comet.debug.test-scope' ? '1' : null;
      },
    },
  };
  assert.equal(isDebugScopeEnabled('test-scope', 'VITE_TEST_DEBUG'), true);
  scopedDebugLog('test-scope', 'VITE_TEST_DEBUG', 'debug message', { ok: true });
  assert.equal(debugCalls, 1);

  globalThis.window = {
    localStorage: {
      getItem() {
        throw new Error('storage unavailable');
      },
    },
  };
  assert.equal(isDebugScopeEnabled('test-scope', 'VITE_TEST_DEBUG'), false);

  console.log('PASS debug log scopes respect localStorage and tolerate restricted storage');
} finally {
  console.debug = originalDebug;
  if (originalWindow === undefined) {
    delete globalThis.window;
  } else {
    globalThis.window = originalWindow;
  }
}
