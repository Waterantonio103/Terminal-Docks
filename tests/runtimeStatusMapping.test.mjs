import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { runtimeSessionStateToWorkflowNodeStatus } from '../.tmp-tests/lib/runtime/RuntimeTypes.js';

assert.equal(runtimeSessionStateToWorkflowNodeStatus('creating'), 'launching');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('awaiting_mcp_ready'), 'launching');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('ready'), 'ready');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('injecting_task'), 'activation_pending');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('awaiting_ack'), 'activation_pending');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('awaiting_permission'), 'running');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('manual_takeover'), 'manual_takeover');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('completed'), 'completed');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('cancelled'), 'failed');
assert.equal(runtimeSessionStateToWorkflowNodeStatus('disconnected'), 'failed');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const runtimeObserver = readFileSync(resolve(root, 'src/components/Runtime/RuntimeObserver.ts'), 'utf8');
const useRuntimeSessions = readFileSync(resolve(root, 'src/components/Runtime/useRuntimeSessions.ts'), 'utf8');
const agentActionBadge = readFileSync(resolve(root, 'src/components/models/AgentActionBadge.tsx'), 'utf8');
assert.ok(
  runtimeObserver.includes("import { normalizeTerminalId } from '../../lib/terminalIds';"),
  'runtime observer should share terminal id normalization',
);
assert.ok(
  runtimeObserver.includes('const normalizedTerminalId = normalizeTerminalId(terminalId);'),
  'runtime observer terminal lookup should normalize requested terminal ids',
);
assert.ok(
  runtimeObserver.includes('normalizeTerminalId(s.terminalId) === normalizedTerminalId'),
  'runtime observer terminal lookup should normalize session terminal ids',
);
assert.ok(
  runtimeObserver.includes('function normalizeRuntimeNodeId(value: unknown): string | null'),
  'runtime observer should normalize node id lookup input',
);
assert.ok(
  runtimeObserver.includes('const normalizedNodeId = normalizeRuntimeNodeId(nodeId);'),
  'runtime observer node lookup should normalize requested node ids',
);
assert.ok(
  runtimeObserver.includes('normalizeRuntimeNodeId(s.nodeId) === normalizedNodeId'),
  'runtime observer node lookup should normalize session node ids',
);
assert.ok(
  useRuntimeSessions.includes('function normalizeRuntimeNodeId(value: unknown): string | null'),
  'runtime session enrichment should normalize node ids',
);
assert.ok(
  useRuntimeSessions.includes('const normalizedNodeId = normalizeRuntimeNodeId(node.id);'),
  'runtime session enrichment should normalize graph node ids',
);
assert.ok(
  useRuntimeSessions.includes('const normalizedNodeId = normalizeRuntimeNodeId(session.nodeId);'),
  'runtime session enrichment should normalize session node ids before lookup',
);
assert.ok(
  agentActionBadge.includes("import { normalizeCliId } from '../../lib/cliIdentity';"),
  'agent action badge should share canonical CLI identity normalization',
);
assert.ok(
  agentActionBadge.includes('const canonical = normalizeCliId(value);'),
  'agent action badge should normalize noisy CLI aliases before choosing loader style',
);
assert.ok(
  agentActionBadge.includes("key === 'claudecode'"),
  'agent action badge should preserve the Claude Code display alias',
);

console.log('PASS runtime session states map to workflow node statuses');
