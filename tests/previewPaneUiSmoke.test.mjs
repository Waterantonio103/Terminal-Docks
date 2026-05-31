import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const previewPane = readFileSync(resolve(root, 'src/components/Preview/PreviewPane.tsx'), 'utf8');

for (const value of [
  "import { normalizePreviewUrl } from '../../lib/previewUrl';",
  "import { isLocalServerUrl } from '../../lib/localServerDetection';",
  "import { shortWorkspaceServerUrl } from '../../lib/workspaceServerDiscovery';",
  'const url = normalizePreviewUrl(pane.data?.url);',
  'function previewDisplayUrl(url: string): string',
  'if (isLocalServerUrl(url)) return shortWorkspaceServerUrl(url);',
  "const displayUrl = url ? previewDisplayUrl(url) : '';",
  'function cleanPreviewTitle(value: unknown, fallback: string): string',
  "value.replace(/\\0/g, '').replace(/\\s+/g, ' ').trim()",
  'const title = cleanPreviewTitle(pane.data?.previewTitle, pane.title);',
  '<div className="td-preview-address" title={displayUrl}>{displayUrl}</div>',
  'title="Reload preview"',
  'aria-label="Reload preview"',
  'title="Open externally"',
  'aria-label="Open preview externally"',
  'referrerPolicy="no-referrer"',
  'sandbox="allow-forms allow-modals allow-pointer-lock allow-popups allow-same-origin allow-scripts"',
]) {
  assert.ok(previewPane.includes(value), `missing preview pane marker: ${value}`);
}

console.log('PASS preview pane exposes accessible reload and external-open controls');
