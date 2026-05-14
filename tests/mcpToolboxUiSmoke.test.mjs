import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const page = readFileSync(resolve(root, 'src/components/McpToolbox/McpToolboxPage.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8');

function includesAll(source, values) {
  for (const value of values) assert.ok(source.includes(value), `missing ${value}`);
}

includesAll(page, [
  'Remote HTTP/SSE MCP',
  'Stdio MCP command',
  'Managed local MCP',
  'Trust public URL',
  'Bearer token',
  'Headers JSON',
  'Call timeout ms',
  'Probe Port',
  '/internal/mcp-sources/probe',
  'Default arguments',
  '/internal/mcp-tool-approvals',
  '/restore',
  'Filter MCP events by source',
  'Resources',
  'listStarlinkResources',
]);

includesAll(css, [
  '.td-mcp-call-feed-header select',
  '.td-mcp-config-body textarea',
  '.td-mcp-prober',
  '.td-mcp-probe-result',
  '.td-mcp-call button',
]);

console.log('PASS MCP Toolbox UI smoke exposes source, auth, approval, restore, and event-filter controls');
