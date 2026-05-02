import { z } from 'zod';
import { makeToolText } from '../../utils/index.mjs';
import { createDebugRun, getDebugRun, listDebugEvents } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';

export function registerDebugRunTools(server, getSessionId) {
  server.registerTool('debug_start_run', {
    title: 'Debug Start Run',
    inputSchema: {
      suiteName: z.string().min(1),
      autonomyMode: z.enum(['diagnose', 'propose', 'autopatch']).optional(),
      requireConfirmation: z.boolean().optional(),
      maxRepairAttempts: z.number().int().positive().optional(),
      maxFilesChanged: z.number().int().positive().optional(),
      maxPatchBytes: z.number().int().positive().optional(),
      maxCommandRuntimeMs: z.number().int().positive().optional(),
      allowedPaths: z.array(z.string().min(1)).optional(),
      blockedPaths: z.array(z.string().min(1)).optional(),
      allowedCommands: z.array(z.string().min(1)).optional(),
    },
  }, async (args) => {
    const result = createDebugRun(args);
    if (!result.ok) return makeToolText(result.message, true);

    writeDebugEvent(result.debugRun.id, 'debug_tool_called', {
      toolName: 'debug_start_run',
      sessionId: getSessionId?.() ?? null,
    });

    return makeToolText(JSON.stringify({
      debugRunId: result.debugRun.id,
      status: result.debugRun.status,
      autonomyMode: result.debugRun.autonomyMode,
      effectiveGuardrails: {
        requireConfirmation: result.debugRun.requireConfirmation,
        maxRepairAttempts: result.debugRun.maxRepairAttempts,
        maxFilesChanged: result.debugRun.maxFilesChanged,
        maxPatchBytes: result.debugRun.maxPatchBytes,
        maxCommandRuntimeMs: result.debugRun.maxCommandRuntimeMs,
        allowedPaths: result.debugRun.allowedPaths,
        blockedPaths: result.debugRun.blockedPaths,
        allowedCommands: result.debugRun.allowedCommands,
      },
    }, null, 2));
  });

  server.registerTool('debug_get_run', {
    title: 'Debug Get Run',
    inputSchema: {
      debugRunId: z.string().min(1),
      includeEvents: z.boolean().optional(),
      eventLimit: z.number().int().positive().max(500).optional(),
    },
  }, async ({ debugRunId, includeEvents = true, eventLimit = 50 }) => {
    const debugRun = getDebugRun(debugRunId);
    if (!debugRun) return makeToolText(`Debug run not found: ${debugRunId}`, true);

    writeDebugEvent(debugRunId, 'debug_tool_called', {
      toolName: 'debug_get_run',
      sessionId: getSessionId?.() ?? null,
    });

    return makeToolText(JSON.stringify({
      debugRun,
      events: includeEvents ? listDebugEvents(debugRunId, eventLimit) : undefined,
    }, null, 2));
  });
}
