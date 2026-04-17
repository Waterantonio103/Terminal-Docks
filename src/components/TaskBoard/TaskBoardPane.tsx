import { useState, useEffect } from "react";
import { invoke } from "@tauri-apps/api/core";
import { Plus, Trash2, Play } from "lucide-react";
import { useWorkspaceStore } from "../../store/workspace";
import agentConfig from "../../config/agents.json";

interface Task {
  id: number;
  title: string;
  description: string | null;
  status: string;
  created_at: string;
}

const COLUMNS = [
  { id: "todo", title: "To Do" },
  { id: "in_progress", title: "In Progress" },
  { id: "done", title: "Done" },
];

export function TaskBoardPane() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [newTaskTitle, setNewTaskTitle] = useState("");
  const [isAdding, setIsAdding] = useState(false);

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
  }, []);

  const handleAddTask = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newTaskTitle.trim()) return;

    try {
      await invoke("add_task", {
        title: newTaskTitle.trim(),
        description: null,
      });
      setNewTaskTitle("");
      setIsAdding(false);
      fetchTasks();
    } catch (err) {
      console.error("Failed to add task", err);
    }
  };

  const handleStatusChange = async (taskId: number, newStatus: string) => {
    try {
      await invoke("update_task_status", { id: taskId, status: newStatus });
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
    const agent = agentConfig.agents[0];
    const prompt = agent.promptTemplate.replace('{{task.title}}', task.title);
    useWorkspaceStore.getState().addPane('terminal', `Agent: ${task.title}`, {
      initialCommand: prompt
    });
  };

  return (
    <div className="flex flex-col h-full bg-bg-panel text-text-secondary p-4">
      <div className="flex items-center justify-between mb-4 border-b border-border-divider pb-2">
        <h2 className="text-text-primary font-bold text-lg">Task Board</h2>
        {!isAdding && (
          <button
            onClick={() => setIsAdding(true)}
            className="flex items-center gap-1 text-sm bg-accent-primary hover:bg-accent-hover text-accent-text px-2 py-1 rounded transition-colors"
          >
            <Plus size={16} /> Add Task
          </button>
        )}
      </div>

      {isAdding && (
        <form onSubmit={handleAddTask} className="mb-4 flex gap-2">
          <input
            type="text"
            autoFocus
            placeholder="What needs to be done?"
            value={newTaskTitle}
            onChange={(e) => setNewTaskTitle(e.target.value)}
            className="flex-1 bg-bg-surface border border-gray-600 rounded px-3 py-1.5 text-sm focus:outline-none focus:border-blue-500"
          />
          <button
            type="submit"
            className="bg-accent-primary hover:bg-accent-hover text-accent-text px-3 py-1.5 rounded text-sm transition-colors"
          >
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setIsAdding(false);
              setNewTaskTitle("");
            }}
            className="bg-bg-surface-hover hover:bg-bg-surface-hover text-text-primary px-3 py-1.5 rounded text-sm transition-colors"
          >
            Cancel
          </button>
        </form>
      )}

      <div className="flex flex-1 gap-4 overflow-x-auto pb-2">
        {COLUMNS.map((column) => (
          <div
            key={column.id}
            className="flex flex-col bg-bg-surface rounded-lg min-w-[280px] max-w-[320px] flex-1"
            onDragOver={onDragOver}
            onDrop={(e) => onDrop(e, column.id)}
          >
            <div className="p-3 border-b border-border-divider font-medium text-text-muted">
              {column.title}
              <span className="ml-2 text-xs bg-bg-surface-hover px-2 py-0.5 rounded-full">
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
                    className="bg-bg-surface-hover p-3 rounded shadow cursor-grab active:cursor-grabbing hover:ring-1 hover:ring-gray-500 group relative"
                  >
                    <div className="pr-6 font-medium text-sm text-text-primary break-words">
                      {task.title}
                    </div>
                    {task.description && (
                      <div className="text-xs text-text-muted mt-1 line-clamp-2">
                        {task.description}
                      </div>
                    )}
                    <div className="absolute top-2 right-2 flex space-x-1 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        onClick={() => handleRunTask(task)}
                        className="text-text-muted hover:text-accent-primary"
                        title="Run Task"
                      >
                        <Play size={14} />
                      </button>
                      <button
                        onClick={() => handleDeleteTask(task.id)}
                        className="text-text-muted hover:text-red-400"
                        title="Delete Task"
                      >
                        <Trash2 size={14} />
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
