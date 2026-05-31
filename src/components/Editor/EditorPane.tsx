import React, { useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { open, save as saveDialog } from '@tauri-apps/plugin-dialog';
import { FolderOpen, RotateCw, Save } from 'lucide-react';
import { Pane, useWorkspaceStore } from '../../store/workspace';
import { invoke } from '@tauri-apps/api/core';
import { autocompletion, closeBrackets, closeBracketsKeymap } from '@codemirror/autocomplete';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, HighlightStyle, indentOnInput, syntaxHighlighting } from "@codemirror/language";
import { searchKeymap, highlightSelectionMatches } from '@codemirror/search';
import type { Extension } from '@codemirror/state';
import { EditorView, highlightActiveLine, highlightActiveLineGutter, keymap, lineNumbers, type ViewUpdate } from '@codemirror/view';
import { tags } from "@lezer/highlight";
import { getImageMimeType, isImageFile } from '../../lib/fileIcons';
import { fileNameFromPath, languageLabelForPath } from '../../lib/editorLanguage';
import { loadLanguageExtensionForPath } from '../../lib/editorLanguageExtensions';
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
  const [languageExtension, setLanguageExtension] = useState<Extension>([]);
  const editorDirtyRef = React.useRef(Boolean(data?.editorDirty));

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
  }, [data?.initialContent, filePath, id, isUntitled, reloadToken, setDirtyState]);

  useEffect(() => loadFile(), [loadFile]);

  const handleOpenFile = async () => {
    if (isDirty && !window.confirm('Open another file and discard unsaved changes in this editor?')) return;

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
    if (isImage) return;

    try {
      let targetPath = filePath;
      const savingUntitled = !targetPath;
      if (!targetPath) {
        targetPath = await saveDialog({
          title: 'Save editor file',
          defaultPath: defaultEditorSavePath(workspaceDir, title),
          filters: [{ name: 'Text files', extensions: ['txt', 'md', 'json', 'js', 'ts', 'tsx', 'css', 'html', 'rs'] }],
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
    if (!filePath || isImage) return;
    if (isDirty && !window.confirm('Reload this file and discard unsaved changes?')) return;
    updatePaneData(id, { editorReloadToken: `${Date.now()}` });
  };

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
  };

  const restoreViewState = (view: EditorView) => {
    if (!filePath) return;
    const cached = getCachedEditorViewState(filePath);
    if (!cached) return;
    const cursor = Math.min(cached.cursor, view.state.doc.length);
    view.dispatch({ selection: { anchor: cursor }, scrollIntoView: true });
    window.requestAnimationFrame(() => {
      view.scrollDOM.scrollTop = cached.scrollTop;
      view.scrollDOM.scrollLeft = cached.scrollLeft;
    });
  };

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
        ) : (
          loading ? (
            <div className="h-full flex items-center justify-center text-xs text-text-muted">Loading file...</div>
          ) : (
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
              className="h-full text-sm cm-theme-custom"
            />
          )
        )}
      </div>
      <div className="flex h-7 shrink-0 items-center gap-3 border-t border-border-panel bg-bg-titlebar px-3 text-[10px] text-text-muted">
        {loading ? (
          <span className="shrink-0">Loading</span>
        ) : filePath && !isImage ? (
          <>
            <span className="shrink-0">Ln {cursorPosition.line}</span>
            <span className="shrink-0">Col {cursorPosition.col}</span>
            <span className="hidden shrink-0 md:inline">{languageLabelForPath(filePath)}</span>
          </>
        ) : (
          <span className="shrink-0">{isImage ? 'Image preview' : 'Ready'}</span>
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
        {filePath && !isImage && (
          <button
            onClick={handleReload}
            className="text-text-muted hover:text-accent-primary transition-colors"
            title="Reload file"
            aria-label="Reload file"
          >
            <RotateCw size={13} />
          </button>
        )}
        {(filePath || isUntitled) && !isImage && (
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
