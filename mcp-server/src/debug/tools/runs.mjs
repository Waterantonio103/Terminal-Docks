import { z } from 'zod';
import { makeToolText } from '../../utils/index.mjs';
import { broadcast } from '../../state.mjs';
import { createDebugRun, getDebugRun, listDebugEvents } from '../state.mjs';
import { writeDebugEvent } from '../audit.mjs';
import { auditTool, jsonResponse, requireDebugRun } from './shared.mjs';

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

  server.registerTool('debug_submit_agent_prompt', {
    title: 'Debug Submit Agent Prompt',
    inputSchema: {
      debugRunId: z.string().min(1),
      prompt: z.string().min(1),
      targetPaneId: z.string().optional(),
      displayContent: z.string().optional(),
      skipSlashProcessing: z.boolean().optional(),
      label: z.string().optional(),
    },
  }, async ({
    debugRunId,
    prompt,
    targetPaneId,
    displayContent,
    skipSlashProcessing = false,
    label = 'debug prompt',
  }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;

    const requestId = `debug-agent-prompt-${Date.now()}-${Math.random().toString(16).slice(2)}`;
    const payload = {
      requestId,
      debugRunId,
      prompt,
      targetPaneId: targetPaneId || undefined,
      displayContent: displayContent || undefined,
      skipSlashProcessing,
      label,
      createdAt: Date.now(),
    };
    broadcast('Starlink Debug', JSON.stringify(payload), 'debug_agent_prompt');
    auditTool(debugRunId, 'debug_submit_agent_prompt', getSessionId?.(), {
      requestId,
      targetPaneId: targetPaneId ?? null,
      promptLength: prompt.length,
      label,
    });
    writeDebugEvent(debugRunId, 'debug_agent_prompt_submitted', {
      requestId,
      targetPaneId: targetPaneId ?? null,
      label,
    });
    return jsonResponse({
      ok: true,
      requestId,
      eventType: 'debug_agent_prompt',
      targetPaneId: targetPaneId ?? null,
      note: 'Prompt was broadcast to the running app; capture the agent window to verify it was accepted and rendered.',
    });
  });
}
