import { create } from 'zustand';
import { persist } from 'zustand/middleware';

export type PaneType = 'terminal' | 'editor' | 'taskboard' | 'activityfeed';
export type ThemeType = 'dark' | 'light' | 'dracula' | 'solarized';

export interface Pane {
  id: string;
  type: PaneType;
  title: string;
  data?: any;
}

interface WorkspaceState {
  panes: Pane[];
  sidebarOpen: boolean;
  workspaceDir: string | null;
  theme: ThemeType;
  toggleSidebar: () => void;
  addPane: (type: PaneType, title: string, data?: any) => void;
  removePane: (id: string) => void;
  setWorkspaceDir: (dir: string | null) => void;
  setTheme: (theme: ThemeType) => void;
}

export const useWorkspaceStore = create<WorkspaceState>()(
  persist(
    (set) => ({
      panes: [
        { id: '1', type: 'terminal', title: 'Terminal 1' },
        { id: '2', type: 'editor', title: 'Welcome' },
      ],
      sidebarOpen: true,
      workspaceDir: null,
      theme: 'dark',
      toggleSidebar: () => set((state) => ({ sidebarOpen: !state.sidebarOpen })),
      addPane: (type, title, data) =>
        set((state) => {
          // Don't add if already exists (e.g. file already open)
          if (data?.filePath) {
            const existing = state.panes.find((p) => p.data?.filePath === data.filePath);
            if (existing) return state; // Already open, just don't add
          }
          return {
            panes: [...state.panes, { id: Date.now().toString(), type, title, data }],
          };
        }),
      removePane: (id) =>
        set((state) => ({ panes: state.panes.filter((p) => p.id !== id) })),
      setWorkspaceDir: (dir) => set({ workspaceDir: dir }),
      setTheme: (theme) => set({ theme }),
    }),
    {
      name: 'workspace-storage',
      partialize: (state) => ({
        panes: state.panes,
        sidebarOpen: state.sidebarOpen,
        workspaceDir: state.workspaceDir,
        theme: state.theme,
      }),
    }
  )
);
