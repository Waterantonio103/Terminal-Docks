import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const store = readFileSync(resolve(root, 'src/store/workspace.ts'), 'utf8');
const previewUrl = readFileSync(resolve(root, 'src/lib/previewUrl.ts'), 'utf8');

assert.ok(previewUrl.includes('export function previewUrlEquals'), 'preview URL equality helper should be exported');
assert.ok(store.includes("import { normalizePreviewUrl, previewUrlEquals }"), 'workspace store should normalize preview URLs at the state boundary');
assert.ok(store.includes('function normalizePreviewPaneData'), 'workspace store should normalize preview pane data before storing it');
assert.ok(store.includes('const normalizedUrl = normalizePreviewUrl(nextData.url);'), 'preview pane data should normalize requested URLs once at the state boundary');
assert.ok(store.includes('delete nextData.url;'), 'invalid preview URLs should be dropped from pane data instead of stored as empty strings');
assert.ok(store.includes('const newData = paneDataForType(state, p.type, p.data);'), 'saved layout restore should normalize pane data by pane type');
assert.ok(store.includes('function matchingPreviewPane'), 'workspace store should centralize preview pane matching');
assert.ok(store.includes('function reusePreviewPaneState'), 'workspace store should centralize preview pane reuse updates');
assert.ok(store.includes("const existingPreview = type === 'preview' ? matchingPreviewPane(panes, previewData) : null;"), 'preview pane adds should check normalized URL data before creating a pane');
assert.ok(store.includes("p.type === 'preview' && previewUrlEquals(p.data?.url, previewData.url)"), 'preview pane adds should reuse matching preview URLs');
assert.ok(store.includes('const nextTitle = cleanPaneTitle(title, existingPreview.title);'), 'preview pane reuse should clean the requested title');
assert.ok(store.includes("? { ...p, title: nextTitle, data: { ...p.data, ...previewData } }"), 'preview pane reuse should store the normalized requested URL');
assert.ok(store.includes('activePaneId: existingPreview.id'), 'matching preview panes should be activated instead of duplicated');
assert.ok(store.indexOf('addPaneAt: (type, title, index, data)') < store.lastIndexOf("const existingPreview = type === 'preview' ? matchingPreviewPane(panes, previewData) : null;"), 'positioned pane adds should also dedupe preview URLs');

console.log('PASS workspace preview panes dedupe equivalent preview URLs');
