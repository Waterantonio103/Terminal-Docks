use portable_pty::{CommandBuilder, MasterPty, NativePtySystem, PtySize, PtySystem};
use std::collections::HashMap;
use std::io::{Read, Write};
use std::sync::Mutex;
use std::thread;
use tauri::{AppHandle, Emitter, State};

pub struct PtyInstance {
    pub master: Box<dyn MasterPty + Send>,
    pub writer: Box<dyn Write + Send>,
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

    let cmd = if cfg!(target_os = "windows") {
        CommandBuilder::new("cmd.exe")
    } else {
        let shell = std::env::var("SHELL").unwrap_or_else(|_| "sh".to_string());
        CommandBuilder::new(shell)
    };

    let _child = pair
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

    let instance = PtyInstance { master, writer };

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
pub fn write_to_pty(state: State<'_, PtyState>, id: String, data: String) -> Result<(), String> {
    let mut ptys = state.ptys.lock().unwrap();
    if let Some(instance) = ptys.get_mut(&id) {
        let _ = instance.writer.write_all(data.as_bytes());
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
    ptys.remove(&id);
    Ok(())
}
