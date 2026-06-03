import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { LSPClient, Transport } from '@codemirror/lsp-client';
import type { Extension } from '@codemirror/state';
import { editorLanguageKindForPath, type EditorLanguageKind } from './editorLanguage.js';

export interface LanguageServerDefinition {
  id: string;
  languageIds: string[];
  command: string;
  args: string[];
}

interface LspServerStarted {
  sessionId: string;
}

interface LspServerMessagePayload {
  sessionId: string;
  message: string;
}

export type LanguageServiceState = 'none' | 'available' | 'starting' | 'ready' | 'unavailable';

export interface LanguageServiceStatus {
  state: LanguageServiceState;
  label: string;
  detail?: string;
}

export type LanguageServiceStatusListener = (status: LanguageServiceStatus) => void;

const LANGUAGE_ID_BY_KIND: Partial<Record<EditorLanguageKind, string>> = {
  c: 'c',
  cpp: 'cpp',
  csharp: 'csharp',
  css: 'css',
  go: 'go',
  html: 'html',
  java: 'java',
  javascript: 'javascript',
  json: 'json',
  jsx: 'javascriptreact',
  kotlin: 'kotlin',
  php: 'php',
  powershell: 'powershell',
  python: 'python',
  ruby: 'ruby',
  rust: 'rust',
  scss: 'scss',
  shell: 'shellscript',
  svelte: 'svelte',
  swift: 'swift',
  tsx: 'typescriptreact',
  typescript: 'typescript',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
};

const LANGUAGE_SERVER_BY_KIND: Partial<Record<EditorLanguageKind, LanguageServerDefinition>> = {
  javascript: {
    id: 'typescript-language-server',
    languageIds: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  jsx: {
    id: 'typescript-language-server',
    languageIds: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  typescript: {
    id: 'typescript-language-server',
    languageIds: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  tsx: {
    id: 'typescript-language-server',
    languageIds: ['javascript', 'javascriptreact', 'typescript', 'typescriptreact'],
    command: 'typescript-language-server',
    args: ['--stdio'],
  },
  python: {
    id: 'pyright',
    languageIds: ['python'],
    command: 'pyright-langserver',
    args: ['--stdio'],
  },
  rust: {
    id: 'rust-analyzer',
    languageIds: ['rust'],
    command: 'rust-analyzer',
    args: [],
  },
  go: {
    id: 'gopls',
    languageIds: ['go'],
    command: 'gopls',
    args: [],
  },
};

const clients = new Map<string, Promise<LSPClient | null>>();
const sessionHandlers = new Map<string, Set<(message: string) => void>>();
let eventBridge: Promise<UnlistenFn> | null = null;

export function lspLanguageIdForPath(path?: string): string | null {
  return LANGUAGE_ID_BY_KIND[editorLanguageKindForPath(path)] ?? null;
}

export function languageServerDefinitionForPath(path?: string): LanguageServerDefinition | null {
  return LANGUAGE_SERVER_BY_KIND[editorLanguageKindForPath(path)] ?? null;
}

export function languageServiceStatusForPath(path?: string): LanguageServiceStatus {
  const definition = languageServerDefinitionForPath(path);
  if (!definition) return { state: 'none', label: 'No language server' };
  return {
    state: 'available',
    label: `${definition.id} available`,
    detail: definition.command,
  };
}

export function fileUriFromPath(path?: string): string | null {
  const clean = typeof path === 'string' ? path.replace(/\0/g, '').trim() : '';
  if (!clean) return null;
  const normalized = clean.replace(/\\/g, '/');
  if (normalized.startsWith('//')) {
    const [host = '', ...parts] = normalized.slice(2).split('/');
    return `file://${host}/${parts.map(encodeURIComponent).join('/')}`;
  }
  const parts = normalized.split('/').map(part => /^[A-Za-z]:$/.test(part) ? part : encodeURIComponent(part));
  const prefix = /^[A-Za-z]:\//.test(normalized) ? 'file:///' : 'file://';
  return `${prefix}${parts.join('/')}`;
}

export async function loadLanguageServiceExtensionForPath(
  filePath?: string,
  workspaceDir?: string | null,
  onStatus?: LanguageServiceStatusListener,
): Promise<Extension> {
  const languageId = lspLanguageIdForPath(filePath);
  const fileUri = fileUriFromPath(filePath);
  const definition = languageServerDefinitionForPath(filePath);
  if (!languageId || !fileUri || !definition) {
    onStatus?.({ state: 'none', label: 'No language server' });
    return [];
  }

  const workspaceUri = fileUriFromPath(workspaceDir ?? undefined) ?? undefined;
  onStatus?.({
    state: 'starting',
    label: `Starting ${definition.id}`,
    detail: definition.command,
  });
  const client = await getOrStartClient(definition, workspaceDir ?? undefined, workspaceUri, onStatus);
  if (!client) {
    onStatus?.({
      state: 'unavailable',
      label: `${definition.id} unavailable`,
      detail: `${definition.command} was not started`,
    });
    return [];
  }
  onStatus?.({
    state: 'ready',
    label: `${definition.id} ready`,
    detail: definition.command,
  });
  return client.plugin(fileUri, languageId);
}

async function getOrStartClient(
  definition: LanguageServerDefinition,
  cwd?: string,
  rootUri?: string,
  onStatus?: LanguageServiceStatusListener,
): Promise<LSPClient | null> {
  const key = `${definition.id}:${rootUri ?? cwd ?? ''}`;
  const existing = clients.get(key);
  if (existing) return existing;

  const promise = startClient(definition, cwd, rootUri).catch(error => {
    console.info(`Language server unavailable: ${definition.id}`, error);
    onStatus?.({
      state: 'unavailable',
      label: `${definition.id} unavailable`,
      detail: error instanceof Error ? error.message : String(error),
    });
    clients.delete(key);
    return null;
  });
  clients.set(key, promise);
  return promise;
}

async function startClient(
  definition: LanguageServerDefinition,
  cwd?: string,
  rootUri?: string,
): Promise<LSPClient> {
  await ensureLspEventBridge();
  const { LSPClient, languageServerExtensions } = await import('@codemirror/lsp-client');
  const started = await invoke<LspServerStarted>('start_lsp_server', {
    request: {
      command: definition.command,
      args: definition.args,
      cwd,
    },
  });
  const transport = new TauriLspTransport(started.sessionId);
  const client = new LSPClient({
    rootUri,
    timeout: 10_000,
    sanitizeHTML,
    extensions: languageServerExtensions(),
  });
  client.connect(transport);
  await client.initializing;
  return client;
}

function ensureLspEventBridge(): Promise<UnlistenFn> {
  if (!eventBridge) {
    eventBridge = listen<LspServerMessagePayload>('lsp-server-message', event => {
      const handlers = sessionHandlers.get(event.payload.sessionId);
      if (!handlers) return;
      for (const handler of handlers) handler(event.payload.message);
    });
  }
  return eventBridge;
}

function sanitizeHTML(html: string): string {
  return html
    .replace(/<script\b[^>]*>[\s\S]*?<\/script>/gi, '')
    .replace(/\son\w+="[^"]*"/gi, '')
    .replace(/\son\w+='[^']*'/gi, '');
}

class TauriLspTransport implements Transport {
  constructor(private readonly sessionId: string) {}

  send(message: string): void {
    invoke('write_lsp_message', {
      sessionId: this.sessionId,
      message,
    }).catch(error => {
      console.info('Failed to send LSP message', error);
    });
  }

  subscribe(handler: (value: string) => void): void {
    let handlers = sessionHandlers.get(this.sessionId);
    if (!handlers) {
      handlers = new Set();
      sessionHandlers.set(this.sessionId, handlers);
    }
    handlers.add(handler);
  }

  unsubscribe(handler: (value: string) => void): void {
    const handlers = sessionHandlers.get(this.sessionId);
    if (!handlers) return;
    handlers.delete(handler);
    if (handlers.size === 0) sessionHandlers.delete(this.sessionId);
  }
}
