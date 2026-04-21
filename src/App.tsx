import { Sidebar } from './components/Sidebar/Sidebar';
import { WorkspaceGrid } from './components/Layout/WorkspaceGrid';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { NodeTreePane } from './components/NodeTree/NodeTreePane';
import { useWorkspaceStore, PaneType, McpMessage, DbTask } from './store/workspace';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { homeDir } from '@tauri-apps/api/path';
import { Window } from '@tauri-apps/api/window';
import { PanelLeft, TerminalSquare, FileCode2, KanbanSquare, Activity, Palette, Plus, Rocket, Monitor, Minus, Square, X, Network } from 'lucide-react';
import { useState, useEffect, useRef } from 'react';
import './App.css';

// Safe access to window
const appWindow = typeof window !== 'undefined' ? Window.getCurrent() : null;

const PANE_ICONS: Record<PaneType, React.ReactNode> = {
  terminal:     <TerminalSquare size={13} />,
  editor:       <FileCode2 size={13} />,
  taskboard:    <KanbanSquare size={13} />,
  activityfeed: <Activity size={13} />,
  launcher:       <Rocket size={13} />,
  missioncontrol: <Monitor size={13} />,
  nodetree:       <Network size={13} />,
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
  onDragStart: (type: PaneType, e: React.MouseEvent) => void;
}

function DraggableOption({ type, label, icon, onClick, onDragStart }: DraggableOptionProps) {
  return (
    <button
      onMouseDown={(e) => onDragStart(type, e)}
      onClick={onClick}
      data-tauri-no-drag
      className="flex items-center gap-1.5 text-xs text-text-muted hover:text-text-primary hover:bg-bg-surface-hover px-2.5 py-1 rounded-md transition-colors cursor-grab active:cursor-grabbing"
      title={`Drag to create new ${label}`}
    >
      {icon}
      <span>{label}</span>
    </button>
  );
}

function App() {
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const sidebarOpen   = useWorkspaceStore((s) => s.sidebarOpen);
  const activeSidebarTab = useWorkspaceStore((s) => s.activeSidebarTab);
  const addPane         = useWorkspaceStore((s) => s.addPane);
  const theme        = useWorkspaceStore((s) => s.theme);
  const setTheme     = useWorkspaceStore((s) => s.setTheme);
  const tabs         = useWorkspaceStore((s) => s.tabs);
  const activeTabId  = useWorkspaceStore((s) => s.activeTabId);
  const addTab       = useWorkspaceStore((s) => s.addTab);
  const removeTab    = useWorkspaceStore((s) => s.removeTab);
  const switchTab    = useWorkspaceStore((s) => s.switchTab);
  const renameTab    = useWorkspaceStore((s) => s.renameTab);
  const addMessage      = useWorkspaceStore((s) => s.addMessage);
  const addResult       = useWorkspaceStore((s) => s.addResult);
  const setTasks        = useWorkspaceStore((s) => s.setTasks);
  const workspaceDir    = useWorkspaceStore((s) => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore((s) => s.setWorkspaceDir);
  const globalGraph     = useWorkspaceStore((s) => s.globalGraph);
  const setGlobalGraph  = useWorkspaceStore((s) => s.setGlobalGraph);

  // Default terminal working directory to home folder on first launch
  useEffect(() => {
    if (!workspaceDir) {
      homeDir().then(dir => setWorkspaceDir(dir)).catch(() => {});
    }
  }, []);

  // Load tasks from SQLite on startup
  useEffect(() => {
    invoke<DbTask[]>('get_tasks').then(setTasks).catch(() => {});
  }, []);

  const [draggingNew, setDraggingNew] = useState<{ type: PaneType; x: number; y: number; label?: string; data?: any } | null>(null);

  // Global MCP Message Listener
  useEffect(() => {
    const unlisten = listen<McpMessage>('mcp-message', (event) => {
      const msg = event.payload;
      if (msg.type === 'task_update') {
        // A task was created or updated — refresh from SQLite
        invoke<DbTask[]>('get_tasks').then(setTasks).catch(() => {});
        return;
      }
      if (msg.type.startsWith('result:')) {
        const type = msg.type === 'result:url' ? 'url' : 'markdown';
        addResult({
          id: msg.id,
          agentId: msg.from,
          content: msg.content,
          type,
          timestamp: msg.timestamp,
        });
      } else {
        addMessage(msg);
      }
    });
    return () => { unlisten.then(f => f()); };
  }, [addMessage, addResult, setTasks]);

  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const tabInputRef = useRef<HTMLInputElement>(null);

  // Global mouse handlers for custom dragging
  useEffect(() => {
    if (!draggingNew) return;

    function onMouseMove(e: MouseEvent) {
      setDraggingNew(prev => prev ? { ...prev, x: e.clientX, y: e.clientY } : null);
    }

    function onMouseUp() {
      setDraggingNew(null);
    }

    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [draggingNew]);

  function onNewPaneDragStart(type: PaneType, e: React.MouseEvent) {
    setDraggingNew({
      type,
      x: e.clientX,
      y: e.clientY,
      label: PANE_ICONS[type] ? type : undefined
    });
  }

  return (
    <div className={`flex flex-col h-screen overflow-hidden theme-${theme} bg-bg-app text-text-primary font-sans select-none`}>
      
      {/* Top Header / Tab Bar */}
      <div className="flex items-center h-10 bg-bg-titlebar border-b border-border-panel shrink-0 select-none relative z-50">
        <div 
          className="flex items-center gap-2 px-3 border-r border-border-panel h-full cursor-pointer hover:bg-bg-surface transition-colors"
          onClick={toggleSidebar}
        >
          <PanelLeft size={16} className={sidebarOpen ? "text-accent-primary" : "text-text-muted"} />
        </div>

        <div className="flex-1 flex justify-center items-center gap-1 h-full relative z-10" data-tauri-drag-region>
          {activeSidebarTab !== 'nodetree' ? (
            <div 
              className="flex items-center gap-1 bg-bg-surface border border-border-panel rounded-lg px-1 py-0.5"
              data-tauri-no-drag
            >
              <DraggableOption type="terminal"     label="Terminal" icon={<TerminalSquare size={13} />} onClick={() => addPane('terminal', 'Terminal')} onDragStart={onNewPaneDragStart} />
              <div className="w-px h-4 bg-border-divider" />
              <DraggableOption type="editor"       label="Editor"   icon={<FileCode2 size={13} />}      onClick={() => addPane('editor', 'Editor')}   onDragStart={onNewPaneDragStart} />
              <div className="w-px h-4 bg-border-divider" />
              <DraggableOption type="taskboard"    label="Tasks"    icon={<KanbanSquare size={13} />}   onClick={() => addPane('taskboard', 'Tasks')} onDragStart={onNewPaneDragStart} />
              <div className="w-px h-4 bg-border-divider" />
              <DraggableOption type="activityfeed" label="Swarm"    icon={<Activity size={13} />}       onClick={() => addPane('activityfeed', 'Swarm')} onDragStart={onNewPaneDragStart} />
              <div className="w-px h-4 bg-border-divider" />
              <DraggableOption type="launcher"     label="Launch"   icon={<Rocket size={13} />}          onClick={() => addPane('launcher', 'Launcher')} onDragStart={onNewPaneDragStart} />
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-accent-primary uppercase tracking-widest">
               <Network size={14} />
               <span>Workflow Designer</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 relative z-10" data-tauri-drag-region>
          <div className="flex items-center gap-1.5 text-text-muted" data-tauri-no-drag>
            <Palette size={13} />
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as any)}
              className="bg-transparent border-none text-[10px] focus:outline-none cursor-pointer hover:text-text-secondary transition-colors"
            >
              {ALL_THEMES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
            </select>
          </div>

          <div className="flex items-center bg-bg-surface border border-border-panel rounded-md h-6 px-1 mr-2" data-tauri-no-drag>
            <button onClick={() => appWindow?.minimize()} className="w-6 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-panel rounded transition-colors"><Minus size={12} /></button>
            <button onClick={() => appWindow?.toggleMaximize()} className="w-6 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-panel rounded transition-colors"><Square size={10} /></button>
            <button onClick={() => appWindow?.close()} className="w-6 h-full flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"><X size={12} /></button>
          </div>
        </div>
      </div>

      {/* Main Content Area */}
      <div className="flex-1 flex overflow-hidden relative">
        <Sidebar />
        
        <main className="flex-1 flex flex-col min-w-0 bg-bg-app relative">
          
          {/* View Switcher: Node Tree takes over entire main area */}
          {activeSidebarTab === 'nodetree' ? (
             <div className="flex-1 overflow-hidden relative">
               <NodeTreePane graph={globalGraph} onGraphChange={setGlobalGraph} />
             </div>
          ) : (
            <>
              {/* Workspace Tab Bar */}
              <div
                className="flex items-center h-8 bg-bg-titlebar border-b border-border-panel px-2 gap-0.5 overflow-x-auto shrink-0 select-none relative"
                data-tauri-drag-region
              >
                {tabs.map((tab) => (
                  <div
                    key={tab.id}
                    onClick={() => switchTab(tab.id)}
                    onDoubleClick={() => {
                      setEditingTabId(tab.id);
                      setEditingTabName(tab.name);
                    }}
                    className={`
                      group flex items-center h-6 px-3 gap-2 rounded-t-md text-[11px] font-medium transition-all cursor-pointer min-w-[80px] max-w-[160px] border-x border-t relative
                      ${activeTabId === tab.id 
                        ? 'bg-bg-panel text-text-primary border-border-panel z-10 -mb-[1px]' 
                        : 'bg-transparent text-text-muted border-transparent hover:bg-bg-surface/50'}
                    `}
                  >
                    <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tab.color }} />
                    
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
                          }
                          if (e.key === 'Escape') setEditingTabId(null);
                        }}
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
                        <X size={10} />
                      </button>
                    )}
                  </div>
                ))}

                <button 
                  onClick={addTab}
                  className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface rounded transition-colors ml-1"
                  title="New Tab (Ctrl+T)"
                >
                  <Plus size={14} />
                </button>
              </div>

              <div className="flex-1 relative overflow-hidden">
                <WorkspaceGrid />
              </div>
            </>
          )}

          {/* Quick Open Overlay */}
          {showQuickOpen && <QuickOpen onClose={() => setShowQuickOpen(false)} />}
        </main>
      </div>

      {/* Drag Overlay */}
      {draggingNew && (
        <div 
          className="fixed pointer-events-none z-[9999] bg-accent-primary/20 border-2 border-accent-primary rounded-lg px-3 py-1.5 flex items-center gap-2 text-accent-primary font-bold shadow-2xl backdrop-blur-sm"
          style={{ left: draggingNew.x + 10, top: draggingNew.y + 10 }}
        >
          {PANE_ICONS[draggingNew.type]}
          <span className="text-xs uppercase tracking-wider">{draggingNew.type}</span>
        </div>
      )}
    </div>
  );
}

export default App;