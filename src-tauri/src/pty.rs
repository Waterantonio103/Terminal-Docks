use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::{HashMap, VecDeque};
use std::io::{Read, Write};
use std::sync::{Arc, Mutex};
use std::thread;
use tauri::{AppHandle, Emitter, State, Manager};

const RECENT_OUTPUT_CAPACITY: usize = 16384;

pub struct PtyInstance {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
    pub child: Box<dyn portable_pty::Child + Send>,
    pub recent_output: Arc<Mutex<VecDeque<u8>>>,
}

pub struct PtyState {
    pub ptys: Mutex<HashMap<String, PtyInstance>>,
}

impl PtyState {
    pub fn new() -> Self {
        Self {
            ptys: Mutex::new(HashMap::new()),
        }
    }
}

fn push_recent_output(buf: &mut VecDeque<u8>, bytes: &[u8]) {
    if bytes.len() >= RECENT_OUTPUT_CAPACITY {
        buf.clear();
        buf.extend(bytes[bytes.len() - RECENT_OUTPUT_CAPACITY..].iter().copied());
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

#[derive(Clone, serde::Serialize)]
struct Payload {
    id: String,
    data: Vec<u8>,
}

#[tauri::command]
pub fn spawn_pty(
    app: AppHandle,
    state: State<'_, PtyState>,
    id: String,
    rows: u16,
    cols: u16,
    cwd: Option<String>,
) -> Result<bool, String> {
    let mut ptys = state.ptys.lock().unwrap();
    if ptys.contains_key(&id) {
        return Ok(false);
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

    ptys.insert(id.clone(), instance);
    drop(ptys); // Release lock before spawning thread

    // Read thread
    thread::spawn(move || {
        let mut buf = [0; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    {
                        let mut recent = recent_output.lock().unwrap();
                        push_recent_output(&mut recent, &data);
                    }
                    let _ = app.emit(
                        "pty-out",
                        Payload {
                            id: id.clone(),
                            data,
                        },
                    );
                }
                Err(_) => break,
            }
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
    let mut ptys = state.ptys.lock().unwrap();
    if ptys.contains_key(&id) {
        return Ok(false);
    }

    let pty_system = NativePtySystem::default();
    let pty_size = PtySize { rows, cols, pixel_width: 0, pixel_height: 0 };
    let pair = pty_system
        .openpty(pty_size)
        .map_err(|e| format!("Failed to open pty: {}", e))?;

    let mut cmd = CommandBuilder::new(&command);
    cmd.env("TERM", "xterm-256color");
    for arg in &args {
        cmd.arg(arg);
    }
    if let Some(vars) = env {
        for (key, value) in vars {
            cmd.env(key, value);
        }
    }
    if let Some(path) = cwd {
        if !path.is_empty() {
            cmd.cwd(path);
        }
    }

    let child = pair
        .slave
        .spawn_command(cmd)
        .map_err(|e| format!("Failed to spawn command '{}': {}", command, e))?;

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

    ptys.insert(id.clone(), instance);
    drop(ptys);

    thread::spawn(move || {
        let mut buf = [0; 4096];
        loop {
            match reader.read(&mut buf) {
                Ok(0) => break,
                Ok(n) => {
                    let data = buf[..n].to_vec();
                    {
                        let mut recent = recent_output.lock().unwrap();
                        push_recent_output(&mut recent, &data);
                    }
                    let _ = app.emit("pty-out", Payload { id: id.clone(), data });
                }
                Err(_) => break,
            }
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
pub fn write_to_pty(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(instance) = ptys.get_mut(&id) {
        let bytes = data.as_bytes();
        // Use a chunked approach for large inputs to avoid overwhelming the PTY buffer
        // especially on Windows/ConPTY which can be sensitive to large rapid writes.
        if bytes.len() > 512 {
            for chunk in bytes.chunks(512) {
                let _ = instance.writer.write_all(chunk);
                let _ = instance.writer.flush();
                // Tiny sleep to allow the PTY driver to process the chunk
                thread::sleep(std::time::Duration::from_millis(5));
            }
        } else {
            let _ = instance.writer.write_all(bytes);
            let _ = instance.writer.flush();
        }
    }
    Ok(())
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
pub fn destroy_pty(state: State<'_, PtyState>, id: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(mut instance) = ptys.remove(&id) {
        let _ = instance.child.kill();
    }
    Ok(())
}

pub fn kill_all_ptys(app: &AppHandle) {
    let state = app.state::<PtyState>();
    let mut ptys = state.ptys.lock().unwrap();
    for (_, mut instance) in ptys.drain() {
        let _ = instance.child.kill();
    }
}
