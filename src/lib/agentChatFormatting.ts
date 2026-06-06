import { normalizePreviewUrl } from './previewUrl.js';
import { normalizeTerminalId } from './terminalIds.js';

export type AgentTodoStatus = 'pending' | 'in_progress' | 'completed';

export interface AgentTodoItem {
  label: string;
  status: AgentTodoStatus;
  description?: string;
}

export type AgentContentBlock =
  | { kind: 'markdown'; text: string }
  | { kind: 'todos'; items: AgentTodoItem[] }
  | { kind: 'command'; command: string; reason?: string; cwd?: string; language?: string; action?: 'insert' | 'run' | 'background' }
  | { kind: 'patch'; title: string; path?: string; patch: string }
  | { kind: 'directory'; title: string; path: string }
  | { kind: 'preview'; title: string; url: string }
  | { kind: 'terminal_stop'; title: string; terminalId: string; reason?: string }
  | {
      kind: 'action_result';
      actionKind: string;
      status: 'started' | 'completed' | 'failed';
      target: string;
      cardId?: string;
      title?: string;
      command?: string;
      cwd?: string;
      action?: string;
      terminalId?: string;
      error?: string;
    }
  | { kind: 'status'; label: string; detail?: string; tone: AgentStatusTone; icon: AgentOutputStatusIcon };

export type AgentStatusTone = 'info' | 'success' | 'warn' | 'error';
export type AgentOutputStatusIcon = 'terminal' | 'file' | 'search' | 'edit' | 'test' | 'tool';

export type AgentStatusKind =
  | 'context_compacted'
  | 'prompt_sent'
  | 'agent_started'
  | 'approval_needed'
  | 'permission_updated'
  | 'run_completed'
  | 'run_failed'
  | 'tool_used'
  | 'artifact_published'
  | 'completion_pending'
  | 'agent_update';

export interface AgentStatusPresentation {
  kind: AgentStatusKind;
  label: string;
  detail?: string;
  tone: AgentStatusTone;
}

export interface AgentHistoryAttachment {
  name: string;
  path?: string;
}

export interface AgentHistoryMessage {
  role: string;
  content: string;
  status?: string;
  artifactIds?: string[];
  filePaths?: string[];
  attachments?: AgentHistoryAttachment[];
}

export interface AgentConversationCompactResult<T extends AgentHistoryMessage = AgentHistoryMessage> {
  compacted: boolean;
  droppedCount: number;
  summary: string;
  retainedMessages: T[];
}

const TODO_LINE_RE = /^\s*(?:[-*]|\d+[.)])\s+\[( |x|X|-|~|>)\]\s+(.+?)\s*$/;
const STRUCTURED_TODO_HINT_RE = /(?:\btodo_write\b|["']todos["']\s*:)/i;
const DEFAULT_CONTEXT_MAX_CHARS = 12000;
const DEFAULT_COMPACT_KEEP_TAIL = 8;
const AGENT_WORK_ITEM_PREFIX = '__COMET_AGENT_WORK_ITEM__';
const DEFAULT_COMMAND_OUTPUT_MAX_CHARS = 12000;
const AGENT_CONTEXT_ROLE_LABEL_RE = /\b(?:Agent|Tool|System)\s*\((?:completed|streaming|sending|failed|cancelled|queued)\):\s*/gi;

export function stripAgentAnsi(text: string): string {
  return text
    .replace(/\u001b\[[0-?]*[ -/]*[@-~]/g, '')
    .replace(/\u001b\][^\u0007]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\r(?!\n)/g, '\n');
}

export function stripAgentConversationContextLabels(text: string): string {
  return stripAgentAnsi(text)
    .replace(AGENT_CONTEXT_ROLE_LABEL_RE, '')
    .replace(/\bUser\s*\((?:completed|streaming|sending|failed|cancelled|queued)\):\s*/gi, 'User: ')
    .replace(/[ \t]{2,}/g, ' ')
    .trim();
}

export function compactAgentShellCommandForDisplay(command: string): string {
  const clean = stripAgentAnsi(command).replace(/\s+/g, ' ').trim();
  if (!clean) return '';

  const shellCommand = clean.match(/^(?:"[^"]*(?:pwsh|powershell)(?:\.exe)?"|(?:pwsh|powershell)(?:\.exe)?)(?:\s+-[A-Za-z]+)*\s+-Command\s+(['"])([\s\S]*)\1\s*$/i);
  if (shellCommand?.[2]) {
    return shellCommand[2]
      .replace(/\\"/g, '"')
      .replace(/\\'/g, "'")
      .replace(/\s+/g, ' ')
      .trim();
  }

  const cmdShim = clean.match(/^cmd(?:\.exe)?\s+\/d\s+\/c\s+(.+)$/i);
  if (cmdShim?.[1]) return cmdShim[1].trim();

  return clean;
}

export function compactAgentCommandOutput(output: string, maxChars = DEFAULT_COMMAND_OUTPUT_MAX_CHARS): string {
  const clean = stripAgentAnsi(output).trim();
  if (!clean || clean.length <= maxChars) return clean;

  const headSize = Math.max(1000, Math.floor(maxChars * 0.45));
  const tailSize = Math.max(1000, maxChars - headSize - 160);
  const omitted = clean.slice(headSize, clean.length - tailSize);
  const omittedLines = omitted.split(/\r?\n/).filter(Boolean).length;
  const omittedLabel = omittedLines > 0
    ? `... ${omittedLines} lines omitted ...`
    : `... ${clean.length - headSize - tailSize} characters omitted ...`;

  return [
    clean.slice(0, headSize).trimEnd(),
    omittedLabel,
    clean.slice(-tailSize).trimStart(),
  ].join('\n');
}

export function parseAgentTodoLine(line: string): AgentTodoItem | null {
  const match = line.match(TODO_LINE_RE);
  if (!match) return null;
  const marker = match[1].toLowerCase();
  return {
    label: match[2].trim(),
    status: marker === 'x' ? 'completed' : marker === '-' || marker === '~' || marker === '>' ? 'in_progress' : 'pending',
  };
}

export function parseStructuredAgentTodos(text: string): AgentTodoItem[] | null {
  if (!STRUCTURED_TODO_HINT_RE.test(text)) return null;

  for (const candidate of jsonCandidatesFromText(text)) {
    const parsed = parseJsonCandidate(candidate);
    if (parsed === undefined) continue;
    const todos = extractTodosFromValue(parsed);
    if (todos && todos.length > 0) return todos;
  }

  return null;
}

export function parseAgentCommandSuggestion(text: string): Extract<AgentContentBlock, { kind: 'command' }> | null {
  const clean = stripAgentAnsi(text).trim();
  const isRunProposal = /^Command proposed\b/i.test(clean);
  const isBackgroundProposal = /^Background command proposed\b/i.test(clean);
  if (!/^Suggested command\b/i.test(clean) && !isRunProposal && !isBackgroundProposal) return null;
  const fence = clean.match(/```([a-z0-9_-]*)\s*\n([\s\S]*?)\n```/i);
  if (!fence) return null;
  const command = fence[2].trim();
  if (!command) return null;
  const beforeFence = clean.slice(0, fence.index).trim();
  const reason = beforeFence.match(/^Reason:\s*(.+)$/im)?.[1]?.trim();
  const cwd = beforeFence.match(/^Working directory:\s*(.+)$/im)?.[1]?.trim();
  return {
    kind: 'command',
    command,
    reason: reason || undefined,
    cwd: cwd || undefined,
    language: fence[1]?.trim() || undefined,
    action: isBackgroundProposal ? 'background' : isRunProposal ? 'run' : 'insert',
  };
}

export function parseAgentPatchProposal(text: string): Extract<AgentContentBlock, { kind: 'patch' }> | null {
  const clean = stripAgentAnsi(text).trim();
  if (!/^Patch proposed\b/i.test(clean)) return null;
  const fence = clean.match(/```diff\s*\n([\s\S]*?)\n```/i);
  if (!fence) return null;
  const patch = fence[1].trimEnd();
  if (!patch.includes('@@ ')) return null;
  const beforeFence = clean.slice(0, fence.index).trim();
  const title = beforeFence.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || 'Proposed patch';
  const path = beforeFence.match(/^Path:\s*(.+)$/im)?.[1]?.trim();
  return {
    kind: 'patch',
    title,
    path: path || undefined,
    patch,
  };
}

export function parseAgentDirectoryProposal(text: string): Extract<AgentContentBlock, { kind: 'directory' }> | null {
  const clean = stripAgentAnsi(text).trim();
  if (!/^Directory proposed\b/i.test(clean)) return null;
  const title = clean.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || 'Create directory';
  const path = clean.match(/^Path:\s*(.+)$/im)?.[1]?.trim();
  if (!path) return null;
  return {
    kind: 'directory',
    title,
    path,
  };
}

export function parseAgentPreviewProposal(text: string): Extract<AgentContentBlock, { kind: 'preview' }> | null {
  const clean = stripAgentAnsi(text).trim();
  if (!/^Preview proposed\b/i.test(clean)) return null;
  const title = clean.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || 'Preview';
  const url = normalizePreviewUrl(clean.match(/^URL:\s*(.+)$/im)?.[1]?.trim());
  if (!url) return null;
  return {
    kind: 'preview',
    title,
    url,
  };
}

export function parseAgentTerminalStopProposal(text: string): Extract<AgentContentBlock, { kind: 'terminal_stop' }> | null {
  const clean = stripAgentAnsi(text).trim();
  if (!/^Terminal stop proposed\b/i.test(clean)) return null;
  const title = clean.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || 'Stop terminal';
  const terminalId = normalizeTerminalId(clean.match(/^Terminal ID:\s*(.+)$/im)?.[1]);
  const reason = clean.match(/^Reason:\s*(.+)$/im)?.[1]?.trim();
  if (!terminalId) return null;
  return {
    kind: 'terminal_stop',
    title,
    terminalId,
    reason: reason || undefined,
  };
}

export function parseAgentActionResult(text: string): Extract<AgentContentBlock, { kind: 'action_result' }> | null {
  const clean = stripAgentAnsi(text).trim();
  if (!/^Action result\b/i.test(clean)) return null;
  const actionKind = clean.match(/^Kind:\s*(.+)$/im)?.[1]?.trim();
  const status = clean.match(/^Status:\s*(.+)$/im)?.[1]?.trim().toLowerCase();
  const target = clean.match(/^Target:\s*(.+)$/im)?.[1]?.trim();
  const terminalId = normalizeTerminalId(clean.match(/^Terminal ID:\s*(.+)$/im)?.[1]);
  if (!actionKind || !target || (status !== 'started' && status !== 'completed' && status !== 'failed')) return null;
  return {
    kind: 'action_result',
    actionKind,
    status,
    target,
    cardId: clean.match(/^Card ID:\s*(.+)$/im)?.[1]?.trim() || undefined,
    title: clean.match(/^Title:\s*(.+)$/im)?.[1]?.trim() || undefined,
    command: clean.match(/^Command:\s*(.+)$/im)?.[1]?.trim() || undefined,
    cwd: clean.match(/^Working directory:\s*(.+)$/im)?.[1]?.trim() || undefined,
    action: clean.match(/^Action:\s*(.+)$/im)?.[1]?.trim() || undefined,
    terminalId: terminalId || undefined,
    error: clean.match(/^Error:\s*(.+)$/im)?.[1]?.trim() || undefined,
  };
}

export function parseAgentStatusLine(line: string): Extract<AgentContentBlock, { kind: 'status' }> | null {
  const clean = stripAgentAnsi(line).trim();
  if (!clean || clean.length > 240) return null;

  const withoutSpinner = clean.replace(/^[|/\\\-⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏•·*]\s*/, '').trim();
  const command = withoutSpinner.match(/^(?:[>$]\s*)?(?:running|executing|starting)\s+(?:command|shell command|tests?|build)?[:\s]+(.+)$/i);
  if (command) return { kind: 'status', label: 'Running command', detail: command[1].trim(), tone: 'info', icon: 'terminal' };

  if (/^(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:test|build|check|lint)\b/i.test(withoutSpinner) || /^(?:cargo|go|pytest|node)\b.*\b(?:test|build|check|lint)\b/i.test(withoutSpinner)) {
    return { kind: 'status', label: 'Running command', detail: withoutSpinner, tone: 'info', icon: 'terminal' };
  }

  const explicitFileRead = withoutSpinner.match(/^(?:reading|read|opened|opening)\s+files?\s+(.+)$/i);
  if (explicitFileRead) return { kind: 'status', label: 'Reading file', detail: explicitFileRead[1].trim(), tone: 'info', icon: 'file' };

  const pathRead = withoutSpinner.match(/^(?:reading|read|opened|opening)\s+(.+)$/i);
  if (pathRead && isLikelyPathLike(pathRead[1])) return { kind: 'status', label: 'Reading path', detail: pathRead[1].trim(), tone: 'info', icon: 'file' };

  const search = withoutSpinner.match(/^(?:searching|grep|rg|glob|finding)\b[:\s]*(.*)$/i);
  if (search) return { kind: 'status', label: 'Searching', detail: search[1]?.trim() || undefined, tone: 'info', icon: 'search' };

  const edit = withoutSpinner.match(/^(?:writing|wrote|creating|created|updating|updated|modifying|modified|editing|edited)\s+(.+)$/i);
  if (edit && isLikelyPathLike(edit[1])) return { kind: 'status', label: 'Updating file', detail: edit[1].trim(), tone: 'success', icon: 'edit' };

  const patch = withoutSpinner.match(/^(?:applying patch|patch applied|apply_patch|successfully applied patch)\b[:\s]*(.*)$/i);
  if (patch) return { kind: 'status', label: 'Applying patch', detail: patch[1]?.trim() || undefined, tone: 'success', icon: 'edit' };

  const pass = withoutSpinner.match(/^(?:PASS|✓|✔)\s+(.+)$/i);
  if (pass) return { kind: 'status', label: 'Check passed', detail: pass[1].trim(), tone: 'success', icon: 'test' };

  const fail = withoutSpinner.match(/^(?:FAIL|✗|✘)\s+(.+)$/i);
  if (fail) return { kind: 'status', label: 'Check failed', detail: fail[1].trim(), tone: 'error', icon: 'test' };

  const tool = withoutSpinner.match(/^(?:calling|using|running)\s+tool[:\s]+(.+)$/i);
  if (tool) return { kind: 'status', label: 'Using tool', detail: tool[1].trim(), tone: 'info', icon: 'tool' };

  return null;
}

function isTransientAgentProgressLine(line: string): boolean {
  const clean = stripAgentAnsi(line)
    .replace(/^[|/\\\-⠋⠙⠹⠸⠼⠴⠦⠧⠇⠏•·*]\s*/, '')
    .trim();
  return /^(?:thinking|working|processing|analyzing|planning)\b/i.test(clean);
}

function isLikelyPathLike(value: string): boolean {
  const candidate = value.trim().replace(/^file\s+/i, '');
  if (!candidate || /\b(plan|context|summary|todo|todos|status)\b/i.test(candidate)) return false;
  return /[\\/]/.test(candidate) || /(?:^|\s|["'`])[\w@~$%{}()[\]-]+(?:\.[a-z0-9]{1,8})+\b/i.test(candidate);
}

export function splitAgentContent(content: string, options: { parseStatus?: boolean } = {}): AgentContentBlock[] {
  const parseStatus = options.parseStatus ?? true;
  const clean = stripAgentAnsi(content);
  const lines = clean.split('\n');
  const blocks: AgentContentBlock[] = [];
  let text: string[] = [];
  let todos: AgentTodoItem[] = [];

  const flushText = () => {
    const value = text.join('\n').trim();
    if (value) blocks.push({ kind: 'markdown', text: value });
    text = [];
  };
  const flushTodos = () => {
    if (todos.length > 0) blocks.push({ kind: 'todos', items: todos });
    todos = [];
  };
  const pushStatus = (status: Extract<AgentContentBlock, { kind: 'status' }>) => {
    flushText();
    flushTodos();
    blocks.push(status);
  };

  for (let lineIndex = 0; lineIndex < lines.length; lineIndex += 1) {
    const line = lines[lineIndex];
    const actionResultBlock = actionResultBlockAt(lines, lineIndex);
    if (actionResultBlock) {
      flushText();
      flushTodos();
      blocks.push(actionResultBlock.actionResult);
      lineIndex = actionResultBlock.endIndex;
      continue;
    }

    const previewBlock = previewProposalBlockAt(lines, lineIndex);
    if (previewBlock) {
      flushText();
      flushTodos();
      blocks.push(previewBlock.preview);
      lineIndex = previewBlock.endIndex;
      continue;
    }

    const terminalStopBlock = terminalStopProposalBlockAt(lines, lineIndex);
    if (terminalStopBlock) {
      flushText();
      flushTodos();
      blocks.push(terminalStopBlock.terminalStop);
      lineIndex = terminalStopBlock.endIndex;
      continue;
    }

    const directoryBlock = directoryProposalBlockAt(lines, lineIndex);
    if (directoryBlock) {
      flushText();
      flushTodos();
      blocks.push(directoryBlock.directory);
      lineIndex = directoryBlock.endIndex;
      continue;
    }

    const patchBlock = patchProposalBlockAt(lines, lineIndex);
    if (patchBlock) {
      flushText();
      flushTodos();
      blocks.push(patchBlock.patch);
      lineIndex = patchBlock.endIndex;
      continue;
    }

    const commandBlock = commandSuggestionBlockAt(lines, lineIndex);
    if (commandBlock) {
      flushText();
      flushTodos();
      blocks.push(commandBlock.command);
      lineIndex = commandBlock.endIndex;
      continue;
    }

    const structuredBlock = structuredTodoBlockAt(lines, lineIndex);
    if (structuredBlock) {
      flushText();
      flushTodos();
      blocks.push({ kind: 'todos', items: structuredBlock.items });
      lineIndex = structuredBlock.endIndex;
      continue;
    }

    const structuredTodos = parseStructuredAgentTodos(line);
    if (structuredTodos) {
      flushText();
      flushTodos();
      blocks.push({ kind: 'todos', items: structuredTodos });
      continue;
    }

    const todo = parseAgentTodoLine(line);
    if (todo) {
      flushText();
      todos.push(todo);
      continue;
    }
    if (isTransientAgentProgressLine(line)) {
      flushTodos();
      continue;
    }
    const status = parseStatus ? parseAgentStatusLine(line) : null;
    if (status) {
      pushStatus(status);
      continue;
    }
    flushTodos();
    text.push(line);
  }

  flushText();
  flushTodos();
  return blocks;
}

export function buildAgentConversationContext(
  messages: AgentHistoryMessage[],
  options: { maxChars?: number } = {},
): string {
  const maxChars = options.maxChars ?? DEFAULT_CONTEXT_MAX_CHARS;
  const entries = messages
    .filter(message => shouldIncludeInConversationContext(message))
    .map(message => formatMessageForConversationContext(message))
    .filter(Boolean);
  const selected: string[] = [];
  let total = 0;

  for (let index = entries.length - 1; index >= 0; index -= 1) {
    const entry = entries[index];
    const nextTotal = total + entry.length + 2;
    if (selected.length > 0 && nextTotal > maxChars) break;
    selected.unshift(entry.length > maxChars ? `${entry.slice(0, maxChars - 3)}...` : entry);
    total = nextTotal;
  }

  return selected.join('\n\n').trim();
}

export function compactAgentConversation<T extends AgentHistoryMessage>(
  messages: T[],
  options: { keepTail?: number; maxSummaryChars?: number } = {},
): AgentConversationCompactResult<T> {
  const keepTail = Math.max(0, options.keepTail ?? DEFAULT_COMPACT_KEEP_TAIL);
  const maxSummaryChars = options.maxSummaryChars ?? 4000;
  const splitIndex = Math.max(0, messages.length - keepTail);
  const olderMessages = messages.slice(0, splitIndex);
  const retainedMessages = messages.slice(splitIndex);
  const summary = summarizeAgentConversation(olderMessages.length > 0 ? olderMessages : messages, maxSummaryChars);

  return {
    compacted: olderMessages.length > 0,
    droppedCount: olderMessages.length,
    summary,
    retainedMessages: olderMessages.length > 0 ? retainedMessages : messages,
  };
}

function shouldIncludeInConversationContext(message: AgentHistoryMessage): boolean {
  if (message.role === 'user' || message.role === 'agent') return Boolean(message.content.trim());
  if (message.role === 'tool') return Boolean(message.content.trim());
  return /context compacted/i.test(message.content);
}

function formatMessageForConversationContext(message: AgentHistoryMessage): string {
  const role = message.role === 'agent'
    ? 'Agent'
    : message.role === 'user'
      ? 'User'
      : message.role === 'tool'
        ? 'Tool'
        : 'System';
  const content = contentForConversationContext(message.content);
  const files = [
    ...(message.filePaths ?? []),
    ...(message.attachments ?? []).map(attachment => attachment.path ?? attachment.name),
  ].filter(Boolean);
  const artifacts = message.artifactIds?.filter(Boolean) ?? [];
  const artifactLine = artifacts.length > 0 ? `\nArtifacts: ${uniqueTail(artifacts, 8).join(', ')}` : '';
  const fileLine = files.length > 0 ? `\nFiles: ${uniqueTail(files, 8).join(', ')}` : '';
  return `${role}: ${content}${artifactLine}${fileLine}`.trim();
}

function contentForConversationContext(content: string): string {
  const workItem = summarizeStructuredWorkItem(content);
  if (workItem) return workItem;
  const blocks = splitAgentContent(content);
  if (blocks.length === 0) return stripAgentAnsi(content).trim();
  return blocks.map(block => {
    if (block.kind === 'markdown') return block.text;
    if (block.kind === 'status') return `${block.label}${block.detail ? `: ${block.detail}` : ''}`;
    if (block.kind === 'command') {
      return `${block.action === 'background' ? 'Background command proposed' : block.action === 'run' ? 'Command proposed' : 'Suggested command'}${block.reason ? ` (${block.reason})` : ''}: ${block.command}${block.cwd ? ` [cwd: ${block.cwd}]` : ''}`;
    }
    if (block.kind === 'patch') {
      return `Patch proposed: ${block.title}${block.path ? ` (${block.path})` : ''}`;
    }
    if (block.kind === 'directory') {
      return `Directory proposed: ${block.title} (${block.path})`;
    }
    if (block.kind === 'preview') {
      return `Preview proposed: ${block.title} (${block.url})`;
    }
    if (block.kind === 'terminal_stop') {
      return `Terminal stop proposed: ${block.title} (${block.terminalId})${block.reason ? ` - ${block.reason}` : ''}`;
    }
    if (block.kind === 'action_result') {
      return [
        `Action result: ${block.actionKind} ${block.status} (${block.target})`,
        block.cardId ? `Card ID: ${block.cardId}` : '',
        block.title ? `Title: ${block.title}` : '',
        block.command ? `Command: ${block.command}` : '',
        block.cwd ? `Working directory: ${block.cwd}` : '',
        block.action ? `Action: ${block.action}` : '',
        block.terminalId ? `Terminal ID: ${block.terminalId}` : '',
        block.error ? `Error: ${block.error}` : '',
      ].filter(Boolean).join('\n');
    }
    return [
      'Todos:',
      ...block.items.map(item => `- [${todoStatusMarker(item.status)}] ${item.label}${item.description ? ` - ${item.description}` : ''}`),
    ].join('\n');
  }).join('\n').trim();
}

function summarizeStructuredWorkItem(content: string): string | null {
  const clean = content.trim();
  if (!clean.startsWith(AGENT_WORK_ITEM_PREFIX)) return null;
  try {
    const item = JSON.parse(clean.slice(AGENT_WORK_ITEM_PREFIX.length).trim()) as Record<string, unknown>;
    const title = typeof item.title === 'string' ? item.title : 'Tool';
    const status = typeof item.status === 'string' ? item.status : 'inProgress';
    const detail = typeof item.detail === 'string' ? item.detail : '';
    const changes = Array.isArray(item.changes) ? item.changes.length : 0;
    const command = typeof item.command === 'string' ? item.command : '';
    return [
      `Work item: ${title} (${status})`,
      detail,
      command ? `Command: ${command}` : '',
      changes > 0 ? `${changes} changed file${changes === 1 ? '' : 's'}` : '',
    ].filter(Boolean).join('\n');
  } catch {
    return null;
  }
}

function summarizeAgentConversation(messages: AgentHistoryMessage[], maxChars: number): string {
  const userMessages = messages.filter(message => message.role === 'user');
  const agentMessages = messages.filter(message => message.role === 'agent');
  const toolMessages = messages.filter(message => message.role === 'tool');
  const files = uniqueTail(messages.flatMap(message => [
    ...(message.filePaths ?? []),
    ...(message.attachments ?? []).map(attachment => attachment.path ?? attachment.name),
  ]).filter(Boolean), 12);
  const artifacts = uniqueTail(messages.flatMap(message => message.artifactIds ?? []).filter(Boolean), 12);
  const latestTodos = latestTodoItems(messages);
  const lines = [
    `Compacted ${messages.length} earlier follow-up message${messages.length === 1 ? '' : 's'}.`,
    ...tailSummaries('Recent user asks', userMessages, 3),
    ...tailSummaries('Recent agent notes', agentMessages, 3),
    toolMessages.length > 0 ? `Recent tool updates: ${toolMessages.slice(-3).map(message => truncateLine(contentForConversationContext(message.content), 120)).join(' | ')}` : '',
    latestTodos.length > 0 ? `Latest todos: ${latestTodos.map(item => `[${todoStatusMarker(item.status)}] ${item.label}`).join('; ')}` : '',
    artifacts.length > 0 ? `Referenced artifacts: ${artifacts.join(', ')}` : '',
    files.length > 0 ? `Referenced files: ${files.join(', ')}` : '',
  ].filter(Boolean);
  const summary = lines.join('\n');
  return summary.length > maxChars ? `${summary.slice(0, maxChars - 3)}...` : summary;
}

function tailSummaries(label: string, messages: AgentHistoryMessage[], count: number): string[] {
  const tail = messages.slice(-count);
  if (tail.length === 0) return [];
  return [
    `${label}:`,
    ...tail.map(message => `- ${truncateLine(contentForConversationContext(message.content), 180)}`),
  ];
}

function latestTodoItems(messages: AgentHistoryMessage[]): AgentTodoItem[] {
  for (let index = messages.length - 1; index >= 0; index -= 1) {
    const todoBlock = splitAgentContent(messages[index].content).reverse().find(block => block.kind === 'todos');
    if (todoBlock?.kind === 'todos') return todoBlock.items;
  }
  return [];
}

function todoStatusMarker(status: AgentTodoStatus): string {
  if (status === 'completed') return 'x';
  if (status === 'in_progress') return '>';
  return ' ';
}

function truncateLine(value: string, maxLength: number): string {
  const singleLine = value.replace(/\s+/g, ' ').trim();
  return singleLine.length > maxLength ? `${singleLine.slice(0, maxLength - 3)}...` : singleLine;
}

function uniqueTail(values: string[], limit: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (let index = values.length - 1; index >= 0; index -= 1) {
    const value = values[index];
    if (!value || seen.has(value)) continue;
    seen.add(value);
    out.unshift(value);
    if (out.length >= limit) break;
  }
  return out;
}

function actionResultBlockAt(lines: string[], startIndex: number): { actionResult: Extract<AgentContentBlock, { kind: 'action_result' }>; endIndex: number } | null {
  const firstLine = lines[startIndex]?.trim() ?? '';
  if (!/^Action result\b/i.test(firstLine)) return null;

  const body: string[] = [];
  let endIndex = startIndex;
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 12); i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (i > startIndex && trimmed === '') break;
    if (i > startIndex && !/^(?:Kind|Status|Card ID|Title|Target|Command|Working directory|Action|Terminal ID|Error):\s*/i.test(trimmed)) break;
    body.push(line);
    endIndex = i;
  }
  const actionResult = parseAgentActionResult(body.join('\n'));
  return actionResult ? { actionResult, endIndex } : null;
}

function patchProposalBlockAt(lines: string[], startIndex: number): { patch: Extract<AgentContentBlock, { kind: 'patch' }>; endIndex: number } | null {
  const firstLine = lines[startIndex]?.trim() ?? '';
  if (!/^Patch proposed\b/i.test(firstLine)) return null;

  const body: string[] = [];
  let fenceOpen = false;
  for (let i = startIndex; i < lines.length; i += 1) {
    const line = lines[i];
    body.push(line);
    if (/^```/.test(line.trim())) {
      if (fenceOpen) {
        const patch = parseAgentPatchProposal(body.join('\n'));
        return patch ? { patch, endIndex: i } : null;
      }
      fenceOpen = true;
    }
  }
  return null;
}

function directoryProposalBlockAt(lines: string[], startIndex: number): { directory: Extract<AgentContentBlock, { kind: 'directory' }>; endIndex: number } | null {
  const firstLine = lines[startIndex]?.trim() ?? '';
  if (!/^Directory proposed\b/i.test(firstLine)) return null;

  const body: string[] = [];
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 8); i += 1) {
    const line = lines[i];
    if (i > startIndex && line.trim() === '') break;
    body.push(line);
    const directory = parseAgentDirectoryProposal(body.join('\n'));
    if (directory) return { directory, endIndex: i };
  }
  return null;
}

function previewProposalBlockAt(lines: string[], startIndex: number): { preview: Extract<AgentContentBlock, { kind: 'preview' }>; endIndex: number } | null {
  const firstLine = lines[startIndex]?.trim() ?? '';
  if (!/^Preview proposed\b/i.test(firstLine)) return null;

  const body: string[] = [];
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 8); i += 1) {
    const line = lines[i];
    if (i > startIndex && line.trim() === '') break;
    body.push(line);
    const preview = parseAgentPreviewProposal(body.join('\n'));
    if (preview) return { preview, endIndex: i };
  }
  return null;
}

function terminalStopProposalBlockAt(lines: string[], startIndex: number): { terminalStop: Extract<AgentContentBlock, { kind: 'terminal_stop' }>; endIndex: number } | null {
  const firstLine = lines[startIndex]?.trim() ?? '';
  if (!/^Terminal stop proposed\b/i.test(firstLine)) return null;

  const body: string[] = [];
  let endIndex = startIndex;
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 8); i += 1) {
    const line = lines[i];
    const trimmed = line.trim();
    if (i > startIndex && trimmed === '') break;
    if (i > startIndex && !/^(?:Title|Terminal ID|Reason):\s*/i.test(trimmed)) break;
    body.push(line);
    endIndex = i;
  }
  const terminalStop = parseAgentTerminalStopProposal(body.join('\n'));
  return terminalStop ? { terminalStop, endIndex } : null;
}

function commandSuggestionBlockAt(lines: string[], startIndex: number): { command: Extract<AgentContentBlock, { kind: 'command' }>; endIndex: number } | null {
  const firstLine = lines[startIndex]?.trim() ?? '';
  if (!/^(?:Suggested command|Command proposed|Background command proposed)\b/i.test(firstLine)) return null;

  const body: string[] = [];
  let fenceOpen = false;
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 40); i += 1) {
    const line = lines[i];
    body.push(line);
    if (/^```/.test(line.trim())) {
      if (fenceOpen) {
        const command = parseAgentCommandSuggestion(body.join('\n'));
        return command ? { command, endIndex: i } : null;
      }
      fenceOpen = true;
    }
  }
  return null;
}

function structuredTodoBlockAt(lines: string[], startIndex: number): { items: AgentTodoItem[]; endIndex: number } | null {
  const firstLine = lines[startIndex]?.trim() ?? '';
  if (/^```/.test(firstLine)) {
    const body: string[] = [];
    for (let i = startIndex + 1; i < lines.length; i += 1) {
      if (/^```/.test(lines[i].trim())) {
        const items = parseStructuredAgentTodos(body.join('\n'));
        return items ? { items, endIndex: i } : null;
      }
      body.push(lines[i]);
    }
    return null;
  }

  if (!/^[{[]/.test(firstLine) && !STRUCTURED_TODO_HINT_RE.test(firstLine)) return null;

  const body: string[] = [];
  for (let i = startIndex; i < Math.min(lines.length, startIndex + 80); i += 1) {
    body.push(lines[i]);
    const items = parseStructuredAgentTodos(body.join('\n'));
    if (items) return { items, endIndex: i };
  }

  return null;
}

function parseJsonCandidate(candidate: string): unknown {
  try {
    return JSON.parse(candidate);
  } catch {
    return undefined;
  }
}

function jsonCandidatesFromText(text: string): string[] {
  const trimmed = text.trim();
  const candidates = new Set<string>();
  if ((trimmed.startsWith('{') && trimmed.endsWith('}')) || (trimmed.startsWith('[') && trimmed.endsWith(']'))) {
    candidates.add(trimmed);
  }

  const firstObject = trimmed.indexOf('{');
  const lastObject = trimmed.lastIndexOf('}');
  if (firstObject !== -1 && lastObject > firstObject) {
    candidates.add(trimmed.slice(firstObject, lastObject + 1));
  }

  const firstArray = trimmed.indexOf('[');
  const lastArray = trimmed.lastIndexOf(']');
  if (firstArray !== -1 && lastArray > firstArray) {
    candidates.add(trimmed.slice(firstArray, lastArray + 1));
  }

  return Array.from(candidates);
}

function extractTodosFromValue(value: unknown): AgentTodoItem[] | null {
  if (Array.isArray(value)) return normalizeTodoArray(value);
  if (typeof value === 'string') {
    const parsed = parseJsonCandidate(value);
    return parsed === undefined ? null : extractTodosFromValue(parsed);
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const direct = normalizeTodoArray(record.todos);
  if (direct) return direct;

  const nestedKeys = ['input', 'arguments', 'args', 'params'];
  for (const key of nestedKeys) {
    const nested = extractTodosFromValue(record[key]);
    if (nested) return nested;
  }

  return null;
}

function normalizeTodoArray(value: unknown): AgentTodoItem[] | null {
  if (!Array.isArray(value)) return null;
  const items = value
    .map(normalizeTodoItem)
    .filter((item): item is AgentTodoItem => Boolean(item));
  return items.length > 0 ? items : null;
}

function normalizeTodoItem(value: unknown): AgentTodoItem | null {
  if (typeof value === 'string') {
    const label = value.trim();
    return label ? { label, status: 'pending' } : null;
  }
  if (!value || typeof value !== 'object') return null;

  const record = value as Record<string, unknown>;
  const label = firstString(record, ['title', 'label', 'content', 'task', 'text']);
  if (!label) return null;

  const todo: AgentTodoItem = {
    label,
    status: normalizeTodoStatus(firstString(record, ['status', 'state']) ?? ''),
  };
  const description = firstString(record, ['description', 'detail', 'note']);
  if (description) todo.description = description;
  return todo;
}

function normalizeTodoStatus(value: string): AgentTodoStatus {
  switch (value.trim().toLowerCase().replace(/[\s-]+/g, '_')) {
    case 'done':
    case 'complete':
    case 'completed':
    case 'success':
      return 'completed';
    case 'active':
    case 'current':
    case 'doing':
    case 'in_progress':
    case 'inprogress':
    case 'running':
      return 'in_progress';
    default:
      return 'pending';
  }
}

function firstString(record: Record<string, unknown>, keys: string[]): string | null {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return null;
}

export function classifyAgentStatusMessage(message: {
  role: string;
  status?: string;
  content: string;
}): AgentStatusPresentation {
  const content = stripAgentAnsi(message.content).trim();
  if (/context compacted/i.test(content)) {
    return {
      kind: 'context_compacted',
      label: 'Context compacted',
      detail: 'Older chat context was folded away for the next run.',
      tone: 'info',
    };
  }
  if (/^sent to runtime/i.test(content)) {
    return { kind: 'prompt_sent', label: 'Prompt sent', detail: content, tone: 'info' };
  }
  if (/runtime acknowledged/i.test(content)) {
    return {
      kind: 'agent_started',
      label: 'Agent started',
      detail: 'The runtime accepted the follow-up task.',
      tone: 'info',
    };
  }
  if (/waiting for permission/i.test(content)) {
    return {
      kind: 'approval_needed',
      label: 'Permission needed',
      detail: content.replace(/^Waiting for permission:\s*/i, ''),
      tone: 'warn',
    };
  }
  if (/^permission /i.test(content)) {
    return {
      kind: 'permission_updated',
      label: 'Permission updated',
      detail: content,
      tone: /den(y|ied)/i.test(content) ? 'warn' : 'success',
    };
  }
  if (/completed with success/i.test(content) || (message.status === 'completed' && /runtime session completed/i.test(content))) {
    return { kind: 'run_completed', label: 'Run completed', detail: content, tone: 'success' };
  }
  if (/failed|error/i.test(content) || message.status === 'failed') {
    return { kind: 'run_failed', label: 'Run failed', detail: content, tone: 'error' };
  }
  if (/^tool:/i.test(content)) {
    return {
      kind: 'tool_used',
      label: /failed/i.test(content) || message.status === 'failed' ? 'Tool failed' : 'Tool used',
      detail: content.replace(/^Tool:\s*/i, ''),
      tone: /failed/i.test(content) || message.status === 'failed' ? 'error' : 'info',
    };
  }
  if (/^artifact:/i.test(content) || message.role === 'tool') {
    return {
      kind: 'artifact_published',
      label: 'Artifact published',
      detail: content.replace(/^Artifact:\s*/i, ''),
      tone: 'success',
    };
  }
  if (/completion contract/i.test(content)) {
    return { kind: 'completion_pending', label: 'Still waiting for completion', detail: content, tone: 'warn' };
  }
  return { kind: 'agent_update', label: 'Agent update', detail: content, tone: 'info' };
}

export function runtimeStepLabel(state?: string | null): string {
  switch (state) {
    case 'creating':
      return 'Preparing runtime';
    case 'launching_cli':
      return 'Launching agent';
    case 'waiting_auth':
      return 'Waiting for authentication';
    case 'registering_mcp':
    case 'awaiting_mcp_ready':
      return 'Connecting workspace tools';
    case 'bootstrap_injecting':
    case 'bootstrap_sent':
      return 'Bootstrapping agent';
    case 'injecting_task':
      return 'Sending prompt';
    case 'awaiting_ack':
      return 'Waiting for agent';
    case 'running':
    case 'streaming':
      return 'Thinking';
    case 'awaiting_permission':
      return 'Waiting for approval';
    default:
      return state ? formatAgentTitleToken(state.replace(/_/g, ' ')) : 'Thinking';
  }
}

function formatAgentTitleToken(value: string): string {
  return value
    .split(/\s+/)
    .filter(Boolean)
    .map(part => part.charAt(0).toUpperCase() + part.slice(1))
    .join(' ');
}
