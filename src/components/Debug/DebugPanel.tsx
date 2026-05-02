import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { invoke } from '@tauri-apps/api/core';
import { Bug, Clipboard, FileText, History, Loader2, Play, ShieldCheck, TerminalSquare } from 'lucide-react';
import { buildCodexInteractiveLaunchArgs, resolveCodexYoloFlag } from '../../lib/cliCommandBuilders';
import { generateId } from '../../lib/graphUtils';
import { missionRepository } from '../../lib/missionRepository';
import { terminalOutputBus } from '../../lib/runtime/TerminalOutputBus';
import {
  useWorkspaceStore,
  type DebugRunHistoryItem,
  type DebugSessionTab,
} from '../../store/workspace';

type DebugMode = 'diagnose' | 'propose' | 'autopatch';
type DebugSuite = 'simple_workflows' | 'consecutive_runs' | 'mcp_handshake';

interface DebugRunEvent {
  id: number;
  eventType: string;
  payload?: unknown;
  createdAt?: string;
}

interface DebugRunResponse {
  debugRun?: {
    id: string;
    status: string;
    updatedAt?: string;
  };
  events?: DebugRunEvent[];
}

const MIN_WIDTH = 280;
const MAX_WIDTH = 720;
const ACTIVE_POLL_MS = 1500;
const IDLE_POLL_MS = 5000;

function buildCodexDebugPrompt(options: {
  debugRunId: string;
  suiteName: DebugSuite;
  mode: DebugMode;
  workspaceDir: string | null;
}): string {
  const modeInstructions = {
    diagnose: 'Diagnose only. Do not modify files. Write a debug report with evidence, suspected causes, and next actions.',
    propose: 'If you find a likely code fix, create a patch proposal with debug_create_patch_proposal, but do not apply it.',
    autopatch: 'You may apply scoped fixes through Debug MCP guardrails, then run verification checks and write the final report.',
  } satisfies Record<DebugMode, string>;

  return [
    'You are a Terminal Docks Codex debug agent running inside the app.',
    'Use the Terminal Docks MCP tools directly. Do not ask the user to run separate commands unless a hard blocker requires it.',
    `Debug run id: ${options.debugRunId}`,
    `Suite: ${options.suiteName}`,
    `Mode: ${options.mode}`,
    options.workspaceDir ? `Workspace: ${options.workspaceDir}` : null,
    '',
    'Workflow:',
    `1. Call debug_get_run({ debugRunId: "${options.debugRunId}", includeEvents: true }).`,
    `2. Call debug_run_suite({ debugRunId: "${options.debugRunId}", suiteName: "${options.suiteName}" }).`,
    '3. Inspect failures using debug_get_recent_runtime_logs, debug_get_workflow_events, debug_get_terminal_tail, debug_search_logs, debug_search_code, and debug_read_file as needed.',
    `4. ${modeInstructions[options.mode]}`,
    '5. Write the final report with debug_write_report using completed, failed, or blocked status.',
    '',
    'Keep your terminal output concise but explicit about which debug tool you are calling and what you learned.',
  ].filter((line): line is string => line != null).join('\n');
}

function parseToolJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

function clampWidth(width: number): number {
  return Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, Math.round(width)));
}

function formatPayload(payload: unknown): string {
  if (payload == null) return '';
  if (typeof payload === 'string') return payload;
  try {
    return JSON.stringify(payload);
  } catch {
    return String(payload);
  }
}

function formatRunEvents(events: DebugRunEvent[] = []): string {
  if (!events.length) return '';
  return events.map(event => {
    const time = event.createdAt ? `[${event.createdAt}]` : '[debug]';
    const payload = formatPayload(event.payload);
    return payload ? `${time} ${event.eventType} ${payload}` : `${time} ${event.eventType}`;
  }).join('\n');
}

function statusTone(status: string): string {
  if (status === 'completed' || status === 'passed') return 'border-emerald-400/30 text-emerald-200 bg-emerald-500/10';
  if (status === 'failed' || status === 'blocked') return 'border-red-400/30 text-red-200 bg-red-500/10';
  if (status === 'running' || status === 'created') return 'border-accent-primary/40 text-accent-primary bg-accent-primary/10';
  return 'border-border-panel text-text-muted bg-bg-surface';
}

function runLabel(run: DebugRunHistoryItem): string {
  const time = new Date(run.startedAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  return `${time} ${run.suiteName}`;
}

export function DebugPanel() {
  const [suiteName, setSuiteName] = useState<DebugSuite>('simple_workflows');
  const [mode, setMode] = useState<DebugMode>('diagnose');
  const [running, setRunning] = useState(false);
  const [selectedRunId, setSelectedRunId] = useState<string | null>(null);
  const [activeTerminalId, setActiveTerminalId] = useState<string | null>(null);
  const [durableTextByTerminal, setDurableTextByTerminal] = useState<Record<string, string>>({});
  const [ptyTextByTerminal, setPtyTextByTerminal] = useState<Record<string, string>>({});
  const [runTextByRunId, setRunTextByRunId] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [autoFollow, setAutoFollow] = useState(true);
  const [resizing, setResizing] = useState<{ startX: number; startWidth: number } | null>(null);
  const outputRef = useRef<HTMLDivElement | null>(null);

  const debugSidebarWidth = useWorkspaceStore((s) => s.debugSidebarWidth);
  const setDebugSidebarWidth = useWorkspaceStore((s) => s.setDebugSidebarWidth);
  const debugRunHistory = useWorkspaceStore((s) => s.debugRunHistory);
  const upsertDebugRunHistory = useWorkspaceStore((s) => s.upsertDebugRunHistory);
  const workspaceDir = useWorkspaceStore((s) => s.workspaceDir);

  const selectedRun = useMemo(
    () => debugRunHistory.find(run => run.debugRunId === selectedRunId) ?? debugRunHistory[0] ?? null,
    [debugRunHistory, selectedRunId],
  );

  const activeSession = useMemo(() => {
    if (!selectedRun) return null;
    return selectedRun.sessions.find(session => session.terminalId === activeTerminalId) ?? selectedRun.sessions[0] ?? null;
  }, [activeTerminalId, selectedRun]);

  const activeOutput = useMemo(() => {
    if (!selectedRun) return '';
    if (!activeSession) return runTextByRunId[selectedRun.debugRunId] ?? '';
    const ptyText = ptyTextByTerminal[activeSession.terminalId] ?? '';
    return ptyText || durableTextByTerminal[activeSession.terminalId] || runTextByRunId[selectedRun.debugRunId] || '';
  }, [activeSession, durableTextByTerminal, ptyTextByTerminal, runTextByRunId, selectedRun]);

  const activeSource = activeSession && ptyTextByTerminal[activeSession.terminalId]
    ? 'PTY'
    : activeSession
      ? 'Events'
      : 'Run';

  useEffect(() => {
    if (!selectedRunId && debugRunHistory[0]) {
      setSelectedRunId(debugRunHistory[0].debugRunId);
    }
  }, [debugRunHistory, selectedRunId]);

  useEffect(() => {
    if (!selectedRun) return;
    if (!activeTerminalId || !selectedRun.sessions.some(session => session.terminalId === activeTerminalId)) {
      setActiveTerminalId(selectedRun.sessions[0]?.terminalId ?? null);
      setAutoFollow(true);
    }
  }, [activeTerminalId, selectedRun]);

  useEffect(() => {
    if (!autoFollow) return;
    const output = outputRef.current;
    if (!output) return;
    output.scrollTop = output.scrollHeight;
  }, [activeOutput, autoFollow, activeTerminalId, selectedRunId]);

  useEffect(() => {
    if (!selectedRun?.sessions.length) return;
    const disposers = selectedRun.sessions.map(session => {
      const existing = terminalOutputBus.getText(session.terminalId);
      if (existing) {
        setPtyTextByTerminal(previous => ({ ...previous, [session.terminalId]: existing }));
      }
      return terminalOutputBus.subscribe(session.terminalId, chunk => {
        setPtyTextByTerminal(previous => ({
          ...previous,
          [session.terminalId]: `${previous[session.terminalId] ?? ''}${chunk.text}`,
        }));
      });
    });
    return () => {
      disposers.forEach(dispose => dispose());
    };
  }, [selectedRun?.debugRunId, selectedRun?.sessions]);

  useEffect(() => {
    if (!selectedRun) return;
    let cancelled = false;
    const isActive = selectedRun.status === 'created' || selectedRun.status === 'running';

    async function refreshRunEvidence() {
      try {
        const runResponse = parseToolJson<DebugRunResponse>(
          await missionRepository.invokeMcp('debug_get_run', {
            debugRunId: selectedRun!.debugRunId,
            includeEvents: true,
            eventLimit: 100,
          }),
        );
        if (cancelled) return;
        setRunTextByRunId(previous => ({
          ...previous,
          [selectedRun!.debugRunId]: formatRunEvents(runResponse.events),
        }));
        if (runResponse.debugRun?.status && runResponse.debugRun.status !== selectedRun!.status) {
          upsertDebugRunHistory({
            ...selectedRun!,
            status: runResponse.debugRun.status,
            updatedAt: Date.now(),
          });
        }

        const tails = await Promise.all(selectedRun!.sessions.map(async session => {
          const response = parseToolJson<{ tail?: string }>(
            await missionRepository.invokeMcp('debug_get_terminal_tail', {
              debugRunId: selectedRun!.debugRunId,
              terminalId: session.terminalId,
              maxChars: 64000,
            }),
          );
          return [session.terminalId, response.tail ?? ''] as const;
        }));
        if (cancelled) return;
        setDurableTextByTerminal(previous => {
          const next = { ...previous };
          for (const [terminalId, tail] of tails) next[terminalId] = tail;
          return next;
        });
      } catch (err) {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      }
    }

    void refreshRunEvidence();
    const intervalId = window.setInterval(refreshRunEvidence, isActive ? ACTIVE_POLL_MS : IDLE_POLL_MS);
    return () => {
      cancelled = true;
      window.clearInterval(intervalId);
    };
  }, [selectedRun?.debugRunId, selectedRun?.sessions, selectedRun?.status, upsertDebugRunHistory]);

  useEffect(() => {
    if (!resizing) return;
    const resizeStart = resizing;
    function onMouseMove(event: MouseEvent) {
      setDebugSidebarWidth(clampWidth(resizeStart.startWidth - (event.clientX - resizeStart.startX)));
    }
    function onMouseUp() {
      setResizing(null);
    }
    window.addEventListener('mousemove', onMouseMove);
    window.addEventListener('mouseup', onMouseUp);
    return () => {
      window.removeEventListener('mousemove', onMouseMove);
      window.removeEventListener('mouseup', onMouseUp);
    };
  }, [resizing, setDebugSidebarWidth]);

  const upsertRun = useCallback((item: DebugRunHistoryItem) => {
    upsertDebugRunHistory({ ...item, updatedAt: Date.now() });
  }, [upsertDebugRunHistory]);

  async function resolveMcpUrl(): Promise<string> {
    try {
      return await invoke<string>('get_mcp_url');
    } catch {
      try {
        return `${await invoke<string>('get_mcp_base_url')}/mcp`;
      } catch {
        return 'http://localhost:3741/mcp';
      }
    }
  }

  async function startDebugRun() {
    setRunning(true);
    setError(null);
    let historyItem: DebugRunHistoryItem | null = null;
    try {
      const start = parseToolJson<{ debugRunId: string; status: string }>(
        await missionRepository.invokeMcp('debug_start_run', {
          suiteName,
          autonomyMode: mode,
          requireConfirmation: mode !== 'autopatch',
        }),
      );

      const startedAt = Date.now();
      historyItem = {
        debugRunId: start.debugRunId,
        suiteName,
        mode,
        status: start.status,
        startedAt,
        updatedAt: startedAt,
        lastMessage: 'Debug run created.',
        sessions: [],
      };
      upsertRun(historyItem);
      setSelectedRunId(start.debugRunId);
      setAutoFollow(true);

      const terminalId = `debug-codex-${generateId()}`;
      const mcpUrl = await resolveMcpUrl();
      const resolvedYoloFlag = mode === 'autopatch' ? await resolveCodexYoloFlag() : null;
      const prompt = buildCodexDebugPrompt({
        debugRunId: start.debugRunId,
        suiteName,
        mode,
        workspaceDir,
      });
      const args = buildCodexInteractiveLaunchArgs({
        mcpUrl,
        workspaceDir,
        bootstrapPrompt: prompt,
        yolo: mode === 'autopatch',
        resolvedYoloFlag,
      });
      await invoke<boolean>('spawn_pty_with_command', {
        id: terminalId,
        rows: 28,
        cols: 100,
        cwd: workspaceDir,
        command: 'codex',
        args,
        env: null,
      });

      const sessions: DebugSessionTab[] = [{
        terminalId,
        missionId: start.debugRunId,
        nodeId: 'codex-debug-agent',
        label: 'Codex debug agent',
        cli: 'codex',
      }];
      historyItem = {
        ...historyItem,
        status: 'running',
        sessions,
        lastMessage: 'Codex debug agent launched. Watch this tab for MCP tool calls and patch work.',
      };
      upsertRun(historyItem);
      setActiveTerminalId(terminalId);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      setError(message);
      if (historyItem) {
        upsertRun({
          ...historyItem,
          status: 'failed',
          lastMessage: 'Debug run failed.',
        });
      }
    } finally {
      setRunning(false);
    }
  }

  function handleOutputScroll() {
    const output = outputRef.current;
    if (!output) return;
    const distanceFromBottom = output.scrollHeight - output.scrollTop - output.clientHeight;
    setAutoFollow(distanceFromBottom < 24);
  }

  async function copyActiveOutput() {
    if (!activeOutput) return;
    await navigator.clipboard?.writeText(activeOutput);
  }

  return (
    <aside
      className="relative shrink-0 border-l border-border-panel bg-bg-titlebar flex flex-col overflow-hidden"
      style={{ width: debugSidebarWidth }}
    >
      <button
        type="button"
        aria-label="Resize Debug MCP sidebar"
        className={`absolute left-0 top-0 z-20 h-full w-1 cursor-col-resize bg-transparent hover:bg-accent-primary/40 ${resizing ? 'bg-accent-primary/50' : ''}`}
        onMouseDown={event => {
          event.preventDefault();
          setResizing({ startX: event.clientX, startWidth: debugSidebarWidth });
        }}
      />

      <div className="px-3 py-3 border-b border-border-panel shrink-0">
        <div className="flex items-center justify-between gap-2">
          <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-accent-primary font-semibold">
            <Bug size={14} />
            Debug MCP
          </div>
          <span className={`shrink-0 text-[9px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${statusTone(selectedRun?.status ?? 'idle')}`}>
            {selectedRun?.status ?? 'idle'}
          </span>
        </div>
      </div>

      <div className="p-3 border-b border-border-panel shrink-0 space-y-3">
        <div className="grid grid-cols-2 gap-2">
          <label className="block space-y-1 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">Suite</span>
            <select
              value={suiteName}
              onChange={event => setSuiteName(event.target.value as DebugSuite)}
              className="w-full bg-bg-surface border border-border-panel rounded px-2 py-1.5 text-[11px] text-text-primary"
            >
              <option value="simple_workflows">Simple workflows</option>
              <option value="consecutive_runs">Consecutive runs</option>
              <option value="mcp_handshake">MCP handshake</option>
            </select>
          </label>

          <label className="block space-y-1 min-w-0">
            <span className="text-[10px] uppercase tracking-wide text-text-muted">Mode</span>
            <select
              value={mode}
              onChange={event => setMode(event.target.value as DebugMode)}
              className="w-full bg-bg-surface border border-border-panel rounded px-2 py-1.5 text-[11px] text-text-primary"
            >
              <option value="diagnose">Diagnose</option>
              <option value="propose">Propose</option>
              <option value="autopatch">Autopatch</option>
            </select>
          </label>
        </div>

        <div className="rounded border border-border-panel bg-bg-panel px-2 py-2 text-[10px] text-text-muted leading-relaxed">
          <div className="flex items-center gap-1.5 text-text-secondary font-semibold mb-1">
            <ShieldCheck size={11} />
            Safe scope
          </div>
          Debug missions are tagged separately and use MCP guardrails for patching and checks.
        </div>

        <button
          type="button"
          onClick={() => void startDebugRun()}
          disabled={running}
          className="w-full inline-flex items-center justify-center gap-2 rounded border border-accent-primary bg-accent-primary/10 px-3 py-2 text-[11px] font-semibold text-accent-primary hover:bg-accent-primary/15 disabled:opacity-50 disabled:cursor-not-allowed"
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <Play size={13} />}
          Run Debug Suite
        </button>
      </div>

      <div className="px-3 py-2 border-b border-border-panel shrink-0 space-y-2">
        <label className="block space-y-1">
          <span className="flex items-center gap-1.5 text-[10px] uppercase tracking-wide text-text-muted">
            <History size={11} />
            Run history
          </span>
          <select
            value={selectedRun?.debugRunId ?? ''}
            onChange={event => {
              setSelectedRunId(event.target.value || null);
              setActiveTerminalId(null);
              setAutoFollow(true);
            }}
            className="w-full bg-bg-surface border border-border-panel rounded px-2 py-1.5 text-[11px] text-text-primary"
          >
            {debugRunHistory.length === 0 && <option value="">No debug runs</option>}
            {debugRunHistory.map(run => (
              <option key={run.debugRunId} value={run.debugRunId}>
                {runLabel(run)} ({run.status})
              </option>
            ))}
          </select>
        </label>

        {selectedRun && (
          <div className="rounded border border-border-panel bg-bg-panel overflow-hidden">
            <div className="px-2 py-2 flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-text-primary font-semibold truncate">{selectedRun.suiteName}</div>
                <div className="text-[10px] text-text-muted truncate">{selectedRun.debugRunId}</div>
              </div>
              <span className={`shrink-0 text-[9px] uppercase tracking-wide border rounded px-1.5 py-0.5 ${statusTone(selectedRun.status)}`}>
                {selectedRun.status}
              </span>
            </div>
            {(selectedRun.lastMessage || selectedRun.reportPath) && (
              <div className="px-2 py-2 border-t border-border-panel space-y-1.5">
                {selectedRun.lastMessage && <div className="text-[11px] text-text-secondary">{selectedRun.lastMessage}</div>}
                {selectedRun.reportPath && (
                  <div className="flex items-start gap-1.5 text-[10px] text-text-muted break-all">
                    <FileText size={11} className="mt-0.5 shrink-0 text-accent-primary" />
                    {selectedRun.reportPath}
                  </div>
                )}
              </div>
            )}
          </div>
        )}
      </div>

      <div className="shrink-0 border-b border-border-panel bg-bg-panel">
        <div className="flex items-center gap-1 overflow-x-auto px-2 py-1.5">
          {selectedRun?.sessions.length ? selectedRun.sessions.map(session => (
            <button
              key={session.terminalId}
              type="button"
              onClick={() => {
                setActiveTerminalId(session.terminalId);
                setAutoFollow(true);
              }}
              className={`shrink-0 max-w-[150px] rounded px-2 py-1 text-[10px] border flex items-center gap-1.5 ${
                activeSession?.terminalId === session.terminalId
                  ? 'border-accent-primary text-accent-primary bg-accent-primary/10'
                  : 'border-border-panel text-text-muted hover:text-text-primary hover:bg-bg-surface'
              }`}
              title={session.terminalId}
            >
              <TerminalSquare size={11} className="shrink-0" />
              <span className="truncate">{session.label}</span>
            </button>
          )) : (
            <div className="px-1 py-1 text-[10px] text-text-muted">Run events</div>
          )}
        </div>
      </div>

      <div className="h-8 px-3 border-b border-border-panel bg-bg-titlebar flex items-center justify-between gap-2 shrink-0">
        <div className="min-w-0 text-[10px] text-text-muted truncate">
          {activeSession ? `${activeSource} ${activeSession.terminalId}` : activeSource}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          <span className={`text-[9px] uppercase tracking-wide ${autoFollow ? 'text-accent-primary' : 'text-text-muted'}`}>
            {autoFollow ? 'Following' : 'Paused'}
          </span>
          <button
            type="button"
            onClick={() => void copyActiveOutput()}
            disabled={!activeOutput}
            title="Copy output"
            className="w-6 h-6 flex items-center justify-center rounded text-text-muted hover:text-text-primary hover:bg-bg-surface disabled:opacity-40"
          >
            <Clipboard size={12} />
          </button>
        </div>
      </div>

      <div
        ref={outputRef}
        onScroll={handleOutputScroll}
        className="flex-1 min-h-0 overflow-auto bg-bg-app p-3 font-mono text-[11px] leading-relaxed text-text-secondary"
      >
        <pre className="whitespace-pre-wrap break-words select-text">
          {activeOutput || (selectedRun ? 'Waiting for debug evidence...' : 'Run a debug suite to stream Codex evidence here.')}
        </pre>
      </div>

      {error && (
        <div className="shrink-0 border-t border-red-400/25 bg-red-500/10 px-3 py-2 text-[11px] text-red-200 break-words">
          {error}
        </div>
      )}
    </aside>
  );
}
