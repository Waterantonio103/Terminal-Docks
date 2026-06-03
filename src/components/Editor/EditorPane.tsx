import React, { useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen, RotateCw, Save } from 'lucide-react';
import { Pane, useWorkspaceStore } from '../../store/workspace';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view';
import { tags } from "@lezer/highlight";
import { getImageMimeType, isBinaryLikeFile, isImageFile } from '../../lib/fileIcons';
import { fileNameFromPath, languageLabelForPath } from '../../lib/editorLanguage';
import { editorDiagnosticsExtensions } from '../../lib/editorDiagnostics';
import { supportsEditorDiagnostics, syntaxDiagnosticsForState } from '../../lib/editorDiagnostics';
import { loadLanguageExtensionForPath } from '../../lib/editorLanguageExtensions';
import {
  languageServiceStatusForPath,
  loadLanguageServiceExtensionForPath,
  type LanguageServiceStatus,
} from '../../lib/languageService';
import { defaultEditorSavePath } from '../../lib/editorSavePath';
import {
  clearCachedEditorDirty,
  getCachedEditorContent,
  getCachedEditorViewState,
  markCachedEditorDirty,
  setCachedEditorContent,
  setCachedEditorViewState,
} from '../../lib/editorSessionCache';
import { dirname } from '../../lib/workspacePaths';

const WELCOME = '// Welcome to the Editor\nconsole.log("Hello, world!");';

function canUseBlockingWindowConfirm(): boolean {
  return typeof window !== 'undefined'
    && typeof window.confirm === 'function'
    && window.location?.hostname !== 'tauri.localhost';
}

function confirmDiscardEditorChange(message: string): boolean {
  if (!canUseBlockingWindowConfirm()) return true;
  try {
    return window.confirm(message);
  } catch (error) {
    console.warn('Editor discard confirmation unavailable:', error);
    return true;
  }
}

function normalizeFsEventPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/').replace(/\/$/g, '').toLowerCase();
}

function uniqueSortedLineNumbers(lines: number[]): number[] {
  return Array.from(new Set(lines.filter(line => Number.isFinite(line) && line > 0))).sort((a, b) => a - b);
}

type MinimapViewport = {
  top: number;
  height: number;
};

type MinimapTokenTone = 'comment' | 'keyword' | 'string' | 'number' | 'property' | 'plain';

type MinimapToken = {
  text: string;
  tone: MinimapTokenTone;
};

const MINIMAP_KEYWORDS = new Set([
  'async', 'await', 'break', 'case', 'catch', 'class', 'const', 'continue', 'def', 'else',
  'enum', 'export', 'extends', 'false', 'fn', 'for', 'from', 'function', 'if', 'impl',
  'import', 'in', 'interface', 'let', 'match', 'new', 'null', 'pub', 'return', 'self',
  'static', 'struct', 'switch', 'this', 'throw', 'true', 'try', 'type', 'use', 'var',
  'while',
]);

function tokenizeMinimapLine(line: string): MinimapToken[] {
  const text = line.replace(/\t/g, '  ');
  if (!text) return [{ text: ' ', tone: 'plain' }];

  const commentIndex = (() => {
    const candidates = ['//', '#', '--', '<!--']
      .map(marker => text.indexOf(marker))
      .filter(index => index >= 0);
    return candidates.length > 0 ? Math.min(...candidates) : -1;
  })();

  const code = commentIndex >= 0 ? text.slice(0, commentIndex) : text;
  const comment = commentIndex >= 0 ? text.slice(commentIndex) : '';
  const tokens: MinimapToken[] = [];
  const pattern = /(["'`])(?:\\.|(?!\1).)*\1|[A-Za-z_$][\w$-]*|-?\d+(?:\.\d+)?|\s+|./g;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(code)) !== null) {
    const part = match[0];
    let tone: MinimapTokenTone = 'plain';
    if (/^["'`]/.test(part)) {
      tone = 'string';
    } else if (/^-?\d/.test(part)) {
      tone = 'number';
    } else if (MINIMAP_KEYWORDS.has(part)) {
      tone = 'keyword';
    } else {
      const next = code.slice(pattern.lastIndex).match(/^\s*:/);
      if (next && /^[A-Za-z_$][\w$-]*$/.test(part)) tone = 'property';
    }
    tokens.push({ text: part, tone });
  }

  if (comment) tokens.push({ text: comment, tone: 'comment' });
  return tokens;
}

// Dynamic syntax style using CSS variables
const dynamicSyntaxStyle = HighlightStyle.define([
  { tag: tags.keyword, color: "var(--syntax-keyword)" },
  { tag: tags.string,  color: "var(--syntax-string)" },
  { tag: tags.function(tags.variableName), color: "var(--syntax-function)" },
  { tag: tags.comment, color: "var(--syntax-comment)", fontStyle: "italic" },
  { tag: tags.number,  color: "var(--syntax-number)" },
  { tag: tags.typeName, color: "var(--syntax-type)" },
  { tag: tags.className, color: "var(--syntax-type)" },
  { tag: tags.variableName, color: "var(--syntax-variable)" },
  { tag: tags.propertyName, color: "var(--syntax-property)" },
  { tag: tags.operator, color: "var(--syntax-operator)" },
  { tag: tags.constant(tags.variableName), color: "var(--syntax-constant)" },
]);

export function EditorPane({ pane }: { pane: Pane }) {
  const { id, title, data } = pane;
  const filePath = data?.filePath as string | undefined;
  const reloadToken = data?.editorReloadToken as string | undefined;
  const isUntitled = data?.untitled === true && !filePath;
  const untitledContent = typeof data?.untitledContent === 'string' ? data.untitledContent : '';
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const renamePane = useWorkspaceStore(s => s.renamePane);
  const workspaceDir = useWorkspaceStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.workspaceDir ?? s.workspaceDir);
  const isImage = isImageFile(filePath);
  const isBinaryLike = isBinaryLikeFile(filePath);
  
  const [content, setContent] = useState(() => {
    if (isUntitled) return untitledContent;
    if (data?.initialContent) return data.initialContent;
    if (!filePath) return WELCOME;
    return getCachedEditorContent(filePath) ?? '';
  });

  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [cursorPosition, setCursorPosition] = useState({ line: 1, col: 1 });
  const [diagnosticLines, setDiagnosticLines] = useState<number[]>([]);
  const [minimapViewport, setMinimapViewport] = useState<MinimapViewport>({ top: 0, height: 100 });
  const [languageExtension, setLanguageExtension] = useState<Extension>([]);
  const [languageServiceExtension, setLanguageServiceExtension] = useState<Extension>([]);
  const [languageServiceStatus, setLanguageServiceStatus] = useState<LanguageServiceStatus>(() => languageServiceStatusForPath(filePath));
  const diagnosticExtensions = React.useMemo(() => editorDiagnosticsExtensions(filePath), [filePath]);
  const editorDirtyRef = React.useRef(Boolean(data?.editorDirty));
  const editorViewRef = React.useRef<EditorView | null>(null);
  const minimapRef = React.useRef<HTMLDivElement | null>(null);
  const minimapCanvasRef = React.useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    editorDirtyRef.current = Boolean(data?.editorDirty);
    setIsDirty(Boolean(data?.editorDirty));
  }, [data?.editorDirty]);

  const setDirtyState = React.useCallback((dirty: boolean) => {
    setIsDirty(dirty);
    if ((filePath || isUntitled) && editorDirtyRef.current !== dirty) {
      editorDirtyRef.current = dirty;
      updatePaneData(id, { editorDirty: dirty });
    }
  }, [filePath, id, isUntitled, updatePaneData]);

  useEffect(() => {
    let cancelled = false;
    loadLanguageExtensionForPath(filePath)
      .then(extension => {
        if (!cancelled) setLanguageExtension(extension);
      })
      .catch(error => {
        console.warn('Failed to load editor language extension:', filePath, error);
        if (!cancelled) setLanguageExtension([]);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath]);

  useEffect(() => {
    let cancelled = false;
    setLanguageServiceStatus(languageServiceStatusForPath(filePath));
    loadLanguageServiceExtensionForPath(filePath, workspaceDir, status => {
      if (!cancelled) setLanguageServiceStatus(status);
    })
      .then(extension => {
        if (!cancelled) setLanguageServiceExtension(extension);
      })
      .catch(error => {
        console.info('Editor language service unavailable:', filePath, error);
        if (!cancelled) setLanguageServiceExtension([]);
      });

    return () => {
      cancelled = true;
    };
  }, [filePath, workspaceDir]);

  const languageServiceClassName = React.useMemo(() => {
    if (languageServiceStatus.state === 'ready') return 'text-emerald-300';
    if (languageServiceStatus.state === 'starting') return 'text-accent-primary';
    if (languageServiceStatus.state === 'unavailable') return 'text-amber-300';
    return 'text-text-muted';
  }, [languageServiceStatus.state]);

  const loadFile = React.useCallback(() => {
    let cancelled = false;

    if (isUntitled) {
      setContent(untitledContent);
      setImageUrl(null);
      setLoading(false);
      return;
    }

    if (data?.initialContent && !filePath) {
      setContent(data.initialContent);
      setImageUrl(null);
      setLoading(false);
      return;
    }

    if (!filePath) {
      setContent(WELCOME);
      setDirtyState(false);
      setImageUrl(null);
      setLoading(false);
      return;
    }

    setLoading(true);

    if (isImageFile(filePath)) {
      setImageUrl(null);
      invoke<string>('workspace_read_binary_file_base64', { path: filePath })
        .then(encoded => {
          if (cancelled) return;
          setImageUrl(`data:${getImageMimeType(filePath)};base64,${encoded}`);
          setContent('');
          setDirtyState(false);
        })
        .catch(err => {
          console.error('Failed to read image:', filePath, err);
          if (!cancelled) setContent(`// Error loading image:\n// ${err}`);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    } else if (isBinaryLikeFile(filePath)) {
      setImageUrl(null);
      setContent('');
      setDirtyState(false);
      setLoading(false);
    } else {
      setImageUrl(null);
      invoke<string>('workspace_read_text_file', { path: filePath })
        .then(val => {
          if (cancelled) return;
          setCachedEditorContent(filePath, val);
          setContent(val);
          clearCachedEditorDirty(filePath);
          setDirtyState(false);
        })
        .catch(err => {
          console.error('Failed to read file:', filePath, err);
          if (!cancelled) setContent(`// Error loading file:\n// ${err}`);
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }

    return () => {
      cancelled = true;
    };
  }, [data?.initialContent, filePath, isUntitled, reloadToken, setDirtyState]);

  useEffect(() => loadFile(), [loadFile]);

  useEffect(() => {
    if (!filePath || isUntitled || isImage || isBinaryLike) return;
    let unlisten: (() => void) | null = null;
    let disposed = false;
    listen<string | { changedDir?: string; paths?: string[] }>('fs-change', event => {
      if (editorDirtyRef.current) return;
      const changedDir = typeof event.payload === 'string'
        ? event.payload.trim()
        : event.payload.changedDir?.trim() ?? '';
      const changedPaths = typeof event.payload === 'string' ? [] : event.payload.paths ?? [];
      const fileDir = dirname(filePath);
      const sameDirectory = changedDir && normalizeFsEventPath(fileDir) === normalizeFsEventPath(changedDir);
      const sameFile = changedPaths.some(path => normalizeFsEventPath(path) === normalizeFsEventPath(filePath));
      if (!sameDirectory && !sameFile) return;
      updatePaneData(id, { editorReloadToken: `fs-${Date.now()}` });
    }).then(stop => {
      if (disposed) {
        stop();
        return;
      }
      unlisten = stop;
    }).catch(error => {
      console.debug('Editor live file watcher unavailable:', error);
    });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }, [filePath, id, isBinaryLike, isImage, isUntitled, updatePaneData]);

  const handleOpenFile = async () => {
    if (isDirty && !confirmDiscardEditorChange('Open another file and discard unsaved changes in this editor?')) return;

    try {
      const selected = await open({ multiple: false, directory: false });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) {
        updatePaneData(id, {
          filePath: path,
          initialContent: undefined,
          untitled: false,
          untitledContent: undefined,
          editorDirty: false,
        });
        renamePane(id, fileNameFromPath(path));
      }
    } catch (err) {
      console.error('File dialog error:', err);
    }
  };

  const handleOpenCurrentDirectory = async () => {
    if (!filePath) {
      await handleOpenFile();
      return;
    }

    try {
      await invoke('reveal_in_explorer', { path: dirname(filePath) });
    } catch (err) {
      console.error('Failed to open current directory:', filePath, err);
    }
  };

  const handleSave = async () => {
    if (isImage || isBinaryLike) return;

    try {
      let targetPath = filePath;
      const savingUntitled = !targetPath;
      if (!targetPath) {
        targetPath = await saveDialog({
          title: 'Save editor file',
          defaultPath: defaultEditorSavePath(workspaceDir, title),
          filters: [{ name: 'Text files', extensions: ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'css', 'scss', 'html', 'xml', 'rs', 'py', 'go', 'java', 'kt', 'swift', 'c', 'cpp', 'cs', 'php', 'rb', 'sh', 'ps1', 'sql', 'vue', 'svelte', 'yaml', 'toml'] }],
        }) ?? undefined;
        if (!targetPath) return;
      }

      await invoke('workspace_write_text_file', { path: targetPath, content });
      setCachedEditorContent(targetPath, content);
      clearCachedEditorDirty(targetPath);
      if (savingUntitled) {
        updatePaneData(id, {
          filePath: targetPath,
          initialContent: undefined,
          untitled: false,
          untitledContent: undefined,
          editorDirty: false,
        });
        renamePane(id, fileNameFromPath(targetPath));
      }
      setDirtyState(false);
    } catch (err) {
      console.error('Failed to save file', err);
    }
  };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  const handleReload = () => {
    if (!filePath || isImage || isBinaryLike) return;
    if (isDirty && !confirmDiscardEditorChange('Reload this file and discard unsaved changes?')) return;
    updatePaneData(id, { editorReloadToken: `${Date.now()}` });
  };

  const updateDiagnosticLines = React.useCallback((view: EditorView) => {
    if (!supportsEditorDiagnostics(filePath)) {
      setDiagnosticLines([]);
      return;
    }
    const nextLines = uniqueSortedLineNumbers(
      syntaxDiagnosticsForState(view.state).map(diagnostic => view.state.doc.lineAt(diagnostic.from).number),
    );
    setDiagnosticLines(previous => (
      previous.length === nextLines.length && previous.every((line, index) => line === nextLines[index])
        ? previous
        : nextLines
    ));
  }, [filePath]);

  const updateMinimapViewport = React.useCallback((view: EditorView) => {
    const scrollDOM = view.scrollDOM;
    const scrollHeight = Math.max(1, scrollDOM.scrollHeight);
    const visibleHeight = Math.max(1, scrollDOM.clientHeight);
    const height = Math.min(100, Math.max(5, (visibleHeight / scrollHeight) * 100));
    const maxScrollTop = Math.max(0, scrollHeight - visibleHeight);
    const maxTop = Math.max(0, 100 - height);
    const top = maxScrollTop > 0 ? (scrollDOM.scrollTop / maxScrollTop) * maxTop : 0;
    setMinimapViewport(previous => (
      Math.abs(previous.top - top) < 0.1 && Math.abs(previous.height - height) < 0.1
        ? previous
        : { top, height }
    ));
  }, []);

  const handleEditorUpdate = (update: ViewUpdate) => {
    if (update.selectionSet || update.docChanged) {
      const head = update.state.selection.main.head;
      const line = update.state.doc.lineAt(head);
      setCursorPosition({ line: line.number, col: head - line.from + 1 });
    }

    if (filePath && update.view.scrollDOM) {
      setCachedEditorViewState(filePath, {
        cursor: update.state.selection.main.head,
        scrollTop: update.view.scrollDOM.scrollTop,
        scrollLeft: update.view.scrollDOM.scrollLeft,
      });
    }

    if (update.docChanged || update.viewportChanged) {
      updateDiagnosticLines(update.view);
    }

    if (update.docChanged || update.viewportChanged || update.geometryChanged) {
      updateMinimapViewport(update.view);
    }
  };

  const restoreViewState = (view: EditorView) => {
    editorViewRef.current = view;
    updateDiagnosticLines(view);
    updateMinimapViewport(view);
    if (!filePath) return;
    const cached = getCachedEditorViewState(filePath);
    if (!cached) return;
    const cursor = Math.min(cached.cursor, view.state.doc.length);
    view.dispatch({ selection: { anchor: cursor }, scrollIntoView: true });
    window.requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = cached.scrollTop;
      view.scrollDOM.scrollLeft = cached.scrollLeft;
      updateMinimapViewport(view);
    });
  };

  const minimapLines = React.useMemo<string[]>(() => String(content).split('\n'), [content]);
  const minimapLineCount = Math.max(1, minimapLines.length);
  const minimapCursorTop = `${((Math.max(1, cursorPosition.line) - 0.5) / minimapLineCount) * 100}%`;

  const renderMinimapCanvas = React.useCallback(() => {
    const canvas = minimapCanvasRef.current;
    const minimap = minimapRef.current;
    if (!canvas || !minimap) return;

    const rect = minimap.getBoundingClientRect();
    const pixelRatio = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const width = Math.max(1, Math.floor(rect.width * pixelRatio));
    const height = Math.max(1, Math.floor(rect.height * pixelRatio));
    if (canvas.width !== width) canvas.width = width;
    if (canvas.height !== height) canvas.height = height;
    canvas.style.width = `${rect.width}px`;
    canvas.style.height = `${rect.height}px`;

    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const rootStyle = getComputedStyle(document.documentElement);
    const colors: Record<MinimapTokenTone, string> = {
      comment: rootStyle.getPropertyValue('--syntax-comment').trim() || '#6a9955',
      keyword: rootStyle.getPropertyValue('--syntax-keyword').trim() || '#c586c0',
      string: rootStyle.getPropertyValue('--syntax-string').trim() || '#ce9178',
      number: rootStyle.getPropertyValue('--syntax-number').trim() || '#b5cea8',
      property: rootStyle.getPropertyValue('--syntax-property').trim() || '#9cdcfe',
      plain: rootStyle.getPropertyValue('--text-muted').trim() || '#858585',
    };
    const background = rootStyle.getPropertyValue('--bg-panel').trim() || '#1e1e1e';

    ctx.clearRect(0, 0, width, height);
    ctx.fillStyle = background;
    ctx.globalAlpha = 0.96;
    ctx.fillRect(0, 0, width, height);
    ctx.globalAlpha = 1;
    ctx.textBaseline = 'top';
    ctx.imageSmoothingEnabled = false;

    const leftPadding = Math.max(3, Math.round(3 * pixelRatio));
    const usableWidth = width - leftPadding - Math.round(2 * pixelRatio);
    const lineHeight = Math.max(1, Math.min(3 * pixelRatio, height / minimapLineCount));
    const charWidth = Math.max(1, Math.round(pixelRatio));
    const useGlyphText = lineHeight >= 2.4;
    const fontSize = Math.max(2, lineHeight * 1.18);
    ctx.font = `${fontSize}px Consolas, "Cascadia Mono", monospace`;

    for (let index = 0; index < minimapLines.length; index += 1) {
      const y = Math.floor(index * lineHeight);
      if (y > height) break;
      const tokens = tokenizeMinimapLine(minimapLines[index]);
      let x = leftPadding;

      for (const token of tokens) {
        if (x >= width) break;
        ctx.fillStyle = colors[token.tone];
        ctx.globalAlpha = token.tone === 'plain' ? 0.62 : 0.76;

        if (useGlyphText) {
          const availableChars = Math.max(0, Math.floor((width - x) / Math.max(1, fontSize * 0.58)));
          if (availableChars <= 0) break;
          const text = token.text.slice(0, availableChars);
          ctx.fillText(text, x, y);
          x += ctx.measureText(text).width;
        } else {
          for (let i = 0; i < token.text.length && x < width; i += 1) {
            const ch = token.text[i];
            if (ch !== ' ') {
              ctx.fillRect(x, y, charWidth, Math.max(1, Math.floor(lineHeight)));
            }
            x += charWidth;
          }
        }

        if (x - leftPadding > usableWidth) break;
      }
    }

    ctx.globalAlpha = 1;
  }, [minimapLineCount, minimapLines]);

  useEffect(() => {
    renderMinimapCanvas();
  }, [renderMinimapCanvas]);

  useEffect(() => {
    const minimap = minimapRef.current;
    if (!minimap) return;
    const observer = new ResizeObserver(() => renderMinimapCanvas());
    observer.observe(minimap);
    return () => observer.disconnect();
  }, [renderMinimapCanvas]);

  const scrollEditorFromMinimap = React.useCallback((event: React.PointerEvent<HTMLDivElement>) => {
    const view = editorViewRef.current;
    const minimap = minimapRef.current;
    if (!view || !minimap) return;

    const rect = minimap.getBoundingClientRect();
    const ratio = rect.height > 0 ? Math.max(0, Math.min(1, (event.clientY - rect.top) / rect.height)) : 0;
    const lineNumber = Math.max(1, Math.min(view.state.doc.lines, Math.floor(ratio * view.state.doc.lines) + 1));
    const pos = view.state.doc.line(lineNumber).from;
    view.focus();
    view.dispatch({
      selection: { anchor: pos },
      effects: EditorView.scrollIntoView(pos, { y: 'center' }),
    });
    updateMinimapViewport(view);
  }, [updateMinimapViewport]);

  return (
    <div className="flex flex-col h-full bg-bg-panel" onKeyDown={handleKeyDown}>
      <div className="flex-1 min-h-0 overflow-auto bg-bg-panel">
        {isImage ? (
          <div className="h-full w-full flex items-center justify-center p-6 bg-bg-app">
            {loading ? (
              <div className="text-xs text-text-muted">Loading image…</div>
            ) : imageUrl ? (
              <img
                src={imageUrl}
                alt={filePath?.split(/[\\/]/).pop() || 'Image preview'}
                className="max-w-full max-h-full object-contain rounded border border-border-panel bg-bg-panel"
                draggable={false}
              />
            ) : (
              <pre className="text-xs whitespace-pre-wrap text-red-300 bg-bg-surface border border-border-panel rounded-md p-3">{content}</pre>
            )}
          </div>
        ) : isBinaryLike ? (
          <div className="h-full w-full flex items-center justify-center p-6 bg-bg-app">
            <div className="max-w-sm rounded-md border border-border-panel bg-bg-panel p-4 text-center">
              <div className="text-xs font-semibold text-text-secondary">{languageLabelForPath(filePath)}</div>
              <div className="mt-2 text-xs leading-5 text-text-muted">
                This file type is recognized, but it does not have an inline text editor or preview yet.
              </div>
            </div>
          </div>
        ) : (
          loading ? (
            <div className="h-full flex items-center justify-center text-xs text-text-muted">Loading file...</div>
          ) : (
            <div className="td-editor-code-shell">
              <CodeMirror
                key={filePath || id}
                value={content}
                height="100%"
                theme="dark"
                extensions={[
                  lineNumbers(),
                  highlightActiveLineGutter(),
                  history(),
                  indentOnInput(),
                  bracketMatching(),
                  closeBrackets(),
                  autocompletion(),
                  highlightActiveLine(),
                  highlightSelectionMatches(),
                  languageExtension,
                  diagnosticExtensions,
                  languageServiceExtension,
                  syntaxHighlighting(dynamicSyntaxStyle),
                  keymap.of([
                    indentWithTab,
                    ...closeBracketsKeymap,
                    ...defaultKeymap,
                    ...historyKeymap,
                    ...searchKeymap,
                  ]),
                ]}
                onCreateEditor={restoreViewState}
                onUpdate={handleEditorUpdate}
                onChange={(val) => {
                  setContent(val);
                  if (filePath) {
                    markCachedEditorDirty(filePath, val);
                    if (!isDirty) setDirtyState(true);
                  } else if (isUntitled) {
                    const dirty = val.length > 0;
                    editorDirtyRef.current = dirty;
                    setIsDirty(dirty);
                    updatePaneData(id, { untitledContent: val, editorDirty: dirty });
                  }
                }}
                className="h-full min-w-0 flex-1 text-sm cm-theme-custom"
              />
              <div
                ref={minimapRef}
                className="td-editor-minimap"
                aria-label="Editor minimap"
                title="Click or drag to jump through the file"
                onPointerDown={(event) => {
                  event.preventDefault();
                  event.currentTarget.setPointerCapture(event.pointerId);
                  scrollEditorFromMinimap(event);
                }}
                onPointerMove={(event) => {
                  if ((event.buttons & 1) === 1) scrollEditorFromMinimap(event);
                }}
              >
                <canvas ref={minimapCanvasRef} className="td-editor-minimap-canvas" />
                <span
                  className="td-editor-minimap-viewport"
                  style={{ top: `${minimapViewport.top}%`, height: `${minimapViewport.height}%` }}
                />
                <span className="td-editor-minimap-cursor" style={{ top: minimapCursorTop }} />
                {diagnosticLines.map(line => (
                  <span
                    key={line}
                    className="td-editor-minimap-diagnostic"
                    style={{ top: `${((line - 0.5) / minimapLineCount) * 100}%` }}
                  />
                ))}
              </div>
            </div>
          )
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border-panel bg-bg-titlebar px-3 text-[10px] text-text-muted">
        {loading ? (
          <span className="shrink-0">Loading</span>
        ) : filePath && !isImage && !isBinaryLike ? (
          <>
            <span className="shrink-0">Ln {cursorPosition.line}</span>
            <span className="shrink-0">Col {cursorPosition.col}</span>
            <span className="hidden shrink-0 md:inline">{languageLabelForPath(filePath)}</span>
            {languageServiceStatus.state !== 'none' && (
              <span
                className={`hidden shrink-0 lg:inline ${languageServiceClassName}`}
                title={languageServiceStatus.detail ?? languageServiceStatus.label}
              >
                {languageServiceStatus.label}
              </span>
            )}
          </>
        ) : (
          <span className="shrink-0">{isImage ? 'Image preview' : isBinaryLike ? languageLabelForPath(filePath) : 'Ready'}</span>
        )}
        {isDirty && <span className="shrink-0 text-accent-primary">Unsaved</span>}
        <button
          onClick={handleOpenCurrentDirectory}
          className="text-text-muted hover:text-accent-primary transition-colors"
          title={filePath ? "Open current directory" : "Open file"}
          aria-label={filePath ? "Open current directory" : "Open file"}
        >
          <FolderOpen size={13} />
        </button>
        {filePath && !isImage && !isBinaryLike && (
          <button
            onClick={handleReload}
            className="text-text-muted hover:text-accent-primary transition-colors"
            title="Reload file"
            aria-label="Reload file"
          >
            <RotateCw size={13} />
          </button>
        )}
        {(filePath || isUntitled) && !isImage && !isBinaryLike && (
          <button
            onClick={handleSave}
            className="text-text-muted hover:text-accent-primary transition-colors"
            title={filePath ? 'Save' : 'Save as'}
            aria-label={filePath ? 'Save' : 'Save as'}
          >
            <Save size={13} />
          </button>
        )}
      </div>
      <style>{`
        .cm-theme-custom .cm-editor {
          background-color: var(--bg-panel) !important;
          color: var(--text-primary) !important;
        }
        .cm-theme-custom .cm-gutters {
          background-color: var(--bg-panel) !important;
          color: var(--text-muted) !important;
          border-right: 1px solid var(--border-panel) !important;
        }
        .cm-theme-custom .cm-activeLine {
          background-color: var(--bg-surface) !important;
        }
        .cm-theme-custom .cm-activeLineGutter {
          background-color: var(--bg-surface) !important;
        }
        .cm-theme-custom .cm-selectionBackground {
          background-color: var(--accent-subtle) !important;
        }
        .cm-theme-custom .cm-cursor {
          border-left-color: var(--accent-primary) !important;
        }
      `}</style>
    </div>
  );
}
