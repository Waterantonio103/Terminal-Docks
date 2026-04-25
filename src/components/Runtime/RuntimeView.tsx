import { useEffect, useMemo, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import { Bot, Cpu, FileCode2, Focus, RefreshCw, ShieldAlert, Square } from 'lucide-react';
import { TerminalPane } from '../Terminal/TerminalPane';
import { useWorkspaceStore, type MissionAgent, type Pane, type WorkflowAgentCli } from '../../store/workspace';
import { workflowStatusLabel, workflowStatusTone } from '../../lib/workflowStatus';

interface PermissionRequest {
  id: string;
  nodeId?: string | null;
  terminalId?: string;
  cli?: string;
  permissionType: string;
  label?: string;
  message?: string;
  dedupeKey?: string;
  timestamp?: number;
  state?: 'pending' | 'approved' | 'denied' | 'injected' | 'failed' | 'expired';
  decision?: 'approve' | 'deny' | string | null;
  error?: string | null;
}

interface RuntimeNodeModel {
  key: string;
  agent: MissionAgent;
  x: number;
  y: number;
}

const NODE_WIDTH = 460;
const NODE_HEIGHT = 430;
const GRID_GAP_X = 80;
const GRID_GAP_Y = 60;
const ACTIVE_STATUSES = new Set(['launching', 'connecting', 'spawning', 'terminal_started', 'adapter_starting', 'mcp_connecting', 'registered', 'ready', 'activation_pending', 'activation_acked', 'activated', 'running', 'handoff_pending', 'waiting']);

function runtimePaneFor(agent: MissionAgent): Pane | null {
  if (!agent.terminalId) return null;
  return {
    id: `runtime-${agent.terminalId}`,
    type: 'terminal',
    title: agent.title || agent.roleId || 'Runtime',
    gridPos: { x: 0, y: 0, w: 12, h: 12 },
    data: {
      terminalId: agent.terminalId,
      nodeId: agent.nodeId,
      roleId: agent.roleId,
      cli: (agent.runtimeCli ?? agent.cli ?? 'claude') as WorkflowAgentCli,
      executionMode: agent.executionMode ?? 'interactive_pty',
    },
  };
}

export function RuntimeView() {
  const tabs = useWorkspaceStore(state => state.tabs);
  const nodeRuntimeBindings = useWorkspaceStore(state => state.nodeRuntimeBindings);
  const globalGraph = useWorkspaceStore(state => state.globalGraph);
  const setAppMode = useWorkspaceStore(state => state.setAppMode);
  const addPane = useWorkspaceStore(state => state.addPane);
  const [permissionRequests, setPermissionRequests] = useState<Record<string, PermissionRequest>>({});

  const agents = useMemo(() => {
    const liveAgents: MissionAgent[] = [];
    for (const tab of tabs) {
      for (const pane of tab.panes) {
        if (pane.type !== 'missioncontrol') continue;
        const paneAgents = (pane.data?.agents as MissionAgent[] | undefined) ?? [];
        liveAgents.push(...paneAgents.filter(agent => agent.terminalId || agent.runtimeSessionId));
      }
    }

    const byNode = new Map(liveAgents.filter(agent => agent.nodeId).map(agent => [agent.nodeId as string, agent]));
    for (const node of globalGraph.nodes) {
      if (node.roleId !== 'agent' && !node.config?.profileId) continue;
      if (byNode.has(node.id)) continue;
      const binding = nodeRuntimeBindings[node.id];
      const terminalId = String(node.config?.terminalId ?? binding?.terminalId ?? '').trim();
      const runtimeSessionId = String(binding?.runtimeSessionId ?? '').trim();
      if (!terminalId && !runtimeSessionId) continue;
      liveAgents.push({
        nodeId: node.id,
        terminalId,
        title: node.config?.terminalTitle || `Runtime ${node.roleId ?? 'agent'}`,
        roleId: node.roleId ?? 'agent',
        status: binding?.adapterStatus ?? node.status ?? 'idle',
        runtimeSessionId: runtimeSessionId || null,
        cli: node.config?.cli,
        runtimeCli: node.config?.cli ?? null,
        executionMode: node.config?.executionMode ?? 'interactive_pty',
      });
    }

    const deduped = new Map<string, MissionAgent>();
    for (const agent of liveAgents) {
      const key = agent.nodeId || agent.terminalId || agent.runtimeSessionId || `${agent.roleId}-${deduped.size}`;
      deduped.set(key, { ...(deduped.get(key) ?? {}), ...agent });
    }
    return Array.from(deduped.values());
  }, [globalGraph.nodes, nodeRuntimeBindings, tabs]);

  const runtimeNodes = useMemo<RuntimeNodeModel[]>(() => {
    const occupied = new Set<string>();
    return agents.map((agent, index) => {
      const workflowNode = agent.nodeId ? globalGraph.nodes.find(node => node.id === agent.nodeId) : null;
      const position = workflowNode?.config?.position;
      let x = typeof position?.x === 'number' ? position.x : 60 + (index % 3) * (NODE_WIDTH + GRID_GAP_X);
      let y = typeof position?.y === 'number' ? position.y : 70 + Math.floor(index / 3) * (NODE_HEIGHT + GRID_GAP_Y);
      let guard = 0;
      while (occupied.has(`${Math.round(x)}:${Math.round(y)}`) && guard < 20) {
        x += 32;
        y += 28;
        guard += 1;
      }
      occupied.add(`${Math.round(x)}:${Math.round(y)}`);
      return {
        key: agent.nodeId || agent.terminalId || agent.runtimeSessionId || `runtime-${index}`,
        agent,
        x,
        y,
      };
    });
  }, [agents, globalGraph.nodes]);

  const runtimeNodeByNodeId = useMemo(() => {
    const map = new Map<string, RuntimeNodeModel>();
    for (const node of runtimeNodes) {
      if (node.agent.nodeId) map.set(node.agent.nodeId, node);
    }
    return map;
  }, [runtimeNodes]);

  const runtimeEdges = useMemo(() => (
    globalGraph.edges
      .flatMap(edge => {
        const from = runtimeNodeByNodeId.get(edge.fromNodeId);
        const to = runtimeNodeByNodeId.get(edge.toNodeId);
        if (!from || !to) return [];
        return [{
          id: `${edge.fromNodeId}->${edge.toNodeId}`,
          from,
          to,
          condition: edge.condition ?? 'always',
        }];
      })
  ), [globalGraph.edges, runtimeNodeByNodeId]);

  const canvasSize = useMemo(() => {
    const maxX = runtimeNodes.reduce((max, node) => Math.max(max, node.x + NODE_WIDTH + 80), 900);
    const maxY = runtimeNodes.reduce((max, node) => Math.max(max, node.y + NODE_HEIGHT + 80), 620);
    return { width: maxX, height: maxY };
  }, [runtimeNodes]);

  useEffect(() => {
    let unlistenRequested: (() => void) | undefined;
    let unlistenUpdated: (() => void) | undefined;
    let unmounted = false;
    invoke<PermissionRequest[]>('list_active_permission_requests')
      .then(requests => {
        if (unmounted) return;
        setPermissionRequests(Object.fromEntries(requests.map(request => [request.id, request])));
      })
      .catch(() => {});
    listen<PermissionRequest>('workflow-permission-requested', event => {
      if (unmounted) return;
      setPermissionRequests(previous => {
        const dedupeKey = event.payload.dedupeKey ?? event.payload.id;
        const existing = Object.values(previous).find(request => (request.dedupeKey ?? request.id) === dedupeKey);
        if (existing?.state === 'pending') return previous;
        return {
          ...previous,
          [event.payload.id]: { ...event.payload, dedupeKey, state: 'pending' },
        };
      });
    }).then(fn => {
      unlistenRequested = fn;
      if (unmounted) fn();
    });
    listen<PermissionRequest>('workflow-permission-updated', event => {
      if (unmounted) return;
      setPermissionRequests(previous => ({
        ...previous,
        [event.payload.id]: event.payload,
      }));
    }).then(fn => {
      unlistenUpdated = fn;
      if (unmounted) fn();
    });
    return () => {
      unmounted = true;
      unlistenRequested?.();
      unlistenUpdated?.();
    };
  }, []);

  const decidePermission = (request: PermissionRequest, decision: 'approve' | 'deny') => {
    setPermissionRequests(previous => ({
      ...previous,
      [request.id]: { ...request, state: decision === 'approve' ? 'approved' : 'denied' },
    }));
    invoke('handle_workflow_permission_decision', {
      requestId: request.id,
      decision,
    }).catch(() => {
      setPermissionRequests(previous => ({
        ...previous,
        [request.id]: { ...request, state: 'failed', decision, error: 'Decision was rejected by the backend.' },
      }));
    });
  };

  const focusRuntime = (agent: MissionAgent) => {
    if (!agent.terminalId) return;
    emit('focus-terminal', { terminalId: agent.terminalId }).catch(() => {});
  };

  const stopRuntime = (agent: MissionAgent) => {
    if (!agent.terminalId) return;
    invoke('destroy_pty', { id: agent.terminalId }).catch(() => {});
  };

  const retryRuntime = (agent: MissionAgent) => {
    emit('workflow-runtime-retry-requested', {
      nodeId: agent.nodeId ?? null,
      terminalId: agent.terminalId ?? null,
      runtimeSessionId: agent.runtimeSessionId ?? null,
    }).catch(() => {});
  };

  const openArtifact = (agent: MissionAgent) => {
    const artifact = agent.artifacts?.find(item => item.path);
    if (!artifact?.path) return;
    addPane('editor', artifact.label || artifact.path.split(/[\\/]/).pop() || 'Artifact', { filePath: artifact.path });
    setAppMode('workspace');
  };

  const requestsByNode = useMemo(() => {
    const map = new Map<string, PermissionRequest[]>();
    for (const request of Object.values(permissionRequests)) {
      const key = request.nodeId || request.terminalId || 'global';
      map.set(key, [...(map.get(key) ?? []), request]);
    }
    return map;
  }, [permissionRequests]);

  return (
    <div className="h-full w-full bg-bg-app overflow-auto">
      <div className="sticky top-0 z-20 px-5 py-4 border-b border-border-panel bg-bg-app/95 backdrop-blur flex items-center justify-between">
        <div>
          <div className="text-[10px] uppercase tracking-[0.24em] text-accent-primary">Machine View</div>
          <div className="text-lg font-semibold text-text-primary">Runtime Execution</div>
        </div>
        <div className="text-[11px] text-text-muted">
          {agents.length} runtime node{agents.length === 1 ? '' : 's'} · {runtimeEdges.length} execution edge{runtimeEdges.length === 1 ? '' : 's'}
        </div>
      </div>

      {agents.length === 0 ? (
        <div className="h-[60vh] flex flex-col items-center justify-center text-center text-text-muted gap-3">
          <Cpu size={34} className="opacity-40" />
          <div className="text-sm text-text-secondary">No active agent sessions.</div>
          <div className="text-[11px] max-w-sm">Run a workflow to populate this view with live runtime nodes and terminal streams.</div>
        </div>
      ) : (
        <div className="relative" style={{ width: canvasSize.width, height: canvasSize.height }}>
          <svg className="absolute inset-0 pointer-events-none" width={canvasSize.width} height={canvasSize.height}>
            {runtimeEdges.map(edge => {
              const fromX = edge.from.x + NODE_WIDTH;
              const fromY = edge.from.y + 86;
              const toX = edge.to.x;
              const toY = edge.to.y + 86;
              const mid = Math.max(70, Math.abs(toX - fromX) * 0.45);
              return (
                <path
                  key={edge.id}
                  d={`M ${fromX} ${fromY} C ${fromX + mid} ${fromY}, ${toX - mid} ${toY}, ${toX} ${toY}`}
                  fill="none"
                  stroke="rgba(139,195,255,0.42)"
                  strokeWidth="2"
                  strokeDasharray={edge.condition === 'always' ? undefined : '8 6'}
                />
              );
            })}
          </svg>

          {runtimeNodes.map(runtimeNode => {
            const agent = runtimeNode.agent;
            const pane = runtimePaneFor(agent);
            const status = agent.status ?? 'idle';
            const isActive = ACTIVE_STATUSES.has(status);
            const nodeRequests = requestsByNode.get(agent.nodeId || agent.terminalId || 'global') ?? [];
            return (
              <div
                key={runtimeNode.key}
                className={`absolute rounded-lg border bg-bg-panel overflow-hidden flex flex-col shadow-sm ${isActive ? 'border-accent-primary/50' : 'border-border-panel'}`}
                style={{ left: runtimeNode.x, top: runtimeNode.y, width: NODE_WIDTH, height: NODE_HEIGHT }}
              >
                <div className="h-12 px-3 border-b border-border-panel bg-bg-titlebar flex items-center justify-between gap-3">
                  <div className="min-w-0 flex items-center gap-2">
                    <Bot size={15} className="text-accent-primary shrink-0" />
                    <div className="min-w-0">
                      <div className="text-sm font-semibold text-text-primary truncate">{agent.roleId || agent.title}</div>
                      <div className="text-[10px] text-text-muted truncate">{agent.runtimeCli ?? agent.cli ?? 'CLI unknown'} · {agent.terminalId || agent.runtimeSessionId}</div>
                    </div>
                  </div>
                  <div className={`text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border ${workflowStatusTone(status, 'mission')}`}>
                    {workflowStatusLabel(status)}
                  </div>
                </div>

                <div className="h-9 px-3 border-b border-border-panel bg-bg-panel flex items-center justify-between">
                  <div className="text-[10px] text-text-muted truncate">{agent.currentAction || (isActive ? 'Working...' : 'No active action')}</div>
                  <div className="flex items-center gap-1">
                    <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-surface" title="Focus terminal" onClick={() => focusRuntime(agent)} disabled={!agent.terminalId}>
                      <Focus size={13} />
                    </button>
                    <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-red-300 hover:bg-red-500/10" title="Stop session" onClick={() => stopRuntime(agent)} disabled={!agent.terminalId}>
                      <Square size={12} />
                    </button>
                    <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-surface" title="Retry activation" onClick={() => retryRuntime(agent)}>
                      <RefreshCw size={13} />
                    </button>
                    <button className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-surface disabled:opacity-30" title="Open artifact in Workspace" onClick={() => openArtifact(agent)} disabled={!agent.artifacts?.some(item => item.path)}>
                      <FileCode2 size={13} />
                    </button>
                  </div>
                </div>

                {nodeRequests.map(request => (
                  <div key={request.id} className="m-3 mb-0 rounded border border-amber-400/40 bg-amber-400/10 p-3 text-[11px] text-amber-100">
                    <div className="flex items-center gap-2 font-semibold">
                      <ShieldAlert size={13} />
                      Grant permission for: {request.label ?? request.permissionType}?
                    </div>
                    {request.message && <div className="mt-1 text-amber-100/70 line-clamp-2">{request.message}</div>}
                    {request.error && <div className="mt-1 text-red-200/80 line-clamp-2">{request.error}</div>}
                    {request.state === 'pending' ? (
                      <div className="mt-2 flex gap-2">
                        <button className="px-2 py-1 rounded bg-emerald-500/20 text-emerald-200 border border-emerald-400/30" onClick={() => decidePermission(request, 'approve')}>Approve</button>
                        <button className="px-2 py-1 rounded bg-red-500/20 text-red-200 border border-red-400/30" onClick={() => decidePermission(request, 'deny')}>Deny</button>
                      </div>
                    ) : (
                      <div className="mt-2 uppercase tracking-wide text-[9px] text-amber-100/70">{request.state}{request.decision ? ` · ${request.decision}` : ''}</div>
                    )}
                  </div>
                ))}

                <div className="flex-1 min-h-0 bg-bg-app">
                  {pane ? (
                    <TerminalPane pane={pane} />
                  ) : (
                    <div className="h-full flex items-center justify-center text-[12px] text-text-muted">Runtime has no PTY stream.</div>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
