import React, { useState, useEffect, useRef } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { Pane, useWorkspaceStore } from '../../store/workspace';
import { invoke } from '@tauri-apps/api/core';
import { HighlightStyle, syntaxHighlighting } from "@codemirror/language";
import { tags } from "@lezer/highlight";
import { FileTypeIcon, getImageMimeType, isImageFile } from '../../lib/fileIcons';

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

// Global cache to prevent blank flashes on re-mount during layout shifts
const contentCache = new Map<string, string>();

export function EditorPane({ pane }: { pane: Pane }) {
  const { id, title, data } = pane;
  const filePath = data?.filePath as string | undefined;
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const isImage = isImageFile(filePath);
  
  const [content, setContent] = useState(() => {
    if (data?.initialContent) return data.initialContent;
    if (!filePath) return WELCOME;
    return contentCache.get(filePath) ?? '';
  });

  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(false);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const lastLoadedPathRef = useRef<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    if (data?.initialContent && !filePath) {
      setContent(data.initialContent);
      setImageUrl(null);
      return;
    }

    if (!filePath) {

      if (lastLoadedPathRef.current !== undefined) {
        setContent(WELCOME);
        setIsDirty(false);
        setImageUrl(null);
        lastLoadedPathRef.current = undefined;
      }
      return;
    }
    
    // If we have cached content and it's the same path, skip the disk read
    if (filePath === lastLoadedPathRef.current) return;

    setLoading(true);
    lastLoadedPathRef.current = filePath;

    if (isImageFile(filePath)) {
      setImageUrl(null);
      invoke<string>('workspace_read_binary_file_base64', { path: filePath })
        .then(encoded => {
          if (cancelled) return;
          setImageUrl(`data:${getImageMimeType(filePath)};base64,${encoded}`);
          setContent('');
          setIsDirty(false);
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
          contentCache.set(filePath, val);
          setContent(val);
          setIsDirty(false);
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
  }, [data?.initialContent, filePath]);

    const handleOpenFile = async () => {
    try {
      const selected = await open({ multiple: false, directory: false });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) {
        updatePaneData(id, { filePath: path });
      }
    } catch (err) {
      console.error('File dialog error:', err);
    }
    };

    const handleSave = async () => {
    if (filePath && !isImage) {
      try {
        await invoke('workspace_write_text_file', { path: filePath, content });
        setIsDirty(false);
      } catch (err) {
        console.error('Failed to save file', err);
      }
    }
    };
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-panel" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-border-panel shrink-0 bg-bg-titlebar">
        <span className="text-text-muted truncate max-w-[70%] flex items-center gap-2">
          {filePath && <FileTypeIcon fileName={filePath} size={13} />}
          <span className="truncate">{loading ? 'Loading…' : filePath ? filePath.split(/[\\/]/).pop() : title}</span>
          {isDirty && <span className="ml-1 text-accent-primary">●</span>}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleOpenFile}
            className="text-text-muted hover:text-accent-primary transition-colors"
            title="Open file"
          >
            <FolderOpen size={13} />
          </button>
          {filePath && !isImage && (
            <button
              onClick={handleSave}
              className="text-text-muted hover:text-accent-primary text-xs transition-colors"
            >
              Save
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto h-full bg-bg-panel">
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
          <CodeMirror
            key={filePath || '__welcome__'}
            value={content}
            height="100%"
            theme="dark"
            extensions={[
              javascript({ jsx: true }),
              syntaxHighlighting(dynamicSyntaxStyle)
            ]}
            onChange={(val) => {
              setContent(val);
              if (filePath) contentCache.set(filePath, val);
              if (filePath && !isDirty) setIsDirty(true);
            }}
            className="h-full text-sm cm-theme-custom"
          />
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
