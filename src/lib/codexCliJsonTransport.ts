import { listen } from '@tauri-apps/api/event';
import { startHeadlessRun, type HeadlessRunRequest } from './runtime/TerminalRuntime.js';
import { normalizeCliPermissionMode, type CliPermissionMode } from './cliCommandBuilders.js';

export type CodexCliJsonToolEvent = {
  id?: string;
  toolName?: string;
  label: string;
  detail?: string;
  command?: string;
  cwd?: string;
  output?: string;
  changes?: Array<{ path: string; diff: string }>;
  exitCode?: number | null;
  status: 'running' | 'completed' | 'failed';
};

export type CodexCliJsonUsageDelta = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
};

export type CodexCliJsonRunOptions = {
  prompt: string;
  workspaceDir?: string | null;
  model?: string | null;
  missionId: string;
  nodeId: string;
  agentId: string;
  sessionId: string;
  runId: string;
  yolo?: boolean;
  permissionMode?: CliPermissionMode | null;
  onStep?: (step: string | null) => void;
  onDelta?: (delta: string) => void;
  onToolEvent?: (event: CodexCliJsonToolEvent) => void;
  onUsage?: (usage: CodexCliJsonUsageDelta) => void;
};

type AgentRunOutputEvent = {
  runId: string;
  missionId: string;
  nodeId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
  at: number;
};

type AgentRunExitEvent = {
  runId: string;
  missionId: string;
  nodeId: string;
  status: string;
  exitCode?: number | null;
  stdoutPreview?: string | null;
  stderrPreview?: string | null;
  error?: string | null;
};

export type CodexJsonParsedEvent =
  | { kind: 'delta'; text: string }
  | { kind: 'final'; text: string }
  | { kind: 'tool'; id?: string; toolName?: string; label: string; detail?: string; command?: string; cwd?: string; output?: string; changes?: Array<{ path: string; diff: string }>; exitCode?: number | null; status: 'running' | 'completed' | 'failed' }
  | { kind: 'usage'; usage: CodexCliJsonUsageDelta }
  | { kind: 'step'; label: string }
  | { kind: 'done' }
  | { kind: 'none' };

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function stringField(record: Record<string, unknown> | null, ...keys: string[]): string {
  if (!record) return '';
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value;
  }
  return '';
}

function contentText(value: unknown): string {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) {
    return value
      .map(part => {
        if (typeof part === 'string') return part;
        const record = asRecord(part);
        return stringField(record, 'text', 'content');
      })
      .filter(Boolean)
      .join('');
  }
  const record = asRecord(value);
  return stringField(record, 'text', 'content', 'message');
}

function nestedText(record: Record<string, unknown>, ...keys: string[]): string {
  for (const key of keys) {
    const text = contentText(record[key]);
    if (text.trim()) return text;
  }
  return '';
}

function numberField(record: Record<string, unknown> | null, ...keys: string[]): number | null {
  if (!record) return null;
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'number' && Number.isFinite(value)) return value;
  }
  return null;
}

function codexItemStatus(method: string, item: Record<string, unknown> | null): 'running' | 'completed' | 'failed' {
  const status = stringField(item, 'status').trim();
  if (/fail|error|denied|declined/i.test(method) || /fail|error|denied|declined/i.test(status)) return 'failed';
  if (/completed|done|finished|success/i.test(method) || /completed|done|finished|success/i.test(status)) return 'completed';
  return 'running';
}

function arrayField(record: Record<string, unknown> | null, ...keys: string[]): unknown[] {
  if (!record) return [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) return value;
  }
  return [];
}

function codexFileChanges(item: Record<string, unknown> | null, params: Record<string, unknown> | null): Array<{ path: string; diff: string }> {
  const rawChanges = [
    ...arrayField(item, 'changes', 'fileChanges'),
    ...arrayField(params, 'changes', 'fileChanges'),
  ];
  const changes: Array<{ path: string; diff: string }> = [];
  for (const raw of rawChanges) {
    const change = asRecord(raw);
    if (!change) continue;
    const path = stringField(change, 'path', 'filePath', 'file_path').trim();
    const diff = stringField(change, 'diff', 'patch', 'unified_diff', 'unifiedDiff').trim();
    if (!path && !diff) continue;
    changes.push({ path: path || 'Updated file', diff });
  }
  return changes;
}

function codexUsageFromRecord(record: Record<string, unknown> | null): CodexCliJsonUsageDelta | null {
  if (!record) return null;
  const usage = asRecord(record.usage) ?? asRecord(record.token_usage) ?? asRecord(record.tokenUsage) ?? record;
  const inputDetails = asRecord(usage.input_tokens_details) ?? asRecord(usage.inputTokenDetails) ?? asRecord(usage.prompt_tokens_details) ?? asRecord(usage.promptTokenDetails);
  const inputTokens = numberField(usage, 'input_tokens', 'inputTokens', 'prompt_tokens', 'promptTokens') ?? 0;
  const outputTokens = numberField(usage, 'output_tokens', 'outputTokens', 'completion_tokens', 'completionTokens') ?? 0;
  const cachedInputTokens = numberField(usage, 'cached_input_tokens', 'cachedInputTokens', 'cached_tokens', 'cachedTokens')
    ?? numberField(inputDetails, 'cached_tokens', 'cachedTokens', 'cache_read_tokens', 'cacheReadTokens')
    ?? 0;
  if (inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0) return null;
  return { inputTokens, outputTokens, cachedInputTokens };
}

export function parseCodexJsonEventLine(line: string): CodexJsonParsedEvent {
  const trimmed = line.trim();
  if (!trimmed || !trimmed.startsWith('{')) return { kind: 'none' };

  let value: unknown;
  try {
    value = JSON.parse(trimmed);
  } catch {
    return { kind: 'none' };
  }

  const record = asRecord(value);
  if (!record) return { kind: 'none' };

  const method = stringField(record, 'method').trim().toLowerCase();
  const type = stringField(record, 'type', 'event', 'kind').trim().toLowerCase();
  const params = asRecord(record.params) ?? asRecord(record.data);
  const item = asRecord(record.item) ?? asRecord(record.message) ?? asRecord(record.data) ?? asRecord(params?.item);
  const itemType = stringField(item, 'type', 'kind').trim().toLowerCase();
  const eventName = method || type;

  const usage = codexUsageFromRecord(record) ?? codexUsageFromRecord(params) ?? codexUsageFromRecord(item);
  if (usage && /\b(usage|completed|done|turn|response)\b/i.test(`${eventName} ${itemType}`)) {
    return { kind: 'usage', usage };
  }

  if (eventName.includes('commandexecution') || itemType === 'commandexecution' || itemType === 'command_execution') {
    const command = stringField(item, 'command', 'cmd').trim()
      || nestedText(item ?? {}, 'parsedCommand', 'action');
    const cwd = stringField(item, 'cwd', 'workingDirectory', 'working_directory').trim();
    const output = nestedText(item ?? {}, 'output', 'stdout', 'stderr');
    const exitCode = numberField(item, 'exitCode', 'exit_code');
    return {
      kind: 'tool',
      id: stringField(item, 'id').trim() || undefined,
      toolName: 'shell_command',
      label: 'Run',
      detail: command || cwd || output || undefined,
      command: command || undefined,
      cwd: cwd || undefined,
      output: output || undefined,
      exitCode,
      status: codexItemStatus(eventName, item),
    };
  }

  if (eventName.includes('filechange') || eventName.includes('diff/updated') || itemType === 'filechange' || itemType === 'file_change') {
    const path = stringField(item, 'path', 'filePath', 'file_path').trim();
    const changes = codexFileChanges(item, params);
    const diff = stringField(item, 'diff', 'patch').trim()
      || stringField(params, 'diff', 'patch').trim()
      || changes.map(change => change.diff).filter(Boolean).join('\n\n');
    const changedPaths = changes.map(change => change.path).filter(Boolean);
    return {
      kind: 'tool',
      id: stringField(item, 'id').trim()
        || stringField(params, 'itemId', 'item_id', 'id').trim()
        || (path ? `file-change:${path}` : undefined),
      toolName: 'apply_patch',
      label: 'Edit',
      detail: path || changedPaths.join(', ') || 'Updated files',
      output: diff || undefined,
      changes: changes.length > 0 ? changes : undefined,
      status: codexItemStatus(eventName, item),
    };
  }

  if (type.includes('delta')) {
    const text = nestedText(record, 'delta', 'text', 'content');
    if (text) return { kind: 'delta', text };
  }

  if (
    type.includes('message') ||
    type === 'turn.completed' ||
    type === 'response.completed' ||
    itemType.includes('assistant') ||
    itemType.includes('message')
  ) {
    const text = nestedText(record, 'last_message', 'final_message', 'message', 'text', 'content')
      || nestedText(item ?? {}, 'text', 'content', 'message');
    if (text) return { kind: 'final', text };
  }

  if (eventName.includes('tool') || eventName.includes('function') || itemType.includes('tool') || itemType.includes('function')) {
    const source = item ?? record;
    const id = stringField(source, 'id', 'call_id', 'callId', 'toolCallId', 'tool_call_id').trim()
      || stringField(record, 'id', 'call_id', 'callId', 'toolCallId', 'tool_call_id').trim();
    const name = stringField(source, 'name', 'toolName', 'tool_name', 'title', 'command').trim() || 'Tool';
    const detail = stringField(source, 'arguments', 'input', 'command', 'status').trim();
    const status = stringField(source, 'status').trim();
    const failed = /fail|error|denied/i.test(eventName) || /fail|error|denied/i.test(status);
    const completed = /completed|done|finished|success/i.test(eventName) || /completed|done|success/i.test(status);
    return {
      kind: 'tool',
      ...(id ? { id } : {}),
      toolName: name,
      label: name,
      detail: detail || undefined,
      status: failed ? 'failed' : completed ? 'completed' : 'running',
    };
  }

  if (eventName === 'turn.started' || eventName === 'turn/started' || eventName === 'thread.started') {
    return { kind: 'step', label: eventName.includes('turn') ? 'Thinking' : 'Starting Codex' };
  }
  if (eventName === 'turn.completed' || eventName === 'turn/completed') {
    return { kind: 'done' };
  }

  return { kind: 'none' };
}

export function buildCodexCliJsonRunRequest(options: CodexCliJsonRunOptions): HeadlessRunRequest {
  const args = ['exec', '--json', '--color', 'never', '--skip-git-repo-check'];
  const permissionMode = normalizeCliPermissionMode(options.permissionMode, options.yolo);
  if (permissionMode === 'restricted') args.push('--sandbox', 'read-only');
  const model = options.model?.trim();
  if (model) args.push('--model', model);
  const cwd = options.workspaceDir?.trim() || null;
  if (cwd) args.push('--cd', cwd);
  if (permissionMode === 'full') args.push('--dangerously-bypass-approvals-and-sandbox');

  return {
    runId: options.runId,
    missionId: options.missionId,
    nodeId: options.nodeId,
    attempt: 1,
    sessionId: options.sessionId,
    agentId: options.agentId,
    cli: 'codex',
    executionMode: 'streaming_headless',
    cwd,
    command: 'codex',
    args,
    env: {},
    promptDelivery: 'stdin',
    prompt: options.prompt,
    timeoutMs: 10 * 60 * 1000,
  };
}

export async function runCodexCliJson(options: CodexCliJsonRunOptions): Promise<string> {
  const runId = options.runId;
  let stdoutBuffer = '';
  let stderrBuffer = '';
  let streamedText = '';
  let finalText = '';
  let resolveDone: ((value: string) => void) | null = null;

  const finishFromCodexTurn = () => {
    const answer = (finalText || streamedText).trim();
    if (answer) {
      resolveDone?.(answer);
    }
  };

  const parseChunk = (chunk: string) => {
    stdoutBuffer += chunk;
    const lines = stdoutBuffer.split(/\r?\n/);
    stdoutBuffer = lines.pop() ?? '';
    for (const line of lines) {
      const parsed = parseCodexJsonEventLine(line);
      if (parsed.kind === 'delta') {
        streamedText += parsed.text;
        options.onDelta?.(parsed.text);
      } else if (parsed.kind === 'final') {
        finalText = parsed.text;
        if (!streamedText.trim()) {
          streamedText = parsed.text;
          options.onDelta?.(parsed.text);
        }
      } else if (parsed.kind === 'tool') {
        options.onToolEvent?.({
          id: parsed.id,
          toolName: parsed.toolName,
          label: parsed.label,
          detail: parsed.detail,
          command: parsed.command,
          cwd: parsed.cwd,
          output: parsed.output,
          changes: parsed.changes,
          exitCode: parsed.exitCode,
          status: parsed.status,
        });
      } else if (parsed.kind === 'usage') {
        options.onUsage?.(parsed.usage);
      } else if (parsed.kind === 'step') {
        options.onStep?.(parsed.label);
      } else if (parsed.kind === 'done') {
        finishFromCodexTurn();
      }
    }
  };

  options.onStep?.('Starting Codex CLI');

  let unlistenOutput: (() => void) | null = null;
  let unlistenExit: (() => void) | null = null;
  try {
    const done = new Promise<string>((resolve, reject) => {
      resolveDone = resolve;
      void Promise.all([
        listen<AgentRunOutputEvent>('agent-run-output', event => {
          const payload = event.payload;
          if (payload.runId !== runId) return;
          if (payload.stream === 'stderr') {
            stderrBuffer += payload.chunk;
            return;
          }
          parseChunk(payload.chunk);
        }),
        listen<AgentRunExitEvent>('agent-run-exit', event => {
          const payload = event.payload;
          if (payload.runId !== runId) return;
          if (stdoutBuffer.trim()) {
            parseChunk('\n');
          }
          if (payload.status === 'completed') {
            resolve((finalText || streamedText || payload.stdoutPreview || '').trim());
          } else {
            reject(new Error(payload.error || payload.stderrPreview || stderrBuffer.trim() || `Codex CLI exited with status ${payload.status}.`));
          }
        }),
      ]).then(([output, exit]) => {
        unlistenOutput = output;
        unlistenExit = exit;
      }).then(() => {
        return startHeadlessRun(buildCodexCliJsonRunRequest(options));
      }).catch(reject);
    });

    return await done;
  } finally {
    resolveDone = null;
    const stopOutput = unlistenOutput as unknown;
    const stopExit = unlistenExit as unknown;
    if (typeof stopOutput === 'function') stopOutput();
    if (typeof stopExit === 'function') stopExit();
    options.onStep?.(null);
  }
}
