import { useState } from 'react';
import { 
  TerminalSquare, 
  ListTodo, 
  Activity, 
  Files, 
  Bot, 
  Settings 
} from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspace';
import { FileTree } from './FileTree';

type SidebarTab = 'tasks' | 'swarm' | 'files' | 'agents';

export function Sidebar() {
  const sidebarOpen = useWorkspaceStore((s) => s.sidebarOpen);
  const [activeTab, setActiveTab] = useState<SidebarTab>('files');

  if (!sidebarOpen) return null;

  return (
    <div className="w-64 bg-bg-panel border-r border-border-panel flex flex-col h-full text-text-muted">
      <div className="p-4 flex items-center space-x-2 font-bold text-text-primary shrink-0">
        <TerminalSquare size={24} className="text-accent-primary" />
        <span>Terminal Docks</span>
      </div>
      
      {/* Sidebar Tabs */}
      <div className="flex border-b border-border-panel shrink-0">
         <button 
           className={`flex-1 py-2 flex justify-center hover:bg-bg-surface ${activeTab === 'files' ? 'text-accent-primary border-b-2 border-accent-primary' : ''}`}
           onClick={() => setActiveTab('files')} title="Files"
         ><Files size={18} /></button>
         <button 
           className={`flex-1 py-2 flex justify-center hover:bg-bg-surface ${activeTab === 'tasks' ? 'text-accent-primary border-b-2 border-accent-primary' : ''}`}
           onClick={() => setActiveTab('tasks')} title="Tasks"
         ><ListTodo size={18} /></button>
         <button 
           className={`flex-1 py-2 flex justify-center hover:bg-bg-surface ${activeTab === 'swarm' ? 'text-accent-primary border-b-2 border-accent-primary' : ''}`}
           onClick={() => setActiveTab('swarm')} title="Swarm"
         ><Activity size={18} /></button>
         <button 
           className={`flex-1 py-2 flex justify-center hover:bg-bg-surface ${activeTab === 'agents' ? 'text-accent-primary border-b-2 border-accent-primary' : ''}`}
           onClick={() => setActiveTab('agents')} title="Agents"
         ><Bot size={18} /></button>
      </div>

      <div className="flex-1 overflow-hidden flex flex-col">
        {activeTab === 'files' && <FileTree />}
        {activeTab !== 'files' && (
          <div className="p-4 text-center text-sm text-text-muted">
            {activeTab} coming soon...
          </div>
        )}
      </div>

      <div className="p-4 border-t border-border-panel hover:bg-bg-surface cursor-pointer flex items-center space-x-3 shrink-0">
        <Settings size={18} />
        <span>Settings</span>
      </div>
    </div>
  );
}
