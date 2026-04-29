import { useState, useEffect } from "react";
import {  invoke  } from '../../lib/desktopApi';
import { Plus, Trash2, Play } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspace";
import agentConfig from "../../config/agents";

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
  parent_id: number | null;
  agent_id: string | null;
}

const COLUMNS = [
  { id: "todo", title: "To Do" },
  { id: "in_progress", title: "In Progress" },
  { id: "review", title: "Review" },
  { id: "done", title: "Done" },
];

export function TaskBoardPane() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<string | null>(null);

  const fetchTasks = async () => {
    try {
      const fetchedTasks = await invoke<Task[]>("get_tasks");
      setTasks(fetchedTasks);
    } catch (err) {
      console.error("Failed to fetch tasks", err);
    }
  };

  useEffect(() => {
    fetchTasks();

    let unlisten: (() => void) | undefined;
    import('../../lib/desktopApi').then(({ listen }) => {
      listen('mcp-message', (event: any) => {
        if (event.payload?.type === 'task_update') {
          fetchTasks();
        }
      }).then(fn => { unlisten = fn; });
    });

    return () => {
      if (unlisten) unlisten();
    };
  }, []);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      await invoke("add_task", {
        title: newTaskTitle.trim(),
        description: null,
        parentId: null,
        agentId: selectedAgent,
      });
      setNewTaskTitle("");
      setIsAdding(false);
      setSelectedAgent(null);
      fetchTasks();
    } catch (err) {
      console.error("Failed to add task", err);
    }
  };

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    try {
      await invoke("update_task_status", { id: taskId, status: newStatus, agentId: null });
      fetchTasks();
    } catch (err) {
      console.error("Failed to update task status", err);
    }
  };

  const handleDeleteTask = async (taskId: number) => {
    try {
      await invoke("delete_task", { id: taskId });
      fetchTasks();
    } catch (err) {
      console.error("Failed to delete task", err);
    }
  };

  const onDragStart = (e: React.DragEvent, taskId: number) => {
    e.dataTransfer.setData("taskId", taskId.toString());
  };

  const onDragOver = (e: React.DragEvent) => {
    e.preventDefault();
  };

  const onDrop = (e: React.DragEvent, status: string) => {
    e.preventDefault();
    const taskId = parseInt(e.dataTransfer.getData("taskId"), 10);
    if (!isNaN(taskId)) {
      handleStatusChange(taskId, status);
    }
  };

  const handleRunTask = (task: Task) => {
    const agentId = task.agent_id || 'coordinator';
    const agent = agentConfig.agents.find(a => a.id === agentId) || agentConfig.agents[0];
    const workspaceDir = useWorkspaceStore.getState().workspaceDir;
    const wdLine = workspaceDir ? `Working directory: ${workspaceDir}\nWrite ALL output files here using your native file tools.\n\n` : '';
    
    // Map agent to CLI binary
    let cli = 'claude';
    if (agent.id === 'builder') cli = 'opencode';
    else if (agent.id === 'scout') cli = 'gemini';

    const prompt = `${cli}\nYou are the ${agent.name} (${agent.role}), working solo.\n\n${wdLine}Objective: ${task.title}\n\n${agent.coreInstructions}`;
    
    useWorkspaceStore.getState().addPane('terminal', `[${agent.name}] ${task.title}`, {
      initialCommand: prompt,
      cli,
      roleId: agent.id,
    });
  };

  const getAgentBadge = (agentId: string | null) => {
    if (!agentId) return null;
    const agent = agentConfig.agents.find(a => a.id === agentId);
    if (!agent) return null;
    
    const colors: Record<string, string> = {
      coordinator: 'bg-blue-500/10 text-blue-400 border-blue-500/20',
      scout: 'bg-purple-500/10 text-purple-400 border-purple-500/20',
      builder: 'bg-green-500/10 text-green-400 border-green-500/20',
      reviewer: 'bg-orange-500/10 text-orange-400 border-orange-500/20',
    };

    return (
      <span className={`text-[10px] px-1.5 py-0.5 rounded-md border font-medium ${colors[agentId] || 'background-bg-surface-hover text-text-muted border-border-panel'}`}>
        {agent.name}
      </span>
    );
  };

  return (
    <div className="flex flex-col h-full background-bg-panel text-text-secondary overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-border-panel shrink-0">
        <div className="flex items-center gap-2">
          <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">CometAI Board</span>
          <span className="text-xs background-bg-surface text-text-muted px-1.5 py-0.5 rounded-full">
            {tasks.length}
          </span>
        </div>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 text-xs bg-accent-primary hover:bg-accent-hover text-accent-text px-2.5 py-1 rounded-md transition-colors font-medium"
          >
            <Plus size={13} /> Add Task
          </button>
        )}
      </div>

      {isAdding && (
        <form onSubmit={handleAddTask} className="flex flex-col gap-2 px-4 py-3 border-b border-border-panel shrink-0 bg-bg-surface/30">
          <input
            type="text"
            autoFocus
            placeholder="High-level goal or specific task..."
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            className="w-full background-bg-surface border border-border-divider text-text-primary rounded-md px-3 py-1.5 text-xs focus:outline-none focus:border-accent-primary transition-colors"
          />
          <div className="flex items-center justify-between">
            <div className="flex gap-2">
              {agentConfig.agents.map(agent => (
                <button
                  key={agent.id}
                  type="button"
                  onClick={() => setSelectedAgent(agent.id)}
                  className={`text-[10px] px-2 py-1 rounded transition-colors border ${
                    selectedAgent === agent.id 
                      ? 'bg-accent-primary/20 border-accent-primary text-accent-primary' 
                      : 'background-bg-panel border-border-panel text-text-muted hover:border-border-divider'
                  }`}
                >
                  {agent.name}
                </button>
              ))}
            </div>
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => { setIsAdding(false); setNewTaskTitle(''); setSelectedAgent(null); }}
                className="text-text-muted hover:text-text-primary px-3 py-1.5 text-xs transition-colors"
              >
                Cancel
              </button>
              <button type="submit" className="bg-accent-primary hover:bg-accent-hover text-accent-text px-4 py-1.5 rounded-md text-xs font-medium transition-colors">
                Create
              </button>
            </div>
          </div>
        </form>
      )}

      <div className="flex flex-1 gap-3 overflow-x-auto p-4 pb-3">
        {COLUMNS.map((column) => (
          <div
            key={column.id}
            className="flex flex-col background-bg-surface rounded-lg min-w-[280px] max-w-[320px] flex-1 border border-border-panel"
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, column.id)}
          >
            <div className="flex items-center justify-between px-3 py-2.5 border-b border-border-divider">
              <span className="text-xs font-semibold text-text-secondary">{column.title}</span>
              <span className="text-xs background-bg-surface-hover text-text-muted px-1.5 py-0.5 rounded-full">
                {tasks.filter((t) => t.status === column.id).length}
              </span>
            </div>

            <div className="flex-1 overflow-y-auto p-2 space-y-2">
              {tasks
                .filter((t) => t.status === column.id)
                .map((task) => (
                  <div
                    key={task.id}
                    draggable
                    onDragStart={(e) => onDragStart(e, task.id)}
                    className="background-bg-panel border border-border-panel p-3 rounded-md cursor-grab active:cursor-grabbing hover:border-border-divider group relative transition-all shadow-sm"
                  >
                    <div className="flex flex-col gap-2">
                      <div className="pr-10 text-xs font-medium text-text-primary break-words leading-relaxed">
                        {task.title}
                      </div>
                      
                      <div className="flex items-center justify-between">
                        {getAgentBadge(task.agent_id)}
                        <span className="text-[10px] text-text-muted">#{task.id}</span>
                      </div>
                    </div>

                    <div className="absolute top-2 right-2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRunTask(task)}
                        className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-accent-primary background-bg-surface rounded-md border border-border-panel transition-colors"
                        title="Run Task"
                      >
                        <Play size={12} />
                      </button>
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="w-6 h-6 flex items-center justify-center text-text-muted hover:text-red-400 background-bg-surface rounded-md border border-border-panel transition-colors"
                        title="Delete"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
