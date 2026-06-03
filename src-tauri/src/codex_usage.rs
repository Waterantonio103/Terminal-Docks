use crate::process_utils::configure_hidden_command;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::mpsc;
use std::thread;
use std::time::{Duration, Instant};

const CODEX_APP_SERVER_TIMEOUT_MS: u64 = 8_000;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageLimitRow {
    id: String,
    label: String,
    percent: u8,
    reset: Option<String>,
    source_line: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct CodexUsageLimits {
    rows: Vec<CodexUsageLimitRow>,
    raw: Value,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitWindow {
    used_percent: f64,
    window_duration_mins: Option<u64>,
    resets_at: Option<i64>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct RateLimitSnapshot {
    limit_id: Option<String>,
    limit_name: Option<String>,
    primary: Option<RateLimitWindow>,
    secondary: Option<RateLimitWindow>,
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct GetAccountRateLimitsResponse {
    rate_limits: RateLimitSnapshot,
    rate_limits_by_limit_id: Option<std::collections::HashMap<String, RateLimitSnapshot>>,
}

#[tauri::command]
pub async fn read_codex_usage_limits() -> Result<CodexUsageLimits, String> {
    read_codex_usage_limits_blocking()
}

fn read_codex_usage_limits_blocking() -> Result<CodexUsageLimits, String> {
    let mut child = spawn_codex_app_server()?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Codex app-server stdout was unavailable".to_string())?;
    let mut stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Codex app-server stdin was unavailable".to_string())?;

    let (tx, rx) = mpsc::channel::<String>();
    thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            let mut line = String::new();
            match reader.read_line(&mut line) {
                Ok(0) => break,
                Ok(_) => {
                    let _ = tx.send(line);
                }
                Err(_) => break,
            }
        }
    });

    write_json_line(
        &mut stdin,
        &json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "clientInfo": { "name": "comet-ai", "title": "Comet AI", "version": env!("CARGO_PKG_VERSION") },
                "capabilities": {
                    "experimentalApi": true,
                    "requestAttestation": false,
                    "optOutNotificationMethods": []
                }
            }
        }),
    )?;
    write_json_line(
        &mut stdin,
        &json!({ "jsonrpc": "2.0", "method": "initialized", "params": null }),
    )?;
    write_json_line(
        &mut stdin,
        &json!({ "jsonrpc": "2.0", "id": 2, "method": "account/rateLimits/read", "params": null }),
    )?;

    let deadline = Instant::now() + Duration::from_millis(CODEX_APP_SERVER_TIMEOUT_MS);
    let mut last_error: Option<String> = None;
    while Instant::now() < deadline {
        let remaining = deadline.saturating_duration_since(Instant::now());
        match rx.recv_timeout(remaining.min(Duration::from_millis(400))) {
            Ok(line) => {
                let trimmed = line.trim();
                if trimmed.is_empty() {
                    continue;
                }
                let parsed: Value = match serde_json::from_str(trimmed) {
                    Ok(value) => value,
                    Err(error) => {
                        last_error = Some(format!(
                            "failed to parse Codex app-server response: {error}"
                        ));
                        continue;
                    }
                };
                if parsed.get("id").and_then(Value::as_i64) != Some(2) {
                    continue;
                }
                if let Some(error) = parsed.get("error") {
                    cleanup_child(&mut child);
                    return Err(format!("Codex app-server returned an error: {error}"));
                }
                let result = parsed.get("result").cloned().ok_or_else(|| {
                    "Codex app-server response did not include a result".to_string()
                })?;
                cleanup_child(&mut child);
                return build_usage_limits(result);
            }
            Err(mpsc::RecvTimeoutError::Timeout) => continue,
            Err(mpsc::RecvTimeoutError::Disconnected) => break,
        }
    }

    cleanup_child(&mut child);
    Err(last_error
        .unwrap_or_else(|| "Timed out reading Codex usage limits from app-server".to_string()))
}

fn spawn_codex_app_server() -> Result<Child, String> {
    let candidates = codex_command_candidates();

    let mut errors = Vec::new();
    for candidate in candidates {
        let mut command = candidate.command();
        command
            .args(["app-server", "--stdio"])
            .stdin(Stdio::piped())
            .stdout(Stdio::piped())
            .stderr(Stdio::null());
        if let Some(codex_home) = codex_home_dir() {
            command.env("CODEX_HOME", codex_home);
        }
        configure_hidden_command(&mut command);
        match command.spawn() {
            Ok(child) => return Ok(child),
            Err(error) => errors.push(format!("{}: {error}", candidate.label)),
        }
    }
    Err(format!(
        "Failed to start Codex app-server ({})",
        errors.join("; ")
    ))
}

#[derive(Debug, Clone)]
struct CodexCommandCandidate {
    program: String,
    prefix_args: Vec<String>,
    label: String,
}

impl CodexCommandCandidate {
    fn direct(path: impl Into<String>) -> Self {
        let program = path.into();
        Self {
            label: program.clone(),
            program,
            prefix_args: Vec::new(),
        }
    }

    fn cmd_wrapper(path: impl Into<String>) -> Self {
        let path = path.into();
        Self {
            label: path.clone(),
            program: "cmd.exe".to_string(),
            prefix_args: vec!["/C".to_string(), path],
        }
    }

    fn command(&self) -> Command {
        let mut command = Command::new(&self.program);
        command.args(&self.prefix_args);
        command
    }
}

fn codex_command_candidates() -> Vec<CodexCommandCandidate> {
    let mut candidates = Vec::new();
    let mut seen = std::collections::HashSet::new();

    if let Ok(path) = std::env::var("CODEX_BINARY") {
        push_direct_candidate(&mut candidates, &mut seen, path);
    }

    for path in windows_store_codex_executables() {
        push_direct_candidate(
            &mut candidates,
            &mut seen,
            path.to_string_lossy().to_string(),
        );
    }

    if let Ok(local_app_data) = std::env::var("LOCALAPPDATA") {
        push_direct_candidate(
            &mut candidates,
            &mut seen,
            PathBuf::from(local_app_data)
                .join("Microsoft")
                .join("WindowsApps")
                .join("codex.exe")
                .to_string_lossy()
                .to_string(),
        );
    }

    if let Ok(app_data) = std::env::var("APPDATA") {
        let npm_codex = PathBuf::from(app_data).join("npm").join("codex.cmd");
        let key = normalize_candidate_key(&npm_codex.to_string_lossy());
        if npm_codex.is_file() && seen.insert(key) {
            candidates.push(CodexCommandCandidate::cmd_wrapper(
                npm_codex.to_string_lossy().to_string(),
            ));
        }
    }

    push_direct_candidate(&mut candidates, &mut seen, "codex.exe".to_string());
    push_direct_candidate(&mut candidates, &mut seen, "codex".to_string());
    candidates
}

fn push_direct_candidate(
    candidates: &mut Vec<CodexCommandCandidate>,
    seen: &mut std::collections::HashSet<String>,
    path: String,
) {
    let trimmed = path.trim();
    if trimmed.is_empty() {
        return;
    }
    let path_buf = PathBuf::from(trimmed);
    if path_buf.is_absolute() && !path_buf.is_file() {
        return;
    }
    if seen.insert(normalize_candidate_key(trimmed)) {
        candidates.push(CodexCommandCandidate::direct(trimmed.to_string()));
    }
}

fn normalize_candidate_key(path: &str) -> String {
    path.trim_matches('"').to_ascii_lowercase()
}

fn codex_home_dir() -> Option<PathBuf> {
    std::env::var("CODEX_HOME")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .or_else(|| home_dir().map(|home| home.join(".codex")))
}

fn home_dir() -> Option<PathBuf> {
    std::env::var("USERPROFILE")
        .or_else(|_| std::env::var("HOME"))
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
}

fn windows_store_codex_executables() -> Vec<PathBuf> {
    let program_files = std::env::var("ProgramFiles")
        .ok()
        .filter(|value| !value.trim().is_empty())
        .map(PathBuf::from)
        .unwrap_or_else(|| PathBuf::from(r"C:\Program Files"));
    let windows_apps = program_files.join("WindowsApps");
    let Ok(entries) = std::fs::read_dir(windows_apps) else {
        return Vec::new();
    };

    let mut matches: Vec<(std::time::SystemTime, PathBuf)> = entries
        .flatten()
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().to_string();
            if !name.starts_with("OpenAI.Codex_") {
                return None;
            }
            let executable = entry.path().join("app").join("resources").join("codex.exe");
            if !executable.is_file() {
                return None;
            }
            let modified = std::fs::metadata(&executable)
                .and_then(|metadata| metadata.modified())
                .unwrap_or(std::time::SystemTime::UNIX_EPOCH);
            Some((modified, executable))
        })
        .collect();
    matches.sort_by(|left, right| right.0.cmp(&left.0));
    matches.into_iter().map(|(_, path)| path).collect()
}

fn write_json_line(stdin: &mut std::process::ChildStdin, value: &Value) -> Result<(), String> {
    let text = serde_json::to_string(value).map_err(|error| error.to_string())?;
    stdin
        .write_all(text.as_bytes())
        .and_then(|_| stdin.write_all(b"\n"))
        .and_then(|_| stdin.flush())
        .map_err(|error| format!("Failed to write to Codex app-server: {error}"))
}

fn cleanup_child(child: &mut Child) {
    let _ = child.kill();
    let _ = child.wait();
}

fn build_usage_limits(raw: Value) -> Result<CodexUsageLimits, String> {
    let response: GetAccountRateLimitsResponse = serde_json::from_value(raw.clone())
        .map_err(|error| format!("Unexpected Codex rate-limit payload: {error}"))?;
    let snapshot = response
        .rate_limits_by_limit_id
        .as_ref()
        .and_then(|limits| limits.get("codex"))
        .unwrap_or(&response.rate_limits);

    let mut rows = Vec::new();
    if let Some(window) = &snapshot.primary {
        rows.push(window_to_row(snapshot, window, "primary"));
    }
    if let Some(window) = &snapshot.secondary {
        rows.push(window_to_row(snapshot, window, "secondary"));
    }

    if rows.is_empty() {
        return Err("Codex account did not report rate-limit windows".to_string());
    }

    Ok(CodexUsageLimits { rows, raw })
}

fn window_to_row(
    snapshot: &RateLimitSnapshot,
    window: &RateLimitWindow,
    role: &str,
) -> CodexUsageLimitRow {
    let label = label_for_window(snapshot, window, role);
    let id = label
        .to_ascii_lowercase()
        .chars()
        .map(|ch| if ch.is_ascii_alphanumeric() { ch } else { '-' })
        .collect::<String>()
        .trim_matches('-')
        .to_string();
    let percent = window.used_percent.round().clamp(0.0, 100.0) as u8;
    let reset = window
        .resets_at
        .map(|value| format!("resets at Unix {value}"));
    CodexUsageLimitRow {
        id,
        label,
        percent,
        reset,
        source_line: format!(
            "{} {}: {}% used{}",
            snapshot
                .limit_name
                .as_deref()
                .or(snapshot.limit_id.as_deref())
                .unwrap_or("Codex"),
            role,
            percent,
            window
                .window_duration_mins
                .map(|mins| format!(" over {mins} minutes"))
                .unwrap_or_default(),
        ),
    }
}

fn label_for_window(snapshot: &RateLimitSnapshot, window: &RateLimitWindow, role: &str) -> String {
    let base = snapshot.limit_name.as_deref().unwrap_or("").trim();
    let suffix = match window.window_duration_mins {
        Some(300) => "5-hour limit".to_string(),
        Some(1_440) => "Daily limit".to_string(),
        Some(10_080) => "Weekly limit".to_string(),
        Some(mins) if mins % 60 == 0 => format!("{}-hour limit", mins / 60),
        Some(mins) => format!("{mins}-minute limit"),
        None if role == "primary" => "Primary limit".to_string(),
        None => "Secondary limit".to_string(),
    };
    if base.is_empty() {
        suffix
    } else {
        format!("{base} {suffix}")
    }
}
