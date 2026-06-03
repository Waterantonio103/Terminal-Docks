use serde::{Deserialize, Serialize};
use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::process::{Child, ChildStdin, Command, Stdio};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager, State};
use uuid::Uuid;

#[cfg(target_os = "windows")]
use std::os::windows::process::CommandExt;

#[cfg(target_os = "windows")]
const CREATE_NO_WINDOW: u32 = 0x08000000;

pub struct LspState {
    servers: Mutex<HashMap<String, LspServerProcess>>,
}

struct LspServerProcess {
    child: Child,
    stdin: Arc<Mutex<ChildStdin>>,
}

#[derive(Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct StartLspServerRequest {
    command: String,
    args: Vec<String>,
    cwd: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
pub struct LspServerStarted {
    session_id: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspServerMessage {
    session_id: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct LspServerLog {
    session_id: String,
    stream: String,
    message: String,
}

impl LspState {
    pub fn new() -> Self {
        Self {
            servers: Mutex::new(HashMap::new()),
        }
    }
}

#[tauri::command]
pub async fn start_lsp_server(
    app: AppHandle,
    state: State<'_, LspState>,
    request: StartLspServerRequest,
) -> Result<LspServerStarted, String> {
    let command = request.command.trim();
    if command.is_empty() {
        return Err("Language server command is required".to_string());
    }

    let session_id = Uuid::new_v4().to_string();
    let mut child_command = Command::new(command);
    child_command
        .args(request.args.iter().filter(|arg| !arg.contains('\0')))
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    if let Some(cwd) = request
        .cwd
        .as_deref()
        .map(str::trim)
        .filter(|cwd| !cwd.is_empty())
    {
        child_command.current_dir(cwd);
    }

    #[cfg(target_os = "windows")]
    child_command.creation_flags(CREATE_NO_WINDOW);

    let mut child = child_command
        .spawn()
        .map_err(|error| format!("Failed to start language server '{}': {}", command, error))?;
    let stdin = child
        .stdin
        .take()
        .ok_or_else(|| "Language server stdin was not available".to_string())?;
    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| "Language server stdout was not available".to_string())?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| "Language server stderr was not available".to_string())?;
    let stdin = Arc::new(Mutex::new(stdin));

    spawn_lsp_stdout_reader(app.clone(), session_id.clone(), stdout);
    spawn_lsp_stderr_reader(app, session_id.clone(), stderr);

    state
        .servers
        .lock()
        .map_err(|_| "LSP state lock poisoned".to_string())?
        .insert(session_id.clone(), LspServerProcess { child, stdin });

    Ok(LspServerStarted { session_id })
}

#[tauri::command]
pub async fn write_lsp_message(
    state: State<'_, LspState>,
    session_id: String,
    message: String,
) -> Result<(), String> {
    let stdin = {
        let servers = state
            .servers
            .lock()
            .map_err(|_| "LSP state lock poisoned".to_string())?;
        servers
            .get(&session_id)
            .map(|server| Arc::clone(&server.stdin))
            .ok_or_else(|| "Language server session was not found".to_string())?
    };

    let framed = frame_lsp_message(&message);
    let mut handle = stdin
        .lock()
        .map_err(|_| "LSP stdin lock poisoned".to_string())?;
    handle
        .write_all(&framed)
        .map_err(|error| error.to_string())?;
    handle.flush().map_err(|error| error.to_string())
}

#[tauri::command]
pub async fn stop_lsp_server(state: State<'_, LspState>, session_id: String) -> Result<(), String> {
    let mut server = {
        let mut servers = state
            .servers
            .lock()
            .map_err(|_| "LSP state lock poisoned".to_string())?;
        servers.remove(&session_id)
    };
    if let Some(server) = server.as_mut() {
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
    Ok(())
}

pub fn kill_all_lsp_servers(app: &AppHandle) {
    let state = app.state::<LspState>();
    let drained = match state.servers.lock() {
        Ok(mut servers) => servers
            .drain()
            .map(|(_, server)| server)
            .collect::<Vec<_>>(),
        Err(_) => Vec::new(),
    };
    for mut server in drained {
        let _ = server.child.kill();
        let _ = server.child.wait();
    }
}

fn spawn_lsp_stdout_reader(app: AppHandle, session_id: String, stdout: std::process::ChildStdout) {
    std::thread::spawn(move || {
        let mut reader = BufReader::new(stdout);
        loop {
            match read_lsp_message(&mut reader) {
                Ok(Some(message)) => {
                    let _ = app.emit(
                        "lsp-server-message",
                        LspServerMessage {
                            session_id: session_id.clone(),
                            message,
                        },
                    );
                }
                Ok(None) => break,
                Err(error) => {
                    let _ = app.emit(
                        "lsp-server-log",
                        LspServerLog {
                            session_id: session_id.clone(),
                            stream: "stdout".to_string(),
                            message: error,
                        },
                    );
                    break;
                }
            }
        }
    });
}

fn spawn_lsp_stderr_reader(app: AppHandle, session_id: String, stderr: std::process::ChildStderr) {
    std::thread::spawn(move || {
        let reader = BufReader::new(stderr);
        for line in reader.lines().flatten() {
            let message = line.trim().to_string();
            if message.is_empty() {
                continue;
            }
            let _ = app.emit(
                "lsp-server-log",
                LspServerLog {
                    session_id: session_id.clone(),
                    stream: "stderr".to_string(),
                    message,
                },
            );
        }
    });
}

fn frame_lsp_message(message: &str) -> Vec<u8> {
    let bytes = message.as_bytes();
    let mut framed = format!("Content-Length: {}\r\n\r\n", bytes.len()).into_bytes();
    framed.extend_from_slice(bytes);
    framed
}

fn read_lsp_message<R: BufRead + Read>(reader: &mut R) -> Result<Option<String>, String> {
    let mut content_length: Option<usize> = None;

    loop {
        let mut line = String::new();
        let bytes_read = reader
            .read_line(&mut line)
            .map_err(|error| error.to_string())?;
        if bytes_read == 0 {
            return Ok(None);
        }
        let trimmed = line.trim_end_matches(['\r', '\n']);
        if trimmed.is_empty() {
            break;
        }
        if let Some(value) = trimmed.strip_prefix("Content-Length:") {
            content_length = Some(
                value
                    .trim()
                    .parse::<usize>()
                    .map_err(|_| "Invalid LSP Content-Length header".to_string())?,
            );
        }
    }

    let length = content_length.ok_or_else(|| "Missing LSP Content-Length header".to_string())?;
    let mut body = vec![0_u8; length];
    reader
        .read_exact(&mut body)
        .map_err(|error| error.to_string())?;
    String::from_utf8(body)
        .map(Some)
        .map_err(|error| error.to_string())
}

#[cfg(test)]
mod tests {
    use super::{frame_lsp_message, read_lsp_message};
    use std::io::{BufReader, Cursor};

    #[test]
    fn lsp_framing_wraps_json_with_content_length() {
        let framed = frame_lsp_message(r#"{"jsonrpc":"2.0","id":1}"#);
        let text = String::from_utf8(framed).expect("valid frame");
        assert_eq!(
            text,
            "Content-Length: 24\r\n\r\n{\"jsonrpc\":\"2.0\",\"id\":1}"
        );
    }

    #[test]
    fn read_lsp_message_parses_single_frame() {
        let input = b"Content-Length: 17\r\n\r\n{\"ok\":true,\"x\":1}";
        let mut reader = BufReader::new(Cursor::new(input));
        let message = read_lsp_message(&mut reader).expect("read frame");
        assert_eq!(message, Some("{\"ok\":true,\"x\":1}".to_string()));
    }

    #[test]
    fn read_lsp_message_returns_none_at_eof() {
        let mut reader = BufReader::new(Cursor::new(Vec::<u8>::new()));
        let message = read_lsp_message(&mut reader).expect("empty reader");
        assert_eq!(message, None);
    }

    #[test]
    fn read_lsp_message_rejects_missing_length() {
        let input = b"Content-Type: application/vscode-jsonrpc; charset=utf-8\r\n\r\n{}";
        let mut reader = BufReader::new(Cursor::new(input));
        let error = read_lsp_message(&mut reader).expect_err("missing length");
        assert_eq!(error, "Missing LSP Content-Length header");
    }

    #[test]
    fn read_lsp_message_rejects_invalid_length() {
        let input = b"Content-Length: nope\r\n\r\n{}";
        let mut reader = BufReader::new(Cursor::new(input));
        let error = read_lsp_message(&mut reader).expect_err("invalid length");
        assert_eq!(error, "Invalid LSP Content-Length header");
    }
}
