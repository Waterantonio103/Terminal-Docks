import { registerDebugRunTools } from './tools/runs.mjs';
import { registerDebugObservabilityTools } from './tools/observability.mjs';
import { registerDebugWorkflowTools } from './tools/workflows.mjs';
import { registerDebugPatchTools } from './tools/patches.mjs';
import { registerDebugCommandTools } from './tools/commands.mjs';
import { registerDebugReportTools } from './tools/reports.mjs';
import { registerDebugSuiteTools } from './tools/suites.mjs';
import { registerDebugScreenwatchTools } from './tools/screenwatch.mjs';

export function registerDebugTools(server, getSessionId) {
  registerDebugRunTools(server, getSessionId);
  registerDebugObservabilityTools(server, getSessionId);
  registerDebugScreenwatchTools(server, getSessionId);
  registerDebugWorkflowTools(server, getSessionId);
  registerDebugSuiteTools(server, getSessionId);
  registerDebugPatchTools(server, getSessionId);
  registerDebugCommandTools(server, getSessionId);
  registerDebugReportTools(server, getSessionId);
}
