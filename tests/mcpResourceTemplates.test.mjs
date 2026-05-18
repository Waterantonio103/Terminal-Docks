import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ResourceTemplate } from '../mcp-server/node_modules/@modelcontextprotocol/sdk/dist/esm/server/mcp.js';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-mcp-resources-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';

const { registerResources } = await import('../mcp-server/src/resources/index.mjs');
const { db } = await import('../mcp-server/src/db/index.mjs');

try {
  const registrations = [];
  const fakeServer = {
    registerResource(name, uriOrTemplate, metadata, readCallback) {
      registrations.push({ name, uriOrTemplate, metadata, readCallback });
    },
  };

  registerResources(fakeServer);

  for (const name of ['mission', 'node', 'artifact']) {
    const registration = registrations.find(item => item.name === name);
    assert.ok(registration, `${name} resource should be registered`);
    assert.equal(registration.uriOrTemplate instanceof ResourceTemplate, true);
  }

  console.log('PASS MCP dynamic resources use ResourceTemplate registrations');
} finally {
  try { db.close(); } catch {}
  rmSync(tempRoot, { recursive: true, force: true });
}
