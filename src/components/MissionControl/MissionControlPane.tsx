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
import { normalizeRuntimeCli } from '../../lib/runtimeBootstrap';
import { useMissionSnapshot } from '../../hooks/useMissionSnapshot';
import { missionOrchestrator } from '../../lib/workflow/MissionOrchestrator';

type MissionTab = 'nodes' | 'preview' | 'output' | 'tasks';

const RUNTIME_ACTIVE_STATES = new Set<MissionAgent['status']>([
  'launching',
  'connecting',
  'spawning',
  'waiting_auth',
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

function NodeCard({
  agent,
  missionId,
  onOpenTerminal,
}: {
  agent: MissionAgent;
  missionId: string | null;
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
          {agent.status === 'failed' && missionId && agent.nodeId && (
            <button
              type="button"
              onClick={() => missionOrchestrator.retryNode(missionId, agent.nodeId!)}
              className="flex items-center gap-1 px-2 py-1 rounded text-[10px] text-amber-400 hover:text-amber-300 hover:background-bg-panel border border-amber-500/30 transition-colors"
            >
              <Clock size={11} />
              Retry
            </button>
          )}
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
              {summarizeHandoffPayload(agent.lastPayload, 120) ?? 'No preview'}
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

function MissionSummary({ missionId }: { missionId: string }) {
  const snapshot = useMissionSnapshot(missionId);
  if (!snapshot) return null;

  const isTerminal = snapshot.status === 'completed' || snapshot.status === 'approved' || snapshot.status === 'failed' || snapshot.status === 'cancelled';
  if (!isTerminal && snapshot.status !== 'active' && snapshot.status !== 'running') return null;

  const qgRejected = snapshot.recentEvents?.find(e => e.eventType === 'quality_gate_rejected');
  const qgApproved = snapshot.recentEvents?.find(e => e.eventType === 'mission_approved');

  return (
    <div className={`border rounded-lg p-4 mb-4 ${
      snapshot.status === 'approved' || qgApproved ? 'bg-green-500/10 border-green-500/30' :
      qgRejected ? 'bg-red-500/10 border-red-500/30' :
      'bg-accent-primary/5 border-border-panel'
    }`}>
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          {snapshot.status === 'approved' || qgApproved ? (
            <CheckCircle2 size={18} className="text-green-400" />
          ) : qgRejected ? (
            <AlertCircle size={18} className="text-red-400" />
          ) : (
            <Loader2 size={18} className="animate-spin text-accent-primary" />
          )}
          <span className="text-sm font-bold uppercase tracking-tight text-text-primary">
            Mission Status: {snapshot.status.toUpperCase()}
          </span>
        </div>
        <div className="text-[10px] text-text-muted font-mono">
          {snapshot.missionId}
        </div>
      </div>

      {qgRejected && (
        <div className="mt-3 p-3 rounded bg-red-500/5 border border-red-500/10">
          <p className="text-xs font-bold text-red-300 mb-1">Quality Gate Rejected</p>
          <p className="text-[11px] text-red-200/70 leading-relaxed">
            {qgRejected.message}
          </p>
        </div>
      )}

      {qgApproved && (
        <div className="mt-3 p-3 rounded bg-green-500/5 border border-green-500/10">
          <p className="text-xs font-bold text-green-300 mb-1">Quality Gate Passed</p>
          <p className="text-[11px] text-red-200/70 leading-relaxed">
            Mission has been verified against all acceptance criteria.
          </p>
        </div>
      )}
      
      {!qgRejected && !qgApproved && isTerminal && snapshot.status !== 'approved' && (
          <p className="text-[11px] text-text-muted mt-2 italic">
              Awaiting final quality review...
          </p>
      )}
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
  const outputRef = useRef<HTMLDivElement>(null);

  const orderedAgents = useMemo(() => {
    if (executionLayers.length === 0) return agents;
    const byNodeId = new Map(agents.filter(agent => agent.nodeId).map(agent => [agent.nodeId as string, agent]));
    const ordered: MissionAgent[] = [];
    for (const layer of executionLayers) {
      for (const nodeId of layer) {
        const agent = byNodeId.get(nodeId);
        if (agent) { ordered.push(agent); byNodeId.delete(nodeId); }
      }
    }
    for (const agent of agents) { if (!ordered.includes(agent)) ordered.push(agent); }
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
    }).then(fn => { if (unmounted) fn(); else unlistenSpawnFn = fn; });

    listen<{ id: string }>('pty-exit', async (event) => {
      if (unmounted) return;
      const exitedId = event.payload.id;

      try {
        const stillAlive = await invoke<boolean>('is_pty_active', { id: exitedId });
        if (stillAlive) return;
      } catch { /* ignore */ }

      const liveAgents = readAgentsForPane(pane.id, agents);
      const target = liveAgents.find(agent => agent.terminalId === exitedId);
      if (!target) return;

      const reason = 'Terminal process exited; runtime session disconnected.';
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
    }).then(fn => { if (unmounted) fn(); else unlistenExitFn = fn; });

    return () => {
      unmounted = true;
      if (unlistenSpawnFn) unlistenSpawnFn();
      if (unlistenExitFn) unlistenExitFn();
    };
  }, [agents, pane.id, setNodeRuntimeBinding, updatePaneData]);

  useEffect(() => {
    let unlistenActivationFn: (() => void) | undefined;
    let unlistenUpdateFn: (() => void) | undefined;
    let unlistenWarningFn: (() => void) | undefined;
    let unmounted = false;

    const processActivation = async (payload: RuntimeActivationPayload, missionId: string, nodeId: string, attempt: number) => {
      if (unmounted) return;
      if (currentMissionId && currentMissionId !== missionId) return;

      const now = Date.now();
      const cli = normalizeRuntimeCli(payload.cliType);
      const nextAgents = readAgentsForPane(pane.id, agents).map(agent => {
        if (agent.nodeId !== nodeId) return agent;
        return {
          ...agent, status: 'activation_pending' as const, attempt, startedAt: now,
          lastPayload: payload.inputPayload ?? null, runtimeSessionId: payload.sessionId, runtimeCli: cli, executionMode: payload.executionMode, activeRunId: payload.runId,
          attemptHistory: upsertAttemptHistory(agent.attemptHistory, attempt, { attempt, status: 'activation_pending', startedAt: now, payloadPreview: summarizeHandoffPayload(payload.inputPayload ?? null, 120) }),
        };
      });
      updatePaneData(pane.id, { agents: nextAgents });
      setNodeRuntimeBinding(nodeId, { terminalId: payload.terminalId, runtimeSessionId: payload.sessionId, adapterStatus: 'activation_pending' });
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
      processActivation(payload, missionId, nodeId, attempt);
    }).then(fn => { if (unmounted) fn(); else unlistenActivationFn = fn; });

    listen<{ nodeId: string; missionId: string; message: string }>('workflow-runtime-warning', (event) => {
      if (unmounted) return;
      const { nodeId, missionId, message } = event.payload;
      if (currentMissionId && currentMissionId !== missionId) return;
      const nextAgents = readAgentsForPane(pane.id, agents).map(agent =>
        agent.nodeId === nodeId ? { ...agent, lastError: message, runtimeBootstrapReason: message } : agent
      );
      updatePaneData(pane.id, { agents: nextAgents });
    }).then(fn => { unlistenWarningFn = fn; if (unmounted) fn(); });

    listen<{ id: string; status: string; attempt?: number; outcome?: 'success' | 'failure'; reason?: string }>('workflow-node-update', (event) => {
      if (unmounted) return;
      const { id: nodeId, status, attempt, outcome, reason } = event.payload;
      const liveAgents = readAgentsForPane(pane.id, agents);
      const now = Date.now();

      const nextAgents = liveAgents.map(agent => {
        if (agent.nodeId !== nodeId) return agent;
        const nextStatus = status as MissionAgent['status'];
        const isTerminalState = nextStatus === 'done' || nextStatus === 'completed' || nextStatus === 'failed' || nextStatus === 'unbound' || nextStatus === 'disconnected';
        return {
          ...agent, status: nextStatus, attempt: attempt ?? agent.attempt,
          startedAt: (nextStatus === 'running' || nextStatus === 'launching') ? (agent.startedAt ?? now) : agent.startedAt,
          completedAt: isTerminalState ? now : agent.completedAt,
          lastOutcome: outcome ?? agent.lastOutcome,
          lastError: (nextStatus === 'failed' || nextStatus === 'unbound' || nextStatus === 'disconnected') ? (reason ?? agent.lastError ?? 'Runtime activation failed.') : reason ?? null,
          attemptHistory: (attempt ?? 0) > 0 ? upsertAttemptHistory(agent.attemptHistory, attempt!, { attempt: attempt!, status: nextStatus, startedAt: (nextStatus === 'running' || nextStatus === 'launching') ? (agent.startedAt ?? now) : undefined, completedAt: isTerminalState ? now : undefined, outcome: outcome ?? undefined }) : agent.attemptHistory,
        };
      });
      updatePaneData(pane.id, { agents: nextAgents });
      const updatedAgent = nextAgents.find(agent => agent.nodeId === nodeId);
      setNodeRuntimeBinding(nodeId, { terminalId: updatedAgent?.terminalId, runtimeSessionId: updatedAgent?.runtimeSessionId ?? null, adapterStatus: status as MissionAgent['status'] });
    }).then(fn => { if (unmounted) fn(); else unlistenUpdateFn = fn; });

    return () => {
      unmounted = true;
      if (unlistenActivationFn) unlistenActivationFn();
      if (unlistenUpdateFn) unlistenUpdateFn();
      if (unlistenWarningFn) unlistenWarningFn();
    };
  }, [agents, currentMissionId, pane.id, setNodeRuntimeBinding, updatePaneData]);

  const markdownEntries = results.filter(entry => entry.type === 'markdown');

  return (
    <div className="flex flex-col h-full background-bg-panel overflow-hidden">
      <div className="shrink-0 px-3 py-2 border-b border-border-panel bg-bg-titlebar">
        <div className="flex items-center justify-between mb-1.5 gap-2">
          <div className="min-w-0">
            <p className="text-[11px] font-semibold text-text-primary truncate">{taskDescription || 'Mission'}</p>
            {currentMissionId && <p className="text-[10px] text-text-muted truncate">Mission {currentMissionId}</p>}
          </div>
          <button className="flex items-center gap-1 px-2 py-0.5 rounded text-[10px] text-text-muted hover:text-text-primary hover:background-bg-surface border border-transparent hover:border-border-panel transition-colors shrink-0">
            <Download size={10} /> Export Log
          </button>
        </div>
      </div>

      <div className="flex items-center border-b border-border-panel shrink-0 px-3 gap-1 h-8">
        <button onClick={() => setTab('nodes')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === 'nodes' ? 'background-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}><TerminalSquare size={11} /> Nodes</button>
        <button onClick={() => setTab('preview')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === 'preview' ? 'background-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}><Monitor size={11} /> Preview</button>
        <button onClick={() => setTab('output')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === 'output' ? 'background-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}><FileText size={11} /> Output</button>
        <button onClick={() => setTab('tasks')} className={`flex items-center gap-1.5 px-2.5 py-1 rounded text-[11px] font-medium transition-colors ${tab === 'tasks' ? 'background-bg-surface text-text-primary' : 'text-text-muted hover:text-text-secondary'}`}><ListTree size={11} /> Tasks</button>
      </div>

      {tab === 'nodes' && (
        <div className="flex-1 overflow-y-auto px-3 py-3 space-y-3">
          {currentMissionId && <MissionSummary missionId={currentMissionId} />}
          <HandoffTimeline entries={handoffTimeline} />
          {orderedAgents.map(agent => (
            <NodeCard key={`${agent.nodeId ?? agent.terminalId}`} agent={agent} missionId={currentMissionId} onOpenTerminal={openTerminal} />
          ))}
        </div>
      )}

      {tab === 'output' && (
        <div ref={outputRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 font-mono text-xs text-text-secondary">
          {markdownEntries.map(entry => (
            <div key={entry.id} className="prose prose-invert max-w-none p-3 border border-border-panel rounded-md">
              <ReactMarkdown>{entry.content}</ReactMarkdown>
            </div>
          ))}
        </div>
      )}

      {tab === 'tasks' && <TaskTreePanel tasks={allTasks} />}
    </div>
  );
}

function TaskRow({ task, depth }: { task: DbTask & { children?: DbTask[] }; depth: number }) {
  return (
    <div className="py-1.5 border-b border-border-panel/40 px-3" style={{ paddingLeft: `${12 + depth * 16}px` }}>
      <span className="text-[11px] text-text-secondary">{task.title}</span>
      <span className="ml-2 text-[10px] text-accent-primary uppercase font-bold">{task.status}</span>
      {task.children?.map(child => <TaskRow key={child.id} task={child as any} depth={depth + 1} />)}
    </div>
  );
}

function TaskTreePanel({ tasks }: { tasks: DbTask[] }) {
  const roots = tasks.filter(t => t.parent_id === null);
  return (
    <div className="flex-1 overflow-y-auto">
      {roots.map(task => <TaskRow key={task.id} task={task as any} depth={0} />)}
    </div>
  );
}
