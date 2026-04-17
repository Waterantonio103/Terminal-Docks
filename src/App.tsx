import { Sidebar } from './components/Sidebar/Sidebar';
import { WorkspaceGrid } from './components/Layout/WorkspaceGrid';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { useWorkspaceStore, PaneType, selectActivePanes } from './store/workspace';
import { PanelLeft, TerminalSquare, FileCode2, KanbanSquare, Activity, Palette, Plus } from 'lucide-react';
import {
  DndContext,
  closestCenter,
  KeyboardSensor,
  PointerSensor,
  useSensor,
  useSensors,
  DragOverlay,
  defaultDropAnimationSideEffects,
  DragEndEvent,
  DragStartEvent,
  useDraggable,
} from '@dnd-kit/core';
import { sortableKeyboardCoordinates } from '@dnd-kit/sortable';
import { useState, useEffect, useRef } from 'react';
import './App.css';

const PANE_ICONS: Record<PaneType, React.ReactNode> = {
  terminal:     <TerminalSquare size={13} />,
  editor:       <FileCode2 size={13} />,
  taskboard:    <KanbanSquare size={13} />,
  activityfeed: <Activity size={13} />,
};

const ALL_THEMES = [
  // Dark
  { value: 'dark',        label: 'BridgeSpace Dark' },
  { value: 'void',        label: 'Void' },
  { value: 'ghost',       label: 'Ghost' },
  { value: 'plasma',      label: 'Plasma' },
  { value: 'carbon',      label: 'Carbon' },
  { value: 'hex',         label: 'Hex' },
  { value: 'neon-tokyo',  label: 'Neon Tokyo' },
  { value: 'obsidian',    label: 'Obsidian' },
  { value: 'nebula',      label: 'Nebula' },
  { value: 'storm',       label: 'Storm' },
  { value: 'infrared',    label: 'Infrared' },
  { value: 'nova',        label: 'Nova' },
  { value: 'stealth',     label: 'Stealth' },
  { value: 'hologram',    label: 'Hologram' },
  { value: 'dracula',     label: 'Dracula' },
  { value: 'bridgemind',  label: 'BridgeMind' },
  { value: 'synthwave',   label: 'Synthwave' },
  { value: 'cybernetics', label: 'Cybernetics' },
  { value: 'quantum',     label: 'Quantum' },
  { value: 'mecha',       label: 'Mecha' },
  { value: 'abyss',       label: 'Abyss' },
  { value: 'nord',        label: 'Nord' },
  { value: 'ocean',       label: 'Ocean' },
  { value: 'cyberpunk',   label: 'Cyberpunk' },
  { value: 'solarized',   label: 'Solarized' },
  // Light
  { value: 'light',       label: 'Light' },
  { value: 'paper',       label: 'Paper' },
  { value: 'chalk',       label: 'Chalk' },
  { value: 'solar',       label: 'Solar' },
  { value: 'arctic',      label: 'Arctic' },
  { value: 'ivory',       label: 'Ivory' },
];

interface DraggableOptionProps {
  type: PaneType;
  label: string;
  icon: React.ReactNode;
  onClick: () => void;
}

function DraggableOption({ type, label, icon, onClick }: DraggableOptionProps) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: `new-${type}`,
    data: { type, isNew: true },
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
  } : undefined;

  return (
    <button
      ref={setNodeRef}
      style={style}
      {...listeners}
      {...attributes}
      onClick={onClick}
      className={`flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-bg-surface-hover px-2.5 py-1 rounded-md transition-colors cursor-grab active:cursor-grabbing ${isDragging ? 'opacity-50' : ''}`}
      title={`Drag to create new ${label}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function App() {
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const addPane      = useWorkspaceStore((s) => s.addPane);
  const addPaneAt    = useWorkspaceStore((s) => s.addPaneAt);
  const movePane     = useWorkspaceStore((s) => s.movePane);
  const panes        = useWorkspaceStore(selectActivePanes);
  const theme        = useWorkspaceStore((s) => s.theme);
  const setTheme     = useWorkspaceStore((s) => s.setTheme);
  const tabs         = useWorkspaceStore((s) => s.tabs);
  const activeTabId  = useWorkspaceStore((s) => s.activeTabId);
  const addTab       = useWorkspaceStore((s) => s.addTab);
  const removeTab    = useWorkspaceStore((s) => s.removeTab);
  const switchTab    = useWorkspaceStore((s) => s.switchTab);
  const renameTab    = useWorkspaceStore((s) => s.renameTab);

  const [activeId, setActiveId] = useState<string | null>(null);
  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const tabInputRef = useRef<HTMLInputElement>(null);

  // Global keyboard shortcuts
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      const mod = e.ctrlKey || e.metaKey;
      if (!mod) return;

      if (e.key === 't') {
        e.preventDefault();
        addTab();
      } else if (e.key === 'w') {
        e.preventDefault();
        removeTab(activeTabId);
      } else if (e.key === 'p') {
        e.preventDefault();
        setShowQuickOpen(true);
      } else if (e.key === 'd') {
        e.preventDefault();
        addPane('terminal', 'Terminal');
      } else if (/^[1-9]$/.test(e.key)) {
        const idx = parseInt(e.key) - 1;
        if (idx < tabs.length) {
          e.preventDefault();
          switchTab(tabs[idx].id);
        }
      }
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [tabs, activeTabId, addTab, removeTab, switchTab, addPane]);

  // Focus tab rename input
  useEffect(() => {
    if (editingTabId) setTimeout(() => tabInputRef.current?.focus(), 30);
  }, [editingTabId]);

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 5 } }),
    useSensor(KeyboardSensor, { coordinateGetter: sortableKeyboardCoordinates })
  );

  function handleDragStart(event: DragStartEvent) {
    setActiveId(event.active.id as string);
  }

  function handleDragEnd(event: DragEndEvent) {
    const { active, over } = event;
    setActiveId(null);
    if (!over) return;
    if (active.id !== over.id) {
      const activeData = active.data.current;
      if (activeData?.isNew) {
        const type = activeData.type as PaneType;
        const index = panes.findIndex((p) => p.id === over.id);
        const title = activeData.title || (type.charAt(0).toUpperCase() + type.slice(1));
        addPaneAt(type, title, index === -1 ? panes.length : index, activeData.data);
      } else {
        movePane(active.id as string, over.id as string);
      }
    }
  }

  const activePane = panes.find((p) => p.id === activeId);

  const themeClass = theme !== 'dark' ? `theme-${theme}` : '';

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragStart={handleDragStart}
      onDragEnd={handleDragEnd}
    >
      <div className={`flex flex-col h-screen w-screen bg-bg-app text-text-primary overflow-hidden ${themeClass}`}>

        {/* Title Bar */}
        <header
          className="h-9 border-b border-border-panel flex items-center px-3 bg-bg-titlebar shrink-0 select-none gap-3"
          data-tauri-drag-region
        >
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={toggleSidebar}
              className="text-text-muted hover:text-text-primary transition-colors p-1 rounded hover:bg-bg-surface"
              title="Toggle Sidebar"
            >
              <PanelLeft size={16} />
            </button>
            <div className="flex items-center gap-1.5 text-text-secondary">
              <TerminalSquare size={15} className="text-accent-primary" />
              <span className="text-xs font-semibold tracking-wide text-text-primary">BridgeSpace</span>
            </div>
          </div>

          <div className="flex-1 flex justify-center items-center gap-1" data-tauri-drag-region>
            <div className="flex items-center gap-1 bg-bg-surface border border-border-panel rounded-lg px-1 py-0.5">
              <DraggableOption type="terminal"     label="Terminal" icon={<TerminalSquare size={13} />} onClick={() => addPane('terminal', 'Terminal')} />
              <div className="w-px h-4 bg-border-divider" />
              <DraggableOption type="editor"       label="Editor"   icon={<FileCode2 size={13} />}      onClick={() => addPane('editor', 'Editor')} />
              <div className="w-px h-4 bg-border-divider" />
              <DraggableOption type="taskboard"    label="Tasks"    icon={<KanbanSquare size={13} />}   onClick={() => addPane('taskboard', 'Tasks')} />
              <div className="w-px h-4 bg-border-divider" />
              <DraggableOption type="activityfeed" label="Swarm"    icon={<Activity size={13} />}       onClick={() => addPane('activityfeed', 'Swarm')} />
            </div>
          </div>

          <div className="flex items-center gap-3 shrink-0">
            <div className="flex items-center gap-1.5 text-text-muted">
              <Palette size={13} />
              <select
                value={theme}
                onChange={(e) => setTheme(e.target.value as any)}
                className="bg-transparent border-none text-xs text-text-muted focus:outline-none cursor-pointer hover:text-text-primary transition-colors max-w-[120px]"
              >
                <optgroup label="── Dark ──">
                  {ALL_THEMES.slice(0, 25).map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </optgroup>
                <optgroup label="── Light ──">
                  {ALL_THEMES.slice(25).map(t => (
                    <option key={t.value} value={t.value}>{t.label}</option>
                  ))}
                </optgroup>
              </select>
            </div>
            <span className="text-xs text-text-muted font-mono opacity-50">v0.1.0</span>
          </div>
        </header>

        {/* Workspace Tab Bar */}
        <div className="flex items-center h-8 bg-bg-titlebar border-b border-border-panel px-2 gap-0.5 overflow-x-auto shrink-0 select-none">
          {tabs.map((tab, i) => (
            <div
              key={tab.id}
              onClick={() => switchTab(tab.id)}
              onDoubleClick={() => {
                setEditingTabId(tab.id);
                setEditingTabName(tab.name);
              }}
              className={`flex items-center gap-1.5 px-3 h-6 rounded-md text-xs relative transition-colors shrink-0 max-w-[180px] group cursor-pointer
                ${tab.id === activeTabId
                  ? 'bg-bg-panel text-text-primary'
                  : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'}`}
              title={`${tab.name} (Ctrl+${i + 1})`}
            >
              <span className="w-2 h-2 rounded-full shrink-0" style={{ background: tab.color }} />
              {editingTabId === tab.id ? (
                <input
                  ref={tabInputRef}
                  value={editingTabName}
                  onChange={(e) => setEditingTabName(e.target.value)}
                  onBlur={() => {
                    if (editingTabName.trim()) renameTab(tab.id, editingTabName.trim());
                    setEditingTabId(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      if (editingTabName.trim()) renameTab(tab.id, editingTabName.trim());
                      setEditingTabId(null);
                    } else if (e.key === 'Escape') {
                      setEditingTabId(null);
                    }
                    e.stopPropagation();
                  }}
                  onClick={(e) => e.stopPropagation()}
                  className="bg-transparent border-none outline-none text-xs w-[100px] text-text-primary"
                />
              ) : (
                <span className="truncate max-w-[100px]">{tab.name}</span>
              )}
              {tabs.length > 1 && (
                <button
                  onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }}
                  className="ml-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-text-muted hover:text-red-400 transition-all leading-none text-base shrink-0"
                  title="Close tab (Ctrl+W)"
                >
                  ×
                </button>
              )}
            </div>
          ))}
          <button
            onClick={addTab}
            className="flex items-center justify-center w-6 h-6 rounded text-text-muted hover:text-text-primary hover:bg-bg-surface transition-colors shrink-0 ml-1"
            title="New tab (Ctrl+T)"
          >
            <Plus size={12} />
          </button>
        </div>

        {/* Main Content */}
        <main className="flex-1 flex overflow-hidden">
          <Sidebar />
          <WorkspaceGrid activeId={activeId} />
        </main>
      </div>

      {showQuickOpen && (
        <QuickOpen onClose={() => setShowQuickOpen(false)} />
      )}

      <DragOverlay dropAnimation={{
        sideEffects: defaultDropAnimationSideEffects({
          styles: { active: { opacity: '0.5' } },
        }),
      }}>
        {activeId ? (
          activeId.startsWith('new-') ? (
            <div className={`bg-bg-panel border border-accent-primary rounded-lg px-4 py-2 shadow-2xl flex items-center gap-2 text-sm text-text-primary ring-2 ring-accent-primary/50 animate-pulse-subtle scale-110 ${themeClass}`}>
              {PANE_ICONS[activeId.replace('new-', '') as PaneType] || <FileCode2 size={13} />}
              <span>New {activeId.replace('new-', '')}</span>
            </div>
          ) : (
            activePane ? (
              <div className={`bg-bg-panel border border-accent-primary rounded shadow-2xl flex flex-col w-[300px] h-[200px] opacity-90 overflow-hidden ring-4 ring-accent-primary/20 scale-105 transition-transform shadow-accent-primary/20 ${themeClass}`}>
                <div className="flex items-center bg-bg-titlebar border-b border-border-panel shrink-0 h-8 px-3 gap-2">
                  {PANE_ICONS[activePane.type]}
                  <span className="text-xs font-semibold">{activePane.title}</span>
                </div>
                <div className="flex-1 bg-bg-panel/50 backdrop-blur-md flex items-center justify-center">
                  <div className="p-6 bg-accent-primary/10 rounded-full">
                    {PANE_ICONS[activePane.type]}
                  </div>
                </div>
              </div>
            ) : null
          )
        ) : null}
      </DragOverlay>
    </DndContext>
  );
}

export default App;
