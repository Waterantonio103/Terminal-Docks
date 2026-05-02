import { spawn } from 'child_process';
import { z } from 'zod';
import { createDebugTestResult, updateDebugRunStatus } from '../state.mjs';
import { validateCommand } from '../guards.mjs';
import { writeDebugEvent } from '../audit.mjs';
import { auditBlocked, auditTool, jsonResponse, REPO_ROOT, requireDebugRun } from './shared.mjs';
import { makeToolText } from '../../utils/index.mjs';

function runAllowedCommand(command, timeoutMs) {
  return new Promise((resolvePromise) => {
    const startedAt = Date.now();
    const child = spawn(command, {
      cwd: REPO_ROOT,
      shell: true,
      windowsHide: true,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    let timedOut = false;
    const timer = setTimeout(() => {
      timedOut = true;
      child.kill('SIGTERM');
    }, timeoutMs);
    child.stdout.on('data', chunk => {
      stdout += chunk.toString();
      if (stdout.length > 64_000) stdout = stdout.slice(-64_000);
    });
    child.stderr.on('data', chunk => {
      stderr += chunk.toString();
      if (stderr.length > 64_000) stderr = stderr.slice(-64_000);
    });
    child.on('close', code => {
      clearTimeout(timer);
      resolvePromise({
        command,
        exitCode: timedOut ? null : code,
        timedOut,
        stdout,
        stderr,
        durationMs: Date.now() - startedAt,
      });
    });
  });
}

export function registerDebugCommandTools(server, getSessionId) {
  async function runCheck(debugRunId, command, timeoutMs) {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const commandCheck = validateCommand(command, checked.debugRun);
    if (!commandCheck.ok) {
      auditBlocked(debugRunId, 'debug_run_check', commandCheck.message, { command });
      return makeToolText(commandCheck.message, true);
    }
    const boundedTimeout = Math.min(timeoutMs ?? checked.debugRun.maxCommandRuntimeMs, checked.debugRun.maxCommandRuntimeMs);
    updateDebugRunStatus(debugRunId, 'verifying');
    const result = await runAllowedCommand(commandCheck.command, boundedTimeout);
    const status = result.exitCode === 0 && !result.timedOut ? 'passed' : 'failed';
    createDebugTestResult({
      debugRunId,
      suiteName: checked.debugRun.suiteName,
      testName: `command:${commandCheck.command}`,
      status,
      failureCategory: result.timedOut ? 'check_timeout' : (status === 'failed' ? 'check_failed' : null),
      notes: result.timedOut ? `Command timed out after ${boundedTimeout}ms.` : null,
      command: commandCheck.command,
      stdout: result.stdout,
      stderr: result.stderr,
      exitCode: result.exitCode,
      durationMs: result.durationMs,
    });
    auditTool(debugRunId, 'debug_run_check', getSessionId?.(), { command: commandCheck.command, status });
    writeDebugEvent(debugRunId, 'debug_command_run', { command: commandCheck.command, status, exitCode: result.exitCode, timedOut: result.timedOut });
    return jsonResponse({ ...result, status });
  }

  server.registerTool('debug_run_check', {
    title: 'Debug Run Check',
    inputSchema: {
      debugRunId: z.string().min(1),
      command: z.string().min(1),
      timeoutMs: z.number().int().positive().optional(),
    },
  }, async ({ debugRunId, command, timeoutMs }) => {
    return runCheck(debugRunId, command, timeoutMs);
  });

  server.registerTool('debug_run_typecheck', {
    title: 'Debug Run Typecheck',
    inputSchema: { debugRunId: z.string().min(1), timeoutMs: z.number().int().positive().optional() },
  }, async ({ debugRunId, timeoutMs }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const command = checked.debugRun.allowedCommands.includes('npm run typecheck')
      ? 'npm run typecheck'
      : checked.debugRun.allowedCommands[0];
    if (!command) return makeToolText('No allowed commands are configured for this debug run.', true);
    return runCheck(debugRunId, command, timeoutMs);
  });

  server.registerTool('debug_run_tests', {
    title: 'Debug Run Tests',
    inputSchema: { debugRunId: z.string().min(1), timeoutMs: z.number().int().positive().optional() },
  }, async ({ debugRunId, timeoutMs }) => {
    const checked = requireDebugRun(debugRunId);
    if (!checked.ok) return checked.response;
    const command = checked.debugRun.allowedCommands.find(item => item === 'npm test' || item === 'npm run test');
    if (!command) return makeToolText('No npm test command is allowed for this debug run.', true);
    return runCheck(debugRunId, command, timeoutMs);
  });
}
