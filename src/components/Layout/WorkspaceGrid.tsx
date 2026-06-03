import { TerminalSquare, FileCode2, KanbanSquare, Activity, Rocket, Monitor, X, Network, Bell, Columns2, PanelRightClose, Globe2, Plus, ClipboardPenLine } from 'lucide-react';
import { useWorkspaceStore, PaneType, Pane, selectActivePanes, GridPos, resolveCollisions } from '../../store/workspace';
import React, { Suspense, lazy, useState, useRef, useEffect, useCallback, useMemo, useId } from 'react';
import { siClaudecode, siGooglegemini, type SimpleIcon } from 'simple-icons';
import { FileTypeIcon } from '../../lib/fileIcons';
import { normalizePreviewUrl } from '../../lib/previewUrl';
import { terminalOutputBus } from '../../lib/runtime/TerminalOutputBus';
import { discoverWorkspaceServers, formatWorkspaceServerLabel, shortWorkspaceServerUrl, type DetectedWorkspaceServer } from '../../lib/workspaceServerDiscovery';
import { activePaneIdForPanes, currentDirectoryForPane, nextTerminalTitle, nextUntitledEditorTitle } from '../../lib/workspaceTabs';
import { normalizeTerminalId } from '../../lib/terminalIds';

const TerminalPane = lazy(() => import('../Terminal/TerminalPane').then(module => ({ default: module.TerminalPane })));
const EditorPane = lazy(() => import('../Editor/EditorPane').then(module => ({ default: module.EditorPane })));
const ChangeReviewPane = lazy(() => import('../ChangeReview/ChangeReviewPane').then(module => ({ default: module.ChangeReviewPane })));
const PreviewPane = lazy(() => import('../Preview/PreviewPane').then(module => ({ default: module.PreviewPane })));
const TaskBoardPane = lazy(() => import('../TaskBoard/TaskBoardPane').then(module => ({ default: module.TaskBoardPane })));
const ActivityFeedPane = lazy(() => import('../ActivityFeed/ActivityFeedPane').then(module => ({ default: module.ActivityFeedPane })));
const LauncherPane = lazy(() => import('../Launcher/LauncherPane').then(module => ({ default: module.LauncherPane })));
const MissionControlPane = lazy(() => import('../MissionControl/MissionControlPane').then(module => ({ default: module.MissionControlPane })));
const ActionCenterPane = lazy(() => import('../ActionCenter/ActionCenterPane').then(module => ({ default: module.ActionCenterPane })));

function SimpleBrandLogo({ icon, label, size = 13 }: { icon: SimpleIcon; label: string; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" role="img" aria-label={label} style={{ color: `#${icon.hex}` }}>
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

function OpenAiLogo({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" role="img" aria-label="OpenAI">
      <path
        fill="currentColor"
        d="M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z"
      />
    </svg>
  );
}

function OpenCodeLogo({ size = 13 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 300 300" role="img" aria-label="OpenCode">
      <g transform="translate(30, 0)">
        <path d="M180 240H60V120H180V240Z" fill="#4B4646" />
        <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="#F1ECEC" />
      </g>
    </svg>
  );
}

function cliIconForAgentPane(pane: Pane, size = 13): React.ReactNode {
  const cli = typeof pane.data?.followUpCli === 'string' ? pane.data.followUpCli : 'codex';
  if (cli === 'claude') return <SimpleBrandLogo icon={siClaudecode} label="Claude Code" size={size} />;
  if (cli === 'gemini') return <SimpleBrandLogo icon={siGooglegemini} label="Google Gemini" size={size} />;
  if (cli === 'opencode') return <OpenCodeLogo size={size} />;
  return <OpenAiLogo size={size} />;
}

const PANE_ICONS: Record<PaneType, React.ReactNode> = {
  terminal:       <TerminalSquare size={13} />,
  editor:         <FileCode2 size={13} />,
  changereview:   <FileCode2 size={13} />,
  preview:        <Globe2 size={13} />,
  taskboard:      <KanbanSquare size={13} />,
  activityfeed:   <Activity size={13} />,
  launcher:       <Rocket size={13} />,
  missioncontrol: <Monitor size={13} />,
  nodetree:       <Network size={13} />,
  inbox:          <Bell size={13} />,
};

function getPaneIcon(pane: Pane, size = 13) {
  if (pane.type === 'editor') {
    return <FileTypeIcon fileName={(pane.data?.filePath as string | undefined) ?? pane.title} size={size} />;
  }
  if (pane.type === 'missioncontrol' && pane.data?.dockExpandedToTab === true) {
    return cliIconForAgentPane(pane, size);
  }
  return PANE_ICONS[pane.type];
}

function PaneLoadingFallback() {
  return <div className="w-full h-full flex items-center justify-center text-xs text-text-muted">Loading</div>;
}

function PaneBody({ pane, dragEndSeq }: { pane: Pane; dragEndSeq: number }) {
  return (
    <Suspense fallback={<PaneLoadingFallback />}>
      {pane.type === 'terminal'       && <TerminalPane pane={pane} dragEndSeq={dragEndSeq} />}
      {pane.type === 'editor'         && <EditorPane pane={pane} />}
      {pane.type === 'changereview'   && <ChangeReviewPane pane={pane} />}
      {pane.type === 'preview'        && <PreviewPane pane={pane} />}
      {pane.type === 'taskboard'      && <TaskBoardPane />}
      {pane.type === 'activityfeed'   && <ActivityFeedPane />}
      {pane.type === 'launcher'       && <LauncherPane />}
      {pane.type === 'missioncontrol' && <MissionControlPane pane={pane} />}
      {pane.type === 'inbox'          && <ActionCenterPane />}
    </Suspense>
  );
}

function isHiddenDockAgentPane(pane: Pane): boolean {
  if (pane.type !== 'missioncontrol') return false;
  if (pane.data?.dockOnly === true) return true;
  if (pane.data?.dockOnly === false) return false;
  const missionId = pane.data?.missionId;
  return pane.title === 'Workspace Agent' && typeof missionId === 'string' && missionId.startsWith('adhoc-workspace-');
}

const CELL_HEIGHT = 4;
const GRID_COLUMNS = 100;
const WORKSPACE_PANE_DROP_TYPES = new Set<PaneType>([
  'terminal',
  'editor',
  'changereview',
  'preview',
  'taskboard',
  'activityfeed',
  'launcher',
  'missioncontrol',
  'nodetree',
  'inbox',
]);

interface DashboardPanelProps {
  pane: Pane;
  onDragStart: (id: string, e: React.MouseEvent) => void;
  onResizeStart: (id: string, e: React.MouseEvent) => void;
  isDragging: boolean;
  isResizing: boolean;
  anyActive: boolean;
  dragEndSeq: number;
}

interface WorkspacePaneDropDetail {
  type: PaneType;
  title?: string;
  data?: Record<string, unknown>;
  clientX: number;
  clientY: number;
}

function isWorkspacePaneDropDetail(value: unknown): value is WorkspacePaneDropDetail {
  if (!value || typeof value !== 'object') return false;
  const detail = value as Partial<WorkspacePaneDropDetail>;
  return typeof detail.type === 'string'
    && WORKSPACE_PANE_DROP_TYPES.has(detail.type as PaneType)
    && typeof detail.clientX === 'number'
    && typeof detail.clientY === 'number';
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
          <span className="text-text-muted">{getPaneIcon(pane)}</span>
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
              type="button"
              onMouseDown={(e) => e.stopPropagation()}
              onClick={() => removePane(pane.id)}
              aria-label={`Close ${pane.title}`}
              className="w-5 h-5 flex items-center justify-center rounded text-text-muted hover:text-red-400 hover:bg-bg-surface"
            >
              <X size={12} />
            </button>
          </div>
        </div>

        {/* Body */}
        <div ref={bodyRef} className="flex-1 overflow-hidden relative">
          <PaneBody pane={pane} dragEndSeq={dragEndSeq} />
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
  const addPane = useWorkspaceStore(s => s.addPane);
  const workspaceDir = useWorkspaceStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.workspaceDir ?? s.workspaceDir);
  const [secondaryPaneId, setSecondaryPaneId] = useState<string | null>(null);
  const [addMenuOpen, setAddMenuOpen] = useState(false);
  const [serverScanSeq, setServerScanSeq] = useState(0);
  const addMenuRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);
  const firstAddMenuItemRef = useRef<HTMLButtonElement>(null);
  const tabButtonRefs = useRef(new Map<string, HTMLDivElement>());
  const addMenuId = useId();
  const paneTabIdPrefix = useId();
  
  const activePane = panes.find(p => p.id === activePaneId) || panes[0];
  const activePaneTabId = activePane ? `${paneTabIdPrefix}-tab-${activePane.id}` : undefined;
  const activePanePanelId = activePane ? `${paneTabIdPrefix}-panel-${activePane.id}` : undefined;
  const secondaryPane = secondaryPaneId && secondaryPaneId !== activePane?.id
    ? panes.find(p => p.id === secondaryPaneId) ?? null
    : null;
  const terminalIds = useMemo(
    () => Array.from(new Set(panes
      .map(pane => pane.type === 'terminal' ? normalizeTerminalId(pane.data?.terminalId) : null)
      .filter((terminalId): terminalId is string => Boolean(terminalId)))),
    [panes],
  );
  const detectedServers = useMemo(
    () => discoverWorkspaceServers(panes, (terminalId, maxBytes) => terminalOutputBus.getTail(terminalId, maxBytes)),
    [panes, serverScanSeq],
  );
  const currentDirectory = currentDirectoryForPane(activePane, workspaceDir);

  const activatePane = useCallback((id: string) => {
    setActivePaneId(id);
    if (id === secondaryPaneId) setSecondaryPaneId(null);
  }, [secondaryPaneId, setActivePaneId]);

  const setPaneTabRef = useCallback((id: string, node: HTMLDivElement | null) => {
    if (node) {
      tabButtonRefs.current.set(id, node);
    } else {
      tabButtonRefs.current.delete(id);
    }
  }, []);

  const toggleSplitPane = useCallback((id: string) => {
    if (id === activePane?.id) return;
    setSecondaryPaneId(current => current === id ? null : id);
  }, [activePane?.id]);

  const openAddMenu = useCallback(() => {
    setAddMenuOpen(current => {
      if (!current) {
        void terminalOutputBus.start();
        setServerScanSeq(seq => seq + 1);
      }
      return true;
    });
  }, []);

  const toggleAddMenu = useCallback(() => {
    if (!addMenuOpen) {
      void terminalOutputBus.start();
      setServerScanSeq(seq => seq + 1);
    }
    setAddMenuOpen(open => !open);
  }, [addMenuOpen]);

  const handleAddButtonKeyDown = useCallback((event: React.KeyboardEvent<HTMLButtonElement>) => {
    if (event.key !== 'ArrowDown') return;
    event.preventDefault();
    openAddMenu();
  }, [openAddMenu]);

  useEffect(() => {
    const nextActivePaneId = activePaneIdForPanes(panes, activePaneId);
    if (nextActivePaneId !== activePaneId) {
      setActivePaneId(nextActivePaneId);
    }
  }, [panes, activePaneId, setActivePaneId]);

  useEffect(() => {
    if (secondaryPaneId && !panes.some(pane => pane.id === secondaryPaneId)) {
      setSecondaryPaneId(null);
    }
  }, [panes, secondaryPaneId]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (addMenuRef.current?.contains(event.target as Node)) return;
      setAddMenuOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setAddMenuOpen(false);
        addButtonRef.current?.focus();
      }
    };
    document.addEventListener('pointerdown', handlePointerDown);
    document.addEventListener('keydown', handleKeyDown);
    return () => {
      document.removeEventListener('pointerdown', handlePointerDown);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [addMenuOpen]);

  useEffect(() => {
    if (!addMenuOpen) return;
    const focusTimer = window.setTimeout(() => firstAddMenuItemRef.current?.focus(), 0);
    return () => window.clearTimeout(focusTimer);
  }, [addMenuOpen]);

  const handleAddMenuKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>) => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    const menuItems = Array.from(
      addMenuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]:not(:disabled)') ?? [],
    );
    if (!menuItems.length) return;

    event.preventDefault();
    const activeIndex = menuItems.indexOf(document.activeElement as HTMLButtonElement);
    if (event.key === 'Home') {
      menuItems[0].focus();
      return;
    }
    if (event.key === 'End') {
      menuItems[menuItems.length - 1].focus();
      return;
    }

    const delta = event.key === 'ArrowDown' ? 1 : -1;
    const nextIndex = activeIndex < 0
      ? 0
      : (activeIndex + delta + menuItems.length) % menuItems.length;
    menuItems[nextIndex].focus();
  }, []);

  const handlePaneTabKeyDown = useCallback((event: React.KeyboardEvent<HTMLDivElement>, paneId: string, index: number) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === 'Enter' || event.key === ' ') {
      event.preventDefault();
      activatePane(paneId);
      return;
    }
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;

    event.preventDefault();
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? panes.length - 1
        : (index + (event.key === 'ArrowRight' ? 1 : -1) + panes.length) % panes.length;
    const nextPane = panes[nextIndex];
    if (!nextPane) return;
    activatePane(nextPane.id);
    tabButtonRefs.current.get(nextPane.id)?.focus();
  }, [activatePane, panes]);

  useEffect(() => {
    if (!addMenuOpen || terminalIds.length === 0) return;
    let refreshTimer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (refreshTimer) return;
      refreshTimer = setTimeout(() => {
        refreshTimer = null;
        setServerScanSeq(seq => seq + 1);
      }, 250);
    };
    const unsubscribers = terminalIds.map(terminalId => terminalOutputBus.subscribe(terminalId, scheduleRefresh));
    return () => {
      if (refreshTimer) clearTimeout(refreshTimer);
      unsubscribers.forEach(unsubscribe => unsubscribe());
    };
  }, [addMenuOpen, terminalIds]);

  const openEditorPane = useCallback(() => {
    addPane('editor', nextUntitledEditorTitle(panes), { untitled: true, untitledContent: '' });
    setAddMenuOpen(false);
  }, [addPane, panes]);

  const openTerminalPane = useCallback(() => {
    addPane('terminal', nextTerminalTitle(panes), { cwd: currentDirectory ?? undefined });
    setAddMenuOpen(false);
  }, [addPane, currentDirectory, panes]);

  const openServerPane = useCallback((server: DetectedWorkspaceServer) => {
    const normalizedUrl = normalizePreviewUrl(server.url);
    if (!normalizedUrl) {
      setAddMenuOpen(false);
      return;
    }
    const existingServerPane = panes.find(pane => (
      pane.type === 'preview'
      && typeof pane.data?.url === 'string'
      && normalizePreviewUrl(pane.data.url) === normalizedUrl
    ));
    if (existingServerPane) {
      activatePane(existingServerPane.id);
      setAddMenuOpen(false);
      return;
    }
    addPane('preview', `Server: ${shortWorkspaceServerUrl(server.url)}`, {
      url: normalizedUrl,
      previewTitle: formatWorkspaceServerLabel(server),
    });
    setAddMenuOpen(false);
  }, [activatePane, addPane, panes]);

  return (
    <div className="flex-1 flex flex-col bg-bg-app overflow-hidden">
      {/* File Tab Bar */}
      <div className="td-workspace-tab-bar flex items-center h-9 bg-bg-titlebar border-b border-border-panel shrink-0">
        <div className="flex min-w-0 items-center h-full overflow-x-auto no-scrollbar">
          <div className="flex h-full items-center" role="tablist" aria-label="Workspace panes">
            {panes.map((pane, index) => (
              <div
                key={pane.id}
                ref={node => setPaneTabRef(pane.id, node)}
                id={`${paneTabIdPrefix}-tab-${pane.id}`}
                role="tab"
                tabIndex={activePane?.id === pane.id ? 0 : -1}
                aria-selected={activePane?.id === pane.id}
                aria-controls={`${paneTabIdPrefix}-panel-${pane.id}`}
                aria-label={`${pane.title} tab`}
                onClick={() => activatePane(pane.id)}
                onKeyDown={(event) => handlePaneTabKeyDown(event, pane.id, index)}
                className={`
                  group flex items-center h-full px-3 gap-2 border-r border-border-panel cursor-pointer select-none transition-colors min-w-[120px] max-w-[200px]
                  ${activePane?.id === pane.id ? 'bg-bg-app border-b-2 border-b-accent-primary' : secondaryPaneId === pane.id ? 'bg-bg-surface/70 border-b-2 border-b-accent-primary/50' : 'bg-transparent text-text-muted hover:bg-bg-surface/50 hover:text-text-secondary'}
                `}
              >
                <span className={activePane?.id === pane.id ? 'text-accent-primary' : 'text-text-muted opacity-60'}>
                  {getPaneIcon(pane)}
                </span>
                <span className={`text-[11px] font-medium truncate flex-1 ${activePane?.id === pane.id ? 'text-text-primary' : ''}`}>
                  {pane.title}
                </span>
                {pane.id !== activePane?.id && (
                  <button
                    type="button"
                    onClick={(e) => { e.stopPropagation(); toggleSplitPane(pane.id); }}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 rounded hover:bg-bg-surface text-text-muted hover:text-accent-primary transition-all"
                    title={secondaryPaneId === pane.id ? 'Close split view' : 'Open to side'}
                    aria-label={`${secondaryPaneId === pane.id ? 'Close split view for' : 'Open to side'} ${pane.title}`}
                  >
                    {secondaryPaneId === pane.id ? <PanelRightClose size={12} /> : <Columns2 size={12} />}
                  </button>
                )}
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    if (secondaryPaneId === pane.id) setSecondaryPaneId(null);
                    removePane(pane.id);
                  }}
                  onKeyDown={(e) => e.stopPropagation()}
                  className="opacity-0 group-hover:opacity-100 focus-visible:opacity-100 p-0.5 rounded hover:bg-bg-surface text-text-muted hover:text-red-400 transition-all"
                  title="Close tab"
                  aria-label={`Close ${pane.title}`}
                >
                  <X size={12} />
                </button>
              </div>
            ))}
          </div>
        </div>
        <div ref={addMenuRef} className="td-workspace-tab-add">
          <button
            ref={addButtonRef}
            type="button"
            onClick={toggleAddMenu}
            onKeyDown={handleAddButtonKeyDown}
            className={`td-agent-add-button ${addMenuOpen ? 'is-open' : ''}`}
            title="Open new pane tab"
            aria-label="Open new pane tab"
            aria-haspopup="menu"
            aria-expanded={addMenuOpen}
            aria-controls={addMenuOpen ? addMenuId : undefined}
          >
            <Plus size={16} />
          </button>
          {addMenuOpen && (
            <div id={addMenuId} className="td-agent-add-menu td-workspace-tab-add-menu" role="menu" aria-label="New workspace pane" onKeyDown={handleAddMenuKeyDown}>
              <button ref={firstAddMenuItemRef} type="button" className="td-agent-add-option" role="menuitem" onClick={openEditorPane} aria-label="Create editor pane">
                <ClipboardPenLine size={14} />
                <span>Editor</span>
              </button>
              <button type="button" className="td-agent-add-option" role="menuitem" onClick={openTerminalPane} aria-label="Create terminal pane">
                <TerminalSquare size={14} />
                <span>Terminal</span>
              </button>
              {detectedServers.length === 0 ? (
                <button type="button" className="td-agent-add-option" role="menuitem" disabled aria-disabled="true">
                  <Globe2 size={14} />
                  <span className="td-workspace-tab-add-copy">
                    <span>Server</span>
                    <small>No running servers found</small>
                  </span>
                </button>
              ) : detectedServers.length === 1 ? (
                <button
                  type="button"
                  className="td-agent-add-option"
                  role="menuitem"
                  onClick={() => openServerPane(detectedServers[0])}
                  title={shortWorkspaceServerUrl(detectedServers[0].url)}
                  aria-label={`Open server ${formatWorkspaceServerLabel(detectedServers[0])}`}
                >
                  <Globe2 size={14} />
                  <span className="td-workspace-tab-add-copy">
                    <span>Server</span>
                    <small>{formatWorkspaceServerLabel(detectedServers[0])}</small>
                  </span>
                </button>
              ) : (
                <div className="td-workspace-tab-add-section">
                  <div className="td-workspace-tab-add-heading" role="presentation" aria-hidden="true">
                    <Globe2 size={14} />
                    <span className="td-workspace-tab-add-copy">
                      <span>Server</span>
                      <small>{detectedServers.length} running servers found</small>
                    </span>
                  </div>
                  <div className="td-workspace-tab-add-server-list" role="group" aria-label={`${detectedServers.length} running servers found`}>
                    {detectedServers.map(server => (
                      <button
                        key={server.url}
                        type="button"
                        className="td-agent-add-option td-workspace-tab-add-server-option"
                        role="menuitem"
                        onClick={() => openServerPane(server)}
                        title={shortWorkspaceServerUrl(server.url)}
                        aria-label={`Open server ${formatWorkspaceServerLabel(server)}`}
                      >
                        <Globe2 size={14} />
                        <span className="td-workspace-tab-add-copy">
                          <span>{shortWorkspaceServerUrl(server.url)}</span>
                          <small>{formatWorkspaceServerLabel(server)}</small>
                        </span>
                      </button>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
        <div className="min-w-0 flex-1" aria-hidden="true" />
      </div>

      {/* Active Pane Content */}
      <div className="flex-1 overflow-hidden relative">
        {activePane ? (
          <div
            id={activePanePanelId}
            role="tabpanel"
            aria-labelledby={activePaneTabId}
            className="w-full h-full flex min-w-0"
          >
            <div className="h-full min-w-0 flex flex-col" style={{ width: secondaryPane ? '50%' : '100%' }}>
              <PaneBody pane={activePane} dragEndSeq={0} />
            </div>
            {secondaryPane && (
              <div className="h-full min-w-0 flex flex-col border-l border-border-panel" style={{ width: '50%' }}>
                <PaneBody pane={secondaryPane} dragEndSeq={0} />
              </div>
            )}
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
  const renamePane = useWorkspaceStore(s => s.renamePane);
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
    () => panes.filter(pane => !isHiddenDockAgentPane(pane) && (!visibleTypes || visibleTypes.includes(pane.type))),
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

    const handleDrop = (event: Event) => {
      if (containerWidth <= 0 || !(event instanceof CustomEvent) || !isWorkspacePaneDropDetail(event.detail)) return;
      const { type, title, data, clientX, clientY } = event.detail;
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

      const newTitle = title || (type.charAt(0).toUpperCase() + type.slice(1));
      if (type === 'editor' && typeof data?.filePath === 'string' && overPane?.type === 'editor' && !overPane.data?.editorDirty) {
        renamePane(overPane.id, newTitle);
        updatePaneData(overPane.id, { filePath: data.filePath, editorDirty: false, editorReloadToken: `${Date.now()}` });
      } else {
        // Add new pane at dropped position
        addPaneAt(type, newTitle, panes.length, { ...data, gridPos: { x, y, w: 25, h: 40 } });
      }
    };

    grid.addEventListener('pane-drop', handleDrop);
    return () => grid.removeEventListener('pane-drop', handleDrop);
  }, [panes, containerWidth, updatePaneData, renamePane, addPaneAt]);

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
