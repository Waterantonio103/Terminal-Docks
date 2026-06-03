import React, { useState, useEffect, useRef, useCallback } from 'react';
import { selectActivePanes, useWorkspaceStore } from '../../store/workspace';
import { open } from '@tauri-apps/plugin-dialog';
import { Folder, File as FileIcon, ChevronRight, ChevronDown, Lock, FilePlus, FolderPlus, Trash2, Edit2, Copy, Scissors, Clipboard, ExternalLink, Search, FileText, Terminal as TerminalIcon, RefreshCw, FolderOpen } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { FileTypeIcon, FolderTypeIcon } from '../../lib/fileIcons';
import { fileTreeLockMatchesPath, normalizeFileTreeEntries, type FileTreeEntry } from '../../lib/fileTreeEntries';
import { dirname, joinWorkspacePath, normalizeWorkspacePath, rebaseWorkspacePath, relativeWorkspacePath, workspacePathContains } from '../../lib/workspacePaths';

type DirEntry = FileTreeEntry;

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

interface SelectedTreeItem {
  path: string;
  file: DirEntry;
  parentPath: string;
}

function TreeNode({
  file,
  parentPath,
  locks,
  refreshSignal,
  selectedPath,
  onSelect,
  onContextMenu,
  iconOnly = false,
}: {
  file: DirEntry,
  parentPath: string,
  locks: FileLock[],
  refreshSignal: number,
  selectedPath: string | null,
  onSelect: (item: SelectedTreeItem) => void,
  onContextMenu: (e: React.MouseEvent, file: DirEntry, parentPath: string) => void,
  iconOnly?: boolean,
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const addPane = useWorkspaceStore(s => s.addPane);

  const fullPath = joinWorkspacePath(parentPath, file.name);
  const lock = locks.find(l => fileTreeLockMatchesPath(l.file_path, fullPath, file.name));
  const isSelected = selectedPath === fullPath;

  useEffect(() => {
    if (isOpen && file.isDirectory && refreshSignal > 0) {
      invoke<unknown>('workspace_read_dir', { path: fullPath }).then(files => {
        setChildren(normalizeFileTreeEntries(files, { parentPath: fullPath }));
      }).catch(console.error);
    }
  }, [refreshSignal, isOpen, file.isDirectory, fullPath]);

  const handleClick = async () => {
    onSelect({ path: fullPath, file, parentPath });
    if (file.isDirectory) {
      if (!isOpen) {
        try {
          const files = await invoke<unknown>('workspace_read_dir', { path: fullPath });
          setChildren(normalizeFileTreeEntries(files, { parentPath: fullPath }));
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
    <div className={iconOnly ? '' : 'pl-2'}>
      <div
        onMouseDown={onDragStart}
        onContextMenu={(e) => {
          e.stopPropagation();
          onSelect({ path: fullPath, file, parentPath });
          onContextMenu(e, file, parentPath);
        }}
        data-tree-path={fullPath}
        data-tree-parent={parentPath}
        data-tree-name={file.name}
        data-tree-directory={file.isDirectory ? 'true' : 'false'}
        data-tree-file={file.isFile ? 'true' : 'false'}
        data-tree-open={isOpen ? 'true' : 'false'}
        role="treeitem"
        aria-selected={isSelected}
        aria-expanded={file.isDirectory ? isOpen : undefined}
        title={file.name}
        className={`inline-flex items-center ${iconOnly ? 'td-sidebar-icon-only-item' : 'w-full gap-1 py-0.5 px-1 rounded'} hover:background-bg-surface cursor-pointer text-xs transition-colors group select-none outline-none ${isSelected ? 'background-bg-surface text-text-primary ring-1 ring-accent-primary/30' : ''}`}
        onClick={handleClick}
      >
        {file.isDirectory ? (
          <>
            {!iconOnly && (isOpen ? <ChevronDown size={12} className="shrink-0 text-text-muted" /> : <ChevronRight size={12} className="shrink-0 text-text-muted" />)}
            <FolderTypeIcon folderName={file.name} expanded={isOpen} size={iconOnly ? 12 : 13} className="shrink-0" />
          </>
        ) : (
          <>
            {!iconOnly && <span className="w-3 shrink-0" />}
            <FileTypeIcon fileName={file.name} size={iconOnly ? 12 : 13} className="shrink-0 opacity-80" />
          </>
        )}
        {!iconOnly && <span className={`truncate flex-1 ${isSelected ? 'text-text-primary' : 'text-text-secondary'}`} title={file.name}>{file.name}</span>}
        {lock && !iconOnly && (
          <div className="shrink-0 px-1 py-0.5 rounded-sm bg-accent-primary/10 border border-accent-primary/20" title={`Locked by agent: ${lock.agent_id}`}>
            <Lock size={10} className="text-accent-primary" />
          </div>
        )}
      </div>
      {isOpen && file.isDirectory && children.map(child => (
        <TreeNode key={child.name} file={child} parentPath={fullPath} locks={locks} refreshSignal={refreshSignal} selectedPath={selectedPath} onSelect={onSelect} onContextMenu={onContextMenu} iconOnly={iconOnly} />
      ))}
    </div>
  );
}

export function FileTree({ iconOnly = false }: { iconOnly?: boolean }) {
  const activeTabWorkspaceDir = useWorkspaceStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.workspaceDir ?? null);
  const globalWorkspaceDir = useWorkspaceStore(s => s.workspaceDir);
  const workspaceDir = activeTabWorkspaceDir || globalWorkspaceDir;
  const setWorkspaceDir = useWorkspaceStore(s => s.setWorkspaceDir);
  const addPane = useWorkspaceStore(s => s.addPane);
  const removePane = useWorkspaceStore(s => s.removePane);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const renamePane = useWorkspaceStore(s => s.renamePane);
  const activePanes = useWorkspaceStore(selectActivePanes);
  const activePaneId = useWorkspaceStore(s => s.activePaneId);
  const [files, setFiles] = useState<DirEntry[]>([]);
  const [locks, setLocks] = useState<FileLock[]>([]);
  const [refreshSignal, setRefreshSignal] = useState(1);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);
  const [promptState, setPromptState] = useState<{ type: 'file' | 'folder' | 'rename', parentPath: string, fileName?: string } | null>(null);
  const [promptValue, setPromptValue] = useState('');
  const [clipboard, setClipboard] = useState<{ path: string, isCut: boolean } | null>(null);
  const [selectedItem, setSelectedItem] = useState<SelectedTreeItem | null>(null);
  const [deleteConfirmItem, setDeleteConfirmItem] = useState<SelectedTreeItem | null>(null);
  
  const promptInputRef = useRef<HTMLInputElement>(null);
  const treeRef = useRef<HTMLDivElement>(null);
  const contextMenuRef = useRef<HTMLDivElement>(null);

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
    invoke<unknown>('workspace_read_dir', { path: dir }).then(f => {
      setFiles(normalizeFileTreeEntries(f, { parentPath: dir }));
    }).catch(console.error);
  }, []);

  useEffect(() => {
    if (!workspaceDir) return;
    setSelectedItem(null);
    refreshRoot(workspaceDir);
    invoke('watch_directory', { path: workspaceDir }).catch(console.error);
  }, [workspaceDir, refreshRoot]);

  useEffect(() => {
    if (selectedItem || files.length === 0 || !workspaceDir) return;
    const first = files[0];
    setSelectedItem({ file: first, parentPath: workspaceDir, path: getFullPath(first, workspaceDir) });
  }, [files, selectedItem, workspaceDir]);

  useEffect(() => {
    if (!workspaceDir || !activePaneId) return;
    const activePane = activePanes.find(pane => pane.id === activePaneId);
    const activeFilePath = activePane?.type === 'editor' && typeof activePane.data?.filePath === 'string'
      ? activePane.data.filePath
      : null;
    if (!activeFilePath || !workspacePathContains(workspaceDir, activeFilePath)) return;
    const name = activeFilePath.split(/[\\/]/).filter(Boolean).pop();
    if (!name) return;
    setSelectedItem({
      path: activeFilePath,
      parentPath: dirname(activeFilePath),
      file: { name, isDirectory: false, isFile: true },
    });
  }, [activePaneId, activePanes, workspaceDir]);

  useEffect(() => {
    if (promptState) {
      setTimeout(() => promptInputRef.current?.focus(), 50);
    }
  }, [promptState]);

  const openContextMenuAt = (file: DirEntry, parentPath: string, x: number, y: number) => {
    setContextMenu({
      x,
      y,
      file,
      parentPath
    });
  };

  const handleContextMenu = (e: React.MouseEvent, file: DirEntry, parentPath: string) => {
    e.preventDefault();
    openContextMenuAt(file, parentPath, e.clientX, e.clientY);
  };

  const closeContextMenu = () => setContextMenu(null);

  useEffect(() => {
    const handleClick = () => closeContextMenu();
    window.addEventListener('click', handleClick);
    return () => window.removeEventListener('click', handleClick);
  }, []);

  useEffect(() => {
    if (!contextMenu) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeContextMenu();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [contextMenu]);

  useEffect(() => {
    if (!contextMenu) return;
    const focusTimer = window.setTimeout(() => {
      contextMenuRef.current?.querySelector<HTMLButtonElement>('[role="menuitem"]:not(:disabled)')?.focus();
    }, 0);
    return () => window.clearTimeout(focusTimer);
  }, [contextMenu]);

  const getFullPath = (file: DirEntry, parent: string) => joinWorkspacePath(parent, file.name);
  const cleanPromptName = (value: string) => value.replace(/\0/g, '').replace(/\s+/g, ' ').trim();

  const refreshWorkspace = () => {
    setRefreshSignal(s => s + 1);
    if (workspaceDir) refreshRoot(workspaceDir);
  };

  const syncRenamedEditorPanes = (oldPath: string, newPath: string, newName: string) => {
    activePanes.forEach(pane => {
      const filePath = pane.data?.filePath;
      if (pane.type !== 'editor' || typeof filePath !== 'string' || !workspacePathContains(oldPath, filePath)) return;

      const nextFilePath = rebaseWorkspacePath(oldPath, newPath, filePath);
      if (!nextFilePath) return;
      updatePaneData(pane.id, { filePath: nextFilePath });
      if (normalizeWorkspacePath(filePath) === normalizeWorkspacePath(oldPath)) {
        renamePane(pane.id, newName);
      }
    });
  };

  const closeDeletedEditorPanes = (deletedPath: string) => {
    activePanes.forEach(pane => {
      const filePath = pane.data?.filePath;
      if (pane.type === 'editor' && typeof filePath === 'string' && workspacePathContains(deletedPath, filePath)) {
        removePane(pane.id);
      }
    });
  };

  const itemFromRow = (row: HTMLElement): SelectedTreeItem | null => {
    const path = row.dataset.treePath;
    const parentPath = row.dataset.treeParent;
    const name = row.dataset.treeName;
    if (!path || !parentPath || !name) return null;
    return {
      path,
      parentPath,
      file: {
        name,
        isDirectory: row.dataset.treeDirectory === 'true',
        isFile: row.dataset.treeFile === 'true',
      },
    };
  };

  const selectRow = (row: HTMLElement | undefined | null) => {
    if (!row) return;
    const next = itemFromRow(row);
    if (!next) return;
    setSelectedItem(next);
    row.scrollIntoView({ block: 'nearest' });
  };

  const visibleRows = () => Array.from(treeRef.current?.querySelectorAll<HTMLElement>('[data-tree-path]') ?? []);

  const startRenameItem = (item: SelectedTreeItem) => {
    setPromptState({ type: 'rename', parentPath: item.parentPath, fileName: item.file.name });
    setPromptValue(item.file.name);
    closeContextMenu();
  };

  const requestDeleteItem = (item: SelectedTreeItem) => {
    setDeleteConfirmItem(item);
    closeContextMenu();
  };

  const confirmDeleteItem = async () => {
    if (!deleteConfirmItem) return;
    const item = deleteConfirmItem;
    setDeleteConfirmItem(null);
    try {
      await invoke('workspace_delete', { targetPath: item.path });
      closeDeletedEditorPanes(item.path);
      setSelectedItem(null);
      refreshWorkspace();
    } catch (err) {
      alert(`Failed to delete: ${err}`);
    }
  };

  const handleTreeKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (promptState) return;
    const target = event.target as HTMLElement | null;
    if (target?.tagName === 'INPUT' || target?.tagName === 'TEXTAREA') return;

    const rows = visibleRows();
    if (rows.length === 0) return;
    const selectedIndex = Math.max(0, rows.findIndex(row => row.dataset.treePath === selectedItem?.path));
    const selectedRow = rows[selectedIndex] ?? rows[0];

    if (event.key === 'ArrowDown') {
      event.preventDefault();
      selectRow(rows[Math.min(selectedIndex + 1, rows.length - 1)]);
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      selectRow(rows[Math.max(selectedIndex - 1, 0)]);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      selectedRow.click();
    } else if (event.key === 'ContextMenu' || (event.shiftKey && event.key === 'F10')) {
      const selected = itemFromRow(selectedRow);
      if (!selected) return;
      const rect = selectedRow.getBoundingClientRect();
      event.preventDefault();
      openContextMenuAt(selected.file, selected.parentPath, rect.left + 12, rect.top + Math.min(24, rect.height));
    } else if (event.key === 'ArrowRight') {
      if (selectedRow.dataset.treeDirectory === 'true' && selectedRow.dataset.treeOpen !== 'true') {
        event.preventDefault();
        selectedRow.click();
      }
    } else if (event.key === 'ArrowLeft') {
      if (selectedRow.dataset.treeDirectory === 'true' && selectedRow.dataset.treeOpen === 'true') {
        event.preventDefault();
        selectedRow.click();
      } else {
        const parentRow = rows.find(row => row.dataset.treePath === selectedRow.dataset.treeParent);
        if (parentRow) {
          event.preventDefault();
          selectRow(parentRow);
        }
      }
    } else if (event.key === 'F2' && selectedItem) {
      event.preventDefault();
      startRenameItem(selectedItem);
    } else if (event.key === 'Delete' && selectedItem) {
      event.preventDefault();
      requestDeleteItem(selectedItem);
    } else if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'n') {
      event.preventDefault();
      const parentPath = event.shiftKey
        ? (selectedItem?.file.isDirectory ? selectedItem.path : selectedItem?.parentPath) ?? workspaceDir
        : (selectedItem?.file.isDirectory ? selectedItem.path : selectedItem?.parentPath) ?? workspaceDir;
      if (!parentPath) return;
      if (event.shiftKey) {
        handleCreateFolder(parentPath);
      } else {
        handleCreateFile(parentPath);
      }
    } else if (event.key === 'F5') {
      event.preventDefault();
      handleRefresh();
    }
  };

  const handleTreeWheel = (event: React.WheelEvent<HTMLDivElement>) => {
    const target = treeRef.current;
    if (!target) return;

    const maxTop = target.scrollHeight - target.clientHeight;
    const maxLeft = target.scrollWidth - target.clientWidth;
    if (maxTop <= 0 && maxLeft <= 0) return;

    const preferVertical = Math.abs(event.deltaY) >= Math.abs(event.deltaX);
    if (preferVertical && maxTop > 0) {
      const before = target.scrollTop;
      target.scrollTop = Math.max(0, Math.min(maxTop, target.scrollTop + event.deltaY));
      if (target.scrollTop !== before) {
        event.preventDefault();
        event.stopPropagation();
      }
      return;
    }

    if (maxLeft > 0) {
      const before = target.scrollLeft;
      target.scrollLeft = Math.max(0, Math.min(maxLeft, target.scrollLeft + event.deltaX));
      if (target.scrollLeft !== before) {
        event.preventDefault();
        event.stopPropagation();
      }
    }
  };

  const handleContextMenuKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const menuItems = Array.from(
      contextMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
    if (!menuItems.length) return;

    event.preventDefault();
    const activeIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') {
      menuItems[0].focus();
      return;
    }
    if (event.key === 'End') {
      menuItems[menuItems.length - 1].focus();
      return;
    }

    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = activeIndex < 0
      ? 0
      : (activeIndex + delta + menuItems.length) % menuItems.length;
    menuItems[nextIndex].focus();
  };

  // Context Menu Actions
  const openCreatePrompt = (type: 'file' | 'folder', parentPath: string) => {
    setPromptState({ type, parentPath });
    setPromptValue('');
    closeContextMenu();
  };

  const handleCreateFile = (parentPath?: string) => {
    const targetPath = parentPath ?? (contextMenu
      ? contextMenu.file.isDirectory ? getFullPath(contextMenu.file, contextMenu.parentPath) : contextMenu.parentPath
      : workspaceDir);
    if (!targetPath) return;
    openCreatePrompt('file', targetPath);
  };

  const handleCreateFolder = (parentPath?: string) => {
    const targetPath = parentPath ?? (contextMenu
      ? contextMenu.file.isDirectory ? getFullPath(contextMenu.file, contextMenu.parentPath) : contextMenu.parentPath
      : workspaceDir);
    if (!targetPath) return;
    openCreatePrompt('folder', targetPath);
  };

  const handleRefresh = () => {
    refreshWorkspace();
  };

  const handleOpenRootTerminal = () => {
    if (!workspaceDir) return;
    const folderName = workspaceDir.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
    addPane('terminal', `Terminal: ${folderName}`, { cwd: workspaceDir });
  };

  const handleRename = () => {
    if (!contextMenu) return;
    startRenameItem({
      path: getFullPath(contextMenu.file, contextMenu.parentPath),
      file: contextMenu.file,
      parentPath: contextMenu.parentPath,
    });
  };

  const handleDelete = async () => {
    if (!contextMenu) return;
    const item = {
      path: getFullPath(contextMenu.file, contextMenu.parentPath),
      file: contextMenu.file,
      parentPath: contextMenu.parentPath,
    };
    requestDeleteItem(item);
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
    const relative = relativeWorkspacePath(workspaceDir, path) ?? path;
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
    const destPath = joinWorkspacePath(targetDir, fileName);
    closeContextMenu();

    try {
      if (clipboard.isCut) {
        await invoke('workspace_move', { src: clipboard.path, dest: destPath });
        syncRenamedEditorPanes(clipboard.path, destPath, fileName);
        setClipboard(null);
      } else {
        await invoke('workspace_copy', { src: clipboard.path, dest: destPath });
      }
      refreshWorkspace();
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

  const handleOpenTerminalHere = () => {
    if (!contextMenu) return;
    const targetPath = contextMenu.file.isDirectory ? getFullPath(contextMenu.file, contextMenu.parentPath) : contextMenu.parentPath;
    const folderName = targetPath.split(/[\\/]/).filter(Boolean).pop() || 'Workspace';
    closeContextMenu();
    addPane('terminal', `Terminal: ${folderName}`, { cwd: targetPath });
  };

  const submitPrompt = async () => {
    if (!promptState) return;
    const nextName = cleanPromptName(promptValue);
    if (!nextName) return;

    try {
      if (promptState.type === 'file') {
        const nextPath = joinWorkspacePath(promptState.parentPath, nextName);
        await invoke('workspace_create_file', { parentPath: promptState.parentPath, name: nextName });
        setSelectedItem({
          path: nextPath,
          parentPath: promptState.parentPath,
          file: { name: nextName, isDirectory: false, isFile: true },
        });
        addPane('editor', nextName, { filePath: nextPath });
      } else if (promptState.type === 'folder') {
        const nextPath = joinWorkspacePath(promptState.parentPath, nextName);
        await invoke('workspace_create_dir', { parentPath: promptState.parentPath, name: nextName });
        setSelectedItem({
          path: nextPath,
          parentPath: promptState.parentPath,
          file: { name: nextName, isDirectory: true, isFile: false },
        });
      } else if (promptState.type === 'rename') {
        const oldPath = joinWorkspacePath(promptState.parentPath, promptState.fileName ?? '');
        const newPath = joinWorkspacePath(promptState.parentPath, nextName);
        await invoke('workspace_rename', { targetPath: oldPath, newName: nextName });
        syncRenamedEditorPanes(oldPath, newPath, nextName);
      }
      setPromptState(null);
      refreshWorkspace();
    } catch (err) {
      alert(`Operation failed: ${err}`);
    }
  };

  if (!workspaceDir) {
    return (
      <div className={iconOnly ? 'td-sidebar-empty-icon-only' : 'flex flex-col items-center justify-center h-full text-center gap-3 px-4'}>
        {!iconOnly && <Folder size={28} className="text-text-muted opacity-20" />}
        {!iconOnly && <p className="text-xs text-text-muted">No folder open</p>}
        <button
          type="button"
          onClick={handleOpenFolder}
          className={iconOnly ? 'td-sidebar-open-folder-button' : 'px-3 py-1.5 rounded-md bg-accent-primary hover:bg-accent-hover text-accent-text text-xs font-medium transition-colors'}
          title="Open Folder"
          aria-label="Open Folder"
        >
          {iconOnly ? <Folder size={11} strokeWidth={1.9} /> : 'Open Folder'}
        </button>
      </div>
    );
  }

  const isRoot = contextMenu?.file.name === '' && contextMenu?.parentPath === workspaceDir;

  return (
    <div
      className="flex h-full min-h-0 flex-col relative outline-none"
      tabIndex={0}
      role="tree"
      aria-label="Workspace files"
      onKeyDown={handleTreeKeyDown}
      onContextMenu={(e) => {
      // Background right-click targets root
      handleContextMenu(e, { name: '', isDirectory: true, isFile: false }, workspaceDir);
    }}>
      <div 
        className={`inline-flex items-center ${iconOnly ? 'td-sidebar-icon-only-item td-sidebar-root-icon' : 'w-full justify-between px-3 py-2 border-b border-border-panel'} text-xs text-text-muted shrink-0 cursor-pointer hover:background-bg-surface transition-colors group select-none`}
        onContextMenu={(e) => {
          e.stopPropagation();
          handleContextMenu(e, { name: '', isDirectory: true, isFile: false }, workspaceDir);
        }}
        onClick={handleOpenFolder}
        title={workspaceDir.split(/[\\/]/).pop() || workspaceDir}
      >
        {!iconOnly && <span className="truncate font-bold text-text-secondary opacity-70 uppercase tracking-wider text-[10px]">
          {workspaceDir.split(/[\\/]/).pop()}
        </span>}
        <FolderTypeIcon folderName={workspaceDir.split(/[\\/]/).pop() || workspaceDir} expanded size={iconOnly ? 12 : 13} className="opacity-80 transition-colors shrink-0" />
      </div>

      {!iconOnly && <div
        className="flex items-center gap-1 px-2 py-1.5 shrink-0 border-b border-border-panel"
        onContextMenu={(e) => {
          e.stopPropagation();
          handleContextMenu(e, { name: '', isDirectory: true, isFile: false }, workspaceDir);
        }}
      >
        <ExplorerToolButton title="New File" onClick={() => handleCreateFile(workspaceDir)} icon={<FilePlus size={13} />} />
        <ExplorerToolButton title="New Folder" onClick={() => handleCreateFolder(workspaceDir)} icon={<FolderPlus size={13} />} />
        <ExplorerToolButton title="Refresh Explorer" onClick={handleRefresh} icon={<RefreshCw size={13} />} />
        <ExplorerToolButton title="Open Terminal Here" onClick={handleOpenRootTerminal} icon={<TerminalIcon size={13} />} />
        <ExplorerToolButton title="Change Folder" onClick={handleOpenFolder} icon={<FolderOpen size={13} />} className="ml-auto" />
      </div>}
      
      <div ref={treeRef} onWheel={handleTreeWheel} className={`min-h-0 flex-1 overflow-auto overscroll-contain ${iconOnly ? 'p-1' : 'p-2'} custom-scrollbar`}>
        <div className="pb-4">
          {files.map(file => (
            <TreeNode
              key={file.name}
              file={file}
              parentPath={workspaceDir}
              locks={locks}
              refreshSignal={refreshSignal}
              selectedPath={selectedItem?.path ?? null}
              onSelect={setSelectedItem}
              onContextMenu={handleContextMenu}
              iconOnly={iconOnly}
            />
          ))}
        </div>
      </div>

      {/* Context Menu Overlay */}
      {contextMenu && (
        <div 
          ref={contextMenuRef}
          className="fixed z-[1000] background-bg-panel border border-border-panel rounded shadow-xl py-1 min-w-[180px] text-xs text-text-secondary animate-in fade-in zoom-in duration-75"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          role="menu"
          aria-label={isRoot ? 'Workspace actions' : `${contextMenu.file.name || 'Workspace'} actions`}
          onClick={e => e.stopPropagation()}
          onContextMenu={e => e.preventDefault()}
          onKeyDown={handleContextMenuKeyDown}
        >
          {contextMenu.file.isDirectory ? (
            <>
              <ContextMenuItem icon={<FilePlus size={12}/>} label="New File" onClick={handleCreateFile} />
              <ContextMenuItem icon={<FolderPlus size={12}/>} label="New Folder" onClick={handleCreateFolder} />
              <div className="h-px bg-border-panel my-1" />
              <ContextMenuItem icon={<Search size={12}/>} label="Find in Folder..." onClick={handleFindInFolder} />
              <ContextMenuItem icon={<TerminalIcon size={12}/>} label="Open Terminal Here" onClick={handleOpenTerminalHere} />
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

      {deleteConfirmItem && (
        <div className="absolute inset-x-2 top-10 z-50 rounded border border-red-500/40 bg-bg-panel p-2 shadow-xl">
          <div className="text-[11px] font-semibold text-text-primary">Delete {deleteConfirmItem.file.name}?</div>
          <div className="mt-1 truncate text-[10px] text-text-muted" title={deleteConfirmItem.path}>{deleteConfirmItem.path}</div>
          <div className="mt-2 flex justify-end gap-2">
            <button
              type="button"
              className="rounded border border-border-panel px-2 py-1 text-[10px] text-text-secondary hover:bg-bg-surface"
              onClick={() => setDeleteConfirmItem(null)}
            >
              Cancel
            </button>
            <button
              type="button"
              className="rounded border border-red-500/40 bg-red-500/10 px-2 py-1 text-[10px] text-red-300 hover:bg-red-500/20"
              onClick={() => void confirmDeleteItem()}
            >
              Delete
            </button>
          </div>
        </div>
      )}

      {/* Prompt Overlay */}
      {promptState && (
        <div className="absolute top-8 left-2 right-2 z-50 background-bg-panel border border-accent-primary rounded shadow-lg p-2">
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
            className="w-full background-bg-surface border border-border-panel rounded px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-primary"
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
      type="button"
      role="menuitem"
      onClick={() => !disabled && onClick()}
      disabled={disabled}
      aria-disabled={disabled || undefined}
      className={`w-full flex items-center gap-2 px-3 py-1.5 hover:background-bg-surface transition-colors text-left disabled:opacity-30 disabled:hover:bg-transparent ${className}`}
    >
      <span className="shrink-0">{icon}</span>
      <span className="flex-1 truncate">{label}</span>
    </button>
  );
}

function ExplorerToolButton({ icon, title, onClick, className = '' }: { icon: React.ReactNode, title: string, onClick: () => void, className?: string }) {
  return (
    <button
      type="button"
      title={title}
      aria-label={title}
      onClick={(event) => {
        event.stopPropagation();
        onClick();
      }}
      className={`h-6 w-6 inline-flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:background-bg-surface transition-colors ${className}`}
    >
      {icon}
    </button>
  );
}
