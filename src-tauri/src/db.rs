use rusqlite::{params, Connection, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState {
    pub db: Mutex<Option<Connection>>,
    pub db_path: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
    pub parent_id: Option<i64>,
    pub agent_id: Option<String>,
    pub from_role: Option<String>,
    pub target_role: Option<String>,
    pub payload: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct FileLock {
    pub file_path: String,
    pub agent_id: String,
    pub locked_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct SessionEvent {
    pub id: i64,
    pub session_id: String,
    pub event_type: String,
    pub content: Option<String>,
    pub created_at: String,
}

pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let db_path = app_dir.join("tasks.db");
    let db_path_str = db_path.to_string_lossy().to_string();

    let conn = Connection::open(&db_path).map_err(|e| e.to_string())?;

    conn.execute_batch("PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;")
        .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks (
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
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    // Migrate tasks.db created before Phase 1 handoff columns existed.
    for col in [
        "from_role TEXT",
        "target_role TEXT",
        "payload TEXT",
        "mission_id TEXT",
        "node_id TEXT",
    ] {
        let sql = format!("ALTER TABLE tasks ADD COLUMN {}", col);
        if let Err(e) = conn.execute(&sql, ()) {
            let s = e.to_string();
            if !s.contains("duplicate column") {
                return Err(s);
            }
        }
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS workflow_definitions (
            id TEXT PRIMARY KEY,
            graph_json TEXT NOT NULL,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS file_locks (
            file_path TEXT PRIMARY KEY,
            agent_id TEXT NOT NULL,
            locked_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS session_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            session_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            content TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            mission_id TEXT,
            node_id TEXT,
            recipient_node_id TEXT,
            is_read BOOLEAN DEFAULT 0
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    for col in [
        "mission_id TEXT",
        "node_id TEXT",
        "recipient_node_id TEXT",
        "is_read BOOLEAN DEFAULT 0",
    ] {
        let sql = format!("ALTER TABLE session_log ADD COLUMN {}", col);
        if let Err(e) = conn.execute(&sql, ()) {
            let s = e.to_string();
            if !s.contains("duplicate column") {
                return Err(s);
            }
        }
    }

    conn.execute(
        "CREATE TABLE IF NOT EXISTS workspace_context (
            key TEXT PRIMARY KEY,
            value TEXT,
            updated_by TEXT,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS compiled_missions (
            mission_id TEXT PRIMARY KEY,
            graph_id TEXT NOT NULL,
            mission_json TEXT NOT NULL,
            status TEXT NOT NULL DEFAULT 'active',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS mission_node_runtime (
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
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_runtime_sessions (
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
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    if let Err(e) = conn.execute(
        "ALTER TABLE agent_runtime_sessions ADD COLUMN run_id TEXT",
        (),
    ) {
        let s = e.to_string();
        if !s.contains("duplicate column") {
            return Err(s);
        }
    }

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_runtime_sessions_mission_node_attempt
         ON agent_runtime_sessions (mission_id, node_id, attempt)",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS agent_runs (
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
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_agent_runs_mission_id
         ON agent_runs (mission_id, created_at)",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS mission_timeline (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            mission_id TEXT NOT NULL,
            event_type TEXT NOT NULL,
            payload TEXT,
            run_version INTEGER,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_mission_timeline_mission_id
         ON mission_timeline (mission_id, id)",
        (),
    )
    .map_err(|e| e.to_string())?;

    // task_pushes: idempotent activation records written by the workflow engine
    // when a node activation is dispatched. The MCP server reads these as pending
    // activations via buildTaskDetails / list_task_activations. task_seq maps to
    // the attempt number so the PK is naturally unique per activation attempt.
    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_pushes (
            session_id TEXT NOT NULL,
            mission_id TEXT NOT NULL,
            node_id TEXT NOT NULL,
            task_seq INTEGER NOT NULL,
            attempt INTEGER,
            pushed_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            acked_at DATETIME,
            PRIMARY KEY (session_id, mission_id, node_id, task_seq)
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    // --- Phase 2: Canonical tables ---

    conn.execute(
        "CREATE TABLE IF NOT EXISTS missions (
            id TEXT PRIMARY KEY,
            goal TEXT,
            status TEXT NOT NULL DEFAULT 'draft',
            workspace_dir TEXT,
            owner_node_id TEXT,
            final_summary TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS node_edges (
            id TEXT NOT NULL,
            mission_id TEXT NOT NULL,
            from_node_id TEXT NOT NULL,
            to_node_id TEXT NOT NULL,
            condition TEXT NOT NULL DEFAULT 'always',
            PRIMARY KEY (id, mission_id)
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS artifacts (
            id TEXT PRIMARY KEY,
            mission_id TEXT NOT NULL,
            node_id TEXT,
            kind TEXT NOT NULL DEFAULT 'summary',
            title TEXT NOT NULL,
            content_uri TEXT,
            content_text TEXT,
            metadata_json TEXT,
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_artifacts_mission_id ON artifacts(mission_id)",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS workflow_events (
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
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_workflow_events_mission_id ON workflow_events(mission_id, id)",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS task_inbox (
            id TEXT PRIMARY KEY,
            mission_id TEXT NOT NULL,
            from_node_id TEXT,
            to_node_id TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'start',
            payload_json TEXT,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
            claimed_at DATETIME,
            completed_at DATETIME
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE INDEX IF NOT EXISTS idx_task_inbox_mission_id ON task_inbox(mission_id)",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT OR IGNORE INTO missions (id, goal, status, created_at, updated_at)
         SELECT mission_id, graph_id, status, created_at, updated_at FROM compiled_missions",
        (),
    )
    .map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO workflow_events
           (mission_id, type, severity, message, payload_json, created_at)
         SELECT mt.mission_id, mt.event_type, 'info', mt.event_type, mt.payload, mt.created_at
         FROM mission_timeline mt
         WHERE NOT EXISTS (
           SELECT 1 FROM workflow_events we
           WHERE we.mission_id = mt.mission_id
             AND we.type = mt.event_type
             AND COALESCE(we.payload_json, '') = COALESCE(mt.payload, '')
             AND we.created_at = mt.created_at
         )",
        (),
    )
    .map_err(|e| e.to_string())?;

    // mission_node_runtime: add structured node definition columns
    for col in [
        "title TEXT",
        "objective TEXT",
        "prompt TEXT",
        "execution_policy TEXT DEFAULT 'manual'",
        "assigned_cli TEXT",
        "assigned_model TEXT",
        "yolo INTEGER DEFAULT 0",
        "max_attempts INTEGER DEFAULT 3",
        "parent_id TEXT",
        "dependency_node_ids_json TEXT",
    ] {
        let sql = format!("ALTER TABLE mission_node_runtime ADD COLUMN {}", col);
        if let Err(e) = conn.execute(&sql, ()) {
            let s = e.to_string();
            if !s.contains("duplicate column") {
                return Err(s);
            }
        }
    }

    // agent_runtime_sessions: add full lifecycle columns
    for col in [
        "model TEXT",
        "execution_mode TEXT DEFAULT 'interactive_pty'",
        "started_at DATETIME",
        "ended_at DATETIME",
        "failure_reason TEXT",
    ] {
        let sql = format!("ALTER TABLE agent_runtime_sessions ADD COLUMN {}", col);
        if let Err(e) = conn.execute(&sql, ()) {
            let s = e.to_string();
            if !s.contains("duplicate column") {
                return Err(s);
            }
        }
    }

    // file_locks: add mission context and expiry
    for col in [
        "mission_id TEXT",
        "mode TEXT DEFAULT 'write'",
        "status TEXT DEFAULT 'active'",
        "expires_at DATETIME",
    ] {
        let sql = format!("ALTER TABLE file_locks ADD COLUMN {}", col);
        if let Err(e) = conn.execute(&sql, ()) {
            let s = e.to_string();
            if !s.contains("duplicate column") {
                return Err(s);
            }
        }
    }

    app.manage(DbState {
        db: Mutex::new(Some(conn)),
        db_path: db_path_str,
    });

    Ok(())
}

#[tauri::command]
pub fn get_tasks(state: State<'_, DbState>) -> Result<Vec<Task>, String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    let mut stmt = conn.prepare("SELECT id, title, description, status, datetime(created_at, 'localtime'), parent_id, agent_id, from_role, target_role, payload FROM tasks ORDER BY id DESC").map_err(|e| e.to_string())?;
    let task_iter = stmt
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                parent_id: row.get(5)?,
                agent_id: row.get(6)?,
                from_role: row.get(7)?,
                target_role: row.get(8)?,
                payload: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut tasks = Vec::new();
    for task in task_iter {
        tasks.push(task.map_err(|e| e.to_string())?);
    }

    Ok(tasks)
}

#[tauri::command]
pub fn add_task(
    title: String,
    description: Option<String>,
    parent_id: Option<i64>,
    agent_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<Task, String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    conn.execute(
        "INSERT INTO tasks (title, description, status, parent_id, agent_id) VALUES (?1, ?2, 'todo', ?3, ?4)",
        (&title, &description, &parent_id, &agent_id),
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    let mut stmt = conn.prepare("SELECT id, title, description, status, datetime(created_at, 'localtime'), parent_id, agent_id, from_role, target_role, payload FROM tasks WHERE id = ?1").map_err(|e| e.to_string())?;
    let task = stmt
        .query_row([id], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
                parent_id: row.get(5)?,
                agent_id: row.get(6)?,
                from_role: row.get(7)?,
                target_role: row.get(8)?,
                payload: row.get(9)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(task)
}

#[tauri::command]
pub fn update_task_status(
    id: i64,
    status: String,
    agent_id: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    if let Some(agent) = agent_id {
        conn.execute(
            "UPDATE tasks SET status = ?1, agent_id = ?2 WHERE id = ?3",
            (&status, &agent, &id),
        )
        .map_err(|e| e.to_string())?;
    } else {
        conn.execute("UPDATE tasks SET status = ?1 WHERE id = ?2", (&status, &id))
            .map_err(|e| e.to_string())?;
    }

    Ok(())
}

#[tauri::command]
pub fn lock_file(
    file_path: String,
    agent_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    // Check if locked by someone else
    let mut stmt = conn
        .prepare("SELECT agent_id FROM file_locks WHERE file_path = ?1")
        .map_err(|e| e.to_string())?;
    let current_lock_agent: Option<String> = stmt
        .query_row([&file_path], |row| row.get(0))
        .optional()
        .map_err(|e| e.to_string())?;

    if let Some(current_agent) = current_lock_agent {
        if current_agent != agent_id {
            return Err(format!("File already locked by agent: {}", current_agent));
        }
        return Ok(()); // Already locked by this agent
    }

    conn.execute(
        "INSERT INTO file_locks (file_path, agent_id) VALUES (?1, ?2)",
        (&file_path, &agent_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn unlock_file(
    file_path: String,
    agent_id: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    conn.execute(
        "DELETE FROM file_locks WHERE file_path = ?1 AND agent_id = ?2",
        (&file_path, &agent_id),
    )
    .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_file_locks(state: State<'_, DbState>) -> Result<Vec<FileLock>, String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    let mut stmt = conn
        .prepare("SELECT file_path, agent_id, datetime(locked_at, 'localtime') FROM file_locks")
        .map_err(|e| e.to_string())?;
    let lock_iter = stmt
        .query_map([], |row| {
            Ok(FileLock {
                file_path: row.get(0)?,
                agent_id: row.get(1)?,
                locked_at: row.get(2)?,
            })
        })
        .map_err(|e| e.to_string())?;

    let mut locks = Vec::new();
    for lock in lock_iter {
        locks.push(lock.map_err(|e| e.to_string())?);
    }

    Ok(locks)
}

#[tauri::command]
pub fn delete_task(id: i64, state: State<'_, DbState>) -> Result<(), String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    conn.execute("DELETE FROM tasks WHERE id = ?1", [&id])
        .map_err(|e| e.to_string())?;

    Ok(())
}

#[tauri::command]
pub fn get_db_path(state: State<'_, DbState>) -> String {
    state.db_path.clone()
}

#[tauri::command]
pub fn save_session_event(
    session_id: String,
    event_type: String,
    content: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO session_log (session_id, event_type, content) VALUES (?1, ?2, ?3)",
        (&session_id, &event_type, &content),
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_session_history(
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<SessionEvent>, String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let lim = limit.unwrap_or(50);
    let mut stmt = conn
        .prepare(
            "SELECT id, session_id, event_type, content, datetime(created_at, 'localtime') \
         FROM session_log ORDER BY id DESC LIMIT ?1",
        )
        .map_err(|e| e.to_string())?;
    let iter = stmt
        .query_map([lim], |row| {
            Ok(SessionEvent {
                id: row.get(0)?,
                session_id: row.get(1)?,
                event_type: row.get(2)?,
                content: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;
    let mut events: Vec<SessionEvent> = iter.filter_map(|e| e.ok()).collect();
    events.reverse();
    Ok(events)
}

#[tauri::command]
pub fn save_workflow_definition(id: String, graph_json: String, state: State<'_, DbState>) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO workflow_definitions (id, graph_json, updated_at) VALUES (?1, ?2, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET graph_json = ?2, updated_at = CURRENT_TIMESTAMP",
        (&id, &graph_json),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_workflow_definition(id: String, state: State<'_, DbState>) -> Result<String, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let mut stmt = conn.prepare("SELECT graph_json FROM workflow_definitions WHERE id = ?1").map_err(|e| e.to_string())?;
    let json: String = stmt.query_row([&id], |row| row.get(0)).map_err(|e| e.to_string())?;
    Ok(json)
}

// --- Phase 2: New record types ---

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ArtifactRecord {
    pub id: String,
    pub mission_id: String,
    pub node_id: Option<String>,
    pub kind: String,
    pub title: String,
    pub content_uri: Option<String>,
    pub content_text: Option<String>,
    pub metadata_json: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowEventRecord {
    pub id: i64,
    pub mission_id: String,
    pub node_id: Option<String>,
    pub session_id: Option<String>,
    pub terminal_id: Option<String>,
    pub event_type: String,
    pub severity: String,
    pub message: String,
    pub payload_json: Option<String>,
    pub created_at: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowStatusMappingRecord {
    pub raw_status: String,
    pub canonical_status: String,
}

pub fn canonical_workflow_node_status(status: &str) -> String {
    match status {
        "idle" | "bound" | "terminal_started" => "pending".to_string(),
        "unbound" => "blocked".to_string(),
        "launching" | "connecting" | "spawning" | "adapter_starting" | "mcp_connecting"
        | "registered" | "ready" | "activation_pending" | "activation_acked" | "activated" => {
            "starting".to_string()
        }
        "handoff_pending" | "waiting" => "queued".to_string(),
        "running" => "running".to_string(),
        "awaiting_permission" => "review_required".to_string(),
        "done" | "completed" => "completed".to_string(),
        "failed" | "disconnected" => "failed".to_string(),
        "cancelled" => "cancelled".to_string(),
        "draft" | "pending" | "eligible" | "queued" | "starting" | "blocked"
        | "review_required" => status.to_string(),
        _ => "pending".to_string(),
    }
}

pub fn canonical_runtime_session_status(status: &str) -> String {
    match status {
        "created" => "created".to_string(),
        "launching" | "connecting" | "spawning" | "adapter_starting" | "mcp_connecting"
        | "activation_pending" => "launching".to_string(),
        "registered" | "ready" => "cli_ready".to_string(),
        "activation_acked" | "activated" => "acknowledged".to_string(),
        "running" | "handoff_pending" | "waiting" | "dispatched" => "running".to_string(),
        "done" | "completed" => "completed".to_string(),
        "failed" | "unbound" => "failed".to_string(),
        "cancelled" => "cancelled".to_string(),
        "disconnected" => "disconnected".to_string(),
        "cleaned" => "cleaned".to_string(),
        _ => "created".to_string(),
    }
}

pub fn append_workflow_event_direct(
    conn: &Connection,
    mission_id: &str,
    node_id: Option<&str>,
    session_id: Option<&str>,
    terminal_id: Option<&str>,
    event_type: &str,
    severity: &str,
    message: &str,
    payload_json: Option<&str>,
) {
    let _ = conn.execute(
        "INSERT INTO workflow_events
         (mission_id, node_id, session_id, terminal_id, type, severity, message, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)",
        params![
            mission_id,
            node_id,
            session_id,
            terminal_id,
            event_type,
            severity,
            message,
            payload_json,
        ],
    );
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct TaskInboxItem {
    pub id: String,
    pub mission_id: String,
    pub from_node_id: Option<String>,
    pub to_node_id: String,
    pub kind: String,
    pub payload_json: Option<String>,
    pub status: String,
    pub created_at: String,
    pub claimed_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct NodeEdgeRecord {
    pub id: String,
    pub mission_id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub condition: String,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSessionRecord {
    pub session_id: String,
    pub agent_id: String,
    pub mission_id: String,
    pub node_id: String,
    pub attempt: u32,
    pub terminal_id: String,
    pub run_id: Option<String>,
    pub status: String,
    pub canonical_status: String,
    pub model: Option<String>,
    pub execution_mode: Option<String>,
    pub started_at: Option<String>,
    pub ended_at: Option<String>,
    pub failure_reason: Option<String>,
    pub created_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct FileLockRecord {
    pub file_path: String,
    pub agent_id: String,
    pub locked_at: String,
    pub mission_id: Option<String>,
    pub mode: Option<String>,
    pub lock_status: Option<String>,
    pub expires_at: Option<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MissionSnapshotNode {
    pub node_id: String,
    pub status: String,
    pub canonical_status: String,
    pub attempt: u32,
    pub terminal_id: Option<String>,
    pub last_outcome: Option<String>,
    pub role: Option<String>,
    pub title: Option<String>,
    pub objective: Option<String>,
    pub execution_policy: Option<String>,
    pub assigned_cli: Option<String>,
    pub assigned_model: Option<String>,
    pub max_attempts: u32,
    pub dependency_node_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MissionSnapshot {
    pub mission_id: String,
    pub graph_id: String,
    pub mission_json: String,
    pub status: String,
    pub nodes: Vec<MissionSnapshotNode>,
    pub edges: Vec<NodeEdgeRecord>,
    pub runtime_sessions: Vec<RuntimeSessionRecord>,
    pub artifacts: Vec<ArtifactRecord>,
    pub file_locks: Vec<FileLockRecord>,
    pub recent_events: Vec<WorkflowEventRecord>,
    pub status_mappings: Vec<WorkflowStatusMappingRecord>,
}

// Public helpers for workflow_engine.rs to call within its own lock context
pub fn upsert_mission_canonical(conn: &Connection, mission_id: &str, goal: &str, workspace_dir: Option<&str>, status: &str) {
    let _ = conn.execute(
        "INSERT INTO missions (id, goal, status, workspace_dir, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           goal = COALESCE(excluded.goal, missions.goal),
           workspace_dir = COALESCE(excluded.workspace_dir, missions.workspace_dir),
           updated_at = CURRENT_TIMESTAMP",
        params![&mission_id, &goal, &status, &workspace_dir],
    );
}

pub fn upsert_node_edge_direct(conn: &Connection, id: &str, mission_id: &str, from_node_id: &str, to_node_id: &str, condition: &str) {
    let _ = conn.execute(
        "INSERT INTO node_edges (id, mission_id, from_node_id, to_node_id, condition)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id, mission_id) DO UPDATE SET
           from_node_id = excluded.from_node_id,
           to_node_id = excluded.to_node_id,
           condition = excluded.condition",
        params![id, mission_id, from_node_id, to_node_id, condition],
    );
}

#[tauri::command]
pub fn get_mission_snapshot(mission_id: String, state: State<'_, DbState>) -> Result<MissionSnapshot, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    // Base mission data from compiled_missions
    let mut stmt = conn.prepare(
        "SELECT graph_id, mission_json, status FROM compiled_missions WHERE mission_id = ?1"
    ).map_err(|e| e.to_string())?;
    let (graph_id, mission_json, cm_status): (String, String, String) = stmt
        .query_row([&mission_id], |row| Ok((row.get(0)?, row.get(1)?, row.get(2)?)))
        .map_err(|e| e.to_string())?;

    // Prefer canonical missions table status if it exists
    let canonical_status: Option<String> = conn
        .prepare("SELECT status FROM missions WHERE id = ?1")
        .ok()
        .and_then(|mut s| s.query_row([&mission_id], |row| row.get(0)).ok());
    let status = canonical_status.unwrap_or(cm_status);

    // Nodes — query all columns including the new Phase 2 ones
    let mut stmt2 = conn.prepare(
        "SELECT node_id, status, attempt, last_outcome, role_id, title, objective,
                execution_policy, assigned_cli, assigned_model, max_attempts, dependency_node_ids_json
         FROM mission_node_runtime WHERE mission_id = ?1"
    ).map_err(|e| e.to_string())?;
    let node_iter = stmt2.query_map([&mission_id], |row| {
        Ok((
            row.get::<_, String>(0)?,
            row.get::<_, String>(1)?,
            row.get::<_, u32>(2)?,
            row.get::<_, Option<String>>(3)?,
            row.get::<_, Option<String>>(4)?,
            row.get::<_, Option<String>>(5)?,
            row.get::<_, Option<String>>(6)?,
            row.get::<_, Option<String>>(7)?,
            row.get::<_, Option<String>>(8)?,
            row.get::<_, Option<String>>(9)?,
            row.get::<_, Option<u32>>(10)?,
            row.get::<_, Option<String>>(11)?,
        ))
    }).map_err(|e| e.to_string())?;

    let mut nodes = Vec::new();
    for n in node_iter {
        let (node_id, node_status, attempt, last_outcome, role, title, objective,
             execution_policy, assigned_cli, assigned_model, max_attempts_opt, dep_json)
            = n.map_err(|e| e.to_string())?;

        let mut stmt3 = conn.prepare(
            "SELECT terminal_id FROM agent_runtime_sessions
             WHERE mission_id = ?1 AND node_id = ?2 ORDER BY attempt DESC LIMIT 1"
        ).map_err(|e| e.to_string())?;
        let terminal_id: Option<String> = stmt3.query_row([&mission_id, &node_id], |row| row.get(0)).ok();

        let dependency_node_ids: Vec<String> = dep_json
            .as_deref()
            .and_then(|j| serde_json::from_str::<Vec<String>>(j).ok())
            .unwrap_or_default();

        nodes.push(MissionSnapshotNode {
            node_id,
            canonical_status: canonical_workflow_node_status(&node_status),
            status: node_status,
            attempt,
            terminal_id,
            last_outcome,
            role,
            title,
            objective,
            execution_policy,
            assigned_cli,
            assigned_model,
            max_attempts: max_attempts_opt.unwrap_or(3),
            dependency_node_ids,
        });
    }

    // Edges
    let edges: Vec<NodeEdgeRecord> = {
        let mut stmt = conn.prepare(
            "SELECT id, mission_id, from_node_id, to_node_id, condition
             FROM node_edges WHERE mission_id = ?1"
        ).map_err(|e| e.to_string())?;
        let iter = stmt.query_map([&mission_id], |row| {
            Ok(NodeEdgeRecord {
                id: row.get(0)?,
                mission_id: row.get(1)?,
                from_node_id: row.get(2)?,
                to_node_id: row.get(3)?,
                condition: row.get(4)?,
            })
        }).map_err(|e| e.to_string())?;
        iter.filter_map(|r| r.ok()).collect()
    };

    // Runtime sessions
    let runtime_sessions: Vec<RuntimeSessionRecord> = {
        let mut stmt = conn.prepare(
            "SELECT session_id, agent_id, mission_id, node_id, attempt, terminal_id, run_id,
                    status, model, execution_mode,
                    datetime(started_at, 'localtime'), datetime(ended_at, 'localtime'),
                    failure_reason, datetime(created_at, 'localtime')
             FROM agent_runtime_sessions WHERE mission_id = ?1 ORDER BY created_at DESC LIMIT 100"
        ).map_err(|e| e.to_string())?;
        let iter = stmt.query_map([&mission_id], |row| {
            Ok(RuntimeSessionRecord {
                session_id: row.get(0)?,
                agent_id: row.get(1)?,
                mission_id: row.get(2)?,
                node_id: row.get(3)?,
                attempt: row.get::<_, Option<u32>>(4)?.unwrap_or(0),
                terminal_id: row.get(5)?,
                run_id: row.get(6)?,
                status: {
                    let status: String = row.get(7)?;
                    status
                },
                canonical_status: {
                    let status: String = row.get(7)?;
                    canonical_runtime_session_status(&status)
                },
                model: row.get(8)?,
                execution_mode: row.get(9)?,
                started_at: row.get(10)?,
                ended_at: row.get(11)?,
                failure_reason: row.get(12)?,
                created_at: row.get(13)?,
            })
        }).map_err(|e| e.to_string())?;
        iter.filter_map(|r| r.ok()).collect()
    };

    // Artifacts
    let artifacts: Vec<ArtifactRecord> = {
        let mut stmt = conn.prepare(
            "SELECT id, mission_id, node_id, kind, title, content_uri, content_text,
                    metadata_json, datetime(created_at, 'localtime')
             FROM artifacts WHERE mission_id = ?1 ORDER BY created_at ASC"
        ).map_err(|e| e.to_string())?;
        let iter = stmt.query_map([&mission_id], |row| {
            Ok(ArtifactRecord {
                id: row.get(0)?,
                mission_id: row.get(1)?,
                node_id: row.get(2)?,
                kind: row.get(3)?,
                title: row.get(4)?,
                content_uri: row.get(5)?,
                content_text: row.get(6)?,
                metadata_json: row.get(7)?,
                created_at: row.get(8)?,
            })
        }).map_err(|e| e.to_string())?;
        iter.filter_map(|r| r.ok()).collect()
    };

    // Active file locks for this mission
    let file_locks: Vec<FileLockRecord> = {
        let mut stmt = conn.prepare(
            "SELECT file_path, agent_id, datetime(locked_at, 'localtime'),
                    mission_id, mode, status, datetime(expires_at, 'localtime')
             FROM file_locks WHERE mission_id = ?1 AND (status IS NULL OR status = 'active')"
        ).map_err(|e| e.to_string())?;
        let iter = stmt.query_map([&mission_id], |row| {
            Ok(FileLockRecord {
                file_path: row.get(0)?,
                agent_id: row.get(1)?,
                locked_at: row.get(2)?,
                mission_id: row.get(3)?,
                mode: row.get(4)?,
                lock_status: row.get(5)?,
                expires_at: row.get(6)?,
            })
        }).map_err(|e| e.to_string())?;
        iter.filter_map(|r| r.ok()).collect()
    };

    // Recent events: workflow_events first, fall back to mission_timeline
    let recent_events: Vec<WorkflowEventRecord> = {
        let mut events: Vec<WorkflowEventRecord> = {
            let mut stmt = conn.prepare(
                "SELECT id, mission_id, node_id, session_id, terminal_id,
                        type, severity, message, payload_json, datetime(created_at, 'localtime')
                 FROM workflow_events WHERE mission_id = ?1 ORDER BY id DESC LIMIT 100"
            ).map_err(|e| e.to_string())?;
            let iter = stmt.query_map([&mission_id], |row| {
                Ok(WorkflowEventRecord {
                    id: row.get(0)?,
                    mission_id: row.get(1)?,
                    node_id: row.get(2)?,
                    session_id: row.get(3)?,
                    terminal_id: row.get(4)?,
                    event_type: row.get(5)?,
                    severity: row.get(6)?,
                    message: row.get(7)?,
                    payload_json: row.get(8)?,
                    created_at: row.get(9)?,
                })
            }).map_err(|e| e.to_string())?;
            iter.filter_map(|r| r.ok()).collect()
        };

        // Backward compat: include mission_timeline when no workflow_events exist
        if events.is_empty() {
            if let Ok(mut stmt) = conn.prepare(
                "SELECT id, mission_id, event_type, payload, datetime(created_at, 'localtime')
                 FROM mission_timeline WHERE mission_id = ?1 ORDER BY id DESC LIMIT 100"
            ) {
                if let Ok(iter) = stmt.query_map([&mission_id], |row| {
                    let id: i64 = row.get(0)?;
                    let mid: String = row.get(1)?;
                    let ev_type: String = row.get(2)?;
                    let payload: Option<String> = row.get(3)?;
                    let created_at: String = row.get(4)?;
                    Ok(WorkflowEventRecord {
                        id,
                        mission_id: mid,
                        node_id: None,
                        session_id: None,
                        terminal_id: None,
                        event_type: ev_type.clone(),
                        severity: "info".to_string(),
                        message: ev_type,
                        payload_json: payload,
                        created_at,
                    })
                }) {
                    events = iter.filter_map(|r| r.ok()).collect();
                }
            }
        }

        events.reverse();
        events
    };

    Ok(MissionSnapshot {
        mission_id,
        graph_id,
        mission_json,
        status,
        nodes,
        edges,
        runtime_sessions,
        artifacts,
        file_locks,
        recent_events,
        status_mappings: workflow_status_mappings(),
    })
}

pub fn workflow_status_mappings() -> Vec<WorkflowStatusMappingRecord> {
    [
        "idle",
        "bound",
        "terminal_started",
        "unbound",
        "launching",
        "connecting",
        "spawning",
        "adapter_starting",
        "mcp_connecting",
        "registered",
        "ready",
        "activation_pending",
        "activation_acked",
        "activated",
        "handoff_pending",
        "waiting",
        "running",
        "awaiting_permission",
        "done",
        "completed",
        "failed",
        "disconnected",
        "cancelled",
        "draft",
        "pending",
        "eligible",
        "queued",
        "starting",
        "blocked",
        "review_required",
    ]
    .into_iter()
    .map(|raw| WorkflowStatusMappingRecord {
        raw_status: raw.to_string(),
        canonical_status: canonical_workflow_node_status(raw),
    })
    .collect()
}

// --- Phase 2: Repository commands ---

#[tauri::command]
pub fn upsert_mission_record(
    mission_id: String,
    goal: Option<String>,
    status: String,
    workspace_dir: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO missions (id, goal, status, workspace_dir, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           status = excluded.status,
           goal = COALESCE(excluded.goal, missions.goal),
           workspace_dir = COALESCE(excluded.workspace_dir, missions.workspace_dir),
           updated_at = CURRENT_TIMESTAMP",
        params![mission_id, goal, status, workspace_dir],
    )
    .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "missionId": mission_id,
        "status": status,
        "workspaceDir": workspace_dir,
    })
    .to_string();
    append_workflow_event_direct(
        conn,
        &mission_id,
        None,
        None,
        None,
        "mission_upserted",
        "info",
        &format!("Mission {mission_id} was saved with status {status}."),
        Some(&payload),
    );
    Ok(())
}

#[tauri::command]
pub fn update_mission_status(
    mission_id: String,
    status: String,
    final_summary: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "UPDATE missions SET status = ?1, final_summary = COALESCE(?2, final_summary), updated_at = CURRENT_TIMESTAMP WHERE id = ?3",
        params![&status, &final_summary, &mission_id],
    )
    .map_err(|e| e.to_string())?;
    // Keep compiled_missions in sync
    let _ = conn.execute(
        "UPDATE compiled_missions SET status = ?1, updated_at = CURRENT_TIMESTAMP WHERE mission_id = ?2",
        params![&status, &mission_id],
    );
    let payload = serde_json::json!({
        "missionId": mission_id,
        "status": status,
        "finalSummary": final_summary,
    })
    .to_string();
    append_workflow_event_direct(
        conn,
        &mission_id,
        None,
        None,
        None,
        "mission_status_changed",
        if status == "failed" || status == "cancelled" {
            "warning"
        } else {
            "info"
        },
        &format!("Mission {mission_id} status changed to {status}."),
        Some(&payload),
    );
    Ok(())
}

#[tauri::command]
pub fn write_artifact(
    id: String,
    mission_id: String,
    node_id: Option<String>,
    kind: String,
    title: String,
    content_uri: Option<String>,
    content_text: Option<String>,
    metadata_json: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO artifacts (id, mission_id, node_id, kind, title, content_uri, content_text, metadata_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO UPDATE SET
           title = excluded.title,
           content_uri = COALESCE(excluded.content_uri, artifacts.content_uri),
           content_text = COALESCE(excluded.content_text, artifacts.content_text),
           metadata_json = COALESCE(excluded.metadata_json, artifacts.metadata_json)",
        params![&id, &mission_id, &node_id, &kind, &title, &content_uri, &content_text, &metadata_json],
    )
    .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "artifactId": id,
        "kind": kind,
        "title": title,
    })
    .to_string();
    append_workflow_event_direct(
        conn,
        &mission_id,
        node_id.as_deref(),
        None,
        None,
        "artifact_written",
        "info",
        &format!("Artifact {id} was written."),
        Some(&payload),
    );
    Ok(())
}

#[tauri::command]
pub fn list_artifacts(mission_id: String, state: State<'_, DbState>) -> Result<Vec<ArtifactRecord>, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let mut stmt = conn.prepare(
        "SELECT id, mission_id, node_id, kind, title, content_uri, content_text,
                metadata_json, datetime(created_at, 'localtime')
         FROM artifacts WHERE mission_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    let iter = stmt.query_map([&mission_id], |row| {
        Ok(ArtifactRecord {
            id: row.get(0)?,
            mission_id: row.get(1)?,
            node_id: row.get(2)?,
            kind: row.get(3)?,
            title: row.get(4)?,
            content_uri: row.get(5)?,
            content_text: row.get(6)?,
            metadata_json: row.get(7)?,
            created_at: row.get(8)?,
        })
    }).map_err(|e| e.to_string())?;
    Ok(iter.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn append_workflow_event(
    mission_id: String,
    node_id: Option<String>,
    session_id: Option<String>,
    terminal_id: Option<String>,
    event_type: String,
    severity: String,
    message: String,
    payload_json: Option<String>,
    state: State<'_, DbState>,
) -> Result<i64, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO workflow_events
         (mission_id, node_id, session_id, terminal_id, type, severity, message, payload_json, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)",
        params![mission_id, node_id, session_id, terminal_id, event_type, severity, message, payload_json],
    )
    .map_err(|e| e.to_string())?;
    Ok(conn.last_insert_rowid())
}

#[tauri::command]
pub fn get_workflow_events(
    mission_id: String,
    limit: Option<i64>,
    state: State<'_, DbState>,
) -> Result<Vec<WorkflowEventRecord>, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let lim = limit.unwrap_or(100);
    let mut stmt = conn.prepare(
        "SELECT id, mission_id, node_id, session_id, terminal_id,
                type, severity, message, payload_json, datetime(created_at, 'localtime')
         FROM workflow_events WHERE mission_id = ?1 ORDER BY id DESC LIMIT ?2"
    ).map_err(|e| e.to_string())?;
    let iter = stmt.query_map(params![mission_id, lim], |row| {
        Ok(WorkflowEventRecord {
            id: row.get(0)?,
            mission_id: row.get(1)?,
            node_id: row.get(2)?,
            session_id: row.get(3)?,
            terminal_id: row.get(4)?,
            event_type: row.get(5)?,
            severity: row.get(6)?,
            message: row.get(7)?,
            payload_json: row.get(8)?,
            created_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut events: Vec<WorkflowEventRecord> = iter.filter_map(|r| r.ok()).collect();
    events.reverse();
    Ok(events)
}

#[tauri::command]
pub fn create_task_inbox_item(
    id: String,
    mission_id: String,
    from_node_id: Option<String>,
    to_node_id: String,
    kind: String,
    payload_json: Option<String>,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO task_inbox (id, mission_id, from_node_id, to_node_id, kind, payload_json, status, created_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, 'pending', CURRENT_TIMESTAMP)
         ON CONFLICT(id) DO NOTHING",
        params![&id, &mission_id, &from_node_id, &to_node_id, &kind, &payload_json],
    )
    .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "id": id,
        "fromNodeId": from_node_id,
        "toNodeId": to_node_id,
        "kind": kind,
    })
    .to_string();
    append_workflow_event_direct(
        conn,
        &mission_id,
        Some(&to_node_id),
        None,
        None,
        "task_inbox_created",
        "info",
        &format!("Task inbox item {id} created for node {to_node_id}."),
        Some(&payload),
    );
    Ok(())
}

#[tauri::command]
pub fn get_task_inbox_items(
    mission_id: String,
    state: State<'_, DbState>,
) -> Result<Vec<TaskInboxItem>, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let mut stmt = conn.prepare(
        "SELECT id, mission_id, from_node_id, to_node_id, kind, payload_json, status,
                datetime(created_at, 'localtime'), datetime(claimed_at, 'localtime'), datetime(completed_at, 'localtime')
         FROM task_inbox WHERE mission_id = ?1 ORDER BY created_at ASC"
    ).map_err(|e| e.to_string())?;
    let iter = stmt.query_map([&mission_id], |row| {
        Ok(TaskInboxItem {
            id: row.get(0)?,
            mission_id: row.get(1)?,
            from_node_id: row.get(2)?,
            to_node_id: row.get(3)?,
            kind: row.get(4)?,
            payload_json: row.get(5)?,
            status: row.get(6)?,
            created_at: row.get(7)?,
            claimed_at: row.get(8)?,
            completed_at: row.get(9)?,
        })
    }).map_err(|e| e.to_string())?;
    Ok(iter.filter_map(|r| r.ok()).collect())
}

#[tauri::command]
pub fn update_task_inbox_item_status(
    id: String,
    status: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let claimed_set = if status == "claimed" { ", claimed_at = CURRENT_TIMESTAMP" } else { "" };
    let completed_set = if status == "completed" || status == "cancelled" { ", completed_at = CURRENT_TIMESTAMP" } else { "" };
    let task_context: Option<(String, String)> = conn
        .query_row(
            "SELECT mission_id, to_node_id FROM task_inbox WHERE id = ?1",
            params![&id],
            |row| Ok((row.get(0)?, row.get(1)?)),
        )
        .ok();
    conn.execute(
        &format!(
            "UPDATE task_inbox SET status = ?1{}{} WHERE id = ?2",
            claimed_set, completed_set
        ),
        params![status, id],
    )
    .map_err(|e| e.to_string())?;
    if let Some((mission_id, to_node_id)) = task_context {
        let payload = serde_json::json!({
            "id": id,
            "status": status,
            "toNodeId": to_node_id,
        })
        .to_string();
        append_workflow_event_direct(
            conn,
            &mission_id,
            Some(&to_node_id),
            None,
            None,
            "task_inbox_status_changed",
            "info",
            &format!("Task inbox item {id} changed to {status}."),
            Some(&payload),
        );
    }
    Ok(())
}

#[tauri::command]
pub fn upsert_node_edge(
    id: String,
    mission_id: String,
    from_node_id: String,
    to_node_id: String,
    condition: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO node_edges (id, mission_id, from_node_id, to_node_id, condition)
         VALUES (?1, ?2, ?3, ?4, ?5)
         ON CONFLICT(id, mission_id) DO UPDATE SET
           from_node_id = excluded.from_node_id,
           to_node_id = excluded.to_node_id,
           condition = excluded.condition",
        params![&id, &mission_id, &from_node_id, &to_node_id, &condition],
    )
    .map_err(|e| e.to_string())?;
    let payload = serde_json::json!({
        "id": id,
        "fromNodeId": from_node_id,
        "toNodeId": to_node_id,
        "condition": condition,
    })
    .to_string();
    append_workflow_event_direct(
        conn,
        &mission_id,
        Some(&to_node_id),
        None,
        None,
        "node_edge_upserted",
        "info",
        &format!("Workflow edge {id} was saved."),
        Some(&payload),
    );
    Ok(())
}
