import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { AlertCircle, Cpu, GitBranch, Hammer, Plug, Rocket, TerminalSquare, Wand2, Wrench } from 'lucide-react';
import {
  Pane,
  selectActivePanes,
  type CompiledMission,
  type MissionAgent,
  type WorkflowAuthoringMode,
  type WorkflowEdgeCondition,
  type WorkflowExecutionMode,
  type WorkflowGraph,
  useWorkspaceStore,
} from '../../store/workspace';
import agentsConfig from '../../config/agents';
import { type LaunchMode } from '../../lib/buildPrompt';
import { compileMission } from '../../lib/graphCompiler';
import { generateId } from '../../lib/graphUtils';
import { buildPresetFlowGraph, getWorkflowPreset, listWorkflowPresets } from '../../lib/workflowPresets';
import { detectCliForPane, detectRoleForPane, type AgentCli } from '../../lib/cliDetection';

const PRESETS = listWorkflowPresets();

type GraphFlowNode = {
  id: string;
  type: 'task' | 'agent' | 'barrier' | 'frame' | 'reroute';
  position: { x: number; y: number };
  data: Record<string, unknown>;
};

type GraphFlowEdge = {
  id: string;
  source: string;
  target: string;
  data: { condition: WorkflowEdgeCondition };
};


interface TerminalRow {
  pane: Pane;
  roleId: string;
  cli: AgentCli | null;
}

interface PendingLaunchState {
  missionId: string;
  mission: CompiledMission;
  agents: MissionAgent[];
  startTerminalIds: string[];
}


function buildRoleBindingPools(rows: TerminalRow[]) {
  const byRole = new Map<string, TerminalRow[]>();
  for (const row of rows) {
    if (!row.roleId) continue;
    const current = byRole.get(row.roleId) ?? [];
    current.push(row);
    byRole.set(row.roleId, current);
  }
  const cursor = new Map<string, number>();

  return {
    hasRole(roleId: string) {
      return (byRole.get(roleId)?.length ?? 0) > 0;
    },
    take(roleId: string): TerminalRow | null {
      const pool = byRole.get(roleId) ?? [];
      if (pool.length === 0) return null;
      const idx = cursor.get(roleId) ?? 0;
      cursor.set(roleId, idx + 1);
      return pool[Math.min(idx, pool.length - 1)] ?? null;
    },
  };
}

function workflowGraphToFlowGraph(options: {
  graph: WorkflowGraph;
  workspaceDir: string | null;
  terminalRows: TerminalRow[];
  agentInstructions: Record<string, string>;
}): { nodes: GraphFlowNode[]; edges: GraphFlowEdge[] } {
  const { graph, workspaceDir, terminalRows, agentInstructions } = options;
  const pools = buildRoleBindingPools(terminalRows);

  const nodes: GraphFlowNode[] = graph.nodes.map((node, index) => {
    const roleId = node.roleId;
    const position = node.config?.position ?? { x: 120 + index * 260, y: 140 };

    if (roleId === 'task') {
      return {
        id: node.id,
        type: 'task',
        position,
        data: {
          roleId: 'task',
          prompt: node.config?.prompt ?? '',
          mode: node.config?.mode ?? 'build',
          workspaceDir: node.config?.workspaceDir ?? workspaceDir ?? '',
        },
      };
    }

    if (roleId === 'barrier' || roleId === 'frame' || roleId === 'reroute') {
      return {
        id: node.id,
        type: roleId,
        position,
        data: {
          roleId,
          label: node.config?.label ?? roleId,
        },
      };
    }

    const picked = pools.take(roleId);
    const terminalId = node.config?.terminalId ?? picked?.pane.data?.terminalId ?? '';
    const terminalTitle = node.config?.terminalTitle ?? picked?.pane.title ?? '';
    const paneId = node.config?.paneId ?? picked?.pane.id;

    return {
      id: node.id,
      type: 'agent',
      position,
      data: {
        roleId,
        instructionOverride: node.config?.instructionOverride ?? agentInstructions[roleId] ?? '',
        terminalId,
        terminalTitle,
        paneId,
        executionMode: node.config?.executionMode ?? 'interactive_pty',
        autoLinked: Boolean(node.config?.autoLinked ?? picked),
      },
    };
  });

  const edges: GraphFlowEdge[] = graph.edges.map((edge, index) => ({
    id: `edge:${edge.fromNodeId}:${edge.condition ?? 'always'}:${edge.toNodeId}:${index}`,
    source: edge.fromNodeId,
    target: edge.toNodeId,
    data: {
      condition: edge.condition ?? 'always',
    },
  }));

  return { nodes, edges };
}

function buildAdaptiveSeedFlowGraph(options: {
  missionId: string;
  objective: string;
  mode: LaunchMode;
  workspaceDir: string | null;
  terminalRows: TerminalRow[];
  agentInstructions: Record<string, string>;
}) {
  const { missionId, objective, mode, workspaceDir, terminalRows, agentInstructions } = options;
  const coordinator = terminalRows.find(row => row.roleId === 'coordinator') ?? terminalRows[0];
  if (!coordinator) {
    throw new Error('Adaptive mode requires at least one terminal. Name one terminal with role "coordinator" for best results.');
  }

  const taskNodeId = `task-${missionId}`;
  const supervisorNodeId = `supervisor-${missionId}`;

  const nodes: GraphFlowNode[] = [
    {
      id: taskNodeId,
      type: 'task',
      position: { x: 120, y: 120 },
      data: {
        roleId: 'task',
        prompt: objective,
        mode,
        workspaceDir: workspaceDir ?? '',
      },
    },
    {
      id: supervisorNodeId,
      type: 'agent',
      position: { x: 460, y: 140 },
      data: {
        roleId: 'coordinator',
        instructionOverride: agentInstructions.coordinator ?? '',
        terminalId: coordinator.pane.data?.terminalId ?? `term-${coordinator.pane.id}`,
        terminalTitle: coordinator.pane.title,
        paneId: coordinator.pane.id,
        executionMode: (coordinator.pane.data?.executionMode as WorkflowExecutionMode | undefined) ?? 'interactive_pty',
        autoLinked: true,
      },
    },
  ];

  const edges: GraphFlowEdge[] = [
    {
      id: `edge:${taskNodeId}:always:${supervisorNodeId}`,
      source: taskNodeId,
      target: supervisorNodeId,
      data: { condition: 'always' },
    },
  ];

  return { nodes, edges };
}

export function LauncherPane() {
  const allPanes = useWorkspaceStore(selectActivePanes);
  const addPane = useWorkspaceStore(s => s.addPane);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const workspaceDir = useWorkspaceStore(s => s.workspaceDir);
  const globalGraph = useWorkspaceStore(s => s.globalGraph);
  const agentInstructions = useWorkspaceStore(s => s.agentInstructions);

  const terminals = allPanes.filter(p => p.type === 'terminal');

  const [mode, setMode] = useState<LaunchMode>('build');
  const [authoringMode, setAuthoringMode] = useState<WorkflowAuthoringMode>('preset');
  const [presetId, setPresetId] = useState<string>(PRESETS[0]?.id ?? '');
  const [task, setTask] = useState('');
  const [status, setStatus] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const [mcpUrl, setMcpUrl] = useState('http://localhost:3741/mcp');
  const [pendingLaunch, setPendingLaunch] = useState<PendingLaunchState | null>(null);
  const [editingCliPaneId, setEditingCliPaneId] = useState<string | null>(null);
  const [editCliCommand, setEditCliCommand] = useState('');
  const [editCliArgs, setEditCliArgs] = useState('');

  useEffect(() => {
    invoke<string>('get_mcp_url').then(url => setMcpUrl(url)).catch(() => {});
  }, []);

  useEffect(() => {
    setIsConfirming(false);
    setPendingLaunch(null);
  }, [task, mode, authoringMode, presetId, allPanes]);

  const syncedRows: TerminalRow[] = useMemo(
    () =>
      terminals.map(p => ({
        pane: p,
        roleId: detectRoleForPane(p as any) ?? '',
        cli: detectCliForPane(p as any),
      })),
    [terminals]
  );

  function saveCustomCli(paneId: string) {
    const cmd = editCliCommand.trim();
    if (!cmd) {
      clearCustomCli(paneId);
      return;
    }
    const args = editCliArgs.trim().split(/\s+/).filter(Boolean);
    updatePaneData(paneId, { customCliCommand: cmd, customCliArgs: args });
    setEditingCliPaneId(null);
  }

  function clearCustomCli(paneId: string) {
    updatePaneData(paneId, { customCliCommand: undefined, customCliArgs: undefined });
    setEditingCliPaneId(null);
  }

  async function handleConnect() {
    const targets = syncedRows.filter(r => r.roleId);
    if (!targets.length) {
      setStatus('No detectable role found. Name terminals with role keywords (scout/coordinator/builder/tester/security/reviewer).');
      return;
    }

    setBusy(true);
    setStatus(null);

    try {
      const { runtimeManager } = await import('../../lib/runtime/RuntimeManager');

      await Promise.all(
        targets.map(async row => {
          const cli = row.cli ?? 'claude';
          const role = row.roleId;
          const terminalId = row.pane.data?.terminalId ?? `term-${row.pane.id}`;

          if (cli === 'claude') {
            await runtimeManager.writeBootstrapToTerminal(terminalId, '\x03', 'LauncherPane.handleConnect');
            await new Promise(resolve => setTimeout(resolve, 200));
          }

          const cliHint =
            cli === 'claude'
              ? `If CometAI Starlink tools are not yet available run: !claude mcp add --transport sse starlink-mcp ${mcpUrl} --scope user `
              : cli === 'gemini'
                ? `The MCP server uses SSE transport at ${mcpUrl}. `
                : cli === 'custom'
                  ? ((row.pane.data?.customCliMcpHint as string | undefined)
                    ? `${row.pane.data?.customCliMcpHint} `
                    : `Add this MCP URL to your CLI config (SSE): ${mcpUrl} `)
                  : '';

          const roleParam = cli === 'gemini' ? role : `${role}`;
          const profile = agentsConfig.agents.find(agent => agent.id === role);
          const capabilityJson = JSON.stringify(profile?.capabilities ?? []);
          const profileId = profile?.profileId ?? `${role}_profile`;
          const escapedWorkingDir = workspaceDir ? workspaceDir.replace(/\\/g, '\\\\') : '';
          const prompt =
            `The CometAI Starlink server is at ${mcpUrl} (SSE). ` +
            cliHint +
            `Graph runtime is control-plane driven: wait for NEW_TASK payloads and use mission/node-scoped tools. ` +
            `Session bootstrap: call connect_agent with role="${roleParam}", agentId="${row.pane.title}", terminalId="${terminalId}", cli="${cli}", profileId="${profileId}", capabilities=${capabilityJson}${workspaceDir ? `, workingDir="${escapedWorkingDir}"` : ''}. ` +
            `Then keep worker metadata current with register_worker_capabilities when your availability changes.`;

          await runtimeManager.writeBootstrapToTerminal(terminalId, `${prompt}\r`, 'LauncherPane.handleConnect');
        })
      );

      setStatus(`Sent MCP bootstrap context to ${targets.length} terminal(s).`);
    } catch (error) {
      setStatus(`Error: ${error}`);
    } finally {
      setBusy(false);
    }
  }

  function compileLaunchMission(missionId: string): CompiledMission {
    if (!task.trim()) {
      throw new Error('Enter a task description first.');
    }

    const objective = task.trim();
    const terminalClis = Object.fromEntries(
      syncedRows
        .map(row => [row.pane.data?.terminalId ?? `term-${row.pane.id}`, row.cli ?? 'claude'])
        .filter(entry => Boolean(entry[0]))
    );

    if (authoringMode === 'preset') {
      const preset = getWorkflowPreset(presetId);
      if (!preset) {
        throw new Error(`Unknown preset "${presetId}".`);
      }

      const pools = buildRoleBindingPools(syncedRows);
      for (const node of preset.nodes) {
        if (!pools.hasRole(node.roleId)) {
          throw new Error(`Preset requires a terminal with role "${node.roleId}".`);
        }
      }

      const bindingByRole: Record<string, { terminalId: string; terminalTitle: string; paneId?: string; cli?: AgentCli | null; executionMode?: WorkflowExecutionMode }> = {};
      for (const node of preset.nodes) {
        const picked = pools.take(node.roleId);
        if (!picked) continue;
        bindingByRole[node.roleId] = {
          terminalId: picked.pane.data?.terminalId ?? `term-${picked.pane.id}`,
          terminalTitle: picked.pane.title,
          paneId: picked.pane.id,
          cli: picked.cli,
          executionMode: (picked.pane.data?.executionMode as WorkflowExecutionMode | undefined) ?? 'interactive_pty',
        };
      }

      const flow = buildPresetFlowGraph({
        preset,
        missionId,
        prompt: objective,
        mode,
        workspaceDir,
        bindingsByRole: bindingByRole,
        instructionOverrides: agentInstructions,
      });

      return compileMission({
        missionId,
        graphId: `preset:${preset.id}`,
        nodes: flow.nodes,
        edges: flow.edges,
        workspaceDirFallback: workspaceDir,
        terminalClis,
        authoringMode: 'preset',
        presetId: preset.id,
        runVersion: 1,
      });
    }

    if (authoringMode === 'graph') {
      if (!globalGraph.nodes.length) {
        throw new Error('Graph mode requires at least one task node and one agent node in the Node Graph pane.');
      }

      const flow = workflowGraphToFlowGraph({
        graph: globalGraph,
        workspaceDir,
        terminalRows: syncedRows,
        agentInstructions,
      });

      return compileMission({
        missionId,
        graphId: globalGraph.id || `graph:${missionId}`,
        nodes: flow.nodes,
        edges: flow.edges,
        workspaceDirFallback: workspaceDir,
        terminalClis,
        authoringMode: 'graph',
        presetId: null,
        runVersion: 1,
      });
    }

    const adaptiveSeed = buildAdaptiveSeedFlowGraph({
      missionId,
      objective,
      mode,
      workspaceDir,
      terminalRows: syncedRows,
      agentInstructions,
    });

    return compileMission({
      missionId,
      graphId: `adaptive:${missionId}`,
      nodes: adaptiveSeed.nodes,
      edges: adaptiveSeed.edges,
      workspaceDirFallback: workspaceDir,
      terminalClis,
      authoringMode: 'adaptive',
      presetId: null,
      runVersion: 1,
    });
  }

  async function handleLaunch() {
    setBusy(true);
    setStatus(null);

    try {
      if (!isConfirming) {
        const missionId = generateId();
        const mission = compileLaunchMission(missionId);

        const agents: MissionAgent[] = mission.nodes.map(node => ({
          terminalId: node.terminal.terminalId,
          title: node.terminal.terminalTitle,
          roleId: node.roleId,
          paneId: node.terminal.paneId,
          status: 'idle',
          attempt: 0,
          lastPayload: null,
          attemptHistory: [],
          nodeId: node.id,
          runtimeCli: node.terminal.cli,
          executionMode: node.terminal.executionMode,
          activeRunId: null,
          runtimeSessionId: null,
          runtimeBootstrapState: 'NOT_CONNECTED',
          runtimeBootstrapReason: null,
        }));

        const nodeById = new Map(mission.nodes.map(node => [node.id, node]));
        const startTerminalIds = Array.from(
          new Set(
            mission.metadata.startNodeIds
              .map(nodeId => nodeById.get(nodeId)?.terminal.terminalId)
              .filter((value): value is string => Boolean(value))
          )
        );

        if (startTerminalIds.length === 0) {
          throw new Error('Compiled mission has no start nodes with terminal bindings.');
        }

        setPendingLaunch({ missionId, mission, agents, startTerminalIds });
        setIsConfirming(true);
        setStatus('Mission compiled. Review the plan, then click Confirm to launch through RuntimeManager.');
      } else {
        if (!pendingLaunch) {
          throw new Error('No compiled mission found. Re-compile before confirming.');
        }

        // TS Orchestrator is the canonical runtime brain.
        const { workflowOrchestrator } = await import('../../lib/workflow/WorkflowOrchestrator');
        const { compiledMissionToDefinition } = await import('../../lib/workflow/index');
        workflowOrchestrator.startRun(
          compiledMissionToDefinition(pendingLaunch.mission),
          { runId: pendingLaunch.missionId }
        );

        addPane('missioncontrol', 'Mission Control', {
          taskDescription: task.trim(),
          agents: pendingLaunch.agents,
          missionId: pendingLaunch.missionId,
          mission: pendingLaunch.mission,
        });

        const modeLabel = pendingLaunch.mission.metadata.authoringMode ?? 'graph';
        setStatus(`Launched ${pendingLaunch.startTerminalIds.length} start node(s) in ${modeLabel} mode. Mission Control opened.`);
        setIsConfirming(false);
        setPendingLaunch(null);
      }
    } catch (error) {
      setStatus(`Error: ${error}`);
      setPendingLaunch(null);
      setIsConfirming(false);
    } finally {
      setBusy(false);
    }
  }

  const detectedRoles = syncedRows.filter(row => row.roleId).map(row => row.roleId);
  const selectedPreset = getWorkflowPreset(presetId);

  return (
    <div className="flex flex-col h-full bg-bg-panel overflow-hidden">
      <div className="flex items-center gap-2 px-4 py-2.5 border-b border-border-panel shrink-0">
        <Rocket size={14} className="text-accent-primary" />
        <span className="text-xs font-semibold text-text-secondary uppercase tracking-wider">Task Launcher</span>
        <div className="ml-auto flex items-center bg-bg-surface border border-border-panel rounded-md p-0.5">
          <button
            onClick={() => setMode('build')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
              mode === 'build' ? 'bg-accent-primary text-accent-text' : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Build mode: create new files and projects from scratch"
          >
            <Hammer size={9} />
            Build
          </button>
          <button
            onClick={() => setMode('edit')}
            className={`flex items-center gap-1 px-2 py-0.5 rounded text-[10px] font-semibold transition-colors ${
              mode === 'edit' ? 'bg-accent-primary text-accent-text' : 'text-text-muted hover:text-text-secondary'
            }`}
            title="Edit mode: read and modify an existing codebase"
          >
            <Wrench size={9} />
            Edit
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {mode === 'edit' && (
          <div className="text-[10px] text-text-muted bg-bg-surface border border-border-panel rounded-md px-2.5 py-2 leading-relaxed">
            Agents will <span className="text-accent-primary font-semibold">read the existing codebase first</span> and make targeted edits. Set the workspace directory to your project root.
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Authoring Mode</label>
          <div className="grid grid-cols-3 gap-1.5">
            <button
              onClick={() => setAuthoringMode('preset')}
              className={`px-2.5 py-1.5 rounded border text-[11px] font-medium transition-colors ${
                authoringMode === 'preset'
                  ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                  : 'border-border-panel text-text-muted hover:text-text-primary'
              }`}
            >
              <Wand2 size={12} className="inline mr-1" />
              Preset
            </button>
            <button
              onClick={() => setAuthoringMode('graph')}
              className={`px-2.5 py-1.5 rounded border text-[11px] font-medium transition-colors ${
                authoringMode === 'graph'
                  ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                  : 'border-border-panel text-text-muted hover:text-text-primary'
              }`}
            >
              <GitBranch size={12} className="inline mr-1" />
              Graph
            </button>
            <button
              onClick={() => setAuthoringMode('adaptive')}
              className={`px-2.5 py-1.5 rounded border text-[11px] font-medium transition-colors ${
                authoringMode === 'adaptive'
                  ? 'border-accent-primary bg-accent-primary/10 text-accent-primary'
                  : 'border-border-panel text-text-muted hover:text-text-primary'
              }`}
            >
              <Cpu size={12} className="inline mr-1" />
              Adaptive
            </button>
          </div>
        </div>

        {authoringMode === 'preset' && (
          <div className="space-y-1.5">
            <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Preset</label>
            <select
              value={presetId}
              onChange={event => setPresetId(event.target.value)}
              className="w-full bg-bg-surface border border-border-panel rounded-md px-3 py-2 text-xs text-text-primary"
            >
              {PRESETS.map(preset => (
                <option key={preset.id} value={preset.id}>
                  {preset.name}
                </option>
              ))}
            </select>
            {selectedPreset && (
              <p className="text-[10px] text-text-muted leading-relaxed">{selectedPreset.description}</p>
            )}
          </div>
        )}

        {authoringMode === 'graph' && (
          <div className="text-[10px] text-text-muted bg-bg-surface border border-border-panel rounded-md px-2.5 py-2 leading-relaxed">
            Compiles directly from Node Graph editor data. Current graph has {globalGraph.nodes.length} node(s) and {globalGraph.edges.length} edge(s).
          </div>
        )}

        {authoringMode === 'adaptive' && (
          <div className="text-[10px] text-text-muted bg-bg-surface border border-border-panel rounded-md px-2.5 py-2 leading-relaxed">
            Seeds a supervisor node and runs graph patching at runtime. Start with a coordinator terminal; new nodes can be appended with adaptive patch tools.
          </div>
        )}

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">
            {mode === 'edit' ? 'Change / Fix' : 'Task / Goal'}
          </label>
          <textarea
            value={task}
            onChange={event => setTask(event.target.value)}
            placeholder={mode === 'edit' ? 'Describe what to change, fix, or refactor...' : 'Describe the task or goal for this workflow...'}
            rows={3}
            className="w-full bg-bg-surface border border-border-panel rounded-md px-3 py-2 text-xs text-text-primary placeholder:text-text-muted resize-none focus:outline-none focus:border-accent-primary transition-colors"
          />
        </div>

        <div className="space-y-1.5">
          <label className="text-[11px] font-semibold text-text-muted uppercase tracking-wider">Auto Detected Agents</label>

          {terminals.length === 0 ? (
            <div className="flex items-center gap-2 text-xs text-text-muted opacity-50 py-3">
              <TerminalSquare size={14} />
              <span>No terminal panes open. Add a terminal to detect role/CLI.</span>
            </div>
          ) : (
            <div className="space-y-1.5">
              {syncedRows.map(row => {
                const isEditing = editingCliPaneId === row.pane.id;
                const customCommand = row.pane.data?.customCliCommand as string | undefined;
                const cliLabel = row.cli === 'custom' && customCommand
                  ? (customCommand.split(/[\\/]/).pop() ?? 'custom')
                  : row.cli;

                return (
                  <div key={row.pane.id} className="space-y-1">
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1.5 w-28 shrink-0">
                        <TerminalSquare size={11} className="text-text-muted shrink-0" />
                        <span className="text-xs text-text-secondary truncate">{row.pane.title}</span>
                      </div>
                      <button
                        onClick={() => {
                          if (isEditing) {
                            setEditingCliPaneId(null);
                          } else {
                            setEditingCliPaneId(row.pane.id);
                            setEditCliCommand(customCommand ?? '');
                            setEditCliArgs((row.pane.data?.customCliArgs as string[] | undefined)?.join(' ') ?? '');
                          }
                        }}
                        title={row.cli === 'custom' ? `Custom: ${customCommand} — click to edit` : row.cli ? `Detected: ${row.cli} — click to override` : 'Click to set custom CLI'}
                        className={`w-24 shrink-0 text-[10px] uppercase tracking-wide px-2 py-1 border rounded text-center transition-colors ${
                          row.cli === 'custom'
                            ? 'border-accent-primary/50 bg-accent-primary/10 text-accent-primary hover:bg-accent-primary/20'
                            : row.cli
                              ? 'border-border-panel bg-bg-surface text-text-primary hover:border-accent-primary/50'
                              : 'border-dashed border-border-panel bg-bg-surface text-text-muted hover:border-accent-primary/50 hover:text-text-secondary'
                        }`}
                      >
                        <span className="inline-flex items-center gap-1"><Cpu size={10} />{cliLabel ?? 'N/A'}</span>
                      </button>
                      <div className={`flex-1 border rounded px-2.5 py-1 text-xs ${row.roleId ? 'text-text-primary border-border-panel bg-bg-surface' : 'text-red-300 border-red-500/40 bg-red-500/10'}`}>
                        {row.roleId || 'Role not detected (name terminal with role keyword)'}
                      </div>
                    </div>

                    {isEditing && (
                      <div className="ml-[7.5rem] flex flex-col gap-1.5 px-2 py-1.5 bg-bg-surface border border-accent-primary/30 rounded-md">
                        <div className="flex gap-1.5">
                          <input
                            type="text"
                            value={editCliCommand}
                            onChange={e => setEditCliCommand(e.target.value)}
                            placeholder="command (e.g. aider)"
                            autoFocus
                            className="flex-1 min-w-0 bg-bg-panel border border-border-panel rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveCustomCli(row.pane.id);
                              if (e.key === 'Escape') setEditingCliPaneId(null);
                            }}
                          />
                          <input
                            type="text"
                            value={editCliArgs}
                            onChange={e => setEditCliArgs(e.target.value)}
                            placeholder="flags (e.g. --model gpt-4o)"
                            className="flex-1 min-w-0 bg-bg-panel border border-border-panel rounded px-2 py-1 text-xs text-text-primary placeholder:text-text-muted focus:outline-none focus:border-accent-primary"
                            onKeyDown={e => {
                              if (e.key === 'Enter') saveCustomCli(row.pane.id);
                              if (e.key === 'Escape') setEditingCliPaneId(null);
                            }}
                          />
                        </div>
                        <div className="flex gap-1.5">
                          <button
                            onClick={() => saveCustomCli(row.pane.id)}
                            className="flex-1 px-2 py-1 text-[10px] font-semibold bg-accent-primary text-accent-text rounded hover:opacity-90 transition-opacity"
                          >
                            Set CLI
                          </button>
                          {customCommand && (
                            <button
                              onClick={() => clearCustomCli(row.pane.id)}
                              className="px-2 py-1 text-[10px] border border-border-panel text-text-muted hover:text-text-primary rounded transition-colors"
                            >
                              Clear
                            </button>
                          )}
                          <button
                            onClick={() => setEditingCliPaneId(null)}
                            className="px-2 py-1 text-[10px] border border-border-panel text-text-muted hover:text-text-primary rounded transition-colors"
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {detectedRoles.length > 0 && (
          <div className="space-y-1 border border-border-panel rounded-md p-2.5 bg-bg-surface">
            <div className="text-[10px] text-text-muted">
              Detected roles: <span className="text-text-primary">{Array.from(new Set(detectedRoles)).join(', ')}</span>
            </div>
          </div>
        )}

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
            isConfirming ? 'bg-red-600 text-white hover:bg-red-700 animate-pulse' : 'bg-accent-primary text-accent-text hover:opacity-90'
          }`}
        >
          {isConfirming ? <AlertCircle size={12} /> : <Rocket size={12} />}
          {isConfirming ? 'Confirm?' : 'Launch Task'}
        </button>
      </div>
    </div>
  );
}
