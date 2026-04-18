import { useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Rocket, Plug, TerminalSquare, ChevronDown } from 'lucide-react';
import { useWorkspaceStore, selectActivePanes, Pane } from '../../store/workspace';
import agentsConfig from '../../config/agents.json';
import type { MissionAgent } from '../../store/workspace';

const ROLES = [
  { id: '',            label: '— no role —' },
  ...agentsConfig.agents.map(a => ({ id: a.id, label: `${a.name} (${a.role})` })),
];

const CONNECT_PROMPT =
  `Read the collaboration_protocol prompt from the terminal-docks MCP server. ` +
  `Then call get_session_id and announce you are online with your role. Do this now.`;

function buildLaunchPrompt(agentId: string, task: string): string {
  const agent = agentsConfig.agents.find(a => a.id === agentId);
  if (!agent) return '';
  return agent.promptTemplate.replace('{{task.title}}', task) + '\n';
}

async function writeToTerminal(pane: Pane, text: string) {
  const terminalId = pane.data?.terminalId ?? `term-${pane.id}`;
  await invoke('write_to_pty', { id: terminalId, data: text + '\n' });
}

interface TerminalRow {
  pane: Pane;
  roleId: string;
}

export function LauncherPane() {
  const allPanes  = useWorkspaceStore(selectActivePanes);
  const addPane   = useWorkspaceStore(s => s.addPane);
  const terminals = allPanes.filter(p => p.type === 'terminal');

  const [task, setTask]     = useState('');
  const [rows, setRows]     = useState<TerminalRow[]>(() =>
    terminals.map(p => ({ pane: p, roleId: '' }))
  );
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy]     = useState(false);

  // Keep rows in sync when terminals change (new pane added etc.)
  const syncedRows: TerminalRow[] = terminals.map(p => {
    const existing = rows.find(r => r.pane.id === p.id);
    return existing ? { ...existing, pane: p } : { pane: p, roleId: '' };
  });

  function setRole(paneId: string, roleId: string) {
    setRows(prev => prev.map(r => r.pane.id === paneId ? { ...r, roleId } : r));
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
        await writeToTerminal(r.pane, CONNECT_PROMPT);
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
    const targets = syncedRows.filter(r => r.roleId);
    if (!targets.length) {
      setStatus('Assign at least one role before launching.');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      for (const r of targets) {
        const prompt = buildLaunchPrompt(r.roleId, task.trim());
        if (prompt) await writeToTerminal(r.pane, prompt);
      }
      const agents: MissionAgent[] = targets.map(r => ({
        terminalId: r.pane.data?.terminalId ?? `term-${r.pane.id}`,
        title: r.pane.title,
        roleId: r.roleId,
      }));
      addPane('missioncontrol', 'Mission Control', { taskDescription: task.trim(), agents });
      setStatus(`Launched ${targets.length} agent(s). Mission Control opened.`);
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
      </div>

      {/* Action buttons */}
      <div className="shrink-0 border-t border-border-panel px-4 py-3 flex gap-2">
        <button
          onClick={handleConnect}
          disabled={busy}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded text-xs font-medium border border-border-panel text-text-secondary hover:text-text-primary hover:border-accent-primary hover:bg-bg-surface transition-colors disabled:opacity-40"
        >
          <Plug size={12} />
          Connect to MCP
        </button>
        <button
          onClick={handleLaunch}
          disabled={busy || !task.trim()}
          className="flex-1 flex items-center justify-center gap-1.5 px-3 py-1.5 rounded text-xs font-semibold bg-accent-primary text-accent-text hover:opacity-90 transition-opacity disabled:opacity-40"
        >
          <Rocket size={12} />
          Launch Task
        </button>
      </div>

    </div>
  );
}
