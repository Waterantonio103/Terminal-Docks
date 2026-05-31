import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { Search, X } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspace';
import { invoke } from '@tauri-apps/api/core';
import { FileTypeIcon } from '../../lib/fileIcons';
import { cleanQuickOpenStatusText, collectQuickOpenFiles, filterQuickOpenFiles, type QuickOpenDirEntry, type QuickOpenFileEntry } from '../../lib/quickOpenFiles';
import { relativeWorkspacePath } from '../../lib/workspacePaths';

const MAX_FILES = 500;

interface QuickOpenProps {
  onClose: () => void;
}

export function QuickOpen({ onClose }: QuickOpenProps) {
  const workspaceDir = useWorkspaceStore((s) =>
    s.tabs.find(tab => tab.id === s.activeTabId)?.workspaceDir || s.workspaceDir
  );
  const addPane      = useWorkspaceStore((s) => s.addPane);

  const [query,   setQuery]   = useState('');
  const [files,   setFiles]   = useState<QuickOpenFileEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [scanError, setScanError] = useState<string | null>(null);
  const [selected, setSelected] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setTimeout(() => inputRef.current?.focus(), 30);
  }, []);

  useEffect(() => {
    if (!workspaceDir) {
      setFiles([]);
      setLoading(false);
      setScanError(null);
      return;
    }
    const controller = new AbortController();
    setLoading(true);
    setScanError(null);
    collectQuickOpenFiles(
      workspaceDir,
      path => invoke<QuickOpenDirEntry[]>('workspace_read_dir', { path }),
      { maxFiles: MAX_FILES, signal: controller.signal, throwOnRootReadError: true },
    )
      .then(f => {
        if (controller.signal.aborted) return;
        setFiles(f);
      })
      .catch(error => {
        if (controller.signal.aborted) return;
        console.error('Failed to scan workspace files', error);
        setFiles([]);
        setScanError(cleanQuickOpenStatusText(error instanceof Error ? error.message : error));
      })
      .finally(() => {
        if (!controller.signal.aborted) setLoading(false);
      });
    return () => controller.abort();
  }, [workspaceDir]);

  const filtered = useMemo(() => filterQuickOpenFiles(files, query), [files, query]);

  const openFile = useCallback((file: QuickOpenFileEntry) => {
    addPane('editor', file.name, { filePath: file.path });
    onClose();
  }, [addPane, onClose]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') { onClose(); return; }
    if (e.key === 'ArrowDown') { e.preventDefault(); setSelected(s => filtered.length ? Math.min(s + 1, filtered.length - 1) : 0); }
    if (e.key === 'ArrowUp')   { e.preventDefault(); setSelected(s => Math.max(s - 1, 0)); }
    if (e.key === 'Enter' && filtered[selected]) { openFile(filtered[selected]); }
  };

  useEffect(() => { setSelected(0); }, [query]);
  useEffect(() => {
    setSelected(current => Math.min(Math.max(current, 0), Math.max(filtered.length - 1, 0)));
  }, [filtered.length]);

  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const item = listRef.current?.children[selected] as HTMLElement | undefined;
    item?.scrollIntoView({ block: 'nearest' });
  }, [selected]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/50 backdrop-blur-sm"
      onClick={onClose}
    >
      <div
        className="bg-bg-panel border border-border-panel rounded-xl shadow-2xl w-[560px] max-h-[60vh] flex flex-col overflow-hidden animate-fade-in"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Search input */}
        <div className="flex items-center gap-3 px-4 py-3 border-b border-border-panel">
          <Search size={16} className="text-text-muted shrink-0" />
          <input
            ref={inputRef}
            type="text"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={workspaceDir ? 'Search files…' : 'Open a folder first to search files'}
            disabled={!workspaceDir}
            className="flex-1 bg-transparent border-none text-text-primary text-sm focus:outline-none placeholder:text-text-muted"
          />
          <button onClick={onClose} className="text-text-muted hover:text-text-primary transition-colors" aria-label="Close Quick Open">
            <X size={14} />
          </button>
        </div>

        {/* Results */}
        <div ref={listRef} className="overflow-y-auto flex-1">
          {loading && (
            <div className="px-4 py-3 text-xs text-text-muted">Scanning files…</div>
          )}
          {!loading && !workspaceDir && (
            <div className="px-4 py-6 text-center text-xs text-text-muted">
              Open a folder in the Explorer sidebar to enable Quick Open.
            </div>
          )}
          {!loading && workspaceDir && scanError && (
            <div className="px-4 py-3 text-xs text-red-300">{scanError}</div>
          )}
          {!loading && workspaceDir && !scanError && filtered.length === 0 && (
            <div className="px-4 py-3 text-xs text-text-muted">No files matching "{query}"</div>
          )}
          {!loading && !scanError && filtered.map((file, i) => {
            const displayPath = workspaceDir ? relativeWorkspacePath(workspaceDir, file.path) ?? file.path : file.path;
            return (
              <button
                key={file.path}
                onClick={() => openFile(file)}
                onMouseEnter={() => setSelected(i)}
                className={`w-full flex items-center gap-3 px-4 py-2 text-left transition-colors ${
                  i === selected ? 'bg-accent-primary/15 text-text-primary' : 'text-text-secondary hover:bg-bg-surface'
                }`}
              >
                <FileTypeIcon fileName={file.name} size={13} className="shrink-0" />
                <div className="flex flex-col min-w-0">
                  <span className="text-xs font-medium truncate">{file.name}</span>
                  <span className="text-[10px] text-text-muted truncate">{displayPath}</span>
                </div>
              </button>
            );
          })}
        </div>

        {/* Footer */}
        <div className="px-4 py-2 border-t border-border-panel flex items-center gap-3 text-[10px] text-text-muted">
          <span>↑↓ Navigate</span>
          <span>↵ Open</span>
          <span>Esc Close</span>
          {workspaceDir && <span className="ml-auto">{filtered.length} file{filtered.length !== 1 ? 's' : ''}</span>}
        </div>
      </div>
    </div>
  );
}
