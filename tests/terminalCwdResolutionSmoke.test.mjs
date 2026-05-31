import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const terminal = readFileSync(resolve(root, 'src/components/Terminal/TerminalPane.tsx'), 'utf8');
const workspaceStore = readFileSync(resolve(root, 'src/store/workspace.ts'), 'utf8');
const runtimeBridge = readFileSync(resolve(root, 'src/lib/runtime/RuntimeWorkspaceBridge.ts'), 'utf8');

assert.ok(
  terminal.includes('currentDirectoryForPane(pane, paneWorkspaceDir || activeTabWorkspaceDir || storeSnap.workspaceDir)'),
  'terminal startup should resolve pane cwd through workspace directory helper',
);
assert.ok(
  terminal.includes("import { normalizeTerminalId } from '../../lib/terminalIds';"),
  'terminal pane should normalize pane terminal ids before using PTY/buffer keys',
);
assert.ok(
  terminal.includes('const terminalId     = normalizeTerminalId(pane.data?.terminalId) || `term-${pane.id}`;'),
  'terminal pane should use the normalized terminal id for runtime calls',
);
assert.ok(
  terminal.includes('if (normalizeTerminalId(event.payload.terminalId) !== terminalId) return;'),
  'terminal pane should normalize terminal event ids before focus/refit matching',
);
assert.ok(
  terminal.includes('activeTabWorkspaceDir'),
  'terminal startup should consider the active tab workspace before the global fallback',
);
assert.ok(
  workspaceStore.includes("import('../lib/runtime/TerminalOutputBus.js').then(({ terminalOutputBus }) => {"),
  'destroying terminal panes should also clear their frontend output buffers',
);
assert.ok(
  workspaceStore.includes("import { normalizeTerminalId } from '../lib/terminalIds.js';"),
  'workspace store should use shared terminal id normalization',
);
assert.ok(
  workspaceStore.includes('normalizeTerminalId(pane.data?.terminalId)'),
  'destroying terminal panes should normalize terminal ids before clearing buffers or PTYs',
);
assert.ok(
  workspaceStore.includes('normalizeTerminalId(p.data?.terminalId) === normalizedTerminalId'),
  'terminal pane data updates should match normalized terminal ids',
);
assert.ok(
  runtimeBridge.includes("import { normalizeTerminalId } from '../terminalIds.js';"),
  'runtime workspace bridge should use shared terminal id normalization',
);
assert.ok(
  runtimeBridge.includes('const normalizedTerminalId = normalizeTerminalId(terminalId);'),
  'runtime terminal pane lookup should normalize requested terminal ids',
);
assert.ok(
  runtimeBridge.includes('normalizeTerminalId(pane.data?.terminalId) === normalizedTerminalId'),
  'runtime terminal pane lookup should match normalized pane terminal ids',
);

console.log('PASS terminal startup resolves cwd through workspace helper');
