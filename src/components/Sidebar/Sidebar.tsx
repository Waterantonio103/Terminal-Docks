import { ChevronRight, Files } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspace';
import { FileTree } from './FileTree';

export function Sidebar() {
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen);

  if (!sidebarOpen) return null;

  return (
    <aside className="w-64 shrink-0 h-full border-r border-border-panel bg-bg-panel overflow-hidden flex flex-col">
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-panel shrink-0">
        <div className="flex items-center gap-2 min-w-0">
          <Files size={14} className="text-accent-primary shrink-0" />
          <span className="text-xs font-semibold text-text-muted uppercase tracking-widest truncate">
            Workspace
          </span>
        </div>
        <ChevronRight size={13} className="text-text-muted opacity-40" />
      </div>
      <div className="flex-1 overflow-hidden">
        <FileTree />
      </div>
    </aside>
  );
}
