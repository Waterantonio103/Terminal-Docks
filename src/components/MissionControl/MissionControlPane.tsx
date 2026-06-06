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
  Pencil,
  Trash2,
} from 'lucide-react';
import ReactMarkdown from 'react-markdown';
import { createPortal } from 'react-dom';
import { invoke } from '@tauri-apps/api/core';
import { open as openDialog } from '@tauri-apps/plugin-dialog';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import { emit, listen } from '@tauri-apps/api/event';
import {
  siClaude,
  siClaudecode,
  siGooglegemini,
  type SimpleIcon,
} from 'simple-icons';
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
import type { RuntimeManagerSnapshot, RuntimePermissionRequest, RuntimeSessionState } from '../../lib/runtime/RuntimeTypes';
import { generateId } from '../../lib/graphUtils';
import { missionRepository } from '../../lib/missionRepository';
import {
  buildAgentConversationContext,
  classifyAgentStatusMessage,
  compactAgentCommandOutput,
  compactAgentConversation,
  compactAgentShellCommandForDisplay,
  stripAgentConversationContextLabels,
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
  createUnifiedDiff,
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
import {
  buildAgentSlashCommandSuggestions,
  buildPlanPrompt,
  findAgentSlashCommand,
  parseAgentSlashCommand,
  resolveAgentRoleArgument,
  resolveAgentSlashCommand,
  resolveModelArgument,
  slashCommandHelpText,
  type AgentSlashCommandId,
  type AgentSlashSuggestion,
} from '../../lib/agentSlashCommands';
import { parseCodexContextUsage } from '../../lib/codexContextUsage';
import {
  parseAgentUsageLimitMessage,
  parseAgentUsageLimits,
  type AgentUsageLimitPayload,
  type AgentUsageLimitRow,
} from '../../lib/agentUsageLimits';

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
  skipSlashProcessing?: boolean;
  displayContent?: string;
};
type FollowUpContextKind = 'file' | 'folder';
type DebugAgentPromptPayload = {
  requestId?: string;
  debugRunId?: string;
  prompt: string;
  targetPaneId?: string;
  displayContent?: string;
  skipSlashProcessing?: boolean;
  label?: string;
};

interface FollowUpMessage {
  id: string;
  missionId: string;
  runId?: string;
  role: FollowUpRole;
  cli?: string;
  model?: string;
  runtimeSessionId?: string;
  toolEventId?: string;
  content: string;
  attachments?: Array<{ id: string; kind: 'file' | 'image'; name: string; path?: string }>;
  artifactIds?: string[];
  filePaths?: string[];
  status?: 'queued' | 'sending' | 'streaming' | 'completed' | 'failed' | 'cancelled';
  createdAt: number;
  completedAt?: number;
}

type AgentTokenUsage = {
  inputTokens: number;
  outputTokens: number;
  cachedInputTokens: number;
  contextInputTokens?: number;
};

const AGENT_TOKEN_USAGE_PREFIX = '__COMET_AGENT_TOKEN_USAGE__';
const AGENT_SESSION_TITLE_PREFIX = 'Session title:';
const AGENT_SESSION_TITLE_RE = /^\s*(?:[-•●*]\s*)?(?:Session|Conversation|Chat)\s+title\s*(?::|-|—|=)\s*([^\r\n]{1,90})(?:\r?\n|$)/i;
const DEBUG_AGENT_PROMPT_MESSAGE_TYPE = 'debug_agent_prompt';

function parseDebugAgentPromptPayload(value: unknown): DebugAgentPromptPayload | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as { type?: unknown; content?: unknown };
  if (record.type !== DEBUG_AGENT_PROMPT_MESSAGE_TYPE || typeof record.content !== 'string') return null;
  try {
    const parsed = JSON.parse(record.content) as Partial<DebugAgentPromptPayload>;
    const prompt = typeof parsed.prompt === 'string' ? parsed.prompt.trim() : '';
    if (!prompt) return null;
    return {
      requestId: typeof parsed.requestId === 'string' ? parsed.requestId : undefined,
      debugRunId: typeof parsed.debugRunId === 'string' ? parsed.debugRunId : undefined,
      prompt,
      targetPaneId: typeof parsed.targetPaneId === 'string' && parsed.targetPaneId.trim() ? parsed.targetPaneId.trim() : undefined,
      displayContent: typeof parsed.displayContent === 'string' ? parsed.displayContent : undefined,
      skipSlashProcessing: parsed.skipSlashProcessing === true,
      label: typeof parsed.label === 'string' ? parsed.label : undefined,
    };
  } catch {
    return null;
  }
}

function normalizeAgentTokenUsage(value: Partial<AgentTokenUsage> | null | undefined): AgentTokenUsage | null {
  if (!value) return null;
  const inputTokens = Number.isFinite(value.inputTokens) ? Math.max(0, Math.round(value.inputTokens ?? 0)) : 0;
  const outputTokens = Number.isFinite(value.outputTokens) ? Math.max(0, Math.round(value.outputTokens ?? 0)) : 0;
  const cachedInputTokens = Number.isFinite(value.cachedInputTokens) ? Math.max(0, Math.round(value.cachedInputTokens ?? 0)) : 0;
  const contextInputTokens = Number.isFinite(value.contextInputTokens)
    ? Math.max(0, Math.round(value.contextInputTokens ?? 0))
    : undefined;
  if (inputTokens <= 0 && outputTokens <= 0 && cachedInputTokens <= 0 && !contextInputTokens) return null;
  return { inputTokens, outputTokens, cachedInputTokens, ...(contextInputTokens ? { contextInputTokens } : {}) };
}

function mergeAgentTokenUsage(previous: AgentTokenUsage | null, delta: Partial<AgentTokenUsage>): AgentTokenUsage {
  return {
    inputTokens: (previous?.inputTokens ?? 0) + Math.max(0, Math.round(delta.inputTokens ?? 0)),
    outputTokens: (previous?.outputTokens ?? 0) + Math.max(0, Math.round(delta.outputTokens ?? 0)),
    cachedInputTokens: (previous?.cachedInputTokens ?? 0) + Math.max(0, Math.round(delta.cachedInputTokens ?? 0)),
    contextInputTokens: Math.max(0, Math.round(delta.contextInputTokens ?? delta.inputTokens ?? previous?.contextInputTokens ?? 0)),
  };
}

function appendAgentTokenUsage(content: string, usage: AgentTokenUsage | null): string {
  const visible = stripAgentTokenUsage(content);
  const normalized = normalizeAgentTokenUsage(usage);
  if (!normalized) return visible;
  return `${visible}\n\n${AGENT_TOKEN_USAGE_PREFIX}${JSON.stringify(normalized)}`;
}

function parseAgentTokenUsage(content: string): AgentTokenUsage | null {
  const match = content.match(new RegExp(`(?:\\n\\n)?${AGENT_TOKEN_USAGE_PREFIX}(\\{[^\\n]*\\})\\s*$`));
  if (!match) return null;
  try {
    return normalizeAgentTokenUsage(JSON.parse(match[1]) as Partial<AgentTokenUsage>);
  } catch {
    return null;
  }
}

function stripAgentTokenUsage(content: string): string {
  return content.replace(new RegExp(`(?:\\n\\n)?${AGENT_TOKEN_USAGE_PREFIX}\\{[^\\n]*\\}\\s*$`), '').trimEnd();
}

function cleanAgentSessionTitle(value: string | null | undefined, fallback = 'Workspace chat'): string {
  const cleaned = (value ?? '')
    .replace(/\0/g, '')
    .replace(/^["'`]+|["'`.]+$/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  const title = cleaned || fallback;
  return title.length > 52 ? `${title.slice(0, 49).trimEnd()}...` : title;
}

function sessionTitleFromPrompt(prompt: string): string {
  const cleaned = prompt
    .replace(/[`*_#>\[\](){}]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (!cleaned) return 'Workspace chat';
  const words = cleaned.split(' ').slice(0, 7).join(' ');
  return cleanAgentSessionTitle(words, 'Workspace chat');
}

function extractAgentSessionTitle(content: string): { title: string | null; content: string } {
  const withoutUsage = stripAgentTokenUsage(content);
  const match = withoutUsage.match(AGENT_SESSION_TITLE_RE);
  if (!match) return { title: null, content: withoutUsage };
  return {
    title: cleanAgentSessionTitle(match[1], 'Workspace chat'),
    content: withoutUsage.slice(match[0].length).trimStart(),
  };
}

function stripAgentSessionTitle(content: string): string {
  return extractAgentSessionTitle(content).content;
}

const AGENT_TRANSCRIPT_BUSY_LINE_RE =
  /^\s*(?:[⠐⠂⠒⠲⠴⠦⠖⠆⠋⠙⠹⠸⠼⠧⠇⠏]\s*)?(?:[-•●◦*]\s*)?(?:Working|Thinking|Starting|Streaming|Processing|Analyzing|Planning)\b.*(?:esc|interrupt|ctrl-c|MCP).*\s*$/i;
const AGENT_TRANSCRIPT_STATUS_ONLY_LINE_RE =
  /^\s*(?:[⠐⠂⠒⠲⠴⠦⠖⠆⠋⠙⠹⠸⠼⠧⠇⠏]\s*)?(?:[-•●◦*]\s*)?(?:Working|Thinking|Starting|Streaming|Processing|Analyzing|Planning)\s*$/i;
const AGENT_TRANSCRIPT_REDRAW_FRAGMENT_RE =
  /^\s*(?:[-•●◦*]\s*)?(?:\d+|W|Wo|Wog\d*|Wng\d*|or|rk|ki|in|ng|g)\s*$/i;
const AGENT_TRANSCRIPT_PERMISSION_LINE_RE =
  /^\s*(?:[│|]\s*)?(?:Would you like to run the following command\??|Press enter to confirm or esc to cancel|[›>]\s*[123]\.\s+|[123]\.\s+(?:Yes|No)|Yes,\s|No,\s|✔\s*You approved\b)/i;

function stripAgentRuntimeTranscriptNoise(content: string): string {
  const withoutPermissionBlocks = content.replace(
    /\n?\s*(?:[│|]\s*)?Would you like to run the following command\??[\s\S]*?Press enter to confirm or esc to cancel\s*/gi,
    '\n',
  );
  return stripAgentConversationContextLabels(withoutPermissionBlocks)
    .split(/\r?\n/)
    .filter(line => {
      const clean = line.trim();
      if (!clean) return true;
      return !AGENT_TRANSCRIPT_BUSY_LINE_RE.test(clean)
        && !AGENT_TRANSCRIPT_STATUS_ONLY_LINE_RE.test(clean)
        && !AGENT_TRANSCRIPT_REDRAW_FRAGMENT_RE.test(clean)
        && !AGENT_TRANSCRIPT_PERMISSION_LINE_RE.test(clean);
    })
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

function agentDisplayContentWithoutMetadata(content: string): string {
  return stripAgentRuntimeTranscriptNoise(stripAgentSessionTitle(stripAgentTokenUsage(content)));
}

function isTransientRuntimeStatusOnly(content: string): boolean {
  const clean = stripAgentSessionTitle(stripAgentTokenUsage(content))
    .replace(TERMINAL_ANSI_RE, '')
    .replace(/\r/g, '\n')
    .trim();
  if (!clean) return true;
  const lines = clean.split('\n').map(line => line.trim()).filter(Boolean);
  if (lines.length === 0) return true;
  return lines.every(line =>
    AGENT_TRANSCRIPT_BUSY_LINE_RE.test(line)
      || AGENT_TRANSCRIPT_STATUS_ONLY_LINE_RE.test(line)
      || AGENT_TRANSCRIPT_REDRAW_FRAGMENT_RE.test(line)
    );
}

function sanitizeAgentTranscriptForStorage(content: string): string {
  if (isTransientRuntimeStatusOnly(content)) return '';
  return stripAgentConversationContextLabels(agentDisplayContentWithoutMetadata(content));
}

function shouldDropFollowUpMessage(message: FollowUpMessage): boolean {
  return message.role === 'agent' && isTransientRuntimeStatusOnly(message.content);
}

function collectAgentTokenUsage(messages: FollowUpMessage[]): AgentTokenUsage | null {
  return messages.reduce<AgentTokenUsage | null>((total, message) => {
    const usage = parseAgentTokenUsage(message.content);
    return usage ? mergeAgentTokenUsage(total, usage) : total;
  }, null);
}

function latestAgentTokenUsage(messages: FollowUpMessage[]): AgentTokenUsage | null {
  for (const message of [...messages].reverse()) {
    const usage = parseAgentTokenUsage(message.content);
    if (usage) return usage;
  }
  return null;
}

function totalAgentTokenUsage(usage: AgentTokenUsage | null): number {
  return usage ? usage.inputTokens + usage.outputTokens : 0;
}

function contextAgentTokenUsage(usage: AgentTokenUsage | null): number {
  return usage ? usage.contextInputTokens ?? usage.inputTokens : 0;
}

function formatAgentTokenUsageTotal(usage: AgentTokenUsage): string {
  return `${formatContextTokenCount(totalAgentTokenUsage(usage))} used`;
}

function formatAgentTokenUsageDetail(usage: AgentTokenUsage): string {
  return [
    usage.inputTokens > 0 ? `${formatContextTokenCount(usage.inputTokens)} input` : '',
    usage.outputTokens > 0 ? `${formatContextTokenCount(usage.outputTokens)} output` : '',
    usage.cachedInputTokens > 0 ? `${formatContextTokenCount(usage.cachedInputTokens)} cached` : '',
  ].filter(Boolean).join(' / ');
}

type FollowUpSnapshotFileMap = Map<string, string>;

interface FollowUpWorkspaceSnapshot {
  root: string;
  files: FollowUpSnapshotFileMap;
}

interface FollowUpDetectedFileChange {
  path: string;
  patch: string;
  added: number;
  removed: number;
  hunks: number;
}

interface FollowUpPendingItem {
  id: string;
  messageId: string;
  prompt: string;
  attachments: Array<{ id: string; kind: 'file' | 'image'; name: string; path?: string }>;
  policy: FollowUpSessionPolicy;
  createdAt: number;
}

interface FollowUpSessionRecord {
  threadId: string;
  runtimeSessionId?: string | null;
  title: string;
  createdAt: number;
  updatedAt: number;
  cli?: string;
  model?: string | null;
  lastPrompt?: string;
}

interface CliSkill {
  id: string;
  name: string;
  description?: string | null;
  sourcePath?: string | null;
}

interface CliDiscoveredCommand {
  id: string;
  name: string;
  description?: string | null;
  source?: string | null;
  path?: string | null;
}

interface CliCapabilityDiscovery {
  cli: CliId;
  models: CliModel[];
  skills: CliSkill[];
  commands?: CliDiscoveredCommand[];
  agents?: Array<{ id: string; name: string; description?: string | null; source?: string | null }>;
  warnings: string[];
}

type SlashMenuEntry = AgentSlashSuggestion & {
  key: string;
  entryKind: 'command' | 'value';
  commandId?: AgentSlashCommandId;
  value?: string;
  detail?: string;
  icon?: ReactNode;
  currentMeta?: {
    icon?: ReactNode;
    label: string;
  };
  selected?: boolean;
  disabled?: boolean;
};

type ContextTokenUsage = {
  usedTokens: number;
  totalTokens: number;
};

type CodexUsageLimitsResponse = {
  rows: AgentUsageLimitRow[];
  raw: unknown;
};

const TERMINAL_ANSI_RE =
  /\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g;
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
type ReasoningEffortOption = {
  value: string;
  label: string;
  description: string;
};
const APPROX_CHARS_PER_TOKEN = 4;
const ESTIMATED_CONVERSATION_CONTEXT_CHAR_LIMIT = 12000;
const DEFAULT_CONTEXT_WINDOW_TOKENS: Record<CliId, number> = {
  claude: 200_000,
  codex: 128_000,
  gemini: 1_000_000,
  opencode: 128_000,
  custom: 128_000,
  ollama: 128_000,
  lmstudio: 128_000,
};
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

function formatFollowUpCliLabel(cli: CliId | string): string {
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

function normalizeReasoningEffort(value: string | null | undefined): string | null {
  const normalized = String(value ?? '').trim().toLowerCase().replace(/[_\s-]+/g, '-');
  if (!normalized) return null;
  if (normalized === 'max' || normalized === 'x-high' || normalized === 'extra-high' || normalized === 'extra high') return 'xhigh';
  if (['low', 'medium', 'high', 'xhigh', 'default', 'auto'].includes(normalized)) return normalized;
  return null;
}

function formatReasoningEffortLabel(value: string): string {
  if (value === 'xhigh') return 'XHigh';
  return formatTitleToken(value);
}

function estimateTokensFromText(value: string): number {
  const length = value.trim().length;
  return length > 0 ? Math.ceil(length / APPROX_CHARS_PER_TOKEN) : 0;
}

function formatContextTokenCount(value: number): string {
  if (value < 1000) return String(value);
  const format = (scaled: number) => {
    const fixed = scaled < 10 ? scaled.toFixed(1) : scaled.toFixed(0);
    return fixed.replace(/\.0$/, '');
  };
  if (value < 1_000_000) return `${format(value / 1000)}k`;
  return `${format(value / 1_000_000)}M`;
}

function formatUsageLimitValue(value: number): string {
  if (value < 1000) return String(Math.round(value));
  const format = (scaled: number) => {
    const fixed = scaled < 10 ? scaled.toFixed(1) : scaled.toFixed(0);
    return fixed.replace(/\.0$/, '');
  };
  if (value < 1_000_000) return `${format(value / 1000)}k`;
  return `${format(value / 1_000_000)}M`;
}

function queuedPromptPreview(value: string): string {
  return value.split(/\r?\n/).map(line => line.trim()).find(Boolean) ?? value.trim();
}

function cleanTerminalUsageOutput(value: string): string {
  return value
    .replace(TERMINAL_ANSI_RE, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '')
    .split('\n')
    .map(line => line.trimEnd())
    .filter(line => line.trim().length > 0)
    .slice(-36)
    .join('\n')
    .trim();
}

function extractTerminalUsageCommandOutput(value: string, command: string): string {
  const clean = value
    .replace(TERMINAL_ANSI_RE, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '');
  const commandPattern = new RegExp(`(?:^|\\n)[^\\n]*\\/${command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b[^\\n]*(?:\\n|$)`, 'gi');
  const matches = Array.from(clean.matchAll(commandPattern));
  const last = matches[matches.length - 1];
  if (!last || last.index === undefined) return cleanTerminalUsageOutput(clean);
  return cleanTerminalUsageOutput(clean.slice(last.index + last[0].length));
}

function isInternalAgentStatusMessage(message: FollowUpMessage): boolean {
  const content = message.content.trim();
  const displayContent = message.role === 'agent'
    ? agentDisplayContentWithoutMetadata(message.content).trim()
    : content;
  if (message.role === 'agent' && /^\[Pasted Content \d+ chars\]$/i.test(content)) {
    return true;
  }
  if (
    message.role === 'agent'
    && (
      /^(?:Thinking|Working|Streaming|Starting)(?:\s*\n|\s*$)/i.test(content)
      || AGENT_TRANSCRIPT_BUSY_LINE_RE.test(content)
      || AGENT_TRANSCRIPT_STATUS_ONLY_LINE_RE.test(content)
      || !displayContent
      || AGENT_TRANSCRIPT_BUSY_LINE_RE.test(displayContent)
      || AGENT_TRANSCRIPT_STATUS_ONLY_LINE_RE.test(displayContent)
    )
  ) {
    return true;
  }
  if (message.role !== 'system') return false;
  if (parseAgentUsageLimitMessage(message.content)) return false;
  if (/^(?:Waiting for permission:|Permission\s+(?:approve|deny|approved|denied|cancelled)\b)/i.test(content)) {
    return true;
  }
  if (/^(?:Agent runtime starting|Agent accepted the task|Runtime session|Runtime acknowledged|Sent to runtime session|Failed to send:\s*(?:sendTask|managed prompt injection|Task injection|Runtime session))/i.test(content)) {
    return true;
  }
  if (/failed|error|unknown command|no live .*terminal/i.test(content)) return false;
  const status = classifyAgentStatusMessage(message);
  if (status.kind === 'prompt_sent' || status.kind === 'agent_started' || status.kind === 'run_completed') return true;
  return /^Agent runtime starting/i.test(content) || /^Agent accepted the task/i.test(content);
}

function normalizeNativeCommandName(value: string | null | undefined): string {
  return (value ?? '').trim().replace(/^\/+/, '').toLowerCase();
}

function resolveUsageCommandForCli(cli: CliId, commands: CliDiscoveredCommand[]): string {
  const discovered = new Set(commands.flatMap(command => [
    normalizeNativeCommandName(command.id),
    normalizeNativeCommandName(command.name),
  ]).filter(Boolean));
  const preference = cli === 'gemini'
    ? ['quota', 'usage', 'limits', 'limit', 'cost', 'stats', 'status']
    : cli === 'claude'
      ? ['usage', 'cost', 'limits', 'limit', 'status']
      : ['usage', 'quota', 'limits', 'limit', 'cost', 'stats', 'status'];
  return preference.find(command => discovered.has(command)) ?? preference[0];
}

function inferContextWindowTokens(cli: CliId, modelId: string | null | undefined, models: CliModel[] = []): number {
  const model = (modelId || '').toLowerCase();
  const discoveredModel = models.find(candidate => candidate.id.toLowerCase() === model);
  if (discoveredModel?.contextWindow && discoveredModel.contextWindow > 0) {
    return discoveredModel.contextWindow;
  }
  if (cli === 'gemini') return 1_000_000;
  if (cli === 'claude') return 200_000;
  if (cli === 'codex') {
    if (/\bo[34]\b|o\d(?:-|$)/.test(model)) return 200_000;
    return DEFAULT_CONTEXT_WINDOW_TOKENS.codex;
  }
  return DEFAULT_CONTEXT_WINDOW_TOKENS[cli] ?? 128_000;
}

function percentFromTokens(usedTokens: number, contextWindowTokens: number): number {
  if (!Number.isFinite(usedTokens) || usedTokens <= 0) return 0;
  if (!Number.isFinite(contextWindowTokens) || contextWindowTokens <= 0) return 0;
  return Math.max(1, Math.min(100, Math.ceil((usedTokens / contextWindowTokens) * 100)));
}

function reasoningOptionsForCli(cli: CliId): ReasoningEffortOption[] {
  const common: ReasoningEffortOption[] = [
    { value: 'low', label: 'Low', description: 'Prefer faster, lighter reasoning.' },
    { value: 'medium', label: 'Medium', description: 'Balanced reasoning for normal coding work.' },
    { value: 'high', label: 'High', description: 'Spend more reasoning on complex changes.' },
    { value: 'xhigh', label: 'XHigh', description: 'Use the strongest available reasoning effort.' },
  ];
  if (cli === 'codex') {
    return common.map(option => ({
      ...option,
      description: option.value === 'xhigh'
        ? 'Codex xhigh reasoning effort.'
        : `Codex ${option.value} reasoning effort.`,
    }));
  }
  if (cli === 'claude') {
    return common.map(option => ({
      ...option,
      description: option.value === 'xhigh'
        ? 'Claude Code xhigh thinking effort.'
        : `Claude Code ${option.value} thinking effort.`,
    }));
  }
  return [
    { value: 'default', label: 'Default', description: `Use ${formatFollowUpCliLabel(cli)} defaults.` },
    ...common.map(option => ({
      ...option,
      description: `${option.label} requested in the agent context.`,
    })),
  ];
}

type AgentBrandKind = 'claude' | 'claude-code' | 'gemini' | 'openai' | 'opencode';

function SimpleBrandLogo({ icon, label, size = 14 }: { icon: SimpleIcon; label: string; size?: number }) {
  return (
    <svg
      className="td-agent-brand-logo"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      role="img"
      aria-label={label}
      style={{ color: `#${icon.hex}` }}
    >
      <path fill="currentColor" d={icon.path} />
    </svg>
  );
}

function OpenAiLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="td-agent-brand-logo is-openai"
      width={size}
      height={size}
      viewBox="0 0 20 20"
      role="img"
      aria-label="OpenAI"
    >
      <path
        fill="currentColor"
        d="M11.248 18.25q-.825 0-1.568-.314a4.3 4.3 0 0 1-1.32-.874 4 4 0 0 1-1.304.214 4 4 0 0 1-2.046-.544 4.27 4.27 0 0 1-1.518-1.485 4 4 0 0 1-.56-2.095q0-.48.131-1.04A4.4 4.4 0 0 1 2.04 10.71a4.07 4.07 0 0 1 .017-3.4 4.2 4.2 0 0 1 1.056-1.418 3.8 3.8 0 0 1 1.6-.842 3.9 3.9 0 0 1 .76-1.683q.593-.759 1.451-1.188a4.04 4.04 0 0 1 1.832-.429q.825 0 1.567.313.742.314 1.32.875a4 4 0 0 1 1.304-.215q1.106 0 2.046.545a4.14 4.14 0 0 1 1.501 1.485q.578.941.578 2.095 0 .48-.132 1.04.66.61 1.023 1.419.363.792.363 1.666 0 .892-.38 1.717a4.3 4.3 0 0 1-1.072 1.435 3.8 3.8 0 0 1-1.584.825 3.8 3.8 0 0 1-.775 1.683 4.06 4.06 0 0 1-1.436 1.188 4.04 4.04 0 0 1-1.832.429m-4.076-2.062q.825 0 1.435-.347l3.103-1.782a.36.36 0 0 0 .164-.313v-1.42L7.881 14.62a.67.67 0 0 1-.726 0l-3.118-1.798a.5.5 0 0 1-.017.115v.198q0 .841.396 1.551.413.693 1.139 1.089a3.2 3.2 0 0 0 1.617.412m.165-2.69a.4.4 0 0 0 .181.05q.083 0 .165-.05l1.238-.71-3.977-2.31a.7.7 0 0 1-.363-.643v-3.58q-.825.362-1.32 1.122a2.9 2.9 0 0 0-.495 1.65q0 .809.413 1.55.412.743 1.072 1.123zm3.91 3.663q.875 0 1.585-.396a2.96 2.96 0 0 0 1.534-2.64v-3.564a.32.32 0 0 0-.165-.297l-1.254-.726v4.604a.7.7 0 0 1-.363.643l-3.119 1.799a3 3 0 0 0 1.783.577m.627-6.039V8.878L10.01 7.822 8.129 8.878v2.244l1.881 1.056zM7.057 5.859a.7.7 0 0 1 .363-.644l3.119-1.798a3 3 0 0 0-1.782-.578q-.874 0-1.584.396A2.96 2.96 0 0 0 6.05 4.324a3.07 3.07 0 0 0-.396 1.551v3.547q0 .199.165.314l1.237.726zm8.383 7.887q.825-.364 1.303-1.123.495-.758.495-1.65a3.15 3.15 0 0 0-.412-1.55q-.413-.743-1.073-1.123l-3.086-1.782q-.099-.065-.181-.049a.3.3 0 0 0-.165.05l-1.238.692 3.993 2.327a.6.6 0 0 1 .264.264.64.64 0 0 1 .1.363zm-3.317-8.382a.63.63 0 0 1 .726 0l3.135 1.831v-.297q0-.792-.396-1.501a2.86 2.86 0 0 0-1.105-1.155q-.71-.43-1.65-.43-.825 0-1.436.347L8.294 5.941a.36.36 0 0 0-.165.314v1.418z"
      />
    </svg>
  );
}

function OpenCodeLogo({ size = 14 }: { size?: number }) {
  return (
    <svg
      className="td-agent-brand-logo is-opencode"
      width={size}
      height={size}
      viewBox="0 0 300 300"
      role="img"
      aria-label="OpenCode"
    >
      <g transform="translate(30, 0)">
        <path d="M180 240H60V120H180V240Z" fill="#4B4646" />
        <path d="M180 60H60V240H180V60ZM240 300H0V0H240V300Z" fill="#F1ECEC" />
      </g>
    </svg>
  );
}

function agentBrandIcon(kind: AgentBrandKind, size = 14): ReactNode {
  switch (kind) {
    case 'claude':
      return <SimpleBrandLogo icon={siClaude} label="Claude" size={size} />;
    case 'claude-code':
      return <SimpleBrandLogo icon={siClaudecode} label="Claude Code" size={size} />;
    case 'gemini':
      return <SimpleBrandLogo icon={siGooglegemini} label="Google Gemini" size={size} />;
    case 'opencode':
      return <OpenCodeLogo size={size} />;
    case 'openai':
      return <OpenAiLogo size={size} />;
  }
}

function brandKindForCli(cli: CliId): AgentBrandKind {
  if (cli === 'claude') return 'claude-code';
  if (cli === 'gemini') return 'gemini';
  if (cli === 'opencode') return 'opencode';
  return 'openai';
}

function brandKindForModel(model: Pick<CliModel, 'cli' | 'id' | 'provider'>, fallbackCli: CliId): AgentBrandKind {
  const haystack = `${model.provider ?? ''} ${model.id} ${model.cli || fallbackCli}`.toLowerCase();
  if (/\b(?:anthropic|claude)\b/.test(haystack)) return 'claude';
  if (/\b(?:google|gemini)\b/.test(haystack)) return 'gemini';
  if (/\b(?:openai|gpt|o\d|chatgpt)\b/.test(haystack)) return 'openai';
  return brandKindForCli(model.cli || fallbackCli);
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

function isFollowUpBusyIndicatorState(state?: RuntimeSessionState | string | null): boolean {
  if (!state) return false;
  if (isFollowUpSessionBusy(state)) return true;
  return /^(?:starting|sending|streaming|stopping)$/i.test(state);
}

function isActiveFollowUpMessageStatus(status?: FollowUpMessage['status']): boolean {
  return status === 'queued' || status === 'sending' || status === 'streaming';
}

function sessionFollowUpMessages(messages: FollowUpMessage[], sessionId?: string | null): FollowUpMessage[] {
  if (!sessionId) return [];
  return messages.filter(message => message.runtimeSessionId === sessionId);
}

function hasActiveFollowUpOutput(messages: FollowUpMessage[], sessionId?: string | null): boolean {
  return sessionFollowUpMessages(messages, sessionId).some(message =>
    (message.role === 'agent' || message.role === 'tool' || message.role === 'system')
    && isActiveFollowUpMessageStatus(message.status)
  );
}

function isVisibleFollowUpOutputMessage(message: FollowUpMessage): boolean {
  const workItem = parseAgentWorkItemMessage(message);
  if (isInternalAgentWorkItem(workItem) || (!workItem && isInternalAgentStatusMessage(message))) return false;
  if (message.role === 'agent') return Boolean(agentDisplayContentWithoutMetadata(message.content).trim());
  return Boolean(workItem);
}

function isSettledAgentOutputMessage(message: FollowUpMessage | undefined): boolean {
  return Boolean(
    message
    && message.role === 'agent'
    && (message.status === 'completed' || message.status === 'failed' || message.status === 'cancelled')
  );
}

function visibleFollowUpMessages(messages: FollowUpMessage[]): FollowUpMessage[] {
  return messages.filter(isVisibleFollowUpOutputMessage);
}

function hasActiveVisibleFollowUpOutput(messages: FollowUpMessage[]): boolean {
  return visibleFollowUpMessages(messages).some(message =>
    (message.role === 'agent' || message.role === 'tool' || message.role === 'system')
    && isActiveFollowUpMessageStatus(message.status)
  );
}

function hasSettledVisibleAgentAnswer(messages: FollowUpMessage[]): boolean {
  if (messages.length > 0 && shouldCollapseRun(messages)) return true;
  if (hasActiveVisibleFollowUpOutput(messages)) return false;
  return isSettledAgentOutputMessage(
    [...visibleFollowUpMessages(messages)]
      .reverse()
      .find(message => message.role === 'agent'),
  );
}

function isFollowUpSessionVisiblySettled(messages: FollowUpMessage[], sessionId?: string | null): boolean {
  const sessionMessages = sessionFollowUpMessages(messages, sessionId);
  if (hasSettledVisibleAgentAnswer(sessionMessages)) return true;

  // Persisted follow-up history can outlive a runtime session id. When that
  // happens, prefer the visible transcript over stale runtime state.
  if (sessionMessages.length > 0) return false;
  return hasSettledVisibleAgentAnswer(messages);
}

function isCodexUpdatePermissionPrompt(permission?: RuntimePermissionRequest | null): boolean {
  if (!permission) return false;
  return /Update available(?:[!:]|\s)[\s\S]{0,800}\b1\.\s*Update now\b[\s\S]{0,400}\b2\.\s*Skip\b/i.test(
    `${permission.rawPrompt}\n${permission.detail}`,
  );
}

function finalizeStreamingMessages(
  messages: FollowUpMessage[],
  sessionId: string,
  status: Extract<FollowUpMessage['status'], 'completed' | 'failed' | 'cancelled'>,
): FollowUpMessage[] {
  const completedAt = Date.now();
  let changed = false;
  const nextMessages = messages.map(message => {
    if (message.runtimeSessionId !== sessionId || (message.role !== 'agent' && message.role !== 'tool') || message.status !== 'streaming') {
      return message;
    }
    changed = true;
    const workItem = parseAgentWorkItemContent(message.content);
    if (message.role === 'tool' && workItem) {
      const nextStatus: AgentWorkItemStatus = status === 'completed' ? 'completed' : 'failed';
      return {
        ...message,
        status,
        completedAt,
        content: formatAgentWorkItemContent({
          ...workItem,
          status: nextStatus,
          completedAt,
        }),
      };
    }
    return { ...message, status, completedAt };
  });
  return changed ? nextMessages : messages;
}

function finalizeStreamingToolMessages(
  messages: FollowUpMessage[],
  sessionId: string,
  status: Extract<FollowUpMessage['status'], 'completed' | 'failed' | 'cancelled'>,
): FollowUpMessage[] {
  const completedAt = Date.now();
  let changed = false;
  const nextMessages = messages.map(message => {
    if (message.runtimeSessionId !== sessionId || message.role !== 'tool' || message.status !== 'streaming') {
      return message;
    }
    changed = true;
    const workItem = parseAgentWorkItemContent(message.content);
    if (!workItem) return { ...message, status, completedAt };
    return {
      ...message,
      status,
      completedAt,
      content: formatAgentWorkItemContent({
        ...workItem,
        status: status === 'completed' ? 'completed' : 'failed',
        completedAt,
      }),
    };
  });
  return changed ? nextMessages : messages;
}

function appendFollowUpMessages(paneId: string, next: FollowUpMessage[]): void {
  const current = readFollowUpMessages(paneId);
  const seen = new Set(current.map(message => message.id));
  const nextVisible = next.filter(message => !shouldDropFollowUpMessage(message));
  if (nextVisible.length === 0) return;
  useWorkspaceStore.getState().updatePaneData(paneId, {
    followUpMessages: [...current.filter(message => !shouldDropFollowUpMessage(message)), ...nextVisible.filter(message => !seen.has(message.id))].slice(-200),
  });
}

function upsertFollowUpMessage(paneId: string, next: FollowUpMessage): void {
  const current = readFollowUpMessages(paneId);
  if (shouldDropFollowUpMessage(next)) {
    useWorkspaceStore.getState().updatePaneData(paneId, {
      followUpMessages: current.filter(message => message.id !== next.id && !shouldDropFollowUpMessage(message)).slice(-200),
    });
    return;
  }
  const index = current.findIndex(message => message.id === next.id);
  const followUpMessages = index >= 0
    ? current.map(message => message.id === next.id ? { ...message, ...next } : message).filter(message => !shouldDropFollowUpMessage(message))
    : [...current.filter(message => !shouldDropFollowUpMessage(message)), next];
  useWorkspaceStore.getState().updatePaneData(paneId, {
    followUpMessages: followUpMessages.slice(-200),
  });
}

function mergePersistedFollowUpMessages(current: FollowUpMessage[], persisted: FollowUpMessage[]): FollowUpMessage[] {
  const byId = new Map<string, FollowUpMessage>();
  for (const message of persisted) byId.set(message.id, message);
  for (const message of current) {
    const prior = byId.get(message.id);
    byId.set(message.id, prior ? { ...prior, ...message } : message);
  }
  return [...byId.values()]
    .sort((left, right) => left.createdAt - right.createdAt)
    .filter(message => !shouldDropFollowUpMessage(message))
    .slice(-200);
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
  trailingMeta,
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
  trailingMeta?: ReactNode;
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
        {trailingMeta && <span className="td-followup-menu-meta">{trailingMeta}</span>}
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

const FOLLOW_UP_SNAPSHOT_MAX_FILES = 800;
const FOLLOW_UP_SNAPSHOT_MAX_BYTES = 240_000;
const FOLLOW_UP_SNAPSHOT_EXCLUDED_DIRS = new Set([
  '.git',
  '.hg',
  '.svn',
  'node_modules',
  'target',
  'dist',
  'build',
  '.next',
  '.vite',
  '.turbo',
  '.cache',
  '__pycache__',
]);
const FOLLOW_UP_SNAPSHOT_TEXT_EXTENSIONS = new Set([
  '.c',
  '.cc',
  '.cfg',
  '.conf',
  '.cpp',
  '.cs',
  '.css',
  '.csv',
  '.go',
  '.h',
  '.hpp',
  '.html',
  '.ini',
  '.java',
  '.js',
  '.json',
  '.jsx',
  '.kt',
  '.less',
  '.log',
  '.lua',
  '.md',
  '.mjs',
  '.py',
  '.rb',
  '.rs',
  '.scss',
  '.sh',
  '.sql',
  '.svelte',
  '.toml',
  '.ts',
  '.tsx',
  '.txt',
  '.vue',
  '.xml',
  '.yaml',
  '.yml',
]);

type FollowUpWorkspaceDirEntry = {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
};

function fileExtension(path: string): string {
  const leaf = pathLeaf(path);
  const dot = leaf.lastIndexOf('.');
  return dot > 0 ? leaf.slice(dot).toLowerCase() : '';
}

function shouldSnapshotFollowUpFile(path: string): boolean {
  const name = pathLeaf(path).toLowerCase();
  if (!name || name.endsWith('.lock')) return false;
  if (/^(?:package-lock|pnpm-lock|yarn)\./i.test(name)) return false;
  return FOLLOW_UP_SNAPSHOT_TEXT_EXTENSIONS.has(fileExtension(path));
}

function shouldSkipFollowUpSnapshotDir(path: string): boolean {
  const leaf = pathLeaf(path).toLowerCase();
  return FOLLOW_UP_SNAPSHOT_EXCLUDED_DIRS.has(leaf);
}

async function captureFollowUpWorkspaceSnapshot(workspaceDir: string | null): Promise<FollowUpWorkspaceSnapshot | null> {
  const root = workspaceDir?.trim();
  if (!root) return null;
  const files: FollowUpSnapshotFileMap = new Map();
  const queue = [root];
  const seenDirs = new Set<string>();

  while (queue.length > 0 && files.size < FOLLOW_UP_SNAPSHOT_MAX_FILES) {
    const current = queue.shift()!;
    if (seenDirs.has(current) || shouldSkipFollowUpSnapshotDir(current)) continue;
    seenDirs.add(current);
    let entries: FollowUpWorkspaceDirEntry[] = [];
    try {
      entries = await invoke<FollowUpWorkspaceDirEntry[]>('workspace_read_dir', { path: current });
    } catch {
      continue;
    }
    for (const entry of entries) {
      const fullPath = joinWorkspacePath(current, entry.name);
      if (entry.isDirectory) {
        if (!shouldSkipFollowUpSnapshotDir(fullPath)) queue.push(fullPath);
        continue;
      }
      if (!entry.isFile || !shouldSnapshotFollowUpFile(fullPath)) continue;
      try {
        const content = await readSdkWorkspaceTextFile(fullPath, path => invoke<string>('workspace_read_text_file', { path }));
        if (content.content.length <= FOLLOW_UP_SNAPSHOT_MAX_BYTES) {
          files.set(fullPath, content.content);
        }
      } catch {
        continue;
      }
      if (files.size >= FOLLOW_UP_SNAPSHOT_MAX_FILES) break;
    }
  }

  return { root, files };
}

function diffFollowUpWorkspaceSnapshots(
  before: FollowUpWorkspaceSnapshot | null | undefined,
  after: FollowUpWorkspaceSnapshot | null,
): FollowUpDetectedFileChange[] {
  if (!before || !after) return [];
  const paths = new Set([...before.files.keys(), ...after.files.keys()]);
  const changes: FollowUpDetectedFileChange[] = [];
  for (const path of paths) {
    const oldContent = before.files.get(path);
    const newContent = after.files.get(path);
    if (oldContent === newContent) continue;
    const relative = relativeWorkspacePath(after.root, path) ?? relativeWorkspacePath(before.root, path) ?? path;
    const patch = createUnifiedDiff(relative, oldContent ?? '', newContent ?? '', oldContent === undefined);
    const stats = diffStats(patch);
    changes.push({
      path,
      patch,
      added: stats.added,
      removed: stats.removed,
      hunks: stats.hunks,
    });
  }
  return changes.sort((a, b) => normalizeDisplayPath(a.path).localeCompare(normalizeDisplayPath(b.path)));
}

export function formatFollowUpCodeChangeContent(changes: FollowUpDetectedFileChange[]): string {
  return changes.map(change => [
    `Code change: ${change.path}`,
    `Added: ${change.added}`,
    `Removed: ${change.removed}`,
    '```diff',
    change.patch.trimEnd(),
    '```',
  ].join('\n')).join('\n\n');
}

function agentChangeSummariesFromDetectedChanges(changes: FollowUpDetectedFileChange[], keyPrefix: string): AgentChangeSummary[] {
  return changes.map(change => ({
    key: `${keyPrefix}:${change.path}`,
    title: pathLeaf(change.path),
    path: change.path,
    patch: change.patch,
    added: change.added,
    removed: change.removed,
    hunks: change.hunks,
  }));
}

function collectAppliedCodeChangeSummaries(message: FollowUpMessage): AgentChangeSummary[] {
  const summaries: AgentChangeSummary[] = [];
  const regex = /^Code change:\s*(.+?)\r?\nAdded:\s*(\d+)\r?\nRemoved:\s*(\d+)\r?\n```diff\r?\n([\s\S]*?)```/gm;
  let match: RegExpExecArray | null;
  while ((match = regex.exec(message.content)) !== null) {
    const path = match[1].trim();
    const patch = match[4].trimEnd();
    const stats = diffStats(patch);
    summaries.push({
      key: `${message.id}:${path}`,
      title: pathLeaf(path),
      path,
      patch,
      added: Number(match[2]) || stats.added,
      removed: Number(match[3]) || stats.removed,
      hunks: stats.hunks,
    });
  }
  return summaries;
}

const AGENT_TOOL_LABELS: Record<string, string> = {
  list_directory: 'List',
  read_file: 'Read',
  search_workspace: 'Search',
  grep: 'Grep',
  glob: 'Glob',
  get_terminal_output: 'Terminal Output',
  bash_list: 'List Terminals',
  bash_logs: 'Read Logs',
  bash_kill: 'Stop Terminal',
  todo_write: 'Todo',
  run_subagent: 'Subagent',
  suggest_command: 'Suggest Command',
  bash_run: 'Run',
  bash_background: 'Run Background',
  open_preview: 'Preview',
  create_directory: 'Create Directory',
  edit: 'Edit',
  multi_edit: 'Multi Edit',
  write_file: 'Write File',
  propose_patch: 'Patch',
  shell_command: 'Run',
  apply_patch: 'Edit',
  read: 'Read',
  write: 'Write File',
};

function formatAgentToolName(toolName: string | undefined, fallbackLabel: string): string {
  const normalized = (toolName || fallbackLabel).trim().toLowerCase().replace(/[\s.-]+/g, '_');
  if (AGENT_TOOL_LABELS[normalized]) return AGENT_TOOL_LABELS[normalized];
  const cleanFallback = fallbackLabel.trim();
  if (cleanFallback && cleanFallback.toLowerCase() !== 'tool') return cleanFallback;
  return formatTitleToken(normalized.replace(/_/g, ' ')) || 'Tool';
}

export function formatAgentToolEventContent(event: {
  toolName?: string;
  label: string;
  detail?: string;
}): string {
  const label = formatAgentToolName(event.toolName, event.label);
  return [`Tool: ${label}`, event.detail?.trim() || 'Working in the workspace'].join('\n');
}

function stableAgentToolEventId(sessionId: string, event: { id?: string; toolName?: string; label: string; detail?: string }): string {
  const explicit = event.id?.trim();
  if (explicit) return `tool:${sessionId}:${explicit}`;
  const key = `${event.toolName || ''}:${event.label}:${event.detail || ''}`
    .toLowerCase()
    .replace(/[^a-z0-9._:-]+/g, '-')
    .slice(0, 96);
  return `tool:${sessionId}:${key || generateId()}`;
}

function parseAgentToolMessage(content: string): { label: string; detail?: string } | null {
  const clean = content.trim();
  const match = clean.match(/^Tool:\s*(.+)$/im);
  if (!match) return null;
  const lines = clean.split(/\r?\n/);
  const label = match[1].trim();
  const detail = lines
    .filter(line => !/^Tool:/i.test(line))
    .join('\n')
    .trim();
  return { label, detail: detail || undefined };
}

const RUNTIME_OUTPUT_TOOL_LINE_RE =
  /(?:^|\n)\s*(?:[•●*>\-]\s*)?(Read|Edit|Write|Bash|Glob|Grep|Search|List|Run|Shell|Apply Patch|ApplyPatch|MultiEdit|Todo)\b(?:\s*\(([^)\r\n]{0,180})\)|\s*:\s*([^\r\n]{0,180}))?/i;
const CODEX_HIDDEN_PROMPT_ECHO_PATTERNS: RegExp[] = [
  /^Improve documentation in @filename$/i,
  /^Write tests for @filename$/i,
  /\bYou are the workspace agent for Comet-AI\b/i,
  /\bAnswer the user directly\b/i,
  /\blook for an assigned mission\b/i,
  /\bexplicitly asks you to work on a mission\b/i,
  /\bAgent role:/i,
  /\bWorkspace Coding Agent\b/i,
  /\bHelp with coding in the current workspace\b/i,
  /\bInspect files and run\b/i,
  /\bcommands when helpful\b/i,
  /\bMake focused changes\b/i,
  /^implementation\.?$/i,
  /\bAnswer direct questions directly\b/i,
  /\bworkflow missions or inbox tasks\b/i,
  /\bUse this as a general assistance style\b/i,
  /\bnot as workflow task\b/i,
  /\binstructions\.\s*Workspace:/i,
  /\bSelected folder:/i,
  /\bRequested reasoning effort:/i,
  /\bPermission mode:/i,
  /\bask-for-approval\b/i,
  /\bSession title protocol:/i,
  /^[-•●*]?\s*(?:Session|Conversation|Chat)\s+title\s*:/i,
  /\bbefore any other response text\b/i,
  /^["'`]?Session title:\s*<short title>/i,
  /\bbased on the user's latest prompt\b/i,
  /\bunder 6 words\b/i,
  /\bThen continue normally\b/i,
  /\bevery new agent run\b/i,
  /\bWorkspace summary:/i,
  /\bWorkspace agent for\b/i,
  /\bPrevious follow-up context for continuity only\b/i,
  /\bcontinuity only\.\s+Do not quote\b/i,
  /\bDo not quote,\s+restate,\s+or summarize this context\b/i,
  /\bUser follow-up:/i,
];
const CODEX_TUI_REDRAW_FRAGMENT_RE = /^(?:[-•●◦*]\s*)?(?:\d+|W|Wo|Wog\d*|Wng\d*|or|rk|ki|in|ng|g)$/i;
const CODEX_PROMPT_PLACEHOLDER_PREFIX_RE =
  /^\s*(?:[›＞❯]\s*)?(?:Implement\s+\{feature\}|Improve documentation in @filename|Write tests for @filename)\s*/i;
const CODEX_COMMAND_START_RE = /^\s*[•●◦*]\s*(Running|Ran)\s+(.+?)\s*$/i;
const CODEX_COMMAND_CONTINUATION_RE = /^\s*[│|]\s*(.+)$/;
const CODEX_COMMAND_OUTPUT_RE = /^\s*(?:└|L)\s*(.*)$/;
const CODEX_COMMAND_REJECTED_RE = /^`?(.+?)`?\s+rejected:\s+(.+)$/i;
const CODEX_TRANSCRIPT_TRUNCATION_RE = /^\s*…?\s*[+-]\d+\s+lines?\s*\(ctrl\s*\+\s*t\s+to\s+view\s+transcript\)\s*$/i;
const CODEX_SESSION_TITLE_LINE_RE = /^\s*(?:[-•●*]\s*)?(?:Session|Conversation|Chat)\s+title\s*(?::|-|—|=)/i;
const CODEX_BULLET_PROSE_RE = /^\s*[•●◦*]\s+(.+)$/;

function stripRuntimeOutputControls(text: string): string {
  return text
    .replace(/\x1b\][^\x07]*(?:\x07|\x1b\\)|\x1b(?:[@-Z\\-_]|\[[0-?]*[ -/]*[@-~])/g, '')
    .replace(/\r/g, '\n')
    .replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001a\u001c-\u001f\u007f]/g, '');
}

function parseRuntimeToolActivity(text: string): { toolName: string; label: string; detail?: string } | null {
  const clean = stripRuntimeOutputControls(text);
  const mcpTool = clean.match(/run\s+tool\s+"([^"]+)"/i)?.[1]?.trim();
  if (mcpTool) {
    return {
      toolName: mcpTool,
      label: formatAgentToolName(mcpTool, mcpTool),
      detail: 'Runtime requested a tool call',
    };
  }
  const lineMatch = RUNTIME_OUTPUT_TOOL_LINE_RE.exec(clean);
  if (!lineMatch) return null;
  const rawLabel = lineMatch[1].trim();
  const detail = (lineMatch[2] || lineMatch[3] || '').trim();
  return {
    toolName: rawLabel.toLowerCase().replace(/\s+/g, '_'),
    label: formatAgentToolName(rawLabel, rawLabel),
    detail: detail || undefined,
  };
}

function isCodexRuntimeDisplayNoiseLine(line: string): boolean {
  const clean = line.trim();
  if (!clean) return false;
  return (
    /^Microsoft Windows \[Version/i.test(clean)
    || /^\(c\)\s+Microsoft Corporation/i.test(clean)
    || /\bCODEX_HOME\b.*\bcodex\b/i.test(clean)
    || /\bOpenAI Codex\b/i.test(clean)
    || /^\[Pasted Content \d+ chars\]$/i.test(clean)
    || CODEX_HIDDEN_PROMPT_ECHO_PATTERNS.some(pattern => pattern.test(clean))
    || /^[•●◦*]$/.test(clean)
    || CODEX_TUI_REDRAW_FRAGMENT_RE.test(clean)
    || /^(?:model|directory):\s*/i.test(clean)
    || /^[-_╭╮╰╯│┃─━┬┴┼| ]+$/.test(clean)
    || /^›\s*/.test(clean)
    || /^Tip:\s/i.test(clean)
    || /^\d{4}-\d{2}-\d{2}T[^\s]+\s+(?:WARN|ERROR)\s+codex_/i.test(clean)
    || /^(?:[-•●*]\s*)?Starting MCP servers\b/i.test(clean)
    || /^(?:⚠\s*)?MCP (?:client|startup|server)\b/i.test(clean)
    || /^\s*gpt-[\w.-]+(?:\s+\w+)?\s*[·•]/i.test(clean)
    || /\bContext\s+\d+%\s+(?:left|used)\b/i.test(clean)
    || /^\s*(?:[⠐⠂⠒⠲⠴⠦⠖⠆⠋⠙⠹⠸⠼⠧⠇⠏]\s*)?(?:[-•●*]\s*)?(?:Working|Thinking|Starting|Streaming)\s*$/i.test(clean)
    || /^\s*(?:[⠐⠂⠒⠲⠴⠦⠖⠆⠋⠙⠹⠸⠼⠧⠇⠏]\s*)?(?:[-•●*]\s*)?(?:Working|Thinking|Starting|Streaming)\b.*(?:esc|interrupt|MCP)/i.test(clean)
  );
}

function stripCodexPromptPlaceholderFromLine(line: string): string {
  return line.replace(CODEX_PROMPT_PLACEHOLDER_PREFIX_RE, '');
}

type CodexRuntimeCommandRecord = {
  id: string;
  command: string;
  outputLines: string[];
  status: 'running' | 'completed' | 'failed';
  createdAt: number;
};

type CodexRuntimeOutputState = {
  nextCommandIndex: number;
  activeCommandId?: string;
  inFinalAnswer: boolean;
  commandByKey: Map<string, string>;
  commands: Map<string, CodexRuntimeCommandRecord>;
  seenAgentLines: Set<string>;
  seenStatusLines: Set<string>;
  seenOutputByCommand: Map<string, Set<string>>;
  skippingPermissionPrompt: boolean;
  suppressingHiddenContextEcho: boolean;
  suppressingUserPromptEcho: boolean;
};

type CodexRuntimeWorkEvent = {
  id: string;
  toolName: string;
  label: string;
  detail?: string;
  command?: string;
  output?: string;
  changes?: Array<{ path: string; diff?: string; patch?: string }>;
  status?: 'running' | 'completed' | 'failed';
};

type CodexRuntimeStreamEvent =
  | { kind: 'agent'; text: string }
  | { kind: 'final_agent'; text: string }
  | { kind: 'session_title'; title: string }
  | { kind: 'work'; workEvent: CodexRuntimeWorkEvent };

type CodexRuntimeLineResult = {
  agentLine?: string;
  finalAgentLine?: string;
  sessionTitle?: string;
  workEvent?: CodexRuntimeWorkEvent;
  workEvents?: CodexRuntimeWorkEvent[];
};

function codexJsonString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function codexJsonObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? value as Record<string, unknown>
    : null;
}

function codexJsonStatus(value: unknown): CodexRuntimeWorkEvent['status'] {
  const status = codexJsonString(value);
  if (status === 'completed') return 'completed';
  if (status === 'failed' || status === 'declined') return 'failed';
  return 'running';
}

function processCodexJsonRuntimeLine(
  state: CodexRuntimeOutputState,
  clean: string,
): CodexRuntimeLineResult | null {
  if (!clean.startsWith('{')) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(clean);
  } catch {
    return null;
  }
  const event = codexJsonObject(parsed);
  const item = codexJsonObject(event?.item);
  if (!event || !item) return {};
  const eventType = codexJsonString(event.type) ?? '';
  const itemType = codexJsonString(item.type) ?? '';
  const status = codexJsonStatus(item.status);
  const id = codexJsonString(item.id);

  if (itemType === 'agent_message') {
    const text = codexJsonString(item.text);
    if (!text) return {};
    return eventType === 'item.completed'
      ? codexAgentLineEvent(state, text, false)
      : {};
  }

  if (itemType === 'command_execution') {
    const command = codexJsonString(item.command) ?? 'command';
    const output = codexJsonString(item.aggregated_output);
    return {
      workEvent: {
        id: id ? `codex-json-${id}` : `codex-json-command-${state.nextCommandIndex++}`,
        toolName: 'shell_command',
        label: 'Run',
        detail: command,
        command,
        output,
        status,
      },
    };
  }

  if (itemType === 'file_change') {
    const changes = Array.isArray(item.changes)
      ? item.changes
        .map(change => codexJsonObject(change))
        .filter((change): change is Record<string, unknown> => Boolean(change))
        .map(change => ({ path: codexJsonString(change.path) ?? 'Updated file' }))
      : [];
    return {
      workEvent: {
        id: id ? `codex-json-${id}` : `codex-json-file-${state.nextCommandIndex++}`,
        toolName: 'edit',
        label: 'Edit',
        detail: changes.map(change => change.path).join(', ') || 'File change',
        changes,
        status,
      },
    };
  }

  if (itemType === 'mcp_tool_call') {
    const server = codexJsonString(item.server);
    const tool = codexJsonString(item.tool) ?? 'tool';
    const detail = [server, tool].filter(Boolean).join('/');
    const error = codexJsonString(item.error);
    return {
      workEvent: {
        id: id ? `codex-json-${id}` : `codex-json-tool-${state.nextCommandIndex++}`,
        toolName: tool,
        label: formatAgentToolName(tool, tool),
        detail: detail || undefined,
        output: error,
        status: error ? 'failed' : status,
      },
    };
  }

  return {};
}

function createCodexRuntimeOutputState(): CodexRuntimeOutputState {
  return {
    nextCommandIndex: 1,
    inFinalAnswer: false,
    commandByKey: new Map(),
    commands: new Map(),
    seenAgentLines: new Set(),
    seenStatusLines: new Set(),
    seenOutputByCommand: new Map(),
    skippingPermissionPrompt: false,
    suppressingHiddenContextEcho: false,
    suppressingUserPromptEcho: false,
  };
}

function compactCodexDisplayLine(line: string): string {
  return stripCodexPromptPlaceholderFromLine(line)
    .replace(/\s+$/g, '')
    .replace(/^\s{2,}/, '');
}

function codexLineSignature(line: string): string {
  return line.replace(/\s+/g, ' ').trim().toLowerCase();
}

function codexCommandKey(command: string): string {
  return command.replace(/\s+/g, ' ').trim().toLowerCase();
}

function upsertCodexCommandRecord(
  state: CodexRuntimeOutputState,
  command: string,
  status: 'running' | 'completed',
): CodexRuntimeCommandRecord {
  const normalizedCommand = command.replace(/\s+/g, ' ').trim();
  const key = codexCommandKey(normalizedCommand);
  let id = state.commandByKey.get(key);
  if (!id) {
    id = `codex-command-${state.nextCommandIndex++}`;
    state.commandByKey.set(key, id);
  }
  const existing = state.commands.get(id);
  const record: CodexRuntimeCommandRecord = existing
    ? { ...existing, command: normalizedCommand || existing.command, status }
    : { id, command: normalizedCommand, outputLines: [], status, createdAt: Date.now() };
  state.commands.set(id, record);
  state.activeCommandId = id;
  state.inFinalAnswer = false;
  return record;
}

function commandRecordToWorkEvent(record: CodexRuntimeCommandRecord): CodexRuntimeWorkEvent {
  const output = record.outputLines.join('\n').trim();
  return {
    id: record.id,
    toolName: 'shell_command',
    label: 'Run',
    detail: record.command,
    command: record.command,
    output: output || undefined,
    status: record.status,
  };
}

function updateCodexCommandRecordStatus(
  state: CodexRuntimeOutputState,
  id: string,
  status: CodexRuntimeCommandRecord['status'],
): CodexRuntimeWorkEvent | null {
  const record = state.commands.get(id);
  if (!record) return null;
  const next = { ...record, status };
  state.commands.set(id, next);
  return commandRecordToWorkEvent(next);
}

function completeRunningCodexCommands(
  state: CodexRuntimeOutputState,
  exceptId?: string,
): CodexRuntimeWorkEvent[] {
  const events: CodexRuntimeWorkEvent[] = [];
  for (const record of state.commands.values()) {
    if (record.id === exceptId || record.status !== 'running') continue;
    const completed = { ...record, status: 'completed' as const };
    state.commands.set(record.id, completed);
    events.push(commandRecordToWorkEvent(completed));
  }
  return events;
}

function appendCodexCommandOutput(
  state: CodexRuntimeOutputState,
  value: string,
): CodexRuntimeWorkEvent | null {
  const id = state.activeCommandId;
  if (!id) return null;
  const record = state.commands.get(id);
  if (!record) return null;
  const output = value.trimEnd();
  if (!output.trim()) return null;
  if (isCodexPermissionPromptLine(output.trim())) return null;
  let seen = state.seenOutputByCommand.get(id);
  if (!seen) {
    seen = new Set();
    state.seenOutputByCommand.set(id, seen);
  }
  const signature = codexLineSignature(output);
  if (seen.has(signature)) return null;
  seen.add(signature);
  const outputLines = [...record.outputLines, output].slice(-80);
  const next = { ...record, outputLines };
  state.commands.set(id, next);
  return commandRecordToWorkEvent(next);
}

function codexAgentLineEvent(state: CodexRuntimeOutputState, display: string, final = false): { agentLine?: string; finalAgentLine?: string } {
  const clean = display.trim();
  const signature = codexLineSignature(clean);
  if (!signature || state.seenAgentLines.has(signature)) return {};
  state.seenAgentLines.add(signature);
  return final ? { finalAgentLine: display } : { agentLine: display };
}

function isCodexPermissionPromptStart(clean: string): boolean {
  return /\bWould you like to run the following command\??/i.test(clean);
}

function isCodexPermissionPromptEnd(clean: string): boolean {
  return /\bPress enter to confirm or esc to cancel\b/i.test(clean);
}

function isCodexPermissionPromptLine(clean: string): boolean {
  return isCodexPermissionPromptStart(clean)
    || isCodexPermissionPromptEnd(clean)
    || /^\s*[›>]\s*[123]\.\s+/i.test(clean)
    || /^\s*[123]\.\s+(?:Yes|No)\b/i.test(clean)
    || /^\s*\$\s+/.test(clean)
    || /^✔\s*You approved\b/i.test(clean);
}

function isCodexHiddenContextEchoStart(clean: string): boolean {
  return /\bPrevious follow-up context for continuity only\b/i.test(clean)
    || /\bcontinuity only\.\s+Do not quote\b/i.test(clean)
    || /\bDo not quote,\s+restate,\s+or summarize this context\b/i.test(clean);
}

function isCodexHiddenContextEchoTerminalLine(clean: string): boolean {
  return CODEX_SESSION_TITLE_LINE_RE.test(clean)
    || CODEX_COMMAND_START_RE.test(clean)
    || isCodexPermissionPromptStart(clean)
    || isCodexPermissionPromptLine(clean);
}

function isCodexUserPromptEchoStart(clean: string): boolean {
  return /^User follow-up:/i.test(clean)
    || /\bRun this exact shell command\b/i.test(clean)
    || /\busing the shell tool\b/i.test(clean)
    || /\bwait if approval is requested\b/i.test(clean);
}

function isLikelyCodexAgentProseLine(clean: string): boolean {
  if (!clean || clean.length < 8) return false;
  if (/^[\w.-]+[\\/][\w./\\-]+$/.test(clean)) return false;
  if (/^[\w.-]+:\s*\d+\s*$/i.test(clean)) return false;
  if (/^[\w.-]+\.\w+$/i.test(clean)) return false;
  if (/^[\w.-]+(?:\s+[\w.-]+){0,4}$/.test(clean) && !/[.!?;:,]/.test(clean)) return false;
  return /\b(?:I|I've|I'll|The|This|Here|It|There|Next|Now|Summary|Findings|Workspace|Repository|Repo)\b/i.test(clean)
    || /[.!?]\s*$/.test(clean);
}

function processCodexRuntimeLine(
  state: CodexRuntimeOutputState,
  line: string,
): CodexRuntimeLineResult {
  const display = compactCodexDisplayLine(line);
  const clean = display.trim();
  if (!clean) return {};
  const jsonResult = processCodexJsonRuntimeLine(state, clean);
  if (jsonResult) return jsonResult;
  if (state.suppressingHiddenContextEcho) {
    if (/^User follow-up:/i.test(clean)) {
      state.suppressingHiddenContextEcho = false;
      state.suppressingUserPromptEcho = true;
      return {};
    }
    if (!isCodexHiddenContextEchoTerminalLine(clean)) return {};
    state.suppressingHiddenContextEcho = false;
    if (CODEX_HIDDEN_PROMPT_ECHO_PATTERNS.some(pattern => pattern.test(clean))) return {};
  }
  if (isCodexHiddenContextEchoStart(clean)) {
    state.suppressingHiddenContextEcho = true;
    return {};
  }
  if (state.suppressingUserPromptEcho) {
    if (!isCodexHiddenContextEchoTerminalLine(clean)) return {};
    state.suppressingUserPromptEcho = false;
    if (CODEX_HIDDEN_PROMPT_ECHO_PATTERNS.some(pattern => pattern.test(clean))) return {};
  }
  if (isCodexUserPromptEchoStart(clean)) {
    state.suppressingUserPromptEcho = true;
    return {};
  }
  if (CODEX_SESSION_TITLE_LINE_RE.test(clean)) {
    const title = extractAgentSessionTitle(clean).title;
    const completedEvents = completeRunningCodexCommands(state);
    state.activeCommandId = undefined;
    state.inFinalAnswer = true;
    return { sessionTitle: title ?? undefined, workEvents: completedEvents };
  }
  if (state.skippingPermissionPrompt) {
    if (isCodexPermissionPromptEnd(clean)) state.skippingPermissionPrompt = false;
    return {};
  }
  if (isCodexPermissionPromptStart(clean)) {
    state.skippingPermissionPrompt = true;
    return {};
  }
  if (isCodexPermissionPromptLine(clean)) return {};
  if (isCodexRuntimeDisplayNoiseLine(display)) return {};

  const commandMatch = clean.match(CODEX_COMMAND_START_RE);
  if (commandMatch) {
    const status = /^ran$/i.test(commandMatch[1]) ? 'completed' : 'running';
    const record = upsertCodexCommandRecord(state, commandMatch[2], status);
    const completedEvents = completeRunningCodexCommands(state, record.id);
    return { workEvents: [...completedEvents, commandRecordToWorkEvent(record)] };
  }

  const continuation = clean.match(CODEX_COMMAND_CONTINUATION_RE);
  if (continuation && state.activeCommandId && !state.inFinalAnswer) {
    const record = state.commands.get(state.activeCommandId);
    if (!record) return {};
    const command = `${record.command} ${continuation[1]}`.replace(/\s+/g, ' ').trim();
    const next = { ...record, command };
    state.commands.set(record.id, next);
    return { workEvent: commandRecordToWorkEvent(next) };
  }

  const outputMatch = clean.match(CODEX_COMMAND_OUTPUT_RE);
  if (outputMatch && state.activeCommandId && !state.inFinalAnswer) {
    const output = outputMatch[1] || '(no output)';
    const outputEvent = appendCodexCommandOutput(state, output);
    const rejected = output.trim().match(CODEX_COMMAND_REJECTED_RE);
    if (rejected) {
      const failedEvent = updateCodexCommandRecordStatus(state, state.activeCommandId, 'failed');
      return { workEvents: [outputEvent, failedEvent].filter(Boolean) as CodexRuntimeWorkEvent[] };
    }
    return { workEvent: outputEvent ?? undefined };
  }

  if (CODEX_TRANSCRIPT_TRUNCATION_RE.test(clean) && state.activeCommandId && !state.inFinalAnswer) {
    return { workEvent: appendCodexCommandOutput(state, clean) ?? undefined };
  }

  const bulletProse = clean.match(CODEX_BULLET_PROSE_RE);
  if (bulletProse) {
    const completedEvents = completeRunningCodexCommands(state);
    state.activeCommandId = undefined;
    return {
      ...codexAgentLineEvent(state, bulletProse[1].trim()),
      workEvents: completedEvents,
    };
  }

  if (state.activeCommandId && !state.inFinalAnswer && isLikelyCodexAgentProseLine(clean)) {
    const completedEvents = completeRunningCodexCommands(state);
    state.activeCommandId = undefined;
    state.inFinalAnswer = true;
    return {
      ...codexAgentLineEvent(state, display, true),
      workEvents: completedEvents,
    };
  }

  if (state.activeCommandId && !state.inFinalAnswer) {
    const outputEvent = appendCodexCommandOutput(state, clean);
    const rejected = clean.match(CODEX_COMMAND_REJECTED_RE);
    if (rejected) {
      const failedEvent = updateCodexCommandRecordStatus(state, state.activeCommandId, 'failed');
      return { workEvents: [outputEvent, failedEvent].filter(Boolean) as CodexRuntimeWorkEvent[] };
    }
    return { workEvent: outputEvent ?? undefined };
  }

  if (!state.inFinalAnswer) {
    state.activeCommandId = undefined;
    return isLikelyCodexAgentProseLine(clean) ? codexAgentLineEvent(state, display) : {};
  }

  return codexAgentLineEvent(state, display, true);
}

function sanitizeRuntimeOutputChunkForFollowUp(
  cli: string,
  text: string,
  pendingLine = '',
  codexState?: CodexRuntimeOutputState,
): { content: string | null; pendingLine: string; workEvents: CodexRuntimeWorkEvent[]; events: CodexRuntimeStreamEvent[] } {
  const clean = stripRuntimeOutputControls(text);
  if (cli !== 'codex') {
    return {
      content: clean.trim() && !isTransientRuntimeStatusOnly(clean) ? clean : null,
      pendingLine: '',
      workEvents: [],
      events: [],
    };
  }

  const combined = `${pendingLine}${clean}`;
  const hasTrailingLineBreak = /\n$/.test(combined);
  const parts = combined.split('\n');
  const completeLines = hasTrailingLineBreak ? parts.slice(0, -1) : parts.slice(0, -1);
  const nextPendingLine = hasTrailingLineBreak ? '' : (parts[parts.length - 1] ?? '');
  const state = codexState ?? createCodexRuntimeOutputState();
  const agentLines: string[] = [];
  const workEvents: CodexRuntimeWorkEvent[] = [];
  const events: CodexRuntimeStreamEvent[] = [];
  for (const line of completeLines) {
    const result = processCodexRuntimeLine(state, line);
    const resultWorkEvents = result.workEvents ?? (result.workEvent ? [result.workEvent] : []);
    for (const workEvent of resultWorkEvents) {
      workEvents.push(workEvent);
      events.push({ kind: 'work', workEvent });
    }
    if (result.agentLine) {
      agentLines.push(result.agentLine);
      events.push({ kind: 'agent', text: result.agentLine });
    }
    if (result.finalAgentLine) {
      agentLines.push(result.finalAgentLine);
      events.push({ kind: 'final_agent', text: result.finalAgentLine });
    }
    if (result.sessionTitle) {
      events.push({ kind: 'session_title', title: result.sessionTitle });
    }
  }
  const display = agentLines.join('\n');
  return { content: display.trim() ? display : null, pendingLine: nextPendingLine, workEvents, events };
}

function flushRuntimeOutputChunkForFollowUp(
  cli: string,
  pendingLine = '',
  codexState?: CodexRuntimeOutputState,
): { content: string | null; workEvents: CodexRuntimeWorkEvent[]; events: CodexRuntimeStreamEvent[] } {
  const display = cli === 'codex' ? stripCodexPromptPlaceholderFromLine(pendingLine) : pendingLine;
  if (!display.trim()) return { content: null, workEvents: [], events: [] };
  if (cli === 'codex') {
    const state = codexState ?? createCodexRuntimeOutputState();
    const result = processCodexRuntimeLine(state, display);
    const events: CodexRuntimeStreamEvent[] = [];
    const resultWorkEvents = result.workEvents ?? (result.workEvent ? [result.workEvent] : []);
    for (const workEvent of resultWorkEvents) events.push({ kind: 'work', workEvent });
    if (result.agentLine) events.push({ kind: 'agent', text: result.agentLine });
    if (result.finalAgentLine) events.push({ kind: 'final_agent', text: result.finalAgentLine });
    if (result.sessionTitle) events.push({ kind: 'session_title', title: result.sessionTitle });
    return {
      content: result.finalAgentLine ?? result.agentLine ?? null,
      workEvents: resultWorkEvents,
      events,
    };
  }
  return { content: display, workEvents: [], events: [] };
}

function diffStats(patch: string): { added: number; removed: number; hunks: number } {
  const lines = patch.split(/\r?\n/);
  return {
    added: lines.filter(line => line.startsWith('+') && !line.startsWith('+++')).length,
    removed: lines.filter(line => line.startsWith('-') && !line.startsWith('---')).length,
    hunks: (patch.match(/^@@ /gm) ?? []).length,
  };
}

function pathFromPatch(patch: string): string | null {
  const diffPath = patch.match(/^diff --git a\/(.+?) b\/(.+)$/m)?.[2];
  if (diffPath) return diffPath.trim();
  const newPath = patch.match(/^\+\+\+\s+(?:b\/)?(.+)$/m)?.[1];
  return newPath?.trim() && newPath.trim() !== '/dev/null' ? newPath.trim() : null;
}

type AgentChangeSummary = {
  key: string;
  title: string;
  path: string;
  patch?: string;
  added: number;
  removed: number;
  hunks: number;
};

type AgentWorkItemKind = 'status' | 'tool' | 'command' | 'fileChange' | 'plan' | 'reasoning';
type AgentWorkItemStatus = 'inProgress' | 'completed' | 'failed' | 'declined';

type AgentWorkItem = {
  id: string;
  kind: AgentWorkItemKind;
  title: string;
  status: AgentWorkItemStatus;
  detail?: string;
  toolName?: string;
  command?: string;
  cwd?: string;
  output?: string;
  exitCode?: number | null;
  changes?: AgentChangeSummary[];
  createdAt: number;
  completedAt?: number;
};

const AGENT_WORK_ITEM_PREFIX = '__COMET_AGENT_WORK_ITEM__';

function followUpStatusToWorkItemStatus(status?: FollowUpMessage['status']): AgentWorkItemStatus {
  if (status === 'failed' || status === 'cancelled') return 'failed';
  if (status === 'completed') return 'completed';
  return 'inProgress';
}

function workItemStatusToFollowUpStatus(status: AgentWorkItemStatus): FollowUpMessage['status'] {
  if (status === 'failed' || status === 'declined') return 'failed';
  if (status === 'completed') return 'completed';
  return 'streaming';
}

function formatAgentWorkItemContent(item: AgentWorkItem): string {
  return `${AGENT_WORK_ITEM_PREFIX}\n${JSON.stringify(item)}`;
}

function parseAgentWorkItemContent(content: string): AgentWorkItem | null {
  const clean = content.trim();
  if (!clean.startsWith(AGENT_WORK_ITEM_PREFIX)) return null;
  const json = clean.slice(AGENT_WORK_ITEM_PREFIX.length).trim();
  if (!json) return null;
  try {
    const parsed = JSON.parse(json) as Partial<AgentWorkItem>;
    if (!parsed || typeof parsed !== 'object' || typeof parsed.id !== 'string' || typeof parsed.title !== 'string') return null;
    const status = parsed.status === 'completed' || parsed.status === 'failed' || parsed.status === 'declined'
      ? parsed.status
      : 'inProgress';
    const kind = parsed.kind === 'command' || parsed.kind === 'fileChange' || parsed.kind === 'plan' || parsed.kind === 'reasoning' || parsed.kind === 'status'
      ? parsed.kind
      : 'tool';
    return {
      id: parsed.id,
      kind,
      title: parsed.title,
      status,
      detail: typeof parsed.detail === 'string' ? parsed.detail : undefined,
      toolName: typeof parsed.toolName === 'string' ? parsed.toolName : undefined,
      command: typeof parsed.command === 'string' ? parsed.command : undefined,
      cwd: typeof parsed.cwd === 'string' ? parsed.cwd : undefined,
      output: typeof parsed.output === 'string' ? parsed.output : undefined,
      exitCode: typeof parsed.exitCode === 'number' || parsed.exitCode === null ? parsed.exitCode : undefined,
      changes: Array.isArray(parsed.changes) ? parsed.changes.filter(change =>
        change && typeof change === 'object' && typeof change.key === 'string' && typeof change.path === 'string'
      ) as AgentChangeSummary[] : undefined,
      createdAt: typeof parsed.createdAt === 'number' ? parsed.createdAt : Date.now(),
      completedAt: typeof parsed.completedAt === 'number' ? parsed.completedAt : undefined,
    };
  } catch {
    return null;
  }
}

function parseAgentWorkItemMessage(message: FollowUpMessage): AgentWorkItem | null {
  const structured = parseAgentWorkItemContent(message.content);
  if (structured) return structured;
  if (message.role === 'tool') {
    const legacyTool = parseAgentToolMessage(message.content);
    if (legacyTool) {
      return {
        id: message.id,
        kind: 'tool',
        title: legacyTool.label,
        detail: legacyTool.detail,
        status: followUpStatusToWorkItemStatus(message.status),
        createdAt: message.createdAt,
        completedAt: message.completedAt,
      };
    }
    const changes = collectAppliedCodeChangeSummaries(message);
    if (changes.length > 0) {
      return {
        id: message.id,
        kind: 'fileChange',
        title: 'Code changes',
        detail: `${changes.length} file${changes.length === 1 ? '' : 's'} changed`,
        status: followUpStatusToWorkItemStatus(message.status),
        changes,
        createdAt: message.createdAt,
        completedAt: message.completedAt,
      };
    }
  }
  return null;
}

function isInternalAgentWorkItem(item: AgentWorkItem | null | undefined): boolean {
  if (!item) return false;
  const toolName = (item.toolName ?? '').toLowerCase();
  const title = item.title.trim().toLowerCase();
  const detail = item.detail?.trim() ?? '';
  return (
    /^task-(?:injected|running)-\d+$/i.test(item.id)
    || toolName === 'permission'
    || title === 'permission'
    || toolName === 'send_task'
    || (title === 'send' && /^Prompt sent:/i.test(detail))
    || (title === 'run' && /^Agent accepted the task/i.test(detail))
  );
}

function agentToolKind(toolName?: string, label?: string): AgentWorkItemKind {
  const normalized = (toolName || label || '').toLowerCase().replace(/[\s.-]+/g, '_');
  if (/^(bash_run|bash_background|shell_command|run|terminal)/.test(normalized)) return 'command';
  if (/^(edit|multi_edit|write_file|apply_patch|propose_patch)$/.test(normalized)) return 'fileChange';
  if (/todo|plan/.test(normalized)) return 'plan';
  return 'tool';
}

function buildAgentWorkItemFromToolEvent(
  sessionId: string,
  event: {
    id?: string;
    toolName?: string;
    label: string;
    detail?: string;
    command?: string;
    cwd?: string;
    output?: string;
    changes?: Array<{ path: string; diff?: string; patch?: string }>;
    exitCode?: number | null;
    status?: 'running' | 'completed' | 'failed';
  },
  createdAt: number,
): AgentWorkItem {
  const status = event.status === 'completed'
    ? 'completed'
    : event.status === 'failed'
      ? 'failed'
      : 'inProgress';
  const title = formatAgentToolName(event.toolName, event.label);
  const kind = agentToolKind(event.toolName, event.label);
  const command = compactAgentShellCommandForDisplay(event.command?.trim() || event.detail?.trim() || '');
  const output = event.output ? compactAgentCommandOutput(event.output) || undefined : undefined;
  const explicitChanges = kind === 'fileChange'
    ? (event.changes ?? [])
        .map(change => {
          const patch = (change.diff ?? change.patch ?? '').trim();
          const path = change.path?.trim() || pathFromPatch(patch) || 'Updated file';
          const stats = diffStats(patch);
          return {
            key: `${stableAgentToolEventId(sessionId, event)}:${path}`,
            title: pathLeaf(path),
            path,
            patch: patch || undefined,
            added: stats.added,
            removed: stats.removed,
            hunks: stats.hunks,
          };
        })
        .filter(change => change.path)
    : [];
  const patchPath = kind === 'fileChange' && output ? pathFromPatch(output) || event.detail?.trim() || title : null;
  const changes = explicitChanges.length > 0
    ? explicitChanges
    : kind === 'fileChange' && output
    ? [{
        key: `${stableAgentToolEventId(sessionId, event)}:${patchPath ?? 'patch'}`,
        title: pathLeaf(patchPath ?? 'Patch'),
        path: patchPath ?? 'Patch',
        patch: output,
        ...diffStats(output),
      }]
    : undefined;
  return {
    id: stableAgentToolEventId(sessionId, event),
    kind,
    title,
    detail: kind === 'command' ? command || event.detail?.trim() || undefined : event.detail?.trim() || undefined,
    toolName: event.toolName,
    command: kind === 'command' ? command || undefined : compactAgentShellCommandForDisplay(event.command?.trim() || '') || undefined,
    cwd: event.cwd?.trim() || undefined,
    output,
    exitCode: event.exitCode,
    changes,
    status,
    createdAt,
    completedAt: status === 'inProgress' ? undefined : Date.now(),
  };
}

function changeHasPatch(change: AgentChangeSummary): boolean {
  return Boolean(change.patch?.trim());
}

function changeLookupKey(path: string): string {
  return normalizeDisplayPath(path).toLowerCase();
}

function workItemHasPatch(item: AgentWorkItem | null | undefined): boolean {
  return Boolean(item?.changes?.some(changeHasPatch) || item?.output?.trim());
}

function mergeAgentWorkItemUpdate(existingMessage: FollowUpMessage | undefined, next: AgentWorkItem): AgentWorkItem {
  const existing = existingMessage ? parseAgentWorkItemMessage(existingMessage) : null;
  if (
    existing
    && existing.status === 'completed'
    && next.status === 'inProgress'
    && existing.kind === next.kind
  ) {
    return {
      ...next,
      status: 'completed',
      completedAt: existing.completedAt ?? Date.now(),
      output: next.output || existing.output,
      changes: next.changes ?? existing.changes,
    };
  }
  if (!existing || existing.kind !== 'fileChange' || next.kind !== 'fileChange') return next;
  if (workItemHasPatch(next)) {
    const existingByPath = new Map((existing.changes ?? []).filter(changeHasPatch).map(change => [changeLookupKey(change.path), change]));
    if (existingByPath.size === 0) return next;
    const mergedChanges = (next.changes ?? []).map(change => {
      if (changeHasPatch(change)) return change;
      const prior = existingByPath.get(changeLookupKey(change.path));
      return prior ? { ...prior, key: change.key, title: change.title || prior.title, path: change.path || prior.path } : change;
    });
    return { ...next, changes: mergedChanges.length > 0 ? mergedChanges : next.changes };
  }
  if (workItemHasPatch(existing)) {
    return {
      ...next,
      detail: next.detail || existing.detail,
      output: next.output || existing.output,
      changes: existing.changes,
    };
  }
  return next;
}

function collectAgentWorkItems(messages: FollowUpMessage[]): AgentWorkItem[] {
  const byId = new Map<string, AgentWorkItem>();
  for (const message of messages) {
    const item = parseAgentWorkItemMessage(message);
    if (!item || isInternalAgentWorkItem(item)) continue;
    byId.set(item.id, item);
  }
  return [...byId.values()].sort((a, b) => a.createdAt - b.createdAt);
}

function collectAgentChangeSummaries(messages: FollowUpMessage[]): AgentChangeSummary[] {
  const byPath = new Map<string, AgentChangeSummary>();
  for (const message of messages) {
    const workItem = parseAgentWorkItemMessage(message);
    if (workItem?.changes?.length) {
      for (const change of workItem.changes) byPath.set(change.path, change);
    }
    for (const change of collectAppliedCodeChangeSummaries(message)) {
      byPath.set(change.path, change);
    }
    for (const block of splitAgentContent(message.content)) {
      if (block.kind !== 'patch') continue;
      const path = block.path || pathFromPatch(block.patch) || block.title;
      const stats = diffStats(block.patch);
      byPath.set(path, {
        key: `${message.id}:${path}`,
        title: block.title,
        path,
        patch: block.patch,
        added: stats.added,
        removed: stats.removed,
        hunks: stats.hunks,
      });
    }
    for (const path of message.filePaths ?? []) {
      if (byPath.has(path)) continue;
      byPath.set(path, {
        key: `${message.id}:${path}`,
        title: pathLeaf(path),
        path,
        added: 0,
        removed: 0,
        hunks: 0,
      });
    }
  }
  return [...byPath.values()];
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
  const pickerRef = useRef<HTMLDivElement | null>(null);
  const triggerRef = useRef<HTMLButtonElement | null>(null);
  const [menuStyle, setMenuStyle] = useState<CSSProperties | undefined>();
  const displayPath = displayPathForAgentDirectory(targetPath, workspaceDir);
  const fullTitle = targetPath
    ? `${targetKind === 'file' ? 'Selected file' : 'Selected folder'}: ${targetPath}`
    : workspaceDir || 'No workspace selected';

  const updateMenuBounds = () => {
    const triggerRect = triggerRef.current?.getBoundingClientRect();
    const agentWindow = pickerRef.current?.closest('.td-agent-window');
    if (!triggerRect || !(agentWindow instanceof HTMLElement)) return;
    const chatArea = agentWindow.querySelector('.td-agent-chat-area');
    const topLimit = chatArea instanceof HTMLElement
      ? chatArea.getBoundingClientRect().top
      : agentWindow.getBoundingClientRect().top;
    const availableHeight = Math.max(64, Math.floor(triggerRect.top - topLimit - 8));
    setMenuStyle({
      '--td-agent-directory-menu-max-height': `${availableHeight}px`,
    } as CSSProperties);
  };

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

  useLayoutEffect(() => {
    if (!open) return;
    updateMenuBounds();
  }, [entries.length, error, loading, open]);

  useEffect(() => {
    if (!open) return;
    const handleBoundsChange = () => updateMenuBounds();
    window.addEventListener('resize', handleBoundsChange);
    window.addEventListener('scroll', handleBoundsChange, true);
    return () => {
      window.removeEventListener('resize', handleBoundsChange);
      window.removeEventListener('scroll', handleBoundsChange, true);
    };
  }, [open]);

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
    <div className="td-agent-directory-picker" ref={pickerRef}>
      <button
        ref={triggerRef}
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
        <div className="td-agent-directory-menu" role="menu" aria-label="Current path files" style={menuStyle}>
          <AgentDirectoryMenuContent
            browsePath={browsePath}
            workspaceDir={workspaceDir}
            targetPath={targetPath}
            targetKind={targetKind}
            contextPath={contextPath}
            entries={entries}
            loading={loading}
            error={error}
            canBrowseParent={canBrowseParent}
            parentPath={parentPath}
            onBrowsePath={setBrowsePath}
            onOpenEntry={openEntry}
            onSelectContext={(path, kind) => {
              onSelectContext(path, kind);
              setActiveMenu(null);
            }}
          />
        </div>
      )}
    </div>
  );
}

function AgentDirectoryMenuContent({
  browsePath,
  workspaceDir,
  targetPath,
  targetKind,
  contextPath,
  entries,
  loading,
  error,
  canBrowseParent,
  parentPath,
  onBrowsePath,
  onOpenEntry,
  onSelectContext,
}: {
  browsePath: string;
  workspaceDir: string | null;
  targetPath: string | null;
  targetKind: FollowUpContextKind | null;
  contextPath: string | null;
  entries: FileTreeEntry[];
  loading: boolean;
  error: string | null;
  canBrowseParent: boolean;
  parentPath: string;
  onBrowsePath: (path: string) => void;
  onOpenEntry: (entry: FileTreeEntry) => void;
  onSelectContext: (path: string | null, kind: FollowUpContextKind | null) => void;
}) {
  return (
    <>
      <div className="td-agent-directory-menu-path" title={browsePath}>{displayPathForAgentDirectory(browsePath, workspaceDir)}</div>
      {workspaceDir && normalizeWorkspacePath(browsePath) !== normalizeWorkspacePath(workspaceDir) && (
        <button
          type="button"
          className="td-agent-directory-option"
          role="menuitem"
          onClick={() => onBrowsePath(workspaceDir)}
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
          onClick={() => onSelectContext(browsePath, 'folder')}
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
          onClick={() => onSelectContext(null, null)}
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
          onClick={() => onBrowsePath(parentPath)}
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
          onClick={() => onOpenEntry(entry)}
        >
          {entry.isDirectory
            ? <Folder size={13} className="text-accent-primary" />
            : <FileTypeIcon fileName={entry.name} size={13} className="opacity-85" />}
          <span>{entry.name}</span>
        </button>
      ))}
    </>
  );
}

function AgentContextSlashPopup({
  activeFilePath,
  workspaceDir,
  contextPath,
  contextKind,
  runtimeStatus,
  onSelectContext,
  onClose,
}: {
  activeFilePath: string | null;
  workspaceDir: string | null;
  contextPath: string | null;
  contextKind: FollowUpContextKind | null;
  runtimeStatus: string;
  onSelectContext: (path: string | null, kind: FollowUpContextKind | null) => void;
  onClose: () => void;
}) {
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

  useEffect(() => {
    setBrowsePath(defaultListPath ?? '');
  }, [defaultListPath]);

  useEffect(() => {
    if (!browsePath) {
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
  }, [browsePath]);

  const openEntry = (entry: FileTreeEntry) => {
    const fullPath = joinWorkspacePath(browsePath, entry.name);
    if (entry.isDirectory) {
      setBrowsePath(fullPath);
      return;
    }
    onSelectContext(fullPath, 'file');
    onClose();
  };
  const parentPath = browsePath ? dirname(browsePath) : '';
  const canBrowseParent = Boolean(parentPath && normalizeWorkspacePath(parentPath) !== normalizeWorkspacePath(browsePath));

  return (
    <div className="td-agent-context-popup" role="dialog" aria-label="Choose agent context">
      <div className="td-agent-context-popup-header">
        <span className="td-agent-context-popup-icon" aria-hidden="true"><Folder size={14} /></span>
        <span className="td-agent-context-popup-title">
          <span>Context</span>
          <small>{displayPathForAgentDirectory(targetPath, workspaceDir)} · {runtimeStatus}</small>
        </span>
        <button type="button" className="td-agent-icon-button" onClick={onClose} title="Close context picker">
          <X size={14} />
        </button>
      </div>
      <div className="td-agent-context-popup-scroll" role="menu" aria-label="Current path files">
        <AgentDirectoryMenuContent
          browsePath={browsePath}
          workspaceDir={workspaceDir}
          targetPath={targetPath}
          targetKind={targetKind}
          contextPath={contextPath}
          entries={entries}
          loading={loading}
          error={error}
          canBrowseParent={canBrowseParent}
          parentPath={parentPath}
          onBrowsePath={setBrowsePath}
          onOpenEntry={openEntry}
          onSelectContext={(path, kind) => {
            onSelectContext(path, kind);
            onClose();
          }}
        />
      </div>
      <div className="td-agent-context-popup-hint">Esc closes</div>
    </div>
  );
}

function parseFollowUpPermissionMode(value: unknown): FollowUpPermissionMode {
  return value === 'full' || value === 'restricted' ? value : 'default';
}

function permissionModeLabel(mode: FollowUpPermissionMode): string {
  if (mode === 'full') return 'Full access';
  if (mode === 'restricted') return 'Read only';
  return 'Ask for approval';
}

function permissionModeIcon(mode: FollowUpPermissionMode, className = ''): ReactNode {
  if (mode === 'full') return <AlertCircle size={14} className={`td-agent-permission-mode-icon is-full ${className}`} />;
  if (mode === 'restricted') return <Hand size={14} className={`td-agent-permission-mode-icon is-restricted ${className}`} />;
  return <Shield size={14} className={`td-agent-permission-mode-icon is-default ${className}`} />;
}

function permissionModeDescription(mode: FollowUpPermissionMode, cli: CliId, sdkBacked: boolean): string {
  if (sdkBacked) {
    if (mode === 'full') return 'Full workspace tools; writes and commands still show review cards.';
    if (mode === 'restricted') return 'No workspace tools; the agent must ask before reading or acting.';
    return 'Workspace reads allowed; writes and commands show review cards.';
  }
  if (mode === 'full') {
    if (cli === 'codex') return 'Codex: --dangerously-bypass-approvals-and-sandbox.';
    if (cli === 'claude') return 'Claude: --permission-mode bypassPermissions.';
    if (cli === 'gemini') return 'Gemini: --approval-mode yolo.';
    if (cli === 'opencode') return 'OpenCode: --dangerously-skip-permissions where supported.';
    return 'Bypass prompts where the selected CLI supports it.';
  }
  if (mode === 'restricted') {
    if (cli === 'codex') return 'Codex: read-only sandbox; approvals required to edit, run unsafe commands, or access network.';
    if (cli === 'claude') return 'Claude: --permission-mode plan.';
    if (cli === 'gemini') return 'Gemini: --approval-mode plan.';
    if (cli === 'opencode') return 'OpenCode: no read-only launch mode is exposed; uses default prompts without bypass.';
    return 'Use the selected CLI restricted/read-only mode where supported.';
  }
  if (cli === 'codex') return 'Codex: ask-for-approval non-admin sandbox.';
  if (cli === 'claude') return 'Claude: --permission-mode default.';
  if (cli === 'gemini') return 'Gemini: --approval-mode default.';
  if (cli === 'opencode') return 'OpenCode: default permission prompts; no bypass flag.';
  return 'Ask for approval using the selected CLI default permission behavior.';
}

function permissionModeInstruction(mode: FollowUpPermissionMode, cli: CliId, sdkBacked: boolean): string {
  if (mode === 'full') return `Permission mode: full access (${permissionModeDescription(mode, cli, sdkBacked)})`;
  if (mode === 'restricted' && sdkBacked) return 'Permission mode: restricted SDK transport. Workspace tools are disabled. Ask the user before reading files, searching the workspace, running commands, writing files, opening previews, or creating directories.';
  if (mode === 'restricted') return `Permission mode: read only (${permissionModeDescription(mode, cli, sdkBacked)}) Ask the user before editing files, running unsafe commands, accessing network, or writing outside the workspace.`;
  return `Permission mode: ask for approval (${permissionModeDescription(mode, cli, sdkBacked)})`;
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
        <span className="td-agent-permission-mode-label">{permissionModeLabel(mode)}</span>
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

type FollowUpTimelineMessageProps = {
  onCardAction?: (content: string, status?: FollowUpMessage['status'], options?: FollowUpCardActionOptions) => void;
  sdkCommandTerminalId?: string | null;
  onSdkCommandTerminalId?: (terminalId: string) => void;
  cardResolutions?: Map<string, SdkCardResolution>;
};

type FollowUpTimelineItem =
  | { kind: 'message'; message: FollowUpMessage }
  | { kind: 'run'; key: string; messages: FollowUpMessage[] };

function buildFollowUpTimelineItems(messages: FollowUpMessage[]): FollowUpTimelineItem[] {
  const items: FollowUpTimelineItem[] = [];
  let run: { key: string; sessionId: string; messages: FollowUpMessage[] } | null = null;

  const flushRun = () => {
    if (!run) return;
    if (run.messages.length > 0) items.push({ kind: 'run', key: run.key, messages: run.messages });
    run = null;
  };

  for (const message of messages) {
    if (message.role === 'user') {
      flushRun();
      items.push({ kind: 'message', message });
      if (message.runtimeSessionId) {
        run = { key: `run:${message.id}`, sessionId: message.runtimeSessionId, messages: [] };
      }
      continue;
    }

    if (run && message.runtimeSessionId && message.runtimeSessionId === run.sessionId) {
      run.messages.push(message);
      continue;
    }

    flushRun();
    items.push({ kind: 'message', message });
  }

  flushRun();
  return items;
}

function shouldCollapseRun(messages: FollowUpMessage[]): boolean {
  const workItems = collectAgentWorkItems(messages);
  const hasStreamingWork = messages.some(message => {
    if (message.status !== 'streaming') return false;
    return Boolean(parseAgentWorkItemMessage(message));
  });
  const hasPendingNonAgent = messages.some(message =>
    message.role !== 'agent'
    && (message.status === 'streaming' || message.status === 'sending' || message.status === 'queued')
  );
  const hasCompletedAgent = messages.some(message =>
    message.role === 'agent' &&
    (message.status === 'completed' || message.status === 'failed' || message.status === 'cancelled')
  );
  const lastVisible = [...messages].reverse().find(message => {
    const workItem = parseAgentWorkItemMessage(message);
    if (isInternalAgentWorkItem(workItem) || (!workItem && isInternalAgentStatusMessage(message))) return false;
    if (message.role === 'agent') return Boolean(agentDisplayContentWithoutMetadata(message.content).trim());
    return Boolean(workItem);
  });
  const finalAnswerStreaming = Boolean(
    workItems.length > 0
    && lastVisible?.role === 'agent'
    && lastVisible.status === 'streaming'
    && !hasStreamingWork
    && !hasPendingNonAgent
  );
  return messages.length > 0 && !hasStreamingWork && !hasPendingNonAgent && (hasCompletedAgent || finalAnswerStreaming);
}

function FollowUpMessageTimeline({
  messages,
  onCardAction,
  sdkCommandTerminalId,
  onSdkCommandTerminalId,
  cardResolutions,
}: { messages: FollowUpMessage[] } & FollowUpTimelineMessageProps) {
  const items = buildFollowUpTimelineItems(messages);
  return (
    <>
      {items.map(item => (
        item.kind === 'run' && shouldCollapseRun(item.messages)
          ? (
            <AgentRunTranscriptGroup
              key={item.key}
              messages={item.messages}
              onCardAction={onCardAction}
              sdkCommandTerminalId={sdkCommandTerminalId}
              onSdkCommandTerminalId={onSdkCommandTerminalId}
              cardResolutions={cardResolutions}
            />
          )
          : item.kind === 'run'
            ? (
              <AgentTurnLiveGroup
                key={item.key}
                messages={item.messages}
                onCardAction={onCardAction}
                sdkCommandTerminalId={sdkCommandTerminalId}
                onSdkCommandTerminalId={onSdkCommandTerminalId}
                cardResolutions={cardResolutions}
              />
            )
            : (
              <FollowUpChatMessage
                key={item.message.id}
                message={item.message}
                onCardAction={onCardAction}
                sdkCommandTerminalId={sdkCommandTerminalId}
                onSdkCommandTerminalId={onSdkCommandTerminalId}
                cardResolutions={cardResolutions}
              />
            )
      ))}
    </>
  );
}

function AgentRunTranscriptGroup({
  messages,
  onCardAction,
  sdkCommandTerminalId,
  onSdkCommandTerminalId,
  cardResolutions,
}: { messages: FollowUpMessage[] } & FollowUpTimelineMessageProps) {
  const [expanded, setExpanded] = useState(false);
  const startedAt = messages.reduce((min, message) => Math.min(min, message.createdAt), Number.POSITIVE_INFINITY);
  const completedAt = messages.reduce((max, message) => Math.max(max, message.completedAt ?? message.createdAt), 0);
  const agentSummary = [...messages].reverse().find(message => message.role === 'agent') ?? null;
  const changes = collectAgentChangeSummaries(messages);
  const workItems = collectAgentWorkItems(messages);
  const tokenUsage = collectAgentTokenUsage(messages);
  const duration = Number.isFinite(startedAt) ? formatDuration(startedAt, completedAt) : null;

  return (
    <div className="td-agent-run-group">
      <button
        type="button"
        className="td-agent-run-header"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>Worked for {duration ?? 'a moment'}</span>
        <small>{workItems.length} action{workItems.length === 1 ? '' : 's'}</small>
      </button>
      {expanded ? (
        <div className="td-agent-run-transcript">
          <AgentTurnLiveGroup
            messages={messages}
            onCardAction={onCardAction}
            sdkCommandTerminalId={sdkCommandTerminalId}
            onSdkCommandTerminalId={onSdkCommandTerminalId}
            cardResolutions={cardResolutions}
          />
        </div>
      ) : (
        <div className="td-agent-run-summary">
          {agentSummary && (
            <AgentMessageContent
              message={agentSummary}
              onCardAction={onCardAction}
              sdkCommandTerminalId={sdkCommandTerminalId}
              onSdkCommandTerminalId={onSdkCommandTerminalId}
              cardResolutions={cardResolutions}
            />
          )}
          {workItems.length > 0 && <AgentTurnSummary workItems={workItems} tokenUsage={tokenUsage} />}
          {changes.length > 0 && <AgentChangeSummaryCard changes={changes} />}
        </div>
      )}
    </div>
  );
}

function AgentTurnLiveGroup({
  messages,
  onCardAction,
  sdkCommandTerminalId,
  onSdkCommandTerminalId,
  cardResolutions,
}: { messages: FollowUpMessage[] } & FollowUpTimelineMessageProps) {
  return (
    <div className="td-agent-turn-live">
      {messages.map(message => {
        const workItem = parseAgentWorkItemMessage(message);
        if (isInternalAgentWorkItem(workItem) || (!workItem && isInternalAgentStatusMessage(message))) return null;
        if (workItem) return <AgentWorkItemCard key={message.id} item={workItem} />;
        if (message.role === 'agent' && !agentDisplayContentWithoutMetadata(message.content).trim()) return null;
        return (
          <FollowUpChatMessage
            key={message.id}
            message={message}
            onCardAction={onCardAction}
            sdkCommandTerminalId={sdkCommandTerminalId}
            onSdkCommandTerminalId={onSdkCommandTerminalId}
            cardResolutions={cardResolutions}
          />
        );
      })}
    </div>
  );
}

type AgentTurnSummaryFilter = 'done' | 'failed' | 'commands' | 'files';

function AgentTurnSummary({ workItems, tokenUsage }: { workItems: AgentWorkItem[]; tokenUsage?: AgentTokenUsage | null }) {
  const [activeFilter, setActiveFilter] = useState<AgentTurnSummaryFilter | null>(null);
  const completed = workItems.filter(item => item.status === 'completed').length;
  const failed = workItems.filter(item => item.status === 'failed' || item.status === 'declined').length;
  const changedFiles = new Set(workItems.flatMap(item => item.changes?.map(change => change.path) ?? []));
  const commandCount = workItems.filter(item => item.kind === 'command').length;
  const allSummaryItems: Array<{ id: AgentTurnSummaryFilter; label: string; count: number; error?: boolean }> = [
    { id: 'done', label: 'done', count: completed },
    { id: 'failed', label: 'failed', count: failed, error: true },
    { id: 'commands', label: `command${commandCount === 1 ? '' : 's'}`, count: commandCount },
    { id: 'files', label: `file${changedFiles.size === 1 ? '' : 's'} changed`, count: changedFiles.size },
  ];
  const summaryItems = allSummaryItems.filter(item => item.count > 0);
  const activeItems = activeFilter ? filterAgentTurnSummaryItems(workItems, activeFilter) : [];
  const usageTitle = tokenUsage ? formatAgentTokenUsageDetail(tokenUsage) : '';
  return (
    <div className="td-agent-turn-summary-wrap">
      <div className="td-agent-turn-summary">
        <div className="td-agent-turn-summary-pills">
          {summaryItems.map(item => (
            <button
              key={item.id}
              type="button"
              className={`${item.error ? 'is-error' : ''} ${activeFilter === item.id ? 'is-active' : ''}`.trim()}
              onClick={() => setActiveFilter(current => current === item.id ? null : item.id)}
              aria-expanded={activeFilter === item.id}
            >
              {item.count} {item.label}
            </button>
          ))}
        </div>
        {tokenUsage && (
          <span className="td-agent-turn-token-usage" title={usageTitle}>
            {formatAgentTokenUsageTotal(tokenUsage)}
          </span>
        )}
      </div>
      {activeFilter && (
        <div className="td-agent-turn-filtered-work" aria-label={`${summaryItems.find(item => item.id === activeFilter)?.label ?? 'Filtered'} work items`}>
          {activeItems.map(item => (
            <AgentWorkItemCard
              key={`${activeFilter}:${item.id}`}
              item={item}
              initiallyExpanded={activeFilter === 'commands' || activeFilter === 'failed'}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function filterAgentTurnSummaryItems(workItems: AgentWorkItem[], filter: AgentTurnSummaryFilter): AgentWorkItem[] {
  switch (filter) {
    case 'done':
      return workItems.filter(item => item.status === 'completed');
    case 'failed':
      return workItems.filter(item => item.status === 'failed' || item.status === 'declined');
    case 'commands':
      return workItems.filter(item => item.kind === 'command' || Boolean(item.command));
    case 'files':
      return workItems.filter(item => item.changes?.length);
  }
}

function AgentChangeSummaryCard({ changes, compact = false }: { changes: AgentChangeSummary[]; compact?: boolean }) {
  const [expanded, setExpanded] = useState(false);
  const totalAdded = changes.reduce((sum, item) => sum + item.added, 0);
  const totalRemoved = changes.reduce((sum, item) => sum + item.removed, 0);
  return (
    <div className={`td-agent-change-summary-card ${compact ? 'is-compact' : ''}`}>
      <button
        type="button"
        className="td-agent-change-summary-header"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
      >
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span>Code changes</span>
        <AgentChangeStats added={totalAdded} removed={totalRemoved} />
      </button>
      <div className="td-agent-change-summary-list">
        {changes.map(change => (
          <div key={change.key} className="td-agent-change-summary-file">
            <span className="td-agent-change-file-name" title={change.path}>{compactDisplayPath(change.path)}</span>
            <AgentChangeStats added={change.added} removed={change.removed} />
          </div>
        ))}
      </div>
      {expanded && changes.some(change => change.patch) && (
        <div className="td-agent-change-summary-diffs">
          {changes.filter(change => change.patch).map(change => (
            <AgentDiffBlock key={`${change.key}:diff`} patch={change.patch ?? ''} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentChangeStats({ added, removed }: { added: number; removed: number }) {
  return (
    <span className="td-agent-change-stats">
      <span className="td-agent-change-added">+{added}</span>
      <span className="td-agent-change-removed">-{removed}</span>
    </span>
  );
}

function AgentDiffBlock({ patch }: { patch: string }) {
  const lines = patch.split(/\r?\n/);
  return (
    <pre className="td-agent-diff-block"><code>{lines.map((line, index) => {
        const kind = line.startsWith('+') && !line.startsWith('+++')
          ? 'added'
          : line.startsWith('-') && !line.startsWith('---')
            ? 'removed'
            : 'context';
        return (
          <span key={`${index}:${line.slice(0, 16)}`} className={`td-agent-diff-line is-${kind}`}>
            {line || ' '}
          </span>
        );
      })}</code></pre>
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
  const workItem = parseAgentWorkItemMessage(message);
  if (workItem) return <AgentWorkItemCard item={workItem} />;
  if (message.role === 'agent' && !agentDisplayContentWithoutMetadata(message.content).trim()) return null;

  const hasInteractiveSdkContent = (message.role === 'system' || message.role === 'tool')
    ? followUpToolMessageHasInteractiveSdkContent(message.content)
    : false;
  const appliedChanges = message.role === 'tool' ? collectAppliedCodeChangeSummaries(message) : [];
  if (appliedChanges.length > 0) {
    return <AgentChangeSummaryCard changes={appliedChanges} />;
  }
  if ((message.role === 'system' || message.role === 'tool') && !hasInteractiveSdkContent) {
    return <AgentStatusToast message={message} />;
  }

  return (
    <div className={`td-agent-message is-${message.role} ${message.status === 'streaming' ? 'is-streaming' : ''}`}>
      <div className="td-agent-message-meta">
        <span>{message.role === 'user' ? 'You' : 'Agent'}</span>
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
  const content = message.role === 'agent'
    ? agentDisplayContentWithoutMetadata(message.content)
    : stripAgentTokenUsage(message.content);
  if (message.role === 'user') {
    return (
      <div className="td-agent-message-content">
        <div className="td-agent-markdown">
          <ReactMarkdown>{content}</ReactMarkdown>
        </div>
      </div>
    );
  }
  const blocks = splitAgentContent(content, {
    parseStatus: message.role !== 'agent' || message.status === 'streaming',
  });
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
  const [expanded, setExpanded] = useState(false);
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
  const stats = diffStats(patch);

  return (
    <div className="td-agent-patch-card">
      <button type="button" className="td-agent-patch-header" onClick={() => setExpanded(value => !value)} aria-expanded={expanded}>
        <span>{expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}<Hammer size={13} /> {title}</span>
        <small>+{stats.added} -{stats.removed} · {effectiveState === 'reviewing' ? 'reviewing' : effectiveState === 'denied' ? 'denied' : `${hunkCount} hunk${hunkCount === 1 ? '' : 's'}`}</small>
      </button>
      {path && <div className="td-agent-patch-path">{path}</div>}
      {expanded && <AgentDiffBlock patch={patch} />}
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
  const usageLimits = parseAgentUsageLimitMessage(message.content);
  if (usageLimits) return <AgentUsageLimitCard payload={usageLimits} />;

  const item = parseAgentWorkItemMessage(message);
  if (item) return <AgentWorkItemCard item={item} />;
  const tool = message.role === 'tool' ? parseAgentToolMessage(message.content) : null;
  if (tool) {
    return (
      <AgentToolActivityRow
        label={tool.label}
        detail={tool.detail}
        status={message.status}
      />
    );
  }
  const status = statusPresentation(message);
  if (message.role === 'system' && status.tone === 'info' && classifyAgentStatusMessage(message).kind === 'agent_update') {
    return <AgentSystemNotice message={message} />;
  }
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

function AgentSystemNotice({ message }: { message: FollowUpMessage }) {
  return (
    <div className="td-agent-system-notice">
      <AgentMessageContent message={message} />
    </div>
  );
}

function AgentUsageLimitCard({ payload }: { payload: AgentUsageLimitPayload }) {
  return (
    <div className="td-agent-usage-card">
      <div className="td-agent-usage-header">
        <span>Usage limits</span>
      </div>
      <div className="td-agent-usage-list">
        {payload.rows.map(row => <AgentUsageLimitRowView key={row.id} row={row} />)}
      </div>
    </div>
  );
}

function formatUsageResetText(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) return '';
  const unixMatch = /\b(?:unix\s*)?(\d{10,13})\b/i.exec(trimmed);
  if (unixMatch) {
    const numeric = Number(unixMatch[1]);
    const millis = unixMatch[1].length >= 13 ? numeric : numeric * 1000;
    if (Number.isFinite(millis)) {
      const date = new Date(millis);
      if (!Number.isNaN(date.getTime())) {
        return `Resets ${new Intl.DateTimeFormat(undefined, {
          month: 'short',
          day: 'numeric',
          year: 'numeric',
          hour: 'numeric',
          minute: '2-digit',
        }).format(date)}`;
      }
    }
  }
  if (/^resets?\b/i.test(trimmed)) return trimmed.replace(/^resets?/i, 'Resets');
  return `Resets ${trimmed}`;
}

function AgentUsageLimitRowView({ row }: { row: AgentUsageLimitRow }) {
  const detail = [
    row.used !== undefined && row.total !== undefined ? `${formatUsageLimitValue(row.used)} / ${formatUsageLimitValue(row.total)}` : '',
    row.remaining !== undefined ? `${formatUsageLimitValue(row.remaining)} left` : '',
    row.reset ? formatUsageResetText(row.reset) : '',
  ].filter(Boolean).join(' · ');
  return (
    <div className="td-agent-usage-row">
      <div className="td-agent-usage-row-top">
        <span>{row.label}</span>
        <strong>{row.percent}%</strong>
      </div>
      <div className="td-agent-usage-progress" aria-label={`${row.label} ${row.percent}% used`}>
        <span style={{ width: `${row.percent}%` }} />
      </div>
      {detail && <small>{detail}</small>}
    </div>
  );
}

function AgentWorkItemCard({ item, initiallyExpanded = false }: { item: AgentWorkItem; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  if (item.kind === 'fileChange' && item.changes?.some(changeHasPatch)) {
    return <AgentWorkItemCodeChangeCard item={item} initiallyExpanded={initiallyExpanded} />;
  }

  const failed = item.status === 'failed' || item.status === 'declined';
  const complete = item.status === 'completed';
  const hasDetails = Boolean(item.output || item.command || item.cwd);
  const detail = item.detail || (item.changes?.length ? `${item.changes.length} file${item.changes.length === 1 ? '' : 's'} changed` : undefined);
  return (
    <div className={`td-agent-work-item is-${failed ? 'error' : complete ? 'complete' : 'running'} is-${item.kind}`}>
      <div className="td-agent-work-item-main">
        <span className="td-agent-work-item-state">
          {failed
            ? <AlertCircle size={13} />
            : complete
              ? <CheckCircle2 size={13} />
              : <Loader2 size={13} className="td-agent-spin" />}
        </span>
        <span className="td-agent-work-item-copy">
          <strong>{item.title}</strong>
          {detail && <small>{detail}</small>}
        </span>
        {hasDetails && (
          <button
            type="button"
            className="td-agent-work-item-toggle"
            onClick={() => setExpanded(value => !value)}
            aria-expanded={expanded}
            title={expanded ? 'Collapse details' : 'Expand details'}
          >
            {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          </button>
        )}
      </div>
      {item.changes?.some(changeHasPatch) ? <AgentChangeSummaryCard changes={item.changes} compact /> : null}
      {expanded && hasDetails && (
        <div className="td-agent-work-item-details">
          {item.command && <pre><code>{item.command}</code></pre>}
          {item.cwd && <small>CWD: {item.cwd}</small>}
          {item.output && <pre><code>{item.output}</code></pre>}
        </div>
      )}
    </div>
  );
}

function AgentWorkItemCodeChangeCard({ item, initiallyExpanded = false }: { item: AgentWorkItem; initiallyExpanded?: boolean }) {
  const [expanded, setExpanded] = useState(initiallyExpanded);
  const changes = item.changes ?? [];
  const totalAdded = changes.reduce((sum, change) => sum + change.added, 0);
  const totalRemoved = changes.reduce((sum, change) => sum + change.removed, 0);
  const failed = item.status === 'failed' || item.status === 'declined';
  const complete = item.status === 'completed';
  return (
    <div className={`td-agent-work-item td-agent-code-work-item is-${failed ? 'error' : complete ? 'complete' : 'running'} is-fileChange`}>
      <button
        type="button"
        className="td-agent-code-work-header"
        onClick={() => setExpanded(value => !value)}
        aria-expanded={expanded}
      >
        <span className="td-agent-work-item-state">
          {failed
            ? <AlertCircle size={13} />
            : complete
              ? <CheckCircle2 size={13} />
              : <Loader2 size={13} className="td-agent-spin" />}
        </span>
        {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        <span className="td-agent-work-item-copy">
          <strong>{item.title}</strong>
          <small>{item.detail || `${changes.length} file${changes.length === 1 ? '' : 's'} changed`}</small>
        </span>
        <AgentChangeStats added={totalAdded} removed={totalRemoved} />
      </button>
      <div className="td-agent-change-summary-list">
        {changes.map(change => (
          <div key={change.key} className="td-agent-change-summary-file">
            <span className="td-agent-change-file-name" title={change.path}>{compactDisplayPath(change.path)}</span>
            <AgentChangeStats added={change.added} removed={change.removed} />
          </div>
        ))}
      </div>
      {expanded && changes.some(change => change.patch) && (
        <div className="td-agent-change-summary-diffs">
          {changes.filter(change => change.patch).map(change => (
            <AgentDiffBlock key={`${change.key}:diff`} patch={change.patch ?? ''} />
          ))}
        </div>
      )}
    </div>
  );
}

function AgentToolActivityRow({
  label,
  detail,
  status,
}: {
  label: string;
  detail?: string;
  status?: FollowUpMessage['status'];
}) {
  const failed = status === 'failed';
  const complete = status === 'completed';
  return (
    <div className={`td-agent-tool-row ${failed ? 'is-error' : complete ? 'is-complete' : 'is-running'}`}>
      <span className="td-agent-tool-state">
        {failed
          ? <AlertCircle size={13} />
          : complete
            ? <CheckCircle2 size={13} />
            : <Loader2 size={13} className="td-agent-spin" />}
      </span>
      <span className="td-agent-tool-copy">
        <strong>{label}</strong>
        {detail && <small>{detail}</small>}
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

function runtimeLiveStatusLabel(state?: string | null): string {
  const normalized = (state || '').toLowerCase();
  if (normalized === 'awaiting_cli_ready') return 'Awaiting CLI ready';
  if (normalized === 'launching_cli') return 'Launching CLI';
  if (normalized === 'creating') return 'Starting';
  if (normalized === 'waiting_auth') return 'Waiting for auth';
  if (normalized === 'registering_mcp' || normalized === 'awaiting_mcp_ready') return 'Preparing tools';
  if (normalized === 'bootstrap_injecting' || normalized === 'bootstrap_sent' || normalized === 'injecting_task' || normalized === 'awaiting_ack') {
    return 'Sending prompt';
  }
  if (normalized === 'awaiting_permission') return 'Waiting for permission';
  if (/stopping/i.test(normalized)) return 'Stopping';
  return 'Thinking';
}

function AgentRuntimeStatusLine({ label, elapsedSeconds }: { label: string; elapsedSeconds: number }) {
  return (
    <div className="td-agent-runtime-status-line">
      <Loader2 size={13} className="td-agent-spin" />
      <strong>{label}</strong>
      <small>{elapsedSeconds}s</small>
    </div>
  );
}

function isPermissionCommandJunk(value: string): boolean {
  const clean = value.trim();
  return !clean
    || /^[-_─━|│╭╮╰╯\s]+$/.test(clean)
    || /^Would you like to run the following command\??$/i.test(clean)
    || /^Press enter to confirm or esc to cancel$/i.test(clean);
}

function permissionCommandText(permission: RuntimePermissionRequest): string {
  const raw = stripRuntimeOutputControls(`${permission.rawPrompt || ''}\n${permission.detail || ''}`).replace(/\r/g, '\n');
  const shellPromptMatch = raw.match(/\$\s*([\s\S]*?)(?=\n\s*(?:[›>]\s*)?[123]\.\s+|\n\s*Press enter\b|$)/i);
  const shellCommand = shellPromptMatch?.[1]?.replace(/\s+/g, ' ').trim();
  if (shellCommand && !isPermissionCommandJunk(shellCommand)) return shellCommand;

  const questionMatch = raw.match(/Would you like to run the following command\??\s*([\s\S]*?)(?=\n\s*(?:[›>]\s*)?[123]\.\s+|\n\s*Press enter\b|$)/i);
  const questionCommand = questionMatch?.[1]?.replace(/^\s*\$\s*/, '').replace(/\s+/g, ' ').trim();
  if (questionCommand && !isPermissionCommandJunk(questionCommand)) return questionCommand;

  const commandish = raw
    .split(/\r?\n/)
    .map(line => line.trim().replace(/^\$\s*/, ''))
    .filter(line =>
      line
      && !isPermissionCommandJunk(line)
      && !/^[›>]\s*[123]\.\s+/i.test(line)
      && !/^[123]\.\s+(?:Yes|No)\b/i.test(line)
      && !/^Permission needed/i.test(line)
      && !/^Codex .*permission/i.test(line)
    )
    .find(line => /(?:\brg\b|Get-ChildItem|Select-Object|Measure-Object|powershell|pwsh|npm|node|git|python|cargo|pip|curl|bash|\|\s*)/i.test(line));
  return commandish && !isPermissionCommandJunk(commandish) ? commandish : '';
}

function permissionReviewText(permission: RuntimePermissionRequest): string {
  const command = permissionCommandText(permission);
  if (command) return command;
  const raw = stripRuntimeOutputControls(`${permission.rawPrompt || permission.detail}`)
    .split(/\r?\n/)
    .map(line => line.trimEnd())
    .filter(line => {
      const clean = line.trim();
      if (!clean) return false;
      return !/^[›>]\s*[123]\.\s+/i.test(clean)
        && !/^[123]\.\s+(?:Yes|No)\b/i.test(clean)
        && !/^Press enter to confirm or esc to cancel/i.test(clean);
    })
    .join('\n')
    .trim();
  return raw || permission.detail;
}

function permissionPopupSummary(permission: RuntimePermissionRequest): string {
  const text = (permissionCommandText(permission) || permissionReviewText(permission))
    .replace(/\s+/g, ' ')
    .replace(/\bWould you like to run the following command\??\s*/i, '')
    .trim();
  return text || permission.category.replace(/_/g, ' ');
}

function AgentPermissionPopup({
  permission,
  sessionId,
  elapsedSeconds,
}: {
  permission: RuntimePermissionRequest;
  sessionId: string;
  elapsedSeconds: number;
}) {
  const updatePrompt = isCodexUpdatePermissionPrompt(permission);
  const approveLabel = updatePrompt ? 'Update' : 'Approve';
  const denyLabel = updatePrompt ? 'Skip' : 'Deny';
  const reviewText = permissionReviewText(permission);
  const command = permissionCommandText(permission);
  const summary = permissionPopupSummary(permission);
  return (
    <div
      className="td-agent-permission-popup"
      role="dialog"
      aria-label="Permission needed"
    >
      <div className="td-agent-permission-popup-header">
        <span className="td-agent-permission-icon">
          <Shield size={14} />
        </span>
        <span className="td-agent-permission-popup-title">
          <strong>{updatePrompt ? 'Codex update' : 'Permission needed'}</strong>
          <small>{permission.category.replace(/_/g, ' ')}</small>
        </span>
        <span className="td-agent-permission-popup-summary" title={summary}>{summary}</span>
      </div>
      <div className="td-agent-permission-live-status">
        <Loader2 size={12} className="td-agent-spin" />
        <strong>Waiting for permission</strong>
        <small>{elapsedSeconds}s</small>
      </div>
      {command && (
        <div className="td-agent-permission-command" title={command}>
          <TerminalSquare size={13} />
          <code>{command}</code>
        </div>
      )}
      <pre className="td-agent-permission-details"><code>{reviewText}</code></pre>
      <div className="td-agent-permission-popup-actions">
        <button
          type="button"
          className="td-agent-permission-popup-option is-deny"
          onMouseDown={event => event.preventDefault()}
          onClick={() => void runtimeManager.resolvePermission({ sessionId, permissionId: permission.permissionId, decision: 'deny' })}
        >
          <span className="td-agent-slash-icon"><X size={14} /></span>
          <span className="td-agent-slash-command">{denyLabel}</span>
          <span className="td-agent-slash-copy">
            <span>{updatePrompt ? 'Continue without update' : 'Reject request'}</span>
            <small>{updatePrompt ? 'Skip this Codex update prompt.' : 'Return a denial to the CLI.'}</small>
          </span>
        </button>
        <button
          type="button"
          className="td-agent-permission-popup-option is-approve is-selected"
          onMouseDown={event => event.preventDefault()}
          onClick={() => void runtimeManager.resolvePermission({ sessionId, permissionId: permission.permissionId, decision: 'approve' })}
        >
          <span className="td-agent-slash-icon"><CheckCircle2 size={14} /></span>
          <span className="td-agent-slash-command">{approveLabel}</span>
          <span className="td-agent-slash-copy">
            <span>{updatePrompt ? 'Run the update' : 'Allow request'}</span>
            <small>{updatePrompt ? 'Let Codex update before continuing.' : 'Send approval back to the CLI.'}</small>
          </span>
        </button>
      </div>
      <div className="td-agent-slash-hint">Choose an action to continue the run.</div>
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
  const renamePane = useWorkspaceStore(s => s.renamePane);
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
  const visibleMessages = messages.filter(message => message.status !== 'queued' && !isInternalAgentStatusMessage(message));
  const threadId = (pane.data?.followUpThreadId as string | undefined) ?? `thread:${missionId}`;
  const followUpSessions = useMemo(() => {
    const stored = Array.isArray(pane.data?.followUpSessions)
      ? pane.data.followUpSessions
          .map(normalizeFollowUpSessionRecord)
          .filter((session): session is FollowUpSessionRecord => Boolean(session))
      : [];
    if (stored.some(session => session.threadId === threadId)) return stored;
    return [{
      threadId,
      runtimeSessionId: typeof pane.data?.followUpRuntimeSessionId === 'string' ? pane.data.followUpRuntimeSessionId : null,
      title: messages.find(message => message.role === 'user')?.content
        ? sessionTitleFromPrompt(messages.find(message => message.role === 'user')?.content ?? '')
        : 'Workspace chat',
      createdAt: messages[0]?.createdAt ?? Date.now(),
      updatedAt: messages[messages.length - 1]?.createdAt ?? Date.now(),
    }, ...stored];
  }, [messages, pane.data?.followUpRuntimeSessionId, pane.data?.followUpSessions, threadId]);
  const selectedCli = (pane.data?.followUpCli as CliId | undefined) ?? 'codex';
  const selectedModel = (pane.data?.followUpModel as string | undefined) ?? '';
  const selectedSkillId = (pane.data?.followUpSkillId as string | undefined) ?? '';
  const selectedPermissionMode = parseFollowUpPermissionMode(pane.data?.followUpPermissionMode);
  const selectedContextPath = typeof pane.data?.followUpContextPath === 'string' && pane.data.followUpContextPath.trim()
    ? pane.data.followUpContextPath.trim()
    : null;
  const selectedContextKind = parseFollowUpContextKind(pane.data?.followUpContextKind);
  const selectedGoal = typeof pane.data?.followUpGoal === 'string' && pane.data.followUpGoal.trim()
    ? pane.data.followUpGoal.trim()
    : null;
  const selectedReasoning = normalizeReasoningEffort(
    typeof pane.data?.followUpReasoning === 'string' ? pane.data.followUpReasoning : null,
  );
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
  const followUpBusyState = pane.data?.followUpBusyState as { sessionId?: string; state?: string | null; active?: boolean; updatedAt?: number } | undefined;
  const sdkCommandTerminalId = typeof pane.data?.followUpSdkCommandTerminalId === 'string'
    ? pane.data.followUpSdkCommandTerminalId
    : null;
  const sessionPolicy: FollowUpSessionPolicy = selectedSessionId ? 'wait' : 'new';
  const attachments: Array<{ id: string; kind: 'file' | 'image'; name: string; path?: string }> = pane.data?.followUpAttachments ?? [];
  const pendingQueue: FollowUpPendingItem[] = pane.data?.followUpQueue ?? [];
  const [prompt, setPrompt] = useState('');
  const [models, setModels] = useState<CliModel[]>([]);
  const [skills, setSkills] = useState<CliSkill[]>([]);
  const [nativeCommands, setNativeCommands] = useState<CliDiscoveredCommand[]>([]);
  const [capabilityWarnings, setCapabilityWarnings] = useState<string[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [runtimeSnapshot, setRuntimeSnapshot] = useState<RuntimeManagerSnapshot>(() => runtimeManager.snapshot());
  const [submitting, setSubmitting] = useState(false);
  const [runtimeLiveStatusClock, setRuntimeLiveStatusClock] = useState(() => Date.now());
  const [activeMenu, setActiveMenu] = useState<string | null>(null);
  const [skillsOpen, setSkillsOpen] = useState(false);
  const [storedOpenAiApiKey, setStoredOpenAiApiKeyState] = useState(() => getStoredOpenAiApiKey());
  const [, bumpOpenAiConfigVersion] = useState(0);
  const [, setSdkStep] = useState<string | null>(null);
  const [sdkUsage, setSdkUsage] = useState<SdkChatUsageDelta | null>(null);
  const [sdkFinishMeta, setSdkFinishMeta] = useState<SdkChatFinishMeta | null>(null);
  const [cliContextPercent, setCliContextPercent] = useState<number | null>(null);
  const [cliContextTokenUsage, setCliContextTokenUsage] = useState<ContextTokenUsage | null>(null);
  const [cliUsageLimitRows, setCliUsageLimitRows] = useState<AgentUsageLimitRow[]>([]);
  const [cliUsageLimitRaw, setCliUsageLimitRaw] = useState('');
  const [usagePopoverPayload, setUsagePopoverPayload] = useState<AgentUsageLimitPayload | null>(null);
  const [usagePopoverStatus, setUsagePopoverStatus] = useState<string | null>(null);
  const [contextSlashPickerOpen, setContextSlashPickerOpen] = useState(false);
  const [liveCodeChanges, setLiveCodeChanges] = useState<AgentChangeSummary[]>([]);
  const sdkAbortRef = useRef<AbortController | null>(null);
  const pendingSdkAutoContinueRef = useRef<string | null>(null);
  const followUpSnapshotsRef = useRef<Map<string, FollowUpWorkspaceSnapshot>>(new Map());
  const finalizedSnapshotSessionsRef = useRef<Set<string>>(new Set());
  const liveCodeChangeSessionRef = useRef<string | null>(null);
  const liveCodeChangeRefreshTimerRef = useRef<number | null>(null);
  const liveCodeChangeRefreshInFlightRef = useRef(false);
  const cliContextOutputTailRef = useRef('');
  const runtimeOutputDisplaySessionsRef = useRef<Set<string>>(new Set());
  const runtimeOutputPendingLinesRef = useRef<Map<string, string>>(new Map());
  const runtimeOutputCodexStateRef = useRef<Map<string, CodexRuntimeOutputState>>(new Map());
  const runtimeOutputLastEntryKindRef = useRef<Map<string, 'agent' | 'work'>>(new Map());
  const followUpIdleClearTimerRef = useRef<number | null>(null);
  const handledDebugAgentPromptIdsRef = useRef<Set<string>>(new Set());
  const agentOutputScrollRef = useRef<HTMLDivElement | null>(null);
  const agentOutputShouldStickRef = useRef(true);
  const promptInputRef = useRef<HTMLTextAreaElement | null>(null);
  const promptHistoryIndexRef = useRef<number | null>(null);
  const promptHistoryDraftRef = useRef('');
  const slashMenuRef = useRef<HTMLDivElement | null>(null);
  const slashOptionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const [slashCommandIndex, setSlashCommandIndex] = useState(0);
  const [slashPickerCommand, setSlashPickerCommand] = useState<'cli' | 'model' | 'agent' | 'permission' | 'reasoning' | null>(null);
  const [slashPickerStandalone, setSlashPickerStandalone] = useState(false);
  const [draggingQueueId, setDraggingQueueId] = useState<string | null>(null);
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
  const explicitAgentContextDirectory = selectedContextPath
    ? selectedContextKind === 'file'
      ? dirname(selectedContextPath)
      : selectedContextPath
    : null;
  const runtimeWorkspaceDir = explicitAgentContextDirectory || effectiveWorkspaceDir;

  function isAgentOutputScrolledToBottom(element: HTMLElement): boolean {
    return element.scrollHeight - element.scrollTop - element.clientHeight <= 8;
  }

  function handleAgentOutputScroll() {
    const element = agentOutputScrollRef.current;
    if (!element) return;
    agentOutputShouldStickRef.current = isAgentOutputScrolledToBottom(element);
  }

  useEffect(() => {
    return () => clearFollowUpIdleCompletionTimer();
  }, []);

  useEffect(() => {
    if (placement !== 'tab' || pane.data?.dockExpandedToTab !== true) return;
    if (pane.title !== selectedAgent.name) {
      renamePane(pane.id, selectedAgent.name);
    }
  }, [pane.data?.dockExpandedToTab, pane.id, pane.title, placement, renamePane, selectedAgent.name]);
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

  function setFollowUpBusyState(sessionId: string, state: string | null) {
    setSdkStep(state);
    updatePaneData(pane.id, {
      followUpBusyState: {
        sessionId,
        state,
        active: true,
        updatedAt: Date.now(),
      },
    });
  }

  function clearFollowUpBusyState(sessionId?: string) {
    setSdkStep(null);
    const currentPane = useWorkspaceStore.getState().tabs
      .flatMap(tab => tab.panes)
      .find(candidate => candidate.id === pane.id);
    const currentBusyState = currentPane?.data?.followUpBusyState as { sessionId?: string; active?: boolean } | undefined;
    if (sessionId && currentBusyState?.sessionId && currentBusyState.sessionId !== sessionId) return;
    updatePaneData(pane.id, { followUpBusyState: null });
  }

  function clearFollowUpIdleCompletionTimer() {
    if (followUpIdleClearTimerRef.current === null) return;
    window.clearTimeout(followUpIdleClearTimerRef.current);
    followUpIdleClearTimerRef.current = null;
  }

  function scheduleFollowUpIdleCompletion(
    sessionId: string,
    finalizeStatus?: Extract<FollowUpMessage['status'], 'completed' | 'failed' | 'cancelled'>,
  ) {
    clearFollowUpIdleCompletionTimer();
    followUpIdleClearTimerRef.current = window.setTimeout(() => {
      followUpIdleClearTimerRef.current = null;
      if (finalizeStatus) {
        const current = readFollowUpMessages(pane.id);
        const finalized = finalizeStreamingMessages(current, sessionId, finalizeStatus);
        if (finalized !== current) {
          updatePaneData(pane.id, { followUpMessages: finalized.slice(-200) });
          finalized
            .filter((message, index) => message !== current[index])
            .forEach(message => void persistFollowUpMessage(threadId, message));
        }
      }
      clearFollowUpBusyState(sessionId);
    }, 2_500);
  }

  function rememberFollowUpSession(update: Partial<FollowUpSessionRecord> & { threadId?: string } = {}) {
    const now = Date.now();
    const targetThreadId = update.threadId ?? threadId;
    const current = readFollowUpSessions(pane.id);
    const prior = current.find(session => session.threadId === targetThreadId);
    const next: FollowUpSessionRecord = {
      threadId: targetThreadId,
      runtimeSessionId: update.runtimeSessionId ?? prior?.runtimeSessionId ?? selectedSessionId ?? null,
      title: cleanAgentSessionTitle(update.title ?? prior?.title, 'Workspace chat'),
      createdAt: update.createdAt ?? prior?.createdAt ?? now,
      updatedAt: update.updatedAt ?? now,
      cli: update.cli ?? prior?.cli ?? selectedCli,
      model: update.model ?? prior?.model ?? (activeSelectedModel || null),
      lastPrompt: update.lastPrompt ?? prior?.lastPrompt,
    };
    updatePaneData(pane.id, {
      followUpSessions: mergeFollowUpSessions(current, [next]),
    });
  }

  function rememberSessionForPrompt(promptText: string, runtimeSessionId?: string | null, targetThreadId = threadId) {
    const current = readFollowUpSessions(pane.id);
    const prior = current.find(session => session.threadId === targetThreadId);
    rememberFollowUpSession({
      threadId: targetThreadId,
      runtimeSessionId: runtimeSessionId ?? prior?.runtimeSessionId ?? null,
      title: prior?.title && prior.title !== 'Workspace chat' ? prior.title : sessionTitleFromPrompt(promptText),
      lastPrompt: promptText,
    });
  }

  function rememberSessionTitleFromAgentContent(sessionId: string | null | undefined, content: string) {
    const title = extractAgentSessionTitle(content).title;
    if (!title) return;
    rememberFollowUpSession({
      runtimeSessionId: sessionId ?? selectedSessionId ?? null,
      title,
    });
  }

  async function beginFollowUpFileTracking(sessionId: string) {
    finalizedSnapshotSessionsRef.current.delete(sessionId);
    liveCodeChangeSessionRef.current = sessionId;
    setLiveCodeChanges([]);
    const snapshot = await captureFollowUpWorkspaceSnapshot(runtimeWorkspaceDir);
    if (snapshot) followUpSnapshotsRef.current.set(sessionId, snapshot);
  }

  async function refreshFollowUpLiveFileChanges(sessionId: string) {
    if (finalizedSnapshotSessionsRef.current.has(sessionId) || liveCodeChangeRefreshInFlightRef.current) return;
    const before = followUpSnapshotsRef.current.get(sessionId);
    if (!before) return;
    liveCodeChangeRefreshInFlightRef.current = true;
    try {
      const after = await captureFollowUpWorkspaceSnapshot(before.root);
      const changes = diffFollowUpWorkspaceSnapshots(before, after);
      if (liveCodeChangeSessionRef.current !== sessionId || finalizedSnapshotSessionsRef.current.has(sessionId)) return;
      setLiveCodeChanges(agentChangeSummariesFromDetectedChanges(changes, `live-code-changes-${sessionId}`));
    } finally {
      liveCodeChangeRefreshInFlightRef.current = false;
    }
  }

  function scheduleFollowUpLiveFileChangeRefresh(sessionId: string) {
    if (finalizedSnapshotSessionsRef.current.has(sessionId)) return;
    if (liveCodeChangeRefreshTimerRef.current !== null) {
      window.clearTimeout(liveCodeChangeRefreshTimerRef.current);
    }
    liveCodeChangeRefreshTimerRef.current = window.setTimeout(() => {
      liveCodeChangeRefreshTimerRef.current = null;
      void refreshFollowUpLiveFileChanges(sessionId);
    }, 450);
  }

  async function publishFollowUpFileChanges(sessionId: string, cli: string, model?: string) {
    if (finalizedSnapshotSessionsRef.current.has(sessionId)) return;
    finalizedSnapshotSessionsRef.current.add(sessionId);
    if (liveCodeChangeRefreshTimerRef.current !== null) {
      window.clearTimeout(liveCodeChangeRefreshTimerRef.current);
      liveCodeChangeRefreshTimerRef.current = null;
    }
    if (liveCodeChangeSessionRef.current === sessionId) {
      liveCodeChangeSessionRef.current = null;
      setLiveCodeChanges([]);
    }
    const before = followUpSnapshotsRef.current.get(sessionId);
    followUpSnapshotsRef.current.delete(sessionId);
    if (!before) return;
    const after = await captureFollowUpWorkspaceSnapshot(before.root);
    const changes = diffFollowUpWorkspaceSnapshots(before, after);
    if (changes.length === 0) return;
    const createdAt = Date.now();
    const summaries = agentChangeSummariesFromDetectedChanges(changes, `code-changes-${sessionId}`);
    const workItem: AgentWorkItem = {
      id: `work:code-changes:${sessionId}`,
      kind: 'fileChange',
      title: 'Code changes',
      detail: `${summaries.length} file${summaries.length === 1 ? '' : 's'} changed`,
      status: 'completed',
      changes: summaries,
      createdAt,
      completedAt: createdAt,
    };
    const message: FollowUpMessage = {
      id: `code-changes-${sessionId}-${createdAt}`,
      missionId,
      role: 'tool',
      cli,
      model,
      runtimeSessionId: sessionId,
      content: formatAgentWorkItemContent(workItem),
      filePaths: changes.map(change => change.path),
      status: 'completed',
      createdAt,
      completedAt: createdAt,
    };
    appendFollowUpMessages(pane.id, [message]);
    void persistFollowUpMessage(threadId, message);
  }

  function publishRuntimeToolActivity(
    sessionId: string,
    cli: string,
    model: string | undefined,
    event: {
      toolName: string;
      label: string;
      detail?: string;
      status?: 'running' | 'completed' | 'failed';
      id?: string;
      command?: string;
      cwd?: string;
      output?: string;
      exitCode?: number | null;
    },
  ) {
    const status = event.status ?? 'running';
    if (status === 'running') {
      clearFollowUpIdleCompletionTimer();
      setFollowUpBusyState(sessionId, event.label || 'streaming');
    }
    const id = stableAgentToolEventId(sessionId, { ...event, id: event.id ?? `${event.toolName}:${event.label}:${event.detail ?? ''}` });
    const existing = readFollowUpMessages(pane.id).find(message => message.id === id);
    const createdAt = existing?.createdAt ?? Date.now();
    const workItem = mergeAgentWorkItemUpdate(existing, buildAgentWorkItemFromToolEvent(sessionId, event, createdAt));
    const toolMessage: FollowUpMessage = {
      id,
      missionId,
      role: 'tool',
      cli,
      model,
      runtimeSessionId: sessionId,
      toolEventId: event.id,
      content: formatAgentWorkItemContent(workItem),
      status: workItemStatusToFollowUpStatus(workItem.status),
      createdAt,
      completedAt: status === 'running' ? undefined : (workItem.completedAt ?? Date.now()),
    };
    upsertFollowUpMessage(pane.id, toolMessage);
    runtimeOutputLastEntryKindRef.current.set(sessionId, 'work');
    if (workItem.kind === 'fileChange') scheduleFollowUpLiveFileChangeRefresh(sessionId);
    if (status !== 'running') {
      scheduleFollowUpIdleCompletion(sessionId, status === 'failed' ? 'failed' : 'completed');
      void persistFollowUpMessage(threadId, toolMessage);
    }
  }

  function finalizeFollowUpToolWork(
    sessionId: string,
    status: Extract<FollowUpMessage['status'], 'completed' | 'failed' | 'cancelled'> = 'completed',
  ) {
    const current = readFollowUpMessages(pane.id);
    const finalized = finalizeStreamingToolMessages(current, sessionId, status);
    if (finalized === current) return;
    updatePaneData(pane.id, { followUpMessages: finalized.slice(-200) });
    finalized
      .filter((message, index) => message !== current[index])
      .forEach(message => void persistFollowUpMessage(threadId, message));
  }

  function publishRuntimeAgentTranscript(sessionId: string, cli: string, model: string | undefined, content: string, final = false) {
    const display = sanitizeAgentTranscriptForStorage(content).trim();
    if (!display) return;
    if (final) finalizeFollowUpToolWork(sessionId, 'completed');
    const current = readFollowUpMessages(pane.id);
    const lastEntryKind = runtimeOutputLastEntryKindRef.current.get(sessionId);
    const lastAgent = lastEntryKind === 'agent'
      ? [...current].reverse().find(message => message.runtimeSessionId === sessionId && message.role === 'agent' && message.status === 'streaming')
      : null;
    const rawAgentContent = lastAgent
      ? `${lastAgent.content}${lastAgent.content.trim() ? '\n' : ''}${display}`
      : display;
    rememberSessionTitleFromAgentContent(sessionId, rawAgentContent);
    const nextAgentContent = sanitizeAgentTranscriptForStorage(rawAgentContent);
    if (!nextAgentContent.trim()) return;
    const nextMessages = lastAgent
      ? current.map(message => message.id === lastAgent.id ? { ...message, content: nextAgentContent } : message)
      : [...current, {
          id: generateId(),
          missionId,
          role: 'agent' as const,
          cli,
          model,
          runtimeSessionId: sessionId,
          content: display,
          status: 'streaming' as const,
          createdAt: Date.now(),
        }];
    updatePaneData(pane.id, { followUpMessages: nextMessages.slice(-200) });
    runtimeOutputLastEntryKindRef.current.set(sessionId, 'agent');
    scheduleFollowUpIdleCompletion(sessionId);
    const persisted = nextMessages.find(message => message.runtimeSessionId === sessionId && message.role === 'agent' && message.status === 'streaming' && message.content === (lastAgent ? nextAgentContent : display));
    if (persisted) void persistFollowUpMessage(threadId, persisted);
  }

  useEffect(() => () => {
    if (liveCodeChangeRefreshTimerRef.current !== null) {
      window.clearTimeout(liveCodeChangeRefreshTimerRef.current);
    }
  }, []);

  useEffect(() => runtimeManager.subscribeSnapshot(setRuntimeSnapshot), []);

  useEffect(() => {
    setCliContextPercent(null);
    setCliContextTokenUsage(null);
    setCliUsageLimitRows([]);
    setCliUsageLimitRaw('');
    setSdkUsage(null);
    setSdkFinishMeta(null);
    cliContextOutputTailRef.current = '';
    agentOutputShouldStickRef.current = true;
  }, [activeSelectedModel, selectedCli, selectedSessionId]);

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
        updatePaneData(pane.id, {
          followUpThreadId: threadId,
          followUpMessages: mergePersistedFollowUpMessages(readFollowUpMessages(pane.id), loaded),
        });
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [missionId, pane.id, threadId, updatePaneData]);

  useEffect(() => {
    let cancelled = false;
    setSkills([]);
    setNativeCommands([]);
    setCapabilityWarnings([]);
    if (selectedCli === 'codex' && selectedPermissionMode === 'full') {
      setModels(OPENAI_SDK_MODELS);
    }
    if (!supportsModelDiscovery(selectedCli)) {
      setModels([]);
      return;
    }
    setLoadingModels(true);
    discoverModelsForCli(selectedCli, { workspaceDir: runtimeWorkspaceDir })
      .then(result => {
        if (!cancelled) setModels(selectedCli === 'codex' ? mergeCodexModels(result.models) : result.models);
      })
      .finally(() => {
        if (!cancelled) setLoadingModels(false);
      });
    invoke<CliCapabilityDiscovery>('discover_cli_capabilities', {
      cli: selectedCli,
      projectPath: runtimeWorkspaceDir,
      refresh: false,
    })
      .then(result => {
        if (cancelled) return;
        setSkills(result.skills ?? []);
        setNativeCommands(result.commands ?? []);
        setCapabilityWarnings(result.warnings ?? []);
      })
      .catch(error => {
        if (!cancelled) setCapabilityWarnings([error instanceof Error ? error.message : String(error)]);
      });
    return () => {
      cancelled = true;
    };
  }, [runtimeWorkspaceDir, selectedCli]);

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
      if (event.type === 'session_created' && event.missionId === `adhoc-followup-${missionId}`) {
        const currentMessages = readFollowUpMessages(pane.id);
        const lastSendingUserId = [...currentMessages].reverse()
          .find(message => message.role === 'user' && message.status === 'sending' && !message.runtimeSessionId)
          ?.id;
        runtimeOutputDisplaySessionsRef.current.delete(event.sessionId);
        runtimeOutputPendingLinesRef.current.delete(event.sessionId);
        updatePaneData(pane.id, {
          followUpRuntimeSessionId: event.sessionId,
          followUpBusyState: {
            sessionId: event.sessionId,
            state: 'Starting',
            active: true,
            updatedAt: Date.now(),
          },
          followUpMessages: lastSendingUserId
            ? currentMessages.map(message => message.id === lastSendingUserId
                ? { ...message, runtimeSessionId: event.sessionId }
                : message
              )
            : currentMessages,
        });
        rememberFollowUpSession({ runtimeSessionId: event.sessionId });
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
        if (event.type === 'session_state_changed') {
          if (isFollowUpBusyIndicatorState(event.to)) {
            setFollowUpBusyState(event.sessionId, event.to);
          } else {
            scheduleFollowUpIdleCompletion(event.sessionId, 'completed');
          }
        } else if (event.type === 'task_injected') {
          clearFollowUpIdleCompletionTimer();
          runtimeOutputDisplaySessionsRef.current.add(event.sessionId);
          runtimeOutputPendingLinesRef.current.delete(event.sessionId);
          runtimeOutputCodexStateRef.current.set(event.sessionId, createCodexRuntimeOutputState());
          runtimeOutputLastEntryKindRef.current.delete(event.sessionId);
        } else if (event.type === 'task_acked') {
          setFollowUpBusyState(event.sessionId, 'streaming');
        } else if (event.type === 'permission_requested') {
          clearFollowUpIdleCompletionTimer();
          setFollowUpBusyState(event.sessionId, 'awaiting_permission');
        } else if (event.type === 'permission_resolved') {
          clearFollowUpIdleCompletionTimer();
          setFollowUpBusyState(event.sessionId, 'streaming');
        } else if (event.type === 'session_completed' || event.type === 'session_failed' || event.type === 'session_disconnected') {
          clearFollowUpIdleCompletionTimer();
          const flushed = flushRuntimeOutputChunkForFollowUp(
            selectedCli,
            runtimeOutputPendingLinesRef.current.get(event.sessionId) ?? '',
            runtimeOutputCodexStateRef.current.get(event.sessionId),
          );
          runtimeOutputDisplaySessionsRef.current.delete(event.sessionId);
          runtimeOutputPendingLinesRef.current.delete(event.sessionId);
          runtimeOutputCodexStateRef.current.delete(event.sessionId);
          const flushedEvents = flushed.events.length > 0
            ? flushed.events
            : [
                ...flushed.workEvents.map(workEvent => ({ kind: 'work' as const, workEvent })),
                ...(flushed.content ? [{ kind: 'agent' as const, text: flushed.content }] : []),
              ];
          for (const streamEvent of flushedEvents) {
            if (streamEvent.kind === 'work') {
              publishRuntimeToolActivity(event.sessionId, selectedCli, activeSelectedModel || undefined, streamEvent.workEvent);
            } else if (streamEvent.kind === 'session_title') {
              rememberFollowUpSession({
                runtimeSessionId: event.sessionId,
                title: streamEvent.title,
              });
            } else {
              publishRuntimeAgentTranscript(event.sessionId, selectedCli, activeSelectedModel || undefined, streamEvent.text, streamEvent.kind === 'final_agent');
            }
          }
          clearFollowUpIdleCompletionTimer();
          runtimeOutputLastEntryKindRef.current.delete(event.sessionId);
          clearFollowUpBusyState(event.sessionId);
          void publishFollowUpFileChanges(event.sessionId, selectedCli, activeSelectedModel || undefined);
        }
        const content = summarizeRuntimeEventForFollowUp(event);
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
        if (!content) {
          if (finalized !== current) {
            updatePaneData(pane.id, { followUpMessages: finalized.slice(-200) });
            finalized
              .filter((message, index) => message !== current[index])
              .forEach(message => void persistFollowUpMessage(threadId, message));
          }
          return;
        }
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
      const runtimeTool = selectedCli === 'codex' ? null : parseRuntimeToolActivity(event.text);
      if (selectedCli === 'codex') {
        const contextOutput = `${cliContextOutputTailRef.current}${event.text}`;
        cliContextOutputTailRef.current = contextOutput.slice(-1000);
        const nextContextUsage = parseCodexContextUsage(contextOutput);
        if (nextContextUsage) {
          setCliContextPercent(nextContextUsage.usedPercent);
          setCliContextTokenUsage(
            nextContextUsage.usedTokens !== undefined && nextContextUsage.totalTokens !== undefined
              ? { usedTokens: nextContextUsage.usedTokens, totalTokens: nextContextUsage.totalTokens }
              : null,
          );
        }
        const nextUsageRows = parseAgentUsageLimits(contextOutput);
        if (nextUsageRows.length > 0) {
          setCliUsageLimitRows(nextUsageRows);
          setCliUsageLimitRaw(contextOutput);
        }
      }
      if (runtimeTool) {
        publishRuntimeToolActivity(event.sessionId, selectedCli, activeSelectedModel || undefined, {
          ...runtimeTool,
          status: 'running',
        });
      }
      if (!runtimeOutputDisplaySessionsRef.current.has(event.sessionId)) return;
      const sanitized = sanitizeRuntimeOutputChunkForFollowUp(
        selectedCli,
        event.text,
        runtimeOutputPendingLinesRef.current.get(event.sessionId) ?? '',
        runtimeOutputCodexStateRef.current.get(event.sessionId),
      );
      runtimeOutputPendingLinesRef.current.set(event.sessionId, sanitized.pendingLine);
      const streamEvents = sanitized.events.length > 0
        ? sanitized.events
        : [
            ...sanitized.workEvents.map(workEvent => ({ kind: 'work' as const, workEvent })),
            ...(sanitized.content ? [{ kind: 'agent' as const, text: sanitized.content }] : []),
          ];
      for (const streamEvent of streamEvents) {
        if (streamEvent.kind === 'work') {
          publishRuntimeToolActivity(event.sessionId, selectedCli, activeSelectedModel || undefined, streamEvent.workEvent);
        } else if (streamEvent.kind === 'session_title') {
          rememberFollowUpSession({
            runtimeSessionId: event.sessionId,
            title: streamEvent.title,
          });
        } else {
          publishRuntimeAgentTranscript(event.sessionId, selectedCli, activeSelectedModel || undefined, streamEvent.text, streamEvent.kind === 'final_agent');
        }
      }
      if (streamEvents.length > 0) {
        const latestSessionState = runtimeManager.snapshot().sessions.find(session => session.sessionId === event.sessionId)?.state;
        if (!isFollowUpBusyIndicatorState(latestSessionState)) {
          scheduleFollowUpIdleCompletion(event.sessionId, 'completed');
        }
      }
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
    const priorMessages = readFollowUpMessages(pane.id)
      .filter(message => message.id !== userMessage.id)
      .map(message => ({
        ...message,
        content: message.role === 'agent'
          ? agentDisplayContentWithoutMetadata(message.content)
          : stripAgentTokenUsage(message.content),
      }));
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
      `Workspace: ${runtimeWorkspaceDir ?? 'not set'}`,
      agentContextKind && agentContextPath
        ? `Selected ${agentContextKind}: ${agentContextPath}`
        : '',
      selectedGoal ? `Current agent goal: ${selectedGoal}` : '',
      selectedReasoning ? `Requested reasoning effort: ${formatReasoningEffortLabel(selectedReasoning)}` : '',
      permissionModeInstruction(selectedPermissionMode, selectedCli, usesSdkTransport),
      `Session title protocol: before any other response text, output one line exactly like "${AGENT_SESSION_TITLE_PREFIX} <short title>" based on the user's latest prompt. Keep it under 6 words. Then continue normally on the next line. Do this first for every new agent run so Comet can name the session.`,
      `${usesMissionRuntimeContext ? 'Mission' : 'Workspace'} summary: ${usesMissionRuntimeContext ? (taskDescription || mission?.task.prompt || 'Mission follow-up') : (runtimeWorkspaceDir ? `Workspace agent for ${runtimeWorkspaceDir}` : 'Workspace follow-up')}`,
      selectedSkill ? `Requested skill/profile: ${selectedSkill.name} (${selectedSkill.id}).` : '',
      usesMissionRuntimeContext ? graphNodeContext : '',
      usesMissionRuntimeContext && report ? `Current phase summary:\n${report}` : '',
      usesMissionRuntimeContext && artifactContext ? `Recent artifacts and changed files:\n${artifactContext}` : '',
      attachmentContext,
      conversationContext ? `Previous follow-up context for continuity only. Do not quote, restate, or summarize this context unless the user asks for it:\n${conversationContext}` : '',
    ].filter(Boolean).join('\n\n');
    const followUpPrompt = [
      followUpContext,
      `User follow-up:\n${trimmed}`,
    ].filter(Boolean).join('\n\n');

    if (selectedCli === 'codex' && configuredOpenAiApiKey) {
      const apiKey = configuredOpenAiApiKey;
      const sessionId = `sdk:${threadId}`;
      const agentMessageId = generateId();
      const startedAt = Date.now();
      await beginFollowUpFileTracking(sessionId);
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
        const id = stableAgentToolEventId(sessionId, event);
        const existing = readFollowUpMessages(pane.id).find(message => message.id === id);
        const createdAt = existing?.createdAt ?? Date.now();
        const workItem = mergeAgentWorkItemUpdate(existing, buildAgentWorkItemFromToolEvent(sessionId, event, createdAt));
        const toolMessage: FollowUpMessage = {
          id,
          missionId,
          role: 'tool',
          cli: 'sdk',
          model: normalizeOpenAiSdkModel(activeSelectedModel),
          runtimeSessionId: sessionId,
          toolEventId: event.id,
          content: formatAgentWorkItemContent(workItem),
          status: workItemStatusToFollowUpStatus(workItem.status),
          createdAt,
          completedAt: event.status === 'running' ? undefined : (workItem.completedAt ?? Date.now()),
        };
        upsertFollowUpMessage(pane.id, toolMessage);
        if (workItem.kind === 'fileChange') scheduleFollowUpLiveFileChangeRefresh(sessionId);
        if (event.status !== 'running') void persistFollowUpMessage(threadId, toolMessage);
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
        followUpBusyState: {
          sessionId,
          state: 'Starting',
          active: true,
          updatedAt: startedAt,
        },
        followUpMessages: [
          ...readFollowUpMessages(pane.id).map(message =>
            message.id === userMessage.id ? { ...message, runtimeSessionId: sessionId, status: 'completed' as const, completedAt: startedAt } : message
          ),
          agentMessage,
        ].slice(-200),
      });
      rememberSessionForPrompt(trimmed, sessionId);
      if (!options.internal) {
        void persistFollowUpMessage(threadId, { ...userMessage, runtimeSessionId: sessionId, status: 'completed', completedAt: startedAt });
      }

      let streamedContent = '';
      const finishMetaRef: { current: SdkChatFinishMeta | null } = { current: null };
      const usageRef: { current: AgentTokenUsage | null } = { current: null };
      const controller = new AbortController();
      sdkAbortRef.current = controller;
      setSdkUsage(null);
      setSdkFinishMeta(null);
      try {
        const finalText = await runSdkChat({
          apiKey,
          model: activeSelectedModel,
          baseURL: configuredOpenAiBaseUrl,
          workspaceDir: runtimeWorkspaceDir,
          activeFile: agentContextFile,
          activeTerminalId,
          activeTerminalCwd: agentContextDirectory || activeTerminalCwd,
          terminals: sdkTerminalContexts,
          systemContext: followUpContext,
          messages: sdkMessages,
          toolMode: selectedPermissionMode === 'restricted' ? 'none' : 'full',
          abortSignal: controller.signal,
          onStep: step => setFollowUpBusyState(sessionId, step),
          onArtifact: publishSdkArtifact,
          onToolEvent: publishSdkToolEvent,
          onTodos: publishSdkTodos,
          onCommand: publishSdkCommand,
          onUsage: delta => {
            usageRef.current = mergeAgentTokenUsage(usageRef.current, {
              inputTokens: delta.inputTokens,
              outputTokens: delta.outputTokens,
              cachedInputTokens: delta.cachedInputTokens,
              contextInputTokens: delta.lastInputTokens || delta.inputTokens,
            });
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
            finalizeFollowUpToolWork(sessionId, 'completed');
            streamedContent += delta;
            rememberSessionTitleFromAgentContent(sessionId, streamedContent);
            upsertFollowUpMessage(pane.id, { ...agentMessage, content: sanitizeAgentTranscriptForStorage(streamedContent) });
          },
        });
        finalizeFollowUpToolWork(sessionId, 'completed');
        const completedText = sanitizeAgentTranscriptForStorage(finalText || streamedContent || '(No response text returned.)');
        const completed: FollowUpMessage = {
          ...agentMessage,
          content: appendAgentTokenUsage(completedText, usageRef.current),
          status: 'completed',
          completedAt: Date.now(),
        };
        rememberSessionTitleFromAgentContent(sessionId, completed.content);
        if (shouldSuppressEmptySdkAssistantMessage({ finalText, streamedContent, emittedApprovalCard })) {
          updatePaneData(pane.id, {
            followUpMessages: readFollowUpMessages(pane.id).filter(message => message.id !== agentMessageId),
          });
        } else {
          upsertFollowUpMessage(pane.id, completed);
          void persistFollowUpMessage(threadId, completed);
        }
        await publishFollowUpFileChanges(sessionId, 'sdk', normalizeOpenAiSdkModel(activeSelectedModel));
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
        finalizeFollowUpToolWork(sessionId, aborted ? 'cancelled' : 'failed');
        const failedText = sanitizeAgentTranscriptForStorage(streamedContent || (aborted ? 'SDK chat stopped.' : `SDK chat failed: ${error instanceof Error ? error.message : String(error)}`));
        const failed: FollowUpMessage = {
          ...agentMessage,
          content: appendAgentTokenUsage(failedText, usageRef.current),
          status: aborted ? 'cancelled' : 'failed',
          completedAt: Date.now(),
        };
        upsertFollowUpMessage(pane.id, failed);
        void persistFollowUpMessage(threadId, failed);
        await publishFollowUpFileChanges(sessionId, 'sdk', normalizeOpenAiSdkModel(activeSelectedModel));
        if (aborted) return;
        throw error;
      } finally {
        if (sdkAbortRef.current === controller) sdkAbortRef.current = null;
        clearFollowUpBusyState(sessionId);
      }
    }

    let sessionId = preferredSessionId;
    const expected = {
      cliId: selectedCli,
      model: activeSelectedModel || null,
      reasoningEffort: selectedReasoning || null,
      yolo: selectedPermissionMode === 'full',
      permissionMode: selectedPermissionMode,
      executionMode: 'interactive_pty' as const,
      workspaceDir: runtimeWorkspaceDir,
    };

    if (sessionId) {
      let validation = await runtimeManager.validateSessionForReuse(sessionId, expected);
      if (validation.status === 'yolo_mismatch') {
        const modeChange = await runtimeManager.setSessionPermissionMode({
          sessionId,
          permissionMode: selectedPermissionMode,
        }).catch(error => ({
          status: 'unsupported' as const,
          details: error instanceof Error ? error.message : String(error),
        }));
        if (modeChange.status !== 'unsupported') {
          validation = await runtimeManager.validateSessionForReuse(sessionId, expected);
        }
      }
      if (validation.status !== 'reusable') {
        await runtimeManager.stopRuntime({
          sessionId,
          reason: `Session not reusable: ${validation.details}`,
        }).catch(() => {});
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
        workspaceDir: runtimeWorkspaceDir,
        goal: taskDescription,
        modelId: activeSelectedModel || null,
        model: activeSelectedModel || null,
        reasoningEffort: selectedReasoning || null,
        yolo: selectedPermissionMode === 'full',
        permissionMode: selectedPermissionMode,
        inputPayload: { followUp: true, missionId, skillId: selectedSkill?.id ?? null, agentRoleId: selectedAgent?.id ?? null },
      });
      sessionId = session.sessionId;
    }

    updatePaneData(pane.id, {
      followUpRuntimeSessionId: sessionId,
          followUpBusyState: {
            sessionId,
            state: 'Sending',
            active: true,
            updatedAt: Date.now(),
          },
      followUpMessages: readFollowUpMessages(pane.id).map(message =>
        message.id === userMessage.id ? { ...message, runtimeSessionId: sessionId, status: 'completed', completedAt: Date.now() } : message
      ),
    });
    rememberSessionForPrompt(trimmed, sessionId);
    await beginFollowUpFileTracking(sessionId);
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
      clearFollowUpBusyState(sessionId);
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
    let rawPrompt = overridePrompt ?? prompt;
    if (!options.skipSlashProcessing) {
      const slash = parseAgentSlashCommand(rawPrompt);
      if (slash?.kind === 'literal') {
        rawPrompt = slash.text;
      } else if (slash?.kind === 'command') {
        const handled = await handleSlashCommandSubmission(slash, options);
        if (handled) return;
      }
    }

    const trimmed = rawPrompt.trim();
    if (!trimmed) return;
    const createdAt = Date.now();
    const currentMessages = readFollowUpMessages(pane.id);
    const visiblySettled = isFollowUpSessionVisiblySettled(currentMessages, selectedSessionId);
    const busyStateBlocksSending = Boolean(
      busyStateMatchesSession
      && isFollowUpBusyIndicatorState(followUpBusyState?.state)
      && !visiblySettled
    );
    const visibleOutputActive = hasActiveFollowUpOutput(currentMessages, selectedSessionId);
    const busy = !visiblySettled && (submitting || busyStateBlocksSending || visibleOutputActive);
    const queued = !options.internal && (submitting || busy) && (sessionPolicy !== 'new' || submitting);
    const messageAttachments = options.internal ? [] : attachments;
    const displayContent = options.displayContent?.trim() || trimmed;
    const userMessage: FollowUpMessage = {
      id: generateId(),
      missionId,
      role: 'user',
      cli: selectedCli,
      model: activeSelectedModel || undefined,
      content: displayContent,
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
      if (!queued) void persistFollowUpMessage(threadId, userMessage);
      if (!queued) rememberSessionForPrompt(trimmed, selectedSessionId ?? null);
      setPrompt('');
    }
    if (queued) return;

    setSubmitting(true);
    try {
      await dispatchFollowUp(trimmed, messageAttachments, userMessage, sessionPolicy === 'new' ? undefined : selectedSessionId, options);
    } catch (error) {
      clearFollowUpBusyState();
      if (!options.internal) {
        updatePaneData(pane.id, {
          followUpBusyState: null,
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
    const currentMessages = readFollowUpMessages(pane.id);
    const visiblySettled = isFollowUpSessionVisiblySettled(currentMessages, selectedSessionId);
    const busyStateBlocksSending = Boolean(
      busyStateMatchesSession
      && isFollowUpBusyIndicatorState(followUpBusyState?.state)
      && !visiblySettled
    );
    if (!visiblySettled && (busyStateBlocksSending || hasActiveFollowUpOutput(currentMessages, selectedSessionId))) return;
    const next = pendingQueue[0];
    const userMessage = readFollowUpMessages(pane.id).find(message => message.id === next.messageId);
    if (!userMessage) {
      updatePaneData(pane.id, { followUpQueue: pendingQueue.slice(1) });
      return;
    }
    setSubmitting(true);
    dispatchFollowUp(next.prompt, next.attachments, userMessage, selectedSessionId)
      .catch(error => {
        clearFollowUpBusyState();
        const failed = {
          ...userMessage,
          status: 'failed' as const,
          completedAt: Date.now(),
          content: `${userMessage.content}\n\nFailed to send queued follow-up: ${error instanceof Error ? error.message : String(error)}`,
        };
        updatePaneData(pane.id, {
          followUpBusyState: null,
          followUpMessages: readFollowUpMessages(pane.id).map(message => message.id === failed.id ? failed : message),
        });
        void persistFollowUpMessage(threadId, failed);
      })
      .finally(() => {
        updatePaneData(pane.id, { followUpQueue: readFollowUpQueue(pane.id).filter(item => item.id !== next.id) });
        setSubmitting(false);
      });
  }, [pendingQueue, runtimeSnapshot, selectedSessionId, submitting]);

  function removeQueuedFollowUp(item: FollowUpPendingItem, options: { restoreToPrompt?: boolean } = {}) {
    const currentQueue = readFollowUpQueue(pane.id);
    const currentMessages = readFollowUpMessages(pane.id);
    updatePaneData(pane.id, {
      followUpQueue: currentQueue.filter(candidate => candidate.id !== item.id),
      followUpMessages: currentMessages.filter(message => message.id !== item.messageId),
      ...(options.restoreToPrompt ? { followUpAttachments: item.attachments } : {}),
    });
    if (options.restoreToPrompt) {
      setPrompt(item.prompt);
      window.setTimeout(() => {
        const target = promptInputRef.current;
        if (!target) return;
        target.focus();
        const caret = item.prompt.length;
        target.setSelectionRange(caret, caret);
      }, 0);
    }
  }

  function discardQueuedFollowUp(item: FollowUpPendingItem) {
    removeQueuedFollowUp(item);
  }

  function editQueuedFollowUp(item: FollowUpPendingItem) {
    removeQueuedFollowUp(item, { restoreToPrompt: true });
  }

  async function steerQueuedFollowUp(item: FollowUpPendingItem) {
    const userMessage = readFollowUpMessages(pane.id).find(message => message.id === item.messageId);
    if (!userMessage) {
      updatePaneData(pane.id, { followUpQueue: readFollowUpQueue(pane.id).filter(candidate => candidate.id !== item.id) });
      return;
    }

    updatePaneData(pane.id, {
      followUpQueue: readFollowUpQueue(pane.id).filter(candidate => candidate.id !== item.id),
      followUpMessages: readFollowUpMessages(pane.id).map(message =>
        message.id === userMessage.id
          ? { ...message, status: 'sending' as const, runtimeSessionId: selectedSessionId ?? message.runtimeSessionId }
          : message
      ),
    });

    if (selectedSessionId && !selectedSessionId.startsWith('sdk:') && !selectedSessionId.startsWith('codex-cli:')) {
      try {
        await runtimeManager.sendInput({ sessionId: selectedSessionId, input: `${item.prompt}\r` });
        const completed: FollowUpMessage = {
          ...userMessage,
          status: 'completed',
          runtimeSessionId: selectedSessionId,
          completedAt: Date.now(),
        };
        updatePaneData(pane.id, {
          followUpMessages: readFollowUpMessages(pane.id).map(message => message.id === completed.id ? completed : message),
        });
        void persistFollowUpMessage(threadId, completed);
        return;
      } catch {
        // Fall back to managed dispatch below. Some runtimes reject raw steering while busy.
      }
    }

    const wasSubmitting = submitting;
    setSubmitting(true);
    dispatchFollowUp(item.prompt, item.attachments, userMessage, selectedSessionId)
      .catch(error => {
        const failed: FollowUpMessage = {
          ...userMessage,
          status: 'failed',
          completedAt: Date.now(),
          content: `${userMessage.content}\n\nFailed to steer: ${error instanceof Error ? error.message : String(error)}`,
        };
        updatePaneData(pane.id, {
          followUpMessages: readFollowUpMessages(pane.id).map(message => message.id === failed.id ? failed : message),
        });
        void persistFollowUpMessage(threadId, failed);
      })
      .finally(() => {
        if (!wasSubmitting) setSubmitting(false);
      });
  }

  function moveQueuedFollowUp(sourceId: string, targetId: string) {
    if (sourceId === targetId) return;
    const currentQueue = readFollowUpQueue(pane.id);
    const sourceIndex = currentQueue.findIndex(item => item.id === sourceId);
    const targetIndex = currentQueue.findIndex(item => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const nextQueue = [...currentQueue];
    const [source] = nextQueue.splice(sourceIndex, 1);
    nextQueue.splice(targetIndex, 0, source);
    updatePaneData(pane.id, { followUpQueue: nextQueue });
  }

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
      if (selectedSessionId) setFollowUpBusyState(selectedSessionId, 'Stopping');
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
      followUpBusyState: null,
    });
    setSdkStep(null);
    setPrompt('');
  }

  function compactFollowUpContext() {
    const activeSession = runtimeSnapshot.sessions.find(session => session.sessionId === selectedSessionId);
    if (submitting) return;
    if (isFollowUpSessionBusy(activeSession?.state) || messages.length === 0) return;
    const compactedThreadId = `thread:${missionId}:${generateId()}`;
    const compactResult = compactAgentConversation(
      messages.map(message => ({ ...message, content: stripAgentTokenUsage(message.content) })),
      { keepTail: 8, maxSummaryChars: 4000 },
    );
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
    if (selectedCli === 'codex' && sdkAbortRef.current) {
      sdkAbortRef.current.abort();
    }
    updatePaneData(pane.id, {
      followUpPermissionMode: mode,
      followUpBusyState: selectedSessionId && !selectedSessionId.startsWith('sdk:')
        ? {
            sessionId: selectedSessionId,
            state: 'Changing permissions',
            active: true,
            updatedAt: Date.now(),
          }
        : null,
    });
    if (!selectedSessionId || selectedSessionId.startsWith('sdk:')) return;
    void runtimeManager.setSessionPermissionMode({
      sessionId: selectedSessionId,
      permissionMode: mode,
    }).then(result => {
      if (result.status === 'unsupported') {
        return runtimeManager.stopRuntime({
          sessionId: selectedSessionId,
          reason: result.details,
        }).catch(() => {}).then(() => {
          updatePaneData(pane.id, {
            followUpRuntimeSessionId: null,
            followUpBusyState: null,
          });
        });
      }
      updatePaneData(pane.id, { followUpBusyState: null });
      return undefined;
    }).catch(error => {
      void runtimeManager.stopRuntime({
        sessionId: selectedSessionId,
        reason: `Permission mode change failed: ${error instanceof Error ? error.message : String(error)}`,
      }).catch(() => {});
      updatePaneData(pane.id, {
        followUpRuntimeSessionId: null,
        followUpBusyState: null,
      });
    });
  }

  function changeAgentContext(path: string | null, kind: FollowUpContextKind | null) {
    if (selectedCli === 'codex' && sdkAbortRef.current) {
      sdkAbortRef.current.abort();
    }
    if (selectedSessionId && !selectedSessionId.startsWith('sdk:')) {
      void runtimeManager.stopRuntime({
        sessionId: selectedSessionId,
        reason: 'Agent context changed',
      }).catch(() => {});
    }
    updatePaneData(pane.id, {
      followUpContextPath: path,
      followUpContextKind: kind,
      followUpRuntimeSessionId: null,
      followUpBusyState: null,
    });
  }

  function openSlashContextPicker() {
    setPrompt('');
    setActiveMenu(null);
    setSlashPickerCommand(null);
    setSlashPickerStandalone(false);
    setSlashCommandIndex(0);
    setUsagePopoverPayload(null);
    setUsagePopoverStatus(null);
    setContextSlashPickerOpen(true);
  }

  function focusPromptAtEnd() {
    window.setTimeout(() => {
      const target = promptInputRef.current;
      if (!target) return;
      target.focus();
      target.setSelectionRange(target.value.length, target.value.length);
    }, 0);
  }

  function focusPromptAtPosition(position: number) {
    window.setTimeout(() => {
      const target = promptInputRef.current;
      if (!target) return;
      const caret = Math.max(0, Math.min(position, target.value.length));
      target.focus();
      target.setSelectionRange(caret, caret);
    }, 0);
  }

  function replaceActiveSlashCommand(value: string) {
    const parsed = parsedSlashPrompt?.kind === 'command' ? parsedSlashPrompt : null;
    if (!parsed) {
      setPrompt(value);
      focusPromptAtPosition(value.length);
      return;
    }
    const nextPrompt = `${prompt.slice(0, parsed.start)}${value}${prompt.slice(parsed.end)}`;
    setPrompt(nextPrompt);
    focusPromptAtPosition(parsed.start + value.length);
  }

  function promptWithActiveSlashCommand(value: string): string {
    const parsed = parsedSlashPrompt?.kind === 'command' ? parsedSlashPrompt : null;
    if (!parsed) return value;
    return `${prompt.slice(0, parsed.start)}${value}${prompt.slice(parsed.end)}`;
  }

  function openReasoningPickerAfterModelSelection(options: { clearActiveSlash?: boolean } = {}) {
    if (options.clearActiveSlash && parsedSlashPrompt?.kind === 'command') {
      const nextPrompt = `${prompt.slice(0, parsedSlashPrompt.start)}${prompt.slice(parsedSlashPrompt.end)}`;
      setPrompt(nextPrompt);
    }
    setActiveMenu(null);
    setSlashPickerCommand('reasoning');
    setSlashPickerStandalone(true);
    setSlashCommandIndex(0);
    focusPromptAtEnd();
  }

  function changeFollowUpModel(value: string, options: { promptForReasoning?: boolean; clearActiveSlash?: boolean } = {}) {
    updatePaneData(pane.id, { followUpModel: value, followUpRuntimeSessionId: null });
    if (options.promptForReasoning && value) openReasoningPickerAfterModelSelection({ clearActiveSlash: options.clearActiveSlash });
  }

  function changeFollowUpAgentRole(roleId: string) {
    updatePaneData(pane.id, { followUpAgentRoleId: roleId });
    if (placement !== 'tab' || pane.data?.dockExpandedToTab !== true) return;
    const role = getPublicAgentRole(roleId) ?? getPublicRoleForWorkflowRole(roleId);
    if (pane.title !== role.name) {
      renamePane(pane.id, role.name);
    }
  }

  function appendSystemFollowUpMessage(content: string) {
    const now = Date.now();
    const message: FollowUpMessage = {
      id: generateId(),
      missionId,
      role: 'system',
      cli: selectedCli,
      model: activeSelectedModel || undefined,
      runtimeSessionId: selectedSessionId,
      content,
      status: 'completed',
      createdAt: now,
      completedAt: now,
    };
    appendFollowUpMessages(pane.id, [message]);
    void persistFollowUpMessage(threadId, message);
  }

  function buildSlashHelpMessage(): string {
    const nativeSummary = nativeCommands.length > 0
      ? [
          `${formatFollowUpCliLabel(selectedCli)} native/custom commands detected:`,
          ...nativeCommands.slice(0, 16).map(command =>
            `/${command.name} - ${command.description || command.source || 'Native CLI command'}`
          ),
          nativeCommands.length > 16 ? `...and ${nativeCommands.length - 16} more.` : '',
        ].filter(Boolean).join('\n')
      : '';
    return [slashCommandHelpText(), nativeSummary].filter(Boolean).join('\n\n');
  }

  async function showUsageLimitsPopover(nativeCommand: string): Promise<void> {
    const capturedAt = Date.now();
    setUsagePopoverPayload(null);
    setUsagePopoverStatus(`Loading ${formatFollowUpCliLabel(selectedCli)} usage limits...`);

    if (selectedCli === 'codex') {
      try {
        const snapshot = await invoke<CodexUsageLimitsResponse>('read_codex_usage_limits');
        if (snapshot.rows.length > 0) {
          setCliUsageLimitRows(snapshot.rows);
          setCliUsageLimitRaw(JSON.stringify(snapshot.raw));
          setUsagePopoverPayload({
            kind: 'agent-usage-limits',
            cli: selectedCli,
            command: 'account/rateLimits/read',
            capturedAt,
            rows: snapshot.rows,
            raw: '',
          });
          setUsagePopoverStatus(null);
          return;
        }
        setUsagePopoverStatus(`No ${formatFollowUpCliLabel(selectedCli)} usage limits are available yet.`);
      } catch (error) {
        setUsagePopoverStatus(
          `Failed to read ${formatFollowUpCliLabel(selectedCli)} usage limits: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
      return;
    }

    const terminalUsageOutput = activeRuntimeTerminalId
      ? extractTerminalUsageCommandOutput(terminalOutputBus.getTail(activeRuntimeTerminalId, 16_000), nativeCommand)
      : '';
    const usageOutput = [terminalUsageOutput, cliUsageLimitRaw].filter(Boolean).join('\n');
    const parsedUsageRows = usageOutput ? parseAgentUsageLimits(usageOutput) : [];
    const usageRows = parsedUsageRows.length > 0 ? parsedUsageRows : cliUsageLimitRows;
    if (usageRows.length > 0) {
      setUsagePopoverPayload({
        kind: 'agent-usage-limits',
        cli: selectedCli,
        command: nativeCommand,
        capturedAt,
        rows: usageRows,
        raw: '',
      });
      setUsagePopoverStatus(null);
    } else {
      setUsagePopoverStatus(`No ${formatFollowUpCliLabel(selectedCli)} usage limits are visible in the current CLI status output yet.`);
    }
  }

  async function handleSlashCommandSubmission(
    parsed: NonNullable<ReturnType<typeof parseAgentSlashCommand>>,
    options: FollowUpSubmitOptions,
  ): Promise<boolean> {
    if (parsed.kind === 'literal') return false;
    const definition = resolveAgentSlashCommand(parsed.command);
    if (!definition) {
      appendSystemFollowUpMessage(`Unknown command: /${parsed.command || ''}\n\n${buildSlashHelpMessage()}`);
      setPrompt('');
      return true;
    }

    const args = parsed.args.trim();
    switch (definition.id) {
      case 'help':
        appendSystemFollowUpMessage(buildSlashHelpMessage());
        setPrompt('');
        return true;
      case 'usage': {
        setPrompt('');
        const nativeCommand = resolveUsageCommandForCli(selectedCli, nativeCommands);
        await showUsageLimitsPopover(nativeCommand);
        return true;
      }
      case 'cli': {
        const cli = args.toLowerCase() as CliId;
        if (!FOLLOW_UP_CLIS.includes(cli)) {
          appendSystemFollowUpMessage(`Select a CLI with ${definition.usage}.\n\nAvailable: ${FOLLOW_UP_CLIS.join(', ')}`);
          setPrompt('');
          return true;
        }
        updatePaneData(pane.id, {
          followUpCli: cli,
          followUpModel: '',
          followUpSkillId: '',
          followUpRuntimeSessionId: null,
        });
        setPrompt('');
        return true;
      }
      case 'model': {
        if (!args) {
          const modelList = models.length > 0
            ? models.map(model => `- ${model.id}${model.label && model.label !== model.id ? ` (${model.label})` : ''}`).join('\n')
            : '- Manual/default model';
          appendSystemFollowUpMessage(`Current model: ${activeSelectedModel || 'default'}\n\n${modelList}`);
          setPrompt('');
          return true;
        }
        const model = resolveModelArgument(args, models);
        const nextModel = model?.id ?? args;
        if (!isModelCompatibleWithCli(selectedCli, nextModel)) {
          appendSystemFollowUpMessage(`Model "${args}" does not look compatible with ${formatFollowUpCliLabel(selectedCli)}.`);
          setPrompt('');
          return true;
        }
        if (models.length > 0 && !model) {
          appendSystemFollowUpMessage(`Model "${args}" was not found for ${formatFollowUpCliLabel(selectedCli)}. Use /model with one of the listed model IDs.`);
          setPrompt('');
          return true;
        }
        changeFollowUpModel(nextModel);
        setPrompt('');
        return true;
      }
      case 'reasoning': {
        const nextReasoning = normalizeReasoningEffort(args);
        if (!nextReasoning || !reasoningOptionsForCli(selectedCli).some(option => option.value === nextReasoning)) {
          appendSystemFollowUpMessage(`Select reasoning effort with ${definition.usage}.`);
          setPrompt('');
          return true;
        }
        updatePaneData(pane.id, { followUpReasoning: nextReasoning });
        setPrompt('');
        return true;
      }
      case 'agent': {
        const role = resolveAgentRoleArgument(args, PUBLIC_AGENT_ROLES);
        if (!role) {
          appendSystemFollowUpMessage(`Select an agent role with ${definition.usage}.\n\nAvailable: ${PUBLIC_AGENT_ROLES.map(agent => agent.id).join(', ')}`);
          setPrompt('');
          return true;
        }
        changeFollowUpAgentRole(role.id);
        setPrompt('');
        return true;
      }
      case 'permission': {
        const normalized = args.toLowerCase().replace(/[_\s-]+/g, '-');
        const nextMode: FollowUpPermissionMode | null =
          ['restricted', 'read-only', 'readonly', 'plan'].includes(normalized)
            ? 'restricted'
            : ['full', 'yolo', 'bypass'].includes(normalized)
              ? 'full'
              : ['default', 'normal', 'auto'].includes(normalized)
                ? 'default'
                : null;
        if (!nextMode) {
          appendSystemFollowUpMessage(`Select a permission mode with ${definition.usage}.`);
          setPrompt('');
          return true;
        }
        changePermissionMode(nextMode);
        setPrompt('');
        return true;
      }
      case 'plan': {
        if (selectedPermissionMode !== 'restricted') changePermissionMode('restricted');
        const planPrompt = buildPlanPrompt(args);
        if (!options.internal) setPrompt('');
        await submitFollowUp(planPrompt, {
          ...options,
          skipSlashProcessing: true,
          displayContent: parsed.raw,
        });
        return true;
      }
      case 'goal': {
        if (!args) {
          appendSystemFollowUpMessage(selectedGoal ? `Current goal:\n\n${selectedGoal}` : 'No agent goal is set.');
          setPrompt('');
          return true;
        }
        updatePaneData(pane.id, { followUpGoal: args });
        appendSystemFollowUpMessage(`Goal set:\n\n${args}`);
        setPrompt('');
        return true;
      }
      case 'context': {
        if (!args) {
          openSlashContextPicker();
          return true;
        }
        const lower = args.toLowerCase();
        if (lower === 'workspace' && effectiveWorkspaceDir) {
          changeAgentContext(effectiveWorkspaceDir, 'folder');
          appendSystemFollowUpMessage(`Context changed to ${effectiveWorkspaceDir}.`);
          setPrompt('');
          return true;
        }
        const kind: FollowUpContextKind = /\.[^\\/.\s]+$/.test(args) ? 'file' : 'folder';
        changeAgentContext(args, kind);
        appendSystemFollowUpMessage(`Context changed to ${args}.`);
        setPrompt('');
        return true;
      }
      case 'session': {
        if (args.toLowerCase() !== 'new') {
          appendSystemFollowUpMessage(`Use ${definition.usage} to start a fresh agent session.`);
          setPrompt('');
          return true;
        }
        startNewSession();
        return true;
      }
      case 'compact':
        compactFollowUpContext();
        setPrompt('');
        return true;
      case 'clear':
        clearFollowUpContext();
        return true;
      default:
        return false;
    }
  }

  const activeRuntimeSession = runtimeSnapshot.sessions.find(session => session.sessionId === selectedSessionId);
  const activeRuntimeTerminalId = activeRuntimeSession?.terminalId ?? null;
  const activePermission = activeRuntimeSession?.activePermission;
  const runtimeStatus = runtimeStatusFor(runtimeSnapshot, selectedSessionId);
  const busyStateMatchesSession = Boolean(
    followUpBusyState?.active
      && (!selectedSessionId || !followUpBusyState.sessionId || followUpBusyState.sessionId === selectedSessionId)
  );
  const selectedSessionVisiblySettled = isFollowUpSessionVisiblySettled(messages, selectedSessionId);
  const activeVisibleOutput = hasActiveFollowUpOutput(messages, selectedSessionId);
  const busyIndicatorActive = busyStateMatchesSession && isFollowUpBusyIndicatorState(followUpBusyState?.state);
  const runtimeBusyWithVisibleTurn = Boolean(
    isFollowUpSessionBusy(activeRuntimeSession?.state)
    && !selectedSessionVisiblySettled
    && (activeVisibleOutput || busyIndicatorActive)
  );
  const permissionLiveStatusActive = Boolean(activePermission);
  const showRuntimeLiveStatus = messages.length > 0
    && (permissionLiveStatusActive || !selectedSessionVisiblySettled)
    && (permissionLiveStatusActive || submitting || busyIndicatorActive || activeVisibleOutput || runtimeBusyWithVisibleTurn);
  const runtimeLiveStatusStartedAt = selectedSessionId
    ? messages
      .filter(message => message.runtimeSessionId === selectedSessionId)
      .reduce((min, message) => Math.min(min, message.createdAt), Number.POSITIVE_INFINITY)
    : Number.POSITIVE_INFINITY;
  const runtimeLiveStatusBaseTime = Number.isFinite(runtimeLiveStatusStartedAt)
    ? runtimeLiveStatusStartedAt
    : followUpBusyState?.updatedAt ?? Date.now();
  const runtimeLiveStatusElapsedSeconds = Math.max(0, Math.floor((runtimeLiveStatusClock - runtimeLiveStatusBaseTime) / 1000));
  const runtimeLiveStatusText = runtimeLiveStatusLabel(followUpBusyState?.state ?? activeRuntimeSession?.state ?? null);

  useEffect(() => {
    if (!showRuntimeLiveStatus) return undefined;
    setRuntimeLiveStatusClock(Date.now());
    const timer = window.setInterval(() => setRuntimeLiveStatusClock(Date.now()), 1_000);
    return () => window.clearInterval(timer);
  }, [showRuntimeLiveStatus, runtimeLiveStatusBaseTime]);

  useEffect(() => {
    if (selectedCli !== 'codex' || !activeRuntimeTerminalId) return undefined;

    const updateFromTerminalOutput = (text: string) => {
      const nextContextUsage = parseCodexContextUsage(text);
      if (nextContextUsage) {
        setCliContextPercent(nextContextUsage.usedPercent);
        setCliContextTokenUsage(
          nextContextUsage.usedTokens !== undefined && nextContextUsage.totalTokens !== undefined
            ? { usedTokens: nextContextUsage.usedTokens, totalTokens: nextContextUsage.totalTokens }
            : null,
        );
      }
      const nextUsageRows = parseAgentUsageLimits(text);
      if (nextUsageRows.length > 0) {
        setCliUsageLimitRows(nextUsageRows);
        setCliUsageLimitRaw(text);
      }
    };

    updateFromTerminalOutput(terminalOutputBus.getTail(activeRuntimeTerminalId, 12_000));
    return terminalOutputBus.subscribe(activeRuntimeTerminalId, () => {
      updateFromTerminalOutput(terminalOutputBus.getTail(activeRuntimeTerminalId, 12_000));
    });
  }, [activeRuntimeTerminalId, selectedCli]);

  useLayoutEffect(() => {
    const element = agentOutputScrollRef.current;
    if (!element || !agentOutputShouldStickRef.current) return;
    element.scrollTop = element.scrollHeight;
  }, [messages, showRuntimeLiveStatus]);

  const showSkills = selectedCli === 'codex' || selectedCli === 'claude';
  const cliOptions = FOLLOW_UP_CLIS.map(cli => ({
    value: cli,
    label: formatFollowUpCliLabel(cli),
    icon: agentBrandIcon(brandKindForCli(cli), 14),
  }));
  const modelOptions = models.length === 0
    ? [{
        value: '',
        label: loadingModels ? 'Discovering models...' : 'Manual/default model',
        icon: agentBrandIcon(brandKindForCli(selectedCli), 14),
      }]
    : models.map(model => ({
        value: model.id,
        label: formatModelLabel(model.label || model.id),
        icon: agentBrandIcon(brandKindForModel(model, selectedCli), 14),
      }));
  const selectedSkillForToast = skills.find(skill => skill.id === selectedSkillId) ?? null;
  const promptHistory = useMemo(
    () => messages
      .filter(message => message.role === 'user' && message.status !== 'queued')
      .map(message => message.content.replace(/\n\nFailed to send.*$/s, '')),
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
  const runtimeHealthText = usesSdkTransport ? sdkStatusText : runtimeStatus;
  const selectedReasoningLabel = selectedReasoning ? formatReasoningEffortLabel(selectedReasoning) : null;
  const canSend = Boolean(prompt.trim()) && !needsOpenAiApiKey;
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
  const canDrillIntoSlashCommand = (id: AgentSlashSuggestion['id']) =>
    id === 'cli' || id === 'model' || id === 'agent' || id === 'permission' || id === 'reasoning';

  const handlePromptKeyDown = (event: ReactKeyboardEvent<HTMLTextAreaElement>) => {
    if ((event.ctrlKey || event.metaKey) && event.key === 'Enter') {
      event.preventDefault();
      void submitFollowUp();
      return;
    }
    if (slashCommandMenuOpen && !event.altKey && !event.ctrlKey && !event.metaKey && !event.shiftKey) {
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        setSlashCommandIndex(index => Math.min(visibleSlashSuggestions.length - 1, index + 1));
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        setSlashCommandIndex(index => Math.max(0, index - 1));
        return;
      }
      if (event.key === 'Enter' && selectedSlashCommand) {
        event.preventDefault();
        if (slashPickerCommand || canDrillIntoSlashCommand(selectedSlashCommand.id)) {
          runSlashMenuSelection(selectedSlashCommand);
        } else {
          void submitFollowUp(promptWithActiveSlashCommand(`/${selectedSlashCommand.name}`));
        }
        return;
      }
      if (event.key === ' ' && !slashPickerCommand && selectedSlashCommand) {
        event.preventDefault();
        chooseSlashCommand(selectedSlashCommand);
        return;
      }
      if (event.key === 'Tab' && selectedSlashCommand) {
        event.preventDefault();
        runSlashMenuSelection(selectedSlashCommand);
        return;
      }
      if (event.key === 'Escape') {
        event.preventDefault();
        if (slashPickerCommand) {
          setSlashPickerCommand(null);
          setSlashPickerStandalone(false);
          setSlashCommandIndex(0);
        } else {
          setPrompt('');
        }
        return;
      }
    }
    if (
      event.key === 'Escape' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      contextSlashPickerOpen
    ) {
      event.preventDefault();
      setContextSlashPickerOpen(false);
      return;
    }
    if (
      event.key === 'Escape' &&
      !event.altKey &&
      !event.ctrlKey &&
      !event.metaKey &&
      !event.shiftKey &&
      (usagePopoverPayload || usagePopoverStatus)
    ) {
      event.preventDefault();
      setUsagePopoverPayload(null);
      setUsagePopoverStatus(null);
      return;
    }
    if (event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey) {
      if (!event.shiftKey) {
        event.preventDefault();
        void submitFollowUp();
      }
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
    setSlashCommandIndex(0);
    if (usagePopoverPayload || usagePopoverStatus) {
      setUsagePopoverPayload(null);
      setUsagePopoverStatus(null);
    }
    if (contextSlashPickerOpen) setContextSlashPickerOpen(false);
    const nextSlash = findAgentSlashCommand(value);
    if (
      slashPickerCommand &&
      !slashPickerStandalone &&
      (nextSlash?.kind !== 'command' || nextSlash.command !== slashPickerCommand)
    ) {
      setSlashPickerCommand(null);
    }
    setPrompt(value);
  };
  const stopSdkChat = () => {
    sdkAbortRef.current?.abort();
    if (selectedSessionId) setFollowUpBusyState(selectedSessionId, 'Stopping');
    else setSdkStep('Stopping');
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
    listen<unknown>('mcp-message', event => {
      if (unmounted) return;
      const payload = parseDebugAgentPromptPayload(event.payload);
      if (!payload) return;
      if (payload.targetPaneId) {
        if (payload.targetPaneId !== pane.id) return;
      } else {
        const activePaneId = useWorkspaceStore.getState().activePaneId;
        if (activePaneId && activePaneId !== pane.id) return;
        if (!activePaneId && pane.data?.dockExpandedToTab !== true) return;
      }
      if (payload.requestId) {
        if (handledDebugAgentPromptIdsRef.current.has(payload.requestId)) return;
        handledDebugAgentPromptIdsRef.current.add(payload.requestId);
      }
      void submitFollowUp(payload.prompt, {
        skipSlashProcessing: payload.skipSlashProcessing,
        displayContent: payload.displayContent,
      });
    }).then(fn => {
      if (unmounted) fn();
      else unlistenFn = fn;
    }).catch(error => {
      console.debug('[FollowUpComposer] debug prompt listener unavailable in this runtime', error);
    });
    return () => {
      unmounted = true;
      if (unlistenFn) unlistenFn();
    };
  }, [pane.data?.dockExpandedToTab, pane.id, submitFollowUp]);
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
  const runtimeSessionIds = Array.from(new Set([
    ...runtimeSnapshot.sessions
      .filter(session => session.missionId === `adhoc-followup-${missionId}` || session.nodeId.includes(`:${missionId}`))
      .map(session => session.sessionId),
    ...messages.map(message => message.runtimeSessionId).filter((sessionId): sessionId is string => Boolean(sessionId)),
  ]));
  const knownRuntimeSessionIds = new Set(followUpSessions.map(session => session.runtimeSessionId).filter(Boolean));
  const sessionOptions = [
    { value: '', label: 'New session', description: 'Start with fresh context' },
    ...followUpSessions.map(session => {
      const runtimeSession = session.runtimeSessionId
        ? runtimeSnapshot.sessions.find(candidate => candidate.sessionId === session.runtimeSessionId)
        : null;
      const sessionCli = FOLLOW_UP_CLIS.includes(session.cli as CliId) ? session.cli as CliId : selectedCli;
      return {
        value: session.threadId,
        label: cleanAgentSessionTitle(session.title, 'Workspace chat'),
        description: runtimeSession?.state
          ? `${formatFollowUpCliLabel(sessionCli)} · ${runtimeSession.state}`
          : session.lastPrompt
            ? session.lastPrompt
            : 'Previous session',
        icon: agentBrandIcon(brandKindForCli(sessionCli), 14),
      };
    }),
    ...runtimeSessionIds
      .filter(sessionId => !knownRuntimeSessionIds.has(sessionId))
      .map(sessionId => {
        const runtimeSession = runtimeSnapshot.sessions.find(session => session.sessionId === sessionId);
        return {
          value: `runtime:${sessionId}`,
          label: cleanAgentSessionTitle(runtimeSession?.role ?? sessionId.slice(0, 8), 'Runtime session'),
          description: runtimeSession?.state ?? 'Runtime session',
          icon: runtimeSession?.cliId ? agentBrandIcon(brandKindForCli(runtimeSession.cliId), 14) : undefined,
        };
      }),
  ];
  const contextWindowTokens = inferContextWindowTokens(selectedCli, activeSelectedModel || selectedModel || null, models);
  const estimatedConversationCharacters = Math.min(
    messages.reduce((total, message) => total + stripAgentTokenUsage(message.content).length, 0),
    ESTIMATED_CONVERSATION_CONTEXT_CHAR_LIMIT,
  );
  const estimatedDraftContextTokens = estimateTokensFromText([
    prompt,
    agentContextPath ?? '',
    selectedSkillForToast?.name ?? '',
    attachments.map(attachment => `${attachment.name} ${attachment.path ?? ''}`).join('\n'),
    estimatedConversationCharacters > 0 ? 'x'.repeat(estimatedConversationCharacters) : '',
  ].filter(Boolean).join('\n'));
  const sdkLatestInputTokens = sdkUsage?.lastInputTokens && sdkUsage.lastInputTokens > 0
    ? sdkUsage.lastInputTokens
    : sdkUsage?.inputTokens ?? 0;
  const recordedTokenUsage = latestAgentTokenUsage(messages);
  const liveTokenUsage = sdkUsage
    ? normalizeAgentTokenUsage({
        inputTokens: sdkLatestInputTokens,
        outputTokens: sdkUsage.outputTokens,
        cachedInputTokens: sdkUsage.lastCachedTokens ?? sdkUsage.cachedInputTokens,
        contextInputTokens: sdkLatestInputTokens,
      })
    : null;
  const headerTokenUsage = recordedTokenUsage ?? liveTokenUsage;
  const headerContextTokenCount = Math.min(contextAgentTokenUsage(headerTokenUsage), contextWindowTokens);
  const cliContextTotalTokens = cliContextTokenUsage?.totalTokens ?? contextWindowTokens;
  const cliContextUsedTokens = cliContextTokenUsage?.usedTokens ?? (
    cliContextPercent !== null ? Math.round((cliContextPercent / 100) * cliContextTotalTokens) : 0
  );
  const contextTokenTitle = (usedTokens: number, totalTokens: number) =>
    `${formatContextTokenCount(usedTokens)} tokens / ${formatContextTokenCount(totalTokens)} tokens`;
  const contextUsage = headerTokenUsage
    ? {
        percent: percentFromTokens(headerContextTokenCount, contextWindowTokens),
        title: `${contextTokenTitle(headerContextTokenCount, contextWindowTokens)} · ${formatAgentTokenUsageDetail(headerTokenUsage)}`,
      }
    : cliContextPercent !== null
    ? {
        percent: cliContextPercent,
        title: contextTokenTitle(cliContextUsedTokens, cliContextTotalTokens),
      }
    : sdkLatestInputTokens > 0
      ? {
          percent: percentFromTokens(sdkLatestInputTokens, contextWindowTokens),
          title: contextTokenTitle(sdkLatestInputTokens, contextWindowTokens),
        }
      : {
          percent: percentFromTokens(estimatedDraftContextTokens, contextWindowTokens),
          title: contextTokenTitle(estimatedDraftContextTokens, contextWindowTokens),
        };
  const contextPercent = contextUsage.percent;
  const contextRingStyle = { '--td-context-percent': `${contextPercent}%` } as CSSProperties;
  const parsedSlashPrompt = findAgentSlashCommand(prompt);
  const slashPromptHasManualArgs = parsedSlashPrompt?.kind === 'command' && /\s/.test(parsedSlashPrompt.raw);
  const selectedModelForSlash = models.find(model => model.id === activeSelectedModel)
    ?? models.find(model => model.id === selectedModel)
    ?? null;
  const currentSlashMetaForCommand = (commandId: AgentSlashCommandId): SlashMenuEntry['currentMeta'] => {
    switch (commandId) {
      case 'cli':
        return {
          icon: agentBrandIcon(brandKindForCli(selectedCli), 13),
          label: formatFollowUpCliLabel(selectedCli),
        };
      case 'model': {
        const modelId = activeSelectedModel || selectedModel || 'default';
        return {
          icon: selectedModelForSlash
            ? agentBrandIcon(brandKindForModel(selectedModelForSlash, selectedCli), 13)
            : agentBrandIcon(brandKindForCli(selectedCli), 13),
          label: selectedModelForSlash ? formatModelLabel(selectedModelForSlash.label || selectedModelForSlash.id) : modelId,
        };
      }
      case 'reasoning':
        return {
          icon: <Sparkles size={13} />,
          label: selectedReasoning ? formatReasoningEffortLabel(selectedReasoning) : 'Default',
        };
      case 'agent':
        return {
          icon: iconForAgentRole(selectedAgent.id),
          label: selectedAgent.name,
        };
      case 'permission':
        return {
          icon: <Shield size={13} />,
          label: permissionModeLabel(selectedPermissionMode),
        };
      default:
        return undefined;
    }
  };
  const slashIconForCommand = (commandId: AgentSlashCommandId): ReactNode | undefined => {
    if (commandId === 'model') return currentSlashMetaForCommand('model')?.icon;
    if (commandId === 'cli') return currentSlashMetaForCommand('cli')?.icon;
    if (commandId === 'reasoning') return <Sparkles size={14} />;
    if (commandId === 'agent') return iconForAgentRole(selectedAgent.id);
    if (commandId === 'permission') return <Shield size={14} />;
    if (commandId === 'context') return <Folder size={14} />;
    if (commandId === 'session') return <Clock size={14} />;
    if (commandId === 'compact') return <Minimize2 size={14} />;
    if (commandId === 'usage') return <TerminalSquare size={14} />;
    if (commandId === 'plan') return <ClipboardList size={14} />;
    if (commandId === 'goal') return <ListChecks size={14} />;
    if (commandId === 'clear') return <Eraser size={14} />;
    return <FileText size={14} />;
  };
  const slashCommandSuggestions = useMemo<SlashMenuEntry[]>(
    () => buildAgentSlashCommandSuggestions(prompt, {
      cli: selectedCli,
      models,
      agentRoles: PUBLIC_AGENT_ROLES,
      max: 12,
    }).map(suggestion => ({
      ...suggestion,
      key: `command:${suggestion.id}`,
      entryKind: 'command',
      commandId: suggestion.id,
      icon: slashIconForCommand(suggestion.id),
      currentMeta: currentSlashMetaForCommand(suggestion.id),
    })),
    [activeSelectedModel, models, prompt, selectedAgent.id, selectedAgent.name, selectedCli, selectedModel, selectedModelForSlash, selectedPermissionMode, selectedReasoning],
  );
  const slashValueSuggestions = useMemo<SlashMenuEntry[]>(() => {
    const query = parsedSlashPrompt?.kind === 'command' ? parsedSlashPrompt.args.trim().toLowerCase() : '';
    const matches = (value: string, label: string) =>
      !query || value.toLowerCase().includes(query) || label.toLowerCase().includes(query);

    if (slashPickerCommand === 'cli') {
      return FOLLOW_UP_CLIS
        .filter(cli => matches(cli, formatFollowUpCliLabel(cli)))
        .map(cli => ({
          id: 'cli',
          name: cli,
          label: formatFollowUpCliLabel(cli),
          usage: cli,
          description: cli === selectedCli ? 'Current CLI' : 'Switch runtime CLI',
          group: 'runtime',
          key: `cli:${cli}`,
          entryKind: 'value',
          commandId: 'cli',
          value: cli,
          icon: agentBrandIcon(brandKindForCli(cli), 14),
          selected: cli === selectedCli,
        }));
    }

    if (slashPickerCommand === 'model') {
      if (loadingModels) {
        return [{
          id: 'model',
          name: 'loading',
          label: 'Discovering models...',
          usage: selectedCli,
          description: 'Model discovery is still running.',
          group: 'runtime',
          key: 'model:loading',
          entryKind: 'value',
          commandId: 'model',
          icon: agentBrandIcon(brandKindForCli(selectedCli), 14),
          disabled: true,
        }];
      }
      return models
        .filter(model => matches(model.id, model.label || model.id))
        .map(model => ({
          id: 'model',
          name: model.id,
          label: formatModelLabel(model.label || model.id),
          usage: model.id,
          description: model.provider ? `${model.provider} · ${model.source}` : model.source,
          group: 'runtime',
          key: `model:${model.id}`,
          entryKind: 'value',
          commandId: 'model',
          value: model.id,
          icon: agentBrandIcon(brandKindForModel(model, selectedCli), 14),
          selected: model.id === activeSelectedModel,
        }));
    }

    if (slashPickerCommand === 'agent') {
      return PUBLIC_AGENT_ROLES
        .filter(role => matches(role.id, role.name))
        .map(role => ({
          id: 'agent',
          name: role.id,
          label: role.name,
          usage: role.id,
          description: role.description,
          group: 'runtime',
          key: `agent:${role.id}`,
          entryKind: 'value',
          commandId: 'agent',
          value: role.id,
          icon: iconForAgentRole(role.id),
          selected: role.id === selectedAgentRoleId,
        }));
    }

    if (slashPickerCommand === 'permission') {
      const modes: Array<{ value: FollowUpPermissionMode; label: string; detail: string }> = [
        { value: 'default', label: permissionModeLabel('default'), detail: 'Ask before unsafe actions.' },
        { value: 'restricted', label: permissionModeLabel('restricted'), detail: 'Use CLI plan/read-only mode.' },
        { value: 'full', label: permissionModeLabel('full'), detail: 'Use CLI bypass/yolo mode.' },
      ];
      return modes
        .filter(mode => matches(mode.value, mode.label))
        .map(mode => ({
          id: 'permission',
          name: mode.value,
          label: mode.label,
          usage: mode.value,
          description: mode.detail,
          group: 'runtime',
          key: `permission:${mode.value}`,
          entryKind: 'value',
          commandId: 'permission',
          value: mode.value,
          icon: permissionModeIcon(mode.value),
          selected: mode.value === selectedPermissionMode,
        }));
    }

    if (slashPickerCommand === 'reasoning') {
      return reasoningOptionsForCli(selectedCli)
        .filter(option => matches(option.value, option.label))
        .map(option => ({
          id: 'reasoning',
          name: option.value,
          label: option.label,
          usage: option.value,
          description: option.value === selectedReasoning ? 'Current reasoning effort' : option.description,
          group: 'runtime',
          key: `reasoning:${option.value}`,
          entryKind: 'value',
          commandId: 'reasoning',
          value: option.value,
          icon: <Sparkles size={14} />,
          selected: option.value === selectedReasoning,
        }));
    }

    return [];
  }, [activeSelectedModel, loadingModels, models, parsedSlashPrompt, selectedAgentRoleId, selectedCli, selectedPermissionMode, selectedReasoning, slashPickerCommand]);
  const visibleSlashSuggestions = slashPickerCommand ? slashValueSuggestions : slashCommandSuggestions;
  const slashCommandMenuOpen = visibleSlashSuggestions.length > 0
    && (
      Boolean(slashPickerCommand)
      || (
        parsedSlashPrompt?.kind === 'command'
        && !slashPromptHasManualArgs
        && promptInputRef.current === document.activeElement
      )
    )
    && !usagePopoverPayload
    && !usagePopoverStatus
    && !contextSlashPickerOpen;
  const selectedSlashCommand = visibleSlashSuggestions[Math.min(slashCommandIndex, Math.max(0, visibleSlashSuggestions.length - 1))] ?? null;

  useEffect(() => {
    setSlashCommandIndex(0);
    slashOptionRefs.current = [];
  }, [prompt, selectedCli, slashPickerCommand, slashPickerStandalone]);

  useEffect(() => {
    if (!slashCommandMenuOpen) return;
    slashOptionRefs.current[slashCommandIndex]?.scrollIntoView({ block: 'nearest' });
  }, [slashCommandIndex, slashCommandMenuOpen, visibleSlashSuggestions.length]);

  useEffect(() => {
    if (slashPickerStandalone) return;
    if (!parsedSlashPrompt || parsedSlashPrompt.kind !== 'command') {
      setSlashPickerCommand(null);
      return;
    }
    if (slashPickerCommand && parsedSlashPrompt.command !== slashPickerCommand) {
      setSlashPickerCommand(null);
    }
  }, [parsedSlashPrompt, slashPickerCommand, slashPickerStandalone]);

  function chooseSlashCommand(suggestion: SlashMenuEntry) {
    setSlashPickerCommand(null);
    setSlashPickerStandalone(false);
    replaceActiveSlashCommand(`/${suggestion.name} `);
    setSlashCommandIndex(0);
  }

  function openSlashValuePicker(suggestion: SlashMenuEntry) {
    if (!canDrillIntoSlashCommand(suggestion.id)) {
      chooseSlashCommand(suggestion);
      return;
    }
    replaceActiveSlashCommand(`/${suggestion.name}`);
    setSlashPickerCommand(suggestion.id);
    setSlashPickerStandalone(false);
    setSlashCommandIndex(0);
  }

  function applySlashValueSelection(suggestion: SlashMenuEntry) {
    if (!suggestion.commandId || !suggestion.value || suggestion.disabled) return;
    switch (suggestion.commandId) {
      case 'cli': {
        const cli = suggestion.value as CliId;
        updatePaneData(pane.id, {
          followUpCli: cli,
          followUpModel: '',
          followUpSkillId: '',
          followUpRuntimeSessionId: null,
        });
        break;
      }
      case 'model':
        changeFollowUpModel(suggestion.value, { promptForReasoning: true, clearActiveSlash: true });
        return;
      case 'agent': {
        const role = PUBLIC_AGENT_ROLES.find(candidate => candidate.id === suggestion.value);
        if (!role) return;
        changeFollowUpAgentRole(role.id);
        break;
      }
      case 'permission': {
        const mode = suggestion.value as FollowUpPermissionMode;
        changePermissionMode(mode);
        break;
      }
      case 'reasoning':
        updatePaneData(pane.id, { followUpReasoning: suggestion.value });
        break;
      default:
        return;
    }
    setSlashPickerCommand(null);
    setSlashPickerStandalone(false);
    if (parsedSlashPrompt?.kind === 'command') {
      const nextPrompt = `${prompt.slice(0, parsedSlashPrompt.start)}${prompt.slice(parsedSlashPrompt.end)}`;
      setPrompt(nextPrompt);
    }
    setSlashCommandIndex(0);
    focusPromptAtEnd();
  }

  function runSlashMenuSelection(suggestion: SlashMenuEntry) {
    if (suggestion.disabled) return;
    if (suggestion.id === 'context' && suggestion.entryKind === 'command') {
      openSlashContextPicker();
      return;
    }
    if (suggestion.entryKind === 'value') {
      applySlashValueSelection(suggestion);
      return;
    }
    if (canDrillIntoSlashCommand(suggestion.id)) {
      openSlashValuePicker(suggestion);
      return;
    }
    void submitFollowUp(promptWithActiveSlashCommand(`/${suggestion.name}`));
  }

  function startNewSession() {
    if (selectedCli === 'codex' && sdkAbortRef.current) {
      sdkAbortRef.current.abort();
      if (selectedSessionId) setFollowUpBusyState(selectedSessionId, 'Stopping');
    }
    updatePaneData(pane.id, {
      followUpThreadId: `thread:${missionId}:${generateId()}`,
      followUpMessages: [],
      followUpAttachments: [],
      followUpQueue: [],
      followUpRuntimeSessionId: null,
      followUpBusyState: null,
    });
    setSdkStep(null);
    setPrompt('');
  }

  function refreshCapabilities() {
    if (!supportsModelDiscovery(selectedCli)) return;
    if (selectedCli === 'codex') {
      setModels(OPENAI_SDK_MODELS);
    }
    setLoadingModels(true);
    discoverModelsForCli(selectedCli, { refresh: true, workspaceDir: runtimeWorkspaceDir })
      .then(result => setModels(selectedCli === 'codex' ? mergeCodexModels(result.models) : result.models))
      .finally(() => setLoadingModels(false));
    invoke<CliCapabilityDiscovery>('discover_cli_capabilities', {
      cli: selectedCli,
      projectPath: runtimeWorkspaceDir,
      refresh: true,
    })
      .then(result => {
        setSkills(result.skills ?? []);
        setNativeCommands(result.commands ?? []);
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

  const slashCommandMenu = slashCommandMenuOpen ? (
    <div
      ref={slashMenuRef}
      className={`td-agent-slash-menu ${slashPickerCommand ? 'is-value-picker' : 'is-command-picker'}`}
      role="listbox"
      aria-label={slashPickerCommand ? `/${slashPickerCommand} options` : 'Agent commands'}
    >
      {visibleSlashSuggestions.map((suggestion, index) => (
        <button
          key={suggestion.key}
          ref={node => {
            slashOptionRefs.current[index] = node;
          }}
          type="button"
          className={[
            'td-agent-slash-option',
            suggestion.entryKind === 'value' ? 'is-value' : 'is-command',
            index === slashCommandIndex ? 'is-selected' : '',
            suggestion.selected ? 'is-current' : '',
          ].filter(Boolean).join(' ')}
          disabled={suggestion.disabled}
          onMouseDown={event => event.preventDefault()}
          onClick={() => runSlashMenuSelection(suggestion)}
          role="option"
          aria-selected={index === slashCommandIndex}
        >
          <span className="td-agent-slash-icon" aria-hidden="true">{suggestion.icon}</span>
          <span className="td-agent-slash-command">{suggestion.usage}</span>
          <span className="td-agent-slash-copy">
            <span>{suggestion.label}</span>
            <small>{suggestion.description || suggestion.detail}</small>
          </span>
          {suggestion.currentMeta && (
            <span className="td-agent-slash-current" title={suggestion.currentMeta.label}>
              {suggestion.currentMeta.icon && <span className="td-agent-slash-current-icon" aria-hidden="true">{suggestion.currentMeta.icon}</span>}
              <code>{suggestion.currentMeta.label}</code>
            </span>
          )}
        </button>
      ))}
      <div className="td-agent-slash-hint">
        {slashPickerCommand ? 'Enter applies. Esc returns.' : 'Enter runs. Space types. Tab opens options.'}
      </div>
    </div>
  ) : null;
  const permissionPopup = activePermission && selectedSessionId ? (
    <AgentPermissionPopup
      key={activePermission.permissionId}
      permission={activePermission}
      sessionId={selectedSessionId}
      elapsedSeconds={runtimeLiveStatusElapsedSeconds}
    />
  ) : null;
  const usageLimitPopover = usagePopoverPayload || usagePopoverStatus ? (
    <div className="td-agent-usage-popover" role="dialog" aria-label="Usage limits">
      {usagePopoverPayload ? (
        <AgentUsageLimitCard payload={usagePopoverPayload} />
      ) : (
        <div className="td-agent-usage-card">
          <div className="td-agent-usage-header">
            <span>Usage limits</span>
          </div>
          <div className="td-agent-usage-status">
            {usagePopoverStatus}
          </div>
        </div>
      )}
      <div className="td-agent-usage-hint">Esc closes</div>
    </div>
  ) : null;
  const contextSlashPopup = contextSlashPickerOpen ? (
    <AgentContextSlashPopup
      activeFilePath={activeFilePath}
      workspaceDir={runtimeWorkspaceDir}
      contextPath={selectedContextPath}
      contextKind={selectedContextKind}
      runtimeStatus={runtimeHealthText}
      onSelectContext={changeAgentContext}
      onClose={() => {
        setContextSlashPickerOpen(false);
        focusPromptAtEnd();
      }}
    />
  ) : null;

  const rootClass = placement === 'global' || placement === 'tab'
    ? 'td-followup-dock td-followup-dock-global relative w-[min(780px,calc(100vw-2rem))] px-0 pb-0 pt-0'
    : 'td-followup-dock absolute inset-x-0 bottom-0 z-20 px-3 pb-3 pt-10';
  const messagesClass = placement === 'global'
    ? 'mx-auto mb-3 max-h-44 overflow-y-auto space-y-2 pr-1'
    : 'mx-auto mb-3 max-h-56 max-w-[980px] overflow-y-auto space-y-2 pr-1';
  const shellClass = placement === 'global'
    ? 'td-followup-glass mx-auto rounded-2xl p-2'
    : 'td-followup-glass mx-auto max-w-[980px] rounded-2xl p-2';
  const liveCodeChangeCard = liveCodeChanges.length > 0
    ? (
      <div className="td-agent-live-code-changes">
        <AgentChangeSummaryCard changes={liveCodeChanges} />
      </div>
    )
    : null;
  const queuedFollowUpPanel = pendingQueue.length > 0 ? (
    <div className="td-agent-queued-messages" aria-label="Queued messages">
      {pendingQueue.map(item => (
        <div
          key={item.id}
          className={`td-agent-queued-message ${draggingQueueId === item.id ? 'is-dragging' : ''}`}
          draggable
          onDragStart={event => {
            setDraggingQueueId(item.id);
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', item.id);
          }}
          onDragEnd={() => setDraggingQueueId(null)}
          onDragOver={event => {
            event.preventDefault();
            event.dataTransfer.dropEffect = 'move';
            const sourceId = draggingQueueId || event.dataTransfer.getData('text/plain');
            if (sourceId) moveQueuedFollowUp(sourceId, item.id);
          }}
          onDrop={event => {
            event.preventDefault();
            const sourceId = event.dataTransfer.getData('text/plain') || draggingQueueId;
            if (sourceId) moveQueuedFollowUp(sourceId, item.id);
            setDraggingQueueId(null);
          }}
        >
          <span className="td-agent-queued-grip" title="Drag to reorder" aria-hidden="true">
            <span /><span /><span /><span />
          </span>
          <span className="td-agent-queued-preview" title={item.prompt}>
            {queuedPromptPreview(item.prompt)}
          </span>
          <button
            type="button"
            className="td-agent-queued-icon"
            onClick={() => editQueuedFollowUp(item)}
            title="Edit queued message"
            aria-label="Edit queued message"
          >
            <Pencil size={13} />
          </button>
          <button
            type="button"
            className="td-agent-queued-steer"
            onClick={() => void steerQueuedFollowUp(item)}
            title="Send now"
          >
            <span>Steer</span>
            <span aria-hidden="true">↵</span>
          </button>
          <button
            type="button"
            className="td-agent-queued-icon"
            onClick={() => discardQueuedFollowUp(item)}
            title="Discard queued message"
            aria-label="Discard queued message"
          >
            <Trash2 size={13} />
          </button>
        </div>
      ))}
    </div>
  ) : null;

  if (placement === 'global' || placement === 'tab') {
    const outerClass = placement === 'tab'
      ? 'td-followup-dock td-followup-dock-global td-followup-dock-tab relative h-full w-full px-0 pb-0 pt-0'
      : 'td-followup-dock td-followup-dock-global relative w-[min(760px,calc(100vw-2rem))] px-0 pb-0 pt-0';
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
              onChange={value => changeFollowUpAgentRole(value)}
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
              title={contextUsage.title}
            >
              <span className="td-agent-context-percent">{contextPercent}%</span>
              <span className="td-agent-context-ring" style={contextRingStyle} aria-hidden="true" />
            </button>
            <div className="td-agent-header-spacer" />
            <FollowUpSelect
              menuId="session"
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              value={threadId}
              options={sessionOptions}
              onChange={value => {
                if (!value) {
                  startNewSession();
                  return;
                }
                if (value.startsWith('runtime:')) {
                  updatePaneData(pane.id, { followUpRuntimeSessionId: value.slice('runtime:'.length) });
                  return;
                }
                const session = followUpSessions.find(candidate => candidate.threadId === value);
                if (!session) return;
                updatePaneData(pane.id, {
                  followUpThreadId: session.threadId,
                  followUpRuntimeSessionId: session.runtimeSessionId ?? null,
                  followUpMessages: session.threadId === threadId ? readFollowUpMessages(pane.id) : [],
                  followUpQueue: [],
                  followUpBusyState: null,
                });
              }}
              title="Session"
              className="td-agent-session-select"
              visibleOptions={10}
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

          <div
            className={`td-agent-chat-area ${visibleMessages.length > 0 ? 'has-messages' : ''}`}
            ref={agentOutputScrollRef}
            onScroll={handleAgentOutputScroll}
          >
            {visibleMessages.length === 0 ? (
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
                <FollowUpMessageTimeline
                  messages={visibleMessages}
                  onCardAction={recordCardAction}
                  sdkCommandTerminalId={sdkCommandTerminalId}
                  onSdkCommandTerminalId={rememberSdkCommandTerminalId}
                  cardResolutions={cardResolutions}
                />
                {showRuntimeLiveStatus && (
                  <AgentRuntimeStatusLine label={runtimeLiveStatusText} elapsedSeconds={runtimeLiveStatusElapsedSeconds} />
                )}
              </div>
            )}
          </div>

          {liveCodeChangeCard}
          {queuedFollowUpPanel}

          <div className="td-agent-prompt-pill">
            {permissionPopup}
            {attachmentToasts}
            {slashCommandMenu}
            {usageLimitPopover}
            {contextSlashPopup}
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
                  onChange={value => changeFollowUpModel(value, { promptForReasoning: true })}
                  title="Model"
                  trailingMeta={selectedReasoningLabel}
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
                  workspaceDir={runtimeWorkspaceDir}
                  contextPath={selectedContextPath}
                  contextKind={selectedContextKind}
                  activeMenu={activeMenu}
                  setActiveMenu={setActiveMenu}
                  runtimeStatus={runtimeHealthText}
                  onSelectContext={changeAgentContext}
                />
              </div>
              <div className="td-agent-prompt-right">
                {submitting && usesSdkTransport && (
                  <button type="button" onClick={stopSdkChat} className="td-agent-icon-button" title="Stop">
                    <Square size={14} />
                  </button>
                )}
                {submitting && !usesSdkTransport && selectedSessionId && (
                  <button type="button" onClick={() => selectedSessionId && runtimeManager.stopRuntime({ sessionId: selectedSessionId, reason: 'Stopped from follow-up composer' })} className="td-agent-icon-button" title="Stop">
                    <Square size={14} />
                  </button>
                )}
                <button type="button" onClick={refreshCapabilities} className="td-agent-icon-button td-agent-refresh-button" title="Refresh models and skills">
                  <RefreshCw size={14} />
                  <span>Refresh</span>
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
      {visibleMessages.length > 0 && (
        <div
          className={messagesClass}
          ref={agentOutputScrollRef}
          onScroll={handleAgentOutputScroll}
        >
          <FollowUpMessageTimeline
            messages={visibleMessages}
            onCardAction={recordCardAction}
            sdkCommandTerminalId={sdkCommandTerminalId}
            onSdkCommandTerminalId={rememberSdkCommandTerminalId}
            cardResolutions={cardResolutions}
          />
          {showRuntimeLiveStatus && (
            <AgentRuntimeStatusLine label={runtimeLiveStatusText} elapsedSeconds={runtimeLiveStatusElapsedSeconds} />
          )}
        </div>
      )}
      {liveCodeChangeCard}
      {queuedFollowUpPanel}
      <div className={shellClass}>
        {permissionPopup}
        {skillsOverlay}
        {attachmentToasts}
        {slashCommandMenu}
        {usageLimitPopover}
        {contextSlashPopup}
        <textarea
          ref={promptInputRef}
          value={prompt}
          onChange={event => handlePromptChange(event.target.value)}
          onKeyDown={handlePromptKeyDown}
          placeholder="Continue this mission..."
          className="min-h-[76px] w-full resize-none bg-transparent px-2 py-1 text-sm text-text-primary placeholder:text-text-muted outline-none"
        />
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
              onChange={value => changeFollowUpModel(value, { promptForReasoning: true })}
              title="Model"
              trailingMeta={selectedReasoningLabel}
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
              workspaceDir={runtimeWorkspaceDir}
              contextPath={selectedContextPath}
              contextKind={selectedContextKind}
              activeMenu={activeMenu}
              setActiveMenu={setActiveMenu}
              runtimeStatus={runtimeHealthText}
              onSelectContext={changeAgentContext}
            />
            {showSkills && skills.length === 0 && capabilityWarnings.length > 0 && (
              <span className="hidden md:inline text-[10px] text-text-muted truncate">{capabilityWarnings[0]}</span>
            )}
          </div>
          <div className="flex items-center gap-1.5">
            {submitting && usesSdkTransport && (
              <button type="button" onClick={stopSdkChat} className="p-1.5 rounded text-text-muted hover:text-red-300" title="Stop">
                <Square size={14} />
              </button>
            )}
            {submitting && !usesSdkTransport && selectedSessionId && (
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

function normalizeFollowUpSessionRecord(value: unknown): FollowUpSessionRecord | null {
  if (!value || typeof value !== 'object') return null;
  const record = value as Partial<FollowUpSessionRecord>;
  if (typeof record.threadId !== 'string' || !record.threadId.trim()) return null;
  const createdAt = Number.isFinite(record.createdAt) ? Number(record.createdAt) : Date.now();
  const updatedAt = Number.isFinite(record.updatedAt) ? Number(record.updatedAt) : createdAt;
  return {
    threadId: record.threadId.trim(),
    runtimeSessionId: typeof record.runtimeSessionId === 'string' && record.runtimeSessionId.trim()
      ? record.runtimeSessionId.trim()
      : null,
    title: cleanAgentSessionTitle(record.title, 'Workspace chat'),
    createdAt,
    updatedAt,
    cli: typeof record.cli === 'string' && record.cli.trim() ? record.cli.trim() : undefined,
    model: typeof record.model === 'string' && record.model.trim() ? record.model.trim() : null,
    lastPrompt: typeof record.lastPrompt === 'string' && record.lastPrompt.trim() ? record.lastPrompt.trim() : undefined,
  };
}

function readFollowUpSessions(paneId: string): FollowUpSessionRecord[] {
  const panes = useWorkspaceStore.getState().tabs.flatMap(tab => tab.panes);
  const raw = panes.find(pane => pane.id === paneId)?.data?.followUpSessions;
  if (!Array.isArray(raw)) return [];
  const byThread = new Map<string, FollowUpSessionRecord>();
  for (const item of raw) {
    const normalized = normalizeFollowUpSessionRecord(item);
    if (!normalized) continue;
    const prior = byThread.get(normalized.threadId);
    if (!prior || normalized.updatedAt >= prior.updatedAt) byThread.set(normalized.threadId, normalized);
  }
  return [...byThread.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 100);
}

function mergeFollowUpSessions(current: FollowUpSessionRecord[], next: FollowUpSessionRecord[]): FollowUpSessionRecord[] {
  const byThread = new Map<string, FollowUpSessionRecord>();
  for (const session of current) byThread.set(session.threadId, session);
  for (const session of next) {
    const prior = byThread.get(session.threadId);
    byThread.set(session.threadId, prior ? { ...prior, ...session, createdAt: prior.createdAt } : session);
  }
  return [...byThread.values()]
    .sort((left, right) => right.updatedAt - left.updatedAt)
    .slice(0, 100);
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
    case 'task_injected':
    case 'task_acked':
    case 'session_completed':
    case 'session_failed':
    case 'session_disconnected':
    case 'permission_requested':
    case 'permission_resolved':
      return null;
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
  const paneWorkspaceDir = useWorkspaceStore(s => {
    const hostTab = s.tabs.find(candidate => candidate.panes.some(tabPane => tabPane.id === pane.id));
    const hostPane = hostTab?.panes.find(tabPane => tabPane.id === pane.id);
    const paneDir = typeof hostPane?.data?.workspaceDir === 'string' ? hostPane.data.workspaceDir.trim() : '';
    if (hostPane?.data?.dockExpandedToTab === true) {
      return hostTab?.workspaceDir || s.workspaceDir || paneDir || null;
    }
    return paneDir || hostTab?.workspaceDir || s.workspaceDir || null;
  });

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
          workspaceDir: paneWorkspaceDir,
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
          workspaceDir={paneWorkspaceDir}
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
