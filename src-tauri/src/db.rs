use rusqlite::Connection;
use serde::{Deserialize, Serialize};
use std::fs;
use std::sync::Mutex;
use tauri::{AppHandle, Manager, State};

pub struct DbState {
    pub db: Mutex<Option<Connection>>,
}

#[derive(Serialize, Deserialize, Debug)]
pub struct Task {
    pub id: i64,
    pub title: String,
    pub description: Option<String>,
    pub status: String,
    pub created_at: String,
}

pub fn init_db(app: &AppHandle) -> Result<(), String> {
    let app_dir = app.path().app_local_data_dir().map_err(|e| e.to_string())?;

    if !app_dir.exists() {
        fs::create_dir_all(&app_dir).map_err(|e| e.to_string())?;
    }

    let db_path = app_dir.join("tasks.db");

    let conn = Connection::open(db_path).map_err(|e| e.to_string())?;

    conn.execute(
        "CREATE TABLE IF NOT EXISTS tasks (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            title TEXT NOT NULL,
            description TEXT,
            status TEXT NOT NULL DEFAULT 'todo',
            created_at DATETIME DEFAULT CURRENT_TIMESTAMP
        )",
        (),
    )
    .map_err(|e| e.to_string())?;

    app.manage(DbState {
        db: Mutex::new(Some(conn)),
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

    let mut stmt = conn.prepare("SELECT id, title, description, status, datetime(created_at, 'localtime') FROM tasks ORDER BY id DESC").map_err(|e| e.to_string())?;
    let task_iter = stmt
        .query_map([], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
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
    state: State<'_, DbState>,
) -> Result<Task, String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    conn.execute(
        "INSERT INTO tasks (title, description, status) VALUES (?1, ?2, 'todo')",
        (&title, &description),
    )
    .map_err(|e| e.to_string())?;

    let id = conn.last_insert_rowid();

    let mut stmt = conn.prepare("SELECT id, title, description, status, datetime(created_at, 'localtime') FROM tasks WHERE id = ?1").map_err(|e| e.to_string())?;
    let task = stmt
        .query_row([id], |row| {
            Ok(Task {
                id: row.get(0)?,
                title: row.get(1)?,
                description: row.get(2)?,
                status: row.get(3)?,
                created_at: row.get(4)?,
            })
        })
        .map_err(|e| e.to_string())?;

    Ok(task)
}

#[tauri::command]
pub fn update_task_status(
    id: i64,
    status: String,
    state: State<'_, DbState>,
) -> Result<(), String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    conn.execute("UPDATE tasks SET status = ?1 WHERE id = ?2", (&status, &id))
        .map_err(|e| e.to_string())?;

    Ok(())
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
