import { Sidebar } from './components/Sidebar/Sidebar';
import { WorkspaceGrid } from './components/Layout/WorkspaceGrid';
import { QuickOpen } from './components/QuickOpen/QuickOpen';
import { NodeTreePane } from './components/NodeTree/NodeTreePane';
import { RuntimeView } from './components/Runtime/RuntimeView';
import { useWorkspaceStore, PaneType, McpMessage, DbTask, type AppMode } from './store/workspace';
import {  invoke  } from './lib/desktopApi';
import {  listen  } from './lib/desktopApi';
import {  homeDir  } from './lib/desktopApi';
import {  Window  } from './lib/desktopApi';
import { PanelLeft, TerminalSquare, FileCode2, KanbanSquare, Activity, Palette, Plus, Rocket, Monitor, Minus, Square, X, Network, FolderTree, LayoutGrid, Maximize, Settings } from 'lucide-react';
import React, { useState, useEffect, useRef, useMemo } from 'react';
import { detectRoleFromText, normalizeCli } from './lib/cliDetection';
import { refreshCliDetectionForTerminals } from './lib/terminalCliRuntime';
import { ErrorBoundary } from './components/Diagnostics/ErrorBoundary';
import { FatalErrorOverlay } from './components/Diagnostics/FatalErrorOverlay';
import { SettingsOverlay } from './components/Settings/SettingsOverlay';
import { clearLastFatalReport, readBreadcrumbs, readLastFatalReport, recordBreadcrumb, stringifyUnknownError, writeFatalReport, type FatalErrorReport } from './lib/diagnostics';
import './App.css';

// Safe access to window
const appWindow = typeof window !== 'undefined' ? Window.getCurrent() : null;

// Helper to inject custom theme CSS
function CustomThemeInjector() {
  const customTheme = useWorkspaceStore(s => s.customTheme);

  const css = useMemo(() => {
    const entries = Object.entries(customTheme);
    if (entries.length === 0) return '';
    
    const baseRules = entries.map(([key, value]) => `${key}: ${value} !important;`);
    
    // Derive missing UI variables that components might use
    // If we have --bg-app but not --bg-titlebar, derive it.
    if (customTheme['--bg-app'] && !customTheme['--bg-titlebar']) {
      baseRules.push(`--bg-titlebar: ${customTheme['--bg-app']} !important;`);
    }
    if (customTheme['--bg-panel'] && !customTheme['--border-panel']) {
      // Use panel bg as a base for border if missing
      baseRules.push(`--border-panel: ${customTheme['--bg-panel']} !important;`);
    }
    if (customTheme['--accent-primary'] && !customTheme['--accent-hover']) {
      baseRules.push(`--accent-hover: ${customTheme['--accent-primary']} !important;`);
    }

    const rules = baseRules.join('\n');
    // We apply to both :root and any theme class to ensure it wins specificity
    return `:root, [class*="theme-"] { ${rules} }`;
  }, [customTheme]);

  if (!css) return null;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

const PANE_ICONS: Record<PaneType, React.ReactNode> = {
  terminal:     <TerminalSquare size={13} />,
  editor:       <FileCode2 size={13} />,
  taskboard:    <KanbanSquare size={13} />,
  activityfeed: <Activity size={13} />,
  launcher:       <Rocket size={13} />,
  missioncontrol: <Monitor size={13} />,
  nodetree:       <Network size={13} />,
};

import { runtimeManager } from './lib/runtime/RuntimeManager';
import { workflowOrchestrator } from './lib/workflow/WorkflowOrchestrator';

function App() {
  useEffect(() => {
    workflowOrchestrator.setRuntimeManager(runtimeManager);
    runtimeManager.startListening().catch(console.error);
  }, []);

  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const sidebarOpen   = useWorkspaceStore((s) => s.sidebarOpen);
  const appMode       = useWorkspaceStore((s) => s.appMode);
  const theme        = useWorkspaceStore((s) => s.theme);
  const tabs         = useWorkspaceStore((s) => s.tabs);
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
  const layoutMode   = useWorkspaceStore((s) => s.layoutMode);
  const setLayoutMode = useWorkspaceStore((s) => s.setLayoutMode);
  const showSettings = useWorkspaceStore((s) => s.showSettings);
  const setShowSettings = useWorkspaceStore((s) => s.setShowSettings);
  const modeLabel = MODE_OPTIONS.find(mode => mode.id === appMode)?.label ?? 'Workflow';

  useEffect(() => {
    if (!workspaceDir) {
      homeDir().then(dir => setWorkspaceDir(dir)).catch(() => {});
    }
  }, []);

  const hasCleanedRef = useRef(false);
  useEffect(() => {
    if (hasCleanedRef.current) return;
    
    let changedNodes = false;
    let nextNodes = globalGraph.nodes;
    if (globalGraph.nodes.length) {
      nextNodes = globalGraph.nodes.map(node => {
        let changed = false;
        const nextNode = { ...node };
        if (nextNode.status !== 'idle') { nextNode.status = 'idle'; changed = true; }
        if (nextNode.mcpState) { nextNode.mcpState = undefined; changed = true; }
        if (nextNode.config) {
          const config = { ...nextNode.config };
          if (config.terminalId || config.paneId || (config as any).runtimeSessionId) {
            delete config.terminalId; delete config.paneId; delete (config as any).runtimeSessionId;
            nextNode.config = config; changed = true;
          }
        }
        if (changed) changedNodes = true;
        return nextNode;
      });
    }

    const nextTabs = tabs.map(tab => {
      const filteredPanes = tab.panes.filter(pane => {
        if (pane.type === 'terminal' && (pane.data?.nodeId || pane.data?.roleId)) return false;
        return true;
      });
      return filteredPanes.length !== tab.panes.length ? { ...tab, panes: filteredPanes } : tab;
    });

    if (changedNodes || nextTabs !== tabs) {
      useWorkspaceStore.setState({ 
        globalGraph: { ...globalGraph, nodes: nextNodes },
        nodeRuntimeBindings: {},
        nodeTerminalBindings: {},
        tabs: nextTabs
      });
    }
    hasCleanedRef.current = true;
  }, [globalGraph, tabs]); 

  useEffect(() => {
    invoke<DbTask[]>('get_tasks').then(setTasks).catch(() => {});
  }, []);

  const [draggingNew, setDraggingNew] = useState<{ type: PaneType; x: number; y: number; label?: string; data?: any } | null>(null);

  useEffect(() => {
    const unlisten = listen<McpMessage>('mcp-message', (event) => {
      const msg = event.payload;
      if (msg.type === 'agent_connected') {
        try {
          const payload = JSON.parse(msg.content || '{}');
          if (payload.terminalId) {
            const cli = normalizeCli(payload.cli);
            const roleId = detectRoleFromText(payload.role);
            updatePaneDataByTerminalId(payload.terminalId, {
              ...(cli ? { cli } : {}), ...(roleId ? { roleId } : {}),
              cliSource: 'connect_agent', cliConfidence: cli ? 'high' : 'low', cliUpdatedAt: Date.now(),
            });
          }
        } catch {}
        return;
      }
      if (msg.type === 'task_update') { invoke<DbTask[]>('get_tasks').then(setTasks).catch(() => {}); return; }
      if (msg.type.startsWith('result:')) {
        addResult({ id: msg.id, agentId: msg.from, content: msg.content, type: msg.type === 'result:url' ? 'url' : 'markdown', timestamp: msg.timestamp });
      } else { addMessage(msg); }
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
    return () => clearInterval(intervalId);
  }, []);

  const [showQuickOpen, setShowQuickOpen] = useState(false);
  const [editingTabId, setEditingTabId] = useState<string | null>(null);
  const [editingTabName, setEditingTabName] = useState('');
  const tabInputRef = useRef<HTMLInputElement>(null);
  const [fatalReport, setFatalReport] = useState<FatalErrorReport | null>(() => readLastFatalReport());

  useEffect(() => {
    function report(kind: FatalErrorReport['kind'], error: unknown) {
      const { message, stack } = stringifyUnknownError(error);
      const next: FatalErrorReport = { ts: Date.now(), kind, message, stack, url: window.location.href, breadcrumbs: readBreadcrumbs() };
      writeFatalReport(next); setFatalReport(next);
    }
    const onError = (e: ErrorEvent) => report('error', e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => report('unhandledrejection', e.reason);
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);

  const content = (
    <div className={`flex flex-col h-screen overflow-hidden theme-${theme} bg-bg-app text-text-primary font-sans select-none relative`}>
      <CustomThemeInjector />
      {fatalReport && <FatalErrorOverlay report={fatalReport} onDismiss={() => { clearLastFatalReport(); setFatalReport(null); }} />}
      
      <div className="flex items-center h-10 bg-bg-titlebar border-b border-border-panel shrink-0 select-none relative z-50">
        <div className="flex items-center gap-2 px-3 border-r border-border-panel h-full cursor-pointer hover:bg-bg-surface transition-colors" onClick={toggleSidebar}>
          <PanelLeft size={16} className={sidebarOpen ? "text-accent-primary" : "text-text-muted"} />
        </div>

        <div className="flex-1 flex justify-center items-center gap-1 h-full relative z-10" style={{ WebkitAppRegion: 'drag' } as any}>
          {appMode === 'workspace' ? (
            <div className="flex items-center gap-1 bg-bg-surface border border-border-panel rounded-lg px-1 py-0.5" style={{ WebkitAppRegion: 'no-drag' } as any}>
              <button onClick={() => setLayoutMode('grid')} className={`flex items-center gap-1.5 text-[10px] uppercase font-bold px-2.5 py-1 rounded-md transition-all ${layoutMode === 'grid' ? 'bg-accent-primary text-white shadow-sm' : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-hover'}`}><LayoutGrid size={12} /><span>Panels</span></button>
              <button onClick={() => setLayoutMode('tabs')} className={`flex items-center gap-1.5 text-[10px] uppercase font-bold px-2.5 py-1 rounded-md transition-all ${layoutMode === 'tabs' ? 'bg-accent-primary text-white shadow-sm' : 'text-text-muted hover:text-text-primary hover:bg-bg-surface-hover'}`}><Maximize size={12} /><span>Tabs</span></button>
            </div>
          ) : (
            <div className="flex items-center gap-2 text-xs font-bold text-accent-primary uppercase tracking-widest">
               {appMode === 'runtime' ? <Monitor size={14} /> : <Network size={14} />}
               <span>{modeLabel}</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-3 shrink-0 relative z-10" style={{ WebkitAppRegion: 'drag' } as any}>
          <div className="flex items-center bg-bg-surface border border-border-panel rounded-md h-6 px-1 mr-2" style={{ WebkitAppRegion: 'no-drag' } as any}>
            <button onClick={() => appWindow?.minimize()} className="w-6 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-panel rounded transition-colors"><Minus size={12} /></button>
            <button onClick={() => appWindow?.toggleMaximize()} className="w-6 h-full flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-panel rounded transition-colors"><Square size={10} /></button>
            <button onClick={() => appWindow?.close()} className="w-6 h-full flex items-center justify-center text-text-muted hover:text-red-400 hover:bg-red-400/10 rounded transition-colors"><X size={12} /></button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        <ModeRail />
        {appMode === 'workspace' && <Sidebar />}
        <main className="flex-1 flex flex-col min-w-0 bg-bg-app relative">
          {appMode === 'workflow' ? <NodeTreePane graph={globalGraph} onGraphChange={setGlobalGraph} /> : appMode === 'runtime' ? <RuntimeView /> : (
            <>
              {layoutMode === 'grid' && (
                <div className="flex items-center h-8 bg-bg-titlebar border-b border-border-panel px-2 gap-0.5 overflow-x-auto shrink-0 select-none relative" style={{ WebkitAppRegion: 'drag' } as any}>
                  {tabs.map((tab) => (
                    <div key={tab.id} onClick={() => switchTab(tab.id)} onDoubleClick={() => { setEditingTabId(tab.id); setEditingTabName(tab.name); }} className={`group flex items-center h-6 px-3 gap-2 rounded-t-md text-[11px] font-medium transition-all cursor-pointer min-w-[80px] max-w-[160px] border-x border-t relative ${activeTabId === tab.id ? 'bg-bg-panel text-text-primary border-border-panel z-10 -mb-[1px]' : 'bg-transparent text-text-muted border-transparent hover:bg-bg-surface/50'}`}>
                      <div className="w-1.5 h-1.5 rounded-full shrink-0" style={{ backgroundColor: tab.color }} />
                      {editingTabId === tab.id ? <input ref={tabInputRef} value={editingTabName} onChange={(e) => setEditingTabName(e.target.value)} onBlur={() => { if (editingTabName.trim()) renameTab(tab.id, editingTabName.trim()); setEditingTabId(null); }} onKeyDown={(e) => { if (e.key === 'Enter') { if (editingTabName.trim()) renameTab(tab.id, editingTabName.trim()); setEditingTabId(null); } if (e.key === 'Escape') setEditingTabId(null); }} className="bg-transparent border-none outline-none text-xs w-[100px] text-text-primary" autoFocus /> : <span className="truncate max-w-[100px]">{tab.name}</span>}
                      {tabs.length > 1 && <button onClick={(e) => { e.stopPropagation(); removeTab(tab.id); }} className="ml-0.5 opacity-0 group-hover:opacity-60 hover:!opacity-100 text-text-muted hover:text-red-400 transition-all leading-none text-base shrink-0"><X size={10} /></button>}
                    </div>
                  ))}
                  <button onClick={addTab} className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-text-primary hover:bg-bg-surface rounded transition-colors ml-1"><Plus size={14} /></button>
                </div>
              )}
              <div className="flex-1 flex flex-col overflow-hidden"><WorkspaceGrid /></div>
            </>
          )}
          {showQuickOpen && <QuickOpen onClose={() => setShowQuickOpen(false)} />}
        </main>
      </div>

      {showSettings && <SettingsOverlay />}
      {draggingNew && (
        <div className="fixed pointer-events-none z-[9999] bg-accent-primary/20 border-2 border-accent-primary rounded-lg px-3 py-1.5 flex items-center gap-2 text-accent-primary font-bold shadow-2xl backdrop-blur-sm" style={{ left: draggingNew.x + 10, top: draggingNew.y + 10 }}>
          {PANE_ICONS[draggingNew.type]}<span className="text-xs uppercase tracking-wider">{draggingNew.type}</span>
        </div>
      )}
    </div>
  );

  return (
    <ErrorBoundary name="AppRoot" onError={({ name, error }) => {
      const { message, stack } = stringifyUnknownError(error);
      const next: FatalErrorReport = { ts: Date.now(), kind: 'react', message, stack, url: window.location.href, breadcrumbs: readBreadcrumbs() };
      recordBreadcrumb('error-boundary', { name, message }); writeFatalReport(next); setFatalReport(next);
    }} fallback={({ error, reset }) => (
      <div className={`h-screen w-screen theme-${theme} bg-bg-app text-text-primary flex items-center justify-center p-6`}>
        <div className="w-full max-w-2xl bg-bg-panel border border-border-panel rounded-xl shadow-2xl overflow-hidden">
          <div className="px-4 py-3 border-b border-border-panel bg-bg-titlebar flex items-center justify-between">
            <div className="text-xs font-semibold text-red-300 uppercase tracking-wider">UI Crash</div>
            <div className="flex items-center gap-2">
              <button onClick={() => reset()} className="px-3 py-1.5 text-[11px] border border-border-panel rounded text-text-muted hover:text-text-primary">Try Continue</button>
              <button onClick={() => window.location.reload()} className="px-3 py-1.5 text-[11px] bg-red-500/90 text-white rounded font-semibold">Reload</button>   
            </div>
          </div>
          <div className="p-4 space-y-3"><pre className="text-[11px] whitespace-pre-wrap break-words bg-bg-surface border border-border-panel rounded-lg p-3 text-text-primary">{String((error as any)?.stack ?? (error as any)?.message ?? error)}</pre></div>
        </div>
      </div>
    )}>
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
  const setShowSettings = useWorkspaceStore((s) => s.setShowSettings);
  const showSettings = useWorkspaceStore((s) => s.showSettings);

  return (
    <nav className="w-12 shrink-0 h-full bg-bg-titlebar border-r border-border-panel flex flex-col items-center py-2 gap-1 relative">
      <div className="mb-3 flex items-center justify-center w-8 h-8">
        <TerminalSquare size={20} className="text-accent-primary" />
      </div>
      {MODE_OPTIONS.map((mode) => (
        <button key={mode.id} onClick={() => setAppMode(mode.id)} title={mode.label} className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all ${appMode === mode.id ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'}`}>
          {mode.icon}
          {appMode === mode.id && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-primary rounded-r-full" />}
        </button>
      ))}

      <div className="mt-auto pb-2 flex flex-col items-center gap-1">
        <button onClick={() => setShowSettings(!showSettings)} title="Settings" className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all ${showSettings ? 'text-accent-primary bg-accent-primary/10' : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'}`}>
          <Settings size={18} />
          {showSettings && <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-primary rounded-r-full" />}
        </button>
      </div>
    </nav>
  );
}

export default App;
 App;
