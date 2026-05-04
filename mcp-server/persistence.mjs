import { mkdirSync } from 'fs';
import { dirname, resolve } from 'path';
import Database from 'better-sqlite3';

export const MCP_PERSISTENCE_OWNER = Object.freeze({
  canonical: 'backend/src/db.rs',
  compatibility: 'mcp-server/persistence.mjs',
  note: 'Rust owns app schema creation. The MCP server only bootstraps this compatibility schema when it is imported or run standalone.',
});

export const MCP_REQUIRED_TABLES = Object.freeze([
  'tasks',
  'file_locks',
  'session_log',
  'workspace_context',
  'compiled_missions',
  'mission_node_runtime',
  'agent_runtime_sessions',
  'agent_runs',
  'mission_timeline',
  'task_pushes',
  'adapter_registrations',
]);

const COMPATIBILITY_SCHEMA_SQL = `
  CREATE TABLE IF NOT EXISTS tasks (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    title TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'todo',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    parent_id INTEGER,
    agent_id TEXT,
    from_role TEXT,
    target_role TEXT,
    payload TEXT,
    mission_id TEXT,
    node_id TEXT,
    FOREIGN KEY(parent_id) REFERENCES tasks(id)
  );
  CREATE TABLE IF NOT EXISTS file_locks (
    file_path TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    locked_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS session_log (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    session_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    content TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    mission_id TEXT,
    node_id TEXT,
    recipient_node_id TEXT,
    is_read BOOLEAN DEFAULT 0
  );
  CREATE TABLE IF NOT EXISTS workspace_context (
    key TEXT PRIMARY KEY,
    value TEXT,
    updated_by TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS compiled_missions (
    mission_id TEXT PRIMARY KEY,
    graph_id TEXT NOT NULL,
    mission_json TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'active',
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS mission_node_runtime (
    mission_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    role_id TEXT NOT NULL,
    status TEXT NOT NULL,
    attempt INTEGER NOT NULL DEFAULT 0,
    current_wave_id TEXT,
    last_outcome TEXT,
    last_payload TEXT,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (mission_id, node_id)
  );
  CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
    session_id TEXT PRIMARY KEY,
    agent_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    terminal_id TEXT NOT NULL,
    run_id TEXT,
    status TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS agent_runs (
    run_id TEXT PRIMARY KEY,
    mission_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    attempt INTEGER NOT NULL,
    session_id TEXT NOT NULL,
    agent_id TEXT NOT NULL,
    cli TEXT NOT NULL,
    execution_mode TEXT NOT NULL,
    cwd TEXT,
    command TEXT NOT NULL,
    args_json TEXT NOT NULL,
    env_json TEXT NOT NULL,
    prompt_path TEXT,
    stdout_path TEXT,
    stderr_path TEXT,
    transcript_path TEXT,
    status TEXT NOT NULL,
    exit_code INTEGER,
    error TEXT,
    started_at DATETIME,
    completed_at DATETIME,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS mission_timeline (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    mission_id TEXT NOT NULL,
    event_type TEXT NOT NULL,
    payload TEXT,
    run_version INTEGER,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE TABLE IF NOT EXISTS task_pushes (
    session_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    task_seq INTEGER NOT NULL,
    attempt INTEGER,
    pushed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    acked_at DATETIME,
    PRIMARY KEY (session_id, mission_id, node_id, task_seq)
  );
  CREATE TABLE IF NOT EXISTS adapter_registrations (
    adapter_id TEXT PRIMARY KEY,
    session_id TEXT NOT NULL,
    terminal_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    mission_id TEXT NOT NULL,
    role TEXT NOT NULL,
    cli TEXT NOT NULL,
    cwd TEXT,
    lifecycle TEXT NOT NULL DEFAULT 'registered',
    registered_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
  );
  CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_mission_node_attempt
    ON agent_runtime_sessions (mission_id, node_id, attempt);
  CREATE INDEX IF NOT EXISTS idx_agent_runs_mission_id
    ON agent_runs (mission_id, created_at);
  CREATE INDEX IF NOT EXISTS idx_mission_timeline_mission_id
    ON mission_timeline (mission_id, id);
`;

function addColumnIfMissing(db, tableName, columnSpec) {
  try {
    db.exec(`ALTER TABLE ${tableName} ADD COLUMN ${columnSpec}`);
  } catch (error) {
    if (!String(error).includes('duplicate column')) throw error;
  }
}

export function ensureMcpCompatibilitySchema(db) {
  db.exec(COMPATIBILITY_SCHEMA_SQL);

  for (const col of ['from_role TEXT', 'target_role TEXT', 'payload TEXT', 'mission_id TEXT', 'node_id TEXT']) {
    addColumnIfMissing(db, 'tasks', col);
  }

  for (const col of ['mission_id TEXT', 'node_id TEXT', 'recipient_node_id TEXT', 'is_read BOOLEAN DEFAULT 0']) {
    addColumnIfMissing(db, 'session_log', col);
  }

  addColumnIfMissing(db, 'agent_runtime_sessions', 'run_id TEXT');
}

export function verifyCanonicalSchema(db) {
  const rows = db.prepare(
    "SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (" +
      MCP_REQUIRED_TABLES.map(() => '?').join(',') +
      ')'
  ).all(...MCP_REQUIRED_TABLES);
  const present = new Set(rows.map(row => row.name));
  const missing = MCP_REQUIRED_TABLES.filter(table => !present.has(table));
  if (missing.length > 0) {
    throw new Error(
      `MCP database is missing canonical tables: ${missing.join(', ')}. ` +
      `Run the Rust backend schema owner (${MCP_PERSISTENCE_OWNER.canonical}) before starting MCP with MCP_SCHEMA_OWNER=backend.`
    );
  }
}

export function createMcpPersistence({
  serverDir,
  dbPath = process.env.MCP_DB_PATH || resolve(serverDir, '../.mcp/tasks.db'),
  schemaOwner = process.env.MCP_SCHEMA_OWNER || 'compatibility',
} = {}) {
  if (dbPath !== ':memory:') {
    try {
      mkdirSync(dirname(dbPath), { recursive: true });
    } catch {
      // Directory creation is best-effort; sqlite will report an open error.
    }
  }

  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');

  if (schemaOwner === 'backend') {
    verifyCanonicalSchema(db);
  } else {
    ensureMcpCompatibilitySchema(db);
  }

  return { db, dbPath, schemaOwner };
}
