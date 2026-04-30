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

    let obj = root
        .as_object_mut()
        .ok_or("Config root is not a JSON object")?;
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
    // First, try to remove existing to ensure URL/token is updated
    let _ = Command::new("claude")
        .args(["mcp", "remove", "--scope", "user", "terminal-docks"])
        .output();

    // Use --transport http (streamable-HTTP, Claude Code's current transport).
    // All options must come BEFORE the server name per claude mcp add syntax.
    let args = vec![
        "mcp",
        "add",
        "--transport",
        "http",
        "--scope",
        "user",
        "terminal-docks",
        mcp_url,
    ];
    let output = Command::new("claude")
        .args(&args)
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .output();

    match output {
        Ok(o) => {
            let stderr = String::from_utf8_lossy(&o.stderr).to_lowercase();
            let already =
                stderr.contains("already exists") || stderr.contains("already registered");
            if o.status.success() || already {
                CliRegistrationResult {
                    cli: "claude".into(),
                    success: true,
                    message: "claude MCP server registered successfully".into(),
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
        None => {
            return CliRegistrationResult {
                cli: "gemini".into(),
                success: false,
                message: "Could not determine home directory".into(),
            }
        }
    };
    let config_path = home.join(".gemini").join("settings.json");
    let entry = serde_json::json!({ "httpUrl": mcp_url });

    match merge_json_config(&config_path, "mcpServers", "terminal-docks", entry) {
        Ok(true) => CliRegistrationResult {
            cli: "gemini".into(),
            success: true,
            message: format!("gemini MCP server registered in {}", config_path.display()),
        },
        Ok(false) => CliRegistrationResult {
            cli: "gemini".into(),
            success: true,
            message: "gemini MCP server already registered".into(),
        },
        Err(e) => CliRegistrationResult {
            cli: "gemini".into(),
            success: false,
            message: format!("Failed to write gemini config: {}", e),
        },
    }
}

fn register_opencode(mcp_url: &str) -> CliRegistrationResult {
    let home = match home_dir() {
        Some(h) => h,
        None => {
            return CliRegistrationResult {
                cli: "opencode".into(),
                success: false,
                message: "Could not determine home directory".into(),
            }
        }
    };
    let config_path = home.join(".config").join("opencode").join("opencode.json");
    let entry = serde_json::json!({ "type": "remote", "url": mcp_url, "enabled": true });

    match merge_json_config(&config_path, "mcp", "terminal-docks", entry) {
        Ok(true) => CliRegistrationResult {
            cli: "opencode".into(),
            success: true,
            message: format!(
                "opencode MCP server registered in {}",
                config_path.display()
            ),
        },
        Ok(false) => CliRegistrationResult {
            cli: "opencode".into(),
            success: true,
            message: "opencode MCP server already registered".into(),
        },
        Err(e) => CliRegistrationResult {
            cli: "opencode".into(),
            success: false,
            message: format!("Failed to write opencode config: {}", e),
        },
    }
}

fn register_codex(mcp_url: &str) -> CliRegistrationResult {
    if !is_cli_available("codex") {
        return CliRegistrationResult {
            cli: "codex".into(),
            success: false,
            message: "Could not run codex".into(),
        };
    }

    CliRegistrationResult {
        cli: "codex".into(),
        success: true,
        message: format!("codex MCP server will be injected per workflow launch via {}", mcp_url),
    }
}

fn register_aider(_mcp_url: &str) -> CliRegistrationResult {
    CliRegistrationResult {
        cli: "aider".into(),
        success: true,
        message: "Detected! Use with: aider --mcp http://127.0.0.1:3741/mcp".into(),
    }
}

fn register_goose(mcp_url: &str) -> CliRegistrationResult {
    let home = match home_dir() {
        Some(h) => h,
        None => {
            return CliRegistrationResult {
                cli: "goose".into(),
                success: false,
                message: "Could not determine home directory".into(),
            }
        }
    };

    let config_path = if cfg!(target_os = "windows") {
        PathBuf::from(std::env::var("APPDATA").unwrap_or_default())
            .join("goose")
            .join("config.yaml")
    } else {
        home.join(".config").join("goose").join("config.yaml")
    };

    CliRegistrationResult {
        cli: "goose".into(),
        success: true,
        message: if config_path.exists() {
            format!("Detected! Add {} to your goose config.yaml", mcp_url)
        } else {
            "Detected! Add the MCP URL to your goose config manually.".into()
        },
    }
}

fn register_claude_desktop(_mcp_url: &str) -> CliRegistrationResult {
    CliRegistrationResult {
        cli: "claude-desktop".into(),
        success: true,
        message: "Detected! Add the MCP URL to your Claude Desktop config for SSE support.".into(),
    }
}

fn register_interpreter(_mcp_url: &str) -> CliRegistrationResult {
    CliRegistrationResult {
        cli: "interpreter".into(),
        success: true,
        message: "Detected! Use with: interpreter --mcp http://127.0.0.1:3741/mcp".into(),
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

fn is_opencode_available() -> bool {
    if is_cli_available("opencode") {
        return true;
    }
    // Also detect opencode running as an Ollama model
    if !is_cli_available("ollama") {
        return false;
    }
    Command::new("ollama")
        .arg("list")
        .output()
        .map(|o| {
            String::from_utf8_lossy(&o.stdout)
                .lines()
                .any(|line| line.to_lowercase().starts_with("opencode"))
        })
        .unwrap_or(false)
}

fn is_desktop_available(name: &str) -> bool {
    let home = match home_dir() {
        Some(h) => h,
        None => return false,
    };
    let p = if name == "claude-desktop" {
        if cfg!(target_os = "windows") {
            PathBuf::from(std::env::var("APPDATA").unwrap_or_default())
                .join("Claude")
                .join("claude_desktop_config.json")
        } else if cfg!(target_os = "macos") {
            home.join("Library")
                .join("Application Support")
                .join("Claude")
                .join("claude_desktop_config.json")
        } else {
            home.join(".config")
                .join("Claude")
                .join("claude_desktop_config.json")
        }
    } else {
        return false;
    };
    p.parent().map(|p| p.exists()).unwrap_or(false)
}

fn register_with_ai_clis(app_handle: &AppHandle, mcp_url: &str) {
    let registrations: Vec<(&str, Box<dyn Fn(&str) -> CliRegistrationResult>)> = vec![
        ("claude", Box::new(register_claude)),
        ("codex", Box::new(register_codex)),
        ("gemini", Box::new(register_gemini)),
        ("opencode", Box::new(register_opencode)),
        ("aider", Box::new(register_aider)),
        ("goose", Box::new(register_goose)),
        ("interpreter", Box::new(register_interpreter)),
        ("claude-desktop", Box::new(register_claude_desktop)),
    ];

    for (bin, register_fn) in registrations {
        let available = if bin == "claude-desktop" {
            is_desktop_available(bin)
        } else if bin == "opencode" {
            is_opencode_available()
        } else {
            is_cli_available(bin)
        };

        if !available {
            continue;
        }

        let result = register_fn(mcp_url);
        println!(
            "[mcp] CLI registration: {} — {}",
            result.cli, result.message
        );
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
    pub auth_token: Arc<Mutex<String>>,
    pub internal_push_token: Arc<Mutex<String>>,
}

impl McpState {
    pub fn new() -> Self {
        Self {
            process: Arc::new(Mutex::new(None)),
            auth_token: Arc::new(Mutex::new(String::new())),
            internal_push_token: Arc::new(Mutex::new(String::new())),
        }
    }
}

fn generate_push_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    let mut bytes = [0u8; 24];
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.as_nanos())
        .unwrap_or(0);
    // Fold nanos + per-call counter into a deterministic but non-predictable
    // token. Good enough for a loopback-only handshake; not a cryptographic
    // secret but we never expose it past the Tauri process boundary.
    for (i, b) in bytes.iter_mut().enumerate() {
        *b = (((nanos as u64) >> ((i % 8) * 8)) as u8)
            ^ (((i as u64).wrapping_mul(2654435761)) as u8);
    }
    bytes.iter().map(|b| format!("{:02x}", b)).collect()
}

const PORT: u16 = 3741;

/// Load the persisted auth token, or generate and save a new one.
/// Persisting across restarts means already-running Claude instances keep working.
fn load_or_generate_auth_token(app: &AppHandle) -> String {
    let token_path = app
        .path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("mcp_auth.token"));

    if let Some(ref path) = token_path {
        if let Ok(token) = fs::read_to_string(path) {
            let t = token.trim().to_string();
            if !t.is_empty() {
                return t;
            }
        }
    }

    let token = generate_push_token();
    if let Some(path) = token_path {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, &token);
    }
    token
}

fn load_or_generate_push_token(app: &AppHandle) -> String {
    let token_path = app
        .path()
        .app_local_data_dir()
        .ok()
        .map(|d| d.join("mcp_push.token"));

    if let Some(ref path) = token_path {
        if let Ok(token) = fs::read_to_string(path) {
            let t = token.trim().to_string();
            if !t.is_empty() {
                return t;
            }
        }
    }

    let token = generate_push_token();
    if let Some(path) = token_path {
        if let Some(parent) = path.parent() {
            let _ = fs::create_dir_all(parent);
        }
        let _ = fs::write(&path, &token);
    }
    token
}

pub fn init_mcp_server(app: &AppHandle) -> Result<(), String> {
    {
        let state = app.state::<McpState>();
        let guard = state.process.lock().unwrap();
        if guard.is_some() {
            // Already running
            return Ok(());
        }
    }

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
        return Err(format!(
            "MCP server directory not found at {:?}",
            server_dir
        ));
    }

    let db_path = {
        let state = app.state::<crate::db::DbState>();
        state.db_path.clone()
    };

    let push_token = load_or_generate_push_token(app);
    // auth_token persists across restarts so already-running Claude instances keep working
    let auth_token = load_or_generate_auth_token(app);
    {
        let state = app.state::<McpState>();
        let mut p_guard = state.internal_push_token.lock().unwrap();
        *p_guard = push_token.clone();
        let mut a_guard = state.auth_token.lock().unwrap();
        *a_guard = auth_token.clone();
    }

    let child = Command::new("node")
        .arg("server.mjs")
        .current_dir(&server_dir)
        .env("MCP_DB_PATH", &db_path)
        .env("MCP_INTERNAL_PUSH_TOKEN", &push_token)
        .env("MCP_AUTH_TOKEN", &auth_token)
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
        let base = format!("http://127.0.0.1:{}", PORT);
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

        let token = {
            let state = app_handle.state::<McpState>();
            let t = state.auth_token.lock().unwrap().clone();
            t
        };
        register_with_ai_clis(&app_handle, &format!("{}/mcp?token={}", base, token));

        // Subscribe to SSE activity feed with reconnection loop so missed
        // handoff events do not permanently stall workflow graph advancement.
        let mut sse_backoff_ms: u64 = 1_000;
        'sse_reconnect: loop {
            let response = match ureq::get(&format!("{}/events?token={}", base, token)).call() {
                Ok(r) => r,
                Err(e) => {
                    eprintln!(
                        "[mcp] SSE connection failed: {}. Retrying in {}ms…",
                        e, sse_backoff_ms
                    );
                    let _ = app_handle.emit(
                        "workflow-runtime-warning",
                        serde_json::json!({
                            "missionId": "system",
                            "nodeId": "bridge",
                            "message": format!("SSE bridge disconnected: {}. Reconnecting…", e),
                        }),
                    );
                    thread::sleep(Duration::from_millis(sse_backoff_ms));
                    sse_backoff_ms = (sse_backoff_ms * 2).min(30_000);
                    continue 'sse_reconnect;
                }
            };
            sse_backoff_ms = 1_000;

            let reader = BufReader::new(response.into_reader());
            for line in reader.lines().flatten() {
                if let Some(data) = line.strip_prefix("data: ") {
                    if let Ok(msg) = serde_json::from_str::<McpMessage>(data) {
                        if msg.msg_type == "handoff" {
                            if let Ok(value) =
                                serde_json::from_str::<serde_json::Value>(&msg.content)
                            {
                                let mission_id = value
                                    .get("missionId")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string);
                                let from_node_id = value
                                    .get("fromNodeId")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string);
                                let from_attempt =
                                    value.get("fromAttempt").and_then(|v| v.as_u64());

                                let mission_for_diag =
                                    mission_id.clone().unwrap_or_else(|| "unknown".to_string());
                                let node_for_diag = from_node_id
                                    .clone()
                                    .unwrap_or_else(|| "unknown".to_string());

                                let mut invalid_reasons = Vec::new();
                                if mission_id.is_none() {
                                    invalid_reasons.push("missing missionId");
                                }
                                if from_node_id.is_none() {
                                    invalid_reasons.push("missing fromNodeId");
                                }
                                if from_attempt.is_none() {
                                    invalid_reasons.push("missing fromAttempt");
                                }

                                if !invalid_reasons.is_empty() {
                                    let reason = format!(
                                        "Rejected handoff envelope: {}",
                                        invalid_reasons.join(", ")
                                    );
                                    eprintln!("[mcp] {}", reason);
                                    let _ = app_handle.emit(
                                        "workflow-runtime-warning",
                                        serde_json::json!({
                                            "missionId": mission_for_diag,
                                            "nodeId": node_for_diag,
                                            "message": reason,
                                        }),
                                    );
                                } else if let (Some(mid), Ok(event)) = (
                                    mission_id,
                                    serde_json::from_value::<crate::workflow_engine::HandoffEvent>(
                                        value,
                                    ),
                                ) {
                                    crate::workflow_engine::handle_handoff(
                                        &app_handle,
                                        &mid,
                                        event,
                                    );
                                } else {
                                    let reason =
                                        "Rejected handoff envelope: failed to parse payload.";
                                    eprintln!("[mcp] {}", reason);
                                    let _ = app_handle.emit(
                                        "workflow-runtime-warning",
                                        serde_json::json!({
                                            "missionId": mission_for_diag,
                                            "nodeId": node_for_diag,
                                            "message": reason,
                                        }),
                                    );
                                }
                            }
                        } else if msg.msg_type == "adaptive_patch" {
                            if let Ok(value) =
                                serde_json::from_str::<serde_json::Value>(&msg.content)
                            {
                                let mission_id = value
                                    .get("missionId")
                                    .and_then(|v| v.as_str())
                                    .map(str::to_string);
                                let run_version =
                                    value.get("previousRunVersion").and_then(|v| v.as_u64());
                                let patch = value.get("patch").cloned();

                                let mission_for_diag =
                                    mission_id.clone().unwrap_or_else(|| "unknown".to_string());

                                let mut invalid_reasons = Vec::new();
                                if mission_id.is_none() {
                                    invalid_reasons.push("missing missionId");
                                }
                                if run_version.is_none() {
                                    invalid_reasons.push("missing previousRunVersion");
                                }
                                if patch.is_none() {
                                    invalid_reasons.push("missing patch");
                                }

                                if !invalid_reasons.is_empty() {
                                    let reason = format!(
                                        "Rejected adaptive patch envelope: {}",
                                        invalid_reasons.join(", ")
                                    );
                                    eprintln!("[mcp] {}", reason);
                                    let _ = app_handle.emit(
                                        "workflow-runtime-warning",
                                        serde_json::json!({
                                            "missionId": mission_for_diag,
                                            "nodeId": "adaptive",
                                            "message": reason,
                                        }),
                                    );
                                } else if let (Some(mid), Some(version), Some(patch_value)) =
                                    (mission_id, run_version, patch)
                                {
                                    let parsed_patch =
                                        serde_json::from_value::<
                                            crate::workflow_engine::MissionGraphPatch,
                                        >(patch_value);
                                    match parsed_patch {
                                        Ok(patch_payload) => {
                                            if let Err(error) =
                                                crate::workflow_engine::append_mission_patch(
                                                    app_handle.clone(),
                                                    mid.clone(),
                                                    version as u32,
                                                    patch_payload,
                                                )
                                            {
                                                let _ = app_handle.emit(
                                                "workflow-runtime-warning",
                                                serde_json::json!({
                                                    "missionId": mid,
                                                    "nodeId": "adaptive",
                                                    "message": format!("Adaptive patch rejected by scheduler: {}", error),
                                                }),
                                            );
                                            }
                                        }
                                        Err(error) => {
                                            let _ = app_handle.emit(
                                            "workflow-runtime-warning",
                                            serde_json::json!({
                                                "missionId": mid,
                                                "nodeId": "adaptive",
                                                "message": format!("Adaptive patch parse error: {}", error),
                                            }),
                                        );
                                        }
                                    }
                                }
                            }
                        }
                        let _ = app_handle.emit("mcp-message", msg);
                    }
                }
            }
            // Event loop ended — SSE stream was closed or dropped. Reconnect.
            eprintln!(
                "[mcp] SSE stream ended. Reconnecting in {}ms…",
                sse_backoff_ms
            );
            let _ = app_handle.emit(
                "workflow-runtime-warning",
                serde_json::json!({
                    "missionId": "system",
                    "nodeId": "bridge",
                    "message": "SSE bridge stream ended unexpectedly. Reconnecting…",
                }),
            );
            thread::sleep(Duration::from_millis(sse_backoff_ms));
            sse_backoff_ms = (sse_backoff_ms * 2).min(30_000);
        } // end 'sse_reconnect loop
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
pub fn get_mcp_url(state: tauri::State<'_, McpState>) -> String {
    let token = state.auth_token.lock().unwrap().clone();
    format!("http://127.0.0.1:{}/mcp?token={}", PORT, token)
}

#[tauri::command]
pub fn get_mcp_base_url() -> String {
    format!("http://127.0.0.1:{}", PORT)
}

#[derive(Debug, Clone, serde::Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeBootstrapRequest {
    pub session_id: String,
    pub mission_id: String,
    pub node_id: String,
    pub attempt: u64,
    pub role: String,
    pub profile_id: Option<String>,
    pub agent_id: String,
    pub terminal_id: String,
    pub cli: String,
    pub capabilities: Option<serde_json::Value>,
    pub working_dir: Option<String>,
    pub activation_id: Option<String>,
    pub run_id: Option<String>,
    pub execution_mode: Option<String>,
}

#[tauri::command]
pub fn mcp_register_runtime_session(
    state: tauri::State<'_, McpState>,
    payload: RuntimeBootstrapRequest,
) -> Result<serde_json::Value, String> {
    let token = state.internal_push_token.lock().unwrap().clone();
    if token.is_empty() {
        return Err("MCP push token not initialized".to_string());
    }

    let body = serde_json::json!({
      "type": "runtime_bootstrap",
      "sessionId": payload.session_id,
      "missionId": payload.mission_id,
      "nodeId": payload.node_id,
      "attempt": payload.attempt,
      "role": payload.role,
      "profileId": payload.profile_id,
      "agentId": payload.agent_id,
      "terminalId": payload.terminal_id,
      "cli": payload.cli,
      "capabilities": payload.capabilities,
      "workingDir": payload.working_dir,
      "activationId": payload.activation_id,
      "runId": payload.run_id,
      "executionMode": payload.execution_mode,
    });

    let url = format!("http://localhost:{}/internal/push", PORT);
    match ureq::post(&url)
        .set("x-td-push-token", &token)
        .send_json(body)
    {
        Ok(response) => {
            let status = response.status();
            let text = response.into_string().unwrap_or_default();
            let parsed: serde_json::Value = serde_json::from_str(&text)
                .unwrap_or(serde_json::json!({ "status": status, "raw": text }));
            Ok(parsed)
        }
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(format!(
                "mcp_register_runtime_session failed with HTTP {}: {}",
                code, body
            ))
        }
        Err(error) => Err(format!("mcp_register_runtime_session failed: {}", error)),
    }
}

/// Privileged notification from the Rust process to the MCP server.
/// Carries the push token as a loopback secret; renderer code never sees it.
#[tauri::command]
pub fn mcp_notify_agent(
    state: tauri::State<'_, McpState>,
    session_id: String,
    kind: String,
    mission_id: Option<String>,
    node_id: Option<String>,
    task_seq: Option<u64>,
    attempt: Option<u64>,
    reason: Option<String>,
    outcome: Option<String>,
    summary: Option<String>,
    raw_output: Option<String>,
) -> Result<serde_json::Value, String> {
    let token = state.internal_push_token.lock().unwrap().clone();
    if token.is_empty() {
        return Err("MCP push token not initialized".to_string());
    }

    let body = match kind.as_str() {
        "task_pushed" => serde_json::json!({
            "type": "task_pushed",
            "sessionId": session_id,
            "missionId": mission_id,
            "nodeId": node_id,
            "taskSeq": task_seq,
            "attempt": attempt,
        }),
        "bootstrap" => serde_json::json!({
            "type": "bootstrap",
            "sessionId": session_id,
        }),
        "runtime_disconnected" => serde_json::json!({
            "type": "runtime_disconnected",
            "sessionId": session_id,
            "missionId": mission_id,
            "nodeId": node_id,
            "attempt": attempt,
            "reason": reason,
        }),
        "runtime_task_completed" => serde_json::json!({
            "type": "runtime_task_completed",
            "sessionId": session_id,
            "missionId": mission_id,
            "nodeId": node_id,
            "attempt": attempt,
            "outcome": outcome,
            "summary": summary,
            "rawOutput": raw_output,
        }),
        other => return Err(format!("Unsupported notify kind: {}", other)),
    };

    let url = format!("http://localhost:{}/internal/push", PORT);
    match ureq::post(&url)
        .set("x-td-push-token", &token)
        .send_json(body)
    {
        Ok(response) => {
            let status = response.status();
            let text = response.into_string().unwrap_or_default();
            let parsed: serde_json::Value = serde_json::from_str(&text)
                .unwrap_or(serde_json::json!({ "status": status, "raw": text }));
            Ok(parsed)
        }
        Err(ureq::Error::Status(code, response)) => {
            let body = response.into_string().unwrap_or_default();
            Err(format!(
                "mcp_notify_agent failed with HTTP {}: {}",
                code, body
            ))
        }
        Err(error) => Err(format!("mcp_notify_agent failed: {}", error)),
    }
}
