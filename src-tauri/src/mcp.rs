use std::io::{BufRead, BufReader};
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize, serde::Deserialize)]
pub struct McpMessage {
    pub id: u64,
    pub from: String,
    pub content: String,
    #[serde(rename = "type")]
    pub msg_type: String,
    pub timestamp: u64,
}

pub struct McpState {
    pub process: Arc<Mutex<Option<Child>>>,
}

impl McpState {
    pub fn new() -> Self {
        Self { process: Arc::new(Mutex::new(None)) }
    }
}

const PORT: u16 = 3741;

pub fn init_mcp_server(app: &AppHandle) -> Result<(), String> {
    let mut server_dir = std::env::current_dir()
        .map_err(|e| e.to_string())?
        .join("mcp-server");

    if !server_dir.exists() {
        // Try parent directory (likely when running from src-tauri)
        if let Ok(current) = std::env::current_dir() {
            if let Some(parent) = current.parent() {
                let parent_server_dir = parent.join("mcp-server");
                if parent_server_dir.exists() {
                    server_dir = parent_server_dir;
                }
            }
        }
    }

    if !server_dir.exists() {
        return Err(format!("MCP server directory not found at {:?}", server_dir));
    }

    let child = Command::new("node")
        .arg("server.mjs")
        .current_dir(&server_dir)
        .stdout(Stdio::inherit())
        .stderr(Stdio::inherit())
        .spawn()
        .map_err(|e| format!("Failed to spawn MCP server: {}", e))?;

    {
        let state = app.state::<McpState>();
        let mut guard = state.process.lock().unwrap();
        *guard = Some(child);
    }

    let app_handle = app.clone();
    thread::spawn(move || {
        // Wait for server to become ready (up to 10s)
        let base = format!("http://localhost:{}", PORT);
        let mut ready = false;
        for _ in 0..20 {
            thread::sleep(Duration::from_millis(500));
            if ureq::get(&format!("{}/health", base)).call().is_ok() {
                ready = true;
                break;
            }
        }
        if !ready {
            eprintln!("MCP server did not become ready in time");
            return;
        }

        // Subscribe to SSE activity feed
        let response = match ureq::get(&format!("{}/events", base)).call() {
            Ok(r) => r,
            Err(e) => {
                eprintln!("Failed to connect to MCP events: {}", e);
                return;
            }
        };

        let reader = BufReader::new(response.into_reader());
        for line in reader.lines().flatten() {
            if let Some(data) = line.strip_prefix("data: ") {
                if let Ok(msg) = serde_json::from_str::<McpMessage>(data) {
                    let _ = app_handle.emit("mcp-message", msg);
                }
            }
        }
    });

    Ok(())
}

pub fn kill_mcp_server(app: &AppHandle) {
    let state = app.state::<McpState>();
    let mut guard = state.process.lock().unwrap();
    if let Some(mut child) = guard.take() {
        let _ = child.kill();
    }
}

#[tauri::command]
pub fn get_mcp_url() -> String {
    format!("http://localhost:{}/mcp", PORT)
}
