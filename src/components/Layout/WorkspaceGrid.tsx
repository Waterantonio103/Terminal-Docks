import { TerminalSquare, FileCode2, KanbanSquare, Activity, X } from 'lucide-react';
import { useWorkspaceStore, PaneType, Pane, selectActivePanes } from '../../store/workspace';
import { TerminalPane } from '../Terminal/TerminalPane';
import { EditorPane } from '../Editor/EditorPane';
import { TaskBoardPane } from '../TaskBoard/TaskBoardPane';
import { ActivityFeedPane } from '../ActivityFeed/ActivityFeedPane';
import {
  SortableContext,
  rectSortingStrategy,
  useSortable,
} from '@dnd-kit/sortable';
import { CSS } from '@dnd-kit/utilities';

const PANE_ICONS: Record<PaneType, React.ReactNode> = {
  terminal:     <TerminalSquare size={13} />,
  editor:       <FileCode2 size={13} />,
  taskboard:    <KanbanSquare size={13} />,
  activityfeed: <Activity size={13} />,
};

interface SortablePaneProps {
  pane: Pane;
  isDragging?: boolean;
}

function SortablePane({ pane, isDragging }: SortablePaneProps) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isOver,
  } = useSortable({ id: pane.id });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    opacity: isDragging ? 0.3 : 1,
    zIndex: isDragging ? 0 : 1,
  };

  return (
    <div
      ref={setNodeRef}
      style={style}
      className={`bg-bg-panel flex flex-col overflow-hidden relative group transition-shadow ${
        isOver && !isDragging ? 'ring-2 ring-accent-primary ring-inset z-20 shadow-lg shadow-accent-primary/20' : ''
      }`}
    >
      {/* Pane Tab Bar */}
      <div className="flex items-center bg-bg-titlebar border-b border-border-panel shrink-0 h-8 px-1 gap-0.5">
        <div 
          {...attributes} 
          {...listeners}
          className="flex items-center gap-1.5 px-3 py-1 rounded-t text-xs bg-bg-panel border border-border-panel border-b-transparent -mb-px relative z-10 text-text-secondary cursor-grab active:cursor-grabbing hover:bg-bg-surface transition-colors"
        >
          <span className="text-text-muted">{PANE_ICONS[pane.type]}</span>
          <span className="max-w-[120px] truncate font-medium">{pane.title}</span>
        </div>
        <div className="flex-1" />
        <button
          onClick={() => useWorkspaceStore.getState().removePane(pane.id)}
          className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-bg-surface transition-colors mr-1"
          title="Close pane"
        >
          <X size={12} />
        </button>
      </div>

      {/* Pane Content */}
      <div className="flex-1 overflow-hidden pointer-events-auto">
        {pane.type === 'terminal'     && <TerminalPane pane={pane} />}
        {pane.type === 'editor'       && <EditorPane pane={pane} />}
        {pane.type === 'taskboard'    && <TaskBoardPane />}
        {pane.type === 'activityfeed' && <ActivityFeedPane />}
      </div>
      
      {/* Drop indicator highlighting */}
      {isOver && !isDragging && (
        <div className="absolute inset-0 bg-accent-primary/15 pointer-events-none border-2 border-dashed border-accent-primary z-50 backdrop-blur-[2px] flex items-center justify-center">
           <div className="bg-accent-primary text-accent-text px-3 py-1.5 rounded-full text-[10px] font-bold uppercase tracking-widest shadow-lg shadow-accent-primary/40 animate-bounce">
              Drop Here
           </div>
        </div>
      )}
    </div>
  );
}

interface WorkspaceGridProps {
  activeId: string | null;
}

export function WorkspaceGrid({ activeId }: WorkspaceGridProps) {
  const panes = useWorkspaceStore(selectActivePanes);

  const getGridClass = (count: number) => {
    if (count <= 1) return 'grid-cols-1 grid-rows-1';
    if (count === 2) return 'grid-cols-2 grid-rows-1';
    if (count === 3) return 'grid-cols-3 grid-rows-1';
    if (count === 4) return 'grid-cols-2 grid-rows-2';
    if (count <= 6) return 'grid-cols-3 grid-rows-2';
    return 'grid-cols-4 grid-rows-2';
  };

  const gridClass = getGridClass(panes.length);

  if (panes.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center bg-bg-app text-text-muted gap-4 border-2 border-dashed border-border-panel m-6 rounded-2xl">
        <div className="p-4 bg-bg-surface rounded-full opacity-40">
           <TerminalSquare size={48} />
        </div>
        <div className="text-center">
          <p className="text-base font-medium text-text-primary opacity-60">Workspace Empty</p>
          <p className="text-sm opacity-40">Drag an option from the top bar to create a new pane.</p>
        </div>
      </div>
    );
  }

  return (
    <div className={`flex-1 grid ${gridClass} gap-px bg-border-panel`}>
      <SortableContext items={panes.map((p) => p.id)} strategy={rectSortingStrategy}>
        {panes.map((pane) => (
          <SortablePane key={pane.id} pane={pane} isDragging={activeId === pane.id} />
        ))}
      </SortableContext>
    </div>
  );
}
