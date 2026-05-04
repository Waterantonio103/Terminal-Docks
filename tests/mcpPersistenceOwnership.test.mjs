import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import {
  MCP_PERSISTENCE_OWNER,
  MCP_REQUIRED_TABLES,
  createMcpPersistence,
} from '../mcp-server/persistence.mjs';

const root = resolve(import.meta.dirname, '..');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run('mcp server is a persistence facade, not a schema owner', () => {
  const serverSource = readFileSync(resolve(root, 'mcp-server/server.mjs'), 'utf8');
  assert.match(serverSource, /createMcpPersistence/);
  assert.doesNotMatch(serverSource, /better-sqlite3/);
  assert.doesNotMatch(serverSource, /new\s+Database/);
  assert.doesNotMatch(serverSource, /CREATE\s+TABLE/i);
  assert.doesNotMatch(serverSource, /ALTER\s+TABLE/i);
  assert.doesNotMatch(serverSource, /\bdb\.(prepare|exec)\s*\(/);
  assert.match(serverSource, /createMcpServiceStore/);
});

run('mcp protocol delegates sql to grouped service responsibilities', () => {
  const serverSource = readFileSync(resolve(root, 'mcp-server/server.mjs'), 'utf8');
  const serviceSource = readFileSync(resolve(root, 'mcp-server/services.mjs'), 'utf8');

  for (const group of [
    'missions',
    'taskInbox',
    'runtimeSessions',
    'agentRuns',
    'fileLocks',
    'workspaceContext',
    'adapters',
    'compatibility',
  ]) {
    assert.match(serviceSource, new RegExp(`'${group}'`), `missing service group ${group}`);
  }

  assert.match(serviceSource, /db\.(prepare|exec)\s*\(/);
  assert.match(serverSource, /services\.createTask/);
  assert.match(serverSource, /services\.upsertRuntimeSession/);
  assert.match(serverSource, /services\.upsertWorkspaceContext/);
  assert.match(serverSource, /services\.upsertFileLock/);
});

run('rust db module declares every canonical MCP table', () => {
  const dbSource = readFileSync(resolve(root, MCP_PERSISTENCE_OWNER.canonical), 'utf8');
  for (const tableName of MCP_REQUIRED_TABLES) {
    assert.match(
      dbSource,
      new RegExp(`CREATE TABLE IF NOT EXISTS ${tableName}\\b`),
      `missing canonical table ${tableName}`,
    );
  }
});

run('standalone MCP compatibility bootstrap creates the required schema', () => {
  const { db } = createMcpPersistence({
    serverDir: resolve(root, 'mcp-server'),
    dbPath: ':memory:',
    schemaOwner: 'compatibility',
  });

  const rows = db.prepare("SELECT name FROM sqlite_master WHERE type = 'table'").all();
  const tableNames = new Set(rows.map(row => row.name));
  for (const tableName of MCP_REQUIRED_TABLES) {
    assert.equal(tableNames.has(tableName), true, `missing compatibility table ${tableName}`);
  }

  const runtimeColumns = new Set(
    db.prepare('PRAGMA table_info(agent_runtime_sessions)').all().map(row => row.name),
  );
  assert.equal(runtimeColumns.has('run_id'), true);

  const adapterColumns = new Set(
    db.prepare('PRAGMA table_info(adapter_registrations)').all().map(row => row.name),
  );
  assert.equal(adapterColumns.has('adapter_id'), true);
  assert.equal(adapterColumns.has('lifecycle'), true);

  db.close();
});

run('backend-owned mode verifies instead of bootstrapping schema', () => {
  assert.throws(
    () => createMcpPersistence({
      serverDir: resolve(root, 'mcp-server'),
      dbPath: ':memory:',
      schemaOwner: 'backend',
    }),
    /missing canonical tables/,
  );
});
