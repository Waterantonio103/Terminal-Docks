import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { makeToolText } from '../../utils/index.mjs';
import { getDebugRun } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
export const REPO_ROOT = resolve(__dirname, '../../../..');

export function jsonResponse(value) {
  return makeToolText(JSON.stringify(value, null, 2));
}

export function requireDebugRun(debugRunId) {
  const debugRun = getDebugRun(debugRunId);
  if (!debugRun) {
    return { ok: false, response: makeToolText(`Debug run not found: ${debugRunId}`, true) };
  }
  return { ok: true, debugRun };
}

export function auditTool(debugRunId, toolName, sessionId, payload = {}) {
  writeDebugEvent(debugRunId, 'debug_tool_called', {
    toolName,
    sessionId: sessionId ?? null,
    ...payload,
  });
}

export function auditBlocked(debugRunId, action, reason, payload = {}) {
  writeDebugEvent(debugRunId, 'debug_guardrail_blocked_action', {
    action,
    reason,
    ...payload,
  });
}
