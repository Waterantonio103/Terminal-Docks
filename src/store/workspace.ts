import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export function arrayMove<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  const newArray = [...array];
  const [item] = newArray.splice(fromIndex, 1);
  newArray.splice(toIndex, 0, item);
  return newArray;
}

export type PaneType = 'terminal' | 'editor' | 'taskboard' | 'activityfeed';

export type ThemeType =
  // Original themes
  | 'dark' | 'light' | 'nord' | 'dracula' | 'cyberpunk' | 'ocean' | 'solarized'
  // Spec dark themes
  | 'void' | 'ghost' | 'plasma' | 'carbon' | 'hex' | 'neon-tokyo' | 'obsidian'
  | 'nebula' | 'storm' | 'infrared' | 'nova' | 'stealth' | 'hologram' | 'bridgemind'
  | 'synthwave' | 'cybernetics' | 'quantum' | 'mecha' | 'abyss'
  // Spec light themes
  | 'paper' | 'chalk' | 'solar' | 'arctic' | 'ivory';

export interface Pane {
  id: string;
  type: PaneType;
  title: string;
  data?: {
    terminalId?: string;
    filePath?: string;
    initialCommand?: string;
    [key: string]: any;
  };
}

export interface WorkspaceTab {
  id: string;
  name: string;
  color: string;
  panes: Pane[];
}

export interface SavedLayout {
  id: string;
  name: string;
  createdAt: number;
  panes: Array<{ type: PaneType; title: string; data?: any }>;
}

export const TAB_COLORS = [
  '#7059f5', '#3b82f6', '#10b981', '#f59e0b',
  '#ef4444', '#8b5cf6', '#06b6d4', '#f97316',
  '#ec4899', '#14b8a6',
];

function generateId() {
  try { return crypto.randomUUID(); }
  catch { return Math.random().toString(36).substring(2, 15) + Date.now().toString(36); }
}

export function selectActivePanes(state: WorkspaceState): Pane[] {
  return state.tabs.find(t => t.id === state.activeTabId)?.panes ?? [];
}

function withActivePanes(
  state: WorkspaceState,
  updater: (panes: Pane[]) => Pane[]
): Pick<WorkspaceState, 'tabs'> {
  return {
    tabs: state.tabs.map(t =>
      t.id === state.activeTabId ? { ...t, panes: updater(t.panes) } : t
    ),
  };
}

interface WorkspaceState {
  tabs: WorkspaceTab[];
  activeTabId: string;
  sidebarOpen: boolean;
  workspaceDir: string | null;
  theme: ThemeType;
  savedLayouts: SavedLayout[];
  toggleSidebar: () => void;
  addPane: (type: PaneType, title: string, data?: any) => void;
  addPaneAt: (type: PaneType, title: string, index: number, data?: any) => void;
  removePane: (id: string) => void;
  movePane: (activeId: string, overId: string) => void;
  clearPanes: () => void;
  setWorkspaceDir: (dir: string | null) => void;
  setTheme: (theme: ThemeType) => void;
  saveLayout: (name: string) => void;
  loadLayout: (id: string) => void;
  deleteLayout: (id: string) => void;
  addTab: () => void;
  removeTab: (id: string) => void;
  switchTab: (id: string) => void;
  renameTab: (id: string, name: string) => void;
}

const _initTabId = generateId();

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      tabs: [{
        id: _initTabId,
        name: 'Workspace 1',
        color: TAB_COLORS[0],
        panes: [
          { id: generateId(), type: 'terminal', title: 'Terminal 1', data: { terminalId: generateId() } },
          { id: generateId(), type: 'editor', title: 'Welcome' },
        ],
      }],
      activeTabId: _initTabId,
      sidebarOpen: true,
      workspaceDir: null,
      theme: 'dark',
      savedLayouts: [],

      toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),

      addPane: (type, title, data) => set((state) => {
        const panes = selectActivePanes(state);
        if (data?.filePath && panes.find(p => p.data?.filePath === data.filePath)) return state;
        const newData = data ? { ...data } : {};
        if (type === 'terminal' && !newData.terminalId) newData.terminalId = generateId();
        const newPane: Pane = { id: generateId(), type, title, data: newData };
        return withActivePanes(state, ps => [...ps, newPane]);
      }),

      addPaneAt: (type, title, index, data) => set((state) => {
        const newData = data ? { ...data } : {};
        if (type === 'terminal' && !newData.terminalId) newData.terminalId = generateId();
        const newPane: Pane = { id: generateId(), type, title, data: newData };
        return withActivePanes(state, ps => {
          const arr = [...ps];
          arr.splice(index, 0, newPane);
          return arr;
        });
      }),

      removePane: (id) => set((state) => {
        const pane = selectActivePanes(state).find(p => p.id === id);
        if (pane?.type === 'terminal' && pane.data?.terminalId) {
          import('@tauri-apps/api/core').then(({ invoke }) => {
            invoke('destroy_pty', { id: pane.data?.terminalId }).catch(console.error);
          });
        }
        return withActivePanes(state, ps => ps.filter(p => p.id !== id));
      }),

      movePane: (activeId, overId) => set((state) =>
        withActivePanes(state, panes => {
          const oldIndex = panes.findIndex(p => p.id === activeId);
          const newIndex = panes.findIndex(p => p.id === overId);
          return arrayMove(panes, oldIndex, newIndex);
        })
      ),

      clearPanes: () => set((state) => withActivePanes(state, () => [])),

      setWorkspaceDir: (dir) => set({ workspaceDir: dir }),
      setTheme: (theme) => set({ theme }),

      saveLayout: (name) => set((state) => {
        const panes = selectActivePanes(state);
        const layout: SavedLayout = {
          id: generateId(),
          name,
          createdAt: Date.now(),
          panes: panes.map(({ type, title, data }) => ({ type, title, data: data ? { ...data } : {} })),
        };
        return { savedLayouts: [...state.savedLayouts, layout] };
      }),

      loadLayout: (id) => set((state) => {
        const layout = state.savedLayouts.find(l => l.id === id);
        if (!layout) return state;
        const newPanes: Pane[] = layout.panes.map(p => {
          const newData = p.data ? { ...p.data } : {};
          if (p.type === 'terminal') newData.terminalId = generateId();
          return { id: generateId(), type: p.type, title: p.title, data: newData };
        });
        return withActivePanes(state, () => newPanes);
      }),

      deleteLayout: (id) => set((state) => ({
        savedLayouts: state.savedLayouts.filter(l => l.id !== id),
      })),

      addTab: () => set((state) => {
        const tabNum = state.tabs.length + 1;
        const color = TAB_COLORS[state.tabs.length % TAB_COLORS.length];
        const newTabId = generateId();
        const newTab: WorkspaceTab = {
          id: newTabId,
          name: `Workspace ${tabNum}`,
          color,
          panes: [
            { id: generateId(), type: 'terminal', title: 'Terminal 1', data: { terminalId: generateId() } },
          ],
        };
        return { tabs: [...state.tabs, newTab], activeTabId: newTabId };
      }),

      removeTab: (id) => set((state) => {
        if (state.tabs.length <= 1) return state;
        const tab = state.tabs.find(t => t.id === id);
        if (tab) {
          tab.panes.forEach(pane => {
            if (pane.type === 'terminal' && pane.data?.terminalId) {
              import('@tauri-apps/api/core').then(({ invoke }) => {
                invoke('destroy_pty', { id: pane.data?.terminalId }).catch(console.error);
              });
            }
          });
        }
        const newTabs = state.tabs.filter(t => t.id !== id);
        const newActiveTabId = id === state.activeTabId
          ? newTabs[Math.max(0, state.tabs.findIndex(t => t.id === id) - 1)].id
          : state.activeTabId;
        return { tabs: newTabs, activeTabId: newActiveTabId };
      }),

      switchTab: (id) => set({ activeTabId: id }),

      renameTab: (id, name) => set((state) => ({
        tabs: state.tabs.map(t => t.id === id ? { ...t, name } : t),
      })),
    }),
    {
      name: 'workspace-storage',
      version: 2,
      migrate: (persistedState: any, version: number) => {
        if (version <= 1) {
          const oldPanes: Pane[] = (persistedState as any).panes || [];
          const seenIds = new Set<string>();
          const fixedPanes = oldPanes.map((pane: Pane) => {
            if (pane.type === 'terminal' && pane.data) {
              if (!pane.data.terminalId || seenIds.has(pane.data.terminalId)) {
                pane.data.terminalId = generateId();
              }
              seenIds.add(pane.data.terminalId);
            }
            if (!pane.id || seenIds.has(pane.id)) pane.id = generateId();
            seenIds.add(pane.id);
            return pane;
          });
          const defaultTabId = generateId();
          return {
            ...persistedState,
            tabs: [{
              id: defaultTabId,
              name: 'Workspace 1',
              color: TAB_COLORS[0],
              panes: fixedPanes,
            }],
            activeTabId: defaultTabId,
          };
        }
        return persistedState;
      },
      partialize: (state) => ({
        tabs: state.tabs,
        activeTabId: state.activeTabId,
        sidebarOpen: state.sidebarOpen,
        workspaceDir: state.workspaceDir,
        theme: state.theme,
        savedLayouts: state.savedLayouts,
      }),
    }
  )
);
