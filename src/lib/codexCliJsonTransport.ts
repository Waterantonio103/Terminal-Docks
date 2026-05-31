import { listen } from '@tauri-apps/api/event';
import { startHeadlessRun, type HeadlessRunRequest } from './runtime/TerminalRuntime.js';

export type CodexCliJsonToolEvent = {
  label: string;
  detail?: string;
  status: 'running' | 'completed' | 'failed';
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
  onStep?: (step: string | null) => void;
  onDelta?: (delta: string) => void;
  onToolEvent?: (event: CodexCliJsonToolEvent) => void;
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
  | { kind: 'tool'; label: string; detail?: string; status: 'running' | 'completed' | 'failed' }
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

  const type = stringField(record, 'type', 'event', 'kind').trim().toLowerCase();
  const item = asRecord(record.item) ?? asRecord(record.message) ?? asRecord(record.data);
  const itemType = stringField(item, 'type', 'kind').trim().toLowerCase();

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

  if (type.includes('tool') || type.includes('function') || itemType.includes('tool') || itemType.includes('function')) {
    const source = item ?? record;
    const name = stringField(source, 'name', 'toolName', 'title', 'command').trim() || 'Tool';
    const detail = stringField(source, 'arguments', 'input', 'command', 'status').trim();
    const status = stringField(source, 'status').trim();
    const failed = /fail|error|denied/i.test(type) || /fail|error|denied/i.test(status);
    const completed = /completed|done|finished|success/i.test(type) || /completed|done|success/i.test(status);
    return {
      kind: 'tool',
      label: name,
      detail: detail || undefined,
      status: failed ? 'failed' : completed ? 'completed' : 'running',
    };
  }

  if (type === 'turn.started' || type === 'thread.started') {
    return { kind: 'step', label: type === 'turn.started' ? 'Thinking' : 'Starting Codex' };
  }
  if (type === 'turn.completed') {
    return { kind: 'done' };
  }

  return { kind: 'none' };
}

export function buildCodexCliJsonRunRequest(options: CodexCliJsonRunOptions): HeadlessRunRequest {
  const args = ['exec', '--json', '--color', 'never', '--skip-git-repo-check'];
  const model = options.model?.trim();
  if (model) args.push('--model', model);
  const cwd = options.workspaceDir?.trim() || null;
  if (cwd) args.push('--cd', cwd);
  if (options.yolo) args.push('--dangerously-bypass-approvals-and-sandbox');

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
        // Codex CLI JSON includes low-level tool lifecycle events. The app chat treats the CLI
        // path as a clean conversational fallback, so keep these out of the visible transcript.
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
