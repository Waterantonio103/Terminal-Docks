import { TerminalSquare, FileCode2, KanbanSquare, Activity, Rocket, Monitor, X, Network, Inbox } from 'lucide-react';
import { useWorkspaceStore, PaneType, Pane, selectActivePanes, GridPos, resolveCollisions } from '../../store/workspace';
import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import { TerminalPane } from '../Terminal/TerminalPane';
import { EditorPane } from '../Editor/EditorPane';
import { TaskBoardPane } from '../TaskBoard/TaskBoardPane';
import { ActivityFeedPane } from '../ActivityFeed/ActivityFeedPane';
import { LauncherPane } from '../Launcher/LauncherPane';
import { MissionControlPane } from '../MissionControl/MissionControlPane';
import { InboxPane } from '../TaskBoard/InboxPane';

const PANE_ICONS: Record<PaneType, React.ReactNode> = {
  terminal:       <TerminalSquare size={13} />,
  editor:         <FileCode2 size={13} />,
  taskboard:      <KanbanSquare size={13} />,
  activityfeed:   <Activity size={13} />,
  launcher:       <Rocket size={13} />,
  missioncontrol: <Monitor size={13} />,
  nodetree:       <Network size={13} />,
  inbox:          <Inbox size={13} />,
};

const CELL_HEIGHT = 4;
const GRID_COLUMNS = 100;

interface DashboardPanelProps {
  pane: Pane;
  onDragStart: (id: string, e: React.MouseEvent) => void;
  onResizeStart: (id: string, e: React.MouseEvent) => void;
  isDragging: boolean;
  isResizing: boolean;
  anyActive: boolean;
  dragEndSeq: number;
}

const DashboardPanel = React.memo(function DashboardPanel({ pane, onDragStart, onResizeStart, isDragging, isResizing, anyActive, dragEndSeq }: DashboardPanelProps) {
  const { x, y, w, h } = pane.gridPos;
  const renamePane = useWorkspaceStore(s => s.renamePane);
  const removePane = useWorkspaceStore(s => s.removePane);

  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const inputRef = useRef<HTMLInputElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);

  const left = (x / GRID_COLUMNS) * 100;
  const width = (w / GRID_COLUMNS) * 100;
  const top = y * CELL_HEIGHT;
  const height = h * CELL_HEIGHT;

  const style: React.CSSProperties = {
    position: 'absolute',
    left: `${left}%`,
    top: `${top}px`,
    width: `${width}%`,
    height: `${height}px`,
    transition: anyActive ? 'none' : 'left 0.2s cubic-bezier(0.2, 0, 0, 1), top 0.2s cubic-bezier(0.2, 0, 0, 1), width 0.2s cubic-bezier(0.2, 0, 0, 1), height 0.2s cubic-bezier(0.2, 0, 0, 1)',
    zIndex: isDragging || isResizing ? 50 : 10,
  };

  function startEdit() {
    setDraft(pane.title);
    setEditing(true);
    setTimeout(() => inputRef.current?.select(), 20);
  }

  function commitEdit() {
    const t = draft.trim();
    if (t) renamePane(pane.id, t);
    setEditing(false);
    if (pane.type === 'terminal') {
      setTimeout(() => {
        const textarea = bodyRef.current?.querySelector<HTMLTextAreaElement>('.xterm-helper-textarea');
        textarea?.focus();
      }, 50);
    }
  }

  return (
    <div style={style} className="p-1 group">
      <div className={`w-full h-full bg-bg-app border rounded shadow-sm flex flex-col overflow-hidden transition-colors
        ${isDragging || isResizing ? 'border-accent-primary ring-2 ring-accent-primary/20 shadow-xl' : 'border-border-panel hover:border-accent-primary/50'}
      `}>
        {/* Header - Drag Handle */}
        <div 
          className="flex items-center bg-bg-titlebar border-b border-border-panel shrink-0 h-8 px-2 gap-2 cursor-grab active:cursor-grabbing select-none"
          onMouseDown={(e) => onDragStart(pane.id, e)}
        >
          <span className="text-text-muted">{PANE_ICONS[pane.type]}</span>
          {editing ? (
            <input
              ref={inputRef}
              value={draft}
              onChange={e => setDraft(e.target.value)}
              onBlur={commitEdit}
              onMouseDown={e => e.stopPropagation()}
              onKeyDown={e => {
                if (e.key === 'Enter') { e.preventDefault(); commitEdit(); }
                if (e.key === 'Escape') setEditing(false);
                e.stopPropagation();
              }}
              className="bg-bg-surface border border-accent-primary rounded px-1 text-xs text-text-primary outline-none w-[100px] h-5"
            />
          ) : (
            <span
              className="text-xs font-medium text-text-secondary truncate flex-1"
              onDoubleClick={(e) => { e.stopPropagation(); startEdit(); }}
            >
              {pane.title}
            </span>
          )}
          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
            <button
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => removePane(pane.id)}
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-bg-surface"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-hidden relative">
          {pane.type === 'terminal'       && <TerminalPane pane={pane} dragEndSeq={dragEndSeq} />}
          {pane.type === 'editor'         && <EditorPane pane={pane} />}
          {pane.type === 'taskboard'      && <TaskBoardPane />}
          {pane.type === 'activityfeed'   && <ActivityFeedPane />}
          {pane.type === 'launcher'       && <LauncherPane />}
          {pane.type === 'missioncontrol' && <MissionControlPane pane={pane} />}
          {pane.type === 'inbox'          && <InboxPane />}
        </div>

        {/* Resize Handle */}
        <div 
          className="absolute bottom-1 right-1 w-3 h-3 cursor-nwse-resize opacity-0 group-hover:opacity-100 transition-opacity z-20"
          onMouseDown={(e) => onResizeStart(pane.id, e)}
        >
          <div className="absolute bottom-0.5 right-0.5 w-1.5 h-1.5 border-r-2 border-b-2 border-text-muted/50 rounded-br-sm" />
        </div>
      </div>
    </div>
  );
});

function TabsView({ panes }: { panes: Pane[] }) {
  const activePaneId = useWorkspaceStore(s => s.activePaneId);
  const setActivePaneId = useWorkspaceStore(s => s.setActivePaneId);
  const removePane = useWorkspaceStore(s => s.removePane);
  
  const activePane = panes.find(p => p.id === activePaneId) || panes[0];

  useEffect(() => {
    if (!activePaneId && panes.length > 0) {
      setActivePaneId(panes[0].id);
    }
  }, [panes, activePaneId]);

  return (
    <div className="flex-1 flex flex-col bg-bg-app overflow-hidden">
      {/* File Tab Bar */}
      <div className="flex items-center h-9 bg-bg-titlebar border-b border-border-panel overflow-x-auto shrink-0 no-scrollbar">
        {panes.map(pane => (
          <div
            key={pane.id}
            onClick={() => setActivePaneId(pane.id)}
            className={`
              group flex items-center h-full px-3 gap-2 border-r border-border-panel cursor-pointer select-none transition-colors min-w-[120px] max-w-[200px]
              ${activePaneId === pane.id ? 'bg-bg-app border-b-2 border-b-accent-primary' : 'bg-transparent text-text-muted hover:bg-bg-surface/50 hover:text-text-secondary'}
            `}
          >
            <span className={activePaneId === pane.id ? 'text-accent-primary' : 'text-text-muted opacity-60'}>
              {PANE_ICONS[pane.type]}
            </span>
            <span className={`text-[11px] font-medium truncate flex-1 ${activePaneId === pane.id ? 'text-text-primary' : ''}`}>
              {pane.title}
            </span>
            <button
              onClick={(e) => { e.stopPropagation(); removePane(pane.id); }}
              className="opacity-0 group-hover:opacity-100 p-0.5 rounded hover:bg-bg-surface text-text-muted hover:text-red-400 transition-all"
            >
              <X size={12} />
            </button>
          </div>
        ))}
      </div>

      {/* Active Pane Content */}
      <div className="flex-1 overflow-hidden relative">
        {activePane ? (
          <div className="w-full h-full flex flex-col">
            {activePane.type === 'terminal'       && <TerminalPane pane={activePane} dragEndSeq={0} />}
            {activePane.type === 'editor'         && <EditorPane pane={activePane} />}
            {activePane.type === 'taskboard'      && <TaskBoardPane />}
            {activePane.type === 'activityfeed'   && <ActivityFeedPane />}
            {activePane.type === 'launcher'       && <LauncherPane />}
            {activePane.type === 'missioncontrol' && <MissionControlPane pane={activePane} />}
            {activePane.type === 'inbox'          && <InboxPane />}
          </div>
        ) : (
          <div className="w-full h-full flex flex-col items-center justify-center text-text-muted">
            <FileCode2 size={48} className="opacity-10 mb-4" />
            <p className="text-sm">No files open</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function WorkspaceGrid({ visibleTypes }: { visibleTypes?: PaneType[] } = {}) {
  const panes = useWorkspaceStore(selectActivePanes);
  const updatePaneLayout = useWorkspaceStore(s => s.updatePaneLayout);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const addPaneAt = useWorkspaceStore(s => s.addPaneAt);
  const layoutMode = useWorkspaceStore(s => s.layoutMode);
  
  const containerRef = useRef<HTMLDivElement>(null);
  const [containerWidth, setContainerWidth] = useState(0);
  
  const [draggingId, setDraggingId] = useState<string | null>(null);
  const [resizingId, setResizingId] = useState<string | null>(null);
  const [ghostPos, setGhostPos] = useState<GridPos | null>(null);
  const [dragEndSeq, setDragEndSeq] = useState(0);
  
  const dragInfo = useRef<{ startX: number; startY: number; startGrid: GridPos; offsetX: number; offsetY: number } | null>(null);

  // Compute live preview of collisions
  const visiblePanes = useMemo(
    () => visibleTypes ? panes.filter(pane => visibleTypes.includes(pane.type)) : panes,
    [panes, visibleTypes]
  );

  const displayPanes = useMemo(() => {
    if (!ghostPos || (!draggingId && !resizingId)) return visiblePanes;
    
    const activeId = draggingId || resizingId;
    const previewPanes = visiblePanes.map(p => 
      p.id === activeId ? { ...p, gridPos: ghostPos } : p
    );
    
    return resolveCollisions(previewPanes, activeId!);
  }, [visiblePanes, ghostPos, draggingId, resizingId]);

  useEffect(() => {
    if (!containerRef.current) return;
    const observer = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setContainerWidth(entry.contentRect.width);
      }
    });
    observer.observe(containerRef.current);
    setContainerWidth(containerRef.current.offsetWidth);
    return () => observer.disconnect();
  }, []);

  const onDragStart = useCallback((id: string, e: React.MouseEvent) => {
    const pane = panes.find(p => p.id === id);
    if (!pane || !containerRef.current) return;

    const rect = containerRef.current.getBoundingClientRect();
    const scrollTop = containerRef.current.scrollTop;
    const cellW = containerWidth / GRID_COLUMNS;

    dragInfo.current = {
      startX: e.clientX,
      startY: e.clientY,
      startGrid: { ...pane.gridPos },
      offsetX: e.clientX - rect.left - (pane.gridPos.x * cellW),
      offsetY: e.clientY - rect.top + scrollTop - (pane.gridPos.y * CELL_HEIGHT),
    };

    setDraggingId(id);
    setGhostPos(pane.gridPos);
  }, [panes, containerWidth]);

  const onResizeStart = useCallback((id: string, e: React.MouseEvent) => {
    const pane = panes.find(p => p.id === id);
    if (!pane) return;

    dragInfo.current = {
      startX: e.clientX,
      startY: e.clientY,
      startGrid: { ...pane.gridPos },
      offsetX: 0,
      offsetY: 0,
    };
    
    setResizingId(id);
    setGhostPos(pane.gridPos);
    e.stopPropagation();
  }, [panes]);

  // Handle drop of new panes from top bar or files from sidebar
  useEffect(() => {
    const grid = containerRef.current;
    if (!grid) return;

    const handleDrop = (e: any) => {
      const { type, title, data, clientX, clientY } = e.detail;
      const rect = grid.getBoundingClientRect();
      const cellW = containerWidth / GRID_COLUMNS;
      
      const mouseX = clientX - rect.left;
      const mouseY = clientY - rect.top;
      
      // Calculate drop position
      const x = Math.max(0, Math.min(GRID_COLUMNS - 25, Math.round(mouseX / cellW - 12)));
      const y = Math.max(0, Math.round(mouseY / CELL_HEIGHT - 20));

      // Check if dropped over an existing pane
      const overPane = panes.find(p => {
        const px = p.gridPos.x;
        const py = p.gridPos.y;
        const pw = p.gridPos.w;
        const ph = p.gridPos.h;
        const gridMouseX = mouseX / cellW;
        const gridMouseY = mouseY / CELL_HEIGHT;
        return gridMouseX >= px && gridMouseX <= px + pw && gridMouseY >= py && gridMouseY <= py + ph;
      });

      if (type === 'editor' && data?.filePath && overPane?.type === 'editor') {
        updatePaneData(overPane.id, { filePath: data.filePath });
      } else {
        // Add new pane at dropped position
        const newTitle = title || (type.charAt(0).toUpperCase() + type.slice(1));
        addPaneAt(type, newTitle, panes.length, { ...data, gridPos: { x, y, w: 25, h: 40 } });
      }
    };

    grid.addEventListener('pane-drop', handleDrop);
    return () => grid.removeEventListener('pane-drop', handleDrop);
  }, [panes, containerWidth, updatePaneData, addPaneAt]);

  useEffect(() => {
    if (!draggingId && !resizingId) return;

    function onMouseMove(e: MouseEvent) {
      if (!dragInfo.current || !containerRef.current) return;
      const { startX, startY, startGrid, offsetX, offsetY } = dragInfo.current;
      const rect = containerRef.current.getBoundingClientRect();
      const scrollTop = containerRef.current.scrollTop;
      const cellW = containerWidth / GRID_COLUMNS;

      if (draggingId) {
        const mouseX = e.clientX - rect.left;
        const mouseY = e.clientY - rect.top + scrollTop;

        const newX = Math.round((mouseX - offsetX) / cellW);
        const newY = Math.round((mouseY - offsetY) / CELL_HEIGHT);

        const clampedX = Math.max(0, Math.min(GRID_COLUMNS - startGrid.w, newX));
        const clampedY = Math.max(0, newY);

        setGhostPos({ ...startGrid, x: clampedX, y: clampedY });
      } else if (resizingId) {
        const dx = e.clientX - startX;
        const dy = e.clientY - startY;

        const newW = Math.max(2, Math.round((startGrid.w * cellW + dx) / cellW));
        const newH = Math.max(2, Math.round((startGrid.h * CELL_HEIGHT + dy) / CELL_HEIGHT));

        const clampedW = Math.min(GRID_COLUMNS - startGrid.x, newW);

        setGhostPos(prev => {
          if (prev && prev.x === startGrid.x && prev.y === startGrid.y && prev.w === clampedW && prev.h === newH) return prev;
          return { ...startGrid, w: clampedW, h: newH };
        });
      }
    }

    const handleMouseUp = (e: MouseEvent) => {
      if (dragInfo.current && containerRef.current && (draggingId || resizingId)) {
        const { startX, startY, startGrid, offsetX, offsetY } = dragInfo.current;
        const rect = containerRef.current.getBoundingClientRect();
        const scrollTop = containerRef.current.scrollTop;
        const cellW = containerWidth / GRID_COLUMNS;
        const id = (draggingId || resizingId)!;

        let finalGridPos: GridPos;

        if (draggingId) {
          const mouseX = e.clientX - rect.left;
          const mouseY = e.clientY - rect.top + scrollTop;
          const newX = Math.round((mouseX - offsetX) / cellW);
          const newY = Math.round((mouseY - offsetY) / CELL_HEIGHT);
          finalGridPos = {
            ...startGrid,
            x: Math.max(0, Math.min(GRID_COLUMNS - startGrid.w, newX)),
            y: Math.max(0, newY)
          };
        } else {
          const dx = e.clientX - startX;
          const dy = e.clientY - startY;
          const newW = Math.max(2, Math.round((startGrid.w * cellW + dx) / cellW));
          const newH = Math.max(2, Math.round((startGrid.h * CELL_HEIGHT + dy) / CELL_HEIGHT));
          finalGridPos = {
            ...startGrid,
            w: Math.min(GRID_COLUMNS - startGrid.x, newW),
            h: newH
          };
        }

        updatePaneLayout(id, finalGridPos);
      }
      
      setDraggingId(null);
      setResizingId(null);
      setGhostPos(null);
      dragInfo.current = null;
      setDragEndSeq(n => n + 1);
    };

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', handleMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', handleMouseUp);
    };
  }, [draggingId, resizingId, containerWidth, updatePaneLayout]);

  if (layoutMode === 'tabs') {
    return <TabsView panes={visiblePanes} />;
  }

  const totalHeight = displayPanes.reduce((max, p) => Math.max(max, p.gridPos.y + p.gridPos.h), 0) * CELL_HEIGHT + 400;

  return (
    <div 
      id="workspace-grid"
      className="flex-1 bg-bg-app overflow-y-auto relative p-2 select-none" 
      ref={containerRef}
    >
      <div 
        className="relative w-full" 
        style={{ height: `${totalHeight}px` }}
      >
        {/* Grid lines (only in "edit" mode - simulating with dragging/resizing state) */}
        {(draggingId || resizingId) && (
          <div className="absolute inset-0 pointer-events-none opacity-10">
            {Array.from({ length: GRID_COLUMNS + 1 }).map((_, i) => (
              <div 
                key={i} 
                className="absolute top-0 bottom-0 border-l border-dashed border-text-muted" 
                style={{ left: `${(i / GRID_COLUMNS) * 100}%` }} 
              />
            ))}
            {Array.from({ length: Math.ceil(totalHeight / CELL_HEIGHT) }).map((_, i) => (
              <div 
                key={i} 
                className="absolute left-0 right-0 border-t border-dashed border-text-muted" 
                style={{ top: `${i * CELL_HEIGHT}px` }} 
              />
            ))}
          </div>
        )}

        {/* Ghost / Placeholder */}
        {ghostPos && (
          <div 
            className="absolute p-1 z-0"
            style={{
              left: `${(ghostPos.x / GRID_COLUMNS) * 100}%`,
              top: `${ghostPos.y * CELL_HEIGHT}px`,
              width: `${(ghostPos.w / GRID_COLUMNS) * 100}%`,
              height: `${ghostPos.h * CELL_HEIGHT}px`,
            }}
          >
            <div className="w-full h-full border-2 border-dashed border-accent-primary/40 rounded bg-accent-primary/5" />
          </div>
        )}

        {/* Panels */}
        {displayPanes.map(pane => (
          <DashboardPanel
            key={pane.id}
            pane={pane}
            onDragStart={onDragStart}
            onResizeStart={onResizeStart}
            isDragging={draggingId === pane.id}
            isResizing={resizingId === pane.id}
            anyActive={!!(draggingId || resizingId)}
            dragEndSeq={dragEndSeq}
          />
        ))}
      </div>
    </div>
  );
}
