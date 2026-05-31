import { useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react';
import {
  Pane,
  MissionAgent,
  MissionAttemptRecord,
  DbTask,
  useWorkspaceStore,
  type CompiledMission,
} from '../../store/workspace';
import {
  PUBLIC_AGENT_ROLES,
  getPublicAgentRole,
  getPublicRoleForWorkflowRole,
  getWorkflowAgentRole,
} from '../../config/agentRoles';
import {
  Monitor,
  FileText,
  ChevronRight,
  ChevronDown,
  Loader2,
  CheckCircle2,
  Clock,
  ListTree,
  TerminalSquare,
  AlertCircle,
  Paperclip,
  Plus,
  RefreshCw,
  Square,
  Play,
  ArrowUp,
  Eraser,
  Minimize2,
  Maximize2,
  Bot,
  X,
  Search,
  Network,
  Hammer,
  FlaskConical,
  Shield,
  Eye,
  ClipboardList,
  ListChecks,
  Palette,
  Layers,
  Code2,
  Hand,
  MousePointerClick,
  Accessibility,
  Sparkles,
  Folder,
  FolderPlus,
  Globe2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { emit, listen } from '@tauri-apps/api/event';
import {
  summarizeHandoffPayload,
  type StructuredCompletionPayload,
  type RuntimeActivationPayload,
} from '../../lib/missionRuntime';
import { workflowStatusLabel, workflowStatusTone } from '../../lib/workflowStatus';
import { normalizeRuntimeCli } from '../../lib/runtimeBootstrap';
import { useMissionSnapshot } from '../../hooks/useMissionSnapshot';
import { useWorkflowEvents } from '../../hooks/useWorkflowEvents';
import { deriveMissionProgressRows, type MissionProgressRow } from '../../lib/missionProgress';
import { discoverModelsForCli, supportsModelDiscovery } from '../../lib/models/modelDiscoveryService';
import type { CliId, CliModel } from '../../lib/models/modelTypes';
import { runtimeManager } from '../../lib/runtime/RuntimeManager';
import type { RuntimeManagerSnapshot, RuntimeSessionState } from '../../lib/runtime/RuntimeTypes';
import { generateId } from '../../lib/graphUtils';
import { missionRepository } from '../../lib/missionRepository';
import {
  buildAgentConversationContext,
  classifyAgentStatusMessage,
  compactAgentConversation,
  runtimeStepLabel,
  splitAgentContent,
  type AgentOutputStatusIcon,
  type AgentStatusKind,
  type AgentTodoItem,
} from '../../lib/agentChatFormatting';
import { isModelCompatibleWithCli } from '../../lib/cliCommandBuilders';
import {
  OPENAI_SDK_CONFIG_CHANGED_EVENT,
  getConfiguredOpenAiBaseUrl,
  getConfiguredOpenAiApiKey,
  getStoredOpenAiApiKey,
  createSdkUserContent,
  formatSdkAppActionResultContent,
  formatSdkAttachmentContext,
  formatSdkCommandSuggestionContent,
  formatSdkUsageSummary,
  extractSdkCommandExitCode,
  formatSdkTodoWriteContent,
  inferSdkImageMediaType,
  normalizeOpenAiSdkModel,
  readSdkWorkspaceTextFile,
  runSdkChat,
  type SdkAppActionResultContent,
  type SdkChatAttachmentContextItem,
  type SdkChatArtifact,
  type SdkChatCommandEvent,
  type SdkChatFinishMeta,
  type SdkChatImageAttachment,
  type SdkChatMessage,
  type SdkChatTerminalContext,
  type SdkChatTodoEvent,
  type SdkChatToolEvent,
  type SdkChatUsageDelta,
} from '../../lib/sdkChat';
import {
  CHANGE_REVIEW_APPLIED_EVENT,
  formatChangeReviewAppliedActionContent,
  type ChangeReviewAppliedEvent,
} from '../../lib/changeReviewEvents';
import {
  runCodexCliJson,
  type CodexCliJsonToolEvent,
} from '../../lib/codexCliJsonTransport';
import { detectSdkTerminalPlatform, formatSdkTerminalRunCommand } from '../../lib/sdkCommandMarkers';
import {
  buildSdkCardResolutionMap,
  buildSdkArtifactToolMessageFields,
  buildSdkFollowUpMessagesForRun,
  buildSdkCommandCompletionResult,
  buildSdkDeniedActionResult,
  followUpToolMessageHasInteractiveSdkContent,
  getSdkAutoContinueFlushPrompt,
  resolveSdkCardResolution,
  shouldSuppressEmptySdkAssistantMessage,
  shouldQueueSdkAutoContinue,
  type SdkCardResolution,
} from '../../lib/sdkChatUiLifecycle';
import { terminalOutputBus } from '../../lib/runtime/TerminalOutputBus';
import { FileTypeIcon } from '../../lib/fileIcons';
import { normalizeFileTreeEntries, type FileTreeEntry } from '../../lib/fileTreeEntries';
import { dirname, joinWorkspacePath, normalizeWorkspacePath, relativeWorkspacePath } from '../../lib/workspacePaths';

type MissionTab = 'nodes' | 'preview' | 'output' | 'tasks';
type DbTaskTree = DbTask & { children?: DbTaskTree[] };
type FollowUpRole = 'user' | 'agent' | 'system' | 'tool';
type FollowUpSessionPolicy = 'new' | 'wait' | 'queue';
type FollowUpCardActionOptions = {
  autoContinue?: boolean;
  continuePrompt?: string;
};
type FollowUpSubmitOptions = {
  internal?: boolean;
};
type FollowUpContextKind = 'file' | 'folder';

interface FollowUpMessage {
  id: string;
  missionId: string;
  runId?: string;
  role: FollowUpRole;
  cli?: string;
  model?: string;
  runtimeSessionId?: string;
  content: string;
  attachments?: Array<{ id: string; kind: 'file' | 'image'; name: string; path?: string }>;
  artifactIds?: string[];
  filePaths?: string[];
  status?: 'queued' | 'sending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
}

interface FollowUpPendingItem {
  id: string;
  messageId: string;
  prompt: string;
  attachments: Array<{ id: string; kind: 'file' | 'image'; name: string; path?: string }>;
  policy: FollowUpSessionPolicy;
  createdAt: number;
}

interface CliSkill {
  id: string;
  name: string;
  description?: string | null;
  sourcePath?: string | null;
}

interface CliCapabilityDiscovery {
  cli: CliId;
  models: CliModel[];
  skills: CliSkill[];
  warnings: string[];
}

const FOLLOW_UP_CLIS: CliId[] = ['claude', 'codex', 'gemini', 'opencode'];
const OPENAI_SDK_MODELS: CliModel[] = [
  { cli: 'codex', id: 'gpt-5.5', label: 'GPT-5.5', provider: 'openai', source: 'default', canLaunch: true },
  { cli: 'codex', id: 'gpt-5.4', label: 'GPT-5.4', provider: 'openai', source: 'default', canLaunch: true },
  { cli: 'codex', id: 'gpt-5.3', label: 'GPT-5.3', provider: 'openai', source: 'default', canLaunch: true },
  { cli: 'codex', id: 'gpt-5.2', label: 'GPT-5.2', provider: 'openai', source: 'default', canLaunch: true },
  { cli: 'codex', id: 'gpt-5.1', label: 'GPT-5.1', provider: 'openai', source: 'default', canLaunch: true },
  { cli: 'codex', id: 'gpt-5-mini', label: 'GPT-5 Mini', provider: 'openai', source: 'default', canLaunch: true },
  { cli: 'codex', id: 'gpt-4.1-mini', label: 'GPT-4.1 Mini', provider: 'openai', source: 'default', canLaunch: true },
];

function mergeCodexModels(discovered: CliModel[]): CliModel[] {
  const byId = new Map<string, CliModel>();
  for (const model of discovered) byId.set(model.id.toLowerCase(), model);
  for (const model of OPENAI_SDK_MODELS) {
    if (!byId.has(model.id.toLowerCase())) byId.set(model.id.toLowerCase(), model);
  }
  return Array.from(byId.values());
}

const MODEL_ACRONYMS = new Set(['api', 'cli', 'cpu', 'css', 'gpu', 'gpt', 'html', 'js', 'json', 'llm', 'mcp', 'sql', 'tts', 'ui', 'xml']);
type FollowUpSelectOption = { value: string; label: string; description?: string; icon?: ReactNode; showDescription?: boolean };
type FollowUpPermissionMode = 'default' | 'full' | 'restricted';
const FOLLOW_UP_CONTEXT_CHAR_BUDGET = 60000;
const FOLLOW_UP_STARTERS = [
  {
    label: 'Review current work',
    description: 'Find the next useful fix',
    prompt: 'Review the current workspace state and tell me the most important next fix.',
    icon: <AlertCircle size={14} />,
  },
  {
    label: 'Plan a change',
    description: 'Turn an idea into steps',
    prompt: 'Help me turn the next change into a tight implementation plan before editing.',
    icon: <TerminalSquare size={14} />,
  },
  {
    label: 'Find risks',
    description: 'Check bugs and test gaps',
    prompt: 'Look for likely bugs, missing tests, or risky assumptions in the current app.',
    icon: <Shield size={14} />,
  },
  {
    label: 'Improve the editor',
    description: 'Suggest IDE-like upgrades',
    prompt: 'Inspect the editor experience and suggest the highest-impact IDE-like improvements.',
    icon: <Code2 size={14} />,
  },
];

function formatTitleToken(value: string): string {
  if (!value) return value;
  return value
    .split(/([\s._:/-]+)/)
    .map(part => /^[a-z]/.test(part) ? `${part.charAt(0).toUpperCase()}${part.slice(1)}` : part)
    .join('');
}

function formatFollowUpCliLabel(cli: CliId): string {
  if (cli === 'codex') return 'Codex';
  return formatTitleToken(cli);
}

function formatModelLabel(value: string): string {
  if (!value) return value;
  return value
    .split(/([\s._:/-]+)/)
    .map(part => MODEL_ACRONYMS.has(part.toLowerCase()) ? part.toUpperCase() : formatTitleToken(part))
    .join('');
}

function iconForAgentRole(roleId: string): ReactNode {
  const iconProps = { size: 13, strokeWidth: 1.8 };
  switch (roleId) {
    case 'research':
    case 'scout':
      return <Search {...iconProps} />;
    case 'reasoning':
    case 'coordinator':
      return <Network {...iconProps} />;
    case 'code':
    case 'builder':
      return <Hammer {...iconProps} />;
    case 'tester':
      return <FlaskConical {...iconProps} />;
    case 'security':
      return <Shield {...iconProps} />;
    case 'review':
    case 'reviewer':
      return <Eye {...iconProps} />;
    case 'frontend_product':
      return <ClipboardList {...iconProps} />;
    case 'design':
    case 'frontend_designer':
      return <Palette {...iconProps} />;
    case 'frontend_architect':
      return <Layers {...iconProps} />;
    case 'frontend_builder':
      return <Code2 {...iconProps} />;
    case 'interaction_qa':
      return <MousePointerClick {...iconProps} />;
    case 'accessibility_reviewer':
      return <Accessibility {...iconProps} />;
    case 'visual_polish_reviewer':
      return <Sparkles {...iconProps} />;
    default:
      return <Bot {...iconProps} />;
  }
}

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
  onOpenTerminal,
}: {
  agent: MissionAgent;
  onOpenTerminal: (agent: MissionAgent) => void;
}) {
  const workflowRole = getWorkflowAgentRole(agent.roleId);
  const publicRole = getPublicRoleForWorkflowRole(agent.roleId);
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
            Role: {publicRole.name}{workflowRole ? ` · Node: ${workflowRole.name}` : ''}
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
            <div className="text-[9px] uppercase tracking-wide text-text-muted">Starlink Runtime</div>
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

function ProgressRow({ row, index }: { row: MissionProgressRow; index: number }) {
  const isActive = row.status === 'active';
  const isAttention = row.status === 'blocked' || row.status === 'failed';
  const displayText = row.detail || row.label;
  return (
    <div
      className="td-mission-progress-row mx-auto w-full max-w-[640px] px-4 py-3 text-center"
      style={{ animationDelay: `${Math.min(index, 8) * 120}ms` }}
    >
      <div className={`td-mission-progress-copy text-lg font-semibold leading-snug break-words ${isAttention ? 'text-amber-100' : 'text-white'}`}>
        {displayText}
      </div>
      <div className="td-mission-progress-track mx-auto mt-4 h-1.5 w-full max-w-[460px] overflow-hidden rounded-full bg-white/10">
        <div
          className={`${isActive ? 'td-mission-progress-bar' : ''} h-full rounded-full ${isActive ? 'bg-white' : row.status === 'completed' ? 'bg-emerald-300/90' : isAttention ? 'bg-amber-200/90' : 'bg-white/45'}`}
          style={{ width: `${row.percent}%` }}
        />
      </div>
      {row.attention && <div className="mt-2 text-[11px] text-amber-200 break-words">{row.attention}</div>}
    </div>
  );
}

function ProgressReport({ rows, missionTitle }: { rows: MissionProgressRow[]; missionTitle: string }) {
  const visibleRows = rows.filter(row => row.detail || row.status === 'completed' || row.attention);

  return (
    <div className="td-mission-progress-feed flex min-h-full flex-col items-center justify-center px-6 py-10 text-center">
      <div className="td-mission-progress-heading max-w-[720px]">
        <div className="text-[11px] font-semibold uppercase tracking-[0.18em] text-accent-primary">Mission Running</div>
        <h2 className="mt-2 text-xl font-semibold text-text-primary break-words">{missionTitle || 'Mission'}</h2>
        {visibleRows.length === 0 && (
          <p className="mt-3 text-sm text-text-muted">Waiting for the first agent update...</p>
        )}
      </div>
      <div className="mt-7 w-full space-y-3">
        {visibleRows.map((row, index) => <ProgressRow key={row.id} row={row} index={index} />)}
      </div>
    </div>
  );
}

function runtimeStatusFor(snapshot: RuntimeManagerSnapshot, sessionId?: string | null): string {
  if (!sessionId) return 'idle';
  return snapshot.sessions.find(session => session.sessionId === sessionId)?.state ?? 'stale';
}

const FOLLOW_UP_BUSY_STATES = new Set<RuntimeSessionState>([
  'creating',
  'launching_cli',
  'awaiting_cli_ready',
  'waiting_auth',
  'registering_mcp',
  'bootstrap_injecting',
  'bootstrap_sent',
  'awaiting_mcp_ready',
  'injecting_task',
  'awaiting_ack',
  'running',
  'awaiting_permission',
]);

function isFollowUpSessionBusy(state?: RuntimeSessionState | string): boolean {
  return Boolean(state && FOLLOW_UP_BUSY_STATES.has(state as RuntimeSessionState));
}

function finalizeStreamingMessages(
  messages: FollowUpMessage[],
  sessionId: string,
  status: Extract<FollowUpMessage['status'], 'completed' | 'failed' | 'cancelled'>,
): FollowUpMessage[] {
  const completedAt = Date.now();
  return messages.map(message =>
    message.runtimeSessionId === sessionId && message.role === 'agent' && message.status === 'streaming'
      ? { ...message, status, completedAt }
      : message
  );
}

function appendFollowUpMessages(paneId: string, next: FollowUpMessage[]): void {
  const current = readFollowUpMessages(paneId);
  const seen = new Set(current.map(message => message.id));
  useWorkspaceStore.getState().updatePaneData(paneId, {
    followUpMessages: [...current, ...next.filter(message => !seen.has(message.id))].slice(-200),
  });
}

function FollowUpSelect({
  menuId,
  activeMenu,
  setActiveMenu,
  value,
  options,
  onChange,
  title,
  className = '',
  visibleOptions,
  side = 'top',
  align = 'start',
  leadingIcon,
}: {
  menuId: string;
  activeMenu: string | null;
  setActiveMenu: (menuId: string | null) => void;
  value: string;
  options: FollowUpSelectOption[];
  onChange: (value: string) => void;
  title: string;
  className?: string;
  visibleOptions?: number;
  side?: 'top' | 'bottom';
  align?: 'start' | 'end';
  leadingIcon?: ReactNode;
}) {
  const open = activeMenu === menuId;
  const selected = options.find(option => option.value === value);
  const shouldScroll = Boolean(visibleOptions && options.length > visibleOptions);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [popoverStyle, setPopoverStyle] = useState<CSSProperties | undefined>();

  const updatePopoverPosition = () => {
    const rect = triggerRef.current?.getBoundingClientRect();
    if (!rect) return;
    setPopoverStyle({
      left: align === 'end' ? rect.right : rect.left,
      top: side === 'bottom' ? rect.bottom : rect.top,
      width: rect.width,
      '--td-menu-x': align === 'end' ? '-100%' : '0',
      '--td-menu-y': side === 'top' ? '-100%' : '0',
    } as CSSProperties);
  };

  useLayoutEffect(() => {
    if (!open) return;
    updatePopoverPosition();
  }, [open, options.length, side, align]);

  useEffect(() => {
    if (!open) return;
    const handle = () => updatePopoverPosition();
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setActiveMenu(null);
    };
    window.addEventListener('resize', handle);
    window.addEventListener('scroll', handle, true);
    window.addEventListener('keydown', handleKeyDown);
    return () => {
      window.removeEventListener('resize', handle);
      window.removeEventListener('scroll', handle, true);
      window.removeEventListener('keydown', handleKeyDown);
    };
  }, [open, side, align, setActiveMenu]);

  const popover = open ? (
    <div
      className="td-followup-menu-popover"
      data-side={side}
      data-align={align}
      style={popoverStyle}
    >
      <div
        className={`td-followup-menu-scroll ${shouldScroll ? 'is-scrollable' : ''}`}
        style={visibleOptions ? { maxHeight: `${visibleOptions * 32 + 14}px` } : undefined}
      >
        {options.map(option => (
          <button
            key={option.value}
            type="button"
            className={`td-followup-menu-option ${option.value === value ? 'is-selected' : ''}`}
            title={option.description ?? option.label}
            onClick={() => {
              onChange(option.value);
              setActiveMenu(null);
            }}
          >
            {option.icon && <span className="td-followup-menu-option-icon">{option.icon}</span>}
            <span className="td-followup-menu-option-copy">
              <span>{option.label}</span>
              {option.description && option.showDescription !== false && <small>{option.description}</small>}
            </span>
            {option.value === value && <CheckCircle2 size={12} className="td-followup-menu-check" />}
          </button>
        ))}
      </div>
    </div>
  ) : null;
  const triggerLeadingIcon = selected?.icon ?? leadingIcon;

  return (
    <div className={`td-followup-menu relative ${className}`} data-open={open ? 'true' : 'false'} data-side={side}>
      <button
        ref={triggerRef}
        type="button"
        className="td-followup-menu-trigger"
        title={title}
        onClick={() => {
          if (!open) updatePopoverPosition();
          setActiveMenu(open ? null : menuId);
        }}
      >
        {triggerLeadingIcon && <span className="td-followup-menu-leading">{triggerLeadingIcon}</span>}
        <span className="truncate">{selected?.label ?? title}</span>
        <ChevronDown size={12} />
      </button>
      {popover ? createPortal(popover, document.body) : null}
    </div>
  );
}

function pathLeaf(path: string): string {
  return path.replace(/[\\/]+$/g, '').split(/[\\/]/).filter(Boolean).pop() || path;
}

function normalizeDisplayPath(path: string): string {
  return path.replace(/\\/g, '/').replace(/\/+/g, '/');
}

function compactDisplayPath(path: string): string {
  const segments = normalizeDisplayPath(path).split('/').filter(Boolean);
  if (segments.length <= 3) return segments.join('/') || path;
  return `${segments[0]}/.../${segments[segments.length - 2]}/${segments[segments.length - 1]}`;
}

function displayPathForAgentDirectory(targetPath: string | null, workspaceDir: string | null): string {
  const cleanTarget = targetPath?.trim() || workspaceDir?.trim() || '';
  if (!cleanTarget) return 'No workspace';
  const cleanWorkspace = workspaceDir?.trim() || '';
  const workspaceName = cleanWorkspace ? pathLeaf(cleanWorkspace) : '';
  const relative = cleanWorkspace && targetPath ? relativeWorkspacePath(cleanWorkspace, targetPath) : null;
  if (relative !== null) {
    return compactDisplayPath(relative ? `${workspaceName}/${relative}` : workspaceName);
  }
  return compactDisplayPath(cleanTarget);
}

function parseFollowUpContextKind(value: unknown): FollowUpContextKind | null {
  return value === 'file' || value === 'folder' ? value : null;
}

function AgentDirectoryPicker({
  activeFilePath,
  workspaceDir,
  contextPath,
  contextKind,
  activeMenu,
  setActiveMenu,
  runtimeStatus,
  onSelectContext,
}: {
  activeFilePath: string | null;
  workspaceDir: string | null;
  contextPath: string | null;
  contextKind: FollowUpContextKind | null;
  activeMenu: string | null;
  setActiveMenu: (menuId: string | null) => void;
  runtimeStatus: string;
  onSelectContext: (path: string | null, kind: FollowUpContextKind | null) => void;
}) {
  const menuId = 'agent-directory';
  const open = activeMenu === menuId;
  const targetPath = contextPath || activeFilePath || workspaceDir;
  const targetKind = contextPath ? contextKind : activeFilePath ? 'file' : workspaceDir ? 'folder' : null;
  const defaultListPath = targetKind === 'file' && targetPath
    ? dirname(targetPath)
    : targetKind === 'folder' && targetPath
      ? targetPath
      : workspaceDir;
  const [browsePath, setBrowsePath] = useState(defaultListPath ?? '');
  const [entries, setEntries] = useState<FileTreeEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const displayPath = displayPathForAgentDirectory(targetPath, workspaceDir);
  const fullTitle = targetPath
    ? `${targetKind === 'file' ? 'Selected file' : 'Selected folder'}: ${targetPath}`
    : workspaceDir || 'No workspace selected';

  useEffect(() => {
    setBrowsePath(defaultListPath ?? '');
  }, [defaultListPath]);

  useEffect(() => {
    if (!open || !browsePath) {
      setEntries([]);
      setError(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setError(null);
    invoke<unknown>('workspace_read_dir', { path: browsePath })
      .then(result => {
        if (!cancelled) setEntries(normalizeFileTreeEntries(result, { parentPath: browsePath }));
      })
      .catch(err => {
        if (!cancelled) {
          setEntries([]);
          setError(err instanceof Error ? err.message : String(err));
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [browsePath, open]);

  const openEntry = (entry: FileTreeEntry) => {
    const fullPath = joinWorkspacePath(browsePath, entry.name);
    if (entry.isDirectory) {
      setBrowsePath(fullPath);
      return;
    }
    onSelectContext(fullPath, 'file');
    setActiveMenu(null);
  };

  const parentPath = browsePath ? dirname(browsePath) : '';
  const canBrowseParent = Boolean(parentPath && normalizeWorkspacePath(parentPath) !== normalizeWorkspacePath(browsePath));

  return (
    <div className="td-agent-directory-picker">
      <button
        type="button"
        className="td-agent-directory-trigger"
        title={fullTitle}
        aria-label={`${displayPath}. Runtime ${runtimeStatus}`}
        onClick={() => setActiveMenu(open ? null : menuId)}
      >
        <Folder size={13} />
        <span className="td-agent-directory-trigger-label">{displayPath}</span>
        <ChevronDown size={12} />
      </button>
      {open && (
        <div className="td-agent-directory-menu" role="menu" aria-label="Current path files">
          <div className="td-agent-directory-menu-path" title={browsePath}>{displayPathForAgentDirectory(browsePath, workspaceDir)}</div>
          {workspaceDir && normalizeWorkspacePath(browsePath) !== normalizeWorkspacePath(workspaceDir) && (
            <button
              type="button"
              className="td-agent-directory-option"
              role="menuitem"
              onClick={() => setBrowsePath(workspaceDir)}
            >
              <Folder size={13} />
              <span>Workspace root</span>
            </button>
          )}
          {browsePath && (
            <button
              type="button"
              className={`td-agent-directory-option ${targetKind === 'folder' && targetPath && normalizeWorkspacePath(targetPath) === normalizeWorkspacePath(browsePath) ? 'is-selected' : ''}`}
              role="menuitemradio"
              aria-checked={targetKind === 'folder' && targetPath ? normalizeWorkspacePath(targetPath) === normalizeWorkspacePath(browsePath) : false}
              onClick={() => {
                onSelectContext(browsePath, 'folder');
                setActiveMenu(null);
              }}
            >
              <CheckCircle2 size={13} />
              <span>Use this folder</span>
            </button>
          )}
          {contextPath && (
            <button
              type="button"
              className="td-agent-directory-option"
              role="menuitem"
              onClick={() => {
                onSelectContext(null, null);
                setActiveMenu(null);
              }}
            >
              <X size={13} />
              <span>Use active editor/workspace</span>
            </button>
          )}
          {canBrowseParent && (
            <button
              type="button"
              className="td-agent-directory-option"
              role="menuitem"
              onClick={() => setBrowsePath(parentPath)}
            >
              <Folder size={13} />
              <span>..</span>
            </button>
          )}
          {loading && <div className="td-agent-directory-empty">Loading...</div>}
          {error && <div className="td-agent-directory-empty">{error}</div>}
          {!loading && !error && entries.length === 0 && <div className="td-agent-directory-empty">No files</div>}
          {!loading && !error && entries.map(entry => (
            <button
              key={`${entry.isDirectory ? 'dir' : 'file'}:${entry.name}`}
              type="button"
              className="td-agent-directory-option"
              role="menuitem"
              title={entry.name}
              onClick={() => openEntry(entry)}
            >
              {entry.isDirectory
                ? <Folder size={13} className="text-accent-primary" />
                : <FileTypeIcon fileName={entry.name} size={13} className="opacity-85" />}
              <span>{entry.name}</span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function parseFollowUpPermissionMode(value: unknown): FollowUpPermissionMode {
  return value === 'full' || value === 'restricted' ? value : 'default';
}

function permissionModeLabel(mode: FollowUpPermissionMode): string {
  if (mode === 'full') return 'Full access';
  if (mode === 'restricted') return 'Restricted';
  return 'Default';
}

function permissionModeIcon(mode: FollowUpPermissionMode, className = ''): ReactNode {
  if (mode === 'full') return <AlertCircle size={14} className={`td-agent-permission-mode-icon is-full ${className}`} />;
  if (mode === 'restricted') return <Hand size={14} className={`td-agent-permission-mode-icon is-restricted ${className}`} />;
  return <Shield size={14} className={`td-agent-permission-mode-icon is-default ${className}`} />;
}

function permissionModeDescription(mode: FollowUpPermissionMode, cli: CliId, sdkBacked: boolean): string {
  if (sdkBacked) {
    if (mode === 'full') return 'Full workspace tools; writes and commands still show review cards.';
    if (mode === 'restricted') return 'Read-only tools only.';
    return 'Normal SDK tools with review cards for writes and commands.';
  }
  if (mode === 'full') {
    if (cli === 'codex') return 'Codex: --dangerously-bypass-approvals-and-sandbox.';
    if (cli === 'claude') return 'Claude: --dangerously-skip-permissions.';
    if (cli === 'gemini') return 'Gemini: --approval-mode yolo.';
    if (cli === 'opencode') return 'OpenCode: permission allow where supported.';
    return 'Bypass prompts where the selected CLI supports it.';
  }
  if (mode === 'restricted') return 'No bypass flag; prompt asks the runtime to stay read-only and request approval before changes.';
  return 'No bypass flag; use the CLI default permission behavior.';
}

function permissionModeInstruction(mode: FollowUpPermissionMode, cli: CliId, sdkBacked: boolean): string {
  if (mode === 'full') return `Permission mode: full access (${permissionModeDescription(mode, cli, sdkBacked)})`;
  if (mode === 'restricted') return `Permission mode: restricted. Stay read-only unless the user explicitly asks for a change; do not run shell commands or propose file writes without user approval.`;
  return `Permission mode: default (${permissionModeDescription(mode, cli, sdkBacked)})`;
}

function PermissionModePicker({
  cli,
  mode,
  sdkBacked,
  activeMenu,
  setActiveMenu,
  onChange,
  disabled = false,
}: {
  cli: CliId;
  mode: FollowUpPermissionMode;
  sdkBacked: boolean;
  activeMenu: string | null;
  setActiveMenu: (menuId: string | null) => void;
  onChange: (mode: FollowUpPermissionMode) => void;
  disabled?: boolean;
}) {
  const menuId = 'agent-permissions';
  const open = activeMenu === menuId;
  const modes: FollowUpPermissionMode[] = ['default', 'full', 'restricted'];
  return (
    <div className="td-agent-permission-mode">
      <button
        type="button"
        className="td-agent-permission-mode-trigger"
        title={`${permissionModeLabel(mode)} permissions`}
        aria-label={`${permissionModeLabel(mode)} permissions`}
        aria-haspopup="menu"
        aria-expanded={open}
        disabled={disabled}
        onClick={() => setActiveMenu(open ? null : menuId)}
      >
        {permissionModeIcon(mode)}
      </button>
      {open && (
        <div className="td-agent-permission-mode-menu" role="menu" aria-label="Agent permissions">
          {modes.map(option => (
            <button
              key={option}
              type="button"
              role="menuitemradio"
              aria-checked={option === mode}
              className={`td-agent-permission-mode-option ${option === mode ? 'is-selected' : ''}`}
              title={permissionModeDescription(option, cli, sdkBacked)}
              onClick={() => {
                onChange(option);
                setActiveMenu(null);
              }}
            >
              {permissionModeIcon(option)}
              <span className="td-agent-permission-mode-copy">
                <span>{permissionModeLabel(option)}</span>
                <small>{permissionModeDescription(option, cli, sdkBacked)}</small>
              </span>
              {option === mode && <CheckCircle2 size={12} className="td-agent-permission-mode-check" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function FollowUpChatMessage({
  message,
  onCardAction,
  sdkCommandTerminalId,
  onSdkCommandTerminalId,
  cardResolutions,
}: {
  message: FollowUpMessage;
  onCardAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void;
  sdkCommandTerminalId?: string | null;
  onSdkCommandTerminalId?: (terminalId: string) => void;
  cardResolutions?: Map<string, SdkCardResolution>;
}) {
  const hasInteractiveSdkContent = (message.role === 'system' || message.role === 'tool')
    ? followUpToolMessageHasInteractiveSdkContent(message.content)
    : false;
  if ((message.role === 'system' || message.role === 'tool') && !hasInteractiveSdkContent) {
    return <AgentStatusToast message={message} />;
  }

  return (
    <div className={`td-agent-message is-${message.role} ${message.status === 'streaming' ? 'is-streaming' : ''}`}>
      <div className="td-agent-message-meta">
        <span>{message.role === 'user' ? 'You' : 'Agent'}</span>
        {message.cli && <span>{message.cli}</span>}
        {message.status && <span>{message.status}</span>}
      </div>
      {message.attachments && message.attachments.length > 0 && (
        <div className="td-agent-attachment-row">
          {message.attachments.map(attachment => (
            <span key={attachment.id}>{attachment.name}</span>
          ))}
        </div>
      )}
      <AgentMessageContent
        message={message}
        onCardAction={onCardAction}
        sdkCommandTerminalId={sdkCommandTerminalId}
        onSdkCommandTerminalId={onSdkCommandTerminalId}
        cardResolutions={cardResolutions}
      />
    </div>
  );
}

function AgentMessageContent({
  message,
  onCardAction,
  sdkCommandTerminalId,
  onSdkCommandTerminalId,
  cardResolutions,
}: {
  message: FollowUpMessage;
  onCardAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void;
  sdkCommandTerminalId?: string | null;
  onSdkCommandTerminalId?: (terminalId: string) => void;
  cardResolutions?: Map<string, SdkCardResolution>;
}) {
  const content = message.content;
  const blocks = splitAgentContent(content);
  if (blocks.length === 0) return null;
  const resolutionForCard = (index: number, kind: string, fallbackTarget: string): SdkCardResolution | undefined =>
    resolveSdkCardResolution(cardResolutions, {
      cardId: `${message.id}:${index}`,
      kind,
      target: fallbackTarget,
    });
  return (
    <div className="td-agent-message-content">
      {blocks.map((block, index) => (
        block.kind === 'todos'
          ? <AgentTodoCard key={`todo-${index}`} items={block.items} />
          : block.kind === 'command'
            ? <AgentCommandCard
                key={`command-${index}`}
                command={block.command}
                reason={block.reason}
                cwd={block.cwd}
                language={block.language}
                action={block.action}
                sdkCommandTerminalId={sdkCommandTerminalId}
                onSdkCommandTerminalId={onSdkCommandTerminalId}
                onAction={onCardAction}
                cardId={`${message.id}:${index}`}
                resolution={resolutionForCard(index, 'command', block.command)}
              />
          : block.kind === 'patch'
            ? <AgentPatchCard key={`patch-${index}`} title={block.title} path={block.path} patch={block.patch} sourceMessage={message} onAction={onCardAction} cardId={`${message.id}:${index}`} resolution={resolutionForCard(index, 'patch_review', block.path || block.title)} />
          : block.kind === 'directory'
            ? <AgentDirectoryCard key={`directory-${index}`} title={block.title} path={block.path} onAction={onCardAction} cardId={`${message.id}:${index}`} resolution={resolutionForCard(index, 'directory', block.path)} />
          : block.kind === 'preview'
            ? <AgentPreviewCard key={`preview-${index}`} title={block.title} url={block.url} onAction={onCardAction} cardId={`${message.id}:${index}`} resolution={resolutionForCard(index, 'preview', block.url)} />
          : block.kind === 'terminal_stop'
            ? <AgentTerminalStopCard key={`terminal-stop-${index}`} title={block.title} terminalId={block.terminalId} reason={block.reason} onAction={onCardAction} cardId={`${message.id}:${index}`} resolution={resolutionForCard(index, 'terminal_stop', block.terminalId)} />
          : block.kind === 'action_result'
            ? <AgentActionResultCard key={`action-result-${index}`} actionKind={block.actionKind} status={block.status} target={block.target} title={block.title} command={block.command} cwd={block.cwd} action={block.action} terminalId={block.terminalId} error={block.error} />
          : block.kind === 'status'
            ? <AgentOutputStatusCard key={`status-${index}`} label={block.label} detail={block.detail} tone={block.tone} icon={block.icon} />
          : (
              <div key={`markdown-${index}`} className="td-agent-markdown">
                <ReactMarkdown>{block.text}</ReactMarkdown>
              </div>
            )
      ))}
    </div>
  );
}

function AgentActionResultCard({
  actionKind,
  status,
  target,
  title,
  command,
  cwd,
  action,
  terminalId,
  error,
}: {
  actionKind: string;
  status: 'started' | 'completed' | 'failed';
  target: string;
  title?: string;
  command?: string;
  cwd?: string;
  action?: string;
  terminalId?: string;
  error?: string;
}) {
  const detail = [
    command ? `Command: ${command}` : '',
    cwd ? `CWD: ${cwd}` : '',
    action ? `Action: ${action}` : '',
    terminalId ? `Terminal: ${terminalId}` : '',
    error ? `Error: ${error}` : '',
  ].filter(Boolean).join(' · ');
  return (
    <AgentOutputStatusCard
      label={`${formatTitleToken(actionKind.replace(/_/g, ' '))} ${status === 'failed' ? 'failed' : status === 'started' ? 'started' : 'completed'}`}
      detail={detail || title || target}
      tone={status === 'failed' ? 'error' : status === 'started' ? 'info' : 'success'}
      icon={actionKind === 'command' ? 'terminal' : actionKind === 'patch_review' ? 'edit' : 'tool'}
    />
  );
}

function AgentPreviewCard({
  title,
  url,
  onAction,
  cardId,
  resolution,
}: {
  title: string;
  url: string;
  onAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void;
  cardId?: string;
  resolution?: SdkCardResolution;
}) {
  const addPane = useWorkspaceStore(state => state.addPane);
  const [state, setState] = useState<'idle' | 'opened' | 'denied'>('idle');
  const effectiveState = resolution ? (resolution.status === 'failed' ? 'denied' : 'opened') : state;
  const openPreview = () => {
    if (effectiveState !== 'idle') return;
    setState('opened');
    addPane('preview', title, {
      url,
      previewTitle: title,
    });
    onAction?.(formatSdkAppActionResultContent({
      kind: 'preview',
      status: 'completed',
      cardId,
      title,
      target: url,
    }), 'completed', {
      autoContinue: true,
      continuePrompt: 'continue from the preview action result',
    });
  };
  const denyPreview = () => {
    if (effectiveState !== 'idle') return;
    setState('denied');
    onAction?.(formatSdkAppActionResultContent(buildSdkDeniedActionResult({
      kind: 'preview',
      cardId,
      title,
      target: url,
    })), 'failed', {
      autoContinue: true,
      continuePrompt: 'continue from the preview action result',
    });
  };

  return (
    <div className="td-agent-preview-card">
      <div className="td-agent-preview-header">
        <span><Globe2 size={13} /> {title}</span>
        <small>{effectiveState === 'opened' ? 'opened' : effectiveState === 'denied' ? 'denied' : 'pending'}</small>
      </div>
      <div className="td-agent-preview-url">{url}</div>
      <div className="td-agent-preview-actions">
        <button type="button" onClick={openPreview} disabled={effectiveState !== 'idle'} title="Open preview">
          <Globe2 size={12} />
          <span>Preview</span>
        </button>
        <button type="button" onClick={denyPreview} disabled={effectiveState !== 'idle'} title="Deny preview">
          <X size={12} />
          <span>Deny</span>
        </button>
        <button type="button" onClick={() => void writeText(url)} title="Copy URL">
          <ClipboardList size={12} />
          <span>Copy</span>
        </button>
      </div>
    </div>
  );
}

function AgentTerminalStopCard({
  title,
  terminalId,
  reason,
  onAction,
  cardId,
  resolution,
}: {
  title: string;
  terminalId: string;
  reason?: string;
  onAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void;
  cardId?: string;
  resolution?: SdkCardResolution;
}) {
  const [state, setState] = useState<'idle' | 'stopping' | 'stopped' | 'failed' | 'denied'>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const effectiveState = resolution ? (resolution.status === 'failed' ? 'denied' : 'stopped') : state;

  const stopTerminal = async () => {
    if (effectiveState !== 'idle') return;
    setState('stopping');
    setDetail(null);
    try {
      await invoke('destroy_pty', { id: terminalId });
      setState('stopped');
      setDetail('Terminal stopped.');
      onAction?.(formatSdkAppActionResultContent({
        kind: 'terminal_stop',
        status: 'completed',
        cardId,
        title,
        target: terminalId,
        terminalId,
      }), 'completed', {
        autoContinue: true,
        continuePrompt: 'continue from the terminal stop result',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState('failed');
      setDetail(message);
      onAction?.(formatSdkAppActionResultContent({
        kind: 'terminal_stop',
        status: 'failed',
        cardId,
        title,
        target: terminalId,
        terminalId,
        error: message,
      }), 'failed', {
        autoContinue: true,
        continuePrompt: 'continue from the terminal stop result',
      });
    }
  };
  const denyStop = () => {
    if (effectiveState !== 'idle') return;
    setState('denied');
    setDetail('Terminal stop denied.');
    onAction?.(formatSdkAppActionResultContent(buildSdkDeniedActionResult({
      kind: 'terminal_stop',
      cardId,
      title,
      target: terminalId,
      terminalId,
    })), 'failed', {
      autoContinue: true,
      continuePrompt: 'continue from the terminal stop result',
    });
  };

  return (
    <div className="td-agent-directory-card">
      <div className="td-agent-directory-header">
        <span><Square size={13} /> {title}</span>
        <small>{effectiveState === 'stopped' ? 'stopped' : effectiveState === 'stopping' ? 'stopping' : effectiveState === 'denied' ? 'denied' : effectiveState === 'failed' ? 'failed' : 'pending'}</small>
      </div>
      <div className="td-agent-directory-path">{terminalId}</div>
      {reason && <div className="td-agent-directory-detail">{reason}</div>}
      {detail && <div className={`td-agent-directory-detail is-${state === 'failed' ? 'failed' : 'created'}`}>{detail}</div>}
      <div className="td-agent-directory-actions">
        <button type="button" onClick={stopTerminal} disabled={effectiveState !== 'idle'} title="Stop terminal">
          <Square size={12} />
          <span>Stop</span>
        </button>
        <button type="button" onClick={denyStop} disabled={effectiveState !== 'idle'} title="Deny terminal stop">
          <X size={12} />
          <span>Deny</span>
        </button>
        <button type="button" onClick={() => void writeText(terminalId)} title="Copy terminal id">
          <ClipboardList size={12} />
          <span>Copy</span>
        </button>
      </div>
    </div>
  );
}

function AgentDirectoryCard({
  title,
  path,
  onAction,
  cardId,
  resolution,
}: {
  title: string;
  path: string;
  onAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void;
  cardId?: string;
  resolution?: SdkCardResolution;
}) {
  const [state, setState] = useState<'idle' | 'creating' | 'created' | 'failed' | 'denied'>('idle');
  const [detail, setDetail] = useState<string | null>(null);
  const effectiveState = resolution ? (resolution.status === 'failed' ? 'denied' : 'created') : state;

  const createDirectory = async () => {
    if (effectiveState !== 'idle' && effectiveState !== 'failed') return;
    const normalized = path.replace(/[\\/]+$/g, '');
    if (!normalized) {
      setState('failed');
      setDetail('Directory path is empty.');
      return;
    }
    setState('creating');
    setDetail(null);
    try {
      await invoke('workspace_create_dir_all', { path: normalized });
      setState('created');
      setDetail('Directory created.');
      onAction?.(formatSdkAppActionResultContent({
        kind: 'directory',
        status: 'completed',
        cardId,
        title,
        target: normalized,
      }), 'completed', {
        autoContinue: true,
        continuePrompt: 'continue from the directory creation result',
      });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      setState('failed');
      setDetail(message);
      onAction?.(formatSdkAppActionResultContent({
        kind: 'directory',
        status: 'failed',
        cardId,
        title,
        target: normalized,
        error: message,
      }), 'failed', {
        autoContinue: true,
        continuePrompt: 'continue from the directory creation result',
      });
    }
  };
  const denyCreateDirectory = () => {
    if (effectiveState !== 'idle') return;
    const normalized = path.replace(/[\\/]+$/g, '') || path;
    setState('denied');
    setDetail('Directory creation denied.');
    onAction?.(formatSdkAppActionResultContent(buildSdkDeniedActionResult({
      kind: 'directory',
      cardId,
      title,
      target: normalized,
    })), 'failed', {
      autoContinue: true,
      continuePrompt: 'continue from the directory creation result',
    });
  };

  return (
    <div className="td-agent-directory-card">
      <div className="td-agent-directory-header">
        <span><FolderPlus size={13} /> {title}</span>
        <small>{effectiveState === 'created' ? 'created' : effectiveState === 'creating' ? 'creating' : effectiveState === 'denied' ? 'denied' : effectiveState === 'failed' ? 'failed' : 'pending'}</small>
      </div>
      <div className="td-agent-directory-path">{path}</div>
      {detail && <div className={`td-agent-directory-detail is-${state}`}>{detail}</div>}
      <div className="td-agent-directory-actions">
        <button type="button" onClick={createDirectory} disabled={effectiveState !== 'idle' && effectiveState !== 'failed'} title="Create directory">
          <FolderPlus size={12} />
          <span>Create</span>
        </button>
        <button type="button" onClick={denyCreateDirectory} disabled={effectiveState !== 'idle'} title="Deny directory creation">
          <X size={12} />
          <span>Deny</span>
        </button>
        <button type="button" onClick={() => void writeText(path)} title="Copy path">
          <ClipboardList size={12} />
          <span>Copy</span>
        </button>
      </div>
    </div>
  );
}

function AgentPatchCard({
  title,
  path,
  patch,
  sourceMessage,
  onAction,
  cardId,
  resolution,
}: {
  title: string;
  path?: string;
  patch: string;
  sourceMessage?: FollowUpMessage;
  onAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void;
  cardId?: string;
  resolution?: SdkCardResolution;
}) {
  const addPane = useWorkspaceStore(state => state.addPane);
  const [state, setState] = useState<'idle' | 'reviewing' | 'denied'>('idle');
  const effectiveState = resolution ? (resolution.status === 'failed' ? 'denied' : 'reviewing') : state;
  const openReview = () => {
    if (effectiveState !== 'idle') return;
    setState('reviewing');
    addPane('changereview', title, {
      missionId: sourceMessage?.missionId,
      sourceThreadId: sourceMessage?.runtimeSessionId?.startsWith('sdk:') ? sourceMessage.runtimeSessionId.slice(4) : undefined,
      sourceRuntimeSessionId: sourceMessage?.runtimeSessionId,
      sourceCardId: cardId,
      sourceArtifactIds: sourceMessage?.artifactIds ?? [],
      sourceFilePaths: sourceMessage?.filePaths ?? (path ? [path] : []),
      artifacts: [{
        id: sourceMessage?.artifactIds?.[0] ?? `chat-patch-${Date.now()}`,
        title,
        kind: 'patch',
        path,
        contentText: patch,
      }],
      files: path ? [path] : [],
      patch,
    });
    onAction?.(formatSdkAppActionResultContent({
      kind: 'patch_review',
      status: 'started',
      cardId,
      title,
      target: path || title,
    }));
  };
  const denyReview = () => {
    if (effectiveState !== 'idle') return;
    setState('denied');
    onAction?.(formatSdkAppActionResultContent(buildSdkDeniedActionResult({
      kind: 'patch_review',
      cardId,
      title,
      target: path || title,
    })), 'failed', {
      autoContinue: true,
      continuePrompt: 'continue from the patch review result',
    });
  };
  const hunkCount = (patch.match(/^@@ /gm) ?? []).length;

  return (
    <div className="td-agent-patch-card">
      <div className="td-agent-patch-header">
        <span><Hammer size={13} /> {title}</span>
        <small>{effectiveState === 'reviewing' ? 'reviewing' : effectiveState === 'denied' ? 'denied' : `${hunkCount} hunk${hunkCount === 1 ? '' : 's'}`}</small>
      </div>
      {path && <div className="td-agent-patch-path">{path}</div>}
      <pre><code>{patch.split('\n').slice(0, 28).join('\n')}{patch.split('\n').length > 28 ? '\n...' : ''}</code></pre>
      <div className="td-agent-patch-actions">
        <button type="button" onClick={openReview} disabled={effectiveState !== 'idle'} title="Open change review">
          <ListChecks size={12} />
          <span>Review</span>
        </button>
        <button type="button" onClick={denyReview} disabled={effectiveState !== 'idle'} title="Deny patch review">
          <X size={12} />
          <span>Deny</span>
        </button>
        <button type="button" onClick={() => void writeText(patch)} title="Copy patch">
          <ClipboardList size={12} />
          <span>Copy</span>
        </button>
      </div>
    </div>
  );
}

function AgentCommandCard({
  command,
  reason,
  cwd,
  language,
  action = 'insert',
  sdkCommandTerminalId,
  onSdkCommandTerminalId,
  onAction,
  cardId,
  resolution,
}: {
  command: string;
  reason?: string;
  cwd?: string;
  language?: string;
  action?: 'insert' | 'run' | 'background';
  sdkCommandTerminalId?: string | null;
  onSdkCommandTerminalId?: (terminalId: string) => void;
  onAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void;
  cardId?: string;
  resolution?: SdkCardResolution;
}) {
  const addPane = useWorkspaceStore(state => state.addPane);
  const setActivePaneId = useWorkspaceStore(state => state.setActivePaneId);
  const workspaceDir = useWorkspaceStore(state => state.tabs.find(tab => tab.id === state.activeTabId)?.workspaceDir ?? state.workspaceDir);
  const [state, setState] = useState<'idle' | 'running' | 'started' | 'completed' | 'failed' | 'denied'>('idle');
  const effectiveState = resolution ? (resolution.status === 'failed' ? 'denied' : resolution.status) : state;
  const openInTerminal = async () => {
    if (effectiveState !== 'idle') return;
    setState('running');
    const terminalCwd = cwd || workspaceDir;
    const initialCommand = action === 'run'
      ? formatSdkTerminalRunCommand(command, detectSdkTerminalPlatform(), language)
      : command;
    let terminalId = action === 'run' && sdkCommandTerminalId ? sdkCommandTerminalId : `sdk-command-${generateId()}`;
    let wroteToExisting = false;
    let writeError: string | null = null;

    if (action === 'run' && sdkCommandTerminalId) {
      const active = await invoke<boolean>('is_pty_active', { id: sdkCommandTerminalId }).catch(() => false);
      if (active) {
        const existingPane = useWorkspaceStore.getState().tabs
          .flatMap(tab => tab.panes)
          .find(candidate => candidate.type === 'terminal' && candidate.data?.terminalId === sdkCommandTerminalId);
        if (existingPane) setActivePaneId(existingPane.id);
        try {
          await invoke('write_to_pty', { id: sdkCommandTerminalId, data: `${initialCommand}\r` });
          wroteToExisting = true;
        } catch (error) {
          writeError = error instanceof Error ? error.message : String(error);
        }
      } else {
        terminalId = `sdk-command-${generateId()}`;
      }
    }

    if (writeError) {
      setState('failed');
      onAction?.(formatSdkAppActionResultContent({
        kind: 'command',
        status: 'failed',
        cardId,
        target: terminalId,
        command,
        cwd: terminalCwd || undefined,
        action,
        terminalId,
        error: writeError,
      }), 'failed', {
        autoContinue: true,
        continuePrompt: 'continue from the command result',
      });
      return;
    }

    if (!wroteToExisting) {
      addPane('terminal', action === 'run' ? 'SDK Command Shell' : 'Suggested Command', {
        terminalId,
        initialCommand,
        initialCommandShouldRun: action === 'run' || action === 'background',
        workspaceDir: terminalCwd,
        sdkCommandShell: action === 'run',
      });
    }
    if (action === 'run') onSdkCommandTerminalId?.(terminalId);
    const result: SdkAppActionResultContent = {
      kind: 'command',
      status: action === 'insert' ? 'completed' : 'started',
      cardId,
      target: terminalId,
      command,
      cwd: terminalCwd || undefined,
      action,
      terminalId,
    };
    setState(action === 'insert' ? 'completed' : 'started');
    if (action === 'run') {
      onAction?.(formatSdkAppActionResultContent(result));
      watchSdkCommandCompletion(terminalId, result, onAction);
    } else {
      onAction?.(formatSdkAppActionResultContent(result), 'completed', {
        autoContinue: true,
        continuePrompt: 'continue from the command result',
      });
    }
  };
  const denyCommand = () => {
    if (effectiveState !== 'idle') return;
    setState('denied');
    onAction?.(formatSdkAppActionResultContent(buildSdkDeniedActionResult({
      kind: 'command',
      cardId,
      target: command,
      command,
      cwd: cwd || workspaceDir || undefined,
      action,
    })), 'failed', {
      autoContinue: true,
      continuePrompt: 'continue from the command result',
    });
  };

  return (
    <div className="td-agent-command-card">
      <div className="td-agent-command-header">
        <span><TerminalSquare size={13} /> {action === 'background' ? 'Background command proposed' : action === 'run' ? 'Command proposed' : 'Suggested command'}</span>
        <small>{effectiveState === 'idle' ? (language || 'pending') : effectiveState}</small>
      </div>
      {reason && <div className="td-agent-command-reason">{reason}</div>}
      {cwd && <div className="td-agent-command-cwd">{cwd}</div>}
      <pre><code>{command}</code></pre>
      <div className="td-agent-command-actions">
        <button type="button" onClick={() => void openInTerminal()} disabled={effectiveState !== 'idle'} title={action === 'insert' ? 'Insert in a terminal' : 'Run in a terminal'}>
          <Play size={12} />
          <span>{action === 'insert' ? 'Insert' : 'Run'}</span>
        </button>
        <button type="button" onClick={denyCommand} disabled={effectiveState !== 'idle'} title="Deny command">
          <X size={12} />
          <span>Deny</span>
        </button>
        <button type="button" onClick={() => void writeText(command)} title="Copy command">
          <ClipboardList size={12} />
          <span>Copy</span>
        </button>
      </div>
    </div>
  );
}

function watchSdkCommandCompletion(
  terminalId: string,
  startedResult: SdkAppActionResultContent,
  onAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void,
): void {
  let tail = '';
  let settled = false;
  let unsubscribe: (() => void) | null = null;
  const maxTailChars = 32_000;
  const finish = (exitCode: number) => {
    if (settled) return;
    settled = true;
    unsubscribe?.();
    const result = buildSdkCommandCompletionResult(startedResult, exitCode);
    onAction?.(formatSdkAppActionResultContent(result), result.status, {
      autoContinue: true,
      continuePrompt: 'continue from the command result',
    });
  };

  unsubscribe = terminalOutputBus.subscribe(terminalId, chunk => {
    tail = `${tail}${chunk.text}`;
    if (tail.length > maxTailChars) tail = tail.slice(tail.length - maxTailChars);
    const exitCode = extractSdkCommandExitCode(tail);
    if (exitCode !== null) finish(exitCode);
  });
  tail = terminalOutputBus.getTail(terminalId, maxTailChars);
  const existingExit = extractSdkCommandExitCode(tail);
  if (existingExit !== null) finish(existingExit);
}

function AgentOutputStatusCard({
  label,
  detail,
  tone,
  icon,
}: {
  label: string;
  detail?: string;
  tone: 'info' | 'success' | 'warn' | 'error';
  icon: AgentOutputStatusIcon;
}) {
  return (
    <div className={`td-agent-inline-status is-${tone}`}>
      <span className="td-agent-status-icon">{iconForAgentOutputStatus(icon)}</span>
      <span className="td-agent-status-copy">
        <span>{label}</span>
        {detail && <small>{detail}</small>}
      </span>
    </div>
  );
}

function iconForAgentOutputStatus(icon: AgentOutputStatusIcon): ReactNode {
  switch (icon) {
    case 'terminal':
      return <TerminalSquare size={13} />;
    case 'file':
      return <FileText size={13} />;
    case 'search':
      return <Search size={13} />;
    case 'edit':
      return <Hammer size={13} />;
    case 'test':
      return <CheckCircle2 size={13} />;
    case 'thinking':
      return <Loader2 size={13} className="td-agent-spin" />;
    case 'tool':
      return <Sparkles size={13} />;
  }
}

function AgentTodoCard({ items }: { items: AgentTodoItem[] }) {
  const completed = items.filter(item => item.status === 'completed').length;
  const pct = items.length > 0 ? Math.round((completed / items.length) * 100) : 0;
  return (
    <div className="td-agent-todo-card">
      <div className="td-agent-todo-header">
        <span><ListTree size={13} /> To-do</span>
        <span>{completed}/{items.length}</span>
      </div>
      <div className="td-agent-todo-progress">
        <span style={{ width: `${pct}%` }} />
      </div>
      <ul>
        {items.map((item, index) => (
          <li key={`${item.label}-${index}`} className={`is-${item.status}`} title={item.description ?? item.label}>
            {item.status === 'completed'
              ? <CheckCircle2 size={13} />
              : item.status === 'in_progress'
                ? <Loader2 size={13} className="td-agent-spin" />
                : <Clock size={13} />}
            <span>{item.label}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function AgentStatusToast({ message }: { message: FollowUpMessage }) {
  const status = statusPresentation(message);
  return (
    <div className={`td-agent-status-toast is-${status.tone}`}>
      <span className="td-agent-status-icon">{status.icon}</span>
      <span className="td-agent-status-copy">
        <span>{status.label}</span>
        {status.detail && <small>{status.detail}</small>}
      </span>
    </div>
  );
}

function statusPresentation(message: FollowUpMessage): {
  label: string;
  detail?: string;
  tone: 'info' | 'success' | 'warn' | 'error';
  icon: ReactNode;
} {
  const status = classifyAgentStatusMessage(message);
  return { ...status, icon: iconForAgentStatus(status.kind) };
}

function iconForAgentStatus(kind: AgentStatusKind): ReactNode {
  switch (kind) {
    case 'context_compacted':
      return <Minimize2 size={13} />;
    case 'prompt_sent':
      return <ArrowUp size={13} />;
    case 'agent_started':
      return <Loader2 size={13} className="td-agent-spin" />;
    case 'approval_needed':
    case 'run_failed':
      return <AlertCircle size={13} />;
    case 'permission_updated':
      return <Shield size={13} />;
    case 'run_completed':
      return <CheckCircle2 size={13} />;
    case 'tool_used':
      return <Sparkles size={13} />;
    case 'artifact_published':
      return <FileText size={13} />;
    case 'completion_pending':
      return <Clock size={13} />;
    case 'agent_update':
      return <Sparkles size={13} />;
  }
}

function AgentThinkingRow({ state }: { state?: string | null }) {
  return (
    <div className="td-agent-thinking-row">
      <Loader2 size={13} className="td-agent-spin" />
      <span>{runtimeStepLabel(state)}</span>
    </div>
  );
}

export function FollowUpComposer({
  pane,
  mission,
  missionId,
  taskDescription,
  progressRows,
  placement = 'mission',
  workspaceDir,
  onOpenWorkspace,
  onOpenInTab,
  onMinimizeToDock,
  onCollapse,
  onHide,
}: {
  pane: Pane;
  mission: CompiledMission | null;
  missionId: string;
  taskDescription: string;
  progressRows: MissionProgressRow[];
  placement?: 'mission' | 'global' | 'tab';
  workspaceDir?: string | null;
  onOpenWorkspace?: () => void;
  onOpenInTab?: () => void;
  onMinimizeToDock?: () => void;
  onCollapse?: () => void;
  onHide?: () => void;
}) {
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const agentInstructions = useWorkspaceStore(s => s.agentInstructions);
  const activeFilePath = useWorkspaceStore(s => {
    const tab = s.tabs.find(candidate => candidate.id === s.activeTabId);
    const pane = tab?.panes.find(candidate => candidate.id === s.activePaneId);
    return pane?.type === 'editor' ? (pane.data?.filePath as string | undefined) ?? null : null;
  });
  const activeTerminalId = useWorkspaceStore(s => {
    const tab = s.tabs.find(candidate => candidate.id === s.activeTabId);
    const activePane = tab?.panes.find(candidate => candidate.id === s.activePaneId);
    if (activePane?.type === 'terminal' && typeof activePane.data?.terminalId === 'string') {
      return activePane.data.terminalId;
    }
    const firstTerminal = tab?.panes.find(candidate => candidate.type === 'terminal' && typeof candidate.data?.terminalId === 'string');
    return (firstTerminal?.data?.terminalId as string | undefined) ?? null;
  });
  const activeTerminalCwd = useWorkspaceStore(s => {
    const tab = s.tabs.find(candidate => candidate.id === s.activeTabId);
    const activePane = tab?.panes.find(candidate => candidate.id === s.activePaneId);
    const terminalPane = activePane?.type === 'terminal'
      ? activePane
      : tab?.panes.find(candidate => candidate.type === 'terminal' && typeof candidate.data?.terminalId === 'string');
    const paneCwd = typeof terminalPane?.data?.cwd === 'string' ? terminalPane.data.cwd.trim() : '';
    const paneWorkspace = typeof terminalPane?.data?.workspaceDir === 'string' ? terminalPane.data.workspaceDir.trim() : '';
    return paneCwd || paneWorkspace || tab?.workspaceDir || s.workspaceDir || null;
  });
  const sdkTerminalContextsJson = useWorkspaceStore(s => {
    const tab = s.tabs.find(candidate => candidate.id === s.activeTabId);
    return JSON.stringify((tab?.panes ?? [])
      .filter(candidate => candidate.type === 'terminal' && typeof candidate.data?.terminalId === 'string')
      .map(candidate => ({
        terminalId: String(candidate.data?.terminalId),
        title: candidate.title,
        cwd: typeof candidate.data?.cwd === 'string'
          ? candidate.data.cwd
          : typeof candidate.data?.workspaceDir === 'string'
            ? candidate.data.workspaceDir
            : tab?.workspaceDir ?? s.workspaceDir ?? undefined,
        cli: typeof candidate.data?.cli === 'string' ? candidate.data.cli : undefined,
        initialCommand: typeof candidate.data?.initialCommand === 'string' ? candidate.data.initialCommand : undefined,
        initialCommandShouldRun: candidate.data?.initialCommandShouldRun === true,
        runtimeManaged: candidate.data?.runtimeManaged === true,
      })));
  });
  const sdkTerminalContexts = useMemo(
    () => JSON.parse(sdkTerminalContextsJson) as SdkChatTerminalContext[],
    [sdkTerminalContextsJson],
  );
  const messages: FollowUpMessage[] = pane.data?.followUpMessages ?? [];
  const threadId = (pane.data?.followUpThreadId as string | undefined) ?? `thread:${missionId}`;
  const selectedCli = (pane.data?.followUpCli as CliId | undefined) ?? 'codex';
  const selectedModel = (pane.data?.followUpModel as string | undefined) ?? '';
  const selectedSkillId = (pane.data?.followUpSkillId as string | undefined) ?? '';
  const selectedPermissionMode = parseFollowUpPermissionMode(pane.data?.followUpPermissionMode);
  const selectedContextPath = typeof pane.data?.followUpContextPath === 'string' && pane.data.followUpContextPath.trim()
    ? pane.data.followUpContextPath.trim()
    : null;
  const selectedContextKind = parseFollowUpContextKind(pane.data?.followUpContextKind);
  const agentRoleOptions = PUBLIC_AGENT_ROLES.map(agent => ({
    value: agent.id,
    label: agent.name,
    description: agent.description,
    icon: iconForAgentRole(agent.id),
    showDescription: false,
  }));
  const fallbackAgentRoleId = placement === 'mission' && mission?.nodes?.find(node => node.roleId)
    ? getPublicRoleForWorkflowRole(mission.nodes.find(node => node.roleId)?.roleId).id
    : 'code';
  const selectedAgentRoleId = (pane.data?.followUpAgentRoleId as string | undefined) ?? fallbackAgentRoleId;
  const selectedAgent = getPublicAgentRole(selectedAgentRoleId) ?? getPublicRoleForWorkflowRole(selectedAgentRoleId);
  const selectedSessionId = pane.data?.followUpRuntimeSessionId as string | undefined;
  const sdkCommandTerminalId = typeof pane.data?.followUpSdkCommandTerminalId === 'string'
    ? pane.data.followUpSdkCommandTerminalId
    : null;
  const sessionPolicy: FollowUpSessionPolicy = selectedSessionId ? 'wait' : 'new';
  const attachments: Array<{ id: string; kind: 'file' | 'image'; name: string; path?: string }> = pane.data?.followUpAttachments ?? [];
  const pendingQueue: FollowUpPendingItem[] = pane.data?.followUpQueue ?? [];
  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState<CliModel[]>([]);
  const [skills, setSkills] = useState<CliSkill[]>([]);
  const [capabilityWarnings, setCapabilityWarnings] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<RuntimeManagerSnapshot>(() => runtimeManager.snapshot());
  const [submitting, setSubmitting] = useState(false);
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [storedOpenAiApiKey, setStoredOpenAiApiKeyState] = useState(() => getStoredOpenAiApiKey());
  const [, bumpOpenAiConfigVersion] = useState(0);
  const [sdkStep, setSdkStep] = useState<string | null>(null);
  const [sdkUsage, setSdkUsage] = useState<SdkChatUsageDelta | null>(null);
  const [sdkFinishMeta, setSdkFinishMeta] = useState<SdkChatFinishMeta | null>(null);
  const sdkAbortRef = useRef<AbortController | null>(null);
  const pendingSdkAutoContinueRef = useRef<string | null>(null);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const promptHistoryIndexRef = useRef<number | null>(null);
  const promptHistoryDraftRef = useRef('');
  const configuredOpenAiApiKey = storedOpenAiApiKey || getConfiguredOpenAiApiKey();
  const configuredOpenAiBaseUrl = getConfiguredOpenAiBaseUrl();
  const usesSdkTransport = selectedCli === 'codex' && Boolean(configuredOpenAiApiKey);
  const effectiveWorkspaceDir = mission?.task.workspaceDir ?? workspaceDir ?? null;
  const agentContextPath = selectedContextPath || activeFilePath || effectiveWorkspaceDir;
  const agentContextKind: FollowUpContextKind | null = selectedContextPath
    ? selectedContextKind ?? 'folder'
    : activeFilePath
      ? 'file'
      : effectiveWorkspaceDir
        ? 'folder'
        : null;
  const agentContextDirectory = agentContextKind === 'file' && agentContextPath
    ? dirname(agentContextPath)
    : agentContextKind === 'folder'
      ? agentContextPath
      : null;
  const agentContextFile = agentContextKind === 'file' ? agentContextPath : null;
  const isMissionFollowUp = Boolean(mission);
  const usesMissionRuntimeContext = placement === 'mission' && isMissionFollowUp;
  const selectedModelKnownForCli = !selectedModel
    || models.length === 0
    || models.some(model => model.id === selectedModel);
  const activeSelectedModel = isModelCompatibleWithCli(selectedCli, selectedModel) && selectedModelKnownForCli
    ? selectedModel
    : '';

  useEffect(() => runtimeManager.subscribeSnapshot(setRuntimeSnapshot), []);

  useEffect(() => {
    const refreshOpenAiConfig = () => {
      setStoredOpenAiApiKeyState(getStoredOpenAiApiKey());
      bumpOpenAiConfigVersion(version => version + 1);
    };
    window.addEventListener(OPENAI_SDK_CONFIG_CHANGED_EVENT, refreshOpenAiConfig);
    return () => window.removeEventListener(OPENAI_SDK_CONFIG_CHANGED_EVENT, refreshOpenAiConfig);
  }, []);

  useEffect(() => {
    let cancelled = false;
    missionRepository.listFollowUpMessages(missionId, threadId, 200)
      .then(records => {
        if (cancelled || records.length === 0) return;
        const loaded: FollowUpMessage[] = records.map(record => ({
          id: record.id,
          missionId: record.missionId,
          runId: record.runId ?? undefined,
          role: record.role as FollowUpRole,
          cli: record.cli ?? undefined,
          model: record.model ?? undefined,
          runtimeSessionId: record.runtimeSessionId ?? undefined,
          content: record.content,
          attachments: parseJsonArray(record.attachmentsJson),
          artifactIds: parseJsonArray(record.artifactIdsJson),
          filePaths: parseJsonArray(record.filePathsJson),
          status: record.status as FollowUpMessage['status'],
          createdAt: record.createdAt,
          completedAt: record.completedAt ?? undefined,
        }));
        updatePaneData(pane.id, { followUpThreadId: threadId, followUpMessages: loaded });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missionId, pane.id, threadId, updatePaneData]);

  useEffect(() => {
    let cancelled = false;
    setSkills([]);
    setCapabilityWarnings([]);
    if (selectedCli === 'codex') {
      setModels(OPENAI_SDK_MODELS);
    }
    if (!supportsModelDiscovery(selectedCli)) {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    discoverModelsForCli(selectedCli, { workspaceDir: effectiveWorkspaceDir })
      .then(result => {
        if (!cancelled) setModels(selectedCli === 'codex' ? mergeCodexModels(result.models) : result.models);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    invoke<CliCapabilityDiscovery>('discover_cli_capabilities', {
      cli: selectedCli,
      projectPath: effectiveWorkspaceDir,
      refresh: false,
    })
      .then(result => {
        if (cancelled) return;
        setSkills(result.skills ?? []);
        setCapabilityWarnings(result.warnings ?? []);
      })
      .catch(error => {
        if (!cancelled) setCapabilityWarnings([error instanceof Error ? error.message : String(error)]);
      });
    return () => {
      cancelled = true;
    };
  }, [effectiveWorkspaceDir, selectedCli]);

  useEffect(() => {
    if (models.length === 0) {
      if (selectedModel && !isModelCompatibleWithCli(selectedCli, selectedModel)) {
        updatePaneData(pane.id, { followUpModel: '', followUpRuntimeSessionId: null });
      }
      return;
    }
    if (!selectedModel || !models.some(model => model.id === selectedModel)) {
      updatePaneData(pane.id, { followUpModel: models[0].id, followUpRuntimeSessionId: null });
    }
  }, [models, pane.id, selectedCli, selectedModel, updatePaneData]);

  useEffect(() => {
    if (!selectedSkillId || skills.some(skill => skill.id === selectedSkillId)) return;
    updatePaneData(pane.id, { followUpSkillId: '' });
  }, [pane.id, selectedSkillId, skills, updatePaneData]);

  useEffect(() => {
    const unsubscribe = runtimeManager.subscribe(event => {
      const activePane = useWorkspaceStore.getState().tabs
        .flatMap(tab => tab.panes)
        .find(candidate => candidate.id === pane.id);
      const activeSessionId = activePane?.data?.followUpRuntimeSessionId;
      if (!activeSessionId && event.type === 'session_created' && event.missionId === `adhoc-followup-${missionId}`) {
        updatePaneData(pane.id, { followUpRuntimeSessionId: event.sessionId });
        const message: FollowUpMessage = {
          id: `runtime-starting-${event.sessionId}`,
          missionId,
          role: 'system',
          cli: selectedCli,
          model: activeSelectedModel || undefined,
          runtimeSessionId: event.sessionId,
          content: 'Agent runtime starting...',
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
        };
        appendFollowUpMessages(pane.id, [message]);
        void persistFollowUpMessage(threadId, message);
      }
      if (activeSessionId !== event.sessionId) return;
      if (event.type !== 'output_captured') {
        const content = summarizeRuntimeEventForFollowUp(event);
        if (!content) return;
        const current = readFollowUpMessages(pane.id);
        const finalizedStatus = event.type === 'session_failed'
          ? 'failed'
          : event.type === 'session_disconnected'
            ? 'cancelled'
            : event.type === 'session_completed'
              ? 'completed'
              : null;
        const finalized = finalizedStatus
          ? finalizeStreamingMessages(current, event.sessionId, finalizedStatus)
          : current;
        const message: FollowUpMessage = {
          id: generateId(),
          missionId,
          role: event.type === 'artifact_published' ? 'tool' : 'system',
          cli: selectedCli,
          model: activeSelectedModel,
          runtimeSessionId: event.sessionId,
          content,
          artifactIds: event.type === 'artifact_published' ? [event.artifact.id] : undefined,
          filePaths: event.type === 'artifact_published' && event.artifact.path ? [event.artifact.path] : undefined,
          status: event.type === 'session_failed' ? 'failed' : event.type === 'session_completed' ? 'completed' : 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
        };
        const nextMessages = [...finalized, message].slice(-200);
        updatePaneData(pane.id, { followUpMessages: nextMessages });
        if (finalized !== current) {
          finalized
            .filter((message, index) => message !== current[index])
            .forEach(message => void persistFollowUpMessage(threadId, message));
        }
        void persistFollowUpMessage(threadId, message);
        return;
      }
      const current = readFollowUpMessages(pane.id);
      const lastAgent = [...current].reverse().find(message => message.runtimeSessionId === event.sessionId && message.role === 'agent' && message.status === 'streaming');
      const nextMessages = lastAgent
        ? current.map(message => message.id === lastAgent.id ? { ...message, content: `${message.content}${event.text}` } : message)
        : [...current, {
            id: generateId(),
            missionId,
            role: 'agent' as const,
            cli: selectedCli,
            model: activeSelectedModel,
            runtimeSessionId: event.sessionId,
            content: event.text,
            status: 'streaming' as const,
            createdAt: Date.now(),
          }];
      updatePaneData(pane.id, { followUpMessages: nextMessages });
      const persisted = nextMessages.find(message => message.runtimeSessionId === event.sessionId && message.role === 'agent' && message.status === 'streaming');
      if (persisted) void persistFollowUpMessage(threadId, persisted);
    });
    return unsubscribe;
  }, [activeSelectedModel, missionId, pane.id, selectedCli, threadId, updatePaneData]);

  async function dispatchFollowUp(
    trimmed: string,
    itemAttachments: FollowUpMessage['attachments'],
    userMessage: FollowUpMessage,
    preferredSessionId?: string,
    options: FollowUpSubmitOptions = {},
  ) {
    const selectedSkill = skills.find(skill => skill.id === selectedSkillId);
    const report = progressRows.map(row => `- ${row.label}: ${row.status}${row.detail ? ` (${row.detail})` : ''}`).join('\n');
    const artifactContext = progressRows
      .flatMap(row => [
        ...(row.artifacts ?? []).map(artifact => `artifact ${artifact.id}: ${artifact.title}`),
        ...(row.files ?? []).map((filePath: string) => `file: ${filePath}`),
      ])
      .slice(-20)
      .join('\n');
    const attachmentContext = selectedCli === 'codex'
      ? await buildSdkAttachmentContext(itemAttachments)
      : formatAttachmentList(itemAttachments);
    const graphNodeContext = mission?.nodes?.length
      ? `Graph node IDs:\n${mission.nodes.map(node => `- ${node.id}${node.roleId ? ` (${node.roleId})` : ''}`).join('\n')}`
      : '';
    const priorMessages = readFollowUpMessages(pane.id).filter(message => message.id !== userMessage.id);
    const conversationContext = buildAgentConversationContext(priorMessages, { maxChars: 12000 });
    const selectedRoleInstructions = selectedAgent
      ? (agentInstructions[selectedAgent.id]?.trim() || selectedAgent.coreInstructions)
      : '';
    const roleContext = selectedAgent
      ? usesMissionRuntimeContext
        ? `Agent role: ${selectedAgent.name} (${selectedAgent.role}).\n${selectedRoleInstructions}`
        : `Agent role: ${selectedAgent.name} (${selectedAgent.role}).\n${selectedRoleInstructions}\nUse this as a general assistance style, not as workflow task instructions.`
      : '';
    const followUpContext = [
      usesMissionRuntimeContext
        ? `You are continuing work for Comet-AI mission ${missionId}.`
        : 'You are the workspace agent for Comet-AI. Answer the user directly. Do not look for an assigned mission, inbox, nodeId, or workflow task unless the user explicitly asks you to work on a mission.',
      roleContext,
      `Workspace: ${effectiveWorkspaceDir ?? 'not set'}`,
      agentContextKind && agentContextPath
        ? `Selected ${agentContextKind}: ${agentContextPath}`
        : '',
      permissionModeInstruction(selectedPermissionMode, selectedCli, usesSdkTransport),
      `${usesMissionRuntimeContext ? 'Mission' : 'Workspace'} summary: ${usesMissionRuntimeContext ? (taskDescription || mission?.task.prompt || 'Mission follow-up') : (workspaceDir ? `Workspace agent for ${workspaceDir}` : 'Workspace follow-up')}`,
      selectedSkill ? `Requested skill/profile: ${selectedSkill.name} (${selectedSkill.id}).` : '',
      usesMissionRuntimeContext ? graphNodeContext : '',
      usesMissionRuntimeContext && report ? `Current phase summary:\n${report}` : '',
      usesMissionRuntimeContext && artifactContext ? `Recent artifacts and changed files:\n${artifactContext}` : '',
      attachmentContext,
      conversationContext ? `Previous follow-up context:\n${conversationContext}` : '',
    ].filter(Boolean).join('\n\n');
    const followUpPrompt = [
      followUpContext,
      `User follow-up:\n${trimmed}`,
    ].filter(Boolean).join('\n\n');

    if (selectedCli === 'codex') {
      const apiKey = configuredOpenAiApiKey;
      if (!apiKey) {
        const sessionId = `codex-cli:${threadId}`;
        const runId = `codex-cli-${generateId()}`;
        const agentMessageId = generateId();
        const startedAt = Date.now();
        const agentMessage: FollowUpMessage = {
          id: agentMessageId,
          missionId,
          role: 'agent',
          cli: 'codex',
          model: activeSelectedModel || undefined,
          runtimeSessionId: sessionId,
          content: '',
          status: 'streaming',
          createdAt: startedAt,
        };
        const publishCodexCliToolEvent = (event: CodexCliJsonToolEvent) => {
          const toolMessage: FollowUpMessage = {
            id: generateId(),
            missionId,
            role: 'tool',
            cli: 'codex',
            model: activeSelectedModel || undefined,
            runtimeSessionId: sessionId,
            content: `Tool: ${event.label}${event.detail ? ` - ${event.detail}` : ''}`,
            status: event.status === 'failed' ? 'failed' : event.status === 'completed' ? 'completed' : 'streaming',
            createdAt: Date.now(),
            completedAt: event.status === 'running' ? undefined : Date.now(),
          };
          appendFollowUpMessages(pane.id, [toolMessage]);
          if (event.status !== 'running') void persistFollowUpMessage(threadId, toolMessage);
        };

        updatePaneData(pane.id, {
          followUpRuntimeSessionId: sessionId,
          followUpMessages: [
            ...readFollowUpMessages(pane.id).map(message =>
              message.id === userMessage.id ? { ...message, runtimeSessionId: sessionId, status: 'completed' as const, completedAt: startedAt } : message
            ),
            agentMessage,
          ].slice(-200),
        });
        if (!options.internal) {
          void persistFollowUpMessage(threadId, { ...userMessage, runtimeSessionId: sessionId, status: 'completed', completedAt: startedAt });
        }

        let streamedContent = '';
        try {
          const finalText = await runCodexCliJson({
            prompt: followUpPrompt,
            workspaceDir: effectiveWorkspaceDir,
            model: activeSelectedModel || null,
            missionId,
            nodeId: `followup:${selectedAgent?.id ?? 'agent'}:${missionId}`,
            agentId: `followup:${selectedAgent?.id ?? 'agent'}:${missionId}`,
            sessionId,
            runId,
            yolo: selectedPermissionMode === 'full',
            onStep: setSdkStep,
            onToolEvent: publishCodexCliToolEvent,
            onDelta: delta => {
              streamedContent += delta;
              updatePaneData(pane.id, {
                followUpMessages: readFollowUpMessages(pane.id).map(message =>
                  message.id === agentMessageId ? { ...message, content: streamedContent } : message
                ),
              });
            },
          });
          const completed: FollowUpMessage = {
            ...agentMessage,
            content: finalText || streamedContent || 'Codex CLI completed without a final message.',
            status: 'completed',
            completedAt: Date.now(),
          };
          updatePaneData(pane.id, {
            followUpMessages: readFollowUpMessages(pane.id).map(message => message.id === agentMessageId ? completed : message),
          });
          void persistFollowUpMessage(threadId, completed);
          return;
        } catch (error) {
          const failed: FollowUpMessage = {
            ...agentMessage,
            content: streamedContent || `Codex CLI failed: ${error instanceof Error ? error.message : String(error)}`,
            status: 'failed',
            completedAt: Date.now(),
          };
          updatePaneData(pane.id, {
            followUpMessages: readFollowUpMessages(pane.id).map(message => message.id === agentMessageId ? failed : message),
          });
          void persistFollowUpMessage(threadId, failed);
          throw error;
        } finally {
          setSdkStep(null);
        }
      }

      const sessionId = `sdk:${threadId}`;
      const agentMessageId = generateId();
      const startedAt = Date.now();
      const sdkImageAttachments = await buildSdkImageAttachments(itemAttachments);
      const sdkMessages: SdkChatMessage[] = buildSdkFollowUpMessagesForRun({
        priorMessages,
        latestUserContent: createSdkUserContent(trimmed, sdkImageAttachments),
      });
      const agentMessage: FollowUpMessage = {
        id: agentMessageId,
        missionId,
        role: 'agent',
        cli: 'sdk',
        model: normalizeOpenAiSdkModel(activeSelectedModel),
        runtimeSessionId: sessionId,
        content: '',
        status: 'streaming',
        createdAt: startedAt,
      };
      let emittedApprovalCard = false;
      const publishSdkArtifact = (artifact: SdkChatArtifact) => {
        emittedApprovalCard = true;
        const messageFields = buildSdkArtifactToolMessageFields(artifact);
        const toolMessage: FollowUpMessage = {
          id: generateId(),
          missionId,
          role: 'tool',
          cli: 'sdk',
          model: normalizeOpenAiSdkModel(activeSelectedModel),
          runtimeSessionId: sessionId,
          ...messageFields,
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
        };
        appendFollowUpMessages(pane.id, [toolMessage]);
        void persistFollowUpMessage(threadId, toolMessage);
      };
      const publishSdkToolEvent = (event: SdkChatToolEvent) => {
        const toolMessage: FollowUpMessage = {
          id: generateId(),
          missionId,
          role: 'tool',
          cli: 'sdk',
          model: normalizeOpenAiSdkModel(activeSelectedModel),
          runtimeSessionId: sessionId,
          content: `Tool: ${event.label}${event.detail ? ` - ${event.detail}` : ''}`,
          status: event.status,
          createdAt: Date.now(),
          completedAt: Date.now(),
        };
        appendFollowUpMessages(pane.id, [toolMessage]);
        void persistFollowUpMessage(threadId, toolMessage);
      };
      const publishSdkTodos = (event: SdkChatTodoEvent) => {
        const todoMessage: FollowUpMessage = {
          id: generateId(),
          missionId,
          role: 'tool',
          cli: 'sdk',
          model: normalizeOpenAiSdkModel(activeSelectedModel),
          runtimeSessionId: sessionId,
          content: formatSdkTodoWriteContent(event.todos),
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
        };
        appendFollowUpMessages(pane.id, [todoMessage]);
        void persistFollowUpMessage(threadId, todoMessage);
      };
      const publishSdkCommand = (event: SdkChatCommandEvent) => {
        emittedApprovalCard = true;
        const commandMessage: FollowUpMessage = {
          id: generateId(),
          missionId,
          role: 'tool',
          cli: 'sdk',
          model: normalizeOpenAiSdkModel(activeSelectedModel),
          runtimeSessionId: sessionId,
          content: formatSdkCommandSuggestionContent(event),
          status: 'completed',
          createdAt: Date.now(),
          completedAt: Date.now(),
        };
        appendFollowUpMessages(pane.id, [commandMessage]);
        void persistFollowUpMessage(threadId, commandMessage);
      };

      updatePaneData(pane.id, {
        followUpRuntimeSessionId: sessionId,
        followUpMessages: [
          ...readFollowUpMessages(pane.id).map(message =>
            message.id === userMessage.id ? { ...message, runtimeSessionId: sessionId, status: 'completed' as const, completedAt: startedAt } : message
          ),
          agentMessage,
        ].slice(-200),
      });
      if (!options.internal) {
        void persistFollowUpMessage(threadId, { ...userMessage, runtimeSessionId: sessionId, status: 'completed', completedAt: startedAt });
      }

      let streamedContent = '';
      const finishMetaRef: { current: SdkChatFinishMeta | null } = { current: null };
      const controller = new AbortController();
      sdkAbortRef.current = controller;
      setSdkUsage(null);
      setSdkFinishMeta(null);
      try {
        const finalText = await runSdkChat({
          apiKey,
          model: activeSelectedModel,
          baseURL: configuredOpenAiBaseUrl,
          workspaceDir: effectiveWorkspaceDir,
          activeFile: agentContextFile,
          activeTerminalId,
          activeTerminalCwd: agentContextDirectory || activeTerminalCwd,
          terminals: sdkTerminalContexts,
          systemContext: followUpContext,
          messages: sdkMessages,
          toolMode: selectedPermissionMode === 'restricted' ? 'read_only' : 'full',
          abortSignal: controller.signal,
          onStep: setSdkStep,
          onArtifact: publishSdkArtifact,
          onToolEvent: publishSdkToolEvent,
          onTodos: publishSdkTodos,
          onCommand: publishSdkCommand,
          onUsage: delta => {
            setSdkUsage(previous => ({
              inputTokens: (previous?.inputTokens ?? 0) + delta.inputTokens,
              outputTokens: (previous?.outputTokens ?? 0) + delta.outputTokens,
              cachedInputTokens: (previous?.cachedInputTokens ?? 0) + delta.cachedInputTokens,
              lastInputTokens: delta.lastInputTokens,
              lastCachedTokens: delta.lastCachedTokens,
            }));
          },
          onFinishMeta: meta => {
            finishMetaRef.current = meta;
            setSdkFinishMeta(meta);
          },
          onDelta: delta => {
            streamedContent += delta;
            updatePaneData(pane.id, {
              followUpMessages: readFollowUpMessages(pane.id).map(message =>
                message.id === agentMessageId ? { ...message, content: streamedContent } : message
              ),
            });
          },
        });
        const completed: FollowUpMessage = {
          ...agentMessage,
          content: finalText || streamedContent || '(No response text returned.)',
          status: 'completed',
          completedAt: Date.now(),
        };
        if (shouldSuppressEmptySdkAssistantMessage({ finalText, streamedContent, emittedApprovalCard })) {
          updatePaneData(pane.id, {
            followUpMessages: readFollowUpMessages(pane.id).filter(message => message.id !== agentMessageId),
          });
        } else {
          updatePaneData(pane.id, {
            followUpMessages: readFollowUpMessages(pane.id).map(message => message.id === agentMessageId ? completed : message),
          });
          void persistFollowUpMessage(threadId, completed);
        }
        if (finishMetaRef.current?.hitStepCap) {
          const capMessage: FollowUpMessage = {
            id: generateId(),
            missionId,
            role: 'system',
            cli: 'sdk',
            model: normalizeOpenAiSdkModel(activeSelectedModel),
            runtimeSessionId: sessionId,
            content: 'SDK step limit reached. Send "continue" to let the agent keep working from the current context.',
            status: 'completed',
            createdAt: Date.now(),
            completedAt: Date.now(),
          };
          appendFollowUpMessages(pane.id, [capMessage]);
          void persistFollowUpMessage(threadId, capMessage);
        }
        return;
      } catch (error) {
        const aborted = controller.signal.aborted;
        const failed: FollowUpMessage = {
          ...agentMessage,
          content: streamedContent || (aborted ? 'SDK chat stopped.' : `SDK chat failed: ${error instanceof Error ? error.message : String(error)}`),
          status: aborted ? 'cancelled' : 'failed',
          completedAt: Date.now(),
        };
        updatePaneData(pane.id, {
          followUpMessages: readFollowUpMessages(pane.id).map(message => message.id === agentMessageId ? failed : message),
        });
        void persistFollowUpMessage(threadId, failed);
        if (aborted) return;
        throw error;
      } finally {
        if (sdkAbortRef.current === controller) sdkAbortRef.current = null;
        setSdkStep(null);
      }
    }

    let sessionId = preferredSessionId;
    const expected = {
      cliId: selectedCli,
      model: activeSelectedModel || null,
      yolo: selectedPermissionMode === 'full',
      executionMode: 'interactive_pty' as const,
      workspaceDir: effectiveWorkspaceDir,
    };

    if (sessionId) {
      const validation = await runtimeManager.validateSessionForReuse(sessionId, expected);
      if (validation.status !== 'reusable') {
        sessionId = undefined;
      }
    }

    if (!sessionId) {
      const terminalId = `followup-${generateId()}`;
      const session = await runtimeManager.ensureRuntimeReadyForTask({
        missionId: `adhoc-followup-${missionId}`,
        nodeId: `followup:${selectedAgent?.id ?? 'agent'}:${missionId}`,
        attempt: 1,
        role: selectedAgent?.role ?? 'followup',
        agentId: `followup:${selectedAgent?.id ?? 'agent'}:${missionId}`,
        profileId: selectedSkill?.id ?? selectedAgent?.profileId ?? null,
        cliId: selectedCli,
        executionMode: 'interactive_pty',
        terminalId,
        workspaceDir: effectiveWorkspaceDir,
        goal: taskDescription,
        modelId: activeSelectedModel || null,
        model: activeSelectedModel || null,
        yolo: selectedPermissionMode === 'full',
        inputPayload: { followUp: true, missionId, skillId: selectedSkill?.id ?? null, agentRoleId: selectedAgent?.id ?? null },
      });
      sessionId = session.sessionId;
    }

    updatePaneData(pane.id, {
      followUpRuntimeSessionId: sessionId,
      followUpMessages: readFollowUpMessages(pane.id).map(message =>
        message.id === userMessage.id ? { ...message, runtimeSessionId: sessionId, status: 'completed', completedAt: Date.now() } : message
      ),
    });
    void persistFollowUpMessage(threadId, { ...userMessage, runtimeSessionId: sessionId, status: 'completed', completedAt: Date.now() });
    void runtimeManager.sendTask({
      sessionId,
      prompt: followUpPrompt,
      payloadJson: JSON.stringify({
        missionId,
        prompt: trimmed,
        progressRows,
        attachments: itemAttachments,
        skillId: selectedSkill?.id ?? null,
        agentRoleId: selectedAgent?.id ?? null,
        graphNodeIds: mission?.nodes?.map(node => node.id) ?? [],
      }),
    }).catch(error => {
      const failed: FollowUpMessage = {
        id: generateId(),
        missionId,
        role: 'system',
        cli: selectedCli,
        model: activeSelectedModel || undefined,
        runtimeSessionId: sessionId,
        content: `Failed to send: ${error instanceof Error ? error.message : String(error)}`,
        status: 'failed',
        createdAt: Date.now(),
        completedAt: Date.now(),
      };
      appendFollowUpMessages(pane.id, [failed]);
      void persistFollowUpMessage(threadId, failed);
    });
  }

  async function submitFollowUp(overridePrompt?: string, options: FollowUpSubmitOptions = {}) {
    const trimmed = (overridePrompt ?? prompt).trim();
    if (!trimmed || submitting) return;
    const createdAt = Date.now();
    const activeSession = runtimeSnapshot.sessions.find(session => session.sessionId === selectedSessionId);
    const busy = isFollowUpSessionBusy(activeSession?.state);
    const queued = !options.internal && busy && sessionPolicy !== 'new';
    const messageAttachments = options.internal ? [] : attachments;
    const userMessage: FollowUpMessage = {
      id: generateId(),
      missionId,
      role: 'user',
      cli: selectedCli,
      model: activeSelectedModel || undefined,
      content: trimmed,
      attachments: messageAttachments,
      status: queued ? 'queued' : 'sending',
      createdAt,
    };
    if (!options.internal) {
      updatePaneData(pane.id, {
        followUpMessages: [...messages, userMessage],
        followUpAttachments: [],
        followUpQueue: queued
          ? [...pendingQueue, { id: generateId(), messageId: userMessage.id, prompt: trimmed, attachments: messageAttachments, policy: sessionPolicy, createdAt }]
          : pendingQueue,
      });
      void persistFollowUpMessage(threadId, userMessage);
      setPrompt('');
    }
    if (queued) return;

    setSubmitting(true);
    try {
      await dispatchFollowUp(trimmed, messageAttachments, userMessage, sessionPolicy === 'new' ? undefined : selectedSessionId, options);
    } catch (error) {
      if (!options.internal) {
        updatePaneData(pane.id, {
          followUpMessages: readFollowUpMessages(pane.id).map(message =>
            message.id === userMessage.id ? { ...message, status: 'failed', completedAt: Date.now(), content: `${message.content}\n\nFailed to send: ${error instanceof Error ? error.message : String(error)}` } : message
          ),
        });
        void persistFollowUpMessage(threadId, {
          ...userMessage,
          status: 'failed',
          completedAt: Date.now(),
          content: `${userMessage.content}\n\nFailed to send: ${error instanceof Error ? error.message : String(error)}`,
        });
      }
    } finally {
      setSubmitting(false);
    }
  }

  useEffect(() => {
    if (submitting || pendingQueue.length === 0) return;
    const activeSession = runtimeSnapshot.sessions.find(session => session.sessionId === selectedSessionId);
    if (isFollowUpSessionBusy(activeSession?.state)) return;
    const next = pendingQueue[0];
    const userMessage = readFollowUpMessages(pane.id).find(message => message.id === next.messageId);
    if (!userMessage) {
      updatePaneData(pane.id, { followUpQueue: pendingQueue.slice(1) });
      return;
    }
    setSubmitting(true);
    dispatchFollowUp(next.prompt, next.attachments, userMessage, selectedSessionId)
      .catch(error => {
        const failed = {
          ...userMessage,
          status: 'failed' as const,
          completedAt: Date.now(),
          content: `${userMessage.content}\n\nFailed to send queued follow-up: ${error instanceof Error ? error.message : String(error)}`,
        };
        updatePaneData(pane.id, {
          followUpMessages: readFollowUpMessages(pane.id).map(message => message.id === failed.id ? failed : message),
        });
        void persistFollowUpMessage(threadId, failed);
      })
      .finally(() => {
        updatePaneData(pane.id, { followUpQueue: readFollowUpQueue(pane.id).filter(item => item.id !== next.id) });
        setSubmitting(false);
      });
  }, [pendingQueue, runtimeSnapshot, selectedSessionId, submitting]);

  async function addAttachments() {
    const selected = await openDialog({ multiple: true, directory: false });
    const paths = Array.isArray(selected) ? selected : selected ? [selected] : [];
    if (paths.length === 0) return;
    const next = [...attachments];
    for (const path of paths) {
      const name = path.split(/[\\/]/).filter(Boolean).pop() || path;
      if (next.some(item => item.path === path)) continue;
      next.push({
        id: generateId(),
        kind: /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(name) ? 'image' : 'file',
        name,
        path,
      });
    }
    updatePaneData(pane.id, { followUpAttachments: next });
  }

  function clearFollowUpContext() {
    if (selectedCli === 'codex' && sdkAbortRef.current) {
      sdkAbortRef.current.abort();
      setSdkStep('Stopping');
    }
    if (selectedSessionId && !selectedSessionId.startsWith('sdk:')) {
      void runtimeManager.stopRuntime({ sessionId: selectedSessionId, reason: 'Cleared follow-up context' });
    }
    pendingSdkAutoContinueRef.current = null;
    updatePaneData(pane.id, {
      followUpThreadId: `thread:${missionId}:${generateId()}`,
      followUpMessages: [],
      followUpAttachments: [],
      followUpQueue: [],
      followUpRuntimeSessionId: null,
    });
    setPrompt('');
  }

  function compactFollowUpContext() {
    const activeSession = runtimeSnapshot.sessions.find(session => session.sessionId === selectedSessionId);
    if (submitting) return;
    if (isFollowUpSessionBusy(activeSession?.state) || messages.length === 0) return;
    const compactedThreadId = `thread:${missionId}:${generateId()}`;
    const compactResult = compactAgentConversation(messages, { keepTail: 8, maxSummaryChars: 4000 });
    const compactedAt = Date.now();
    const compacted: FollowUpMessage = {
      id: generateId(),
      missionId,
      role: 'system',
      cli: selectedCli,
      model: activeSelectedModel || undefined,
      content: `Context compacted.\n\n${compactResult.summary}`,
      status: 'completed',
      createdAt: compactedAt,
      completedAt: compactedAt,
    };
    const retainedMessages = compactResult.retainedMessages.map((message, index) => ({
      ...message,
      id: generateId(),
      createdAt: compactedAt + index + 1,
    }));
    const nextMessages = [compacted, ...retainedMessages].slice(-200);
    updatePaneData(pane.id, {
      followUpThreadId: compactedThreadId,
      followUpMessages: nextMessages,
      followUpQueue: [],
      followUpRuntimeSessionId: null,
    });
    nextMessages.forEach(message => void persistFollowUpMessage(compactedThreadId, message));
  }

  function changePermissionMode(mode: FollowUpPermissionMode) {
    if (mode === selectedPermissionMode) return;
    if (selectedSessionId && !selectedSessionId.startsWith('sdk:')) {
      void runtimeManager.stopRuntime({
        sessionId: selectedSessionId,
        reason: `Permission mode changed to ${permissionModeLabel(mode)}`,
      }).catch(() => {});
    }
    updatePaneData(pane.id, {
      followUpPermissionMode: mode,
      followUpRuntimeSessionId: selectedSessionId?.startsWith('sdk:') ? selectedSessionId : null,
    });
  }

  function changeAgentContext(path: string | null, kind: FollowUpContextKind | null) {
    updatePaneData(pane.id, {
      followUpContextPath: path,
      followUpContextKind: kind,
    });
  }

  const activeRuntimeSession = runtimeSnapshot.sessions.find(session => session.sessionId === selectedSessionId);
  const activePermission = activeRuntimeSession?.activePermission;
  const runtimeStatus = runtimeStatusFor(runtimeSnapshot, selectedSessionId);
  const showThinkingRow = messages.length > 0 && (submitting || isFollowUpSessionBusy(activeRuntimeSession?.state)) && !activePermission;
  const thinkingState = selectedCli === 'codex' ? (sdkStep ?? 'streaming') : (activeRuntimeSession?.state ?? runtimeStatus);
  const showSkills = selectedCli === 'codex' || selectedCli === 'claude';
  const cliOptions = FOLLOW_UP_CLIS.map(cli => ({ value: cli, label: formatFollowUpCliLabel(cli) }));
  const modelOptions = models.length === 0
    ? [{ value: '', label: loadingModels ? 'Discovering models...' : 'Manual/default model' }]
    : models.map(model => ({ value: model.id, label: formatModelLabel(model.label || model.id) }));
  const selectedSkillForToast = skills.find(skill => skill.id === selectedSkillId) ?? null;
  const promptHistory = useMemo(
    () => messages.filter(message => message.role === 'user').map(message => message.content.replace(/\n\nFailed to send.*$/s, '')),
    [messages],
  );
  const attachmentToastItems = [
    ...attachments.map(attachment => ({
      id: attachment.id,
      kind: 'attachment' as const,
      label: attachment.name,
      detail: attachment.kind === 'image' ? 'Image' : 'File',
    })),
    ...(selectedSkillForToast ? [{
      id: `skill:${selectedSkillForToast.id}`,
      kind: 'skill' as const,
      label: selectedSkillForToast.name,
      detail: 'Skill',
    }] : []),
  ];
  const removeAttachmentToastItem = (item: (typeof attachmentToastItems)[number]) => {
    if (item.kind === 'skill') {
      updatePaneData(pane.id, { followUpSkillId: '' });
      return;
    }
    updatePaneData(pane.id, {
      followUpAttachments: attachments.filter(attachment => attachment.id !== item.id),
    });
  };
  const usesCodexCliFallback = selectedCli === 'codex' && !configuredOpenAiApiKey;
  const needsOpenAiApiKey = false;
  const sdkUsageSummary = sdkUsage ? formatSdkUsageSummary(sdkUsage) : '';
  const cardResolutions = useMemo(() => buildSdkCardResolutionMap(messages), [messages]);
  const sdkStatusText = usesCodexCliFallback
    ? 'cli ready'
    : sdkUsageSummary
      ? `sdk ready · ${sdkUsageSummary}`
      : sdkFinishMeta?.hitStepCap
        ? 'sdk paused'
        : 'sdk ready';
  const runtimeHealthText = selectedCli === 'codex' ? sdkStatusText : runtimeStatus;
  const canSend = Boolean(prompt.trim()) && !submitting && !needsOpenAiApiKey;
  const atPromptStart = (target: HTMLTextAreaElement) =>
    target.selectionStart === 0 && target.selectionEnd === 0;
  const atPromptEnd = (target: HTMLTextAreaElement) =>
    target.selectionStart === target.value.length && target.selectionEnd === target.value.length;
  const movePromptHistory = (direction: 'previous' | 'next') => {
    if (promptHistory.length === 0) return;
    const commitPrompt = (value: string) => {
      setPrompt(value);
      window.setTimeout(() => {
        const target = promptInputRef.current;
        if (!target) return;
        const caret = value.length;
        target.focus();
        target.setSelectionRange(caret, caret);
      }, 0);
    };
    const currentIndex = promptHistoryIndexRef.current;
    if (direction === 'previous') {
      if (currentIndex === null) promptHistoryDraftRef.current = prompt;
      const nextIndex = currentIndex === null
        ? promptHistory.length - 1
        : Math.max(0, currentIndex - 1);
      promptHistoryIndexRef.current = nextIndex;
      commitPrompt(promptHistory[nextIndex] ?? '');
      return;
    }
    if (currentIndex === null) return;
    const nextIndex = currentIndex + 1;
    if (nextIndex >= promptHistory.length) {
      promptHistoryIndexRef.current = null;
      commitPrompt(promptHistoryDraftRef.current);
      promptHistoryDraftRef.current = '';
      return;
    }
    promptHistoryIndexRef.current = nextIndex;
    commitPrompt(promptHistory[nextIndex] ?? '');
  };
  const handlePromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void submitFollowUp();
      return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
    if (event.key === 'ArrowUp' && atPromptStart(event.currentTarget)) {
      event.preventDefault();
      movePromptHistory('previous');
      return;
    }
    if (event.key === 'ArrowDown' && atPromptEnd(event.currentTarget)) {
      event.preventDefault();
      movePromptHistory('next');
    }
  };
  const handlePromptChange = (value: string) => {
    promptHistoryIndexRef.current = null;
    promptHistoryDraftRef.current = '';
    setPrompt(value);
  };
  const stopSdkChat = () => {
    sdkAbortRef.current?.abort();
    setSdkStep('Stopping');
  };
  const flushPendingSdkAutoContinue = () => {
    const nextPrompt = getSdkAutoContinueFlushPrompt({
      pendingPrompt: pendingSdkAutoContinueRef.current,
      submitting,
      selectedCli,
      hasApiKey: Boolean(configuredOpenAiApiKey),
    });
    if (!nextPrompt) return;
    pendingSdkAutoContinueRef.current = null;
    void submitFollowUp(nextPrompt, { internal: true });
  };
  const scheduleSdkAutoContinue = (continuePrompt: string = 'continue') => {
    if (!shouldQueueSdkAutoContinue({ selectedCli, hasApiKey: Boolean(configuredOpenAiApiKey) })) return;
    pendingSdkAutoContinueRef.current = continuePrompt;
    if (!submitting) {
      window.setTimeout(flushPendingSdkAutoContinue, 50);
    }
  };
  useEffect(() => {
    if (!getSdkAutoContinueFlushPrompt({
      pendingPrompt: pendingSdkAutoContinueRef.current,
      submitting,
      selectedCli,
      hasApiKey: Boolean(configuredOpenAiApiKey),
    })) return;
    const timer = window.setTimeout(flushPendingSdkAutoContinue, 50);
    return () => window.clearTimeout(timer);
  }, [configuredOpenAiApiKey, selectedCli, submitting]);
  const rememberSdkCommandTerminalId = (terminalId: string) => {
    updatePaneData(pane.id, { followUpSdkCommandTerminalId: terminalId });
  };
  const recordCardAction = (
    content: string,
    status: FollowUpMessage['status'] = 'completed',
    options: FollowUpCardActionOptions = {},
  ) => {
    const now = Date.now();
    const message: FollowUpMessage = {
      id: generateId(),
      missionId,
      role: 'tool',
      cli: selectedCli,
      model: activeSelectedModel || undefined,
      runtimeSessionId: selectedSessionId,
      content,
      status,
      createdAt: now,
      completedAt: now,
    };
    appendFollowUpMessages(pane.id, [message]);
    void persistFollowUpMessage(threadId, message);
    if (options.autoContinue) scheduleSdkAutoContinue(options.continuePrompt ?? 'continue');
  };
  useEffect(() => {
    let unmounted = false;
    let unlistenFn: (() => void) | undefined;
    listen<ChangeReviewAppliedEvent>(CHANGE_REVIEW_APPLIED_EVENT, event => {
      if (unmounted) return;
      const payload = event.payload;
      if (!payload) return;
      if (payload.missionId && payload.missionId !== missionId) return;
      if (payload.threadId && payload.threadId !== threadId) return;
      const now = Date.now();
      const message: FollowUpMessage = {
        id: generateId(),
        missionId,
        role: 'tool',
        cli: 'sdk',
        model: activeSelectedModel || undefined,
        runtimeSessionId: payload.runtimeSessionId ?? selectedSessionId,
        content: formatChangeReviewAppliedActionContent(payload),
        artifactIds: payload.artifactIds,
        filePaths: payload.filePaths,
        status: payload.status,
        createdAt: now,
        completedAt: now,
      };
      appendFollowUpMessages(pane.id, [message]);
      void persistFollowUpMessage(threadId, message);
      scheduleSdkAutoContinue('continue from the patch review result');
    }).then(fn => {
      if (unmounted) fn();
      else unlistenFn = fn;
    }).catch(error => {
      console.debug('[FollowUpComposer] change review listener unavailable in this runtime', error);
    });
    return () => {
      unmounted = true;
      if (unlistenFn) unlistenFn();
    };
  }, [activeSelectedModel, configuredOpenAiApiKey, missionId, pane.id, selectedCli, selectedSessionId, submitting, threadId]);
  const sessionIds = Array.from(new Set([
    ...runtimeSnapshot.sessions
      .filter(session => session.missionId === `adhoc-followup-${missionId}` || session.nodeId.includes(`:${missionId}`))
      .map(session => session.sessionId),
    ...messages.map(message => message.runtimeSessionId).filter((sessionId): sessionId is string => Boolean(sessionId)),
  ]));
  const sessionOptions = [
    { value: '', label: 'New session', description: 'Start with fresh context' },
    ...sessionIds.map(sessionId => {
      const firstUserMessage = messages.find(message => message.runtimeSessionId === sessionId && message.role === 'user');
      const runtimeSession = runtimeSnapshot.sessions.find(session => session.sessionId === sessionId);
      const title = firstUserMessage?.content.split(/\s+/).slice(0, 6).join(' ') || runtimeSession?.role || sessionId.slice(0, 8);
      return {
        value: sessionId,
        label: title.length > 42 ? `${title.slice(0, 39)}...` : title,
        description: runtimeSession?.state ?? 'Previous session',
      };
    }),
  ];
  const contextCharacters = messages.reduce((total, message) => total + message.content.length, 0) +
    attachments.reduce((total, attachment) => total + attachment.name.length + (attachment.path?.length ?? 0), 0);
  const contextPercent = Math.min(100, Math.round((contextCharacters / FOLLOW_UP_CONTEXT_CHAR_BUDGET) * 100));
  const contextRingStyle = { '--td-context-percent': `${contextPercent}%` } as CSSProperties;

  function startNewSession() {
    if (selectedCli === 'codex' && sdkAbortRef.current) {
      sdkAbortRef.current.abort();
      setSdkStep('Stopping');
    }
    updatePaneData(pane.id, {
      followUpThreadId: `thread:${missionId}:${generateId()}`,
      followUpMessages: [],
      followUpAttachments: [],
      followUpQueue: [],
      followUpRuntimeSessionId: null,
    });
    setPrompt('');
  }

  function refreshCapabilities() {
    if (!supportsModelDiscovery(selectedCli)) return;
    if (selectedCli === 'codex') {
      setModels(OPENAI_SDK_MODELS);
    }
    setLoadingModels(true);
    discoverModelsForCli(selectedCli, { refresh: true, workspaceDir: effectiveWorkspaceDir })
      .then(result => setModels(selectedCli === 'codex' ? mergeCodexModels(result.models) : result.models))
      .finally(() => setLoadingModels(false));
    invoke<CliCapabilityDiscovery>('discover_cli_capabilities', {
      cli: selectedCli,
      projectPath: effectiveWorkspaceDir,
      refresh: true,
    })
      .then(result => {
        setSkills(result.skills ?? []);
        setCapabilityWarnings(result.warnings ?? []);
      })
      .catch(error => setCapabilityWarnings([error instanceof Error ? error.message : String(error)]));
  }

  const attachmentMenu = (
    <div className="td-agent-add-menu">
      <button
        type="button"
        className="td-agent-add-option"
        onClick={() => {
          setActiveMenu(null);
          void addAttachments();
        }}
      >
        <Paperclip size={14} />
        <span>Add files or photos</span>
      </button>
      <button
        type="button"
        className="td-agent-add-option"
        onClick={() => {
          setActiveMenu(null);
          setSkillsOpen(true);
          if (showSkills && skills.length === 0) refreshCapabilities();
        }}
      >
        <FileText size={14} />
        <span>Skills</span>
        <ChevronRight size={13} className="ml-auto" />
      </button>
    </div>
  );

  const attachmentToasts = attachmentToastItems.length > 0 ? (
    <div className="td-agent-attachment-toasts">
      {attachmentToastItems.map(item => (
        <span key={item.id} className="td-agent-attachment-toast" title={item.label}>
          <small>{item.detail}</small>
          <span>{item.label}</span>
          <button
            type="button"
            className="td-agent-attachment-remove"
            onClick={() => removeAttachmentToastItem(item)}
            title={`Remove ${item.label}`}
            aria-label={`Remove ${item.label}`}
          >
            <X size={11} />
          </button>
        </span>
      ))}
    </div>
  ) : null;

  const skillsOverlay = skillsOpen ? (
    <div className="td-agent-focus-overlay" role="dialog" aria-label="Skills">
      <button type="button" className="td-agent-focus-backdrop" onClick={() => setSkillsOpen(false)} aria-label="Close skills" />
      <div className="td-agent-skills-panel">
        <div className="td-agent-skills-header">
          <div>
            <span>Skills</span>
            <small>{selectedCli.toUpperCase()} profiles</small>
          </div>
          <button type="button" className="td-agent-icon-button" onClick={() => setSkillsOpen(false)} title="Close skills">
            <X size={14} />
          </button>
        </div>
        <div className="td-agent-skills-list">
          <button
            type="button"
            className={`td-agent-skill-item ${!selectedSkillId ? 'is-selected' : ''}`}
            onClick={() => {
              updatePaneData(pane.id, { followUpSkillId: '' });
              setSkillsOpen(false);
            }}
          >
            <span className="td-agent-skill-icon"><FileText size={15} /></span>
            <span className="td-agent-skill-copy">
              <span>No skill</span>
              <small>Use the selected role without an additional profile.</small>
            </span>
          </button>
          {skills.map(skill => (
            <button
              key={skill.id}
              type="button"
              className={`td-agent-skill-item ${selectedSkillId === skill.id ? 'is-selected' : ''}`}
              title={skill.description ?? skill.sourcePath ?? skill.id}
              onClick={() => {
                updatePaneData(pane.id, { followUpSkillId: skill.id });
                setSkillsOpen(false);
              }}
            >
              <span className="td-agent-skill-icon"><FileText size={15} /></span>
              <span className="td-agent-skill-copy">
                <span>{skill.name}</span>
                <small>{skill.description ?? skill.sourcePath ?? skill.id}</small>
              </span>
            </button>
          ))}
          {skills.length === 0 && (
            <div className="td-agent-skills-empty">
              {capabilityWarnings[0] ?? 'No skills discovered for this runtime yet.'}
            </div>
          )}
        </div>
      </div>
    </div>
  ) : null;

  const rootClass = placement === 'global' || placement === 'tab'
    ? 'td-followup-dock td-followup-dock-global relative w-[min(700px,calc(100vw-2rem))] px-0 pb-0 pt-0'
    : 'td-followup-dock absolute inset-x-0 bottom-0 z-20 px-3 pb-3 pt-10';
  const messagesClass = placement === 'global'
    ? 'mx-auto mb-3 max-h-44 overflow-y-auto space-y-2 pr-1'
    : 'mx-auto mb-3 max-h-56 max-w-[980px] overflow-y-auto space-y-2 pr-1';
  const shellClass = placement === 'global'
    ? 'td-followup-glass mx-auto rounded-2xl p-2'
    : 'td-followup-glass mx-auto max-w-[980px] rounded-2xl p-2';

  if (placement === 'global' || placement === 'tab') {
    const outerClass = placement === 'tab'
      ? 'td-followup-dock td-followup-dock-global td-followup-dock-tab relative h-full w-full px-0 pb-0 pt-0'
      : 'td-followup-dock td-followup-dock-global relative w-[min(640px,calc(100vw-2rem))] px-0 pb-0 pt-0';
    const agentWindowClass = [
      'td-agent-window',
      placement === 'tab' ? 'td-agent-window-tab' : '',
      skillsOpen ? 'is-skills-open' : '',
    ].filter(Boolean).join(' ');
    return (
      <div className={outerClass}>
        <div className={agentWindowClass}>
          {skillsOverlay}
          <div className="td-agent-window-header">
            <FollowUpSelect
              menuId="agent-role"
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              value={selectedAgent?.id ?? ''}
              options={agentRoleOptions}
              onChange={value => updatePaneData(pane.id, { followUpAgentRoleId: value })}
              title="Agent type"
              className="td-agent-role-select"
              visibleOptions={8}
              side="bottom"
              align="start"
            />
            <button
              type="button"
              className="td-agent-context"
              onClick={onOpenWorkspace}
              title="Open workspace"
            >
              <span className="td-agent-context-percent">{contextPercent}%</span>
              <span className="td-agent-context-ring" style={contextRingStyle} aria-hidden="true" />
            </button>
            <div className="td-agent-header-spacer" />
            <FollowUpSelect
              menuId="session"
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              value={selectedSessionId ?? ''}
              options={sessionOptions}
              onChange={value => {
                if (!value) {
                  startNewSession();
                  return;
                }
                updatePaneData(pane.id, { followUpRuntimeSessionId: value });
              }}
              title="Session"
              className="td-agent-session-select"
              visibleOptions={8}
              side="bottom"
              align="end"
            />
            {onOpenInTab && (
              <button type="button" className="td-agent-icon-button" onClick={onOpenInTab} title="Open agent in tab">
                <Maximize2 size={15} />
              </button>
            )}
            {onMinimizeToDock && (
              <button type="button" className="td-agent-icon-button" onClick={onMinimizeToDock} title="Return agent to dock">
                <Minimize2 size={15} />
              </button>
            )}
            {onCollapse && (
              <button type="button" className="td-agent-icon-button" onClick={onCollapse} title="Collapse">
                <ChevronDown size={15} />
              </button>
            )}
            {onHide && (
              <button type="button" className="td-agent-icon-button" onClick={onHide} title="Hide">
                <X size={15} />
              </button>
            )}
          </div>

          <div className="td-agent-chat-area">
            {messages.length === 0 ? (
                <div className="td-agent-empty-state">
                  <img className="td-agent-empty-logo" src="/comet-ai-logo.svg" alt="" aria-hidden="true" />
                  <div className="td-agent-empty-copy">
                    <h3>Ask the agent anything</h3>
                    <p>The agent can use the workspace, recent context, and selected runtime.</p>
                </div>
                <div className="td-agent-starters">
                  {FOLLOW_UP_STARTERS.map(starter => (
                    <button
                      key={starter.label}
                      type="button"
                      className="td-agent-starter-pill"
                      disabled={submitting}
                      onClick={() => void submitFollowUp(starter.prompt)}
                    >
                      <span className="td-agent-starter-icon">{starter.icon}</span>
                      <span className="td-agent-starter-copy">
                        <span>{starter.label}</span>
                        <small>{starter.description}</small>
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            ) : (
              <div className="td-agent-message-list">
                {messages.map(message => (
                  <FollowUpChatMessage
                    key={message.id}
                    message={message}
                    onCardAction={recordCardAction}
                    sdkCommandTerminalId={sdkCommandTerminalId}
                    onSdkCommandTerminalId={rememberSdkCommandTerminalId}
                    cardResolutions={cardResolutions}
                  />
                ))}
        {showThinkingRow && <AgentThinkingRow state={thinkingState} />}
              </div>
            )}
          </div>

          {activePermission && selectedSessionId && (
            <div className="td-agent-permission">
              <div className="truncate">{activePermission.detail}</div>
              <div className="flex items-center gap-2">
                <button type="button" onClick={() => void runtimeManager.resolvePermission({ sessionId: selectedSessionId, permissionId: activePermission.permissionId, decision: 'approve' })}>
                  Approve
                </button>
                <button type="button" onClick={() => void runtimeManager.resolvePermission({ sessionId: selectedSessionId, permissionId: activePermission.permissionId, decision: 'deny' })}>
                  Deny
                </button>
              </div>
            </div>
          )}

          <div className="td-agent-prompt-pill">
            {attachmentToasts}
            <textarea
              ref={promptInputRef}
              value={prompt}
              onChange={event => handlePromptChange(event.target.value)}
              onKeyDown={handlePromptKeyDown}
              placeholder="Ask the agent from this workspace..."
              className="td-agent-prompt-input"
            />
            <div className="td-agent-prompt-controls">
              <div className="td-agent-prompt-left">
                <div className="td-agent-add-control">
                  <button
                    type="button"
                    onClick={() => setActiveMenu(activeMenu === 'agent-add' ? null : 'agent-add')}
                    className={`td-agent-add-button ${activeMenu === 'agent-add' ? 'is-open' : ''}`}
                    title="Add context"
                  >
                    <Plus size={15} />
                  </button>
                  {activeMenu === 'agent-add' && attachmentMenu}
                </div>
                <FollowUpSelect
                  menuId="cli"
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  value={selectedCli}
                  options={cliOptions}
                  onChange={value => updatePaneData(pane.id, { followUpCli: value as CliId, followUpModel: '', followUpSkillId: '', followUpRuntimeSessionId: null })}
                  title="CLI"
                />
                <FollowUpSelect
                  menuId="model"
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  value={activeSelectedModel}
                  options={modelOptions}
                  onChange={value => updatePaneData(pane.id, { followUpModel: value, followUpRuntimeSessionId: null })}
                  title="Model"
                  className="td-agent-model-select"
                />
                <PermissionModePicker
                  cli={selectedCli}
                  mode={selectedPermissionMode}
                  sdkBacked={usesSdkTransport}
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  onChange={changePermissionMode}
                  disabled={submitting}
                />
                <AgentDirectoryPicker
                  activeFilePath={activeFilePath}
                  workspaceDir={effectiveWorkspaceDir}
                  contextPath={selectedContextPath}
                  contextKind={selectedContextKind}
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  runtimeStatus={runtimeHealthText}
                  onSelectContext={changeAgentContext}
                />
                {pendingQueue.length > 0 && <span className="td-agent-small-status is-warn">{pendingQueue.length} queued</span>}
              </div>
              <div className="td-agent-prompt-right">
                {submitting && selectedCli === 'codex' && (
                  <button type="button" onClick={stopSdkChat} className="td-agent-icon-button" title="Stop">
                    <Square size={14} />
                  </button>
                )}
                {submitting && selectedCli !== 'codex' && selectedSessionId && (
                  <button type="button" onClick={() => selectedSessionId && runtimeManager.stopRuntime({ sessionId: selectedSessionId, reason: 'Stopped from follow-up composer' })} className="td-agent-icon-button" title="Stop">
                    <Square size={14} />
                  </button>
                )}
                <button type="button" onClick={refreshCapabilities} className="td-agent-icon-button" title="Refresh models and skills">
                  <RefreshCw size={14} />
                </button>
                <button type="button" onClick={clearFollowUpContext} className="td-followup-text-button" title="Clear conversation and context">
                  <Eraser size={13} />
                  <span>Clear</span>
                </button>
                <button type="button" onClick={compactFollowUpContext} disabled={submitting} className="td-followup-text-button" title="Compact context">
                  <Minimize2 size={13} />
                  <span>Compact</span>
                </button>
                <button
                  type="button"
                  onClick={() => void submitFollowUp()}
                  disabled={!canSend}
                  className={`td-followup-send ${canSend ? 'is-ready' : ''}`}
                  title="Send"
                >
                  <ArrowUp size={16} />
                </button>
              </div>
            </div>
            {showSkills && skills.length === 0 && capabilityWarnings.length > 0 && (
              <div className="td-agent-capability-warning">{capabilityWarnings[0]}</div>
            )}
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={rootClass}>
      {messages.length > 0 && (
        <div className={messagesClass}>
          {messages.map(message => (
            <FollowUpChatMessage
              key={message.id}
              message={message}
              onCardAction={recordCardAction}
              sdkCommandTerminalId={sdkCommandTerminalId}
              onSdkCommandTerminalId={rememberSdkCommandTerminalId}
              cardResolutions={cardResolutions}
            />
          ))}
          {showThinkingRow && <AgentThinkingRow state={thinkingState} />}
        </div>
      )}
      <div className={shellClass}>
        {skillsOverlay}
        {attachmentToasts}
        <textarea
          ref={promptInputRef}
          value={prompt}
          onChange={event => handlePromptChange(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder="Continue this mission..."
          className="min-h-[76px] w-full resize-none bg-transparent px-2 py-1 text-sm text-text-primary placeholder:text-text-muted outline-none"
        />
        {activePermission && selectedSessionId && (
          <div className="mb-2 rounded-lg border border-yellow-500/30 bg-yellow-500/10 px-2 py-2 text-[11px] text-yellow-100">
            <div className="mb-2 truncate">{activePermission.detail}</div>
            <div className="flex items-center gap-2">
              <button type="button" onClick={() => void runtimeManager.resolvePermission({ sessionId: selectedSessionId, permissionId: activePermission.permissionId, decision: 'approve' })} className="rounded bg-green-600 px-2 py-1 text-white">
                Approve
              </button>
              <button type="button" onClick={() => void runtimeManager.resolvePermission({ sessionId: selectedSessionId, permissionId: activePermission.permissionId, decision: 'deny' })} className="rounded bg-red-600 px-2 py-1 text-white">
                Deny
              </button>
            </div>
          </div>
        )}
        <div className="flex items-center justify-between gap-2 border-t border-white/10 pt-2">
          <div className="flex items-center gap-1.5 min-w-0">
            <div className="td-agent-add-control">
              <button
                type="button"
                onClick={() => setActiveMenu(activeMenu === 'agent-add' ? null : 'agent-add')}
                className={`td-agent-add-button ${activeMenu === 'agent-add' ? 'is-open' : ''}`}
                title="Add context"
              >
                <Plus size={15} />
              </button>
              {activeMenu === 'agent-add' && attachmentMenu}
            </div>
            <FollowUpSelect
              menuId="cli"
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              value={selectedCli}
              options={cliOptions}
              onChange={value => updatePaneData(pane.id, { followUpCli: value as CliId, followUpModel: '', followUpSkillId: '', followUpRuntimeSessionId: null })}
              title="Agent"
            />
            <FollowUpSelect
              menuId="model"
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              value={activeSelectedModel}
              options={modelOptions}
              onChange={value => updatePaneData(pane.id, { followUpModel: value, followUpRuntimeSessionId: null })}
              title="Model"
              className="max-w-[190px]"
            />
            <PermissionModePicker
              cli={selectedCli}
              mode={selectedPermissionMode}
              sdkBacked={usesSdkTransport}
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              onChange={changePermissionMode}
              disabled={submitting}
            />
            <AgentDirectoryPicker
              activeFilePath={activeFilePath}
              workspaceDir={effectiveWorkspaceDir}
              contextPath={selectedContextPath}
              contextKind={selectedContextKind}
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              runtimeStatus={runtimeHealthText}
              onSelectContext={changeAgentContext}
            />
            {pendingQueue.length > 0 && <span className="text-[10px] text-yellow-300">{pendingQueue.length} queued</span>}
            {showSkills && skills.length === 0 && capabilityWarnings.length > 0 && (
              <span className="hidden md:inline text-[10px] text-text-muted truncate">{capabilityWarnings[0]}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {submitting && selectedCli === 'codex' && (
              <button type="button" onClick={stopSdkChat} className="p-1.5 rounded text-text-muted hover:text-red-300" title="Stop">
                <Square size={14} />
              </button>
            )}
            {submitting && selectedCli !== 'codex' && selectedSessionId && (
              <button type="button" onClick={() => selectedSessionId && runtimeManager.stopRuntime({ sessionId: selectedSessionId, reason: 'Stopped from follow-up composer' })} className="p-1.5 rounded text-text-muted hover:text-red-300" title="Stop">
                <Square size={14} />
              </button>
            )}
            <button
              type="button"
              onClick={refreshCapabilities}
              className="p-1.5 rounded text-text-muted hover:text-text-primary"
              title="Refresh models and skills"
            >
              <RefreshCw size={14} />
            </button>
            <button
              type="button"
              onClick={clearFollowUpContext}
              className="td-followup-text-button"
              title="Clear conversation and context"
            >
              <Eraser size={13} />
              <span>Clear</span>
            </button>
            <button
              type="button"
              onClick={compactFollowUpContext}
              disabled={submitting}
              className="td-followup-text-button"
              title="Compact context"
            >
              <Minimize2 size={13} />
              <span>Compact</span>
            </button>
            <button
              type="button"
              onClick={() => void submitFollowUp()}
              disabled={!canSend}
              className={`td-followup-send ${canSend ? 'is-ready' : ''}`}
              title="Send"
            >
              <ArrowUp size={16} />
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function formatAttachmentList(attachments: FollowUpMessage['attachments']): string {
  return attachments && attachments.length > 0
    ? `Attached files:\n${attachments.map(item => `- ${item.name}${item.path ? `: ${item.path}` : ''}`).join('\n')}`
    : '';
}

async function buildSdkAttachmentContext(attachments: FollowUpMessage['attachments']): Promise<string> {
  if (!attachments || attachments.length === 0) return '';
  const items = await Promise.all(attachments.map(async attachment => {
    const item: SdkChatAttachmentContextItem = {
      name: attachment.name,
      path: attachment.path,
      kind: attachment.kind,
    };
    if (attachment.kind !== 'file' || !attachment.path) return item;
    try {
      const read = await readSdkWorkspaceTextFile(attachment.path, path => invoke<string>('workspace_read_text_file', { path }));
      item.content = read.content;
    } catch (error) {
      item.error = error instanceof Error ? error.message : String(error);
    }
    return item;
  }));
  return formatSdkAttachmentContext(items);
}

async function buildSdkImageAttachments(attachments: FollowUpMessage['attachments']): Promise<SdkChatImageAttachment[]> {
  if (!attachments || attachments.length === 0) return [];
  const images = attachments.filter(attachment => attachment.kind === 'image');
  return Promise.all(images.map(async attachment => {
    const image: SdkChatImageAttachment = {
      name: attachment.name,
      path: attachment.path,
      mediaType: inferSdkImageMediaType(attachment.path || attachment.name),
    };
    if (!attachment.path) return image;
    try {
      image.base64 = await invoke<string>('workspace_read_binary_file_base64', { path: attachment.path });
    } catch (error) {
      image.error = error instanceof Error ? error.message : String(error);
    }
    return image;
  }));
}

function readFollowUpMessages(paneId: string): FollowUpMessage[] {
  const panes = useWorkspaceStore.getState().tabs.flatMap(tab => tab.panes);
  return panes.find(pane => pane.id === paneId)?.data?.followUpMessages ?? [];
}

function readFollowUpQueue(paneId: string): FollowUpPendingItem[] {
  const panes = useWorkspaceStore.getState().tabs.flatMap(tab => tab.panes);
  return panes.find(pane => pane.id === paneId)?.data?.followUpQueue ?? [];
}

function parseJsonArray(value: string | null | undefined): any[] | undefined {
  if (!value) return undefined;
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function persistFollowUpMessage(threadId: string, message: FollowUpMessage): Promise<void> {
  return missionRepository.upsertFollowUpMessage({
    id: message.id,
    missionId: message.missionId,
    threadId,
    runId: message.runId ?? null,
    role: message.role,
    cli: message.cli ?? null,
    model: message.model ?? null,
    runtimeSessionId: message.runtimeSessionId ?? null,
    content: message.content,
    attachmentsJson: message.attachments ? JSON.stringify(message.attachments) : null,
    artifactIdsJson: message.artifactIds ? JSON.stringify(message.artifactIds) : null,
    filePathsJson: message.filePaths ? JSON.stringify(message.filePaths) : null,
    status: message.status ?? null,
    createdAt: message.createdAt,
    completedAt: message.completedAt ?? null,
  }).catch(error => {
    console.debug('[FollowUpComposer] follow-up persistence unavailable in this runtime', error);
  });
}

function summarizeRuntimeEventForFollowUp(event: import('../../lib/runtime/RuntimeTypes').RuntimeManagerEvent): string | null {
  switch (event.type) {
    case 'session_created':
      return `Runtime session created.`;
    case 'task_injected':
      return `Sent to runtime session ${event.sessionId}.`;
    case 'task_acked':
      return `Runtime acknowledged the follow-up task.`;
    case 'permission_requested':
      return `Waiting for permission: ${event.request.detail}`;
    case 'permission_resolved':
      return `Permission ${event.decision}: ${event.permissionId}.`;
    case 'session_completed':
      return `Runtime session completed with ${event.outcome}.`;
    case 'session_failed':
      return `Runtime session failed: ${event.error}`;
    case 'session_disconnected':
      return `Runtime session disconnected: ${event.reason}`;
    case 'artifact_published':
      return `Artifact: ${event.artifact.label}${event.artifact.path ? ` (${event.artifact.path})` : ''}`;
    case 'completion_contract_missing':
      return event.summary ?? event.error ?? 'Completion contract still pending.';
    case 'post_ack_watchdog':
      return event.message ?? `Agent watchdog ${event.action}: ${event.reason}.`;
    default:
      return null;
  }
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
  const workflowEvents = useWorkflowEvents(currentMissionId, 200);
  const missionSnapshot = useMissionSnapshot(currentMissionId);
  const showDiagnostics = false;

  const results = useWorkspaceStore(s => s.results);
  const messages = useWorkspaceStore(s => s.messages);
  const allTasks = useWorkspaceStore(s => s.tasks);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const setNodeRuntimeBinding = useWorkspaceStore(s => s.setNodeRuntimeBinding);
  const addPane = useWorkspaceStore(s => s.addPane);

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

  const progressRows = useMemo(
    () => deriveMissionProgressRows({ mission, agents, snapshot: missionSnapshot, events: workflowEvents }),
    [agents, mission, missionSnapshot, workflowEvents],
  );

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
    }).then(fn => { if (unmounted) fn(); else unlistenSpawnFn = fn; }).catch(error => {
      console.debug('[MissionControlPane] pty-spawned listener unavailable in this runtime', error);
    });

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
    }).then(fn => { if (unmounted) fn(); else unlistenExitFn = fn; }).catch(error => {
      console.debug('[MissionControlPane] pty-exit listener unavailable in this runtime', error);
    });

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
    }).then(fn => { if (unmounted) fn(); else unlistenActivationFn = fn; }).catch(error => {
      console.debug('[MissionControlPane] runtime activation listener unavailable in this runtime', error);
    });

    listen<{ nodeId: string; missionId: string; message: string }>('workflow-runtime-warning', (event) => {
      if (unmounted) return;
      const { nodeId, missionId, message } = event.payload;
      if (currentMissionId && currentMissionId !== missionId) return;
      const nextAgents = readAgentsForPane(pane.id, agents).map(agent =>
        agent.nodeId === nodeId ? { ...agent, lastError: message, runtimeBootstrapReason: message } : agent
      );
      updatePaneData(pane.id, { agents: nextAgents });
    }).then(fn => { unlistenWarningFn = fn; if (unmounted) fn(); }).catch(error => {
      console.debug('[MissionControlPane] runtime warning listener unavailable in this runtime', error);
    });

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
    }).then(fn => { if (unmounted) fn(); else unlistenUpdateFn = fn; }).catch(error => {
      console.debug('[MissionControlPane] node update listener unavailable in this runtime', error);
    });

    return () => {
      unmounted = true;
      if (unlistenActivationFn) unlistenActivationFn();
      if (unlistenUpdateFn) unlistenUpdateFn();
      if (unlistenWarningFn) unlistenWarningFn();
    };
  }, [agents, currentMissionId, pane.id, setNodeRuntimeBinding, updatePaneData]);

  const markdownEntries = results.filter(entry => entry.type === 'markdown');
  const changeReviewArtifacts = useMemo(() => {
    const localArtifacts = agents.flatMap(agent =>
      (agent.artifacts ?? []).map(artifact => ({
        id: artifact.id,
        title: artifact.label,
        kind: artifact.type,
        path: artifact.path ?? null,
        contentText: artifact.content ?? null,
      }))
    );
    const durableArtifacts = (missionSnapshot?.artifacts ?? []).map(artifact => ({
      id: artifact.id,
      title: artifact.title,
      kind: artifact.kind,
      path: artifact.contentUri,
      contentText: artifact.contentText,
    }));
    const byId = new Map([...durableArtifacts, ...localArtifacts].map(artifact => [artifact.id, artifact]));
    return Array.from(byId.values());
  }, [agents, missionSnapshot?.artifacts]);
  const changeReviewFiles = useMemo(
    () => Array.from(new Set(progressRows.flatMap(row => row.files ?? []))).sort((a, b) => a.localeCompare(b)),
    [progressRows],
  );
  const hasChangeReviewData = changeReviewArtifacts.some(artifact =>
    artifact.kind === 'file_change' ||
    artifact.kind === 'patch' ||
    Boolean(artifact.contentText?.includes('@@ '))
  ) || changeReviewFiles.length > 0;

  const openChangeReview = () => {
    addPane('changereview', 'Review Changes', {
      missionId: currentMissionId,
      artifacts: changeReviewArtifacts,
      files: changeReviewFiles,
    });
  };

  const minimizeAgentTabToDock = () => {
    useWorkspaceStore.setState(state => {
      const sourceTab = state.tabs.find(tab => tab.panes.some(candidate => candidate.id === pane.id));
      if (!sourceTab) return state;

      const dockPane: Pane = {
        ...pane,
        title: 'Workspace Agent',
        gridPos: { x: 0, y: 0, w: 1, h: 1 },
        data: {
          ...pane.data,
          dockOnly: true,
          dockExpandedToTab: false,
          dockReturnOpenAt: Date.now(),
        },
      };
      const nextTabs = state.tabs.map(tab => tab.id === sourceTab.id
        ? {
            ...tab,
            panes: tab.panes.map(candidate => candidate.id === pane.id ? dockPane : candidate),
          }
        : tab);
      const firstVisiblePane = sourceTab.panes.find(candidate => candidate.id !== pane.id && candidate.data?.dockOnly !== true);
      return {
        tabs: nextTabs,
        activeTabId: sourceTab.id,
        activePaneId: firstVisiblePane?.id ?? null,
      };
    });
  };

  if (pane.data?.dockExpandedToTab === true && currentMissionId) {
    return (
      <div className="td-agent-tab-surface">
        <FollowUpComposer
          pane={pane}
          mission={mission}
          missionId={currentMissionId}
          taskDescription={taskDescription || 'Workspace agent'}
          progressRows={progressRows}
          placement="tab"
          workspaceDir={pane.data?.workspaceDir as string | undefined}
          onMinimizeToDock={minimizeAgentTabToDock}
        />
      </div>
    );
  }

  return (
    <div className="relative h-full background-bg-panel overflow-hidden">
      <div className="absolute inset-0 overflow-y-auto pb-6">
        <ProgressReport rows={progressRows} missionTitle={taskDescription} />
        {hasChangeReviewData && (
          <div className="mx-auto -mt-3 mb-4 flex w-full max-w-[640px] justify-center px-4">
            <button
              type="button"
              onClick={openChangeReview}
              className="inline-flex items-center gap-2 rounded-md border border-border-panel bg-bg-surface px-3 py-1.5 text-xs text-text-secondary shadow-sm hover:border-accent-primary/50 hover:text-text-primary"
            >
              <FileText size={13} className="text-accent-primary" />
              Review agent changes
            </button>
          </div>
        )}
        {showDiagnostics && (
          <div className="px-3 py-3 space-y-3">
            {currentMissionId && <MissionSummary missionId={currentMissionId} />}
            <HandoffTimeline entries={handoffTimeline} />
            {orderedAgents.map(agent => (
              <NodeCard key={`${agent.nodeId ?? agent.terminalId}`} agent={agent} onOpenTerminal={openTerminal} />
            ))}
          </div>
        )}
      </div>

      {showDiagnostics && (
        <div className="hidden">
          <button onClick={() => setTab('nodes')}><TerminalSquare size={11} /> Nodes</button>
          <button onClick={() => setTab('preview')}><Monitor size={11} /> Preview</button>
          <button onClick={() => setTab('output')}><FileText size={11} /> Output</button>
          <button onClick={() => setTab('tasks')}><ListTree size={11} /> Tasks</button>
        </div>
      )}

      {showDiagnostics && tab === 'output' && (
        <div ref={outputRef} className="flex-1 overflow-y-auto px-3 py-3 space-y-3 font-mono text-xs text-text-secondary">
          {markdownEntries.map(entry => (
            <div key={entry.id} className="prose prose-invert max-w-none p-3 border border-border-panel rounded-md">
              <ReactMarkdown>{entry.content}</ReactMarkdown>
            </div>
          ))}
        </div>
      )}

      {showDiagnostics && tab === 'tasks' && <TaskTreePanel tasks={allTasks} />}

    </div>
  );
}

function TaskRow({ task, depth }: { task: DbTaskTree; depth: number }) {
  return (
    <div className="py-1.5 border-b border-border-panel/40 px-3" style={{ paddingLeft: `${12 + depth * 16}px` }}>
      <span className="text-[11px] text-text-secondary">{task.title}</span>
      <span className="ml-2 text-[10px] text-accent-primary uppercase font-bold">{task.status}</span>
      {task.children?.map(child => <TaskRow key={child.id} task={child} depth={depth + 1} />)}
    </div>
  );
}

function TaskTreePanel({ tasks }: { tasks: DbTaskTree[] }) {
  const roots = tasks.filter(t => t.parent_id === null);
  return (
    <div className="flex-1 overflow-y-auto">
      {roots.map(task => <TaskRow key={task.id} task={task} depth={0} />)}
    </div>
  );
}
