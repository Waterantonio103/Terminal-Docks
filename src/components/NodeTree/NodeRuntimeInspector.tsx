import { ArrowUpRight, Plus, RefreshCw, X } from 'lucide-react';
import type { NodeInstance } from '../../lib/node-system/types';

interface NodeRuntimeInspectorProps {
  nodeId: string;
  node: NodeInstance | null;
  terminalId: string;
  terminalTitle?: string;
  usesPty: boolean;
  runtimeSessionLabel?: string;
  output: string;
  error: string | null;
  command: string;
  onCommandChange: (value: string) => void;
  onClose: () => void;
  onOpenTerminal: () => void;
  onCreateRuntime: () => void;
  onRefreshOutput: () => void;
  onSubmitCommand: () => void;
}

function nodeDisplayLabel(node: NodeInstance | null, fallbackId: string) {
  if (!node) return fallbackId;
  if (node.type === 'workflow.agent') return 'Agent';
  if (node.type === 'workflow.task') return 'Task';
  return node.label ?? node.id ?? fallbackId;
}

export function NodeRuntimeInspector({
  nodeId,
  node,
  terminalId,
  terminalTitle,
  usesPty,
  runtimeSessionLabel,
  output,
  error,
  command,
  onCommandChange,
  onClose,
  onOpenTerminal,
  onCreateRuntime,
  onRefreshOutput,
  onSubmitCommand,
}: NodeRuntimeInspectorProps) {
  return (
    <div
      className="absolute z-40 right-3 top-3 bottom-3 w-[420px] rounded-xl border border-border-panel background-bg-panel shadow-2xl flex flex-col"
      onMouseDown={event => event.stopPropagation()}
    >
      <div className="px-3 py-2 border-b border-border-panel background-bg-titlebar flex items-center justify-between">
        <div className="min-w-0">
          <div className="text-[10px] uppercase tracking-[0.2em] text-accent-primary">Node Runtime Inspector</div>
          <div className="text-[12px] text-text-primary truncate">{nodeDisplayLabel(node, nodeId)}</div>
        </div>
        <div className="flex items-center gap-1">
          {terminalId && usesPty && (
            <button
              type="button"
              onClick={onOpenTerminal}
              className="p-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface"
              title="Open full terminal pane"
            >
              <ArrowUpRight size={12} />
            </button>
          )}
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface"
            title="Close inspector"
          >
            <X size={12} />
          </button>
        </div>
      </div>

      {!node ? (
        <div className="flex-1 flex items-center justify-center text-[12px] text-text-muted px-4 text-center">
          Selected node is no longer available.
        </div>
      ) : !terminalId ? (
        <div className="flex-1 flex flex-col items-center justify-center text-[12px] text-text-muted px-4 text-center gap-3">
          <p>This node has no terminal runtime binding.</p>
          <button
            type="button"
            onClick={onCreateRuntime}
            className="px-2.5 py-1.5 rounded border border-border-panel text-text-muted hover:text-text-primary hover:background-bg-surface text-[11px] inline-flex items-center gap-1"
          >
            <Plus size={11} />
            Create Runtime Binding
          </button>
        </div>
      ) : (
        <>
          <div className="px-3 py-2 border-b border-border-panel text-[10px] text-text-muted flex items-center justify-between gap-2">
            <span className="truncate">
              {terminalTitle ?? terminalId}
              {runtimeSessionLabel ? ` · ${runtimeSessionLabel}` : ''}
            </span>
            {usesPty && (
              <button
                type="button"
                onClick={onRefreshOutput}
                className="inline-flex items-center gap-1 px-2 py-1 rounded border border-border-panel hover:background-bg-surface text-text-muted hover:text-text-primary"
                title="Refresh runtime output"
              >
                <RefreshCw size={11} />
                Refresh
              </button>
            )}
          </div>

          <pre className="flex-1 overflow-auto px-3 py-3 text-[11px] leading-relaxed text-text-secondary whitespace-pre-wrap background-bg-app">
            {output || 'Waiting for runtime output...'}
          </pre>

          {error && (
            <div className="px-3 py-1.5 text-[10px] text-red-200 bg-red-500/10 border-t border-red-400/20">
              {error}
            </div>
          )}

          {usesPty && (
            <form
              className="px-3 py-2 border-t border-border-panel background-bg-titlebar flex gap-2"
              onSubmit={event => {
                event.preventDefault();
                onSubmitCommand();
              }}
            >
              <input
                value={command}
                onChange={event => onCommandChange(event.target.value)}
                placeholder="Send command to runtime"
                className="flex-1 background-bg-surface border border-border-panel rounded px-2 py-1.5 text-[11px] text-text-primary"
              />
              <button
                type="submit"
                disabled={!command.trim()}
                className="px-2.5 py-1.5 rounded border border-accent-primary text-accent-primary hover:bg-accent-primary/10 disabled:opacity-40 disabled:cursor-not-allowed text-[11px]"
              >
                Send
              </button>
            </form>
          )}
        </>
      )}
    </div>
  );
}
