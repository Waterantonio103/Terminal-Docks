import { useState, useEffect } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Rocket, Plug, TerminalSquare, AlertCircle, Hammer, Wrench, Cpu } from 'lucide-react';
import { useWorkspaceStore, selectActivePanes, Pane } from '../../store/workspace';
import agentsConfig from '../../config/agents';
import type { CompiledMission, MissionAgent } from '../../store/workspace';
import { buildLaunchPrompt, STAGES, type LaunchContext, type LaunchMode, type LaunchOutgoingTarget } from '../../lib/buildPrompt';
import { generateId } from '../../lib/graphUtils';
import { detectCliForPane, detectRoleForPane, type AgentCli } from '../../lib/cliDetection';

const ROLES = [
  { id: '',            label: '— no role —' },
  ...agentsConfig.agents.map(a => ({ id: a.id, label: `${a.name} (${a.role})` })),
];

const ROLE_PRIORITY = STAGES.flat();

async function writeToTerminal(pane: Pane, text: string) {
  const terminalId = pane.data?.terminalId ?? `term-${pane.id}`;
  await invoke('write_to_pty', { id: terminalId, data: text });
}


interface TerminalRow {
  pane: Pane;
  roleId: string;
  cli: AgentCli | null;
}

interface PendingLaunchState {
  missionId: string;
  mission: CompiledMission;
  agents: MissionAgent[];
  firstGroupTerminalIds: string[];
}

function getAllowedOutgoingTargets(mission: CompiledMission, nodeId: string): LaunchOutgoingTarget[] {
  const nodeById = new Map(mission.nodes.map(node => [node.id, node]));

  return mission.edges
    .filter(edge => edge.fromNodeId === nodeId)
    .map(edge => {
      const targetNode = nodeById.get(edge.toNodeId);
      const targetRoleId = targetNode?.roleId ?? 'unknown';
      const targetRoleName = agentsConfig.agents.find(agent => agent.id === targetRoleId)?.name ?? targetRoleId;
      return {
        targetNodeId: edge.toNodeId,
        targetRoleId,
        targetRoleName,
        condition: edge.condition,
      } satisfies LaunchOutgoingTarget;
    });
}

export function LauncherPane() {
  const allPanes          = useWorkspaceStore(selectActivePanes);
  const addPane           = useWorkspaceStore(s => s.addPane);
  const agentInstructions = useWorkspaceStore(s => s.agentInstructions);
  const terminals = allPanes.filter(p => p.type === 'terminal');

  const [mode, setMode]       = useState<LaunchMode>('build');
  const [task, setTask]       = useState('');
  const [status, setStatus]   = useState<string | null>(null);
  const [busy, setBusy]       = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [mcpUrl, setMcpUrl]   = useState('http://localhost:3741/mcp');
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunchState | null>(null);

  useEffect(() => {
    invoke<string>('get_mcp_url').then(url => setMcpUrl(url)).catch(() => {});
  }, []);

  useEffect(() => {
    setIsConfirming(false);
    setPendingLaunch(null);
  }, [task, mode, allPanes]);

  const syncedRows: TerminalRow[] = terminals.map(p => ({
    pane: p,
    roleId: detectRoleForPane(p as any) ?? '',
    cli: detectCliForPane(p as any),
  }));

  async function handleConnect() {
    const targets = syncedRows.filter(r => r.roleId);
    if (!targets.length) {
      setStatus('No detectable role found. Name a terminal with a role keyword (scout/coordinator/builder/tester/security/reviewer).');
      return;
    }
    setBusy(true);
    setStatus(null);
    try {
      await Promise.all(targets.map(async r => {
        const cli = r.cli ?? 'claude';
        const role = ROLES.find(role => role.id === r.roleId)?.label || 'Unknown';
        const terminalId = r.pane.data?.terminalId ?? `term-${r.pane.id}`;

        // Claude Code returns cleanly to its input prompt on Ctrl+C, so we can
        // interrupt whatever it is doing and immediately send the new prompt.
        // Other CLIs (OpenCode, Gemini, …) may EXIT on Ctrl+C — for those we
        // do NOT interrupt; we just send the prompt and let the CLI handle it.
        if (cli === 'claude') {
          await invoke('write_to_pty', { id: terminalId, data: '\x03' });
          await new Promise(res => setTimeout(res, 200));
        }

        // CLI-specific hints. Claude Code can self-register via shell escape
        // (`!cmd`) if the MCP server was not loaded at session startup.
        const cliHint = cli === 'claude'
          ? `If the terminal-docks MCP tools are not yet available run this shell command first: !claude mcp add --transport http terminal-docks ${mcpUrl} --scope user `
          : cli === 'gemini'
          ? `The MCP server uses streamable-HTTP transport at ${mcpUrl}. `
          : '';

        const connectTool = cli === 'gemini' ? 'mcp_terminal-docks_connect_agent' : 'connect_agent';
        const protocolTool = cli === 'gemini' ? 'mcp_terminal-docks_get_collaboration_protocol' : 'get_collaboration_protocol';
        const roleParam = cli === 'gemini' ? r.roleId : role;

        const prompt =
          `The terminal-docks MCP server is at ${mcpUrl} (streamable-http). ` +
          cliHint +
          `CRITICAL: Execute the following sequentially, waiting for each to complete before starting the next. DO NOT call tools in parallel.\n` +
          `1. Call the ${connectTool} MCP tool with role="${roleParam}", agentId="${r.pane.title}", terminalId="${terminalId}", and cli="${cli}" to register.\n` +
          `2. Call the ${protocolTool} tool to load the team SOP.\n` +
          `Do this now without asking for confirmation.`;

        await writeToTerminal(r.pane, prompt + '\r');
      }));
      setStatus(`Connected ${targets.length} auto-detected terminal(s) to MCP.`);
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
        return (idxA === -1 ? 99 : idxA) - (idxB === -1 ? 99 : idxB);
      });

    if (!targets.length) {
      setStatus('No detectable role found. Name a terminal with a role keyword (scout/coordinator/builder/tester/security/reviewer).');
      return;
    }

    // Derive pipeline (flat, for display) and stageGroups (string[][], drives
    // orchestration) from the roles that are actually assigned. Each STAGES
    // entry becomes one group after filtering to assigned roles; empty groups
    // are dropped.
    const usedRoleIds = [...new Set(targets.map(r => r.roleId))];
    const stageGroups: string[][] = STAGES
      .map(group => group.filter(r => usedRoleIds.includes(r)))
      .filter(group => group.length > 0);
    const pipeline = stageGroups.flat();
    const firstGroup = stageGroups[0] ?? [];

    const workspaceDir = useWorkspaceStore.getState().workspaceDir;

    setBusy(true);
    setStatus(null);

    try {
      if (!isConfirming) {
        const missionId = generateId();
        const nodeRefs = targets.map((r, index) => ({
          id: `node-${missionId}-${index}`,
          roleId: r.roleId,
        }));

        const nodes = targets.map((r, index) => ({
          id: nodeRefs[index].id,
          roleId: r.roleId,
          instructionOverride: agentInstructions[r.roleId] ?? '',
          terminal: {
            terminalId: r.pane.data?.terminalId ?? `term-${r.pane.id}`,
            terminalTitle: r.pane.title,
            cli: r.cli ?? 'claude',
            paneId: r.pane.id,
            reusedExisting: true,
          },
        }));

        const agents: MissionAgent[] = targets.map((r, index) => ({
          terminalId: r.pane.data?.terminalId ?? `term-${r.pane.id}`,
          title: r.pane.title,
          roleId: r.roleId,
          paneId: r.pane.id,
          status: 'idle',
          attempt: 0,
          lastPayload: null,
          attemptHistory: [],
          nodeId: nodeRefs[index].id,
        }));

        const edges: Array<{ id: string; fromNodeId: string; toNodeId: string; condition: 'always' | 'on_failure' }> = [];
        for (let i = 0; i < stageGroups.length - 1; i++) {
          const currentGroupRoles = stageGroups[i];
          const nextGroupRoles = stageGroups[i + 1];

          const currentNodes = nodeRefs.filter(n => currentGroupRoles.includes(n.roleId));
          const nextNodes = nodeRefs.filter(n => nextGroupRoles.includes(n.roleId));

          for (const cNode of currentNodes) {
            for (const nNode of nextNodes) {
              edges.push({
                id: `edge:${cNode.id}:always:${nNode.id}`,
                fromNodeId: cNode.id,
                toNodeId: nNode.id,
                condition: 'always'
              });
            }
          }
        }

        const reviewerNode = nodeRefs.find(n => n.roleId === 'reviewer');
        if (reviewerNode) {
          const retryTargets = nodeRefs.filter(n => ['builder', 'tester', 'security'].includes(n.roleId));
          for (const target of retryTargets) {
            edges.push({
              id: `edge:${reviewerNode.id}:on_failure:${target.id}`,
              fromNodeId: reviewerNode.id,
              toNodeId: target.id,
              condition: 'on_failure'
            });
          }
        }

        const mission: CompiledMission = {
          missionId,
          graphId: missionId,
          task: {
            nodeId: `launcher-task-${missionId}`,
            prompt: task.trim(),
            mode,
            workspaceDir: workspaceDir ?? null,
          },
          metadata: {
            compiledAt: Date.now(),
            sourceGraphId: missionId,
            startNodeIds: nodes
              .map(node => ({ id: node.id }))
              .filter(node => !edges.some(edge => edge.toNodeId === node.id))
              .map(node => node.id),
            executionLayers: stageGroups.map(group =>
              nodeRefs.filter(node => group.includes(node.roleId)).map(node => node.id)
            ),
          },
          nodes,
          edges,
        };

        const firstGroupTerminalIds = targets
          .filter(r => firstGroup.includes(r.roleId))
          .map(r => r.pane.data?.terminalId ?? `term-${r.pane.id}`);

        // Stage 1: Fill terminals with context-aware prompts (no execution yet)
        for (let index = 0; index < targets.length; index += 1) {
          const r = targets[index];
          const sameRole = targets.filter(t => t.roleId === r.roleId);
          // Predecessor / successor are resolved against stageGroups so parallel
          // peers (builder, tester, security) see the Coordinator as predecessor
          // and Reviewer as successor, not each other.
          const groupIdx = stageGroups.findIndex(g => g.includes(r.roleId));
          const prevGroup = groupIdx > 0 ? stageGroups[groupIdx - 1] : null;
          const nextGroup = groupIdx >= 0 && groupIdx < stageGroups.length - 1 ? stageGroups[groupIdx + 1] : null;
          const predecessorRole = prevGroup
            ? agentsConfig.agents.find(a => a.id === prevGroup[prevGroup.length - 1]) ?? null
            : null;
          const successorRole = nextGroup
            ? agentsConfig.agents.find(a => a.id === nextGroup[0]) ?? null
            : null;

          const ctx: LaunchContext = {
            workspaceDir,
            pipeline,
            instanceNum: sameRole.indexOf(r) + 1,
            totalInstances: sameRole.length,
            predecessorRole,
            successorRole,
            missionId,
            nodeId: nodeRefs[index].id,
            attempt: 1,
            allowedOutgoingTargets: getAllowedOutgoingTargets(mission, nodeRefs[index].id),
            task: task.trim(),
            mode,
          };

          const prompt = buildLaunchPrompt(r.roleId, ctx, agentInstructions[r.roleId]);
          if (prompt) {
            // Write prompt text into the input buffer without submitting.
            // The CLI is already running (started via Connect). Stage 2 sends \r.
            await writeToTerminal(r.pane, prompt);
          }
        }
        setPendingLaunch({
          missionId,
          mission,
          agents,
          firstGroupTerminalIds,
        });
        setIsConfirming(true);
        setStatus('Prompts staged. Verify in terminals and click Confirm to execute.');
      } else {
        if (!pendingLaunch) {
          throw new Error('No staged mission found. Re-stage the prompts before confirming.');
        }
        // Stage 2: Execute — every agent in the first group fires immediately,
        // the rest wait. Parallel within a group, sequential between groups.
        // Notify Rust backend
        await invoke('start_mission_graph', { missionId: pendingLaunch.missionId, graph: pendingLaunch.mission });
        await Promise.all(
          pendingLaunch.firstGroupTerminalIds.map(terminalId =>
            invoke('write_to_pty', { id: terminalId, data: '\r' })
          )
        );

        // Update UI
        addPane('missioncontrol', 'Mission Control', {
          taskDescription: task.trim(),
          agents: pendingLaunch.agents,
          missionId: pendingLaunch.missionId,
          mission: pendingLaunch.mission,
        });

        const firstCount = targets.filter(r => firstGroup.includes(r.roleId)).length;
        const firstLabel = firstGroup.length === 1
          ? agentsConfig.agents.find(a => a.id === firstGroup[0])?.name ?? firstGroup[0]
          : firstGroup.map(id => agentsConfig.agents.find(a => a.id === id)?.name ?? id).join(' + ');
        setStatus(`Launched ${firstCount > 1 ? `${firstCount}x ` : ''}${firstLabel}. Mission Control opened.`);
        setIsConfirming(false);
        setPendingLaunch(null);
      }
    } catch (e) {
      setStatus(`Error: ${e}`);
      setPendingLaunch(null);
    } finally {
      setBusy(false);
    }
  }

  // Derive pipeline preview for the UI hint — grouped by parallel stage.
  const assignedTargets = syncedRows.filter(r => r.roleId);
  const previewUsed = new Set(assignedTargets.map(r => r.roleId));
  const previewGroups: string[][] = STAGES
    .map(g => g.filter(r => previewUsed.has(r)))
    .filter(g => g.length > 0);

  return (
    <div className="flex flex-col h-full bg-bg-panel overflow-hidden">

      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-panel shrink-0">
        <Rocket size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Task Launcher</span>
        <div className="ml-auto flex items-center bg-bg-surface border border-border-panel rounded-md p-0.5">
          <button
            onClick={() => setMode('build')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
              mode === 'build'
                ? 'bg-accent-primary text-accent-text'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Build mode: create new files and projects from scratch"
          >
            <Hammer size={9} />
            Build
          </button>
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
              mode === 'edit'
                ? 'bg-accent-primary text-accent-text'
                : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Edit mode: read and modify an existing codebase"
          >
            <Wrench size={9} />
            Edit
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">

        {/* Mode hint */}
        {mode === 'edit' && (
          <div className="text-[10px] text-text-muted bg-bg-surface border border-border-panel rounded-md px-2.5 py-2 leading-relaxed">
            Agents will <span className="text-accent-primary font-semibold">read the existing codebase first</span> and make targeted edits. Set the workspace directory to your project root.
          </div>
        )}

        {/* Task input */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            {mode === 'edit' ? 'Change / Fix' : 'Task / Goal'}
          </label>
          <textarea
            value={task}
            onChange={e => setTask(e.target.value)}
            placeholder={mode === 'edit'
              ? 'Describe what to change, fix, or refactor…'
              : 'Describe the task or goal for this agent team…'
            }
            rows={3}
            className="w-full bg-bg-surface border border-border-panel rounded-md px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-primary transition-colors"
          />
        </div>

        {/* Terminal role assignment */}
        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            Auto Detected Agents
          </label>

          {terminals.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-muted opacity-50 py-3">
              <TerminalSquare size={14} />
              <span>No terminal panes open. Add a terminal to detect role/CLI.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {syncedRows.map(r => (
                <div key={r.pane.id} className="flex items-center gap-2">
                  <div className="flex items-center gap-1.5 w-28 shrink-0">
                    <TerminalSquare size={11} className="text-text-muted shrink-0" />
                    <span className="text-xs text-text-secondary truncate">{r.pane.title}</span>
                  </div>
                  <div className={`w-24 shrink-0 text-[10px] uppercase tracking-wide px-2 py-1 border rounded text-center ${r.cli ? 'border-border-panel bg-bg-surface text-text-primary' : 'border-dashed border-border-panel bg-bg-surface text-text-muted'}`}>
                    <span className="inline-flex items-center gap-1"><Cpu size={10} />{r.cli ?? 'N/A'}</span>
                  </div>
                  <div className="relative flex-1">
                    <div className={`w-full border rounded px-2.5 py-1 text-xs ${
                      r.roleId ? 'text-text-primary border-border-panel bg-bg-surface' : 'text-red-300 border-red-500/40 bg-red-500/10'
                    }`}>
                      {r.roleId
                        ? (ROLES.find(role => role.id === r.roleId)?.label ?? r.roleId)
                        : 'Role not detected (name terminal with role keyword)'}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Pipeline preview — one chip per stage group; parallel peers share. */}
        {previewGroups.length > 0 && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
              Pipeline
            </label>
            <div className="flex items-center flex-wrap gap-1 px-2.5 py-2 bg-bg-surface border border-border-panel rounded-md">
              {previewGroups.map((group, idx) => {
                const groupCount = assignedTargets.filter(r => group.includes(r.roleId)).length;
                const label = group
                  .map(id => agentsConfig.agents.find(a => a.id === id)?.name ?? id)
                  .join(' + ');
                return (
                  <span key={group.join('+')} className="flex items-center gap-1">
                    <span className="text-[10px] font-medium text-accent-primary bg-accent-primary/10 border border-accent-primary/20 rounded px-1.5 py-0.5">
                      {groupCount > group.length ? `${groupCount}× ` : ''}{label}
                    </span>
                    {idx < previewGroups.length - 1 && (
                      <span className="text-[10px] text-text-muted opacity-40">→</span>
                    )}
                  </span>
                );
              })}
            </div>
            <p className="text-[10px] text-text-muted opacity-50 leading-relaxed">
              Groups run sequentially. Multiple roles in the same group run in parallel.
            </p>
          </div>
        )}

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
