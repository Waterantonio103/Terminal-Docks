use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, VecDeque};
use std::fs;
use std::io::{Read, Write};
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

const RECENT_OUTPUT_CAPACITY: usize = 16384;
const PERMISSION_EXCERPT_LIMIT: usize = 500;
const PERMISSION_DEDUPE_LIMIT: usize = 160;

pub struct PtyInstance {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
    pub recent_output: Arc<Mutex<VecDeque<u8>>>,
}

pub struct PtyState {
    pub ptys: Mutex<HashMap<String, PtyInstance>>,
    pub(crate) terminal_metadata: Mutex<HashMap<String, TerminalRuntimeMetadata>>,
    pub(crate) permission_requests: Mutex<HashMap<String, WorkflowPermissionRequest>>,
    pub(crate) permission_dedupe: Mutex<HashMap<String, String>>,
    pub(crate) permission_audit: Mutex<Vec<PermissionAuditEntry>>,
}

#[cfg(target_os = "windows")]
fn windows_command_candidates(command: &str) -> Vec<String> {
    let path = std::path::Path::new(command);
    if path.extension().is_some() {
        return vec![command.to_string()];
    }
    vec![format!("{}.cmd", command), command.to_string()]
}

#[cfg(not(target_os = "windows"))]
fn windows_command_candidates(command: &str) -> Vec<String> {
    vec![command.to_string()]
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .map(PathBuf::from)
}

fn normalize_codex_home_env(command: &str, cwd: Option<&str>, env: &mut HashMap<String, String>) {
    if !command.eq_ignore_ascii_case("codex") {
        return;
    }

    let raw = match env
        .get("CODEX_HOME")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        Some(value) => value.to_string(),
        None => return,
    };

    let home_path = PathBuf::from(&raw);
    if home_path.is_absolute() {
        return;
    }

    let base = match cwd.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => PathBuf::from(value),
        None => return,
    };

    env.insert(
        "CODEX_HOME".to_string(),
        base.join(home_path).to_string_lossy().to_string(),
    );
}

fn seed_codex_auth_if_needed(command: &str, env: &HashMap<String, String>) -> Result<(), String> {
    if !command.eq_ignore_ascii_case("codex") {
        return Ok(());
    }

    let codex_home = match env
        .get("CODEX_HOME")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        Some(path) => PathBuf::from(path),
        None => return Ok(()),
    };

    let auth_dst = codex_home.join("auth.json");
    if auth_dst.exists() {
        return Ok(());
    }

    let source_home = match home_dir() {
        Some(home) => home.join(".codex"),
        None => return Ok(()),
    };
    let auth_src = source_home.join("auth.json");
    if !auth_src.exists() {
        return Ok(());
    }

    fs::create_dir_all(&codex_home).map_err(|e| e.to_string())?;
    fs::copy(&auth_src, &auth_dst).map_err(|e| e.to_string())?;

    let cap_src = source_home.join("cap_sid");
    let cap_dst = codex_home.join("cap_sid");
    if cap_src.exists() && !cap_dst.exists() {
        let _ = fs::copy(cap_src, cap_dst);
    }

    Ok(())
}

fn find_project_trust_root(cwd: &str) -> PathBuf {
    let mut current = PathBuf::from(cwd);
    loop {
        if current.join(".git").exists() {
            return current;
        }
        if !current.pop() {
            return PathBuf::from(cwd);
        }
    }
}

fn codex_project_key(path: &std::path::Path) -> String {
    path.to_string_lossy()
        .replace('/', "\\")
        .trim_end_matches('\\')
        .to_lowercase()
}

fn seed_codex_trust_if_needed(
    command: &str,
    cwd: Option<&str>,
    env: &HashMap<String, String>,
) -> Result<(), String> {
    if !command.eq_ignore_ascii_case("codex") {
        return Ok(());
    }

    let codex_home = match env
        .get("CODEX_HOME")
        .map(|value| value.trim())
        .filter(|value| !value.is_empty())
    {
        Some(path) => PathBuf::from(path),
        None => return Ok(()),
    };
    let cwd = match cwd.map(str::trim).filter(|value| !value.is_empty()) {
        Some(value) => value,
        None => return Ok(()),
    };

    fs::create_dir_all(&codex_home).map_err(|e| e.to_string())?;
    let config_path = codex_home.join("config.toml");
    let project_key = codex_project_key(&find_project_trust_root(cwd));
    let table_header = format!("[projects.'{}']", project_key);
    let existing = fs::read_to_string(&config_path).unwrap_or_default();
    if existing.contains(&table_header) {
        return Ok(());
    }

    let mut next = existing;
    if !next.is_empty() && !next.ends_with('\n') {
        next.push('\n');
    }
    next.push('\n');
    next.push_str(&table_header);
    next.push_str("\ntrust_level = \"trusted\"\n");
    fs::write(config_path, next).map_err(|e| e.to_string())
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            ptys: Mutex::new(HashMap::new()),
            terminal_metadata: Mutex::new(HashMap::new()),
            permission_requests: Mutex::new(HashMap::new()),
            permission_dedupe: Mutex::new(HashMap::new()),
            permission_audit: Mutex::new(Vec::new()),
        }
    }
}

fn push_recent_output(buf: &mut VecDeque<u8>, bytes: &[u8]) {
    if bytes.len() >= RECENT_OUTPUT_CAPACITY {
        buf.clear();
        buf.extend(
            bytes[bytes.len() - RECENT_OUTPUT_CAPACITY..]
                .iter()
                .copied(),
        );
        return;
    }

    let overflow = buf.len() + bytes.len();
    if overflow > RECENT_OUTPUT_CAPACITY {
        let to_drop = overflow - RECENT_OUTPUT_CAPACITY;
        for _ in 0..to_drop {
            let _ = buf.pop_front();
        }
    }

    buf.extend(bytes.iter().copied());
}

fn maybe_answer_terminal_query(state: &PtyState, id: &str, chunk: &str) {
    if !chunk.contains("\x1b[6n") {
        return;
    }

    let mut ptys = state.ptys.lock().unwrap();
    if let Some(instance) = ptys.get_mut(id) {
        let _ = instance.writer.write_all(b"\x1b[1;1R");
        let _ = instance.writer.flush();
    }
}

#[derive(Clone, serde::Serialize)]
struct Payload {
    id: String,
    data: Vec<u8>,
}

#[derive(Clone, serde::Serialize)]
struct PtyExitPayload {
    id: String,
}

#[derive(Clone, Debug, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct TerminalRuntimeMetadata {
    pub terminal_id: String,
    pub mission_id: Option<String>,
    pub node_id: Option<String>,
    pub runtime_session_id: Option<String>,
    pub attempt: Option<u32>,
    pub cli: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum PermissionRequestState {
    Pending,
    Approved,
    Denied,
    Injected,
    Failed,
    Expired,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct WorkflowPermissionRequest {
    pub id: String,
    pub node_id: Option<String>,
    pub runtime_session_id: Option<String>,
    pub terminal_id: String,
    pub cli: String,
    pub permission_type: String,
    pub label: String,
    pub message: String,
    pub dedupe_key: String,
    pub timestamp: u64,
    pub state: PermissionRequestState,
    pub decision: Option<String>,
    pub actor: Option<String>,
    pub resolved_at: Option<u64>,
    pub error: Option<String>,
}

#[derive(Clone, Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct PermissionAuditEntry {
    pub request_id: String,
    pub terminal_id: String,
    pub node_id: Option<String>,
    pub runtime_session_id: Option<String>,
    pub cli: String,
    pub permission_type: String,
    pub prompt_excerpt: String,
    pub decision: Option<String>,
    pub state: PermissionRequestState,
    pub actor: String,
    pub timestamp: u64,
    pub error: Option<String>,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PermissionClassification {
    pub permission_type: String,
    pub label: String,
    pub excerpt: String,
    pub dedupe_key: String,
}

fn unix_millis_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn normalize_cli(cli: Option<&str>) -> String {
    let value = cli.unwrap_or("generic").trim().to_lowercase();
    if value.is_empty() {
        "generic".to_string()
    } else {
        value
    }
}

fn strip_ansi(raw: &str) -> String {
    let mut out = String::with_capacity(raw.len());
    let mut chars = raw.chars().peekable();
    while let Some(ch) = chars.next() {
        if ch == '\u{1b}' {
            if chars.peek() == Some(&'[') {
                let _ = chars.next();
                while let Some(next) = chars.next() {
                    if ('@'..='~').contains(&next) {
                        break;
                    }
                }
            }
            continue;
        }
        out.push(ch);
    }
    out
}

fn normalize_prompt_text(raw: &str) -> String {
    strip_ansi(raw)
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ")
        .trim()
        .to_string()
}

fn tail_chars(value: &str, limit: usize) -> String {
    let chars: Vec<char> = value.chars().collect();
    let start = chars.len().saturating_sub(limit);
    chars[start..].iter().collect()
}

fn contains_any(text: &str, needles: &[&str]) -> bool {
    needles.iter().any(|needle| text.contains(needle))
}

fn looks_like_permission_prompt(cli: &str, lower: &str) -> bool {
    let has_choice = lower.contains("[y/n]")
        || lower.contains("(y/n)")
        || lower.contains(" yes/no")
        || lower.contains("[approve")
        || lower.contains("approve?")
        || lower.contains("allow?");

    let cli_match = match cli {
        "codex" => {
            ((has_choice || lower.contains("?") || lower.contains("requires approval"))
                && contains_any(
                    lower,
                    &["allow", "approve", "do you want to", "requires approval"],
                )
                && contains_any(
                    lower,
                    &[
                        "command", "shell", "exec", "execute", "run", "network", "retry", "edit",
                        "write", "patch",
                    ],
                ))
                || lower.contains("requires approval")
        }
        "claude" => {
            (lower.contains("permission")
                && contains_any(lower, &["use", "run", "execute", "edit", "write", "tool"]))
                || lower.contains("do you want to proceed")
                || (lower.contains("allow") && lower.contains("tool"))
        }
        "gemini" => {
            contains_any(lower, &["confirm", "proceed", "allow"])
                && contains_any(
                    lower,
                    &["command", "tool", "edit", "write", "execute", "run"],
                )
        }
        "generic" | "custom" | "opencode" => {
            contains_any(
                lower,
                &["permission", "approve", "allow", "confirm", "proceed"],
            ) && (has_choice
                || contains_any(
                    lower,
                    &[
                        "command", "tool", "edit", "write", "execute", "run", "network", "retry",
                    ],
                ))
        }
        _ => false,
    };

    cli_match
        || (has_choice
            && contains_any(
                lower,
                &["permission", "approve", "allow", "confirm", "proceed"],
            ))
}

pub fn classify_permission_prompt(raw: &str, cli: &str) -> Option<PermissionClassification> {
    let text = normalize_prompt_text(raw);
    if text.is_empty() {
        return None;
    }
    let cli = normalize_cli(Some(cli));
    let lower = text.to_lowercase();
    if !looks_like_permission_prompt(&cli, &lower) {
        return None;
    }

    let (permission_type, label) = if contains_any(
        &lower,
        &[
            "network", "internet", "download", "fetch", "registry", "http://", "https://",
        ],
    ) {
        ("network_access", "Network access")
    } else if contains_any(&lower, &["retry", "try again", "rerun"]) {
        ("command_retry", "Command retry")
    } else if contains_any(
        &lower,
        &["edit", "write", "modify", "file", "patch", "save"],
    ) {
        ("file_edit", "File edit")
    } else if contains_any(
        &lower,
        &[
            "shell",
            "command",
            "bash",
            "powershell",
            "cmd.exe",
            "execute",
            "exec",
            "run",
        ],
    ) {
        ("shell", "Shell execution")
    } else {
        ("runtime_action", "Runtime action")
    };

    let excerpt = tail_chars(&text, PERMISSION_EXCERPT_LIMIT);
    let dedupe_part = tail_chars(&excerpt, PERMISSION_DEDUPE_LIMIT).to_lowercase();

    Some(PermissionClassification {
        permission_type: permission_type.to_string(),
        label: label.to_string(),
        excerpt,
        dedupe_key: format!("{cli}:{permission_type}:{dedupe_part}"),
    })
}

fn permission_decision_input(cli: &str, decision: &str) -> Result<&'static str, String> {
    let approved = match decision {
        "approve" => true,
        "deny" => false,
        other => return Err(format!("Unsupported permission decision: {}", other)),
    };

    match cli {
        "codex" | "claude" | "gemini" | "opencode" | "custom" | "generic" | "" => {
            Ok(if approved { "y\r" } else { "n\r" })
        }
        other => Err(format!(
            "Permission decision mapping is not configured for CLI '{}'.",
            other
        )),
    }
}

fn audit_permission(state: &PtyState, request: &WorkflowPermissionRequest, actor: &str) {
    let mut audit = state.permission_audit.lock().unwrap();
    audit.push(PermissionAuditEntry {
        request_id: request.id.clone(),
        terminal_id: request.terminal_id.clone(),
        node_id: request.node_id.clone(),
        runtime_session_id: request.runtime_session_id.clone(),
        cli: request.cli.clone(),
        permission_type: request.permission_type.clone(),
        prompt_excerpt: request.message.clone(),
        decision: request.decision.clone(),
        state: request.state.clone(),
        actor: actor.to_string(),
        timestamp: unix_millis_now(),
        error: request.error.clone(),
    });
    if audit.len() > 1000 {
        let overflow = audit.len() - 1000;
        audit.drain(0..overflow);
    }
}

fn emit_permission_update(app: &AppHandle, request: &WorkflowPermissionRequest) {
    let _ = app.emit("workflow-permission-updated", request.clone());
}

fn maybe_emit_permission_request(
    app: &AppHandle,
    state: &PtyState,
    terminal_id: &str,
    chunk: &str,
) {
    let metadata = state
        .terminal_metadata
        .lock()
        .unwrap()
        .get(terminal_id)
        .cloned()
        .unwrap_or_else(|| TerminalRuntimeMetadata {
            terminal_id: terminal_id.to_string(),
            mission_id: None,
            node_id: None,
            runtime_session_id: None,
            attempt: None,
            cli: Some("generic".to_string()),
        });

    let cli = normalize_cli(metadata.cli.as_deref());
    let Some(classification) = classify_permission_prompt(chunk, &cli) else {
        return;
    };

    {
        let dedupe = state.permission_dedupe.lock().unwrap();
        if let Some(existing_id) = dedupe.get(&classification.dedupe_key) {
            let requests = state.permission_requests.lock().unwrap();
            if matches!(
                requests.get(existing_id).map(|request| &request.state),
                Some(PermissionRequestState::Pending)
                    | Some(PermissionRequestState::Approved)
                    | Some(PermissionRequestState::Denied)
                    | Some(PermissionRequestState::Injected)
            ) {
                return;
            }
        }
    }

    let request = WorkflowPermissionRequest {
        id: format!("perm-{}", uuid::Uuid::new_v4()),
        node_id: metadata.node_id,
        runtime_session_id: metadata.runtime_session_id,
        terminal_id: terminal_id.to_string(),
        cli,
        permission_type: classification.permission_type,
        label: classification.label,
        message: classification.excerpt,
        dedupe_key: classification.dedupe_key,
        timestamp: unix_millis_now(),
        state: PermissionRequestState::Pending,
        decision: None,
        actor: None,
        resolved_at: None,
        error: None,
    };

    state
        .permission_dedupe
        .lock()
        .unwrap()
        .insert(request.dedupe_key.clone(), request.id.clone());
    state
        .permission_requests
        .lock()
        .unwrap()
        .insert(request.id.clone(), request.clone());
    audit_permission(state, &request, "backend");
    let _ = app.emit("workflow-permission-requested", request);
}

fn expire_terminal_permissions(app: &AppHandle, state: &PtyState, terminal_id: &str) {
    state.terminal_metadata.lock().unwrap().remove(terminal_id);
    let mut expired = Vec::new();
    {
        let mut requests = state.permission_requests.lock().unwrap();
        for request in requests.values_mut() {
            if request.terminal_id == terminal_id
                && request.state == PermissionRequestState::Pending
            {
                request.state = PermissionRequestState::Expired;
                request.resolved_at = Some(unix_millis_now());
                request.error =
                    Some("PTY exited before a permission decision was handled.".to_string());
                expired.push(request.clone());
            }
        }
    }
    for request in expired {
        audit_permission(state, &request, "backend");
        emit_permission_update(app, &request);
    }
}

#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    env: Option<HashMap<String, String>>,
) -> Result<bool, String> {
    {
        let ptys = state.ptys.lock().unwrap();
        if ptys.contains_key(&id) {
            return Err(format!("PTY already exists for terminalId {}", id));
        }
    }

    let pty_system = NativePtySystem::default();
    let pty_size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };

    let pair = pty_system
        .openpty(pty_size)
        .map_err(|e| format!("Failed to open pty: {}", e))?;

    let shell = if cfg!(target_os = "windows") {
        std::env::var("COMSPEC").unwrap_or_else(|_| "powershell.exe".to_string())
    } else {
        std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string())
    };

    let mut cmd = CommandBuilder::new(shell);
    cmd.env("TERM", "xterm-256color");

    // Phase 1: Inject MCP auto-connection config
    cmd.env("TD_SESSION_ID", &id);
    let mcp_state = app.state::<crate::mcp::McpState>();
    let mcp_url = crate::mcp::get_mcp_url(mcp_state);
    cmd.env("TD_MCP_URL", mcp_url);
    if let Some(vars) = env {
        for (key, value) in vars {
            cmd.env(key, value);
        }
    }

    if !cfg!(target_os = "windows") {
        cmd.args(["-l", "-i"]);
    }

    if let Some(path) = cwd {
        if !path.is_empty() {
            cmd.cwd(path);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command: {}", e))?;

    let master = pair.master;
    let writer = master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let recent_output = Arc::new(Mutex::new(VecDeque::with_capacity(RECENT_OUTPUT_CAPACITY)));
    let instance = PtyInstance {
        master,
        writer,
        child,
        recent_output: Arc::clone(&recent_output),
    };

    {
        let mut ptys = state.ptys.lock().unwrap();
        if ptys.contains_key(&id) {
            return Err(format!("PTY already exists for terminalId {} (race)", id));
        }
        ptys.insert(id.clone(), instance);
    }

    let id_clone = id.clone();
    let app_clone = app.clone();

    thread::spawn(move || {
        let mut buf = [0; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let chunk = String::from_utf8_lossy(&data).to_string();
                    {
                        let mut recent = recent_output.lock().unwrap();
                        push_recent_output(&mut recent, &data);
                    }
                    let pty_state = app_clone.state::<PtyState>();
                    maybe_answer_terminal_query(&pty_state, &id_clone, &chunk);
                    maybe_emit_permission_request(&app_clone, &pty_state, &id_clone, &chunk);
                    if let Some(metadata) = pty_state
                        .terminal_metadata
                        .lock()
                        .unwrap()
                        .get(&id_clone)
                        .cloned()
                    {
                        crate::db::append_pty_output_direct(
                            &app_clone,
                            &id_clone,
                            metadata.mission_id.as_deref(),
                            metadata.node_id.as_deref(),
                            metadata.runtime_session_id.as_deref(),
                            metadata.attempt,
                            &chunk,
                        );
                    }
                    let _ = app_clone.emit(
                        "pty-out",
                        Payload {
                            id: id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let child_exited = 'outer: loop {
            thread::sleep(std::time::Duration::from_millis(250));
            let pty_state = app_clone.state::<PtyState>();
            let mut ptys = pty_state.ptys.lock().unwrap();
            match ptys.get_mut(&id_clone) {
                Some(instance) => match instance.child.try_wait() {
                    Ok(None) => continue 'outer,
                    _ => {
                        let _ = ptys.remove(&id_clone);
                        break 'outer true;
                    }
                },
                None => break 'outer true,
            }
        };
        if child_exited {
            let pty_state = app_clone.state::<PtyState>();
            expire_terminal_permissions(&app_clone, &pty_state, &id_clone);
            let _ = app_clone.emit("pty-exit", PtyExitPayload { id: id_clone });
        }
    });

    Ok(true)
}

#[tauri::command]
pub fn spawn_pty_with_command(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
    command: String,
    args: Vec<String>,
    env: Option<HashMap<String, String>>,
) -> Result<bool, String> {
    {
        let ptys = state.ptys.lock().unwrap();
        if ptys.contains_key(&id) {
            return Err(format!("PTY already exists for terminalId {}", id));
        }
    }

    let pty_system = NativePtySystem::default();
    let pty_size = PtySize {
        rows,
        cols,
        pixel_width: 0,
        pixel_height: 0,
    };
    let pair = pty_system
        .openpty(pty_size)
        .map_err(|e| format!("Failed to open pty: {}", e))?;

    let mcp_state = app.state::<crate::mcp::McpState>();
    let mcp_url = crate::mcp::get_mcp_url(mcp_state);
    let mut launch_env = env.unwrap_or_default();
    normalize_codex_home_env(&command, cwd.as_deref(), &mut launch_env);
    seed_codex_auth_if_needed(&command, &launch_env)?;
    seed_codex_trust_if_needed(&command, cwd.as_deref(), &launch_env)?;
    let candidates = windows_command_candidates(&command);
    let mut last_error: Option<String> = None;
    let mut child = None;

    for candidate in candidates {
        let mut cmd = CommandBuilder::new(&candidate);
        cmd.env("TERM", "xterm-256color");
        cmd.env("TD_SESSION_ID", &id);
        cmd.env("TD_MCP_URL", mcp_url.clone());
        for arg in &args {
            cmd.arg(arg);
        }
        for (key, value) in &launch_env {
            cmd.env(key, value);
        }
        if let Some(ref path) = cwd {
            if !path.is_empty() {
                cmd.cwd(path);
            }
        }

        match pair.slave.spawn_command(cmd) {
            Ok(spawned) => {
                child = Some(spawned);
                break;
            }
            Err(error) => {
                last_error = Some(format!("{}: {}", candidate, error));
            }
        }
    }

    let child = child.ok_or_else(|| {
        format!(
            "Failed to spawn command '{}': {}",
            command,
            last_error.unwrap_or_else(|| "no launch candidates were tried".to_string())
        )
    })?;

    let master = pair.master;
    let writer = master
        .take_writer()
        .map_err(|e| format!("Failed to take writer: {}", e))?;
    let mut reader = master
        .try_clone_reader()
        .map_err(|e| format!("Failed to clone reader: {}", e))?;

    let recent_output = Arc::new(Mutex::new(VecDeque::with_capacity(RECENT_OUTPUT_CAPACITY)));
    let instance = PtyInstance {
        master,
        writer,
        child,
        recent_output: Arc::clone(&recent_output),
    };

    {
        let mut ptys = state.ptys.lock().unwrap();
        if ptys.contains_key(&id) {
            return Err(format!("PTY already exists for terminalId {} (race)", id));
        }
        ptys.insert(id.clone(), instance);
    }

    let id_clone = id.clone();
    let app_clone = app.clone();

    thread::spawn(move || {
        let mut buf = [0; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    let chunk = String::from_utf8_lossy(&data).to_string();
                    {
                        let mut recent = recent_output.lock().unwrap();
                        push_recent_output(&mut recent, &data);
                    }
                    let pty_state = app_clone.state::<PtyState>();
                    maybe_answer_terminal_query(&pty_state, &id_clone, &chunk);
                    maybe_emit_permission_request(&app_clone, &pty_state, &id_clone, &chunk);
                    if let Some(metadata) = pty_state
                        .terminal_metadata
                        .lock()
                        .unwrap()
                        .get(&id_clone)
                        .cloned()
                    {
                        crate::db::append_pty_output_direct(
                            &app_clone,
                            &id_clone,
                            metadata.mission_id.as_deref(),
                            metadata.node_id.as_deref(),
                            metadata.runtime_session_id.as_deref(),
                            metadata.attempt,
                            &chunk,
                        );
                    }
                    let _ = app_clone.emit(
                        "pty-out",
                        Payload {
                            id: id_clone.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
        }
        let child_exited = 'outer: loop {
            thread::sleep(std::time::Duration::from_millis(250));
            let pty_state = app_clone.state::<PtyState>();
            let mut ptys = pty_state.ptys.lock().unwrap();
            match ptys.get_mut(&id_clone) {
                Some(instance) => match instance.child.try_wait() {
                    Ok(None) => continue 'outer,
                    _ => {
                        let _ = ptys.remove(&id_clone);
                        break 'outer true;
                    }
                },
                None => break 'outer true,
            }
        };
        if child_exited {
            let pty_state = app_clone.state::<PtyState>();
            expire_terminal_permissions(&app_clone, &pty_state, &id_clone);
            let _ = app_clone.emit("pty-exit", PtyExitPayload { id: id_clone });
        }
    });

    Ok(true)
}

#[tauri::command]
pub fn get_pty_recent_output(
    state: State<'_, PtyState>,
    id: String,
    max_bytes: Option<usize>,
) -> Result<String, String> {
    let ptys = state.ptys.lock().unwrap();
    let instance = ptys
        .get(&id)
        .ok_or_else(|| format!("PTY not found: {}", id))?;

    let recent = instance.recent_output.lock().unwrap();
    let cap = max_bytes.unwrap_or(RECENT_OUTPUT_CAPACITY).max(1);
    let len = recent.len();
    let start = len.saturating_sub(cap);
    let bytes: Vec<u8> = recent.iter().skip(start).copied().collect();
    Ok(String::from_utf8_lossy(&bytes).to_string())
}

#[tauri::command]
pub fn is_pty_active(state: State<'_, PtyState>, id: String) -> bool {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(instance) = ptys.get_mut(&id) {
        match instance.child.try_wait() {
            Ok(None) => true,
            _ => {
                let _ = ptys.remove(&id);
                false
            }
        }
    } else {
        false
    }
}

#[tauri::command]
pub fn write_to_pty(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(instance) = ptys.get_mut(&id) {
        let bytes = data.as_bytes();
        // Use a chunked approach for large inputs to avoid overwhelming the PTY buffer
        // especially on Windows/ConPTY which can be sensitive to large rapid writes.
        if bytes.len() > 512 {
            for chunk in bytes.chunks(512) {
                instance
                    .writer
                    .write_all(chunk)
                    .map_err(|e| format!("Failed to write to PTY {}: {}", id, e))?;
                instance
                    .writer
                    .flush()
                    .map_err(|e| format!("Failed to flush PTY {}: {}", id, e))?;
                // Tiny sleep to allow the PTY driver to process the chunk
                thread::sleep(std::time::Duration::from_millis(5));
            }
        } else {
            instance
                .writer
                .write_all(bytes)
                .map_err(|e| format!("Failed to write to PTY {}: {}", id, e))?;
            instance
                .writer
                .flush()
                .map_err(|e| format!("Failed to flush PTY {}: {}", id, e))?;
        }
        Ok(())
    } else {
        Err(format!("Terminal ID {} not found in active PTY state.", id))
    }
}

#[tauri::command]
pub fn handle_workflow_permission_decision(
    app: AppHandle,
    state: State<'_, PtyState>,
    request_id: String,
    decision: String,
) -> Result<(), String> {
    let normalized_decision = decision.trim().to_lowercase();
    let mut request = {
        let mut requests = state.permission_requests.lock().unwrap();
        let request = requests
            .get_mut(&request_id)
            .ok_or_else(|| format!("Permission request {} was not found.", request_id))?;
        if request.state != PermissionRequestState::Pending {
            return Err(format!(
                "Permission request {} is already {:?}.",
                request_id, request.state
            ));
        }
        request.decision = Some(normalized_decision.clone());
        request.actor = Some("user".to_string());
        request.state = if normalized_decision == "approve" {
            PermissionRequestState::Approved
        } else if normalized_decision == "deny" {
            PermissionRequestState::Denied
        } else {
            return Err(format!("Unsupported permission decision: {}", decision));
        };
        request.resolved_at = Some(unix_millis_now());
        request.clone()
    };

    audit_permission(&state, &request, "user");
    emit_permission_update(&app, &request);

    let input = match permission_decision_input(request.cli.trim(), normalized_decision.as_str()) {
        Ok(value) => value,
        Err(error) => {
            request.state = PermissionRequestState::Failed;
            request.error = Some(error.clone());
            {
                let mut requests = state.permission_requests.lock().unwrap();
                requests.insert(request.id.clone(), request.clone());
            }
            audit_permission(&state, &request, "backend");
            emit_permission_update(&app, &request);
            return Err(error);
        }
    };

    let injection_result = {
        let mut ptys = state.ptys.lock().unwrap();
        if let Some(instance) = ptys.get_mut(&request.terminal_id) {
            instance
                .writer
                .write_all(input.as_bytes())
                .and_then(|_| instance.writer.flush())
                .map_err(|e| e.to_string())
        } else {
            Err(format!(
                "Terminal ID {} not found in active PTY state.",
                request.terminal_id
            ))
        }
    };

    match injection_result {
        Ok(()) => {
            request.state = PermissionRequestState::Injected;
            request.error = None;
            {
                let mut requests = state.permission_requests.lock().unwrap();
                requests.insert(request.id.clone(), request.clone());
            }
            audit_permission(&state, &request, "backend");
            emit_permission_update(&app, &request);
            Ok(())
        }
        Err(error) => {
            request.state = PermissionRequestState::Failed;
            request.error = Some(error.clone());
            {
                let mut requests = state.permission_requests.lock().unwrap();
                requests.insert(request.id.clone(), request.clone());
            }
            audit_permission(&state, &request, "backend");
            emit_permission_update(&app, &request);
            Err(error)
        }
    }
}

#[tauri::command]
pub fn register_pty_runtime_metadata(
    state: State<'_, PtyState>,
    terminal_id: String,
    mission_id: Option<String>,
    node_id: Option<String>,
    runtime_session_id: Option<String>,
    attempt: Option<u32>,
    cli: Option<String>,
) -> Result<(), String> {
    if terminal_id.trim().is_empty() {
        return Err("terminalId is required for runtime metadata.".to_string());
    }
    state.terminal_metadata.lock().unwrap().insert(
        terminal_id.clone(),
        TerminalRuntimeMetadata {
            terminal_id,
            mission_id: mission_id.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
            node_id: node_id.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
            runtime_session_id: runtime_session_id.and_then(|value| {
                let trimmed = value.trim().to_string();
                if trimmed.is_empty() {
                    None
                } else {
                    Some(trimmed)
                }
            }),
            attempt,
            cli: Some(normalize_cli(cli.as_deref())),
        },
    );
    Ok(())
}

#[tauri::command]
pub fn list_active_permission_requests(
    state: State<'_, PtyState>,
) -> Vec<WorkflowPermissionRequest> {
    state
        .permission_requests
        .lock()
        .unwrap()
        .values()
        .filter(|request| request.state != PermissionRequestState::Expired)
        .cloned()
        .collect()
}

#[tauri::command]
pub fn list_permission_audit_entries(state: State<'_, PtyState>) -> Vec<PermissionAuditEntry> {
    state.permission_audit.lock().unwrap().clone()
}

#[tauri::command]
pub fn resize_pty(
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(instance) = ptys.get_mut(&id) {
        let _ = instance.master.resize(PtySize {
            rows,
            cols,
            pixel_width: 0,
            pixel_height: 0,
        });
    }
    Ok(())
}

#[tauri::command]
pub fn destroy_pty(app: AppHandle, state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(mut instance) = ptys.remove(&id) {
        let _ = instance.child.kill();
    }
    drop(ptys);
    expire_terminal_permissions(&app, &state, &id);
    Ok(())
}

pub fn kill_all_ptys(app: &AppHandle) {
    let state = app.state::<PtyState>();
    let mut ptys = state.ptys.lock().unwrap();
    for (_, mut instance) in ptys.drain() {
        let _ = instance.child.kill();
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn classifier_detects_cli_permission_fixtures() {
        let codex = classify_permission_prompt(
            "Codex requires approval. Allow shell command npm run build? [y/n]",
            "codex",
        )
        .expect("codex shell prompt should classify");
        assert_eq!(codex.permission_type, "shell");
        assert_eq!(codex.label, "Shell execution");
        assert!(codex.dedupe_key.starts_with("codex:shell:"));

        let claude = classify_permission_prompt(
            "Claude needs permission to edit file src/App.tsx. Do you want to proceed?",
            "claude",
        )
        .expect("claude edit prompt should classify");
        assert_eq!(claude.permission_type, "file_edit");

        let gemini = classify_permission_prompt(
            "Confirm tool action: write changes to package.json? (y/n)",
            "gemini",
        )
        .expect("gemini tool prompt should classify");
        assert_eq!(gemini.permission_type, "file_edit");

        let generic = classify_permission_prompt(
            "Permission requested: network access to fetch registry metadata [y/n]",
            "generic",
        )
        .expect("generic network prompt should classify");
        assert_eq!(generic.permission_type, "network_access");
    }

    #[test]
    fn classifier_avoids_normal_task_prose_and_logs() {
        assert!(classify_permission_prompt(
            "The implementation should allow users to run tests from the toolbar.",
            "codex",
        )
        .is_none());
        assert!(classify_permission_prompt(
            "npm run build completed successfully in 3.4s",
            "generic",
        )
        .is_none());
    }

    #[test]
    fn adapter_decisions_are_cli_specific_and_explicit() {
        assert_eq!(
            permission_decision_input("codex", "approve").unwrap(),
            "y\r"
        );
        assert_eq!(permission_decision_input("claude", "deny").unwrap(), "n\r");
        assert_eq!(
            permission_decision_input("gemini", "approve").unwrap(),
            "y\r"
        );
        assert!(permission_decision_input("ollama", "approve").is_err());
        assert!(permission_decision_input("codex", "maybe").is_err());
    }

    #[test]
    fn pending_prompts_expire_on_pty_exit() {
        let state = PtyState::new();
        let request = WorkflowPermissionRequest {
            id: "perm-test".to_string(),
            node_id: Some("node-a".to_string()),
            runtime_session_id: Some("session-a".to_string()),
            terminal_id: "term-a".to_string(),
            cli: "codex".to_string(),
            permission_type: "shell".to_string(),
            label: "Shell execution".to_string(),
            message: "Allow shell command?".to_string(),
            dedupe_key: "codex:shell:allow shell command?".to_string(),
            timestamp: 1,
            state: PermissionRequestState::Pending,
            decision: None,
            actor: None,
            resolved_at: None,
            error: None,
        };
        state
            .permission_requests
            .lock()
            .unwrap()
            .insert(request.id.clone(), request);

        let mut expired = Vec::new();
        {
            let mut requests = state.permission_requests.lock().unwrap();
            for request in requests.values_mut() {
                if request.terminal_id == "term-a"
                    && request.state == PermissionRequestState::Pending
                {
                    request.state = PermissionRequestState::Expired;
                    expired.push(request.clone());
                }
            }
        }

        assert_eq!(expired.len(), 1);
        assert_eq!(expired[0].state, PermissionRequestState::Expired);
    }
}
