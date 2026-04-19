import { useState, useEffect, useRef, useCallback } from 'react';
import { useWorkspaceStore } from '../../store/workspace';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, DirEntry } from '@tauri-apps/plugin-fs';
import { Folder, File as FileIcon, ChevronRight, ChevronDown, Lock } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';

interface FileLock {
  file_path: string;
  agent_id: string;
  locked_at: string;
}

function TreeNode({ file, parentPath, locks, refreshSignal }: { file: DirEntry, parentPath: string, locks: FileLock[], refreshSignal: number }) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const addPane = useWorkspaceStore(s => s.addPane);

  const fullPath = parentPath + (parentPath.endsWith('/') || parentPath.endsWith('\\') ? '' : '/') + file.name;
  const lock = locks.find(l => l.file_path === fullPath || l.file_path.endsWith(file.name));

  useEffect(() => {
    if (isOpen && file.isDirectory && refreshSignal > 0) {
      readDir(fullPath).then(files => {
        files.sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
          return a.isDirectory ? -1 : 1;
        });
        setChildren(files);
      }).catch(console.error);
    }
  }, [refreshSignal]);

  const handleClick = async () => {
    if (file.isDirectory) {
      if (!isOpen) {
        try {
          const files = await readDir(fullPath);
          files.sort((a, b) => {
            if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
            return a.isDirectory ? -1 : 1;
          });
          setChildren(files);
        } catch (err) {
          console.error(err);
        }
      }
      setIsOpen(!isOpen);
    } else {
      addPane('editor', file.name, { filePath: fullPath });
    }
  };

  const onDragStart = (e: React.MouseEvent) => {
    if (file.isDirectory) return;
    
    const dragEvent = new CustomEvent('file-drag-start', {
      detail: {
        type: 'editor',
        title: file.name,
        data: { filePath: fullPath },
        clientX: e.clientX,
        clientY: e.clientY
      }
    });
    window.dispatchEvent(dragEvent);
  };

  return (
    <div className="pl-2">
      <div
        onMouseDown={onDragStart}
        className="flex items-center gap-1 py-0.5 hover:bg-bg-surface cursor-pointer rounded px-1 text-xs transition-colors group select-none"
        onClick={handleClick}
      >
        {file.isDirectory ? (
          <>
            {isOpen ? <ChevronDown size={12} className="shrink-0 text-text-muted" /> : <ChevronRight size={12} className="shrink-0 text-text-muted" />}
            <Folder size={13} className="text-accent-primary shrink-0" />
          </>
        ) : (
          <>
            <span className="w-3 shrink-0" />
            <FileIcon size={13} className="text-text-muted shrink-0 opacity-60" />
          </>
        )}
        <span className="truncate text-text-secondary flex-1" title={file.name}>{file.name}</span>
        {lock && (
          <div className="shrink-0 px-1 py-0.5 rounded-sm bg-accent-primary/10 border border-accent-primary/20" title={`Locked by agent: ${lock.agent_id}`}>
            <Lock size={10} className="text-accent-primary" />
          </div>
        )}
      </div>
      {isOpen && file.isDirectory && children.map(child => (
        <TreeNode key={child.name} file={child} parentPath={fullPath} locks={locks} refreshSignal={refreshSignal} />
      ))}
    </div>
  );
}

export function FileTree() {
  const workspaceDir = useWorkspaceStore(s => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore(s => s.setWorkspaceDir);
  const [files, setFiles] = useState<DirEntry[]>([]);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [refreshSignal, setRefreshSignal] = useState(0);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleOpenFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected && typeof selected === 'string') {
      setWorkspaceDir(selected);
    }
  };

  const fetchLocks = async () => {
    try {
      const fileLocks = await invoke<FileLock[]>('get_file_locks');
      setLocks(fileLocks);
    } catch (err) {
      console.error('Failed to fetch file locks', err);
    }
  };

  useEffect(() => {
    fetchLocks();
    
    // Listen for MCP events instead of polling
    import('@tauri-apps/api/event').then(({ listen }) => {
      const unlisten = listen('mcp-message', (event: any) => {
        if (event.payload?.type === 'lock_update') {
          fetchLocks();
        }
      });
      return () => unlisten.then(f => f());
    });
  }, []);

  const refreshRoot = useCallback((dir: string) => {
    readDir(dir).then(f => {
      f.sort((a, b) => {
        if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
        return a.isDirectory ? -1 : 1;
      });
      setFiles(f);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!workspaceDir) return;

    refreshRoot(workspaceDir);
    invoke('watch_directory', { path: workspaceDir }).catch(console.error);

    let unlisten: (() => void) | undefined;
    import('@tauri-apps/api/event').then(({ listen }) => {
      listen('fs-change', () => {
        if (debounceRef.current) clearTimeout(debounceRef.current);
        debounceRef.current = setTimeout(() => {
          refreshRoot(workspaceDir);
          setRefreshSignal(s => s + 1);
        }, 150);
      }).then(fn => { unlisten = fn; });
    });

    const pollInterval = setInterval(() => {
      refreshRoot(workspaceDir);
      setRefreshSignal(s => s + 1);
    }, 5000);

    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      clearInterval(pollInterval);
      unlisten?.();
    };
  }, [workspaceDir, refreshRoot]);

  if (!workspaceDir) {
    return (
      <div className="flex flex-col items-center justify-center h-full text-center gap-3 px-4">
        <Folder size={28} className="text-text-muted opacity-20" />
        <p className="text-xs text-text-muted">No folder open</p>
        <button
          onClick={handleOpenFolder}
          className="px-3 py-1.5 bg-accent-primary hover:bg-accent-hover text-accent-text rounded-md text-xs font-medium transition-colors"
        >
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="flex items-center justify-between text-xs text-text-muted px-1 mb-1.5">
        <span className="truncate font-medium text-text-secondary opacity-70">{workspaceDir.split(/[\\/]/).pop()}</span>
        <button className="hover:text-accent-primary transition-colors" onClick={handleOpenFolder} title="Open Folder">
          <Folder size={12} />
        </button>
      </div>
      <div className="pb-4">
        {files.map(file => (
          <TreeNode key={file.name} file={file} parentPath={workspaceDir} locks={locks} refreshSignal={refreshSignal} />
        ))}
      </div>
    </div>
  );
}
