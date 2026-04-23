use rusqlite::{Connection, OptionalExtension};
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

    if let Err(e) = conn.execute("ALTER TABLE agent_runtime_sessions ADD COLUMN run_id TEXT", ()) {
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
        conn.execute("UPDATE tasks SET status = ?1, agent_id = ?2 WHERE id = ?3", (&status, &agent, &id))
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
    let mut stmt = conn.prepare("SELECT agent_id FROM file_locks WHERE file_path = ?1").map_err(|e| e.to_string())?;
    let current_lock_agent: Option<String> = stmt.query_row([&file_path], |row| row.get(0)).optional().map_err(|e| e.to_string())?;

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

    let mut stmt = conn.prepare("SELECT file_path, agent_id, datetime(locked_at, 'localtime') FROM file_locks").map_err(|e| e.to_string())?;
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
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    conn.execute(
        "INSERT INTO session_log (session_id, event_type, content) VALUES (?1, ?2, ?3)",
        (&session_id, &event_type, &content),
    ).map_err(|e| e.to_string())?;
    Ok(())
}

#[tauri::command]
pub fn get_session_history(limit: Option<i64>, state: State<'_, DbState>) -> Result<Vec<SessionEvent>, String> {
    let db_lock = state.db.lock().map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let lim = limit.unwrap_or(50);
    let mut stmt = conn.prepare(
        "SELECT id, session_id, event_type, content, datetime(created_at, 'localtime') \
         FROM session_log ORDER BY id DESC LIMIT ?1"
    ).map_err(|e| e.to_string())?;
    let iter = stmt.query_map([lim], |row| {
        Ok(SessionEvent {
            id: row.get(0)?,
            session_id: row.get(1)?,
            event_type: row.get(2)?,
            content: row.get(3)?,
            created_at: row.get(4)?,
        })
    }).map_err(|e| e.to_string())?;
    let mut events: Vec<SessionEvent> = iter.filter_map(|e| e.ok()).collect();
    events.reverse();
    Ok(events)
}
