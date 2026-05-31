import { useWorkspaceStore, PaneType, type AppMode, type WorkflowNode } from './store/workspace';
import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import { defaultWindowIcon } from '@tauri-apps/api/app';
import { homeDir } from '@tauri-apps/api/path';
import { Window } from '@tauri-apps/api/window';
import { TerminalSquare, FileCode2, KanbanSquare, Activity, Rocket, Monitor, Minus, Square, X, Network, FolderTree, Settings, Bell, Toolbox, Save, Globe2 } from 'lucide-react';
import React, { Suspense, lazy, useState, useEffect, useRef, useMemo } from 'react';
import { detectRoleFromText, normalizeCli } from './lib/cliDetection';
import { refreshCliDetectionForTerminals } from './lib/terminalCliRuntime';
import { ErrorBoundary } from './components/Diagnostics/ErrorBoundary';
import { FatalErrorOverlay } from './components/Diagnostics/FatalErrorOverlay';
import { clearLastFatalReport, readBreadcrumbs, readLastFatalReport, recordBreadcrumb, stringifyUnknownError, writeFatalReport, type FatalErrorReport } from './lib/diagnostics';
import { useActionCenterItems } from './components/ActionCenter/useActionCenterItems';
import { missionRepository } from './lib/missionRepository';
import type { ActionCenterActionId, ActionCenterItem } from './lib/actionCenter';
import { markStartup } from './lib/startupTrace';
import { clearCachedEditorDirty, getCachedDirtyEditorContent } from './lib/editorSessionCache';
import { normalizeTaskBoardTasks } from './lib/taskBoard';
import { normalizeAgentConnectedPayload, normalizeMcpMessage } from './lib/mcpMessages';
import './App.css';

markStartup('app module evaluated');

const WorkspaceGrid = lazy(() => import('./components/Layout/WorkspaceGrid').then(module => ({ default: module.WorkspaceGrid })));
const Sidebar = lazy(() => import('./components/Sidebar/Sidebar').then(module => ({ default: module.Sidebar })));
const QuickOpen = lazy(() => import('./components/QuickOpen/QuickOpen').then(module => ({ default: module.QuickOpen })));
const NodeTreePane = lazy(() => import('./components/NodeTree/NodeTreePane').then(module => ({ default: module.NodeTreePane })));
const RuntimeView = lazy(() => import('./components/Runtime/RuntimeView').then(module => ({ default: module.RuntimeView })));
const ActionCenterPane = lazy(() => import('./components/ActionCenter/ActionCenterPane').then(module => ({ default: module.ActionCenterPane })));
const StarlinkToolboxPage = lazy(() => import('./components/McpToolbox/McpToolboxPage').then(module => ({ default: module.StarlinkToolboxPage })));
const SettingsOverlay = lazy(() => import('./components/Settings/SettingsOverlay').then(module => ({ default: module.SettingsOverlay })));
const AgentDock = lazy(() => import('./components/AgentDock/AgentDock').then(module => ({ default: module.AgentDock })));

// Safe access to the Tauri window. Plain browser automation does not expose
// Tauri internals, so avoid resolving the current window outside that runtime.
const appWindow = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window ? Window.getCurrent() : null;
const isTauriRuntime = typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;

// Helper to inject custom theme CSS
function CustomThemeInjector() {
  const customTheme = useWorkspaceStore(s => s.customTheme);

  const css = useMemo(() => {
    const entries = Object.entries(customTheme);
    if (entries.length === 0) return '';
    const rules = entries.map(([key, value]) => `${key}: ${value} !important;`).join('\n');
    return `:root { ${rules} }`;
  }, [customTheme]);

  if (!css) return null;
  return <style dangerouslySetInnerHTML={{ __html: css }} />;
}

const PANE_ICONS: Record<PaneType, React.ReactNode> = {
  terminal:     <TerminalSquare size={13} />,
  editor:       <FileCode2 size={13} />,
  changereview: <FileCode2 size={13} />,
  preview:      <Globe2 size={13} />,
  taskboard:    <KanbanSquare size={13} />,
  activityfeed: <Activity size={13} />,
  launcher:       <Rocket size={13} />,
  missioncontrol: <Monitor size={13} />,
  nodetree:       <Network size={13} />,
  inbox:          <Bell size={13} />,
};

declare global {
  interface Window {
    __cometAiLiveWorkflowHarnessStarted?: boolean;
    __cometAiWorkspaceQaHarnessStarted?: boolean;
  }
}

const LIVE_WORKFLOW_HARNESS_STORAGE_PREFIX = 'comet-ai-live-workflow-harness:';

type RuntimeCleanupWorkflowConfig = NonNullable<WorkflowNode['config']> & {
  runtimeSessionId?: unknown;
};

type TopBarMenuId = 'file' | 'edit' | 'view' | 'window' | 'help';

interface TopBarMenuItem {
  label: string;
  shortcut?: string;
  disabled?: boolean;
  onSelect: () => void;
}

interface TopBarMenu {
  id: TopBarMenuId;
  label: string;
  items: TopBarMenuItem[];
}

function formatErrorForDisplay(error: unknown): string {
  const { message, stack } = stringifyUnknownError(error);
  return stack ?? message;
}

function executeDocumentCommand(command: string) {
  document.execCommand(command);
}

function PaneLoadingFallback({ label = 'Loading' }: { label?: string }) {
  return (
    <div className="w-full h-full flex items-center justify-center text-xs text-text-muted">
      {label}
    </div>
  );
}

function sendFrontendErrorToDebugMcp(report: FatalErrorReport, name?: string) {
  invoke<string>('get_mcp_base_url')
    .then(baseUrl => fetch(`${baseUrl}/internal/frontend-error`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        timestamp: new Date(report.ts).toISOString(),
        kind: report.kind,
        name,
        message: report.message,
        stack: report.stack,
        route: report.url,
        breadcrumbs: report.breadcrumbs,
      }),
    }))
    .catch(() => {});
}

function MainApp() {
  useEffect(() => {
    markStartup('root mounted');
    if (appWindow) {
      defaultWindowIcon()
        .then(icon => {
          if (icon) return appWindow.setIcon(icon);
        })
        .catch(() => {});
    }
    Promise.all([
      import('./lib/runtime/TerminalOutputBus'),
      import('./lib/runtime/RuntimeExecutor'),
      import('./lib/runtime/RuntimeManager'),
      import('./lib/workflow/WorkflowOrchestrator'),
    ])
      .then(([terminalOutputBusModule, runtimeExecutorModule, runtimeManagerModule, workflowOrchestratorModule]) => {
        markStartup('runtime modules loaded');
        terminalOutputBusModule.terminalOutputBus.start().catch(console.error);
        workflowOrchestratorModule.workflowOrchestrator.setRuntimeManager(runtimeExecutorModule.runtimeExecutor);
        runtimeManagerModule.runtimeManager.startListening()
          .then(() => markStartup('runtime listeners ready'))
          .catch(console.error);
      })
      .catch(console.error);
    if (import.meta.env.DEV && import.meta.env.VITE_LIVE_WORKFLOW_DEBUG === '1' && !window.__cometAiLiveWorkflowHarnessStarted) {
      window.__cometAiLiveWorkflowHarnessStarted = true;
      const debugReportPath = import.meta.env.VITE_LIVE_WORKFLOW_REPORT;
      const harnessStorageKey = typeof debugReportPath === 'string' && debugReportPath.trim()
        ? `${LIVE_WORKFLOW_HARNESS_STORAGE_PREFIX}${debugReportPath}`
        : null;
      if (harnessStorageKey && window.localStorage.getItem(harnessStorageKey) === 'running') {
        console.warn('[liveWorkflowHarness] Existing run marker found for this report path; skipping duplicate harness start.');
        return;
      }
      if (harnessStorageKey) {
        window.localStorage.setItem(harnessStorageKey, 'running');
      }
      if (typeof debugReportPath === 'string' && debugReportPath.trim()) {
        invoke('workspace_write_text_file', {
          path: `${debugReportPath}.start`,
          content: new Date().toISOString(),
        }).catch(console.error);
      }
      import('./lib/debug/liveWorkflowHarness')
        .then(({ liveWorkflowHarnessOptionsFromEnv, runLiveWorkflowHarness }) =>
          runLiveWorkflowHarness(liveWorkflowHarnessOptionsFromEnv())
            .finally(() => {
              if (harnessStorageKey) window.localStorage.setItem(harnessStorageKey, 'finished');
            }),
        )
        .catch(error => {
          console.error(error);
          if (harnessStorageKey) window.localStorage.setItem(harnessStorageKey, 'error');
          if (typeof debugReportPath === 'string' && debugReportPath.trim()) {
            invoke('workspace_write_text_file', {
              path: `${debugReportPath}.error`,
              content: stringifyUnknownError(error),
            }).catch(console.error);
          }
        });
    }
    if (import.meta.env.DEV && import.meta.env.VITE_WORKSPACE_QA_DEBUG === '1' && !window.__cometAiWorkspaceQaHarnessStarted) {
      window.__cometAiWorkspaceQaHarnessStarted = true;
      import('./lib/debug/workspaceQaHarness')
        .then(({ runWorkspaceQaHarness, workspaceQaOptionsFromEnv }) =>
          runWorkspaceQaHarness(workspaceQaOptionsFromEnv()),
        )
        .catch(error => console.error('[workspaceQaHarness]', error));
    }
  }, []);

  const appMode       = useWorkspaceStore((s) => s.appMode);
  const theme        = useWorkspaceStore((s) => s.theme);
  const tabs         = useWorkspaceStore((s) => s.tabs);
  const addMessage      = useWorkspaceStore((s) => s.addMessage);
  const addResult       = useWorkspaceStore((s) => s.addResult);
  const setTasks        = useWorkspaceStore((s) => s.setTasks);
   const updatePaneDataByTerminalId = useWorkspaceStore((s) => s.updatePaneDataByTerminalId);
   const workspaceDir    = useWorkspaceStore((s) => s.workspaceDir);
  const setWorkspaceDir = useWorkspaceStore((s) => s.setWorkspaceDir);
  const globalGraph     = useWorkspaceStore((s) => s.globalGraph);
  const setGlobalGraph  = useWorkspaceStore((s) => s.setGlobalGraph);

   const showSettings = useWorkspaceStore((s) => s.showSettings);
   const setAppMode = useWorkspaceStore((s) => s.setAppMode);
   const setShowSettings = useWorkspaceStore((s) => s.setShowSettings);
   const dirtyEditorCount = useMemo(
     () => tabs.reduce(
       (count, tab) => count + tab.panes.filter(pane => pane.type === 'editor' && Boolean(pane.data?.editorDirty)).length,
       0,
     ),
     [tabs],
   );

  const saveAllDirtyEditors = async () => {
    const state = useWorkspaceStore.getState();
    const dirtyEditors = state.tabs
      .flatMap(tab => tab.panes)
      .filter(pane => pane.type === 'editor' && Boolean(pane.data?.editorDirty) && typeof pane.data?.filePath === 'string');

    const savedPaths = new Set<string>();
    for (const pane of dirtyEditors) {
      const filePath = pane.data!.filePath as string;
      if (savedPaths.has(filePath)) continue;
      const content = getCachedDirtyEditorContent(filePath);
      if (content === undefined) continue;
      await invoke('workspace_write_text_file', { path: filePath, content });
      clearCachedEditorDirty(filePath);
      savedPaths.add(filePath);
    }

    if (savedPaths.size > 0) {
      useWorkspaceStore.setState(current => ({
        tabs: current.tabs.map(tab => ({
          ...tab,
          panes: tab.panes.map(pane => {
            const filePath = pane.data?.filePath;
            if (pane.type !== 'editor' || typeof filePath !== 'string' || !savedPaths.has(filePath)) return pane;
            return { ...pane, data: { ...pane.data, editorDirty: false } };
          }),
        })),
      }));
    }
  };

  useEffect(() => {
    if (!workspaceDir) {
      homeDir()
        .then(dir => {
          markStartup('home directory resolved');
          setWorkspaceDir(dir);
        })
        .catch(() => {});
    }
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if ((event.ctrlKey || event.metaKey) && !event.shiftKey && event.key.toLowerCase() === 'p') {
        event.preventDefault();
        setShowQuickOpen(true);
        return;
      }
      if ((event.ctrlKey || event.metaKey) && event.shiftKey && event.key.toLowerCase() === 's') {
        event.preventDefault();
        saveAllDirtyEditors().catch(error => console.error('Failed to save all editors:', error));
      }
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
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
          const config: RuntimeCleanupWorkflowConfig = { ...nextNode.config };
          if (config.terminalId || config.paneId || config.runtimeSessionId) {
            delete config.terminalId; delete config.paneId; delete config.runtimeSessionId;
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
      const workspaceState = useWorkspaceStore.getState();
      useWorkspaceStore.setState({ 
        globalGraph: { ...globalGraph, nodes: nextNodes },
        workflowGraphs: {
          ...workspaceState.workflowGraphs,
          [workspaceState.workflowGraphMode]: { ...globalGraph, nodes: nextNodes },
        },
        nodeRuntimeBindings: {},
        nodeTerminalBindings: {},
        tabs: nextTabs
      });
    }
    hasCleanedRef.current = true;
  }, [globalGraph, tabs]); 

  useEffect(() => {
    invoke<unknown>('get_tasks')
      .then(tasks => {
        markStartup('tasks loaded');
        setTasks(normalizeTaskBoardTasks(tasks));
      })
      .catch(() => {});
  }, []);

   const [draggingNew] = useState<{ type: PaneType; x: number; y: number; label?: string; data?: any } | null>(null);

  useEffect(() => {
    if (!isTauriRuntime) return;
    const unlisten = listen<unknown>('mcp-message', (event) => {
      const msg = normalizeMcpMessage(event.payload);
      if (!msg) return;
      if (msg.type === 'agent_connected') {
        const payload = normalizeAgentConnectedPayload(msg.content);
        if (!payload) return;
        const cli = normalizeCli(payload.cli);
        const roleId = detectRoleFromText(payload.role);
        updatePaneDataByTerminalId(payload.terminalId, {
          ...(cli ? { cli } : {}), ...(roleId ? { roleId } : {}),
          cliSource: 'connect_agent', cliConfidence: cli ? 'high' : 'low', cliUpdatedAt: Date.now(),
        });
        return;
      }
      if (msg.type === 'task_update') { invoke<unknown>('get_tasks').then(tasks => setTasks(normalizeTaskBoardTasks(tasks))).catch(() => {}); return; }
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
  const [fatalReport, setFatalReport] = useState<FatalErrorReport | null>(() => readLastFatalReport());
  const [modeRailOpen, setModeRailOpen] = useState(true);
  const [activeTopBarMenu, setActiveTopBarMenu] = useState<TopBarMenuId | null>(null);

  useEffect(() => {
    function report(kind: FatalErrorReport['kind'], error: unknown) {
      const { message, stack } = stringifyUnknownError(error);
      const next: FatalErrorReport = { ts: Date.now(), kind, message, stack, url: window.location.href, breadcrumbs: readBreadcrumbs() };
      writeFatalReport(next); setFatalReport(next);
      sendFrontendErrorToDebugMcp(next);
    }
    const onError = (e: ErrorEvent) => report('error', e.error ?? e.message);
    const onRejection = (e: PromiseRejectionEvent) => report('unhandledrejection', e.reason);
    window.addEventListener('error', onError); window.addEventListener('unhandledrejection', onRejection);
    return () => { window.removeEventListener('error', onError); window.removeEventListener('unhandledrejection', onRejection); };
  }, []);

  useEffect(() => {
    if (!activeTopBarMenu) return;
    const onPointerDown = (event: PointerEvent) => {
      if (event.target instanceof Element && event.target.closest('[data-top-bar-menu]')) return;
      setActiveTopBarMenu(null);
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveTopBarMenu(null);
    };
    window.addEventListener('pointerdown', onPointerDown);
    window.addEventListener('keydown', onKeyDown);
    return () => {
      window.removeEventListener('pointerdown', onPointerDown);
      window.removeEventListener('keydown', onKeyDown);
    };
  }, [activeTopBarMenu]);

  const topBarMenus: TopBarMenu[] = [
    {
      id: 'file',
      label: 'File',
      items: [
        { label: 'Quick Open...', shortcut: 'Ctrl+P', onSelect: () => setShowQuickOpen(true) },
        {
          label: dirtyEditorCount > 0 ? `Save All (${dirtyEditorCount})` : 'Save All',
          shortcut: 'Ctrl+Shift+S',
          disabled: dirtyEditorCount === 0,
          onSelect: () => saveAllDirtyEditors().catch(error => console.error('Failed to save all editors:', error)),
        },
        { label: 'Settings', onSelect: () => setShowSettings(true) },
      ],
    },
    {
      id: 'edit',
      label: 'Edit',
      items: [
        { label: 'Undo', shortcut: 'Ctrl+Z', onSelect: () => executeDocumentCommand('undo') },
        { label: 'Redo', shortcut: 'Ctrl+Y', onSelect: () => executeDocumentCommand('redo') },
        { label: 'Cut', shortcut: 'Ctrl+X', onSelect: () => executeDocumentCommand('cut') },
        { label: 'Copy', shortcut: 'Ctrl+C', onSelect: () => executeDocumentCommand('copy') },
        { label: 'Paste', shortcut: 'Ctrl+V', onSelect: () => executeDocumentCommand('paste') },
      ],
    },
    {
      id: 'view',
      label: 'View',
      items: MODE_OPTIONS.map(mode => ({
        label: mode.label,
        disabled: mode.id === appMode,
        onSelect: () => setAppMode(mode.id),
      })),
    },
    {
      id: 'window',
      label: 'Window',
      items: [
        { label: modeRailOpen ? 'Hide Window Rail' : 'Show Window Rail', onSelect: () => setModeRailOpen(open => !open) },
        { label: 'Minimize', onSelect: () => { appWindow?.minimize(); } },
        { label: 'Maximize / Restore', onSelect: () => { appWindow?.toggleMaximize(); } },
      ],
    },
    {
      id: 'help',
      label: 'Help',
      items: [
        { label: 'Action Center', onSelect: () => setAppMode('actioncenter') },
        { label: 'Starlink Toolbox', onSelect: () => setAppMode('mcptoolbox') },
      ],
    },
  ];

  const content = (
    <div className={`flex flex-col h-screen overflow-hidden theme-${theme} bg-bg-app text-text-primary font-sans select-none relative`}>
      <CustomThemeInjector />
      {fatalReport && <FatalErrorOverlay report={fatalReport} onDismiss={() => { clearLastFatalReport(); setFatalReport(null); }} />}
      
      <div className="flex items-center h-10 bg-bg-titlebar border-b border-border-panel shrink-0 select-none relative z-50">
        <button
          type="button"
          className="flex items-center justify-center w-12 border-r border-border-panel h-full cursor-pointer hover:bg-bg-surface transition-colors"
          onClick={() => setModeRailOpen(open => !open)}
          title={modeRailOpen ? 'Hide window rail' : 'Show window rail'}
          aria-label={modeRailOpen ? 'Hide window rail' : 'Show window rail'}
          aria-controls={modeRailOpen ? 'td-mode-rail' : undefined}
          aria-expanded={modeRailOpen}
          data-tauri-no-drag
        >
          <CometAiLogoMark className="w-8 h-8" />
        </button>

        <div className="flex-1 flex items-center h-full min-w-0 relative z-10">
          <nav className="flex items-center h-full px-1" aria-label="Application menu" data-tauri-no-drag data-top-bar-menu>
            {topBarMenus.map(menu => (
              <div key={menu.id} className="relative h-full flex items-center">
                <button
                  type="button"
                  className={`h-full px-3 flex items-center text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors ${activeTopBarMenu === menu.id ? 'bg-bg-surface text-text-primary' : ''}`}
                  onClick={() => setActiveTopBarMenu(activeTopBarMenu === menu.id ? null : menu.id)}
                  aria-haspopup="menu"
                  aria-expanded={activeTopBarMenu === menu.id}
                >
                  {menu.label}
                </button>
                {activeTopBarMenu === menu.id && (
                  <div className="absolute left-0 top-full mt-px min-w-48 rounded-md border border-border-panel bg-bg-panel shadow-2xl py-1 z-[60]" role="menu">
                    {menu.items.map(item => (
                      <button
                        key={`${menu.id}-${item.label}`}
                        type="button"
                        className="w-full min-h-8 px-3 flex items-center justify-between gap-5 text-left text-[12px] text-text-secondary hover:text-text-primary hover:bg-bg-surface disabled:opacity-45 disabled:hover:bg-transparent disabled:hover:text-text-secondary"
                        disabled={item.disabled}
                        role="menuitem"
                        onClick={() => {
                          setActiveTopBarMenu(null);
                          item.onSelect();
                        }}
                      >
                        <span>{item.label}</span>
                        {item.shortcut && <span className="text-[11px] text-text-muted">{item.shortcut}</span>}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            ))}
          </nav>
          <div className="flex-1 h-full" data-tauri-drag-region />
        </div>

        <div className="flex h-full items-center gap-2 shrink-0 relative z-10" data-tauri-drag-region>
          {appMode === 'workspace' && dirtyEditorCount > 0 && (
            <button
              type="button"
              onClick={() => saveAllDirtyEditors().catch(error => console.error('Failed to save all editors:', error))}
              className="h-6 px-2 flex items-center gap-1 rounded-md border border-accent-primary/30 bg-accent-primary/10 text-[11px] font-medium text-accent-primary hover:bg-accent-primary/20 transition-colors"
              title="Save all dirty editors"
              aria-label={`Save ${dirtyEditorCount} dirty editor${dirtyEditorCount === 1 ? '' : 's'}`}
              data-tauri-no-drag
            >
              <Save size={12} />
              <span>{dirtyEditorCount}</span>
            </button>
          )}
          <div className="flex h-full items-stretch" data-tauri-no-drag>
            <button type="button" aria-label="Minimize window" title="Minimize" onClick={() => appWindow?.minimize()} className="w-11 h-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors"><Minus size={13} strokeWidth={1.7} /></button>
            <button type="button" aria-label="Maximize window" title="Maximize" onClick={() => appWindow?.toggleMaximize()} className="w-11 h-full flex items-center justify-center text-text-secondary hover:text-text-primary hover:bg-bg-surface transition-colors"><Square size={11} strokeWidth={1.7} /></button>
            <button type="button" aria-label="Close window" title="Close" onClick={() => appWindow?.close()} className="w-11 h-full flex items-center justify-center text-text-secondary hover:text-white hover:bg-[#c42b1c] transition-colors"><X size={14} strokeWidth={1.7} /></button>
          </div>
        </div>
      </div>

      <div className="flex-1 flex overflow-hidden relative">
        {modeRailOpen && <ModeRail />}
        {appMode === 'workspace' && (
          <Suspense fallback={null}>
            <Sidebar />
          </Suspense>
        )}
        <main className="flex-1 flex flex-col min-w-0 bg-bg-app relative">
          {appMode === 'workflow' ? (
            <div className="flex-1 min-h-0 flex overflow-hidden">
              <div className="flex-1 min-w-0 overflow-hidden">
                <Suspense fallback={<PaneLoadingFallback label="Loading workflow" />}>
                  <NodeTreePane graph={globalGraph} onGraphChange={setGlobalGraph} />
                </Suspense>
              </div>
            </div>
          ) : appMode === 'runtime' ? (
            <Suspense fallback={<PaneLoadingFallback label="Loading runtime" />}>
              <RuntimeView />
            </Suspense>
          ) : appMode === 'actioncenter' ? (
            <Suspense fallback={<PaneLoadingFallback label="Loading action center" />}>
              <ActionCenterPane />
            </Suspense>
          ) : appMode === 'mcptoolbox' ? (
            <Suspense fallback={<PaneLoadingFallback label="Loading Starlink Toolbox" />}>
              <StarlinkToolboxPage />
            </Suspense>
          ) : (
            <div className="flex-1 flex flex-col overflow-hidden">
              <Suspense fallback={<PaneLoadingFallback label="Loading workspace" />}>
                <WorkspaceGrid />
              </Suspense>
            </div>
          )}
          {showQuickOpen && (
            <Suspense fallback={null}>
              <QuickOpen onClose={() => setShowQuickOpen(false)} />
            </Suspense>
          )}
        </main>
      </div>

      {showSettings && (
        <Suspense fallback={null}>
          <SettingsOverlay />
        </Suspense>
      )}
      <Suspense fallback={null}>
        <AgentDock />
      </Suspense>
      <GlobalNotificationOverlay />
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
      sendFrontendErrorToDebugMcp(next, name);
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
          <div className="p-4 space-y-3"><pre className="text-[11px] whitespace-pre-wrap break-words bg-bg-surface border border-border-panel rounded-lg p-3 text-text-primary">{formatErrorForDisplay(error)}</pre></div>
        </div>
      </div>
    )}>
      {content}
    </ErrorBoundary>
  );
}

function GlobalNotificationOverlay() {
  const setAppMode = useWorkspaceStore((s) => s.setAppMode);
  const { items, clearRecent } = useActionCenterItems();
  const [dismissed, setDismissed] = useState<Set<string>>(() => new Set());
  const item = items.find(candidate => !dismissed.has(candidate.id) && candidate.section === 'needs_you')
    ?? items.find(candidate => !dismissed.has(candidate.id) && candidate.kind === 'recent_event');

  useEffect(() => {
    if (!item || item.section === 'needs_you') return;
    const timer = window.setTimeout(() => {
      setDismissed(prev => new Set(prev).add(item.id));
      if (item.kind === 'recent_event') clearRecent(item.id);
    }, 6000);
    return () => window.clearTimeout(timer);
  }, [clearRecent, item]);

  const runAction = async (actionId: ActionCenterActionId, target: ActionCenterItem) => {
    if (actionId === 'approve_permission' && target.kind === 'permission') {
      const { runtimeManager } = await import('./lib/runtime/RuntimeManager');
      await runtimeManager.resolvePermission({ sessionId: target.sessionId!, permissionId: target.permissionId, decision: 'approve' });
      setDismissed(prev => new Set(prev).add(target.id));
    } else if (actionId === 'deny_permission' && target.kind === 'permission') {
      const { runtimeManager } = await import('./lib/runtime/RuntimeManager');
      await runtimeManager.resolvePermission({ sessionId: target.sessionId!, permissionId: target.permissionId, decision: 'deny' });
      setDismissed(prev => new Set(prev).add(target.id));
    } else if (actionId === 'retry_runtime' && target.missionId && target.nodeId) {
      const { missionOrchestrator } = await import('./lib/workflow/MissionOrchestrator');
      await missionOrchestrator.retryNode(target.missionId, target.nodeId);
      setDismissed(prev => new Set(prev).add(target.id));
    } else if (actionId === 'approve_delegation' && target.kind === 'delegation') {
      await missionRepository.invokeMcp('approve_inbox_item', { itemId: target.inboxItemId });
      setDismissed(prev => new Set(prev).add(target.id));
    } else if (actionId === 'reject_delegation' && target.kind === 'delegation') {
      await missionRepository.invokeMcp('reject_inbox_item', { itemId: target.inboxItemId });
      setDismissed(prev => new Set(prev).add(target.id));
    } else {
      setAppMode('actioncenter');
    }
  };

  if (!item) return null;

  return (
    <div className="fixed right-4 top-14 z-[9000] w-[340px] max-w-[calc(100vw-2rem)] rounded-lg border border-border-panel bg-bg-panel/95 shadow-2xl backdrop-blur p-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-accent-primary">{item.section === 'needs_you' ? 'Needs You' : 'Update'}</div>
          <div className="mt-1 text-sm font-semibold text-text-primary truncate">{item.title}</div>
          {item.detail && <div className="mt-1 text-[11px] leading-snug text-text-muted line-clamp-3">{item.detail}</div>}
        </div>
        <button
          className="shrink-0 text-text-muted hover:text-text-primary"
          onClick={() => {
            setDismissed(prev => new Set(prev).add(item.id));
            if (item.kind === 'recent_event') clearRecent(item.id);
          }}
          title="Dismiss"
        >
          <X size={14} />
        </button>
      </div>
      {item.actions.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-2">
          {item.actions.slice(0, 3).map(action => (
            <button
              key={action.id}
              className={`px-2 py-1 rounded border text-[11px] ${
                action.tone === 'danger'
                  ? 'border-red-400/30 bg-red-500/10 text-red-200 hover:bg-red-500/20'
                  : action.tone === 'primary'
                    ? 'border-accent-primary/40 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20'
                    : 'border-border-panel text-text-secondary hover:text-text-primary hover:bg-bg-surface'
              }`}
              onClick={() => void runAction(action.id, item)}
            >
              {action.label}
            </button>
          ))}
          <button
            className="px-2 py-1 rounded border border-border-panel text-[11px] text-text-muted hover:text-text-primary hover:bg-bg-surface"
            onClick={() => setAppMode('actioncenter')}
          >
            More
          </button>
        </div>
      )}
    </div>
  );
}

function App() {
  return <MainApp />;
}

const MODE_OPTIONS: Array<{ id: AppMode; label: string; icon: React.ReactNode }> = [
  { id: 'workspace', label: 'Workspace', icon: <FolderTree size={18} /> },
  { id: 'workflow', label: 'Workflow Builder', icon: <Network size={18} /> },
  { id: 'runtime', label: 'Runtime Monitor', icon: <TerminalSquare size={18} /> },
  { id: 'mcptoolbox', label: 'Starlink Toolbox', icon: <Toolbox size={18} /> },
  { id: 'actioncenter', label: 'Action Center', icon: <Bell size={18} /> },
];

function CometAiLogoMark({ className = '' }: { className?: string }) {
  return (
    <img
      className={`object-contain ${className}`}
      src="/comet-ai-logo.svg"
      alt="Comet-AI logo"
      draggable={false}
    />
  );
}

function ModeRail() {
  const appMode = useWorkspaceStore((s) => s.appMode);
  const setAppMode = useWorkspaceStore((s) => s.setAppMode);
  const setShowSettings = useWorkspaceStore((s) => s.setShowSettings);
  const showSettings = useWorkspaceStore((s) => s.showSettings);
  const { needsYouCount } = useActionCenterItems();

  return (
    <nav id="td-mode-rail" className="td-mode-rail" aria-label="Window rail">
      <div className="td-mode-rail-items">
        {MODE_OPTIONS.map((mode) => (
          <button
            key={mode.id}
            type="button"
            onClick={() => setAppMode(mode.id)}
            title={mode.label}
            aria-label={mode.label}
            aria-current={appMode === mode.id ? 'page' : undefined}
            className={`td-mode-rail-button ${appMode === mode.id ? 'is-active' : ''}`}
          >
            <span className="td-mode-rail-icon">{mode.icon}</span>
            <span className="td-mode-rail-label">{mode.label}</span>
            {appMode === mode.id && <span className="td-mode-rail-active" />}
            {mode.id === 'actioncenter' && needsYouCount > 0 && (
              <span className="td-mode-rail-badge">
                {needsYouCount > 9 ? '9+' : needsYouCount}
              </span>
            )}
          </button>
        ))}
      </div>

      <div className="td-mode-rail-footer">
        <button
          type="button"
          onClick={() => setShowSettings(!showSettings)}
          title="Settings"
          aria-label="Settings"
          aria-pressed={showSettings}
          className={`td-mode-rail-button ${showSettings ? 'is-active' : ''}`}
        >
          <span className="td-mode-rail-icon"><Settings size={18} /></span>
          <span className="td-mode-rail-label">Settings</span>
          {showSettings && <span className="td-mode-rail-active" />}
        </button>
      </div>
    </nav>
  );
}

export default App;
