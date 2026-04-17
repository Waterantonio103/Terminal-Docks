import { Sidebar } from './components/Sidebar/Sidebar';
import { WorkspaceGrid } from './components/Layout/WorkspaceGrid';
import { useWorkspaceStore } from './store/workspace';
import { PanelLeft, Palette } from 'lucide-react';
import './App.css';

function App() {
  const toggleSidebar = useWorkspaceStore((s) => s.toggleSidebar);
  const addPane = useWorkspaceStore((s) => s.addPane);
  const theme = useWorkspaceStore((s) => s.theme);
  const setTheme = useWorkspaceStore((s) => s.setTheme);

  return (
    <div className={`flex flex-col h-screen w-screen bg-bg-app text-text-primary overflow-hidden ${theme !== 'dark' ? 'theme-' + theme : ''}`}>
      {/* App Chrome */}
      <header className="h-10 border-b border-border-panel flex items-center px-4 bg-bg-app shrink-0 select-none">
        <button
          onClick={toggleSidebar}
          className="text-text-muted hover:text-accent-text mr-4 transition-colors"
        >
          <PanelLeft size={20} />
        </button>
        <div className="flex-1 flex justify-center space-x-2">
          {/* Layout Picker Placeholder */}
          <button onClick={() => addPane('terminal', 'New Terminal')} className="text-xs bg-bg-surface hover:bg-bg-surface-hover px-3 py-1 rounded-md">
            + Terminal
          </button>
          <button onClick={() => addPane('editor', 'New Editor')} className="text-xs bg-bg-surface hover:bg-bg-surface-hover px-3 py-1 rounded-md">
            + Editor
          </button>
          <button onClick={() => addPane('taskboard', 'Tasks')} className="text-xs bg-bg-surface hover:bg-bg-surface-hover px-3 py-1 rounded-md">
            + Tasks
          </button>
          <button onClick={() => addPane('activityfeed', 'Swarm')} className="text-xs bg-bg-surface hover:bg-bg-surface-hover px-3 py-1 rounded-md">
            + Swarm
          </button>
        </div>
        <div className="flex items-center space-x-4">
          <div className="flex items-center space-x-2 text-xs text-text-muted">
            <Palette size={14} />
            <select
              value={theme}
              onChange={(e) => setTheme(e.target.value as any)}
              className="bg-bg-surface border border-border-divider text-text-primary rounded px-2 py-0.5 outline-none focus:border-accent-primary"
            >
              <option value="dark">Dark</option>
              <option value="light">Light</option>
              <option value="dracula">Dracula</option>
              <option value="solarized">Solarized</option>
            </select>
          </div>
          <div className="text-xs text-text-muted font-mono">
            v0.1.0
          </div>
        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 flex overflow-hidden">
        <Sidebar />
        <WorkspaceGrid />
      </main>
    </div>
  );
}

export default App;
