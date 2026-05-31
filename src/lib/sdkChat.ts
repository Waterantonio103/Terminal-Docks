import { generateText, streamText, stepCountIs, tool, type LanguageModel, type ModelMessage, type ToolSet, type UserContent } from 'ai';
import { createOpenAI } from '@ai-sdk/openai';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { z } from 'zod';
import { getCachedDirtyEditorContent, listCachedDirtyEditorPaths } from './editorSessionCache.js';
import { isLocalServerUrl, normalizeLocalServerUrl } from './localServerDetection.js';
import { terminalOutputBus, type PtyChunk } from './runtime/TerminalOutputBus.js';
import { SDK_COMMAND_EXIT_MARKER } from './sdkCommandMarkers.js';
import { normalizeTerminalId } from './terminalIds.js';

const DEFAULT_OPENAI_MODEL = 'gpt-5-mini';
export const OPENAI_SDK_CONFIG_CHANGED_EVENT = 'comet-ai:openai-sdk-config-changed';
export const SDK_MAX_AGENT_STEPS = 24;
export const SDK_SUBAGENT_MAX_STEPS = 12;
export const SDK_REQUEST_TIMEOUT_MS = 120_000;
export const SDK_APPROVAL_CARD_TOOLS = ['edit', 'multi_edit', 'write_file', 'propose_patch', 'create_directory', 'bash_run', 'bash_background', 'bash_kill', 'open_preview', 'suggest_command'] as const;
const MAX_READ_BYTES = 96_000;
const MAX_PROJECT_MEMORY_BYTES = 32_000;
const MAX_ATTACHMENT_CONTEXT_CHARS = 24_000;
const MAX_SDK_WALK_FILES = 2_000;
const MAX_SDK_GREP_RESULTS = 200;
const MAX_SDK_GLOB_RESULTS = 1_000;
const MAX_SDK_GREP_LINE_CHARS = 180;
const DEFAULT_SDK_READ_LINE_LIMIT = 2_000;
const SDK_APPROVAL_CARD_TOOL_SET = new Set<string>(SDK_APPROVAL_CARD_TOOLS);
export type SdkToolMode = 'full' | 'read_only';

export interface SdkChatMessage {
  role: 'user' | 'assistant' | 'system' | 'tool';
  content: string | UserContent;
}

export interface SdkChatRunOptions {
  apiKey: string;
  model?: string | null;
  baseURL?: string | null;
  workspaceDir?: string | null;
  activeFile?: string | null;
  activeTerminalId?: string | null;
  activeTerminalCwd?: string | null;
  terminals?: SdkChatTerminalContext[];
  systemContext: string;
  messages: SdkChatMessage[];
  fetch?: typeof globalThis.fetch;
  modelOverride?: LanguageModel;
  onDelta?: (text: string) => void;
  onStep?: (step: string | null) => void;
  onArtifact?: (artifact: SdkChatArtifact) => void;
  onToolEvent?: (event: SdkChatToolEvent) => void;
  onTodos?: (event: SdkChatTodoEvent) => void;
  onCommand?: (event: SdkChatCommandEvent) => void;
  onUsage?: (delta: SdkChatUsageDelta) => void;
  onFinishMeta?: (meta: SdkChatFinishMeta) => void;
  abortSignal?: AbortSignal;
  requestTimeoutMs?: number | null;
  toolMode?: SdkToolMode;
}

export interface SdkChatArtifact {
  id: string;
  kind: 'patch' | 'directory' | 'preview' | 'terminal_stop';
  title: string;
  path: string;
  contentText: string;
}

export interface SdkChatToolEvent {
  toolName: 'list_directory' | 'read_file' | 'search_workspace' | 'grep' | 'glob' | 'get_terminal_output' | 'bash_list' | 'bash_logs' | 'bash_kill' | 'todo_write' | 'run_subagent' | 'suggest_command' | 'bash_run' | 'bash_background' | 'open_preview' | 'create_directory' | 'edit' | 'multi_edit' | 'write_file' | 'propose_patch';
  label: string;
  detail?: string;
  status: 'completed' | 'failed';
}

export interface SdkChatTodoItem {
  title: string;
  status: 'pending' | 'in_progress' | 'completed';
  description?: string;
}

export interface SdkChatTodoEvent {
  todos: SdkChatTodoItem[];
}

export interface SdkTodoWriteResult {
  ok: true;
  todos: SdkChatTodoItem[];
  total: number;
  completed: number;
  in_progress: number;
  pending: number;
  inProgressTitle: string | null;
  hint: string;
}

export interface SdkChatCommandEvent {
  command: string;
  reason?: string;
  cwd?: string;
  action?: 'insert' | 'run' | 'background';
}

export interface SdkCommandProposalResult extends Required<Pick<SdkChatCommandEvent, 'command' | 'action'>> {
  reason?: string;
  cwd?: string;
  approvalRequired: boolean;
  executed: boolean;
  hint: string;
}

export interface SdkPatchProposalResult {
  ok: true;
  path: string;
  artifactId: string;
  title: string;
  queued_for_review: true;
  applied: false;
  isNewFile: boolean;
  bytesProposed: number;
  hint: string;
}

export interface SdkActionProposalResult {
  ok: true;
  kind: 'directory' | 'preview' | 'terminal_stop';
  target: string;
  artifactId: string;
  title: string;
  queued_for_review: true;
  applied: false;
  hint: string;
}

export interface SdkChatTerminalContext {
  terminalId: string;
  title?: string | null;
  cwd?: string | null;
  cli?: string | null;
  initialCommand?: string | null;
  initialCommandShouldRun?: boolean | null;
  runtimeManaged?: boolean | null;
}

export interface SdkChatUsageDelta {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  lastInputTokens: number;
  lastCachedTokens: number;
}

export interface SdkTerminalLogResult {
  terminalId: string;
  output: string;
  next_offset: number;
  dropped: boolean;
  truncatedTo?: number;
  commandExitCode?: number | null;
  commandFinished?: boolean;
}

export interface SdkChatFinishMeta {
  hitStepCap: boolean;
  finishReason: string;
}

export interface SdkChatAttachmentContextItem {
  name: string;
  path?: string;
  kind?: 'file' | 'image';
  content?: string | null;
  error?: string | null;
}

export interface SdkChatImageAttachment {
  name: string;
  path?: string;
  mediaType?: string;
  base64?: string | null;
  error?: string | null;
}

export interface SdkAppActionResultContent {
  kind: 'command' | 'directory' | 'patch_review' | 'preview' | 'terminal_stop';
  status: 'started' | 'completed' | 'failed';
  target: string;
  cardId?: string;
  title?: string;
  command?: string;
  cwd?: string;
  action?: 'insert' | 'run' | 'background';
  terminalId?: string;
  error?: string;
}

interface SdkHttpBridgeResponse {
  status: number;
  statusText: string;
  headers: Array<[string, string]>;
  body: string;
}

interface SdkHttpBridgeRequest {
  method: string;
  url: string;
  headers: Array<[string, string]>;
  body: string | null;
}

interface SdkHttpStreamEvent {
  streamId: string;
  status?: number | null;
  statusText?: string | null;
  headers?: Array<[string, string]> | null;
  chunk?: number[] | null;
  done: boolean;
  error?: string | null;
}

interface SdkWorkspaceDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

interface SdkWorkspaceFileHit {
  path: string;
  rel: string;
}

interface SdkGrepHit {
  path: string;
  rel: string;
  line: number;
  text: string;
}

interface SdkProjectMemoryItem {
  name: string;
  content: string;
}

export function getStoredOpenAiApiKey(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('comet-ai.openai-api-key')?.trim() ?? '';
}

export function setStoredOpenAiApiKey(value: string): void {
  if (typeof window === 'undefined') return;
  const trimmed = value.trim();
  if (trimmed) window.localStorage.setItem('comet-ai.openai-api-key', trimmed);
  else window.localStorage.removeItem('comet-ai.openai-api-key');
}

export function notifyOpenAiSdkConfigChanged(): void {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent(OPENAI_SDK_CONFIG_CHANGED_EVENT));
}

export function getConfiguredOpenAiApiKey(): string {
  const viteKey = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_OPENAI_API_KEY?.trim();
  return getStoredOpenAiApiKey() || viteKey || '';
}

export function getStoredOpenAiBaseUrl(): string {
  if (typeof window === 'undefined') return '';
  return window.localStorage.getItem('comet-ai.openai-base-url')?.trim() ?? '';
}

export function setStoredOpenAiBaseUrl(value: string): void {
  if (typeof window === 'undefined') return;
  const normalized = normalizeOpenAiSdkBaseUrl(value) ?? '';
  if (normalized) window.localStorage.setItem('comet-ai.openai-base-url', normalized);
  else window.localStorage.removeItem('comet-ai.openai-base-url');
}

export function getConfiguredOpenAiBaseUrl(): string {
  const viteBaseUrl = (import.meta as ImportMeta & { env?: Record<string, string | undefined> }).env?.VITE_OPENAI_BASE_URL?.trim();
  return getStoredOpenAiBaseUrl() || viteBaseUrl || '';
}

export function normalizeOpenAiSdkBaseUrl(value: string | null | undefined): string | undefined {
  const trimmed = value?.trim();
  if (!trimmed) return undefined;
  let parsed: URL;
  try {
    parsed = new URL(trimmed);
  } catch {
    throw new Error('OpenAI SDK base URL must be a valid http(s) URL.');
  }
  if (parsed.protocol !== 'https:' && parsed.protocol !== 'http:') {
    throw new Error('OpenAI SDK base URL must use http or https.');
  }
  return trimmed.replace(/\/+$/g, '');
}

export function normalizeOpenAiSdkModel(model: string | null | undefined): string {
  const trimmed = typeof model === 'string' ? model.trim() : '';
  if (!trimmed) return DEFAULT_OPENAI_MODEL;
  const lower = trimmed.toLowerCase();
  const unprefixed = trimmed.replace(/^openai\//i, '');
  if (
    lower.startsWith('gpt-') ||
    /^o\d/.test(lower) ||
    lower.startsWith('chatgpt-') ||
    lower.startsWith('codex') ||
    lower.startsWith('openai/gpt-') ||
    /^openai\/o\d/i.test(lower)
  ) {
    return unprefixed;
  }
  return DEFAULT_OPENAI_MODEL;
}

function normalizeSdkPath(value: string): string {
  return value.trim().replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/g, '');
}

function isSdkAbsolutePath(value: string): boolean {
  return /^[a-zA-Z]:[\\/]/.test(value) || value.startsWith('\\\\') || value.startsWith('/');
}

function isSdkPathInsideRoot(path: string, root: string): boolean {
  const normalizedPath = normalizeSdkPath(path).toLocaleLowerCase();
  const normalizedRoot = normalizeSdkPath(root).toLocaleLowerCase();
  return normalizedPath === normalizedRoot || normalizedPath.startsWith(`${normalizedRoot}/`);
}

function hasSdkTraversal(path: string): boolean {
  return normalizeSdkPath(path).split('/').some(part => part === '..');
}

export function isSdkSensitivePath(path: string): boolean {
  const parts = normalizeSdkPath(path).toLocaleLowerCase().split('/').filter(Boolean);
  return parts.some(part =>
    part === '.env'
    || part.startsWith('.env.')
    || part === '.ssh'
    || part === '.gnupg'
    || part === '.aws'
    || part === '.azure'
    || part === '.gcloud'
    || part === 'credentials'
    || part === 'secrets'
    || /^id_(?:rsa|dsa|ecdsa|ed25519)$/.test(part)
    || /\.(?:pem|key|p12|pfx)$/.test(part)
  );
}

export function resolveSdkWorkspacePath(workspaceDir: string | null | undefined, path: string): string {
  return resolveSdkWorkspacePathFromBase(workspaceDir, path, workspaceDir);
}

export function resolveSdkWorkspacePathFromBase(
  workspaceDir: string | null | undefined,
  path: string,
  baseDir?: string | null,
): string {
  const trimmed = path.trim();
  if (!trimmed) throw new Error('Path is required.');
  if (hasSdkTraversal(trimmed)) throw new Error('Path traversal is not allowed.');
  if (isSdkSensitivePath(trimmed)) throw new Error('Sensitive paths are not available to SDK chat tools.');

  const root = workspaceDir?.trim();
  if (isSdkAbsolutePath(trimmed)) {
    if (root && !isSdkPathInsideRoot(trimmed, root)) {
      throw new Error(`Path is outside the workspace root: ${trimmed}`);
    }
    return trimmed;
  }
  const base = baseDir?.trim() || root;
  if (!base) return trimmed;
  if (root && !isSdkPathInsideRoot(base, root)) {
    throw new Error(`Base directory is outside the workspace root: ${base}`);
  }
  return `${base.replace(/[\\/]+$/g, '')}\\${trimmed.replace(/^[\\/]+/g, '')}`;
}

function toTextContent(content: string | UserContent): string {
  if (typeof content === 'string') return content;
  return content
    .filter(part => part.type === 'text')
    .map(part => part.text)
    .join('\n\n');
}

function prependSdkUserText(content: string | UserContent, prefix: string): UserContent {
  const cleanPrefix = prefix.trim();
  if (!cleanPrefix) return content as UserContent;
  if (typeof content === 'string') return `${cleanPrefix}\n\n${content}`;
  return [{ type: 'text', text: cleanPrefix }, ...content];
}

function toCoreMessages(messages: SdkChatMessage[], latestUserPrefix = ''): ModelMessage[] {
  const lastUserIndex = latestUserPrefix
    ? messages.reduce((lastIndex, message, index) => message.role === 'user' ? index : lastIndex, -1)
    : -1;
  return messages.flatMap((message): ModelMessage[] => {
    if (message.role === 'user') {
      const content = lastUserIndex >= 0 && messages[lastUserIndex] === message
        ? prependSdkUserText(message.content, latestUserPrefix)
        : message.content as UserContent;
      return [{ role: 'user' as const, content }];
    }
    if (message.role === 'assistant' || message.role === 'system') {
      return [{ role: message.role, content: toTextContent(message.content) }];
    }
    if (message.role === 'tool') {
      return [{ role: 'user' as const, content: `Tool/action result from the app:\n${toTextContent(message.content)}` }];
    }
    return [];
  });
}

function sdkOutputNeedsUserApproval(output: unknown): boolean {
  return Boolean(
    output &&
    typeof output === 'object' &&
    (
      (output as { approvalRequired?: unknown }).approvalRequired === true ||
      (output as { queued_for_review?: unknown }).queued_for_review === true
    )
  );
}

function formatSdkStreamError(error: unknown): string {
  if (error instanceof Error && error.message.trim()) return error.message;
  if (typeof error === 'string' && error.trim()) return error;
  try {
    return JSON.stringify(error);
  } catch {
    return String(error);
  }
}

export function sdkApprovalCardIsPending({ steps }: { steps: Array<{ toolResults?: Array<{ toolName: string; output: unknown }> }> }): boolean {
  const lastStep = steps[steps.length - 1];
  return lastStep?.toolResults?.some(result =>
    SDK_APPROVAL_CARD_TOOL_SET.has(result.toolName) &&
    sdkOutputNeedsUserApproval(result.output)
  ) ?? false;
}

export async function runSdkChat(options: SdkChatRunOptions): Promise<string> {
  const modelId = normalizeOpenAiSdkModel(options.model);
  const openai = createOpenAI({
    apiKey: options.apiKey,
    baseURL: normalizeOpenAiSdkBaseUrl(options.baseURL),
    fetch: options.fetch ?? tauriBackedOpenAiFetch,
  });
  const model = options.modelOverride ?? openai(modelId);
  const abortScope = createSdkAbortScope(options.abortSignal, options.requestTimeoutMs ?? SDK_REQUEST_TIMEOUT_MS);
  const environmentContext = formatSdkEnvironmentContext({
    workspaceDir: options.workspaceDir,
    activeFile: options.activeFile,
    activeTerminalId: options.activeTerminalId,
    activeTerminalCwd: options.activeTerminalCwd,
  });

  let stepsSeen = 0;
  let streamError: Error | null = null;
  options.onStep?.('Contacting OpenAI');
  const result = streamText({
    model,
    system: await buildSystemPrompt(options),
    messages: toCoreMessages(options.messages, environmentContext),
    stopWhen: [
      stepCountIs(SDK_MAX_AGENT_STEPS),
      sdkApprovalCardIsPending,
    ],
    abortSignal: abortScope.signal,
    tools: buildWorkspaceTools(options, options.toolMode === 'read_only' ? 'read_only' : 'full'),
    onStepFinish: step => {
      stepsSeen += 1;
      const lastTool = step.toolCalls?.[step.toolCalls.length - 1];
      if (lastTool) {
        options.onStep?.(`Using ${lastTool.toolName}`);
      } else if (step.text) {
        options.onStep?.('Writing');
      }
      const usage = step.usage;
      if (usage) {
        const inputTokens = usage.inputTokens ?? 0;
        const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
        options.onUsage?.({
          inputTokens,
          outputTokens: usage.outputTokens ?? 0,
          cachedInputTokens,
          lastInputTokens: inputTokens,
          lastCachedTokens: cachedInputTokens,
        });
      }
    },
    onError: ({ error }) => {
      streamError = new Error(formatSdkStreamError(error) || 'OpenAI SDK stream failed.');
    },
  });

  let text = '';
  try {
    for await (const delta of result.textStream) {
      text += delta;
      options.onDelta?.(delta);
    }
    let finishReason = '';
    try {
      finishReason = await result.finishReason;
    } catch {
      finishReason = '';
    }
    if (streamError) {
      throw streamError;
    }
    options.onFinishMeta?.({
      hitStepCap: stepsSeen >= SDK_MAX_AGENT_STEPS,
      finishReason,
    });
  } catch (error) {
    if (abortScope.timedOut()) {
      throw new Error(`OpenAI SDK chat timed out after ${Math.round((options.requestTimeoutMs ?? SDK_REQUEST_TIMEOUT_MS) / 1000)}s without completing.`);
    }
    throw error;
  } finally {
    abortScope.dispose();
    options.onStep?.(null);
  }
  return text;
}

export function createSdkAbortScope(
  parentSignal?: AbortSignal,
  timeoutMs: number | null = SDK_REQUEST_TIMEOUT_MS,
): { signal?: AbortSignal; dispose: () => void; timedOut: () => boolean } {
  const normalizedTimeout = typeof timeoutMs === 'number' && Number.isFinite(timeoutMs) && timeoutMs > 0
    ? timeoutMs
    : null;
  if (!parentSignal && !normalizedTimeout) {
    return { signal: undefined, dispose: () => {}, timedOut: () => false };
  }

  const controller = new AbortController();
  let timedOut = false;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const abortFromParent = () => controller.abort(parentSignal?.reason);

  if (parentSignal?.aborted) {
    abortFromParent();
  } else if (parentSignal) {
    parentSignal.addEventListener('abort', abortFromParent, { once: true });
  }

  if (normalizedTimeout) {
    timer = setTimeout(() => {
      timedOut = true;
      controller.abort(new Error('OpenAI SDK chat timed out.'));
    }, normalizedTimeout);
  }

  return {
    signal: controller.signal,
    dispose: () => {
      if (timer) clearTimeout(timer);
      if (parentSignal) parentSignal.removeEventListener('abort', abortFromParent);
    },
    timedOut: () => timedOut,
  };
}

type SdkHttpBridgeInvoke = (request: SdkHttpBridgeRequest) => Promise<SdkHttpBridgeResponse>;
type SdkHttpStreamBridgeInvoke = (request: SdkHttpBridgeRequest, signal: AbortSignal) => Promise<Response>;

function abortError(signal: AbortSignal): DOMException {
  return signal.reason instanceof DOMException
    ? signal.reason
    : new DOMException('The operation was aborted.', 'AbortError');
}

async function bridgeInvokeWithAbort(
  bridgeInvoke: SdkHttpBridgeInvoke,
  request: SdkHttpBridgeRequest,
  signal: AbortSignal,
): Promise<SdkHttpBridgeResponse> {
  if (signal.aborted) {
    throw abortError(signal);
  }

  let abortListener: (() => void) | null = null;
  try {
    return await Promise.race([
      bridgeInvoke(request),
      new Promise<SdkHttpBridgeResponse>((_, reject) => {
        abortListener = () => reject(abortError(signal));
        signal.addEventListener('abort', abortListener, { once: true });
      }),
    ]);
  } finally {
    if (abortListener) signal.removeEventListener('abort', abortListener);
  }
}

export function createOpenAiSdkFetch(
  primaryFetch: typeof globalThis.fetch,
  bridgeInvoke: SdkHttpBridgeInvoke,
  streamBridgeInvoke?: SdkHttpStreamBridgeInvoke,
): typeof globalThis.fetch {
  return async (input: RequestInfo | URL, init?: RequestInit): Promise<Response> => {
    const request = new Request(input, init);
    const fallbackBody = request.method === 'GET' || request.method === 'HEAD'
      ? Promise.resolve<string | null>(null)
      : request.clone().text();

    try {
      return await primaryFetch(request);
    } catch (error) {
      if (request.signal.aborted) {
        throw abortError(request.signal);
      }
      if (error instanceof DOMException && error.name === 'AbortError') {
        throw error;
      }
      if (!request.url.startsWith('https://api.openai.com/')) {
        throw error;
      }
    }

    const body = await fallbackBody;
    const bridgeRequest = {
      method: request.method,
      url: request.url,
      headers: Array.from(request.headers.entries()),
      body,
    };
    if (streamBridgeInvoke) {
      try {
        return await streamBridgeInvoke(bridgeRequest, request.signal);
      } catch (error) {
        if (request.signal.aborted || (error instanceof DOMException && error.name === 'AbortError')) {
          throw error;
        }
      }
    }
    const response = request.signal
      ? await bridgeInvokeWithAbort(bridgeInvoke, bridgeRequest, request.signal)
      : await bridgeInvoke(bridgeRequest);

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: response.headers,
    });
  };
}

function createTauriSdkStreamResponse(request: SdkHttpBridgeRequest, signal: AbortSignal): Promise<Response> {
  const streamId = `sdk-stream-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
  let settled = false;
  let unlisten: (() => void) | null = null;
  let abortListener: (() => void) | null = null;
  let controllerRef: ReadableStreamDefaultController<Uint8Array> | null = null;

  const cleanup = () => {
    if (unlisten) {
      unlisten();
      unlisten = null;
    }
    if (abortListener) {
      signal.removeEventListener('abort', abortListener);
      abortListener = null;
    }
  };

  const body = new ReadableStream<Uint8Array>({
    start(controller) {
      controllerRef = controller;
    },
    cancel() {
      cleanup();
    },
  });

  return new Promise<Response>((resolve, reject) => {
    const fail = (error: unknown) => {
      const normalized = error instanceof Error ? error : new Error(String(error));
      if (!settled) {
        settled = true;
        cleanup();
        reject(normalized);
        return;
      }
      controllerRef?.error(normalized);
      cleanup();
    };

    if (signal.aborted) {
      fail(abortError(signal));
      return;
    }

    abortListener = () => fail(abortError(signal));
    signal.addEventListener('abort', abortListener, { once: true });

    listen<SdkHttpStreamEvent>('sdk-http-stream', event => {
      const payload = event.payload;
      if (!payload || payload.streamId !== streamId) return;
      if (payload.error) {
        fail(new Error(payload.error));
        return;
      }
      if (typeof payload.status === 'number' && !settled) {
        settled = true;
        resolve(new Response(body, {
          status: payload.status,
          statusText: payload.statusText ?? '',
          headers: payload.headers ?? [],
        }));
      }
      if (payload.chunk && payload.chunk.length > 0) {
        controllerRef?.enqueue(new Uint8Array(payload.chunk));
      }
      if (payload.done) {
        controllerRef?.close();
        cleanup();
      }
    }).then(fn => {
      unlisten = fn;
      return invoke<void>('sdk_http_stream', { request, streamId });
    }).catch(fail);
  });
}

const tauriBackedOpenAiFetch = createOpenAiSdkFetch(
  globalThis.fetch.bind(globalThis),
  request => invoke<SdkHttpBridgeResponse>('sdk_http_request', { request }),
  createTauriSdkStreamResponse,
);

async function readProjectMemory(workspaceDir: string | null | undefined): Promise<string | null> {
  if (!workspaceDir?.trim()) return null;
  const memoryItems: SdkProjectMemoryItem[] = [];
  for (const name of ['TERAX.md', 'AGENTS.md']) {
    const memoryPath = resolveSdkWorkspacePath(workspaceDir, name);
    try {
      const content = await invoke<string>('workspace_read_text_file', { path: memoryPath });
      const capped = content.length > MAX_PROJECT_MEMORY_BYTES
        ? `${content.slice(0, MAX_PROJECT_MEMORY_BYTES)}\n\n[truncated at ${MAX_PROJECT_MEMORY_BYTES} chars]`
        : content;
      memoryItems.push({ name, content: capped });
    } catch {
      // Project memory is optional. Missing files should never block chat.
    }
  }
  return formatSdkProjectMemoryContext(memoryItems);
}

export async function readSdkWorkspaceTextFile(
  path: string,
  diskRead: (path: string) => Promise<string>,
): Promise<{ content: string; source: 'editor' | 'disk' }> {
  const dirtyContent = getCachedDirtyEditorContent(path);
  if (dirtyContent !== undefined) {
    return { content: dirtyContent, source: 'editor' };
  }
  return { content: await diskRead(path), source: 'disk' };
}

export function formatSdkDirtyEditorContext(paths: string[], activeFile?: string | null): string {
  const cleanPaths = paths.map(path => path.trim()).filter(Boolean);
  if (cleanPaths.length === 0) return '';
  const active = activeFile?.trim().replace(/\\/g, '/').toLocaleLowerCase();
  const lines = cleanPaths.slice(0, 20).map(path => {
    const normalized = path.replace(/\\/g, '/').toLocaleLowerCase();
    return `- ${path}${active && normalized === active ? ' (active file)' : ''}`;
  });
  const truncated = cleanPaths.length > lines.length ? `\n- ...and ${cleanPaths.length - lines.length} more` : '';
  return [
    'Unsaved editor buffers are open. Treat these as newer than disk content; read_file will return the unsaved buffer when available.',
    `${lines.join('\n')}${truncated}`,
  ].join('\n');
}

export function formatSdkProjectMemoryContext(items: SdkProjectMemoryItem[]): string | null {
  const sections = items
    .map(item => ({
      name: item.name.trim(),
      content: item.content.trim(),
    }))
    .filter(item => item.name && item.content)
    .map(item => `## PROJECT - ${item.name}\n${item.content}`);

  return sections.length > 0
    ? `Project memory:\n\n${sections.join('\n\n')}`
    : null;
}

export function formatSdkOperatingInstructions(): string {
  const approvalCardTools = SDK_APPROVAL_CARD_TOOLS.join(', ');
  return [
    '# Operating principles',
    '- Execute, do not echo. When the user asks you to create, write, fix, or edit something, go straight to the appropriate tool call. The approval card is the confirmation; do not print proposed file content in chat first.',
    '- Chain actions until done. A real task is usually read context, understand, propose the change, and verify. Do not stop after a single read to summarize and wait.',
    '- Ask only when genuinely stuck. Ask one short question only when scope is ambiguous and a wrong guess would be costly to undo. For low-cost reversible defaults, pick one and proceed.',
    '- Investigate before guessing. If you do not know where something lives, use grep or glob instead of speculating.',
    `- Approval cards are stop points. After using a tool that shows a user-action card (${approvalCardTools}), do not continue as if the action happened. Give at most one short note, then wait for an Action result from the app. The app will automatically resume you when the user approves, runs, applies, opens, or denies the card.`,
    '- Treat app action results as evidence. If a prior Action result says a command started, do not assume success; use bash_logs on its Terminal ID before judging the result or continuing from its output. For short-lived run commands, bash_logs returns commandFinished and commandExitCode when it sees __COMET_COMMAND_EXIT:<code>.',
    '- If a prior Action result says patch_review started, the review pane was only opened. Do not claim files changed until a later patch_review completed result appears; if it failed, report the failure and adjust.',
    '- Match scope to the request. Keep fixes tight and avoid unrelated cleanup.',
    '- Before five or more tool calls in a row, use todo_write so the user can see the trajectory. todo_write replaces the full visible list; pass the full list each time, and keep at most one item in_progress.',
    '- Output terse final notes: one or two sentences with what changed and what remains, without recapping the whole diff.',
  ].join('\n');
}

export function formatSdkTerminalLogResult(options: {
  terminalId: string;
  output: string;
  nextOffset: number;
  dropped?: boolean;
  truncatedTo?: number;
}): SdkTerminalLogResult {
  const commandExitCode = extractSdkCommandExitCode(options.output);
  return {
    terminalId: options.terminalId,
    output: options.output,
    next_offset: Math.max(0, options.nextOffset),
    dropped: options.dropped === true,
    truncatedTo: options.truncatedTo,
    commandExitCode,
    commandFinished: commandExitCode !== null,
  };
}

export function extractSdkCommandExitCode(output: string): number | null {
  const pattern = new RegExp(`${SDK_COMMAND_EXIT_MARKER.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')}:(\\d+)`, 'g');
  let match: RegExpExecArray | null;
  let latest: number | null = null;
  while ((match = pattern.exec(output)) !== null) {
    latest = Number(match[1]);
  }
  return latest;
}

export function formatSdkTodoWriteResult(todos: SdkChatTodoItem[]): SdkTodoWriteResult {
  const normalized = normalizeSdkTodoItems(todos);
  const inProgress = normalized.filter(todo => todo.status === 'in_progress');
  return {
    ok: true,
    todos: normalized,
    total: normalized.length,
    completed: normalized.filter(todo => todo.status === 'completed').length,
    in_progress: inProgress.length,
    pending: normalized.filter(todo => todo.status === 'pending').length,
    inProgressTitle: inProgress[0]?.title ?? null,
    hint: 'The visible agent to-do list has been updated. Keep it current as work progresses.',
  };
}

export function validateSdkTodoItems(todos: SdkChatTodoItem[]): string | null {
  const inProgress = todos.filter(todo => todo.status === 'in_progress').length;
  return inProgress > 1
    ? `only one todo may be in_progress at a time (got ${inProgress})`
    : null;
}

function terminalChunksDropped(chunks: PtyChunk[], sinceOffset: number | undefined): boolean {
  return typeof sinceOffset === 'number'
    && sinceOffset > 0
    && chunks.length > 0
    && chunks[0].seq > sinceOffset + 1;
}

async function readSdkTerminalLogs(
  terminalId: string,
  maxBytes: number,
  sinceOffset?: number,
): Promise<SdkTerminalLogResult> {
  await terminalOutputBus.start().catch(() => undefined);
  if (typeof sinceOffset === 'number') {
    const chunks = terminalOutputBus.getChunksSince(terminalId, sinceOffset);
    const output = chunks.map(chunk => chunk.text).join('');
    return formatSdkTerminalLogResult({
      terminalId,
      output: output.length > maxBytes ? output.slice(output.length - maxBytes) : output,
      nextOffset: terminalOutputBus.getSequence(terminalId),
      dropped: terminalChunksDropped(chunks, sinceOffset),
      truncatedTo: maxBytes,
    });
  }

  const buffered = terminalOutputBus.getTail(terminalId, maxBytes);
  if (buffered) {
    return formatSdkTerminalLogResult({
      terminalId,
      output: buffered,
      nextOffset: terminalOutputBus.getSequence(terminalId),
      dropped: false,
      truncatedTo: maxBytes,
    });
  }

  const output = await invoke<string>('get_pty_recent_output', { id: terminalId, maxBytes });
  return formatSdkTerminalLogResult({
    terminalId,
    output,
    nextOffset: terminalOutputBus.getSequence(terminalId),
    dropped: false,
    truncatedTo: maxBytes,
  });
}

async function buildSystemPrompt(options: SdkChatRunOptions): Promise<string> {
  const projectMemory = await readProjectMemory(options.workspaceDir);
  const dirtyEditorContext = formatSdkDirtyEditorContext(listCachedDirtyEditorPaths(), options.activeFile);
  return [
    'You are the Comet-AI workspace agent running inside a local Tauri coding workspace.',
    'Help the user with the active workspace. Be concise, practical, and use tools when reading project files would improve the answer.',
    formatSdkOperatingInstructions(),
    'Use todo_write to show progress for multi-step work, and keep it current as steps complete.',
    'Use run_subagent for self-contained read-only investigations such as broad code search, focused review, or security review. Subagents cannot edit files or run commands.',
    'Use suggest_command when the answer is a single shell command the user may want inserted into a terminal without running.',
    'Use bash_run for short-lived verification commands such as tests, builds, or searches. It creates an explicit user-run command card; never use it for dev servers, watchers, or interactive programs.',
    'Use bash_list before proposing a dev server, watcher, or log tailer. If a matching terminal is already running, use bash_logs and open_preview instead of proposing a duplicate command.',
    'Use bash_logs to inspect recent output from a known terminal. Use bash_kill only when a specific terminal should be stopped; it creates an explicit user-approved stop card and does not stop anything by itself.',
    'Use bash_background for long-running commands such as dev servers, watchers, or log tailers. It creates an explicit user-run terminal card and does not execute until clicked.',
    'Use open_preview only for localhost, loopback, or private LAN web URLs such as local dev servers. For external docs or websites, paste the URL in text instead of calling open_preview. The preview card opens only after the user clicks it.',
    'Use grep for content search and glob for recursive file discovery. Use list_directory for immediate children only.',
    'Relative file paths resolve against active_terminal_cwd when it is available, otherwise workspace_root.',
    '"create X" with no path should resolve to active_terminal_cwd when available, otherwise workspace_root. For "edit this file" with no path, use active_file when present.',
    'If read_file returns unchanged=true, reuse the prior read_file content from this chat instead of reading again.',
    'Workspace file tools are scoped to the workspace root and refuse obvious secret paths such as .env files, key files, credentials, and SSH/cloud config folders.',
    'For file changes, read the target file first, then prefer edit or multi_edit for exact replacements. Use write_file only for new files or complete rewrites. These tools propose patches for the review pane; do not claim edits are applied until the user applies them.',
    'Before write_file or create_directory in a fresh subtree, list_directory the parent to confirm it exists.',
    'Use create_directory when a task needs a new folder. It proposes a user-approved directory creation card; do not claim the directory exists until the user applies it.',
    projectMemory,
    dirtyEditorContext,
    options.systemContext,
  ].filter(Boolean).join('\n\n');
}

export function formatSdkEnvironmentContext(options: {
  workspaceDir?: string | null;
  activeFile?: string | null;
  activeTerminalId?: string | null;
  activeTerminalCwd?: string | null;
}): string {
  const activeTerminalId = normalizeTerminalId(options.activeTerminalId);
  const lines = [
    options.workspaceDir?.trim() ? `workspace_root: ${options.workspaceDir.trim()}` : '',
    options.activeTerminalCwd?.trim() ? `active_terminal_cwd: ${options.activeTerminalCwd.trim()}` : '',
    options.activeFile?.trim() ? `active_file: ${options.activeFile.trim()}` : '',
    activeTerminalId ? `active_terminal_id: ${activeTerminalId}` : '',
  ].filter(Boolean);
  return lines.length ? `<env>\n${lines.join('\n')}\n</env>` : '';
}

export function normalizeSdkTerminalContexts(
  terminals: SdkChatTerminalContext[] | null | undefined,
  activeTerminalId?: string | null,
  activeTerminalCwd?: string | null,
): SdkChatTerminalContext[] {
  const byId = new Map<string, SdkChatTerminalContext>();
  for (const terminal of terminals ?? []) {
    const terminalId = normalizeTerminalId(terminal.terminalId);
    if (!terminalId || byId.has(terminalId)) continue;
    byId.set(terminalId, {
      terminalId,
      title: terminal.title?.trim() || undefined,
      cwd: terminal.cwd?.trim() || undefined,
      cli: terminal.cli?.trim() || undefined,
      initialCommand: terminal.initialCommand?.trim() || undefined,
      initialCommandShouldRun: terminal.initialCommandShouldRun === true,
      runtimeManaged: terminal.runtimeManaged === true,
    });
  }
  const active = normalizeTerminalId(activeTerminalId);
  if (active && !byId.has(active)) {
    byId.set(active, {
      terminalId: active,
      title: 'Active terminal',
      cwd: activeTerminalCwd?.trim() || undefined,
      initialCommandShouldRun: false,
      runtimeManaged: false,
    });
  }
  return [...byId.values()];
}

function buildWorkspaceTools(
  options: Pick<SdkChatRunOptions, 'apiKey' | 'model' | 'baseURL' | 'fetch' | 'workspaceDir' | 'activeTerminalId' | 'activeTerminalCwd' | 'terminals' | 'onStep' | 'onArtifact' | 'onToolEvent' | 'onTodos' | 'onCommand' | 'onUsage'>,
  mode: SdkToolMode = 'full',
): ToolSet {
  const readCache = new Map<string, SdkReadCacheEntry>();
  const readPaths = new Set<string>();
  const resolveToolPath = (path: string): string => resolveSdkWorkspacePathFromBase(options.workspaceDir, path, options.activeTerminalCwd || options.workspaceDir);

  const publishPatch = async (
    toolName: SdkChatToolEvent['toolName'],
    label: string,
    path: string,
    fullPath: string,
    newContent: string,
    rationale?: string,
    requireExisting = false,
  ) => {
    let oldContent = '';
    let isNewFile = false;
    try {
      const read = await readSdkWorkspaceTextFile(fullPath, path => invoke<string>('workspace_read_text_file', { path }));
      oldContent = read.content;
    } catch (error) {
      if (requireExisting) throw error;
      isNewFile = true;
    }
    const patch = createUnifiedDiff(path, oldContent, newContent, isNewFile);
    const artifact: SdkChatArtifact = {
      id: `sdk-patch-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      kind: 'patch',
      title: rationale?.trim() ? `Patch: ${rationale.trim()}` : `Patch: ${path}`,
      path: fullPath,
      contentText: patch,
    };
    options.onArtifact?.(artifact);
    options.onToolEvent?.({
      toolName,
      label,
      detail: path,
      status: 'completed',
    });
    return formatSdkPatchProposalResultForModel(artifact, {
      isNewFile,
      bytesProposed: newContent.length,
    });
  };

  const tools = {
    list_directory: tool({
      description: 'List files and folders in a workspace directory.',
      inputSchema: z.object({
        path: z.string().describe('Directory path, absolute or relative to the workspace root.'),
      }),
      execute: async ({ path }) => {
        const fullPath = resolveToolPath(path);
        options.onStep?.(`Listing ${path}`);
        try {
          const entries = await invoke<Array<{ name: string; isDirectory: boolean; isFile: boolean }>>('workspace_read_dir', { path: fullPath });
          options.onToolEvent?.({
            toolName: 'list_directory',
            label: 'Listed directory',
            detail: `${path} (${entries.length} entries)`,
            status: 'completed',
          });
          return entries.map(entry => `${entry.isDirectory ? 'dir ' : 'file'} ${entry.name}`).join('\n');
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'list_directory',
            label: 'List directory failed',
            detail: `${path}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    read_file: tool({
      description: 'Read a text file from the workspace. Defaults to a windowed read. Use offset and limit for large files.',
      inputSchema: z.object({
        path: z.string().describe('File path, absolute or relative to the workspace root.'),
        offset: z.number().int().min(0).optional().describe('0-based start line. Default 0.'),
        limit: z.number().int().min(1).max(10_000).optional().describe('Maximum lines to return. Default 2000.'),
      }),
      execute: async ({ path, offset, limit }) => {
        const fullPath = resolveToolPath(path);
        options.onStep?.(`Reading ${path}`);
        try {
          const read = await readSdkWorkspaceTextFile(fullPath, path => invoke<string>('workspace_read_text_file', { path }));
          const window = createSdkReadWindow(read.content, { offset, limit });
          const result = createSdkReadFileResult({
            path: fullPath,
            source: read.source,
            content: read.content,
            window,
            cache: readCache,
            cacheKey: fullPath,
            offset,
            limit,
          });
          readPaths.add(fullPath);
          options.onToolEvent?.({
            toolName: 'read_file',
            label: 'Read file',
            detail: 'unchanged' in result
              ? `${path} (unchanged)`
              : `${path} (${window.content.length}/${read.content.length} chars${read.source === 'editor' ? ', unsaved editor buffer' : ''})`,
            status: 'completed',
          });
          return result;
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'read_file',
            label: 'Read file failed',
            detail: `${path}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    edit: tool({
      description: 'Replace an exact string in a text file and propose the result as a reviewable patch. Requires read_file on the same path first.',
      inputSchema: z.object({
        path: z.string().describe('File path, absolute or relative to the workspace root.'),
        old_string: z.string().min(1).describe('Exact substring to replace. Must be unique unless replace_all is true.'),
        new_string: z.string().describe('Replacement substring.'),
        replace_all: z.boolean().optional(),
        rationale: z.string().optional().describe('Short reason for the change.'),
      }),
      execute: async ({ path, old_string, new_string, replace_all, rationale }) => {
        const fullPath = resolveToolPath(path);
        options.onStep?.(`Editing ${path}`);
        try {
          if (!readPaths.has(fullPath)) {
            return `Cannot edit ${path}: call read_file on this path first so the edit is grounded in current file content.`;
          }
          const read = await readSdkWorkspaceTextFile(fullPath, path => invoke<string>('workspace_read_text_file', { path }));
          const oldContent = read.content;
          const editResult = applyExactEdits(oldContent, [{ oldString: old_string, newString: new_string, replaceAll: replace_all }]);
          if (!editResult.ok) {
            options.onToolEvent?.({
              toolName: 'edit',
              label: 'Edit failed',
              detail: `${path}: ${editResult.error}`,
              status: 'failed',
            });
            return `Cannot edit ${path}: ${editResult.error}`;
          }
          return publishPatch('edit', 'Proposed edit', path, fullPath, editResult.content, rationale, true);
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'edit',
            label: 'Edit failed',
            detail: `${path}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    multi_edit: tool({
      description: 'Apply several exact-string replacements to one text file and propose the result as a reviewable patch. Requires read_file on the same path first.',
      inputSchema: z.object({
        path: z.string().describe('File path, absolute or relative to the workspace root.'),
        edits: z.array(z.object({
          old_string: z.string().min(1),
          new_string: z.string(),
          replace_all: z.boolean().optional(),
        })).min(1),
        rationale: z.string().optional().describe('Short reason for the change.'),
      }),
      execute: async ({ path, edits, rationale }) => {
        const fullPath = resolveToolPath(path);
        options.onStep?.(`Editing ${path}`);
        try {
          if (!readPaths.has(fullPath)) {
            return `Cannot edit ${path}: call read_file on this path first so the edit is grounded in current file content.`;
          }
          const read = await readSdkWorkspaceTextFile(fullPath, path => invoke<string>('workspace_read_text_file', { path }));
          const oldContent = read.content;
          const editResult = applyExactEdits(oldContent, edits.map(edit => ({
            oldString: edit.old_string,
            newString: edit.new_string,
            replaceAll: edit.replace_all,
          })));
          if (!editResult.ok) {
            options.onToolEvent?.({
              toolName: 'multi_edit',
              label: 'Edit failed',
              detail: `${path}: ${editResult.error}`,
              status: 'failed',
            });
            return `Cannot edit ${path}: ${editResult.error}`;
          }
          return publishPatch('multi_edit', 'Proposed edits', path, fullPath, editResult.content, rationale, true);
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'multi_edit',
            label: 'Edit failed',
            detail: `${path}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    write_file: tool({
      description: 'Propose complete text content for a file as a reviewable patch. This does not write the file until the user applies it.',
      inputSchema: z.object({
        path: z.string().describe('File path, absolute or relative to the workspace root.'),
        content: z.string().describe('Complete desired file content.'),
        rationale: z.string().optional().describe('Short reason for the change.'),
      }),
      execute: async ({ path, content, rationale }) => {
        const fullPath = resolveToolPath(path);
        options.onStep?.(`Writing ${path}`);
        try {
          return publishPatch('write_file', 'Proposed file write', path, fullPath, content, rationale);
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'write_file',
            label: 'Write proposal failed',
            detail: `${path}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    todo_write: tool({
      description: 'Update the visible agent to-do list. Use this for multi-step work so the user can see progress.',
      inputSchema: z.object({
        todos: z.array(z.object({
          title: z.string().min(1),
          status: z.enum(['pending', 'in_progress', 'completed']),
          description: z.string().optional(),
        })).min(1),
      }),
      execute: async ({ todos }) => {
        const normalized = normalizeSdkTodoItems(todos);
        const validation = validateSdkTodoItems(normalized);
        if (validation) return { error: validation };
        options.onStep?.('Updating plan');
        options.onTodos?.({ todos: normalized });
        options.onToolEvent?.({
          toolName: 'todo_write',
          label: 'Updated plan',
          detail: `${normalized.filter(todo => todo.status === 'completed').length}/${normalized.length} completed`,
          status: 'completed',
        });
        return formatSdkTodoWriteResult(normalized);
      },
    }),
    run_subagent: tool({
      description: 'Run an isolated read-only subagent for a self-contained investigation. It can read/search files but cannot edit files, run commands, or spawn more agents.',
      inputSchema: z.object({
        type: z.enum(['explore', 'review', 'security', 'research']).optional().describe('Kind of read-only subagent to run.'),
        prompt: z.string().min(1).describe('Self-contained instruction. Include relevant files, scope, and what evidence to return.'),
      }),
      execute: async ({ type, prompt }) => {
        const subagentType = type || 'research';
        const startedAt = Date.now();
        options.onStep?.(`Spawning ${subagentType} subagent`);
        try {
          const openai = createOpenAI({
            apiKey: options.apiKey,
            baseURL: normalizeOpenAiSdkBaseUrl(options.baseURL),
            fetch: options.fetch ?? tauriBackedOpenAiFetch,
          });
          let stepsSeen = 0;
          const result = await generateText({
            model: openai(normalizeOpenAiSdkModel(options.model)),
            system: sdkSubagentSystemPrompt(subagentType),
            prompt,
            tools: pickSdkReadOnlyTools(buildWorkspaceTools(options, 'read_only')),
            stopWhen: stepCountIs(SDK_SUBAGENT_MAX_STEPS),
            onStepFinish: step => {
              stepsSeen += 1;
              const lastTool = step.toolCalls?.[step.toolCalls.length - 1];
              if (lastTool) options.onStep?.(`${subagentType}: ${lastTool.toolName}`);
              const usage = step.usage;
              if (usage) {
                const inputTokens = usage.inputTokens ?? 0;
                const cachedInputTokens = usage.inputTokenDetails?.cacheReadTokens ?? 0;
                options.onUsage?.({
                  inputTokens,
                  outputTokens: usage.outputTokens ?? 0,
                  cachedInputTokens,
                  lastInputTokens: inputTokens,
                  lastCachedTokens: cachedInputTokens,
                });
              }
            },
          });
          options.onToolEvent?.({
            toolName: 'run_subagent',
            label: 'Ran subagent',
            detail: `${subagentType} (${stepsSeen} steps)`,
            status: 'completed',
          });
          return {
            type: subagentType,
            summary: result.text || '(No subagent summary returned.)',
            stepCount: stepsSeen,
            hitStepCap: stepsSeen >= SDK_SUBAGENT_MAX_STEPS,
            durationMs: Date.now() - startedAt,
          };
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'run_subagent',
            label: 'Subagent failed',
            detail: error instanceof Error ? error.message : String(error),
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    suggest_command: tool({
      description: 'Suggest a single terminal command for the user to insert. This never executes the command.',
      inputSchema: z.object({
        command: z.string().min(1).describe('The exact command to suggest.'),
        reason: z.string().optional().describe('Brief reason this command is useful.'),
        cwd: z.string().optional().describe('Optional working directory for the command.'),
      }),
      execute: async ({ command, reason, cwd }) => {
        const validation = validateSdkShellCommand(command);
        if (validation) {
          options.onToolEvent?.({
            toolName: 'suggest_command',
            label: 'Command suggestion rejected',
            detail: validation,
            status: 'failed',
          });
          return { error: validation };
        }
        const normalized = normalizeSdkCommandSuggestion({ command, reason, cwd, action: 'insert' });
        options.onStep?.('Suggesting command');
        options.onCommand?.(normalized);
        options.onToolEvent?.({
          toolName: 'suggest_command',
          label: 'Suggested command',
          detail: normalized.command,
          status: 'completed',
        });
        return formatSdkCommandProposalResult(normalized);
      },
    }),
    bash_run: tool({
      description: 'Propose running one short-lived shell command in a terminal. This does not execute until the user clicks Run.',
      inputSchema: z.object({
        command: z.string().min(1).describe('The exact single-line command to run.'),
        reason: z.string().optional().describe('Brief reason this command should run.'),
        cwd: z.string().optional().describe('Optional working directory for the command. Defaults to the workspace root.'),
      }),
      execute: async ({ command, reason, cwd }) => {
        const validation = validateSdkShellCommand(command);
        if (validation) {
          options.onToolEvent?.({
            toolName: 'bash_run',
            label: 'Command proposal rejected',
            detail: validation,
            status: 'failed',
          });
          return { error: validation };
        }
        const normalized = normalizeSdkCommandSuggestion({
          command,
          reason,
          cwd: cwd || options.workspaceDir || undefined,
          action: 'run',
        });
        options.onStep?.('Proposing command');
        options.onCommand?.(normalized);
        options.onToolEvent?.({
          toolName: 'bash_run',
          label: 'Proposed command',
          detail: normalized.command,
          status: 'completed',
        });
        return formatSdkCommandProposalResult(normalized);
      },
    }),
    bash_background: tool({
      description: 'Propose running one long-lived background command such as a dev server, watcher, or log tailer. This does not execute until the user clicks Run.',
      inputSchema: z.object({
        command: z.string().min(1).describe('The exact single-line long-running command to start.'),
        reason: z.string().optional().describe('Brief reason this background command is useful.'),
        cwd: z.string().optional().describe('Optional working directory for the command. Defaults to the workspace root.'),
      }),
      execute: async ({ command, reason, cwd }) => {
        const validation = validateSdkShellCommand(command, { allowLongRunning: true });
        if (validation) {
          options.onToolEvent?.({
            toolName: 'bash_background',
            label: 'Background command rejected',
            detail: validation,
            status: 'failed',
          });
          return { error: validation };
        }
        const normalized = normalizeSdkCommandSuggestion({
          command,
          reason,
          cwd: cwd || options.workspaceDir || undefined,
          action: 'background',
        });
        options.onStep?.('Proposing background command');
        options.onCommand?.(normalized);
        options.onToolEvent?.({
          toolName: 'bash_background',
          label: 'Proposed background command',
          detail: normalized.command,
          status: 'completed',
        });
        return formatSdkCommandProposalResult(normalized);
      },
    }),
    create_directory: tool({
      description: 'Propose creating a directory in the workspace. This does not create anything until the user clicks Create in chat.',
      inputSchema: z.object({
        path: z.string().describe('Directory path, absolute or relative to the workspace root.'),
        rationale: z.string().optional().describe('Short reason for creating the directory.'),
      }),
      execute: async ({ path, rationale }) => {
        const fullPath = resolveToolPath(path);
        options.onStep?.(`Creating directory ${path}`);
        const artifact: SdkChatArtifact = {
          id: `sdk-directory-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'directory',
          title: rationale?.trim() ? `Create directory: ${rationale.trim()}` : `Create directory: ${path}`,
          path: fullPath,
          contentText: '',
        };
        options.onArtifact?.(artifact);
        options.onToolEvent?.({
          toolName: 'create_directory',
          label: 'Proposed directory',
          detail: path,
          status: 'completed',
        });
        return formatSdkActionProposalResultForModel(artifact);
      },
    }),
    open_preview: tool({
      description: 'Propose opening a localhost, loopback, or private LAN URL in the workspace preview pane. Do not use for external websites or docs.',
      inputSchema: z.object({
        url: z.string().min(1).describe('Local URL to preview. Must be http(s) localhost, 127.x.x.x, 0.0.0.0, [::1], a .localhost host, or a private LAN IPv4 host.'),
        title: z.string().optional().describe('Short preview title.'),
      }),
      execute: async ({ url, title }) => {
        const normalized = normalizeSdkPreviewUrl(url);
        const validation = validateSdkPreviewUrl(normalized);
        if (validation) {
          options.onToolEvent?.({
            toolName: 'open_preview',
            label: 'Preview rejected',
            detail: validation,
            status: 'failed',
          });
          return { error: validation, url: normalized };
        }
        options.onStep?.('Preparing preview');
        const artifact: SdkChatArtifact = {
          id: `sdk-preview-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'preview',
          title: title?.trim() || `Preview: ${normalized}`,
          path: normalized,
          contentText: '',
        };
        options.onArtifact?.(artifact);
        options.onToolEvent?.({
          toolName: 'open_preview',
          label: 'Proposed preview',
          detail: normalized,
          status: 'completed',
        });
        return formatSdkActionProposalResultForModel(artifact);
      },
    }),
    search_workspace: tool({
      description: 'Search text in files under a workspace directory.',
      inputSchema: z.object({
        query: z.string().min(1),
        dir: z.string().optional().describe('Directory path, absolute or relative to the workspace root. Defaults to the workspace root.'),
      }),
      execute: async ({ query, dir }) => {
        const fullDir = resolveToolPath(dir || options.activeTerminalCwd || options.workspaceDir || '.');
        options.onStep?.(`Searching ${query}`);
        try {
          const result = await invoke<string>('workspace_search', { dirPath: fullDir, query });
          const matches = result === 'No matches found'
            ? 0
            : result.split('\n').filter(line => line.trim()).length;
          options.onToolEvent?.({
            toolName: 'search_workspace',
            label: 'Searched workspace',
            detail: `${query}${dir ? ` in ${dir}` : ''} (${matches} matches)`,
            status: 'completed',
          });
          return result;
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'search_workspace',
            label: 'Search failed',
            detail: `${query}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    grep: tool({
      description: 'Search file contents recursively under the workspace. Returns structured path, line, and text hits. Use this for code navigation.',
      inputSchema: z.object({
        pattern: z.string().min(1).describe('Plain text or JavaScript regular expression pattern to search for.'),
        root: z.string().optional().describe('Directory path, absolute or relative to the workspace root. Defaults to the workspace root.'),
        glob: z.array(z.string()).optional().describe('Optional include glob patterns over relative paths, such as ["**/*.ts", "src/**/*.tsx"].'),
        case_insensitive: z.boolean().optional(),
        max_results: z.number().int().min(1).max(MAX_SDK_GREP_RESULTS).optional(),
      }),
      execute: async ({ pattern, root, glob, case_insensitive, max_results }) => {
        const searchRoot = resolveToolPath(root || options.activeTerminalCwd || options.workspaceDir || '.');
        const cap = Math.min(max_results ?? 30, MAX_SDK_GREP_RESULTS);
        options.onStep?.(`Grepping ${pattern}`);
        try {
          const result = await grepSdkWorkspace({
            rootPath: searchRoot,
            pattern,
            includeGlobs: glob,
            caseInsensitive: case_insensitive,
            maxResults: cap,
          });
          options.onToolEvent?.({
            toolName: 'grep',
            label: 'Searched contents',
            detail: `${pattern} (${result.hits.length}${result.truncated ? '+' : ''} hits)`,
            status: 'completed',
          });
          return result;
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'grep',
            label: 'Content search failed',
            detail: `${pattern}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    glob: tool({
      description: 'Find files recursively by path pattern under the workspace. Use this when you need matching paths before reading files.',
      inputSchema: z.object({
        pattern: z.string().min(1).describe('Glob pattern over relative paths, such as "**/*.ts", "src/**/test_*.py", or "package.json".'),
        root: z.string().optional().describe('Directory path, absolute or relative to the workspace root. Defaults to the workspace root.'),
        max_results: z.number().int().min(1).max(MAX_SDK_GLOB_RESULTS).optional(),
      }),
      execute: async ({ pattern, root, max_results }) => {
        const searchRoot = resolveToolPath(root || options.activeTerminalCwd || options.workspaceDir || '.');
        const cap = Math.min(max_results ?? 200, MAX_SDK_GLOB_RESULTS);
        options.onStep?.(`Globbing ${pattern}`);
        try {
          const result = await globSdkWorkspace({
            rootPath: searchRoot,
            pattern,
            maxResults: cap,
          });
          options.onToolEvent?.({
            toolName: 'glob',
            label: 'Found files',
            detail: `${pattern} (${result.hits.length}${result.truncated ? '+' : ''} matches)`,
            status: 'completed',
          });
          return result;
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'glob',
            label: 'Glob failed',
            detail: `${pattern}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    bash_list: tool({
      description: 'List known workspace terminals before proposing a long-running command. Use this to avoid duplicate dev servers or watchers.',
      inputSchema: z.object({}),
      execute: async () => {
        options.onStep?.('Listing terminals');
        const terminals = normalizeSdkTerminalContexts(options.terminals, options.activeTerminalId, options.activeTerminalCwd);
        const enriched = await Promise.all(terminals.map(async terminal => ({
          ...terminal,
          active: await invoke<boolean>('is_pty_active', { id: terminal.terminalId }).catch(() => false),
        })));
        options.onToolEvent?.({
          toolName: 'bash_list',
          label: 'Listed terminals',
          detail: `${enriched.length} terminal${enriched.length === 1 ? '' : 's'}`,
          status: 'completed',
        });
        return {
          terminals: enriched,
          hint: enriched.length === 0
            ? 'No known workspace terminals. If a dev server is needed, propose bash_background.'
            : 'If a terminal has a matching running command, use bash_logs and open_preview instead of proposing a duplicate long-running command.',
        };
      },
    }),
    bash_logs: tool({
      description: 'Read logs from a known terminal. Defaults to the active terminal from <env>. Pass since_offset from the previous response to tail incrementally.',
      inputSchema: z.object({
        terminalId: z.string().optional().describe('Terminal id to read. Defaults to the active terminal from <env>.'),
        maxBytes: z.number().int().min(256).max(32_000).optional().describe('Maximum recent output bytes/chars to return. Default 12000.'),
        since_offset: z.number().int().min(0).optional().describe('Optional next_offset from a prior bash_logs response. Returns only newer output when available.'),
      }),
      execute: async ({ terminalId, maxBytes, since_offset }) => {
        const id = normalizeTerminalId(terminalId) || normalizeTerminalId(options.activeTerminalId);
        if (!id) {
          return { error: 'No active terminal is available for bash_logs.', terminalId: null };
        }
        const cap = Math.min(maxBytes ?? 12_000, 32_000);
        options.onStep?.(`Reading terminal logs ${id}`);
        try {
          const result = await readSdkTerminalLogs(id, cap, since_offset);
          options.onToolEvent?.({
            toolName: 'bash_logs',
            label: 'Read terminal logs',
            detail: `${id} (${result.output.length} chars${since_offset !== undefined ? ` since ${since_offset}` : ''})`,
            status: 'completed',
          });
          return result;
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'bash_logs',
            label: 'Terminal logs failed',
            detail: `${id}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    bash_kill: tool({
      description: 'Propose stopping a known terminal. This does not stop anything until the user clicks Stop in the chat card.',
      inputSchema: z.object({
        terminalId: z.string().min(1).describe('Terminal id to stop. Use bash_list first to identify it.'),
        reason: z.string().optional().describe('Brief reason this terminal should be stopped.'),
      }),
      execute: async ({ terminalId, reason }) => {
        const id = normalizeTerminalId(terminalId);
        if (!id) {
          return { error: 'No terminal id was provided for bash_kill.', terminalId: null };
        }
        options.onStep?.(`Proposing terminal stop ${id}`);
        const terminal = normalizeSdkTerminalContexts(options.terminals, options.activeTerminalId, options.activeTerminalCwd)
          .find(item => item.terminalId === id);
        const artifact: SdkChatArtifact = {
          id: `sdk-terminal-stop-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
          kind: 'terminal_stop',
          title: terminal?.title?.trim() ? `Stop terminal: ${terminal.title.trim()}` : `Stop terminal: ${id}`,
          path: id,
          contentText: reason?.trim() || '',
        };
        options.onArtifact?.(artifact);
        options.onToolEvent?.({
          toolName: 'bash_kill',
          label: 'Proposed terminal stop',
          detail: id,
          status: 'completed',
        });
        return formatSdkActionProposalResultForModel(artifact);
      },
    }),
    get_terminal_output: tool({
      description: 'Read recent output from the active terminal. This is read-only and never writes to the terminal.',
      inputSchema: z.object({
        terminalId: z.string().optional().describe('Terminal id to read. Defaults to the active terminal from <env>.'),
        maxBytes: z.number().int().min(256).max(32_000).optional().describe('Maximum recent output bytes/chars to return. Default 12000.'),
      }),
      execute: async ({ terminalId, maxBytes }) => {
        const id = normalizeTerminalId(terminalId) || normalizeTerminalId(options.activeTerminalId);
        const cap = Math.min(maxBytes ?? 12_000, 32_000);
        if (!id) {
          return { error: 'No active terminal is available for this chat.', terminalId: null };
        }
        options.onStep?.('Reading terminal output');
        try {
          const output = await invoke<string>('get_pty_recent_output', { id, maxBytes: cap });
          options.onToolEvent?.({
            toolName: 'get_terminal_output',
            label: 'Read terminal output',
            detail: `${id} (${output.length} chars)`,
            status: 'completed',
          });
          return {
            terminalId: id,
            output,
            truncatedTo: cap,
          };
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'get_terminal_output',
            label: 'Terminal output failed',
            detail: `${id}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
    propose_patch: tool({
      description: 'Propose a reviewable unified diff for a text file. This does not write the file; the user applies it from the change review pane.',
      inputSchema: z.object({
        path: z.string().describe('File path, absolute or relative to the workspace root.'),
        newContent: z.string().describe('The complete desired file content after the change.'),
        rationale: z.string().optional().describe('Short reason for the change.'),
      }),
      execute: async ({ path, newContent, rationale }) => {
        const fullPath = resolveToolPath(path);
        options.onStep?.(`Proposing patch for ${path}`);
        try {
          return publishPatch('propose_patch', 'Proposed patch', path, fullPath, newContent, rationale);
        } catch (error) {
          options.onToolEvent?.({
            toolName: 'propose_patch',
            label: 'Patch proposal failed',
            detail: `${path}: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
          });
          throw error;
        }
      },
    }),
  };
  return mode === 'read_only' ? pickSdkReadOnlyTools(tools) : tools;
}

function pickSdkReadOnlyTools(tools: ToolSet): ToolSet {
  return {
    list_directory: tools.list_directory,
    read_file: tools.read_file,
    search_workspace: tools.search_workspace,
    grep: tools.grep,
    glob: tools.glob,
    get_terminal_output: tools.get_terminal_output,
  };
}

export function sdkSubagentSystemPrompt(type: 'explore' | 'review' | 'security' | 'research' | string): string {
  switch (type) {
    case 'explore':
      return 'You are a read-only exploration subagent. Use list_directory, glob, grep, and read_file to answer the question with concise evidence: file paths, relevant symbols, and line numbers when available. Do not edit files or run commands.';
    case 'review':
      return 'You are a read-only code-review subagent. Report only actionable correctness, architecture, performance, or security findings. Use file paths and line evidence. If nothing is wrong, say so plainly. Do not edit files or run commands.';
    case 'security':
      return 'You are a read-only security-review subagent. Look for injection, auth/authz, path traversal, secret handling, unsafe deserialization, and trust-boundary validation issues. Be conservative and cite evidence. Do not edit files or run commands.';
    default:
      return 'You are a read-only research subagent. Investigate by reading and searching the workspace. Return a tight summary with evidence. Do not edit files or run commands.';
  }
}

export function normalizeSdkTodoItems(input: SdkChatTodoItem[]): SdkChatTodoItem[] {
  return input
    .map(item => ({
      title: item.title.trim(),
      status: item.status,
      description: item.description?.trim() || undefined,
    }))
    .filter(item => item.title.length > 0);
}

export function createSdkReadWindow(
  content: string,
  options: { offset?: number; limit?: number } = {},
): {
  content: string;
  totalLines: number;
  startLine: number;
  endLine: number;
  truncated: boolean;
} {
  const normalized = content.replace(/\r\n/g, '\n');
  const lines = normalized.split('\n');
  if (lines.length > 0 && lines[lines.length - 1] === '') lines.pop();
  const totalLines = lines.length;
  const startLine = Math.min(Math.max(0, options.offset ?? 0), totalLines);
  const requestedLimit = Math.max(1, options.limit ?? DEFAULT_SDK_READ_LINE_LIMIT);
  const endLine = Math.min(totalLines, startLine + requestedLimit);
  let windowContent = lines.slice(startLine, endLine).join('\n');
  let truncated = endLine < totalLines;
  if (windowContent.length > MAX_READ_BYTES) {
    windowContent = windowContent.slice(0, MAX_READ_BYTES);
    truncated = true;
  }
  return {
    content: windowContent,
    totalLines,
    startLine,
    endLine,
    truncated,
  };
}

export interface SdkReadCacheEntry {
  size: number;
  hash: number;
}

export type SdkReadFileResult =
  | {
      path: string;
      source: 'editor' | 'disk';
      content: string;
      totalLines: number;
      startLine: number;
      endLine: number;
      truncated: boolean;
      hint?: string;
    }
  | {
      path: string;
      source: 'editor' | 'disk';
      unchanged: true;
      size: number;
      hint: string;
    };

export function createSdkReadFileResult(options: {
  path: string;
  source: 'editor' | 'disk';
  content: string;
  window: ReturnType<typeof createSdkReadWindow>;
  cache: Map<string, SdkReadCacheEntry>;
  cacheKey: string;
  offset?: number;
  limit?: number;
}): SdkReadFileResult {
  const isFullRead = options.offset === undefined && options.limit === undefined;
  const hash = hashSdkString(options.content);
  const prior = options.cache.get(options.cacheKey);
  if (isFullRead && prior && prior.size === options.content.length && prior.hash === hash) {
    return {
      path: options.path,
      source: options.source,
      unchanged: true,
      size: options.content.length,
      hint: 'Use the previous read_file result for this path; content has not changed.',
    };
  }
  if (isFullRead) {
    options.cache.set(options.cacheKey, { size: options.content.length, hash });
  }
  return {
    path: options.path,
    source: options.source,
    content: options.window.content,
    totalLines: options.window.totalLines,
    startLine: options.window.startLine,
    endLine: options.window.endLine,
    truncated: options.window.truncated,
    hint: options.window.truncated ? 'Call read_file with a later offset to continue.' : undefined,
  };
}

function hashSdkString(value: string): number {
  let hash = 5381;
  for (let index = 0; index < value.length; index += 1) {
    hash = ((hash << 5) + hash + value.charCodeAt(index)) | 0;
  }
  return hash >>> 0;
}

async function globSdkWorkspace(options: {
  rootPath: string;
  pattern: string;
  maxResults: number;
}): Promise<{ root: string; hits: string[]; truncated: boolean; filesScanned: number }> {
  const files = await collectSdkWorkspaceFiles(options.rootPath);
  const hits = files
    .filter(file => matchesSdkGlobPattern(file.rel, options.pattern))
    .slice(0, options.maxResults)
    .map(file => file.rel);

  return {
    root: options.rootPath,
    hits,
    truncated: files.filter(file => matchesSdkGlobPattern(file.rel, options.pattern)).length > hits.length,
    filesScanned: files.length,
  };
}

async function grepSdkWorkspace(options: {
  rootPath: string;
  pattern: string;
  includeGlobs?: string[];
  caseInsensitive?: boolean;
  maxResults: number;
}): Promise<{ root: string; hits: SdkGrepHit[]; truncated: boolean; filesScanned: number }> {
  const files = await collectSdkWorkspaceFiles(options.rootPath);
  const includeGlobs = options.includeGlobs?.map(pattern => pattern.trim()).filter(Boolean) ?? [];
  const candidates = includeGlobs.length > 0
    ? files.filter(file => includeGlobs.some(pattern => matchesSdkGlobPattern(file.rel, pattern)))
    : files;
  const matcher = createSdkTextMatcher(options.pattern, Boolean(options.caseInsensitive));
  const hits: SdkGrepHit[] = [];
  let truncated = false;

  for (const file of candidates) {
    if (hits.length >= options.maxResults) {
      truncated = true;
      break;
    }
    let read: { content: string };
    try {
      read = await readSdkWorkspaceTextFile(file.path, path => invoke<string>('workspace_read_text_file', { path }));
    } catch {
      continue;
    }
    const lines = read.content.split(/\r?\n/);
    for (let index = 0; index < lines.length; index += 1) {
      if (!matcher(lines[index])) continue;
      hits.push({
        path: file.path,
        rel: file.rel,
        line: index + 1,
        text: clipSdkGrepLine(lines[index]),
      });
      if (hits.length >= options.maxResults) {
        truncated = index < lines.length - 1;
        break;
      }
    }
  }

  return {
    root: options.rootPath,
    hits,
    truncated,
    filesScanned: candidates.length,
  };
}

async function collectSdkWorkspaceFiles(rootPath: string): Promise<SdkWorkspaceFileHit[]> {
  const root = rootPath.replace(/[\\/]+$/g, '');
  const files: SdkWorkspaceFileHit[] = [];
  const queue: Array<{ path: string; rel: string }> = [{ path: root, rel: '' }];

  while (queue.length > 0 && files.length < MAX_SDK_WALK_FILES) {
    const current = queue.shift();
    if (!current) break;
    let entries: SdkWorkspaceDirEntry[];
    try {
      entries = await invoke<SdkWorkspaceDirEntry[]>('workspace_read_dir', { path: current.path });
    } catch {
      continue;
    }
    for (const entry of entries) {
      if (isSdkIgnoredPathSegment(entry.name)) continue;
      const childPath = `${current.path}\\${entry.name}`;
      const childRel = current.rel ? `${current.rel}/${entry.name}` : entry.name;
      if (entry.isDirectory) {
        queue.push({ path: childPath, rel: childRel });
      } else if (entry.isFile) {
        files.push({ path: childPath, rel: childRel.replace(/\\/g, '/') });
        if (files.length >= MAX_SDK_WALK_FILES) break;
      }
    }
  }

  return files;
}

function isSdkIgnoredPathSegment(name: string): boolean {
  return name.startsWith('.')
    || name === 'node_modules'
    || name === 'dist'
    || name === 'build'
    || name === 'target'
    || name === '.next'
    || name === '.turbo'
    || isSdkSensitivePath(name);
}

export function matchesSdkGlobPattern(path: string, pattern: string): boolean {
  const normalizedPath = normalizeSdkRelativePath(path);
  const normalizedPattern = normalizeSdkRelativePath(pattern || '**/*');
  return sdkGlobToRegExp(normalizedPattern).test(normalizedPath);
}

function normalizeSdkRelativePath(value: string): string {
  return value
    .trim()
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
    .replace(/^\/+/, '');
}

function sdkGlobToRegExp(pattern: string): RegExp {
  const source = normalizeSdkRelativePath(pattern);
  const body = Array.from(source).reduce<{ out: string; i: number }>((state, _char, index, chars) => {
    if (index < state.i) return state;
    const char = chars[index];
    const next = chars[index + 1];
    if (char === '*') {
      if (next === '*') {
        const after = chars[index + 2];
        state.i = after === '/' ? index + 3 : index + 2;
        state.out += after === '/' ? '(?:.*/)?' : '.*';
        return state;
      }
      state.i = index + 1;
      state.out += '[^/]*';
      return state;
    }
    if (char === '?') {
      state.i = index + 1;
      state.out += '[^/]';
      return state;
    }
    state.i = index + 1;
    state.out += escapeSdkRegExp(char);
    return state;
  }, { out: '', i: 0 }).out;
  const anchored = source.includes('/') ? `^${body}$` : `(?:^|.*/)${body}$`;
  return new RegExp(anchored);
}

function createSdkTextMatcher(pattern: string, caseInsensitive: boolean): (line: string) => boolean {
  try {
    const regex = new RegExp(pattern, caseInsensitive ? 'i' : undefined);
    return line => {
      regex.lastIndex = 0;
      return regex.test(line);
    };
  } catch {
    const needle = caseInsensitive ? pattern.toLocaleLowerCase() : pattern;
    return line => (caseInsensitive ? line.toLocaleLowerCase() : line).includes(needle);
  }
}

function clipSdkGrepLine(line: string): string {
  const trimmed = line.trim();
  return trimmed.length > MAX_SDK_GREP_LINE_CHARS
    ? `${trimmed.slice(0, MAX_SDK_GREP_LINE_CHARS)}...`
    : trimmed;
}

function escapeSdkRegExp(value: string): string {
  return value.replace(/[|\\{}()[\]^$+?.]/g, '\\$&');
}

export function formatSdkTodoWriteContent(todos: SdkChatTodoItem[]): string {
  return JSON.stringify({
    toolName: 'todo_write',
    input: {
      todos: normalizeSdkTodoItems(todos),
    },
  });
}

export function normalizeSdkCommandSuggestion(input: SdkChatCommandEvent): SdkChatCommandEvent {
  return {
    command: input.command.trim(),
    reason: input.reason?.trim() || undefined,
    cwd: input.cwd?.trim() || undefined,
    action: input.action === 'run' || input.action === 'background' ? input.action : 'insert',
  };
}

export function formatSdkCommandProposalResult(input: SdkChatCommandEvent): SdkCommandProposalResult {
  const suggestion = normalizeSdkCommandSuggestion(input);
  const action = suggestion.action ?? 'insert';
  const approvalRequired = action === 'run' || action === 'background';
  return {
    command: suggestion.command,
    action,
    reason: suggestion.reason,
    cwd: suggestion.cwd,
    approvalRequired,
    executed: false,
    hint: approvalRequired
      ? 'A command card has been shown. The command will not run until the user clicks Run.'
      : 'A command card has been shown. The command has not run.',
  };
}

export function validateSdkShellCommand(command: string, options: { allowLongRunning?: boolean } = {}): string | null {
  const trimmed = command.trim();
  if (!trimmed) return 'command is required';
  if (/[\r\n\x00\x1b\x07]/.test(command)) return 'command must be a single line without control characters';
  if (/\b(?:vim|nvim|nano|less|more|top|htop)\b/i.test(trimmed)) return 'interactive terminal programs are not available through SDK command cards';
  if (!options.allowLongRunning && /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|start|serve|watch)\b/i.test(trimmed)) {
    return 'dev servers and watchers should be started manually; use suggest_command instead';
  }
  return null;
}

export function formatSdkUsageSummary(usage: Pick<SdkChatUsageDelta, 'inputTokens' | 'outputTokens' | 'cachedInputTokens'>): string {
  const parts = [
    usage.inputTokens > 0 ? `${formatSdkTokenCount(usage.inputTokens)} in` : '',
    usage.outputTokens > 0 ? `${formatSdkTokenCount(usage.outputTokens)} out` : '',
    usage.cachedInputTokens > 0 ? `${formatSdkTokenCount(usage.cachedInputTokens)} cached` : '',
  ].filter(Boolean);
  return parts.join(' / ');
}

function formatSdkTokenCount(value: number): string {
  if (value < 1000) return String(value);
  if (value < 1_000_000) return `${(value / 1000).toFixed(value < 10_000 ? 1 : 0)}k`;
  return `${(value / 1_000_000).toFixed(2)}M`;
}

export function formatSdkCommandSuggestionContent(input: SdkChatCommandEvent): string {
  const suggestion = normalizeSdkCommandSuggestion(input);
  const language = /(?:\b(?:Get-|Set-|New-|Remove-|Copy-|Move-|Start-|Stop-)|\$env:)/.test(suggestion.command)
    ? 'powershell'
    : 'bash';
  const header = [
    suggestion.action === 'background' ? 'Background command proposed' : suggestion.action === 'run' ? 'Command proposed' : 'Suggested command',
    suggestion.reason ? `Reason: ${suggestion.reason}` : '',
    suggestion.cwd ? `Working directory: ${suggestion.cwd}` : '',
  ].filter(Boolean).join('\n\n');
  return `${header}\n\n\`\`\`${language}\n${suggestion.command}\n\`\`\``;
}

export function formatSdkPatchProposalContent(artifact: SdkChatArtifact): string {
  if (artifact.kind === 'directory') {
    return formatSdkDirectoryProposalContent(artifact);
  }
  if (artifact.kind === 'preview') {
    return formatSdkPreviewProposalContent(artifact);
  }
  if (artifact.kind === 'terminal_stop') {
    return formatSdkTerminalStopProposalContent(artifact);
  }
  return [
    'Patch proposed',
    `Title: ${artifact.title}`,
    `Path: ${artifact.path}`,
    '',
    '```diff',
    artifact.contentText.trimEnd(),
    '```',
  ].join('\n');
}

export function formatSdkPatchProposalResultForModel(
  artifact: SdkChatArtifact,
  options: { isNewFile?: boolean; bytesProposed?: number } = {},
): SdkPatchProposalResult {
  return {
    ok: true,
    path: artifact.path,
    artifactId: artifact.id,
    title: artifact.title,
    queued_for_review: true,
    applied: false,
    isNewFile: options.isNewFile === true,
    bytesProposed: Math.max(0, options.bytesProposed ?? artifact.contentText.length),
    hint: 'A patch card has been queued in the change review pane. The file is not modified until the user applies it.',
  };
}

export function formatSdkActionProposalResultForModel(artifact: SdkChatArtifact): SdkActionProposalResult {
  const kind = artifact.kind;
  if (kind !== 'directory' && kind !== 'preview' && kind !== 'terminal_stop') {
    throw new Error(`Unsupported SDK action proposal artifact kind: ${kind}`);
  }
  const hintByKind: Record<SdkActionProposalResult['kind'], string> = {
    directory: 'A directory creation card has been queued. The directory is not created until the user clicks Create.',
    preview: 'A preview card has been queued. The URL is not opened until the user clicks Open.',
    terminal_stop: 'A terminal stop card has been queued. The terminal is not stopped until the user clicks Stop.',
  };
  return {
    ok: true,
    kind,
    target: artifact.path,
    artifactId: artifact.id,
    title: artifact.title,
    queued_for_review: true,
    applied: false,
    hint: hintByKind[kind],
  };
}

export function formatSdkDirectoryProposalContent(artifact: SdkChatArtifact): string {
  return [
    'Directory proposed',
    `Title: ${artifact.title}`,
    `Path: ${artifact.path}`,
  ].join('\n');
}

export function formatSdkPreviewProposalContent(artifact: SdkChatArtifact): string {
  return [
    'Preview proposed',
    `Title: ${artifact.title}`,
    `URL: ${artifact.path}`,
  ].join('\n');
}

export function formatSdkTerminalStopProposalContent(artifact: SdkChatArtifact): string {
  return [
    'Terminal stop proposed',
    `Title: ${artifact.title}`,
    `Terminal ID: ${artifact.path}`,
    artifact.contentText.trim() ? `Reason: ${artifact.contentText.trim()}` : '',
  ].filter(Boolean).join('\n');
}

export function formatSdkAppActionResultContent(result: SdkAppActionResultContent): string {
  return [
    'Action result',
    `Kind: ${result.kind}`,
    `Status: ${result.status}`,
    result.cardId ? `Card ID: ${result.cardId}` : '',
    result.title ? `Title: ${result.title}` : '',
    `Target: ${result.target}`,
    result.command ? `Command: ${result.command}` : '',
    result.cwd ? `Working directory: ${result.cwd}` : '',
    result.action ? `Action: ${result.action}` : '',
    result.terminalId ? `Terminal ID: ${result.terminalId}` : '',
    result.error ? `Error: ${result.error}` : '',
  ].filter(Boolean).join('\n');
}

export function normalizeSdkPreviewUrl(value: string): string {
  const trimmed = value.trim();
  if (/^file:\/\//i.test(trimmed)) return trimmed;
  if (isLocalServerUrl(trimmed)) return normalizeLocalServerUrl(trimmed);
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  return trimmed;
}

export function validateSdkPreviewUrl(value: string): string | null {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return 'Preview URL must be a valid local-server http(s) URL.';
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    return 'Preview URL must use http or https.';
  }
  if (!isLocalServerUrl(value)) {
    return 'Preview URL must point to localhost, loopback, or a private LAN address. Paste external URLs in text instead.';
  }
  return null;
}

export function formatSdkAttachmentContext(items: SdkChatAttachmentContextItem[]): string {
  const formatted = items
    .map((item, index) => {
      const name = item.name.trim() || `attachment-${index + 1}`;
      const path = item.path?.trim();
      const header = `- ${name}${path ? `: ${path}` : ''}`;
      if (item.kind === 'image') {
        return `${header}\n  [image attachment; use the path if visual inspection is needed]`;
      }
      if (item.error?.trim()) {
        return `${header}\n  [could not read attachment text: ${item.error.trim()}]`;
      }
      if (typeof item.content !== 'string') {
        return header;
      }
      const truncated = item.content.length > MAX_ATTACHMENT_CONTEXT_CHARS;
      const content = truncated
        ? item.content.slice(0, MAX_ATTACHMENT_CONTEXT_CHARS)
        : item.content;
      const note = truncated
        ? `\n  [truncated at ${MAX_ATTACHMENT_CONTEXT_CHARS} chars]`
        : '';
      return `${header}\n\n\`\`\`text\n${content}\n\`\`\`${note}`;
    })
    .filter(Boolean);

  return formatted.length ? `Attached files:\n${formatted.join('\n\n')}` : '';
}

export function inferSdkImageMediaType(pathOrName: string): string {
  const lower = pathOrName.toLowerCase();
  if (lower.endsWith('.jpg') || lower.endsWith('.jpeg')) return 'image/jpeg';
  if (lower.endsWith('.webp')) return 'image/webp';
  if (lower.endsWith('.gif')) return 'image/gif';
  if (lower.endsWith('.bmp')) return 'image/bmp';
  if (lower.endsWith('.svg')) return 'image/svg+xml';
  return 'image/png';
}

export function createSdkUserContent(text: string, images: SdkChatImageAttachment[] = []): UserContent {
  const imageParts = images.flatMap(image => {
    const label = `Image attachment: ${image.name}${image.path ? ` (${image.path})` : ''}`;
    if (image.error?.trim()) {
      return [{ type: 'text' as const, text: `${label}\n[could not read image: ${image.error.trim()}]` }];
    }
    if (!image.base64?.trim()) {
      return [{ type: 'text' as const, text: label }];
    }
    return [
      { type: 'text' as const, text: label },
      {
        type: 'image' as const,
        image: image.base64.trim(),
        mediaType: image.mediaType || inferSdkImageMediaType(image.path || image.name),
      },
    ];
  });

  return imageParts.length === 0
    ? text
    : [{ type: 'text', text }, ...imageParts];
}

export type ExactEdit = {
  oldString: string;
  newString: string;
  replaceAll?: boolean;
};

export type ExactEditResult =
  | { ok: true; content: string; replacements: number }
  | { ok: false; error: string; replacements: number };

export function applyExactEdits(content: string, edits: ExactEdit[]): ExactEditResult {
  let next = content;
  let replacements = 0;

  for (const edit of edits) {
    if (!edit.oldString) {
      return { ok: false, error: 'old_string cannot be empty', replacements };
    }
    if (edit.oldString === edit.newString) {
      return { ok: false, error: 'old_string and new_string are identical', replacements };
    }

    if (edit.replaceAll) {
      let count = 0;
      let index = next.indexOf(edit.oldString);
      while (index !== -1) {
        count += 1;
        index = next.indexOf(edit.oldString, index + edit.oldString.length);
      }
      if (count === 0) {
        return { ok: false, error: `old_string not found: ${JSON.stringify(edit.oldString.slice(0, 80))}`, replacements };
      }
      next = next.split(edit.oldString).join(edit.newString);
      replacements += count;
      continue;
    }

    const first = next.indexOf(edit.oldString);
    if (first === -1) {
      return { ok: false, error: `old_string not found: ${JSON.stringify(edit.oldString.slice(0, 80))}`, replacements };
    }
    const second = next.indexOf(edit.oldString, first + edit.oldString.length);
    if (second !== -1) {
      return {
        ok: false,
        error: 'old_string is not unique. Provide more surrounding context, or set replace_all=true.',
        replacements,
      };
    }
    next = next.slice(0, first) + edit.newString + next.slice(first + edit.oldString.length);
    replacements += 1;
  }

  return { ok: true, content: next, replacements };
}

function splitLines(value: string): string[] {
  const normalized = value.replace(/\r\n/g, '\n');
  const parts = normalized.split('\n');
  return parts[parts.length - 1] === '' ? parts.slice(0, -1) : parts;
}

export function createUnifiedDiff(path: string, oldContent: string, newContent: string, isNewFile: boolean): string {
  const oldLines = splitLines(oldContent);
  const newLines = splitLines(newContent);
  const safePath = path.replace(/\\/g, '/').replace(/^\/+/, '') || 'untitled.txt';
  const oldPath = isNewFile ? '/dev/null' : `a/${safePath}`;
  const newPath = `b/${safePath}`;
  const oldCount = Math.max(1, oldLines.length);
  const newCount = Math.max(1, newLines.length);
  const header = [
    `diff --git a/${safePath} b/${safePath}`,
    isNewFile ? 'new file mode 100644' : '',
    `--- ${oldPath}`,
    `+++ ${newPath}`,
    `@@ -1,${oldCount} +1,${newCount} @@`,
  ].filter(Boolean);
  const removed = isNewFile ? [] : oldLines.map(line => `-${line}`);
  const added = newLines.map(line => `+${line}`);
  return [...header, ...removed, ...added, ''].join('\n');
}
