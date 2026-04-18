use std::fs;
use std::io::{BufRead, BufReader};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::Duration;
use tauri::{AppHandle, Emitter, Manager};

#[derive(Clone, serde::Serialize)]
pub struct CliRegistrationResult {
    pub cli: String,
    pub success: bool,
    pub message: String,
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .map(PathBuf::from)
        .ok()
}

// Merge `entry` into the JSON object at `config_path` under the given `key_path`
// (dot-separated, e.g. "mcpServers" or "mcp"). Creates the file if missing.
// Returns Ok(true) if written, Ok(false) if entry already identical.
fn merge_json_config(
    config_path: &PathBuf,
    key_path: &str,
    entry_name: &str,
    entry_value: serde_json::Value,
) -> Result<bool, String> {
    let mut root: serde_json::Value = if config_path.exists() {
        let raw = fs::read_to_string(config_path).map_err(|e| e.to_string())?;
        // Strip jsonc-style comments before parsing
        let clean: String = raw
            .lines()
            .map(|l| {
                if let Some(idx) = l.find("//") {
                    // Only strip if not inside a string (basic heuristic)
                    let before = &l[..idx];
                    if before.chars().filter(|&c| c == '"').count() % 2 == 0 {
                        return before.trim_end().to_string();
                    }
                }
                l.to_string()
            })
            .collect::<Vec<_>>()
            .join("\n");
        serde_json::from_str(&clean).unwrap_or_else(|_| serde_json::json!({}))
    } else {
        if let Some(parent) = config_path.parent() {
            fs::create_dir_all(parent).map_err(|e| e.to_string())?;
        }
        serde_json::json!({})
    };

    let obj = root.as_object_mut().ok_or("Config root is not a JSON object")?;
    let section = obj
        .entry(key_path)
        .or_insert_with(|| serde_json::json!({}))
        .as_object_mut()
        .ok_or("Config section is not a JSON object")?;

    if section.get(entry_name) == Some(&entry_value) {
        return Ok(false); // Already identical — idempotent
    }
    section.insert(entry_name.to_string(), entry_value);

    let out = serde_json::to_string_pretty(&root).map_err(|e| e.to_string())?;
    fs::write(config_path, out).map_err(|e| e.to_string())?;
    Ok(true)
}

fn register_claude(mcp_url: &str) -> CliRegistrationResult {
    let args = vec![
        "mcp", "add", "--transport", "http",
        "terminal-docks", mcp_url, "--scope", "user",
    ];
    let output = Command::new("claude")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).to_lowercase();
            let already = stderr.contains("already exists") || stderr.contains("already registered");
            if o.status.success() || already {
                CliRegistrationResult {
                    cli: "claude".into(),
                    success: true,
                    message: if already {
                        "claude MCP server already registered".into()
                    } else {
                        "claude MCP server registered successfully".into()
                    },
                }
            } else {
                CliRegistrationResult {
                    cli: "claude".into(),
                    success: false,
                    message: format!("Failed: {}", String::from_utf8_lossy(&o.stderr).trim()),
                }
            }
        }
        Err(e) => CliRegistrationResult {
            cli: "claude".into(),
            success: false,
            message: format!("Could not run claude: {}", e),
        },
    }
}

fn register_gemini(mcp_url: &str) -> CliRegistrationResult {
    let home = match home_dir() {
        Some(h) => h,
        None => return CliRegistrationResult {
            cli: "gemini".into(), success: false,
            message: "Could not determine home directory".into(),
        },
    };
    let config_path = home.join(".gemini").join("settings.json");
    let entry = serde_json::json!({ "httpUrl": mcp_url });

    match merge_json_config(&config_path, "mcpServers", "terminal-docks", entry) {
        Ok(true)  => CliRegistrationResult { cli: "gemini".into(), success: true,
            message: format!("gemini MCP server registered in {}", config_path.display()) },
        Ok(false) => CliRegistrationResult { cli: "gemini".into(), success: true,
            message: "gemini MCP server already registered".into() },
        Err(e)    => CliRegistrationResult { cli: "gemini".into(), success: false,
            message: format!("Failed to write gemini config: {}", e) },
    }
}

fn register_opencode(mcp_url: &str) -> CliRegistrationResult {
    let home = match home_dir() {
        Some(h) => h,
        None => return CliRegistrationResult {
            cli: "opencode".into(), success: false,
            message: "Could not determine home directory".into(),
        },
    };
    let config_path = home.join(".config").join("opencode").join("opencode.json");
    let entry = serde_json::json!({ "type": "remote", "url": mcp_url, "enabled": true });

    match merge_json_config(&config_path, "mcp", "terminal-docks", entry) {
        Ok(true)  => CliRegistrationResult { cli: "opencode".into(), success: true,
            message: format!("opencode MCP server registered in {}", config_path.display()) },
        Ok(false) => CliRegistrationResult { cli: "opencode".into(), success: true,
            message: "opencode MCP server already registered".into() },
        Err(e)    => CliRegistrationResult { cli: "opencode".into(), success: false,
            message: format!("Failed to write opencode config: {}", e) },
    }
}

fn is_cli_available(bin: &str) -> bool {
    let check = if cfg!(target_os = "windows") {
        Command::new("where").arg(bin).output()
    } else {
        Command::new("which").arg(bin).output()
    };
    check.map(|o| o.status.success()).unwrap_or(false)
}

fn register_with_ai_clis(app_handle: &AppHandle, mcp_url: &str) {
    let registrations: Vec<(&str, Box<dyn Fn(&str) -> CliRegistrationResult>)> = vec![
        ("claude",   Box::new(register_claude)),
        ("gemini",   Box::new(register_gemini)),
        ("opencode", Box::new(register_opencode)),
    ];

    for (bin, register_fn) in registrations {
        if !is_cli_available(bin) {
            continue;
        }

        let result = register_fn(mcp_url);
        println!("[mcp] CLI registration: {} — {}", result.cli, result.message);
        let _ = app_handle.emit("mcp-cli-registered", result);
    }
}

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

        register_with_ai_clis(&app_handle, &format!("{}/mcp", base));

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
