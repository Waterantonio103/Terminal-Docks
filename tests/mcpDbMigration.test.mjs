import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import Database from '../mcp-server/node_modules/better-sqlite3/lib/index.js';

const tempDir = mkdtempSync(join(tmpdir(), 'td-mcp-db-'));
const dbPath = join(tempDir, 'tasks.db');

try {
  const oldDb = new Database(dbPath);
  oldDb.exec(`
    CREATE TABLE agent_runtime_sessions (
      session_id TEXT PRIMARY KEY,
      agent_id TEXT NOT NULL,
      mission_id TEXT NOT NULL,
      node_id TEXT NOT NULL,
      attempt INTEGER NOT NULL,
      terminal_id TEXT NOT NULL,
      status TEXT NOT NULL,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE artifacts (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      node_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content_text TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
  `);
  oldDb.close();

  process.env.MCP_DB_PATH = dbPath;
  const { db, initDb } = await import(`../mcp-server/src/db/index.mjs?migration=${Date.now()}`);
  initDb();

  const columns = new Set(db.prepare('PRAGMA table_info(artifacts)').all().map(row => row.name));
  for (const column of ['session_id', 'content_uri', 'content_json', 'updated_at']) {
    assert.ok(columns.has(column), `artifacts migration should add ${column}`);
  }

  const runtimeColumns = new Set(db.prepare('PRAGMA table_info(agent_runtime_sessions)').all().map(row => row.name));
  for (const column of ['run_id', 'started_at', 'ended_at', 'failure_reason']) {
    assert.ok(runtimeColumns.has(column), `runtime session migration should add ${column}`);
  }

  db.prepare(
    `INSERT INTO artifacts
       (id, mission_id, node_id, session_id, kind, title, content_text, content_json, metadata_json)
     VALUES
       ('artifact-1', 'mission-1', 'node-1', 'session-1', 'summary', 'Summary', 'ok', '{"ok":true}', '{}')`,
  ).run();

  const row = db.prepare('SELECT session_id, content_json FROM artifacts WHERE id = ?').get('artifact-1');
  assert.equal(row.session_id, 'session-1');
  assert.equal(row.content_json, '{"ok":true}');

  db.close();
  console.log('PASS MCP DB migration keeps artifacts compatible');
} finally {
  rmSync(tempDir, { recursive: true, force: true });
}
