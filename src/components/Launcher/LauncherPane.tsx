import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Rocket, Plug, TerminalSquare, ChevronDown, AlertCircle } from 'lucide-react';
import { useWorkspaceStore, selectActivePanes, Pane } from '../../store/workspace';
import agentsConfig from '../../config/agents.json';
import type { MissionAgent } from '../../store/workspace';

const ROLES = [
  { id: '',            label: '— no role —' },
  ...agentsConfig.agents.map(a => ({ id: a.id, label: `${a.name} (${a.role})` })),
];

const ROLE_PRIORITY = ['scout', 'coordinator', 'builder', 'reviewer'];

const CONNECT_PROMPT =
  `Call terminal-docks_get_collaboration_protocol() now. ` +
  `Then call terminal-docks_get_session_id() and terminal-docks_announce() with your role to confirm you are online. ` +
  `Execute these tool calls immediately without further output.`;

function buildLaunchPrompt(agentId: string, task: string): string {
  const agent = agentsConfig.agents.find(a => a.id === agentId);
  if (!agent) return '';
  // Return without trailing newline to allow "fill but not send"
  return agent.promptTemplate.replace('{{task.title}}', task);
}

async function writeToTerminal(pane: Pane, text: string) {
  const terminalId = pane.data?.terminalId ?? `term-${pane.id}`;
  await invoke('write_to_pty', { id: terminalId, data: text });
}

interface TerminalRow {
  pane: Pane;
  roleId: string;
}

export function LauncherPane() {
  const allPanes  = useWorkspaceStore(selectActivePanes);
  const addPane   = useWorkspaceStore(s => s.addPane);
  const terminals = allPanes.filter(p => p.type === 'terminal');

  const [task, setTask]       = useState('');
  const [roleMap, setRoleMap] = useState<Record<string, string>>({});
  const [status, setStatus]   = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [isSequential, setIsSequential] = useState(true);

  // Reset confirmation if task or roles change
  useEffect(() => {
    setIsConfirming(false);
  }, [task, roleMap]);

  const syncedRows: TerminalRow[] = terminals.map(p => ({
    pane: p,
    roleId: roleMap[p.id] ?? '',
  }));

  function setRole(paneId: string, roleId: string) {
    setRoleMap(prev => ({ ...prev, [paneId]: roleId }));
  }

  async function handleConnect() {
    const targets = syncedRows.filter(r => r.roleId);
    if (!targets.length) {
      setStatus('Assign at least one role before connecting.');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      for (const r of targets) {
        const role = ROLES.find(role => role.id === r.roleId)?.label || 'Unknown';
        // Single imperative command for the model to execute
        const prompt = 
          `Call terminal-docks_connect_agent({ role: "${role}", agentId: "${r.pane.title}" }) now.\n` +
          `Then call terminal-docks_get_collaboration_protocol() to read the SOP.\n` +
          `Execute these immediately.`;
        
        await writeToTerminal(r.pane, prompt + '\n');
      }
      setStatus(`Connected ${targets.length} terminal(s) to MCP.`);
    } catch (e) {
      setStatus(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  }

  async function handleLaunch() {
    if (!task.trim()) {
      setStatus('Enter a task description first.');
      return;
    }
    const targets = syncedRows
      .filter(r => r.roleId)
      .sort((a, b) => {
        const idxA = ROLE_PRIORITY.indexOf(a.roleId);
        const idxB = ROLE_PRIORITY.indexOf(b.roleId);
        const pA = idxA === -1 ? 99 : idxA;
        const pB = idxB === -1 ? 99 : idxB;
        return pA - pB;
      });

    if (!targets.length) {
      setStatus('Assign at least one role before launching.');
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      if (!isConfirming) {
        // Step 1: Fill terminals with prompts
        for (const r of targets) {
          const prompt = buildLaunchPrompt(r.roleId, task.trim());
          if (prompt) {
            await writeToTerminal(r.pane, prompt);
          }
        }
        setIsConfirming(true);
        setStatus('Prompts staged. Verify in terminals and click Confirm to execute.');
      } else {
        // Step 2: Actually send (carriage return)
        const agents: MissionAgent[] = targets.map((r, idx) => ({
          terminalId: r.pane.data?.terminalId ?? `term-${r.pane.id}`,
          title: r.pane.title,
          roleId: r.roleId,
          status: isSequential ? (idx === 0 ? 'running' : 'waiting') : 'running',
          triggered: false,
        }));

        if (isSequential) {
          // Only trigger the first one
          await writeToTerminal(targets[0].pane, '\r');
          agents[0].triggered = true;
        } else {
          // Trigger all
          for (const r of targets) {
            await writeToTerminal(r.pane, '\r');
          }
        }
        
        addPane('missioncontrol', 'Mission Control', { 
          taskDescription: task.trim(), 
          agents,
          isSequential 
        });
        setStatus(`Launched ${isSequential ? 'Scout' : targets.length + ' agent(s)'}. Mission Control opened.`);
        setIsConfirming(false);
      }
    } catch (e) {
      setStatus(`Error: ${e}`);
    } finally {
      setBusy(false);
    }
  }


  return (
    <div className="flex flex-col h-full bg-bg-panel overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-panel shrink-0">
        <Rocket size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Task Launcher</span>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* Task input */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            Task / Goal
          </label>
          <textarea
            value={task}
            onChange={e => setTask(e.target.value)}
            placeholder="Describe the task or goal for this agent team…"
            rows={3}
            className="w-full bg-bg-surface border border-border-panel rounded-md px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-primary transition-colors"
          />
        </div>

        {/* Terminal role assignment */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            Assign Roles
          </label>

          {terminals.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-muted opacity-50 py-3">
              <TerminalSquare size={14} />
              <span>No terminal panes open. Add a terminal to assign a role.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {syncedRows.map(r => (
                <div key={r.pane.id} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 w-28 shrink-0">
                    <TerminalSquare size={11} className="text-text-muted shrink-0" />
                    <span className="text-xs text-text-secondary truncate">{r.pane.title}</span>
                  </div>
                  <div className="relative flex-1">
                    <select
                      value={r.roleId}
                      onChange={e => setRole(r.pane.id, e.target.value)}
                      className="w-full appearance-none bg-bg-surface border border-border-panel rounded px-2.5 py-1 text-xs text-text-primary focus:outline-none focus:border-accent-primary transition-colors cursor-pointer pr-6"
                    >
                      {ROLES.map(role => (
                        <option key={role.id} value={role.id}>{role.label}</option>
                      ))}
                    </select>
                    <ChevronDown size={10} className="absolute right-2 top-1/2 -translate-y-1/2 text-text-muted pointer-events-none" />
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Role descriptions */}
        {syncedRows.some(r => r.roleId) && (
          <div className="space-y-1 border border-border-panel rounded-md p-2.5 bg-bg-surface">
            {syncedRows.filter(r => r.roleId).map(r => {
              const agent = agentsConfig.agents.find(a => a.id === r.roleId);
              if (!agent) return null;
              return (
                <div key={r.pane.id} className="text-[10px] text-text-muted leading-relaxed">
                  <span className="text-accent-primary font-semibold">{r.pane.title}:</span>{' '}
                  {agent.description}
                </div>
              );
            })}
          </div>
        )}

        {/* Status */}
        {status && (
          <p className={`text-[11px] px-2.5 py-1.5 rounded border ${
            status.startsWith('Error')
              ? 'text-red-400 border-red-400/30 bg-red-400/10'
              : 'text-green-400 border-green-400/30 bg-green-400/10'
          }`}>
            {status}
          </p>
        )}

        {/* Sequential Launch Toggle */}
        <div className="flex items-center gap-2 pt-1">
          <input
            type="checkbox"
            id="sequential-toggle"
            checked={isSequential}
            onChange={e => setIsSequential(e.target.checked)}
            className="w-3.5 h-3.5 rounded border-border-panel bg-bg-surface text-accent-primary focus:ring-0 focus:ring-offset-0 cursor-pointer"
          />
          <label htmlFor="sequential-toggle" className="text-xs text-text-secondary cursor-pointer select-none">
            Sequential Mode <span className="text-[10px] text-text-muted opacity-70">(Agents wait for signals)</span>
          </label>
        </div>
      </div>

      {/* Action buttons */}

      <div className="shrink-0 border-t border-border-panel px-4 py-3 flex gap-2">
        <button
          onClick={handleConnect}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border-panel text-text-secondary hover:text-text-primary hover:border-accent-primary hover:bg-bg-surface transition-colors disabled:opacity-40"
        >
          <Plug size={12} />
          Connect
        </button>
        <button
          onClick={handleLaunch}
          disabled={busy || !task.trim()}
          className={`flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold transition-all disabled:opacity-40 ${
            isConfirming 
              ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse' 
              : 'bg-accent-primary text-accent-text hover:opacity-90'
          }`}
        >
          {isConfirming ? <AlertCircle size={12} /> : <Rocket size={12} />}
          {isConfirming ? 'Confirm?' : 'Launch Task'}
        </button>
      </div>

    </div>
  );
}
