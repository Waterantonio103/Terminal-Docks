import { useEffect, useMemo, useRef, useState } from 'react';
import {
  Pane,
  MissionAgent,
  MissionAttemptRecord,
  DbTask,
  useWorkspaceStore,
  type CompiledMission,
} from '../../store/workspace';
import agentsConfig from '../../config/agents';
import {
  Monitor,
  FileText,
  ChevronRight,
  Loader2,
  CheckCircle2,
  Clock,
  ListTree,
  Download,
  TerminalSquare,
  ArrowUpRight,
  AlertCircle,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { invoke } from '@tauri-apps/api/core';
import { emit, listen } from '@tauri-apps/api/event';
import {
  
  summarizeHandoffPayload,
  type StructuredCompletionPayload,
  type RuntimeActivationPayload,
} from '../../lib/missionRuntime';
import { workflowStatusLabel, workflowStatusTone } from '../../lib/workflowStatus';

import {
  normalizeRuntimeCli,
} from '../../lib/runtimeBootstrap';


type MissionTab = 'nodes' | 'preview' | 'output' | 'tasks';


const RUNTIME_ACTIVE_STATES = new Set<MissionAgent['status']>([
  'launching',
  'connecting',
  'spawning',
  'terminal_started',
  'adapter_starting',
  'mcp_connecting',
  'registered',
  'ready',
  'activation_pending',
  'activation_acked',
  'activated',
  'running',
  'handoff_pending',
  'waiting',
]);



function logToAgent(paneId: string, nodeId: string, message: string) {
  const state = useWorkspaceStore.getState();
  const update = state.updatePaneData;
  const tabs = state.tabs;
  for (const tab of tabs) {
    const pane = tab.panes.find(p => p.id === paneId);
    if (pane) {
      const agents = (pane.data?.agents as MissionAgent[] | undefined) ?? [];
      const updated = agents.map(a => 
        a.nodeId === nodeId 
          ? { ...a, runtimeLogs: [...(a.runtimeLogs ?? []), `[${new Date().toLocaleTimeString()}] ${message}`] } 
          : a
      );
      update(paneId, { agents: updated });
      return;
    }
  }
}

function formatTime(timestamp?: number): string {
  if (!timestamp) return '—';
  return new Date(timestamp).toLocaleTimeString([], {
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  });
}

function formatDuration(start?: number, end?: number): string | null {
  if (!start || !end || end < start) return null;
  const seconds = Math.max(1, Math.round((end - start) / 1000));
  return `${seconds}s`;
}

function summarizePayload(payload?: string | null): string | null {
  return summarizeHandoffPayload(payload, 220);
}

interface HandoffViewModel {
  id: string;
  missionId: string | null;
  fromNodeId: string;
  targetNodeId: string;
  fromRole: string | null;
  targetRole: string | null;
  outcome: 'success' | 'failure' | null;
  title: string;
  summary: string;
  filesChanged: string[];
  artifactReferences: string[];
  downstreamPreview: string | null;
  timestamp: number;
}

interface AgentRunOutputLine {
  id: string;
  runId: string;
  nodeId: string;
  stream: 'stdout' | 'stderr';
  chunk: string;
  at: number;
}

function asStringArray(input: unknown): string[] {
  if (!Array.isArray(input)) return [];
  return input
    .map(value => (typeof value === 'string' ? value.trim() : ''))
    .filter(Boolean);
}

function normalizeStructuredCompletion(input: unknown): StructuredCompletionPayload | null {
  if (!input || typeof input !== 'object') return null;
  const candidate = input as Record<string, unknown>;
  const status = candidate.status;
  if (status !== 'success' && status !== 'failure') return null;
  return {
    status,
    summary: typeof candidate.summary === 'string' ? candidate.summary : '',
    artifactReferences: asStringArray(candidate.artifactReferences),
    filesChanged: asStringArray(candidate.filesChanged),
    downstreamPayload: candidate.downstreamPayload,
  };
}

function parseCompletionFromPayload(payload: unknown): StructuredCompletionPayload | null {
  if (typeof payload === 'string') {
    try {
      return normalizeStructuredCompletion(JSON.parse(payload));
    } catch {
      return null;
    }
  }
  return normalizeStructuredCompletion(payload);
}

function summarizeDownstreamPayload(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value === 'string') return summarizeHandoffPayload(value, 180);
  try {
    return summarizeHandoffPayload(JSON.stringify(value), 180);
  } catch {
    return null;
  }
}

function parseHandoffMessage(message: { id: number; content: string; timestamp: number }): HandoffViewModel | null {
  let parsed: Record<string, unknown>;
  try {
    parsed = JSON.parse(message.content) as Record<string, unknown>;
  } catch {
    return null;
  }

  const fromNodeId = typeof parsed.fromNodeId === 'string' ? parsed.fromNodeId : '';
  const targetNodeId = typeof parsed.targetNodeId === 'string' ? parsed.targetNodeId : '';
  if (!fromNodeId || !targetNodeId) return null;

  const completion =
    parseCompletionFromPayload(parsed.completion) ??
    parseCompletionFromPayload(parsed.payload);
  const downstreamPreview = summarizeDownstreamPayload(completion?.downstreamPayload ?? parsed.payload);
  const title = typeof parsed.title === 'string' && parsed.title.trim() ? parsed.title.trim() : 'Handoff';
  const summary = completion?.summary?.trim() || title;
  const outcome = parsed.outcome === 'success' || parsed.outcome === 'failure' ? parsed.outcome : null;

  return {
    id: `handoff-${message.id}`,
    missionId: typeof parsed.missionId === 'string' ? parsed.missionId : null,
    fromNodeId,
    targetNodeId,
    fromRole: typeof parsed.fromRole === 'string' ? parsed.fromRole : null,
    targetRole: typeof parsed.targetRole === 'string' ? parsed.targetRole : null,
    outcome,
    title,
    summary,
    filesChanged: completion?.filesChanged ?? [],
    artifactReferences: completion?.artifactReferences ?? [],
    downstreamPreview,
    timestamp: message.timestamp,
  };
}

function upsertAttemptHistory(
  history: MissionAttemptRecord[] | undefined,
  attempt: number,
  patch: Partial<MissionAttemptRecord>
): MissionAttemptRecord[] {
  const next = [...(history ?? [])];
  const existingIdx = next.findIndex(entry => entry.attempt === attempt);
  const previous = existingIdx >= 0
    ? next[existingIdx]
    : { attempt, status: patch.status ?? 'running' };
  
  const nextArtifacts = patch.artifacts 
    ? [...(previous.artifacts ?? []), ...patch.artifacts]
    : previous.artifacts;

  const updated: MissionAttemptRecord = {
    ...previous,
    ...patch,
    attempt,
    status: patch.status ?? previous.status,
    artifacts: nextArtifacts,
  };

  if (existingIdx >= 0) {
    next[existingIdx] = updated;
  } else {
    next.push(updated);
  }

  next.sort((left, right) => right.attempt - left.attempt);
  return next;
}

function readAgentsForPane(paneId: string, fallback: MissionAgent[]): MissionAgent[] {
  const state = useWorkspaceStore.getState();
  for (const tab of state.tabs) {
    const pane = tab.panes.find(candidate => candidate.id === paneId);
    if (pane) {
      return (pane.data?.agents as MissionAgent[] | undefined) ?? fallback;
    }
  }
  return fallback;
}

function focusAgentTerminal(terminalId: string) {
  const state = useWorkspaceStore.getState();
  const targetTab = state.tabs.find(tab =>
    tab.panes.some(pane => pane.type === 'terminal' && pane.data?.terminalId === terminalId)
  );
  if (!targetTab) return;

  if (state.activeTabId !== targetTab.id) {
    state.switchTab(targetTab.id);
  }

  window.setTimeout(() => {
    emit('focus-terminal', { terminalId }).catch(console.error);
  }, 80);
}

function runtimeBootstrapLabel(state?: MissionAgent['runtimeBootstrapState']): string {
  if (!state) return 'NOT_CONNECTED';
  if (state === 'CONNECTING') return 'CONNECTING';
  if (state === 'CONNECTED') return 'CONNECTED';
  if (state === 'NOT_CONNECTED') return 'NOT_CONNECTED';
  return state;
}

function StatusIcon({ status }: { status?: MissionAgent['status'] }) {
  if (
    status === 'launching' ||
    status === 'connecting' ||
    status === 'spawning' ||
    status === 'adapter_starting' ||
    status === 'mcp_connecting' ||
    status === 'activation_pending' ||
    status === 'running'
  ) {
    return <Loader2 size={10} className="animate-spin text-accent-primary" />;
  }
  if (status === 'terminal_started' || status === 'registered' || status === 'ready' || status === 'activation_acked') return <CheckCircle2 size={10} className="text-emerald-300" />;
  if (status === 'done' || status === 'completed') return <CheckCircle2 size={10} className="text-green-400" />;
  if (status === 'unbound' || status === 'disconnected') return <AlertCircle size={10} className="text-red-400" />;
  if (status === 'failed') return <AlertCircle size={10} className="text-red-400" />;
  if (status === 'handoff_pending' || status === 'waiting') return <Clock size={10} className="text-amber-300" />;
  return <Clock size={10} className="text-text-muted" />;
}

function AgentBadge({
  agent,
  onOpenTerminal,
}: {
  agent: MissionAgent;
  onOpenTerminal: (agent: MissionAgent) => void;
}) {
  const role = agentsConfig.agents.find(entry => entry.id === agent.roleId);
  const clickable = Boolean(agent.terminalId);

  return (
    <button
      type="button"
      onClick={() => clickable && onOpenTerminal(agent)}
      disabled={!clickable}
      title={clickable ? 'Open live terminal' : 'Terminal not available'}
      className={`flex items-center gap-1.5 px-2 py-1 rounded-md border shrink-0 transition-colors ${
        clickable ? 'hover:border-accent-primary/50 hover:background-bg-surface' : 'cursor-default'
      } ${workflowStatusTone(agent.status, 'mission')}`}
    >
      <StatusIcon status={agent.status} />
      <span className="text-xs font-medium text-left">{agent.title}</span>
      {agent.attempt && agent.attempt > 0 && (
        <span className="text-[9px] uppercase tracking-wide opacity-80">#{agent.attempt}</span>
      )}
      {role && (
        <span className="text-[9px] text-text-muted opacity-70">
          {role.name}
        </span>
      )}
      {clickable && <ArrowUpRight size={10} className="opacity-70" />}
    </button>
  );
}

function NodeCard({
  agent,
  onOpenTerminal,
}: {
  agent: MissionAgent;
  onOpenTerminal: (agent: MissionAgent) => void;
}) {
  const role = agentsConfig.agents.find(entry => entry.id === agent.roleId);
  const history = agent.attemptHistory ?? [];
  const latestDuration = formatDuration(agent.startedAt, agent.completedAt);
  const runtimeState = runtimeBootstrapLabel(agent.runtimeBootstrapState);
  const sessionId = agent.runtimeSessionId ?? '—';
  const sessionDisplay = sessionId === '—' ? sessionId : `${sessionId.slice(0, 26)}${sessionId.length > 26 ? '…' : ''}`;
  const heartbeatDisplay = agent.runtimeLastHeartbeatAt ? formatTime(agent.runtimeLastHeartbeatAt) : '—';

  return (
    <div className="border border-border-panel rounded-lg background-bg-panel overflow-hidden">
      <div className="flex items-center gap-2 px-3 py-2 border-b border-border-panel background-bg-surface">
        <StatusIcon status={agent.status} />
        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2 min-w-0">
            <span className="text-xs font-semibold text-text-primary truncate">{agent.title}</span>
            <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded border ${workflowStatusTone(agent.status, 'mission')}`}>
              {workflowStatusLabel(agent.status)}
            </span>
          </div>
          <div className="text-[10px] text-text-muted truncate">
            {role?.name ?? agent.roleId}
            {agent.nodeId ? ` · ${agent.nodeId}` : ''}
          </div>
        </div>
        <div className="flex items-center gap-1.5">
          <button
            type="button"
            onClick={() => onOpenTerminal(agent)}
            className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-text-muted hover:text-text-primary hover:background-bg-panel border border-border-panel transition-colors"
          >
            <TerminalSquare size={11} />
            Open PTY
          </button>
        </div>
      </div>

      <div className="px-3 py-3 space-y-3">
        <div className="grid grid-cols-2 gap-2 text-[11px]">
          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Current Attempt</div>
            <div className="text-text-primary font-medium">{agent.attempt ?? 0}</div>
          </div>
          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Last Outcome</div>
            <div className="text-text-primary font-medium">{agent.lastOutcome ?? '—'}</div>
          </div>
          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Started</div>
            <div className="text-text-primary font-medium">{formatTime(agent.startedAt)}</div>
          </div>
          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Completed</div>
            <div className="text-text-primary font-medium">
              {formatTime(agent.completedAt)}
              {latestDuration ? ` · ${latestDuration}` : ''}
            </div>
          </div>
          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Terminal Binding</div>
            <div className="text-text-primary font-medium">{agent.terminalId ? 'bound' : 'missing'}</div>
          </div>
          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">MCP Runtime</div>
            <div className="text-text-primary font-medium">{runtimeState}</div>
          </div>
          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5 col-span-2">
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Session / Heartbeat</div>
            <div className="text-text-primary font-medium break-all">
              {sessionDisplay}
              <span className="text-text-muted"> · {heartbeatDisplay}</span>
            </div>
          </div>
        </div>

        {agent.runtimeBootstrapReason && (
          <div className="rounded border border-amber-300/20 bg-amber-500/10 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-amber-200 mb-1">Runtime Registration</div>
            <div className="text-[11px] text-amber-100 break-words">{agent.runtimeBootstrapReason}</div>
          </div>
        )}

        {agent.lastPayload && (
          <div className="rounded border border-border-panel background-bg-surface px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-text-muted mb-1">Latest Handoff Preview</div>
            <div className="text-[11px] text-text-secondary break-words">
              {summarizePayload(agent.lastPayload) ?? 'No preview'}
            </div>
          </div>
        )}

        {agent.lastError && (
          <div className="rounded border border-red-400/20 bg-red-500/10 px-2 py-1.5">
            <div className="text-[9px] uppercase tracking-wide text-red-300 mb-1">Runtime Error</div>
            <div className="text-[11px] text-red-200 break-words">{agent.lastError}</div>
          </div>
        )}

        {agent.runtimeLogs && agent.runtimeLogs.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Activation Pipeline Logs
            </div>
            <div className="rounded border border-border-panel background-bg-surface overflow-hidden">
              <div className="max-h-[160px] overflow-y-auto px-2 py-1.5 space-y-0.5 font-mono text-[10px]">
                {agent.runtimeLogs.map((log, i) => (
                  <div key={i} className="text-text-secondary border-b border-border-panel/30 last:border-0 pb-0.5 mb-0.5">
                    {log}
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}

        {agent.artifacts && agent.artifacts.length > 0 && (
          <div className="space-y-1.5">
            <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
              Mission Artifacts
            </div>
            <div className="flex flex-wrap gap-1.5">
              {agent.artifacts.slice(-8).map(art => (
                <div 
                  key={art.id} 
                  title={art.path ?? art.label}
                  className="flex items-center gap-1.5 px-2 py-1 rounded border border-border-panel background-bg-surface text-[10px] text-text-secondary"
                >
                  {art.type === 'file_change' ? <FileText size={10} className="text-blue-400" /> : <ChevronRight size={10} className="text-accent-primary" />}
                  <span className="truncate max-w-[120px]">{art.label}</span>
                </div>
              ))}
            </div>
          </div>
        )}

        <div className="space-y-2">
          <div className="text-[10px] font-semibold uppercase tracking-wide text-text-muted">
            Attempt History
          </div>
          {history.length === 0 ? (
            <div className="rounded border border-dashed border-border-panel px-2 py-2 text-[11px] text-text-muted">
              Waiting for the first activation.
            </div>
          ) : (
            history.map(entry => {
              const duration = formatDuration(entry.startedAt, entry.completedAt);
              return (
                <div key={entry.attempt} className="rounded border border-border-panel background-bg-surface px-2 py-2">
                  <div className="flex items-center gap-2">
                    <span className="text-[11px] font-medium text-text-primary">Attempt {entry.attempt}</span>
                    <span className={`text-[10px] uppercase tracking-wide px-2 py-1 rounded border ${workflowStatusTone(entry.status, 'mission')}`}>
                      {workflowStatusLabel(entry.status)}
                    </span>
                    {entry.outcome && (
                      <span className="text-[9px] uppercase tracking-wide text-text-muted">
                        {entry.outcome}
                      </span>
                    )}
                  </div>
                  <div className="mt-1 text-[10px] text-text-muted">
                    {formatTime(entry.startedAt)}
                    {entry.completedAt ? ` → ${formatTime(entry.completedAt)}` : ''}
                    {duration ? ` · ${duration}` : ''}
                  </div>
                  {entry.payloadPreview && (
                    <div className="mt-1 text-[11px] text-text-secondary break-words">
                      {entry.payloadPreview}
                    </div>
                  )}
                  {entry.artifacts && entry.artifacts.length > 0 && (
                    <div className="mt-2 flex flex-wrap gap-1">
                      {entry.artifacts.map(art => (
                        <div key={art.id} className="flex items-center gap-1 px-1.5 py-0.5 rounded background-bg-panel border border-border-panel text-[9px] text-text-muted">
                          {art.type === 'file_change' ? <FileText size={9} /> : <ChevronRight size={9} />}
                          {art.label}
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}

function HandoffTimeline({ entries }: { entries: HandoffViewModel[] }) {
  if (entries.length === 0) {
    return (
      <div className="rounded-lg border border-dashed border-border-panel background-bg-surface px-3 py-3 text-[11px] text-text-muted">
        Handoffs will appear here after the first downstream transition.
      </div>
    );
  }

  return (
    <div className="rounded-lg border border-border-panel background-bg-panel overflow-hidden">
      <div className="px-3 py-2 border-b border-border-panel background-bg-surface text-[10px] uppercase tracking-wide text-text-muted">
        Runtime Handoff Chain
      </div>
      <div className="divide-y divide-border-panel/60">
        {entries.map(entry => (
          <div key={entry.id} className="px-3 py-2 space-y-1.5">
            <div className="flex items-center gap-2 text-[11px]">
              <span className="text-text-primary font-medium">{entry.fromNodeId}</span>
              <ChevronRight size={11} className="text-text-muted opacity-70" />
              <span className="text-text-primary font-medium">{entry.targetNodeId}</span>
              {entry.outcome && (
                <span className={`ml-auto text-[10px] uppercase tracking-wide px-2 py-1 rounded border ${workflowStatusTone(entry.outcome === 'success' ? 'done' : 'failed', 'mission')}`}>
                  {entry.outcome}
                </span>
              )}
            </div>
            <div className="text-[11px] text-text-secondary break-words">{entry.summary}</div>
            {entry.filesChanged.length > 0 && (
              <div className="text-[10px] text-text-muted break-words">
                Files: {entry.filesChanged.join(', ')}
              </div>
            )}
            {entry.artifactReferences.length > 0 && (
              <div className="text-[10px] text-text-muted break-words">
                Artifacts: {entry.artifactReferences.join(', ')}
              </div>
            )}
            {entry.downstreamPreview && (
              <div className="text-[10px] text-text-muted break-words">
                Delivered payload: {entry.downstreamPreview}
              </div>
            )}
            <div className="text-[10px] text-text-muted opacity-70">
              {new Date(entry.timestamp).toLocaleTimeString([], {
                hour: '2-digit',
                minute: '2-digit',
                second: '2-digit',
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function MissionControlPane({ pane }: { pane: Pane }) {
  const mission: CompiledMission | null = pane.data?.mission ?? null;
  const taskDescription: string = pane.data?.taskDescription ?? mission?.task.prompt ?? '';
  const agents: MissionAgent[] = pane.data?.agents ?? [];
  const currentMissionId: string | null = pane.data?.missionId ?? mission?.missionId ?? null;
  const executionLayers: string[][] = mission?.metadata.executionLayers ?? [];

  const results = useWorkspaceStore(s => s.results);
  const messages = useWorkspaceStore(s => s.messages);
  const allTasks = useWorkspaceStore(s => s.tasks);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const setNodeRuntimeBinding = useWorkspaceStore(s => s.setNodeRuntimeBinding);

  const [tab, setTab] = useState<MissionTab>('nodes');
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);
  const [exportStatus, setExportStatus] = useState<{ path: string } | { error: string } | null>(null);
  const [runOutput, setRunOutput] = useState<AgentRunOutputLine[]>([]);
  const outputRef = useRef<HTMLDivElement>(null);
  const inflightActivationsRef = useRef<Set<string>>(new Set());
  const sessionUnsubscribersRef = useRef<Map<string, () => void>>(new Map());

  const orderedAgents = useMemo(() => {
    if (executionLayers.length === 0) return agents;

    const byNodeId = new Map(
      agents
        .filter(agent => agent.nodeId)
        .map(agent => [agent.nodeId as string, agent])
    );
    const ordered: MissionAgent[] = [];

    for (const layer of executionLayers) {
      for (const nodeId of layer) {
        const agent = byNodeId.get(nodeId);
        if (agent) {
          ordered.push(agent);
          byNodeId.delete(nodeId);
        }
      }
    }

    for (const agent of agents) {
      if (!ordered.includes(agent)) ordered.push(agent);
    }

    return ordered;
  }, [agents, executionLayers]);

  const handoffTimeline = useMemo(() => {
    const parsed = messages
      .filter(message => message.type === 'handoff')
      .map(parseHandoffMessage)
      .filter((value): value is HandoffViewModel => Boolean(value))
      .filter(entry => {
        if (!currentMissionId) return true;
        return entry.missionId === currentMissionId;
      })
      .sort((left, right) => right.timestamp - left.timestamp);
    return parsed.slice(0, 16);
  }, [currentMissionId, messages]);

  function openTerminal(agent: MissionAgent) {
    if (!agent.terminalId) return;
    focusAgentTerminal(agent.terminalId);
  }

  useEffect(() => {
    return () => {
      for (const unsubscribe of sessionUnsubscribersRef.current.values()) {
        try {
          unsubscribe();
        } catch {
          // no-op
        }
      }
      sessionUnsubscribersRef.current.clear();
    };
  }, []);

  // Watch for PTY spawn events to reset individual agent status.
  useEffect(() => {
    let unlistenSpawnFn: (() => void) | undefined;
    let unlistenExitFn: (() => void) | undefined;
    let unmounted = false;

    listen<{ id: string }>('pty-spawned', (event) => {
      if (unmounted) return;
      const spawnedId = event.payload.id;
      const liveAgents = readAgentsForPane(pane.id, agents);
      const spawnedAgent = liveAgents.find(agent => agent.terminalId === spawnedId);
      if (spawnedAgent) {
        logToAgent(pane.id, spawnedAgent.nodeId!, `Terminal ${spawnedId} spawned.`);
      }
      const nextAgents = liveAgents.map(agent =>
        agent.terminalId === spawnedId
          ? {
              ...agent,
              status: 'terminal_started',
              triggered: false,
              lastError: null,
              runtimeBootstrapState: 'NOT_CONNECTED',
              runtimeBootstrapReason: null,
              runtimeSessionId: null,
              runtimeRegisteredAt: undefined,
              runtimeLastHeartbeatAt: undefined,
            }
          : agent
      );
      updatePaneData(pane.id, { agents: nextAgents });
      if (spawnedAgent?.nodeId) {
        setNodeRuntimeBinding(spawnedAgent.nodeId, {
          terminalId: spawnedId,
          runtimeSessionId: null,
          adapterStatus: 'terminal_started',
        });
      }
    }).then(fn => {
      if (unmounted) {
        fn();
      } else {
        unlistenSpawnFn = fn;
      }
    });

    listen<{ id: string }>('pty-exit', async (event) => {
      if (unmounted) return;
      const exitedId = event.payload.id;

      // Frontend guard: the Rust backend can emit pty-exit prematurely on
      // Windows ConPTY when the reader EOFs but the child process is still
      // alive (e.g. after exec).  Verify with is_pty_active before marking
      // the agent as disconnected.
      try {
        const stillAlive = await invoke<boolean>('is_pty_active', { id: exitedId });
        if (stillAlive) {
          logToAgent(pane.id, agents.find(a => a.terminalId === exitedId)?.nodeId ?? '', `pty-exit received for ${exitedId} but child is still alive — ignoring.`);
          return;
        }
      } catch { /* is_pty_active can fail if PTY was destroyed — proceed */ }

      const liveAgents = readAgentsForPane(pane.id, agents);
      const target = liveAgents.find(agent => agent.terminalId === exitedId);
      if (!target) return;

      const reason = 'Terminal process exited; runtime session disconnected.';
      logToAgent(pane.id, target.nodeId!, `Terminal process ${exitedId} EXITED.`);
      const shouldForceFailed = RUNTIME_ACTIVE_STATES.has(target.status);
      const nextAgents = liveAgents.map(agent =>
        agent.terminalId === exitedId
          ? {
              ...agent,
              status: shouldForceFailed ? 'disconnected' : agent.status,
              lastError: reason,
              runtimeBootstrapState: 'NOT_CONNECTED',
              runtimeBootstrapReason: reason,
            }
          : agent
      );
      updatePaneData(pane.id, { agents: nextAgents });
      if (target.nodeId) {
        setNodeRuntimeBinding(target.nodeId, {
          terminalId: exitedId,
          runtimeSessionId: target.runtimeSessionId ?? null,
          adapterStatus: shouldForceFailed ? 'disconnected' : target.status ?? null,
        });
      }
    }).then(fn => {
      if (unmounted) {
        fn();
      } else {
        unlistenExitFn = fn;
      }
    });

    return () => {
      unmounted = true;
      if (unlistenSpawnFn) {
        unlistenSpawnFn();
        unlistenSpawnFn = undefined;
      }
      if (unlistenExitFn) {
        unlistenExitFn();
        unlistenExitFn = undefined;
      }
    };
  }, [agents, currentMissionId, pane.id, setNodeRuntimeBinding, updatePaneData]);

  // Mission Control drives the explicit runtime lifecycle:
  // 1) MCP server health check, 2) runtime session registration, 3) NEW_TASK dispatch.
  useEffect(() => {
    let unlistenActivationFn: (() => void) | undefined;
    let unlistenUpdateFn: (() => void) | undefined;
    let unlistenWarningFn: (() => void) | undefined;
    let unlistenRunOutputFn: (() => void) | undefined;
    let unlistenRunExitFn: (() => void) | undefined;
    let unmounted = false;

    const processActivation = async (payload: RuntimeActivationPayload, missionId: string, nodeId: string, attempt: number) => {
      // The sequencing logic (PTY launch, MCP registration, task injection, ACK waits)
      // has been moved to Orchestrator and Runtime Manager (Phase 6).
      if (unmounted) return;
      if (currentMissionId && currentMissionId !== missionId) return;

      const activationKey = `${missionId}:${nodeId}:${attempt}`;
      if (inflightActivationsRef.current.has(activationKey)) return;
      inflightActivationsRef.current.add(activationKey);

      logToAgent(pane.id, nodeId, `Activation request queued in backend. Session: ${payload.sessionId}`);
      
      const now = Date.now();
      const cli = normalizeRuntimeCli(payload.cliType);
      const nextAgents = readAgentsForPane(pane.id, agents).map(agent => {
        if (agent.nodeId !== nodeId) return agent;
        return {
          ...agent,
          status: 'activation_pending' as const,
          attempt,
          startedAt: now,
          completedAt: undefined,
          lastOutcome: undefined,
          lastPayload: payload.inputPayload ?? null,
          lastError: null,
          runtimeSessionId: payload.sessionId,
          runtimeCli: cli,
          executionMode: payload.executionMode,
          activeRunId: payload.runId,
          runtimeBootstrapState: 'activation_pending',
          runtimeBootstrapReason: null,
          runtimeRegisteredAt: undefined,
          attemptHistory: upsertAttemptHistory(agent.attemptHistory, attempt, {
            attempt,
            status: 'activation_pending',
            startedAt: now,
            completedAt: undefined,
            outcome: undefined,
            payloadPreview: summarizePayload(payload.inputPayload ?? null),
          }),
        };
      });
      updatePaneData(pane.id, { agents: nextAgents });
      setNodeRuntimeBinding(nodeId, {
        terminalId: payload.terminalId,
        runtimeSessionId: payload.sessionId,
        adapterStatus: 'activation_pending',
      });
      
      inflightActivationsRef.current.delete(activationKey);
    };

    listen<{
      mission_id: string;
      node_id: string;
      attempt: number;
      status: string;
      payload: RuntimeActivationPayload;
    }>('workflow-runtime-activation-requested', (event) => {
      if (unmounted) return;
      const { mission_id: missionId, node_id: nodeId, attempt, payload } = event.payload;
      if (currentMissionId && currentMissionId !== missionId) return;

      logToAgent(pane.id, nodeId, `Activation request BROADCAST received. Attempt: ${attempt}`);
      void processActivation(payload, missionId, nodeId, attempt);
    }).then(fn => {
      if (unmounted) {
        fn();
      } else {
        unlistenActivationFn = fn;
      }
    });

    listen<{
      nodeId: string;
      missionId: string;
      message: string;
    }>('workflow-runtime-warning', (event) => {
      if (unmounted) return;
      const { nodeId, missionId, message } = event.payload;
      if (currentMissionId && currentMissionId !== missionId) return;

      const liveAgents = readAgentsForPane(pane.id, agents);
      const nextAgents = liveAgents.map(agent =>
        agent.nodeId === nodeId
          ? { ...agent, lastError: message, runtimeBootstrapReason: message }
          : agent
      );
      updatePaneData(pane.id, { agents: nextAgents });
    }).then(fn => {
      unlistenWarningFn = fn;
      if (unmounted) fn();
    });

    listen<{
      runId: string;
      missionId: string;
      nodeId: string;
      stream: 'stdout' | 'stderr';
      chunk: string;
      at: number;
    }>('agent-run-output', (event) => {
      if (unmounted) return;
      const { runId, missionId, nodeId, stream, chunk, at } = event.payload;
      if (currentMissionId && currentMissionId !== missionId) return;
      setRunOutput(previous => [
        ...previous,
        {
          id: `${runId}:${stream}:${at}:${previous.length}`,
          runId,
          nodeId,
          stream,
          chunk,
          at,
        },
      ].slice(-500));
    }).then(fn => {
      unlistenRunOutputFn = fn;
      if (unmounted) fn();
    });

    listen<{
      runId: string;
      missionId: string;
      nodeId: string;
      status: string;
      exitCode?: number | null;
      error?: string | null;
      at: number;
    }>('agent-run-exit', (event) => {
      if (unmounted) return;
      const { runId, missionId, nodeId } = event.payload;
      if (currentMissionId && currentMissionId !== missionId) return;

      const target = readAgentsForPane(pane.id, agents).find(agent =>
        agent.nodeId === nodeId && agent.activeRunId === runId
      );
      if (!target) return;
    }).then(fn => {
      unlistenRunExitFn = fn;
      if (unmounted) fn();
    });

    listen<{
      id: string;
      status: string;
      attempt?: number;
      outcome?: 'success' | 'failure';
      reason?: string;
    }>('workflow-node-update', (event) => {
      if (unmounted) return;
      const { id: nodeId, status, attempt, outcome, reason } = event.payload;
      logToAgent(pane.id, nodeId, `Node status UPDATE: ${status}${outcome ? ` (${outcome})` : ''}${reason ? ` - ${reason}` : ''}`);
      const liveAgents = readAgentsForPane(pane.id, agents);
      const now = Date.now();
      const sessionsToDispose = new Set<string>();

      const nextAgents = liveAgents.map(agent => {
        if (agent.nodeId !== nodeId) return agent;

        const nextAttempt = typeof attempt === 'number' ? attempt : (agent.attempt ?? 0);
        const nextStatus = status as MissionAgent['status'];
        const isTerminalState =
          nextStatus === 'done' ||
          nextStatus === 'completed' ||
          nextStatus === 'failed' ||
          nextStatus === 'unbound' ||
          nextStatus === 'disconnected';
        if (isTerminalState && agent.runtimeSessionId) {
          sessionsToDispose.add(agent.runtimeSessionId);
        }

        return {
          ...agent,
          status: nextStatus,
          attempt: nextAttempt,
          runtimeBootstrapState:
            nextStatus === 'failed' || nextStatus === 'unbound' || nextStatus === 'disconnected'
              ? 'NOT_CONNECTED'
              : nextStatus === 'ready' || nextStatus === 'running' || nextStatus === 'activation_acked'
                ? (agent.runtimeBootstrapState === 'NOT_CONNECTED' ? 'NOT_CONNECTED' : 'CONNECTED')
                : nextStatus === 'launching' ||
                    nextStatus === 'connecting' ||
                    nextStatus === 'spawning' ||
                    nextStatus === 'adapter_starting' ||
                    nextStatus === 'mcp_connecting' ||
                    nextStatus === 'registered' ||
                    nextStatus === 'activation_pending'
                  ? nextStatus
                  : agent.runtimeBootstrapState,
          runtimeBootstrapReason:
            nextStatus === 'failed' || nextStatus === 'unbound' || nextStatus === 'disconnected'
              ? (reason ?? agent.runtimeBootstrapReason ?? agent.lastError ?? 'Runtime activation failed.')
              : agent.runtimeBootstrapReason,
          startedAt:
            nextStatus === 'running' || nextStatus === 'launching'
              ? (agent.startedAt ?? now)
              : agent.startedAt,
          completedAt: isTerminalState ? now : agent.completedAt,
          lastOutcome: outcome ?? agent.lastOutcome,
          lastError:
            nextStatus === 'failed' || nextStatus === 'unbound' || nextStatus === 'disconnected'
              ? (reason ?? agent.lastError ?? 'Runtime activation failed.')
              : reason ?? null,
          attemptHistory: nextAttempt > 0
            ? upsertAttemptHistory(agent.attemptHistory, nextAttempt, {
                attempt: nextAttempt,
                status: nextStatus ?? 'idle',
                startedAt:
                  nextStatus === 'running' || nextStatus === 'launching'
                    ? (agent.startedAt ?? now)
                    : undefined,
                completedAt: isTerminalState ? now : undefined,
                outcome: outcome ?? undefined,
              })
            : agent.attemptHistory,
        };
      });

      updatePaneData(pane.id, { agents: nextAgents });
      const updatedAgent = nextAgents.find(agent => agent.nodeId === nodeId);
      setNodeRuntimeBinding(nodeId, {
        terminalId: updatedAgent?.terminalId,
        runtimeSessionId: updatedAgent?.runtimeSessionId ?? null,
        adapterStatus: status as MissionAgent['status'],
      });
      for (const sessionId of sessionsToDispose) {
        const unsubscribe = sessionUnsubscribersRef.current.get(sessionId);
        if (unsubscribe) {
          unsubscribe();
          sessionUnsubscribersRef.current.delete(sessionId);
        }
      }
    }).then(fn => {
      if (unmounted) {
        fn();
      } else {
        unlistenUpdateFn = fn;
      }
    });

    return () => {
      unmounted = true;
      if (unlistenActivationFn) {
        unlistenActivationFn();
        unlistenActivationFn = undefined;
      }
      if (unlistenUpdateFn) {
        unlistenUpdateFn();
        unlistenUpdateFn = undefined;
      }
      if (unlistenWarningFn) {
        unlistenWarningFn();
        unlistenWarningFn = undefined;
      }
      if (unlistenRunOutputFn) {
        unlistenRunOutputFn();
        unlistenRunOutputFn = undefined;
      }
      if (unlistenRunExitFn) {
        unlistenRunExitFn();
        unlistenRunExitFn = undefined;
      }
    };
  }, [agents, currentMissionId, pane.id, setNodeRuntimeBinding, updatePaneData]);

  useEffect(() => {
    const latestUrl = results.filter(result => result.type === 'url').pop();
    if (latestUrl) {
      setPreviewUrl(latestUrl.content.trim());
      setTab('preview');
    }
  }, [results]);

  useEffect(() => {
    if (outputRef.current) outputRef.current.scrollTop = outputRef.current.scrollHeight;
  }, [results, runOutput]);

  const markdownEntries = results.filter(entry => entry.type === 'markdown');

  async function exportLog() {
    const now = new Date();
    const pad = (value: number) => String(value).padStart(2, '0');
    const generatedAt = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
    const fileTs = `${now.getFullYear()}${pad(now.getMonth() + 1)}${pad(now.getDate())}_${pad(now.getHours())}${pad(now.getMinutes())}${pad(now.getSeconds())}`;

    const agentExports = orderedAgents.map(agent => {
      const role = agentsConfig.agents.find(entry => entry.id === agent.roleId);
      return {
        title: agent.title,
        role_name: role?.role ?? agent.roleId,
        status: agent.status ?? 'idle',
      };
    });

    const pipelineNames = mission
      ? mission.metadata.executionLayers.map(layer =>
          layer
            .map(nodeId => orderedAgents.find(agent => agent.nodeId === nodeId)?.title ?? nodeId)
            .join(' + ')
        )
      : orderedAgents.map(agent => agent.title);

    const resultExports = results.map(result => ({
      agent_id: result.agentId,
      content: result.content,
      result_type: result.type,
      timestamp: result.timestamp,
    }));

    try {
      const path = await invoke<string>('export_workflow_log', {
        taskDescription,
        generatedAt,
        fileTs,
        agents: agentExports,
        pipelineNames,
        results: resultExports,
      });
      if (path) {
        setExportStatus({ path });
        window.setTimeout(() => setExportStatus(null), 8000);
      }
    } catch (error) {
      setExportStatus({ error: String(error) });
      window.setTimeout(() => setExportStatus(null), 6000);
    }
  }

  return (
    <div className="flex flex-col h-full background-bg-panel overflow-hidden">
      <div className="shrink-0 px-3 py-2 border-b border-border-panel bg-bg-titlebar">
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-text-primary truncate">
              {taskDescription || 'Mission'}
            </p>
            {currentMissionId && (
              <p className="text-[10px] text-text-muted truncate">
                Mission {currentMissionId}
              </p>
            )}
          </div>
          <button
            onClick={exportLog}
            title="Export workflow log"
            className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-muted hover:text-text-primary hover:background-bg-surface border border-transparent hover:border-border-panel transition-colors shrink-0"
          >
            <Download size={10} />
            Export Log
          </button>
        </div>
        {exportStatus && (
          <div className={`text-[10px] px-2 py-1 rounded mb-2 ${
            'path' in exportStatus
              ? 'bg-green-400/10 text-green-400 border border-green-400/20'
              : 'bg-red-400/10 text-red-400 border border-red-400/20'
          }`}>
            {'path' in exportStatus
              ? `Log saved: ${exportStatus.path}`
              : `Export failed: ${exportStatus.error}`}
          </div>
        )}

        <div className="flex flex-col gap-2">
          {executionLayers.length > 0 ? executionLayers.map((layer, idx) => (
            <div key={layer.join(':')} className="flex items-center gap-2 flex-wrap">
              <span className="text-[9px] uppercase tracking-wide text-text-muted min-w-[44px]">
                Layer {idx + 1}
              </span>
              <div className="flex items-center flex-wrap gap-1">
                {layer.map(nodeId => {
                  const agent = orderedAgents.find(entry => entry.nodeId === nodeId);
                  return agent ? (
                    <AgentBadge key={nodeId} agent={agent} onOpenTerminal={openTerminal} />
                  ) : (
                    <span
                      key={nodeId}
                      className="text-[10px] px-2 py-1 rounded-md border border-border-panel background-bg-surface text-text-muted"
                    >
                      {nodeId}
                    </span>
                  );
                })}
              </div>
            </div>
          )) : (
            <div className="flex items-center flex-wrap gap-1">
              {orderedAgents.map(agent => (
                <AgentBadge key={agent.terminalId} agent={agent} onOpenTerminal={openTerminal} />
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="flex items-center border-b border-border-panel shrink-0 px-3 gap-1 h-8">
        <button
          onClick={() => setTab('nodes')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'nodes' ? 'background-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <TerminalSquare size={11} />
          Nodes
          <span className="text-[9px] background-bg-surface text-text-muted border border-border-panel rounded-full px-1 leading-4">
            {orderedAgents.length}
          </span>
        </button>
        <button
          onClick={() => setTab('preview')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'preview' ? 'background-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <Monitor size={11} />
          Preview
          {previewUrl && <span className="w-1.5 h-1.5 rounded-full bg-green-400" />}
        </button>
        <button
          onClick={() => setTab('output')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'output' ? 'background-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <FileText size={11} />
          Output
          {markdownEntries.length > 0 && (
            <span className="text-[9px] bg-accent-primary text-accent-text rounded-full px-1 leading-4">
              {markdownEntries.length}
            </span>
          )}
        </button>
        <button
          onClick={() => setTab('tasks')}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${
            tab === 'tasks' ? 'background-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'
          }`}
        >
          <ListTree size={11} />
          Tasks
          {allTasks.length > 0 && (
            <span className="text-[9px] background-bg-surface text-text-muted border border-border-panel rounded-full px-1 leading-4">
              {allTasks.length}
            </span>
          )}
        </button>
      </div>

      {tab === 'nodes' && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          <HandoffTimeline entries={handoffTimeline} />
          {orderedAgents.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted px-6 text-center">
              <TerminalSquare size={28} className="opacity-20" />
              <p className="text-xs opacity-40">
                Node runtime details appear here after a mission is staged.
              </p>
            </div>
          ) : (
            orderedAgents.map(agent => (
              <NodeCard
                key={`${agent.nodeId ?? agent.terminalId}`}
                agent={agent}
                onOpenTerminal={openTerminal}
              />
            ))
          )}
        </div>
      )}

      {tab === 'preview' && (
        <div className="flex-1 overflow-hidden relative">
          {!previewUrl ? (
            <div className="absolute inset-0 flex flex-col items-center justify-center gap-3 text-text-muted px-6 text-center">
              <Monitor size={28} className="opacity-20" />
              <p className="text-xs opacity-40">
                Waiting for a preview URL. An agent can call{' '}
                <code className="font-mono text-accent-primary">publish_result</code> with{' '}
                <code className="font-mono">type="url"</code> and a localhost address to show it here.
              </p>
            </div>
          ) : (
            <iframe
              src={previewUrl}
              className="w-full h-full border-0"
              title="Dev server preview"
              sandbox="allow-scripts allow-same-origin allow-forms allow-popups"
            />
          )}
        </div>
      )}

      {tab === 'output' && (
        <div ref={outputRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 font-mono text-xs">
          {runOutput.length === 0 && markdownEntries.length === 0 ? (
            <div className="flex flex-col items-center justify-center h-full gap-3 text-text-muted">
              <FileText size={28} className="opacity-20" />
              <p className="text-xs opacity-40 text-center px-4">
                Headless run output and agent summaries will appear here.
              </p>
            </div>
          ) : (
            <>
            {runOutput.map(line => (
              <div key={line.id} className="border border-border-panel rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 background-bg-surface border-b border-border-panel">
                  <ChevronRight size={10} className={line.stream === 'stderr' ? 'text-red-400' : 'text-accent-primary'} />
                  <span className={line.stream === 'stderr' ? 'text-red-300 font-semibold' : 'text-accent-primary font-semibold'}>
                    {line.nodeId} {line.stream}
                  </span>
                  <span className="text-text-muted opacity-50 ml-auto text-[10px]">
                    {new Date(line.at).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
                <pre className="px-3 py-2 text-text-secondary whitespace-pre-wrap break-words leading-relaxed text-[11px]">
                  {line.chunk}
                </pre>
              </div>
            ))}
            {markdownEntries.map(entry => (
              <div key={entry.id} className="border border-border-panel rounded-md overflow-hidden">
                <div className="flex items-center gap-2 px-3 py-1.5 background-bg-surface border-b border-border-panel">
                  <ChevronRight size={10} className="text-accent-primary" />
                  <span className="text-accent-primary font-semibold">{entry.agentId}</span>
                  <span className="text-text-muted opacity-50 ml-auto text-[10px]">
                    {new Date(entry.timestamp).toLocaleTimeString([], {
                      hour: '2-digit',
                      minute: '2-digit',
                      second: '2-digit',
                    })}
                  </span>
                </div>
                <div className="px-3 py-2 text-text-secondary whitespace-pre-wrap break-words leading-relaxed text-[11px] prose prose-invert max-w-none prose-sm prose-pre:background-bg-panel prose-pre:border prose-pre:border-border-panel">
                  <ReactMarkdown>{entry.content}</ReactMarkdown>
                </div>
              </div>
            ))}
            </>
          )}
        </div>
      )}

      {tab === 'tasks' && (
        <TaskTreePanel tasks={allTasks} />
      )}
    </div>
  );
}

const STATUS_STYLES: Record<string, string> = {
  todo: 'text-text-muted border-border-panel background-bg-surface',
  'in-progress': 'text-accent-primary border-accent-primary/30 bg-accent-primary/10',
  done: 'text-green-400 border-green-400/30 bg-green-400/10',
  blocked: 'text-red-400 border-red-400/30 bg-red-400/10',
};

function TaskRow({ task, depth }: { task: DbTask & { children?: DbTask[] }; depth: number }) {
  const statusStyle = STATUS_STYLES[task.status] ?? STATUS_STYLES.todo;
  return (
    <>
      <div
        className="flex items-start gap-2 py-1.5 border-b border-border-panel/40 last:border-0 hover:background-bg-surface/40 transition-colors px-3"
        style={{ paddingLeft: `${12 + depth * 16}px` }}
      >
        {depth > 0 && <span className="text-text-muted opacity-30 shrink-0 mt-0.5">↳</span>}
        <span className="flex-1 text-[11px] text-text-secondary leading-snug">{task.title}</span>
        <div className="flex items-center gap-1.5 shrink-0">
          {task.agent_id && (
            <span className="text-[9px] text-text-muted opacity-50 font-mono">{task.agent_id}</span>
          )}
          <span className={`text-[10px] font-semibold uppercase tracking-wide px-2 py-1 rounded border ${statusStyle}`}>
            {task.status}
          </span>
        </div>
      </div>
      {task.children?.map(child => (
        <TaskRow key={child.id} task={child as DbTask & { children?: DbTask[] }} depth={depth + 1} />
      ))}
    </>
  );
}

function TaskTreePanel({ tasks }: { tasks: DbTask[] }) {
  if (tasks.length === 0) {
    return (
      <div className="flex-1 flex flex-col items-center justify-center gap-3 text-text-muted">
        <ListTree size={28} className="opacity-20" />
        <p className="text-xs opacity-40 text-center px-4">
          Delegated tasks appear here. A Coordinator can call{' '}
          <code className="text-accent-primary">delegate_task</code> to create subtasks, then{' '}
          <code className="text-accent-primary">assign_task_by_requirements</code> to pick the best worker by capabilities.
        </p>
      </div>
    );
  }

  const map: Record<number, DbTask & { children: DbTask[] }> = {};
  const roots: Array<DbTask & { children: DbTask[] }> = [];
  for (const task of tasks) map[task.id] = { ...task, children: [] };
  for (const task of tasks) {
    if (task.parent_id !== null && map[task.parent_id]) {
      map[task.parent_id].children.push(map[task.id]);
    } else {
      roots.push(map[task.id]);
    }
  }

  return (
    <div className="flex-1 overflow-y-auto">
      {roots.map(task => (
        <TaskRow key={task.id} task={task} depth={0} />
      ))}
    </div>
  );
}
