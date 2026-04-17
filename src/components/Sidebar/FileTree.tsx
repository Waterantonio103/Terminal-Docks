import { useState, useEffect } from 'react';
import { useWorkspaceStore } from '../../store/workspace';
import { open } from '@tauri-apps/plugin-dialog';
import { readDir, DirEntry } from '@tauri-apps/plugin-fs';
import { Folder, File, ChevronRight, ChevronDown } from 'lucide-react';

function TreeNode({ file, parentPath }: { file: DirEntry, parentPath: string }) {
  const [isOpen, setIsOpen] = useState(false);
  const [children, setChildren] = useState<DirEntry[]>([]);
  const addPane = useWorkspaceStore(s => s.addPane);

  const fullPath = parentPath + (parentPath.endsWith('/') || parentPath.endsWith('\\') ? '' : '/') + file.name;

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

  return (
    <div className="pl-2">
      <div 
        className="flex items-center space-x-1 py-1 hover:bg-bg-surface cursor-pointer rounded text-sm px-1"
        onClick={handleClick}
      >
        {file.isDirectory ? (
          <>
            {isOpen ? <ChevronDown size={14} className="shrink-0" /> : <ChevronRight size={14} className="shrink-0" />}
            <Folder size={14} className="text-accent-primary shrink-0" />
          </>
        ) : (
          <>
             <span className="w-[14px] shrink-0"></span>
             <File size={14} className="text-text-muted shrink-0" />
          </>
        )}
        <span className="truncate" title={file.name}>{file.name}</span>
      </div>
      {isOpen && file.isDirectory && children.map(child => (
        <TreeNode key={child.name} file={child} parentPath={fullPath} />
      ))}
    </div>
  );
}

export function FileTree() {
  const workspaceDir = useWorkspaceStore(s => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore(s => s.setWorkspaceDir);
  const [files, setFiles] = useState<DirEntry[]>([]);

  const handleOpenFolder = async () => {
    const selected = await open({
      directory: true,
      multiple: false,
    });
    if (selected && typeof selected === 'string') {
      setWorkspaceDir(selected);
    }
  };

  useEffect(() => {
    if (workspaceDir) {
      readDir(workspaceDir).then(f => {
        f.sort((a, b) => {
          if (a.isDirectory === b.isDirectory) return a.name.localeCompare(b.name);
          return a.isDirectory ? -1 : 1;
        });
        setFiles(f);
      }).catch(console.error);
    }
  }, [workspaceDir]);

  if (!workspaceDir) {
    return (
      <div className="p-4 flex flex-col items-center justify-center text-center space-y-3 h-full">
        <p className="text-sm text-text-muted">No workspace open</p>
        <button 
          onClick={handleOpenFolder}
          className="px-3 py-1.5 bg-accent-primary hover:bg-accent-hover text-accent-text rounded text-sm transition-colors"
        >
          Open Folder
        </button>
      </div>
    );
  }

  return (
    <div className="flex-1 overflow-y-auto p-2">
      <div className="text-xs font-semibold text-text-muted uppercase tracking-wider mb-2 px-2 flex justify-between items-center">
        <span>Explorer</span>
        <button className="text-text-muted hover:text-accent-text" onClick={handleOpenFolder} title="Open Folder">
          <Folder size={14} />
        </button>
      </div>
      <div className="pb-4">
        {files.map(file => (
          <TreeNode key={file.name} file={file} parentPath={workspaceDir} />
        ))}
      </div>
    </div>
  );
}
