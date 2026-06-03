import { useState } from 'react';
import { ChevronLeft, Files } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspace';
import { FileTree } from './FileTree';

export function Sidebar() {
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen);
  const [collapsed, setCollapsed] = useState(false);

  if (!sidebarOpen) return null;

  return (
    <aside className={`${collapsed ? 'w-12' : 'w-64'} shrink-0 h-full border-r border-border-panel background-bg-panel overflow-hidden flex flex-col transition-[width] duration-150`}>
      <div className={`flex items-center ${collapsed ? 'justify-center px-0' : 'justify-between px-3'} py-2 border-b border-border-panel shrink-0`}>
        {collapsed ? (
          <button
            type="button"
            className="td-sidebar-collapsed-workspace-button"
            onClick={() => setCollapsed(false)}
            title="Expand workspace"
            aria-label="Expand workspace"
          >
            <Files size={13} />
          </button>
        ) : (
          <>
            <div className="flex items-center gap-2 min-w-0">
              <Files size={14} className="text-accent-primary shrink-0" />
              <span className="text-xs font-semibold text-text-muted uppercase tracking-widest truncate">
                Workspace
              </span>
            </div>
            <button
              type="button"
              className="flex h-6 w-6 items-center justify-center rounded-md text-text-muted opacity-70 hover:background-bg-surface hover:text-text-primary hover:opacity-100"
              onClick={() => setCollapsed(true)}
              title="Collapse workspace"
              aria-label="Collapse workspace"
            >
              <ChevronLeft size={13} />
            </button>
          </>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-hidden">
        <FileTree iconOnly={collapsed} />
      </div>
    </aside>
  );
}
