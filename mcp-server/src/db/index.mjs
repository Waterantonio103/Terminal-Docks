import Database from 'better-sqlite3';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';
import { mkdirSync } from 'fs';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Shared with the Rust process via MCP_DB_PATH env var so both read the same
// tasks.db. Falls back to a local file when running standalone.
const dbPath = process.env.MCP_DB_PATH || resolve(__dirname, '../../../.mcp/tasks.db');
try { mkdirSync(dirname(dbPath), { recursive: true }); } catch {}

export const db = new Database(dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initDb() {
  db.exec(`
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
      locked_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      expires_at DATETIME
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
      status TEXT NOT NULL,
      run_id TEXT,
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
    CREATE TABLE IF NOT EXISTS workflow_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL,
      node_id TEXT,
      session_id TEXT,
      terminal_id TEXT,
      type TEXT NOT NULL,
      severity TEXT NOT NULL DEFAULT 'info',
      message TEXT NOT NULL,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_workflow_events_mission_id ON workflow_events(mission_id, id);
    CREATE TABLE IF NOT EXISTS artifacts (
      id TEXT PRIMARY KEY,
      mission_id TEXT NOT NULL,
      node_id TEXT,
      session_id TEXT,
      kind TEXT NOT NULL,
      title TEXT NOT NULL,
      content_text TEXT,
      content_json TEXT,
      metadata_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS task_inbox (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      mission_id TEXT NOT NULL,
      from_session_id TEXT NOT NULL,
      recipient_session_id TEXT,
      recipient_node_id TEXT,
      role_id TEXT,
      title TEXT NOT NULL,
      objective TEXT,
      expected_output TEXT,
      acceptance_criteria TEXT, -- JSON array
      status TEXT NOT NULL DEFAULT 'pending', -- pending, approved, rejected, claimed, completed
      result_task_id INTEGER, -- Link to final task if approved/converted
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS debug_runs (
      id TEXT PRIMARY KEY,
      suite_name TEXT NOT NULL,
      autonomy_mode TEXT NOT NULL,
      require_confirmation INTEGER NOT NULL DEFAULT 1,
      status TEXT NOT NULL DEFAULT 'created',
      max_repair_attempts INTEGER NOT NULL DEFAULT 3,
      repair_attempt INTEGER NOT NULL DEFAULT 0,
      max_files_changed INTEGER NOT NULL DEFAULT 8,
      max_patch_bytes INTEGER NOT NULL DEFAULT 120000,
      max_command_runtime_ms INTEGER NOT NULL DEFAULT 120000,
      allowed_paths_json TEXT NOT NULL,
      blocked_paths_json TEXT NOT NULL,
      allowed_commands_json TEXT NOT NULL,
      mission_ids_json TEXT NOT NULL DEFAULT '[]',
      changed_files_json TEXT NOT NULL DEFAULT '[]',
      report_artifact_id TEXT,
      last_failure TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE IF NOT EXISTS debug_events (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      debug_run_id TEXT,
      event_type TEXT NOT NULL,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(debug_run_id) REFERENCES debug_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_debug_events_run_id ON debug_events(debug_run_id, id);
    CREATE TABLE IF NOT EXISTS debug_reports (
      id TEXT PRIMARY KEY,
      debug_run_id TEXT NOT NULL,
      status TEXT NOT NULL,
      title TEXT NOT NULL,
      content_text TEXT NOT NULL,
      file_path TEXT,
      bundle_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(debug_run_id) REFERENCES debug_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_debug_reports_run_id ON debug_reports(debug_run_id, created_at);
    CREATE TABLE IF NOT EXISTS debug_patch_artifacts (
      id TEXT PRIMARY KEY,
      debug_run_id TEXT NOT NULL,
      title TEXT NOT NULL,
      diagnosis TEXT,
      diff TEXT NOT NULL,
      files_touched_json TEXT NOT NULL,
      expected_fix TEXT,
      tests_to_run_json TEXT NOT NULL DEFAULT '[]',
      risk_level TEXT NOT NULL DEFAULT 'medium',
      rollback_notes TEXT,
      status TEXT NOT NULL DEFAULT 'created',
      applied_at DATETIME,
      revert_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(debug_run_id) REFERENCES debug_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_debug_patch_artifacts_run_id ON debug_patch_artifacts(debug_run_id, created_at);
    CREATE TABLE IF NOT EXISTS debug_test_results (
      id TEXT PRIMARY KEY,
      debug_run_id TEXT NOT NULL,
      suite_name TEXT,
      test_name TEXT NOT NULL,
      status TEXT NOT NULL,
      failure_category TEXT,
      notes TEXT,
      evidence_json TEXT,
      command TEXT,
      stdout TEXT,
      stderr TEXT,
      exit_code INTEGER,
      duration_ms INTEGER,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      FOREIGN KEY(debug_run_id) REFERENCES debug_runs(id)
    );
    CREATE INDEX IF NOT EXISTS idx_debug_test_results_run_id ON debug_test_results(debug_run_id, created_at);
    CREATE TABLE IF NOT EXISTS debug_frontend_errors (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      timestamp TEXT,
      kind TEXT,
      name TEXT,
      message TEXT NOT NULL,
      stack TEXT,
      route TEXT,
      component TEXT,
      payload_json TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    );
    CREATE INDEX IF NOT EXISTS idx_debug_frontend_errors_created_at ON debug_frontend_errors(created_at, id);
  `);

  // Migrations
  for (const col of ['from_role TEXT', 'target_role TEXT', 'payload TEXT', 'mission_id TEXT', 'node_id TEXT']) {
    try { db.exec(`ALTER TABLE tasks ADD COLUMN ${col}`); }
    catch (e) { if (!String(e).includes('duplicate column')) throw e; }
  }

  try { db.exec(`ALTER TABLE file_locks ADD COLUMN expires_at DATETIME`); }
  catch (e) { if (!String(e).includes('duplicate column')) throw e; }

  for (const col of ['mission_id TEXT', 'node_id TEXT', 'recipient_node_id TEXT', 'is_read BOOLEAN DEFAULT 0']) {
    try { db.exec(`ALTER TABLE session_log ADD COLUMN ${col}`); }
    catch (e) { if (!String(e).includes('duplicate column')) throw e; }
  }

  try { db.exec(`ALTER TABLE agent_runtime_sessions ADD COLUMN run_id TEXT`); }
  catch (e) { if (!String(e).includes('duplicate column')) throw e; }
}
