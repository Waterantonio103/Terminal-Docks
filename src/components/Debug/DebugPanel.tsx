import { useState } from 'react';
import { Bug, FileText, Loader2, Play, ShieldCheck } from 'lucide-react';
import { missionRepository } from '../../lib/missionRepository';

type DebugMode = 'diagnose' | 'propose' | 'autopatch';
type DebugSuite = 'simple_workflows' | 'consecutive_runs' | 'mcp_handshake';

interface DebugRunView {
  debugRunId: string;
  suiteName: DebugSuite;
  mode: DebugMode;
  status: string;
  reportPath?: string;
  lastMessage?: string;
}

function parseToolJson<T>(raw: string): T {
  return JSON.parse(raw) as T;
}

export function DebugPanel() {
  const [suiteName, setSuiteName] = useState<DebugSuite>('simple_workflows');
  const [mode, setMode] = useState<DebugMode>('diagnose');
  const [running, setRunning] = useState(false);
  const [run, setRun] = useState<DebugRunView | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function startDebugRun() {
    setRunning(true);
    setError(null);
    try {
      const start = parseToolJson<{ debugRunId: string; status: string }>(
        await missionRepository.invokeMcp('debug_start_run', {
          suiteName,
          autonomyMode: mode,
          requireConfirmation: mode !== 'autopatch',
        }),
      );
      setRun({
        debugRunId: start.debugRunId,
        suiteName,
        mode,
        status: start.status,
        lastMessage: 'Debug run created.',
      });

      const suite = parseToolJson<{ status: string; results: Array<{ testName: string; status: string }> }>(
        await missionRepository.invokeMcp('debug_run_suite', {
          debugRunId: start.debugRunId,
          suiteName,
        }),
      );
      setRun(previous => previous
        ? {
            ...previous,
            status: suite.status,
            lastMessage: `${suite.results.length} suite checks finished.`,
          }
        : previous);

      const report = parseToolJson<{ status: string; filePath: string }>(
        await missionRepository.invokeMcp('debug_write_report', {
          debugRunId: start.debugRunId,
          finalStatus: suite.status === 'completed' ? 'completed' : 'failed',
          diagnosis: 'Suite executed from the Terminal Docks debug panel.',
        }),
      );
      setRun(previous => previous
        ? {
            ...previous,
            status: report.status,
            reportPath: report.filePath,
            lastMessage: 'Report written.',
          }
        : previous);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      setRun(previous => previous ? { ...previous, status: 'failed', lastMessage: 'Debug run failed.' } : previous);
    } finally {
      setRunning(false);
    }
  }

  return (
    <aside className="w-80 shrink-0 border-l border-border-panel bg-bg-titlebar flex flex-col overflow-hidden">
      <div className="px-3 py-3 border-b border-border-panel">
        <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.18em] text-accent-primary font-semibold">
          <Bug size={14} />
          Debug MCP
        </div>
        <div className="mt-1 text-[11px] text-text-muted leading-relaxed">
          Runs debug-only workflow checks through the MCP harness.
        </div>
      </div>

      <div className="p-3 space-y-3 overflow-y-auto">
        <label className="block space-y-1">
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

        <label className="block space-y-1">
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

        <div className="rounded border border-border-panel bg-bg-panel px-2 py-2 text-[10px] text-text-muted leading-relaxed">
          <div className="flex items-center gap-1.5 text-text-secondary font-semibold mb-1">
            <ShieldCheck size={11} />
            Safe scope
          </div>
          Debug missions are tagged separately. Autopatch uses MCP guardrails for paths, commands, patch size, and attempt limits.
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

        {run && (
          <div className="rounded border border-border-panel bg-bg-panel overflow-hidden">
            <div className="px-2 py-2 border-b border-border-panel flex items-center justify-between gap-2">
              <div className="min-w-0">
                <div className="text-[11px] text-text-primary font-semibold truncate">{run.suiteName}</div>
                <div className="text-[10px] text-text-muted truncate">{run.debugRunId}</div>
              </div>
              <span className="shrink-0 text-[9px] uppercase tracking-wide border border-border-panel rounded px-1.5 py-0.5 text-text-muted">
                {run.status}
              </span>
            </div>
            <div className="px-2 py-2 space-y-2">
              {run.lastMessage && <div className="text-[11px] text-text-secondary">{run.lastMessage}</div>}
              {run.reportPath && (
                <div className="flex items-start gap-1.5 text-[10px] text-text-muted break-all">
                  <FileText size={11} className="mt-0.5 shrink-0 text-accent-primary" />
                  {run.reportPath}
                </div>
              )}
            </div>
          </div>
        )}

        {error && (
          <div className="rounded border border-red-400/25 bg-red-500/10 px-2 py-2 text-[11px] text-red-200 break-words">
            {error}
          </div>
        )}
      </div>
    </aside>
  );
}
