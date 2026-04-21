import {
  TerminalSquare,
  ListTodo,
  Activity,
  Files,
  Bot,
  Settings,
  ChevronRight,
  Network,
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspace';
import { FileTree } from './FileTree';
import { AgentsTab } from './AgentsTab';
import { SettingsTab } from './SettingsTab';

type SidebarTab = 'files' | 'tasks' | 'swarm' | 'agents' | 'nodetree' | 'settings';

const TABS: { id: SidebarTab; icon: React.ReactNode; label: string }[] = [
  { id: 'files',   icon: <Files size={18} />,         label: 'Explorer'  },
  { id: 'tasks',   icon: <ListTodo size={18} />,       label: 'Tasks'     },
  { id: 'swarm',   icon: <Activity size={18} />,       label: 'MCP'       },
  { id: 'agents',  icon: <Bot size={18} />,            label: 'Agents'    },
  { id: 'nodetree', icon: <Network size={18} />,       label: 'Node Tree' },
];

function TasksTab() {
  const addPane = useWorkspaceStore(s => s.addPane);
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2 px-4">
      <ListTodo size={28} className="text-text-muted opacity-40" />
      <p className="text-xs text-text-muted">Open the Task Board pane for full kanban view.</p>
      <button 
        onClick={() => addPane('taskboard', 'Tasks')}
        className="mt-2 px-3 py-1 bg-accent-primary text-accent-text text-[10px] font-bold rounded hover:bg-accent-primary/80 transition-colors"
      >
        Open Task Board
      </button>
    </div>
  );
}

function SwarmTab() {
  const addPane = useWorkspaceStore(s => s.addPane);
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2 px-4">
      <Activity size={28} className="text-text-muted opacity-40" />
      <p className="text-xs text-text-muted">MCP server is active. View real-time agent coordination.</p>
      <button 
        onClick={() => addPane('activityfeed', 'Swarm')}
        className="mt-2 px-3 py-1 bg-accent-primary text-accent-text text-[10px] font-bold rounded hover:bg-accent-primary/80 transition-colors"
      >
        Open Activity Feed
      </button>
    </div>
  );
}

function NodeTreeTab() {
  return (
    <div className="flex flex-col items-center justify-center h-full text-center gap-2 px-4">
      <Network size={28} className="text-text-muted opacity-40" />
      <p className="text-[11px] text-text-muted leading-relaxed">
        Designer mode is active. Build complex multi-agent workflows using the visual node graph.
      </p>
    </div>
  );
}

export function Sidebar() {
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen);
  const activeTab = useWorkspaceStore((s) => s.activeSidebarTab);
  const setActiveTab = useWorkspaceStore((s) => s.setActiveSidebarTab);

  if (!sidebarOpen) return null;

  return (
    <div className="flex shrink-0 h-full border-r border-border-panel">
      {/* Activity Bar */}
      <div className="w-12 flex flex-col items-center bg-bg-titlebar border-r border-border-panel py-2 gap-1">
        <div className="mb-3 flex items-center justify-center w-8 h-8">
          <TerminalSquare size={20} className="text-accent-primary" />
        </div>

        {TABS.map((tab) => (
          <button
            key={tab.id}
            onClick={() => setActiveTab(tab.id)}
            title={tab.label}
            className={`
              relative w-9 h-9 flex items-center justify-center rounded-lg transition-all
              ${activeTab === tab.id
                ? 'text-accent-primary bg-accent-primary/10'
                : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'}
            `}
          >
            {tab.icon}
            {activeTab === tab.id && (
              <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-primary rounded-r-full" />
            )}
          </button>
        ))}

        <div className="flex-1" />

        <button
          onClick={() => setActiveTab(activeTab === 'settings' ? 'files' : 'settings')}
          title="Settings"
          className={`relative w-9 h-9 flex items-center justify-center rounded-lg transition-all
            ${activeTab === 'settings'
              ? 'text-accent-primary bg-accent-primary/10'
              : 'text-text-muted hover:text-text-secondary hover:bg-bg-surface'}`}
        >
          <Settings size={18} />
          {activeTab === 'settings' && (
            <span className="absolute left-0 top-1/2 -translate-y-1/2 w-0.5 h-5 bg-accent-primary rounded-r-full" />
          )}
        </button>
      </div>

      {/* Panel Content */}
      <div className="w-52 flex flex-col bg-bg-panel overflow-hidden">
        {/* Panel Header */}
        <div className="flex items-center justify-between px-3 py-2 border-b border-border-panel shrink-0">
          <span className="text-xs font-semibold text-text-muted uppercase tracking-widest">
            {activeTab === 'settings' ? 'Settings' : TABS.find(t => t.id === activeTab)?.label}
          </span>
          <ChevronRight size={13} className="text-text-muted opacity-40" />
        </div>

        {/* Panel Body */}
        <div className="flex-1 overflow-hidden flex flex-col">
          {activeTab === 'files'    && <FileTree />}
          {activeTab === 'tasks'    && <TasksTab />}
          {activeTab === 'swarm'    && <SwarmTab />}
          {activeTab === 'agents'   && <AgentsTab />}
          {activeTab === 'nodetree' && <NodeTreeTab />}
          {activeTab === 'settings' && <SettingsTab />}
        </div>
      </div>
    </div>
  );
}
