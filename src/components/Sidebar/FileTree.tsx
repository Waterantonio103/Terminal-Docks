import React, { useState, useEffect, useRef, useCallback } from 'react';
import { useWorkspaceStore } from '../../store/workspace';
import { open } from '@tauri-apps/plugin-dialog';
import { Folder, File as FileIcon, ChevronRight, ChevronDown, Lock, MoreVertical, FilePlus, FolderPlus, Trash2, Edit2, Copy, Scissors, Clipboard, ExternalLink, Search, FileText } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';

interface DirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

interface FileLock {
  file_path: string;
  agent_id: string;
  locked_at: string;
}

interface ContextMenuState {
  x: number;
  y: number;
  file: DirEntry;
  parentPath: string;
}

function TreeNode({ file, parentPath, locks, refreshSignal, onContextMenu }: { file: DirEntry, parentPath: string, locks: FileLock[], refreshSignal: number, onContextMenu: (e: React.MouseEvent, file: DirEntry, parentPath: string) => void }) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const addPane = useWorkspaceStore(s => s.addPane);

  const fullPath = parentPath + (parentPath.endsWith('/') || parentPath.endsWith('\\') ? '' : '/') + file.name;
  const lock = locks.find(l => l.file_path === fullPath || l.file_path.endsWith(file.name));

  useEffect(() => {
    if (isOpen && file.isDirectory && refreshSignal > 0) {
      invoke<DirEntry[]>('workspace_read_dir', { path: fullPath }).then(files => {
        setChildren(files);
      }).catch(console.error);
    }
  }, [refreshSignal, isOpen, file.isDirectory, fullPath]);

  const handleClick = async () => {
    if (file.isDirectory) {
      if (!isOpen) {
        try {
          const files = await invoke<DirEntry[]>('workspace_read_dir', { path: fullPath });
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
        onContextMenu={(e) => onContextMenu(e, file, parentPath)}
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
        <TreeNode key={child.name} file={child} parentPath={fullPath} locks={locks} refreshSignal={refreshSignal} onContextMenu={onContextMenu} />
      ))}
    </div>
  );
}

export function FileTree() {
  const workspaceDir = useWorkspaceStore(s => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore(s => s.setWorkspaceDir);
  const addPane = useWorkspaceStore(s => s.addPane);
  const [files, setFiles] = useState<DirEntry[]>([]);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [refreshSignal, setRefreshSignal] = useState(1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [promptState, setPromptState] = useState<{ type: 'file' | 'folder' | 'rename', parentPath: string, fileName?: string } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [clipboard, setClipboard] = useState<{ path: string, isCut: boolean } | null>(null);
  
  const promptInputRef = useRef<HTMLInputElement>(null);

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
    const timer = setInterval(fetchLocks, 10000);
    return () => clearInterval(timer);
  }, []);

  const refreshRoot = useCallback((dir: string) => {
    invoke<DirEntry[]>('workspace_read_dir', { path: dir }).then(f => {
      setFiles(f);
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!workspaceDir) return;
    refreshRoot(workspaceDir);
    invoke('watch_directory', { path: workspaceDir }).catch(console.error);
  }, [workspaceDir, refreshRoot]);

  useEffect(() => {
    if (promptState) {
      setTimeout(() => promptInputRef.current?.focus(), 50);
    }
  }, [promptState]);

  const handleContextMenu = (e: React.MouseEvent, file: DirEntry, parentPath: string) => {
    e.preventDefault();
    setContextMenu({
      x: e.clientX,
      y: e.clientY,
      file,
      parentPath
    });
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    const handleClick = () => closeContextMenu();
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  const getFullPath = (file: DirEntry, parent: string) => {
    return parent + (parent.endsWith('/') || parent.endsWith('\\') ? '' : '/') + file.name;
  };

  // Context Menu Actions
  const handleCreateFile = () => {
    if (!contextMenu) return;
    const targetPath = contextMenu.file.isDirectory ? getFullPath(contextMenu.file, contextMenu.parentPath) : contextMenu.parentPath;
    setPromptState({ type: 'file', parentPath: targetPath });
    setPromptValue('');
    closeContextMenu();
  };

  const handleCreateFolder = () => {
    if (!contextMenu) return;
    const targetPath = contextMenu.file.isDirectory ? getFullPath(contextMenu.file, contextMenu.parentPath) : contextMenu.parentPath;
    setPromptState({ type: 'folder', parentPath: targetPath });
    setPromptValue('');
    closeContextMenu();
  };

  const handleRename = () => {
    if (!contextMenu) return;
    setPromptState({ type: 'rename', parentPath: contextMenu.parentPath, fileName: contextMenu.file.name });
    setPromptValue(contextMenu.file.name);
    closeContextMenu();
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const path = getFullPath(contextMenu.file, contextMenu.parentPath);
    const fileName = contextMenu.file.name;
    closeContextMenu();
    if (confirm(`Are you sure you want to delete ${fileName}?`)) {
      try {
        await invoke('workspace_delete', { targetPath: path });
        setRefreshSignal(s => s + 1);
        if (workspaceDir) refreshRoot(workspaceDir);
      } catch (err) {
        alert(`Failed to delete: ${err}`);
      }
    }
  };

  const handleReveal = async () => {
    if (!contextMenu) return;
    const path = getFullPath(contextMenu.file, contextMenu.parentPath);
    closeContextMenu();
    await invoke('reveal_in_explorer', { path });
  };

  const handleCopyPath = async () => {
    if (!contextMenu) return;
    const path = getFullPath(contextMenu.file, contextMenu.parentPath);
    closeContextMenu();
    await writeText(path);
  };

  const handleCopyRelativePath = async () => {
    if (!contextMenu || !workspaceDir) return;
    const path = getFullPath(contextMenu.file, contextMenu.parentPath);
    const relative = path.replace(workspaceDir, '').replace(/^[\\/]/, '');
    closeContextMenu();
    await writeText(relative);
  };

  const handleCopy = () => {
    if (!contextMenu) return;
    setClipboard({ path: getFullPath(contextMenu.file, contextMenu.parentPath), isCut: false });
    closeContextMenu();
  };

  const handleCut = () => {
    if (!contextMenu) return;
    setClipboard({ path: getFullPath(contextMenu.file, contextMenu.parentPath), isCut: true });
    closeContextMenu();
  };

  const handlePaste = async () => {
    if (!clipboard || !contextMenu) return;
    const targetDir = contextMenu.file.isDirectory ? getFullPath(contextMenu.file, contextMenu.parentPath) : contextMenu.parentPath;
    const fileName = clipboard.path.split(/[\\/]/).pop()!;
    const destPath = targetDir + (targetDir.endsWith('/') || targetDir.endsWith('\\') ? '' : '/') + fileName;
    closeContextMenu();

    try {
      if (clipboard.isCut) {
        await invoke('workspace_move', { src: clipboard.path, dest: destPath });
        setClipboard(null);
      } else {
        await invoke('workspace_copy', { src: clipboard.path, dest: destPath });
      }
      setRefreshSignal(s => s + 1);
      if (workspaceDir) refreshRoot(workspaceDir);
    } catch (err) {
      alert(`Paste failed: ${err}`);
    }
  };

  const handleFindInFolder = async () => {
    if (!contextMenu) return;
    const targetPath = contextMenu.file.isDirectory ? getFullPath(contextMenu.file, contextMenu.parentPath) : contextMenu.parentPath;
    closeContextMenu();
    const query = prompt(`Search in ${targetPath}:`);
    if (query && query.trim()) {
       try {
         const results = await invoke<string>('workspace_search', { dirPath: targetPath, query: query.trim() });
         addPane('editor', `Search: ${query}`, { initialContent: results });
       } catch (err) {
         alert(`Search failed: ${err}`);
       }
    }
  };

  const submitPrompt = async () => {
    if (!promptState || !promptValue.trim()) return;

    try {
      if (promptState.type === 'file') {
        await invoke('workspace_create_file', { parentPath: promptState.parentPath, name: promptValue.trim() });
      } else if (promptState.type === 'folder') {
        await invoke('workspace_create_dir', { parentPath: promptState.parentPath, name: promptValue.trim() });
      } else if (promptState.type === 'rename') {
        const oldPath = promptState.parentPath + (promptState.parentPath.endsWith('/') || promptState.parentPath.endsWith('\\') ? '' : '/') + promptState.fileName;
        await invoke('workspace_rename', { targetPath: oldPath, newName: promptValue.trim() });
      }
      setPromptState(null);
      setRefreshSignal(s => s + 1);
      if (workspaceDir) refreshRoot(workspaceDir);
    } catch (err) {
      alert(`Operation failed: ${err}`);
    }
  };

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

  const isRoot = contextMenu?.file.name === '' && contextMenu?.parentPath === workspaceDir;

  return (
    <div className="flex-1 flex flex-col min-h-0 relative" onContextMenu={(e) => {
      // Background right-click targets root
      handleContextMenu(e, { name: '', isDirectory: true, isFile: false }, workspaceDir);
    }}>
      <div 
        className="flex items-center justify-between text-xs text-text-muted px-3 py-2 shrink-0 border-b border-border-panel cursor-pointer hover:bg-bg-surface transition-colors group select-none"
        onContextMenu={(e) => {
          e.stopPropagation();
          handleContextMenu(e, { name: '', isDirectory: true, isFile: false }, workspaceDir);
        }}
        onClick={handleOpenFolder}
      >
        <span className="truncate font-bold text-text-secondary opacity-70 uppercase tracking-wider text-[10px]">
          {workspaceDir.split(/[\\/]/).pop()}
        </span>
        <Folder size={13} className="text-text-muted opacity-40 group-hover:text-accent-primary transition-colors" />
      </div>
      
      <div className="flex-1 overflow-y-auto p-2 no-scrollbar">
        <div className="pb-4">
          {files.map(file => (
            <TreeNode key={file.name} file={file} parentPath={workspaceDir} locks={locks} refreshSignal={refreshSignal} onContextMenu={handleContextMenu} />
          ))}
        </div>
      </div>

      {/* Context Menu Overlay */}
      {contextMenu && (
        <div 
          className="fixed z-[1000] bg-bg-panel border border-border-panel rounded shadow-xl py-1 min-w-[180px] text-xs text-text-secondary animate-in fade-in zoom-in duration-75"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
        >
          {contextMenu.file.isDirectory ? (
            <>
              <ContextMenuItem icon={<FilePlus size={12}/>} label="New File" onClick={handleCreateFile} />
              <ContextMenuItem icon={<FolderPlus size={12}/>} label="New Folder" onClick={handleCreateFolder} />
              <div className="h-px bg-border-panel my-1" />
              <ContextMenuItem icon={<Search size={12}/>} label="Find in Folder..." onClick={handleFindInFolder} />
              <div className="h-px bg-border-panel my-1" />
            </>
          ) : null}
          
          {!isRoot && (
            <>
              <ContextMenuItem icon={<Scissors size={12}/>} label="Cut" onClick={handleCut} />
              <ContextMenuItem icon={<Copy size={12}/>} label="Copy" onClick={handleCopy} />
            </>
          )}
          <ContextMenuItem icon={<Clipboard size={12}/>} label="Paste" onClick={handlePaste} disabled={!clipboard} />
          
          <div className="h-px bg-border-panel my-1" />
          <ContextMenuItem icon={<FileText size={12}/>} label="Copy Path" onClick={handleCopyPath} />
          <ContextMenuItem icon={<FileText size={12}/>} label="Copy Relative Path" onClick={handleCopyRelativePath} />
          
          {/* Show Rename/Delete only if not root */}
          {!isRoot && (
            <>
              <div className="h-px bg-border-panel my-1" />
              <ContextMenuItem icon={<Edit2 size={12}/>} label="Rename..." onClick={handleRename} />
              <ContextMenuItem icon={<Trash2 size={12}/>} label="Delete" onClick={handleDelete} className="text-red-400 hover:bg-red-500/10" />
            </>
          )}
          
          <div className="h-px bg-border-panel my-1" />
          <ContextMenuItem icon={<ExternalLink size={12}/>} label="Reveal in Explorer" onClick={handleReveal} />
        </div>
      )}

      {/* Prompt Overlay */}
      {promptState && (
        <div className="absolute top-8 left-2 right-2 z-50 bg-bg-panel border border-accent-primary rounded shadow-lg p-2">
          <div className="flex items-center gap-2 mb-2 px-1">
             {promptState.type === 'file' && <FileIcon size={12} className="text-text-muted"/>}
             {promptState.type === 'folder' && <Folder size={12} className="text-accent-primary"/>}
             {promptState.type === 'rename' && <Edit2 size={12} className="text-text-muted"/>}
             <span className="text-[10px] uppercase font-bold text-text-muted">
               {promptState.type === 'rename' ? 'Rename' : `New ${promptState.type}`}
             </span>
          </div>
          <input
            ref={promptInputRef}
            className="w-full bg-bg-surface border border-border-panel rounded px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-primary"
            value={promptValue}
            onChange={e => setPromptValue(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') submitPrompt();
              if (e.key === 'Escape') setPromptState(null);
            }}
            onBlur={() => setTimeout(() => setPromptState(null), 200)}
          />
        </div>
      )}
    </div>
  );
}

function ContextMenuItem({ icon, label, onClick, className = '', disabled = false }: { icon: React.ReactNode, label: string, onClick: () => void, className?: string, disabled?: boolean }) {
  return (
    <button
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      className={`w-full flex items-center gap-2 px-3 py-1.5 hover:bg-bg-surface transition-colors text-left disabled:opacity-30 disabled:hover:bg-transparent ${className}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}
