use crate::db::DbState;
use rusqlite::{params, OptionalExtension};
use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::fs::{self, OpenOptions};
use std::io::{Read, Write};
use std::path::PathBuf;
use std::process::{Child, Command, Stdio};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
use tauri::{AppHandle, Emitter, Manager, State};

pub struct AgentRunState {
    children: Arc<Mutex<HashMap<String, Arc<Mutex<Child>>>>>,
}

impl AgentRunState {
    pub fn new() -> Self {
        Self {
            children: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct AgentRunRecord {
    pub run_id: String,
    pub mission_id: String,
    pub node_id: String,
    pub attempt: u32,
    pub session_id: String,
    pub agent_id: String,
    pub cli: String,
    pub execution_mode: String,
    pub cwd: Option<String>,
    pub command: String,
    pub args: Vec<String>,
    pub env: HashMap<String, String>,
    pub prompt_path: Option<String>,
    pub stdout_path: Option<String>,
    pub stderr_path: Option<String>,
    pub transcript_path: Option<String>,
    pub status: String,
    pub exit_code: Option<i32>,
    pub started_at: Option<String>,
    pub completed_at: Option<String>,
    pub error: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartAgentRunRequest {
    pub run_id: String,
    pub mission_id: String,
    pub node_id: String,
    pub attempt: u32,
    pub session_id: String,
    pub agent_id: String,
    pub cli: String,
    pub execution_mode: String,
    pub cwd: Option<String>,
    pub command: String,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: HashMap<String, String>,
    pub prompt: String,
    pub timeout_ms: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunOutputEvent {
    run_id: String,
    mission_id: String,
    node_id: String,
    stream: String,
    chunk: String,
    at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunStatusEvent {
    run_id: String,
    mission_id: String,
    node_id: String,
    status: String,
    error: Option<String>,
    at: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct AgentRunExitEvent {
    run_id: String,
    mission_id: String,
    node_id: String,
    status: String,
    exit_code: Option<i32>,
    error: Option<String>,
    at: u64,
}

const LOCAL_HTTP_COMMAND: &str = "__terminal_docks_local_http__";

fn unix_millis_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn sanitize_path_segment(value: &str) -> String {
    let mut out = String::new();
    for ch in value.chars() {
        if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' || ch == '.' {
            out.push(ch);
        } else {
            out.push('_');
        }
    }
    if out.trim_matches('_').is_empty() {
        "run".to_string()
    } else {
        out
    }
}

fn run_root(app: &AppHandle, cwd: Option<&str>) -> Result<PathBuf, String> {
    if let Some(cwd) = cwd {
        let trimmed = cwd.trim();
        if !trimmed.is_empty() {
            return Ok(PathBuf::from(trimmed).join(".terminal-docks").join("runs"));
        }
    }
    Ok(app
        .path()
        .app_local_data_dir()
        .map_err(|e| e.to_string())?
        .join("runs"))
}

fn run_paths(app: &AppHandle, run_id: &str, cwd: Option<&str>) -> Result<(PathBuf, PathBuf, PathBuf, PathBuf), String> {
    let dir = run_root(app, cwd)?.join(sanitize_path_segment(run_id));
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    Ok((
        dir.join("prompt.md"),
        dir.join("stdout.log"),
        dir.join("stderr.log"),
        dir.join("transcript.jsonl"),
    ))
}

fn replace_placeholders(value: &str, replacements: &HashMap<&str, String>) -> String {
    replacements.iter().fold(value.to_string(), |acc, (key, replacement)| {
        acc.replace(&format!("{{{key}}}"), replacement)
    })
}

fn with_runtime_env(request: &StartAgentRunRequest, prompt_path: &str) -> HashMap<String, String> {
    let mut env = request.env.clone();
    env.insert("TD_SESSION_ID".to_string(), request.session_id.clone());
    env.insert("TD_AGENT_ID".to_string(), request.agent_id.clone());
    env.insert("TD_MISSION_ID".to_string(), request.mission_id.clone());
    env.insert("TD_NODE_ID".to_string(), request.node_id.clone());
    env.insert("TD_ATTEMPT".to_string(), request.attempt.to_string());
    env.insert("TD_RUN_ID".to_string(), request.run_id.clone());
    env.insert("TD_EXECUTION_MODE".to_string(), request.execution_mode.clone());
    env.insert("TD_PROMPT_PATH".to_string(), prompt_path.to_string());
    if let Some(cwd) = request.cwd.as_ref().filter(|value| !value.trim().is_empty()) {
        env.insert("TD_WORKSPACE".to_string(), cwd.clone());
    }
    env
}

pub fn persist_agent_run(app: &AppHandle, record: &AgentRunRecord) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let args_json = serde_json::to_string(&record.args).map_err(|e| e.to_string())?;
    let env_json = serde_json::to_string(&record.env).map_err(|e| e.to_string())?;

    conn.execute(
        "INSERT INTO agent_runs
           (run_id, mission_id, node_id, attempt, session_id, agent_id, cli, execution_mode,
            cwd, command, args_json, env_json, prompt_path, stdout_path, stderr_path,
            transcript_path, status, exit_code, error, started_at, completed_at, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10, ?11, ?12, ?13, ?14, ?15, ?16, ?17, ?18, ?19, ?20, ?21, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(run_id) DO UPDATE SET
           mission_id = excluded.mission_id,
           node_id = excluded.node_id,
           attempt = excluded.attempt,
           session_id = excluded.session_id,
           agent_id = excluded.agent_id,
           cli = excluded.cli,
           execution_mode = excluded.execution_mode,
           cwd = excluded.cwd,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           prompt_path = excluded.prompt_path,
           stdout_path = excluded.stdout_path,
           stderr_path = excluded.stderr_path,
           transcript_path = excluded.transcript_path,
           status = excluded.status,
           exit_code = excluded.exit_code,
           error = excluded.error,
           started_at = COALESCE(excluded.started_at, agent_runs.started_at),
           completed_at = excluded.completed_at,
           updated_at = CURRENT_TIMESTAMP",
        params![
            record.run_id,
            record.mission_id,
            record.node_id,
            record.attempt,
            record.session_id,
            record.agent_id,
            record.cli,
            record.execution_mode,
            record.cwd,
            record.command,
            args_json,
            env_json,
            record.prompt_path,
            record.stdout_path,
            record.stderr_path,
            record.transcript_path,
            record.status,
            record.exit_code,
            record.error,
            record.started_at,
            record.completed_at,
        ],
    )
    .map_err(|e| e.to_string())?;
    Ok(())
}

fn update_run_status(
    app: &AppHandle,
    run_id: &str,
    status: &str,
    exit_code: Option<i32>,
    error: Option<&str>,
    started: bool,
    completed: bool,
) -> Result<(), String> {
    let state = app.state::<DbState>();
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let started_sql = if started { "CURRENT_TIMESTAMP" } else { "started_at" };
    let completed_sql = if completed { "CURRENT_TIMESTAMP" } else { "completed_at" };
    let sql = format!(
        "UPDATE agent_runs
         SET status = ?1, exit_code = ?2, error = ?3,
             started_at = {started_sql},
             completed_at = {completed_sql},
             updated_at = CURRENT_TIMESTAMP
         WHERE run_id = ?4"
    );
    conn.execute(&sql, params![status, exit_code, error, run_id])
        .map_err(|e| e.to_string())?;
    Ok(())
}

fn row_to_record(row: &rusqlite::Row<'_>) -> rusqlite::Result<AgentRunRecord> {
    let args_json: String = row.get(10)?;
    let env_json: String = row.get(11)?;
    Ok(AgentRunRecord {
        run_id: row.get(0)?,
        mission_id: row.get(1)?,
        node_id: row.get(2)?,
        attempt: row.get::<_, i64>(3)? as u32,
        session_id: row.get(4)?,
        agent_id: row.get(5)?,
        cli: row.get(6)?,
        execution_mode: row.get(7)?,
        cwd: row.get(8)?,
        command: row.get(9)?,
        args: serde_json::from_str(&args_json).unwrap_or_default(),
        env: serde_json::from_str(&env_json).unwrap_or_default(),
        prompt_path: row.get(12)?,
        stdout_path: row.get(13)?,
        stderr_path: row.get(14)?,
        transcript_path: row.get(15)?,
        status: row.get(16)?,
        exit_code: row.get(17)?,
        error: row.get(18)?,
        started_at: row.get(19)?,
        completed_at: row.get(20)?,
    })
}

fn emit_status(app: &AppHandle, run_id: &str, mission_id: &str, node_id: &str, status: &str, error: Option<String>) {
    let _ = app.emit(
        "agent-run-status",
        AgentRunStatusEvent {
            run_id: run_id.to_string(),
            mission_id: mission_id.to_string(),
            node_id: node_id.to_string(),
            status: status.to_string(),
            error,
            at: unix_millis_now(),
        },
    );
}

fn emit_output(app: &AppHandle, run_id: &str, mission_id: &str, node_id: &str, stream: &str, chunk: String) {
    let _ = app.emit(
        "agent-run-output",
        AgentRunOutputEvent {
            run_id: run_id.to_string(),
            mission_id: mission_id.to_string(),
            node_id: node_id.to_string(),
            stream: stream.to_string(),
            chunk,
            at: unix_millis_now(),
        },
    );
}

fn mcp_internal_push(app: &AppHandle, body: serde_json::Value) -> Result<serde_json::Value, String> {
    let state = app.state::<crate::mcp::McpState>();
    let token = state.internal_push_token.lock().unwrap().clone();
    if token.is_empty() {
        return Err("MCP push token not initialized".to_string());
    }
    let response = ureq::post("http://localhost:3741/internal/push")
        .set("x-td-push-token", &token)
        .set("Content-Type", "application/json")
        .send_string(&body.to_string())
        .map_err(|error| format!("MCP internal push failed: {error}"))?;
    let status = response.status();
    let text = response.into_string().unwrap_or_default();
    if !(200..300).contains(&status) {
        return Err(format!("MCP internal push returned {status}: {text}"));
    }
    Ok(serde_json::from_str(&text).unwrap_or_else(|_| serde_json::json!({ "raw": text })))
}

fn extract_openai_compatible_text(value: &serde_json::Value) -> String {
    value
        .get("choices")
        .and_then(|choices| choices.as_array())
        .and_then(|choices| choices.first())
        .and_then(|choice| {
            choice
                .get("message")
                .and_then(|message| message.get("content"))
                .and_then(|content| content.as_str())
                .or_else(|| choice.get("text").and_then(|text| text.as_str()))
        })
        .unwrap_or("")
        .to_string()
}

fn summarize_completion_output(content: &str, fallback: &str) -> String {
    if content.trim().is_empty() {
        fallback.to_string()
    } else {
        content.trim().lines().take(8).collect::<Vec<_>>().join("\n")
    }
}

fn acknowledge_headless_runtime(app: &AppHandle, payload: &StartAgentRunRequest) {
    let _ = mcp_internal_push(app, serde_json::json!({
        "type": "runtime_task_acked",
        "sessionId": payload.session_id,
        "missionId": payload.mission_id,
        "nodeId": payload.node_id,
        "attempt": payload.attempt,
        "taskSeq": payload.attempt,
    }));
    let _ = crate::workflow_engine::acknowledge_runtime_activation(
        app.clone(),
        payload.mission_id.clone(),
        payload.node_id.clone(),
        payload.attempt,
        "activation_acked".to_string(),
        None,
    );
    let _ = crate::workflow_engine::acknowledge_runtime_activation(
        app.clone(),
        payload.mission_id.clone(),
        payload.node_id.clone(),
        payload.attempt,
        "running".to_string(),
        None,
    );
}

fn publish_cli_stdout_completion(
    app: &AppHandle,
    session_id: &str,
    mission_id: &str,
    node_id: &str,
    attempt: u32,
    run_id: &str,
    stdout_path: &PathBuf,
) -> Result<(), String> {
    let content = fs::read_to_string(stdout_path).unwrap_or_default();
    let summary = summarize_completion_output(&content, "CLI runtime completed without text output.");
    mcp_internal_push(app, serde_json::json!({
        "type": "runtime_task_completed",
        "sessionId": session_id,
        "missionId": mission_id,
        "nodeId": node_id,
        "attempt": attempt,
        "outcome": "success",
        "title": "CLI runtime completed",
        "summary": summary,
        "rawOutput": content,
        "logRef": run_id,
        "filesChanged": [],
        "artifactReferences": [],
        "downstreamPayload": {
            "status": "success",
            "summary": summary,
            "rawOutput": content,
            "logRef": run_id,
        },
    }))?;
    Ok(())
}

fn start_local_http_run(
    app: AppHandle,
    payload: StartAgentRunRequest,
    mut record: AgentRunRecord,
    stdout_path: PathBuf,
    stderr_path: PathBuf,
) -> Result<AgentRunRecord, String> {
    update_run_status(&app, &payload.run_id, "running", None, None, true, false)?;
    emit_status(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "running", None);

    thread::spawn(move || {
        let _ = mcp_internal_push(&app, serde_json::json!({
            "type": "runtime_task_acked",
            "sessionId": payload.session_id,
            "missionId": payload.mission_id,
            "nodeId": payload.node_id,
            "attempt": payload.attempt,
            "taskSeq": payload.attempt,
        }));
        let _ = crate::workflow_engine::acknowledge_runtime_activation(
            app.clone(),
            payload.mission_id.clone(),
            payload.node_id.clone(),
            payload.attempt,
            "activation_acked".to_string(),
            None,
        );
        let _ = crate::workflow_engine::acknowledge_runtime_activation(
            app.clone(),
            payload.mission_id.clone(),
            payload.node_id.clone(),
            payload.attempt,
            "running".to_string(),
            None,
        );

        let url = payload
            .env
            .get("TD_LOCAL_HTTP_URL")
            .cloned()
            .unwrap_or_else(|| "http://localhost:11434/v1/chat/completions".to_string());
        let model = payload
            .env
            .get("TD_LOCAL_HTTP_MODEL")
            .cloned()
            .unwrap_or_else(|| "llama3.1".to_string());
        let api_key = payload.env.get("TD_LOCAL_HTTP_API_KEY").cloned();
        let request_body = serde_json::json!({
            "model": model,
            "messages": [
                {
                    "role": "system",
                    "content": "You are a Terminal Docks local runtime. Complete the assigned graph node and summarize the result."
                },
                { "role": "user", "content": payload.prompt }
            ],
            "stream": false
        });

        let mut request = ureq::post(&url).set("Content-Type", "application/json");
        if let Some(key) = api_key.as_ref().filter(|value| !value.trim().is_empty()) {
            request = request.set("Authorization", &format!("Bearer {key}"));
        }

        match request.send_string(&request_body.to_string()) {
            Ok(response) => {
                let raw = response.into_string().unwrap_or_default();
                let parsed = serde_json::from_str::<serde_json::Value>(&raw).unwrap_or(serde_json::Value::String(raw.clone()));
                let content = extract_openai_compatible_text(&parsed);
                let summary = summarize_completion_output(&content, "Local HTTP runtime completed without text output.");
                let _ = fs::write(&stdout_path, &content);
                emit_output(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "stdout", content.clone());
                let completion = mcp_internal_push(&app, serde_json::json!({
                    "type": "runtime_task_completed",
                    "sessionId": payload.session_id,
                    "missionId": payload.mission_id,
                    "nodeId": payload.node_id,
                    "attempt": payload.attempt,
                    "outcome": "success",
                    "title": "Local HTTP runtime completed",
                    "summary": summary,
                    "rawOutput": content,
                    "logRef": payload.run_id,
                    "filesChanged": [],
                    "artifactReferences": [],
                    "downstreamPayload": parsed,
                }));
                match completion {
                    Ok(_) => {
                        update_run_status(&app, &payload.run_id, "completed", Some(0), None, false, true).ok();
                        let _ = app.emit(
                            "agent-run-exit",
                            AgentRunExitEvent {
                                run_id: payload.run_id,
                                mission_id: payload.mission_id,
                                node_id: payload.node_id,
                                status: "completed".to_string(),
                                exit_code: Some(0),
                                error: None,
                                at: unix_millis_now(),
                            },
                        );
                    }
                    Err(error) => {
                        let _ = fs::write(&stderr_path, &error);
                        update_run_status(&app, &payload.run_id, "failed", None, Some(&error), false, true).ok();
                        emit_status(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "failed", Some(error));
                    }
                }
            }
            Err(error) => {
                let message = format!("Local HTTP runtime failed: {error}");
                let _ = fs::write(&stderr_path, &message);
                emit_output(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "stderr", message.clone());
                update_run_status(&app, &payload.run_id, "failed", None, Some(&message), false, true).ok();
                emit_status(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "failed", Some(message.clone()));
                let _ = app.emit(
                    "agent-run-exit",
                    AgentRunExitEvent {
                        run_id: payload.run_id,
                        mission_id: payload.mission_id,
                        node_id: payload.node_id,
                        status: "failed".to_string(),
                        exit_code: None,
                        error: Some(message),
                        at: unix_millis_now(),
                    },
                );
            }
        }
    });

    record.status = "running".to_string();
    Ok(record)
}

fn stream_reader(
    app: AppHandle,
    run_id: String,
    mission_id: String,
    node_id: String,
    stream: &'static str,
    mut reader: impl Read + Send + 'static,
    log_path: PathBuf,
    transcript_path: PathBuf,
) {
    thread::spawn(move || {
        let mut log = OpenOptions::new().create(true).append(true).open(log_path).ok();
        let mut transcript = OpenOptions::new().create(true).append(true).open(transcript_path).ok();
        let mut buf = [0u8; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let chunk = String::from_utf8_lossy(&buf[..n]).to_string();
                    if let Some(file) = log.as_mut() {
                        let _ = file.write_all(chunk.as_bytes());
                    }
                    let at = unix_millis_now();
                    if let Some(file) = transcript.as_mut() {
                        let line = serde_json::json!({
                            "at": at,
                            "stream": stream,
                            "chunk": chunk,
                        })
                        .to_string();
                        let _ = writeln!(file, "{line}");
                    }
                    let _ = app.emit(
                        "agent-run-output",
                        AgentRunOutputEvent {
                            run_id: run_id.clone(),
                            mission_id: mission_id.clone(),
                            node_id: node_id.clone(),
                            stream: stream.to_string(),
                            chunk,
                            at,
                        },
                    );
                }
                Err(_) => break,
            }
        }
    });
}

#[tauri::command]
pub fn start_agent_run(
    app: AppHandle,
    state: State<'_, AgentRunState>,
    payload: StartAgentRunRequest,
) -> Result<AgentRunRecord, String> {
    if payload.command.trim().is_empty() {
        let error = "Headless command is empty.".to_string();
        update_run_status(&app, &payload.run_id, "failed", None, Some(&error), false, true).ok();
        emit_status(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "failed", Some(error.clone()));
        return Err(error);
    }

    let (prompt_path, stdout_path, stderr_path, transcript_path) =
        run_paths(&app, &payload.run_id, payload.cwd.as_deref())?;
    fs::write(&prompt_path, &payload.prompt).map_err(|e| e.to_string())?;
    fs::write(&stdout_path, "").map_err(|e| e.to_string())?;
    fs::write(&stderr_path, "").map_err(|e| e.to_string())?;
    fs::write(&transcript_path, "").map_err(|e| e.to_string())?;

    let prompt_path_string = prompt_path.to_string_lossy().to_string();
    let mut replacements = HashMap::new();
    replacements.insert("promptPath", prompt_path_string.clone());
    replacements.insert("sessionId", payload.session_id.clone());
    replacements.insert("missionId", payload.mission_id.clone());
    replacements.insert("nodeId", payload.node_id.clone());
    replacements.insert("attempt", payload.attempt.to_string());
    replacements.insert("runId", payload.run_id.clone());

    let command = replace_placeholders(&payload.command, &replacements);
    let args: Vec<String> = payload
        .args
        .iter()
        .map(|arg| replace_placeholders(arg, &replacements))
        .collect();
    let env = with_runtime_env(&payload, &prompt_path_string)
        .into_iter()
        .map(|(key, value)| (key, replace_placeholders(&value, &replacements)))
        .collect::<HashMap<_, _>>();

    let record = AgentRunRecord {
        run_id: payload.run_id.clone(),
        mission_id: payload.mission_id.clone(),
        node_id: payload.node_id.clone(),
        attempt: payload.attempt,
        session_id: payload.session_id.clone(),
        agent_id: payload.agent_id.clone(),
        cli: payload.cli.clone(),
        execution_mode: payload.execution_mode.clone(),
        cwd: payload.cwd.clone(),
        command: command.clone(),
        args: args.clone(),
        env: env.clone(),
        prompt_path: Some(prompt_path_string),
        stdout_path: Some(stdout_path.to_string_lossy().to_string()),
        stderr_path: Some(stderr_path.to_string_lossy().to_string()),
        transcript_path: Some(transcript_path.to_string_lossy().to_string()),
        status: "starting".to_string(),
        exit_code: None,
        started_at: None,
        completed_at: None,
        error: None,
    };
    persist_agent_run(&app, &record)?;
    emit_status(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "starting", None);

    if command == LOCAL_HTTP_COMMAND {
        return start_local_http_run(app, payload, record, stdout_path, stderr_path);
    }

    let mut command_builder = Command::new(&command);
    command_builder.args(&args);
    command_builder.stdout(Stdio::piped()).stderr(Stdio::piped());
    if let Some(cwd) = payload.cwd.as_ref().filter(|value| !value.trim().is_empty()) {
        command_builder.current_dir(cwd);
    }
    for (key, value) in &env {
        command_builder.env(key, value);
    }

    let mut child = match command_builder.spawn() {
        Ok(child) => child,
        Err(error) => {
            let message = format!("CLI launch failed: {error}");
            update_run_status(&app, &payload.run_id, "failed", None, Some(&message), false, true).ok();
            emit_status(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "failed", Some(message.clone()));
            return Err(message);
        }
    };

    if let Some(stdout) = child.stdout.take() {
        stream_reader(
            app.clone(),
            payload.run_id.clone(),
            payload.mission_id.clone(),
            payload.node_id.clone(),
            "stdout",
            stdout,
            stdout_path.clone(),
            transcript_path.clone(),
        );
    }
    if let Some(stderr) = child.stderr.take() {
        stream_reader(
            app.clone(),
            payload.run_id.clone(),
            payload.mission_id.clone(),
            payload.node_id.clone(),
            "stderr",
            stderr,
            stderr_path.clone(),
            transcript_path.clone(),
        );
    }

    let child_ref = Arc::new(Mutex::new(child));
    {
        let mut children = state.children.lock().map_err(|_| "Failed to lock agent runs".to_string())?;
        children.insert(payload.run_id.clone(), child_ref.clone());
    }

    update_run_status(&app, &payload.run_id, "running", None, None, true, false)?;
    emit_status(&app, &payload.run_id, &payload.mission_id, &payload.node_id, "running", None);
    if payload.execution_mode == "headless" || payload.execution_mode == "streaming_headless" {
        acknowledge_headless_runtime(&app, &payload);
    }

    let run_id = payload.run_id.clone();
    let mission_id = payload.mission_id.clone();
    let node_id = payload.node_id.clone();
    let session_id = payload.session_id.clone();
    let attempt = payload.attempt;
    let cli = payload.cli.clone();
    let execution_mode = payload.execution_mode.clone();
    let stdout_path_for_completion = stdout_path.clone();
    let timeout_ms = payload.timeout_ms;
    let children = state.children.clone();
    thread::spawn(move || {
        let started_at = unix_millis_now();
        loop {
            if let Some(limit) = timeout_ms {
                if unix_millis_now().saturating_sub(started_at) > limit {
                    if let Ok(mut child) = child_ref.lock() {
                        let _ = child.kill();
                    }
                    if let Ok(mut map) = children.lock() {
                        map.remove(&run_id);
                    }
                    let error = "run_timed_out".to_string();
                    update_run_status(&app, &run_id, "timed_out", None, Some(&error), false, true).ok();
                    let _ = app.emit(
                        "agent-run-exit",
                        AgentRunExitEvent {
                            run_id,
                            mission_id,
                            node_id,
                            status: "timed_out".to_string(),
                            exit_code: None,
                            error: Some(error),
                            at: unix_millis_now(),
                        },
                    );
                    return;
                }
            }

            let try_wait = {
                match child_ref.lock() {
                    Ok(mut child) => child.try_wait(),
                    Err(_) => return,
                }
            };

            match try_wait {
                Ok(Some(status)) => {
                    let was_active = children
                        .lock()
                        .map(|mut map| map.remove(&run_id).is_some())
                        .unwrap_or(false);
                    if !was_active {
                        return;
                    }
                    let exit_code = status.code();
                    let final_status = if status.success() { "completed" } else { "failed" };
                    let error = if status.success() {
                        None
                    } else {
                        Some(format!("Process exited with status {status}."))
                    };
                    if status.success()
                        && cli == "claude"
                        && (execution_mode == "headless" || execution_mode == "streaming_headless")
                    {
                        let _ = publish_cli_stdout_completion(
                            &app,
                            &session_id,
                            &mission_id,
                            &node_id,
                            attempt,
                            &run_id,
                            &stdout_path_for_completion,
                        );
                    }
                    update_run_status(&app, &run_id, final_status, exit_code, error.as_deref(), false, true).ok();
                    let _ = app.emit(
                        "agent-run-exit",
                        AgentRunExitEvent {
                            run_id,
                            mission_id,
                            node_id,
                            status: final_status.to_string(),
                            exit_code,
                            error,
                            at: unix_millis_now(),
                        },
                    );
                    return;
                }
                Ok(None) => thread::sleep(Duration::from_millis(100)),
                Err(error) => {
                    let was_active = children
                        .lock()
                        .map(|mut map| map.remove(&run_id).is_some())
                        .unwrap_or(false);
                    if !was_active {
                        return;
                    }
                    let message = error.to_string();
                    update_run_status(&app, &run_id, "failed", None, Some(&message), false, true).ok();
                    let _ = app.emit(
                        "agent-run-exit",
                        AgentRunExitEvent {
                            run_id,
                            mission_id,
                            node_id,
                            status: "failed".to_string(),
                            exit_code: None,
                            error: Some(message),
                            at: unix_millis_now(),
                        },
                    );
                    return;
                }
            }
        }
    });

    let mut running = record;
    running.status = "running".to_string();
    Ok(running)
}

#[tauri::command]
pub fn cancel_agent_run(
    app: AppHandle,
    state: State<'_, AgentRunState>,
    run_id: String,
    reason: Option<String>,
) -> Result<(), String> {
    let child = state
        .children
        .lock()
        .map_err(|_| "Failed to lock agent runs".to_string())?
        .remove(&run_id);
    let Some(child) = child else {
        return Err(format!("Agent run {run_id} is not active."));
    };
    if let Ok(mut child) = child.lock() {
        child.kill().map_err(|e| e.to_string())?;
    }
    let message = reason.unwrap_or_else(|| "cancelled_by_user".to_string());
    update_run_status(&app, &run_id, "cancelled", None, Some(&message), false, true)?;
    emit_status(&app, &run_id, "", "", "cancelled", Some(message));
    Ok(())
}

#[tauri::command]
pub fn get_agent_run(state: State<'_, DbState>, run_id: String) -> Result<Option<AgentRunRecord>, String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let result = conn.prepare(
        "SELECT run_id, mission_id, node_id, attempt, session_id, agent_id, cli, execution_mode,
                cwd, command, args_json, env_json, prompt_path, stdout_path, stderr_path,
                transcript_path, status, exit_code, error,
                datetime(started_at, 'localtime'), datetime(completed_at, 'localtime')
         FROM agent_runs
         WHERE run_id = ?1",
    )
    .map_err(|e| e.to_string())?
    .query_row(params![run_id], row_to_record)
    .optional()
    .map_err(|e| e.to_string());
    result
}

#[tauri::command]
pub fn list_agent_runs(
    state: State<'_, DbState>,
    mission_id: Option<String>,
) -> Result<Vec<AgentRunRecord>, String> {
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;
    let sql = "SELECT run_id, mission_id, node_id, attempt, session_id, agent_id, cli, execution_mode,
                      cwd, command, args_json, env_json, prompt_path, stdout_path, stderr_path,
                      transcript_path, status, exit_code, error,
                      datetime(started_at, 'localtime'), datetime(completed_at, 'localtime')
               FROM agent_runs
               WHERE (?1 IS NULL OR mission_id = ?1)
               ORDER BY created_at DESC";
    let mut stmt = conn.prepare(sql).map_err(|e| e.to_string())?;
    let rows = stmt
        .query_map(params![mission_id], row_to_record)
        .map_err(|e| e.to_string())?;
    let mut records = Vec::new();
    for row in rows {
        records.push(row.map_err(|e| e.to_string())?);
    }
    Ok(records)
}
