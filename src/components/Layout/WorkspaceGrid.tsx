import { useWorkspaceStore } from '../../store/workspace';
import { TerminalPane } from '../Terminal/TerminalPane';
import { EditorPane } from '../Editor/EditorPane';
import { TaskBoardPane } from '../TaskBoard/TaskBoardPane';
import { ActivityFeedPane } from '../ActivityFeed/ActivityFeedPane';

export function WorkspaceGrid() {
  const panes = useWorkspaceStore((s) => s.panes);

  // Grid based on pane count
  let gridClass = 'grid-cols-1 grid-rows-1';
  if (panes.length === 2) {
    gridClass = 'grid-cols-2 grid-rows-1';
  } else if (panes.length >= 3) {
    gridClass = 'grid-cols-2 grid-rows-2';
  }

  return (
    <div className={`flex-1 grid ${gridClass} gap-px bg-bg-surface p-px`}>
      {panes.map((pane) => (
        <div key={pane.id} className="bg-bg-panel flex flex-col overflow-hidden relative">
          {/* Pane Header */}
          <div className="flex items-center justify-between bg-bg-surface text-xs px-3 py-1 border-b border-border-divider">
            <div className="font-semibold text-text-secondary uppercase tracking-wider">{pane.title}</div>
            <button
              onClick={() => useWorkspaceStore.getState().removePane(pane.id)}
              className="text-text-muted hover:text-red-400 font-bold"
            >
              ×
            </button>
          </div>
          
          {/* Pane Content */}
          <div className="flex-1 overflow-hidden">
            {pane.type === 'terminal' && <TerminalPane title={pane.title} initialCommand={pane.data?.initialCommand} />}
            {pane.type === 'editor' && <EditorPane title={pane.title} filePath={pane.data?.filePath} />}
            {pane.type === 'taskboard' && <TaskBoardPane />}
            {pane.type === 'activityfeed' && <ActivityFeedPane />}
          </div>
        </div>
      ))}
    </div>
  );
}
