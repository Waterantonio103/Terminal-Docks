import { useMemo } from 'react';
import { writeText } from '@tauri-apps/plugin-clipboard-manager';
import type { FatalErrorReport } from '../../lib/diagnostics';

export function FatalErrorOverlay(props: { report: FatalErrorReport; onDismiss: () => void }) {
  const { report, onDismiss } = props;

  const text = useMemo(() => {
    const lines: string[] = [];
    lines.push(`[${new Date(report.ts).toISOString()}] ${report.kind}`);
    if (report.url) lines.push(`url: ${report.url}`);
    lines.push(report.message);
    if (report.stack) lines.push(report.stack);
    if (report.breadcrumbs?.length) {
      lines.push('');
      lines.push('breadcrumbs:');
      for (const crumb of report.breadcrumbs) {
        const when = new Date(crumb.ts).toISOString();
        const data = crumb.data ? ` ${JSON.stringify(crumb.data)}` : '';
        lines.push(`- ${when} ${crumb.label}${data}`);
      }
    }
    return lines.join('\n');
  }, [report]);

  return (
    <div className="absolute inset-0 z-[9999] bg-black/80 backdrop-blur-sm flex items-center justify-center p-4">
      <div className="w-full max-w-3xl bg-bg-panel border border-red-500/40 rounded-xl shadow-2xl overflow-hidden">
        <div className="px-4 py-3 border-b border-border-panel bg-bg-titlebar flex items-center justify-between">
          <div className="text-xs font-semibold text-red-300 uppercase tracking-wider">UI Error Captured</div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => writeText(text).catch(() => {})}
              className="px-3 py-1.5 text-[11px] border border-border-panel rounded text-text-muted hover:text-text-primary"
            >
              Copy Details
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-3 py-1.5 text-[11px] bg-red-500/90 text-white rounded font-semibold"
            >
              Reload
            </button>
            <button
              onClick={onDismiss}
              className="px-3 py-1.5 text-[11px] border border-border-panel rounded text-text-muted hover:text-text-primary"
            >
              Dismiss
            </button>
          </div>
        </div>

        <div className="p-4 space-y-3 max-h-[70vh] overflow-auto custom-scrollbar">
          <div className="text-[11px] text-text-muted">
            If the app “blanks out” from a JS/runtime error, this overlay should appear instead. Copy the details and paste them here.
          </div>
          <pre className="text-[11px] whitespace-pre-wrap break-words bg-bg-surface border border-border-panel rounded-lg p-3 text-text-primary">{text}</pre>
        </div>
      </div>
    </div>
  );
}

