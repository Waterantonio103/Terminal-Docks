import { Sidebar } from './components/Sidebar/Sidebar';
import { WorkspaceGrid } from './components/Layout/WorkspaceGrid';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { NodeTreePane } from './components/NodeTree/NodeTreePane';
import { RuntimeView } from './components/Runtime/RuntimeView';
import { useWorkspaceStore, PaneType, McpMessage, DbTask, type AppMode } from './store/workspace';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { homeDir } from '@tauri-apps/api/path';
import { Window } from '@tauri-apps/api/window';
import { PanelLeft, TerminalSquare, FileCode2, KanbanSquare, Activity, Palette, Plus, Rocket, Monitor, Minus, Square, X, Network, FolderTree, LayoutGrid, Maximize } from 'lucide-react';
import React, { useState, useEffect, useRef } from 'react';
import { detectRoleFromText, normalizeCli } from './lib/cliDetection';
import { refreshCliDetectionForTerminals } from './lib/terminalCliRuntime';
import { ErrorBoundary } from './components/Diagnostics/ErrorBoundary';
import { FatalErrorOverlay } from './components/Diagnostics/FatalErrorOverlay';
import { clearLastFatalReport, readBreadcrumbs, readLastFatalReport, recordBreadcrumb, stringifyUnknownError, writeFatalReport, type FatalErrorReport } from './lib/diagnostics';
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
  // Log raw localStorage workspace value
  useEffect(() => {
    const raw = localStorage.getItem('workspace-storage');
    console.log('[App Startup] Raw localStorage workspace-storage:', raw);
  }, []);

  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const sidebarOpen   = useWorkspaceStore((s) => s.sidebarOpen);
  const appMode       = useWorkspaceStore((s) => s.appMode);
  const addPane         = useWorkspaceStore((s) => s.addPane);
  const theme        = useWorkspaceStore((s) => s.theme);
  const setTheme     = useWorkspaceStore((s) => s.setTheme);
  const tabs         = useWorkspaceStore((s) => s.tabs);

  // Log tabs after rehydrate
  useEffect(() => {
    console.log('[App Startup] Tabs after rehydrate (from store):', tabs);
  }, [tabs]);
  const activeTabId  = useWorkspaceStore((s) => s.activeTabId);
  const addTab       = useWorkspaceStore((s) => s.addTab);
  const removeTab    = useWorkspaceStore((s) => s.removeTab);
  const switchTab    = useWorkspaceStore((s) => s.switchTab);
  const renameTab    = useWorkspaceStore((s) => s.renameTab);
  const addMessage      = useWorkspaceStore((s) => s.addMessage);
  const addResult       = useWorkspaceStore((s) => s.addResult);
  const setTasks        = useWorkspaceStore((s) => s.setTasks);
  const updatePaneDataByTerminalId = useWorkspaceStore((s) => s.updatePaneDataByTerminalId);
  const updatePaneData = useWorkspaceStore((s) => s.updatePaneData);
  const workspaceDir    = useWorkspaceStore((s) => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore((s) => s.setWorkspaceDir);
  const globalGraph     = useWorkspaceStore((s) => s.globalGraph);
  const setGlobalGraph  = useWorkspaceStore((s) => s.setGlobalGraph);
  const nodeRuntimeBindings = useWorkspaceStore((s) => s.nodeRuntimeBindings);
  const setNodeRuntimeBinding = useWorkspaceStore((s) => s.setNodeRuntimeBinding);
  const layoutMode   = useWorkspaceStore((s) => s.layoutMode);
  const setLayoutMode = useWorkspaceStore((s) => s.setLayoutMode);
  const modeLabel = MODE_OPTIONS.find(mode => mode.id === appMode)?.label ?? 'Workflow';

  // Default terminal working directory to home folder on first launch
  useEffect(() => {
    if (!workspaceDir) {
      homeDir().then(dir => setWorkspaceDir(dir)).catch(() => {});
    }
  }, []);


  const hasCleanedRef = useRef(false);
  // Startup cleanup: Reset stale 'running' or 'launching' statuses to 'idle'
  useEffect(() => {
    if (hasCleanedRef.current) return;
    
    // 1. Clean graph nodes
    let changedNodes = false;
    let nextNodes = globalGraph.nodes;
    if (globalGraph.nodes.length) {
      nextNodes = globalGraph.nodes.map(node => {
        let changed = false;
        const nextNode = { ...node };
        if (
          nextNode.status !== 'idle'
        ) {
          nextNode.status = 'idle';
          changed = true;
        }
        if (nextNode.mcpState) {
          nextNode.mcpState = undefined;
          changed = true;
        }
        if (nextNode.config) {
          const config = { ...nextNode.config };
          if (config.terminalId || config.paneId || (config as any).runtimeSessionId || (config as any).currentAttempt || (config as any).heartbeat) {
            delete config.terminalId;
            delete config.paneId;
            delete (config as any).runtimeSessionId;
            delete (config as any).currentAttempt;
            delete (config as any).heartbeat;
            nextNode.config = config;
            changed = true;
          }
        }
        if (changed) changedNodes = true;
        return nextNode;
      });
    }

    // 2. Clean node runtime bindings (adapter sessions don't survive restart)
    const bindingEntries = Object.entries(nodeRuntimeBindings);
    let nextBindings = nodeRuntimeBindings;
    let changedBindings = false;
    if (bindingEntries.length > 0 || Object.keys(useWorkspaceStore.getState().nodeTerminalBindings).length > 0) {
      nextBindings = {};
      changedBindings = true;
    }

    // 3. Clean stale terminal panes representing runtime terminals
    let changedTabs = false;
    const nextTabs = tabs.map(tab => {
      const filteredPanes = tab.panes.filter(pane => {
        if (pane.type === 'terminal') {
          if (pane.data?.nodeId || pane.data?.roleId) return false;
        }
        return true;
      });
      if (filteredPanes.length !== tab.panes.length) {
        changedTabs = true;
        return { ...tab, panes: filteredPanes };
      }
      return tab;
    });

    if (changedNodes || changedBindings || changedTabs) {
      useWorkspaceStore.setState({ 
        globalGraph: { ...globalGraph, nodes: nextNodes },
        nodeRuntimeBindings: nextBindings,
        nodeTerminalBindings: {},
        tabs: nextTabs
      });
      hasCleanedRef.current = true;
    } else if (globalGraph.nodes.length > 0) {
      // Data is present but no cleanup needed - still mark as cleaned
      hasCleanedRef.current = true;
    }
  }, [globalGraph, nodeRuntimeBindings]); 

  // Load tasks from SQLite on startup
  useEffect(() => {
    invoke<DbTask[]>('get_tasks').then(setTasks).catch(() => {});
  }, []);

  const [draggingNew, setDraggingNew] = useState<{ type: PaneType; x: number; y: number; label?: string; data?: any } | null>(null);

  // Global MCP Message Listener
  useEffect(() => {
    const unlisten = listen<McpMessage>('mcp-message', (event) => {
      const msg = event.payload;
      if (msg.type === 'agent_connected') {
        try {
          const payload = JSON.parse(msg.content || '{}') as {
            terminalId?: string;
            cli?: string;
            role?: string;
          };
          if (typeof payload.terminalId === 'string' && payload.terminalId.length > 0) {
            const cli = normalizeCli(payload.cli);
            const roleId = detectRoleFromText(payload.role);
            updatePaneDataByTerminalId(payload.terminalId, {
              ...(cli ? { cli } : {}),
              ...(roleId ? { roleId } : {}),
              cliSource: 'connect_agent',
              cliConfidence: cli ? 'high' : 'low',
              cliUpdatedAt: Date.now(),
            });
          }
        } catch {
          // ignore malformed payloads
        }
        return;
      }
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
  }, [addMessage, addResult, setTasks, updatePaneDataByTerminalId]);

  useEffect(() => {
    const runDetection = () => {
      const state = useWorkspaceStore.getState();
      const panes = state.tabs.find(t => t.id === state.activeTabId)?.panes ?? [];
      refreshCliDetectionForTerminals(panes, state.updatePaneData).catch(() => {});
    };

    runDetection();
    const intervalId = setInterval(runDetection, 5000);
    const unlistenFocus = listen('terminal-focused', () => {
      runDetection();
    });

    return () => {
      clearInterval(intervalId);
      unlistenFocus.then(fn => fn());
    };
  }, []);

  useEffect(() => {
    const activePanes = tabs.find(t => t.id === activeTabId)?.panes ?? [];
    const hasLauncher = activePanes.some(p => p.type === 'launcher');
    const shouldProbe = appMode === 'workflow' || appMode === 'runtime' || hasLauncher;
    if (!shouldProbe) return;
    refreshCliDetectionForTerminals(activePanes, updatePaneData).catch(() => {});
  }, [appMode, activeTabId, tabs, updatePaneData]);

  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const tabInputRef = useRef<HTMLInputElement>(null);

  const [fatalReport, setFatalReport] = useState<FatalErrorReport | null>(() => readLastFatalReport());

  // Capture unhandled runtime errors so we can diagnose "blank screen" reports.
  useEffect(() => {
    function report(kind: FatalErrorReport['kind'], error: unknown) {
      const { message, stack } = stringifyUnknownError(error);
      const next: FatalErrorReport = {
        ts: Date.now(),
        kind,
        message,
        stack,
        url: typeof window !== 'undefined' ? window.location.href : undefined,
        breadcrumbs: readBreadcrumbs(),
      };
      writeFatalReport(next);
      setFatalReport(next);
    }

    const onError = (event: ErrorEvent) => {
      recordBreadcrumb('window-error', { message: event.message, filename: event.filename, lineno: event.lineno, colno: event.colno });
      report('error', event.error ?? event.message);
    };

    const onRejection = (event: PromiseRejectionEvent) => {
      recordBreadcrumb('unhandledrejection');
      report('unhandledrejection', event.reason);
    };

    window.addEventListener('error', onError);
    window.addEventListener('unhandledrejection', onRejection);
    return () => {
      window.removeEventListener('error', onError);
      window.removeEventListener('unhandledrejection', onRejection);
    };
  }, []);

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

  const content = (
    <div className={`flex flex-col h-screen overflow-hidden theme-${theme} bg-bg-app text-text-primary font-sans select-none relative`}>
      {fatalReport && (
        <FatalErrorOverlay
          report={fatalReport}
          onDismiss={() => {
            clearLastFatalReport();
            setFatalReport(null);
          }}
        />
      )}
      
      {/* Top Header / Tab Bar */}
      <div className="flex items-center h-10 bg-bg-titlebar border-b border-border-panel shrink-0 select-none relative z-50">
        <div 
          className="flex items-center gap-2 px-3 border-r border-border-panel h-full cursor-pointer hover:bg-bg-surface transition-colors"
          onClick={toggleSidebar}
        >
          <PanelLeft size={16} className={sidebarOpen ? "text-accent-primary" : "text-text-muted"} />
        </div>

        <div className="flex-1 flex justify-center items-center gap-1 h-full relative z-10" data-tauri-drag-region>
          {appMode === 'workspace' ? (
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-1 bg-bg-surface border border-border-panel rounded-lg px-1 py-0.5" data-tauri-no-drag>
                <button 
                  onClick={() => setLayoutMode('grid')}
                  className={`flex items-center gap-1.5 text-[10px] uppercase font-bold px-2.5 py-1 rounded-md transition-all ${layoutMode === 'grid' ? 'bg-accent-primary text-white shadow-sm' : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-hover'}`}
                >
                  <LayoutGrid size={12} />
                  <span>Panels</span>
                </button>
                <button 
                  onClick={() => setLayoutMode('tabs')}
                  className={`flex items-center gap-1.5 text-[10px] uppercase font-bold px-2.5 py-1 rounded-md transition-all ${layoutMode === 'tabs' ? 'bg-accent-primary text-white shadow-sm' : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-hover'}`}
                >
                  <Maximize size={12} />
                  <span>Tabs</span>
                </button>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-accent-primary uppercase tracking-widest">
               {appMode === 'runtime' ? <Monitor size={14} /> : <Network size={14} />}
               <span>{modeLabel}</span>
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
        <ModeRail />
        {appMode === 'workspace' && <Sidebar />}
        
        <main className="flex-1 flex flex-col min-w-0 bg-bg-app relative">
          
          {appMode === 'workflow' ? (
             <div className="flex-1 overflow-hidden relative">
               <NodeTreePane graph={globalGraph} onGraphChange={setGlobalGraph} />
             </div>
          ) : appMode === 'runtime' ? (
             <div className="flex-1 overflow-hidden relative">
               <RuntimeView />
             </div>
          ) : (
            <>
              {/* Workspace Tab Bar */}
              {layoutMode === 'grid' && (
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
              )}

              <div className="flex-1 flex flex-col overflow-hidden">
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

  return (
    <ErrorBoundary
      name="AppRoot"
      onError={({ name, error }) => {
        const { message, stack } = stringifyUnknownError(error);
        const next: FatalErrorReport = {
          ts: Date.now(),
          kind: 'react',
          message,
          stack,
          url: typeof window !== 'undefined' ? window.location.href : undefined,
          breadcrumbs: readBreadcrumbs(),
        };
        recordBreadcrumb('error-boundary', { name, message });
        writeFatalReport(next);
        setFatalReport(next);
      }}
      fallback={({ error, reset }) => (
        <div className={`h-screen w-screen theme-${theme} bg-bg-app text-text-primary flex items-center justify-center p-6`}>
          <div className="w-full max-w-2xl bg-bg-panel border border-border-panel rounded-xl shadow-2xl overflow-hidden">
            <div className="px-4 py-3 border-b border-border-panel bg-bg-titlebar flex items-center justify-between">
              <div className="text-xs font-semibold text-red-300 uppercase tracking-wider">UI Crash</div>
              <div className="flex items-center gap-2">
                <button onClick={() => reset()} className="px-3 py-1.5 text-[11px] border border-border-panel rounded text-text-muted hover:text-text-primary">Try Continue</button>
                <button onClick={() => window.location.reload()} className="px-3 py-1.5 text-[11px] bg-red-500/90 text-white rounded font-semibold">Reload</button>
              </div>
            </div>
            <div className="p-4 space-y-3">
              <div className="text-[11px] text-text-muted">If this happens after interacting with the node graph, reload and then use “Copy Details” from the overlay.</div>
              <pre className="text-[11px] whitespace-pre-wrap break-words bg-bg-surface border border-border-panel rounded-lg p-3 text-text-primary">{String((error as any)?.stack ?? (error as any)?.message ?? error)}</pre>
            </div>
          </div>
        </div>
      )}
    >
      {content}
    </ErrorBoundary>
  );
}

const MODE_OPTIONS: Array<{ id: AppMode; label: string; icon: React.ReactNode }> = [
  { id: 'workflow', label: 'Workflow', icon: <Network size={18} /> },
  { id: 'runtime', label: 'Runtime', icon: <Monitor size={18} /> },
  { id: 'workspace', label: 'Workspace', icon: <FolderTree size={18} /> },
];

function ModeRail() {
  const appMode = useWorkspaceStore((s) => s.appMode);
  const setAppMode = useWorkspaceStore((s) => s.setAppMode);

  return (
    <nav className="w-12 shrink-0 h-full bg-bg-titlebar border-r border-border-panel flex flex-col items-center py-2 gap-1">
      <div className="mb-3 flex items-center justify-center w-8 h-8">
        <TerminalSquare size={20} className="text-accent-primary" />
      </div>
      {MODE_OPTIONS.map((mode) => (
        <button
          key={mode.id}
          onClick={() => setAppMode(mode.id)}
          title={mode.label}
          className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all ${
            appMode === mode.id
              ? 'text-accent-primary bg-accent-primary/10'
              : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'
          }`}
        >
          {mode.icon}
          {appMode === mode.id && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-primary rounded-r-full" />
          )}
        </button>
      ))}
    </nav>
  );
}

export default App;
