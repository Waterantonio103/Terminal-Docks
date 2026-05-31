import { ExternalLink, RefreshCw } from 'lucide-react';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useState } from 'react';
import type { Pane } from '../../store/workspace';
import { normalizePreviewUrl } from '../../lib/previewUrl';
import { isLocalServerUrl } from '../../lib/localServerDetection';
import { shortWorkspaceServerUrl } from '../../lib/workspaceServerDiscovery';

function cleanPreviewTitle(value: unknown, fallback: string): string {
  const title = typeof value === 'string'
    ? value.replace(/\0/g, '').replace(/\s+/g, ' ').trim()
    : '';
  return title || fallback;
}

function previewDisplayUrl(url: string): string {
  if (isLocalServerUrl(url)) return shortWorkspaceServerUrl(url);
  try {
    const parsed = new URL(url);
    parsed.username = '';
    parsed.password = '';
    return parsed.toString();
  } catch {
    return url;
  }
}

export function PreviewPane({ pane }: { pane: Pane }) {
  const url = normalizePreviewUrl(pane.data?.url);
  const displayUrl = url ? previewDisplayUrl(url) : '';
  const title = cleanPreviewTitle(pane.data?.previewTitle, pane.title);
  const [reloadState, setReloadState] = useState({ url, token: 0 });
  const reloadToken = reloadState.url === url ? reloadState.token : 0;

  if (!url) {
    return (
      <div className="td-preview-empty">
        <div>No preview URL</div>
      </div>
    );
  }

  return (
    <div className="td-preview-pane">
      <div className="td-preview-toolbar">
        <div className="td-preview-address" title={displayUrl}>{displayUrl}</div>
        <button
          type="button"
          onClick={() => setReloadState(state => ({
            url,
            token: state.url === url ? state.token + 1 : 1,
          }))}
          title="Reload preview"
          aria-label="Reload preview"
        >
          <RefreshCw size={13} />
        </button>
        <button type="button" onClick={() => void openUrl(url)} title="Open externally" aria-label="Open preview externally">
          <ExternalLink size={13} />
        </button>
      </div>
      <iframe
        key={`${url}:${reloadToken}`}
        title={title}
        src={url}
        referrerPolicy="no-referrer"
        sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"
      />
    </div>
  );
}

export default PreviewPane;
