use tauri::{AppHandle, Emitter};
use notify::{Watcher, RecursiveMode, Config};
use std::path::PathBuf;
use std::sync::mpsc::channel;
use std::thread;

#[derive(Clone, serde::Serialize)]
struct SwarmActivity {
    event: String,
    path: String,
}

pub fn init_swarm_watcher(app: &AppHandle) -> Result<(), String> {
    let app_handle = app.clone();
    
    thread::spawn(move || {
        let (tx, rx) = channel();
        let mut watcher = match notify::RecommendedWatcher::new(tx, Config::default()) {
            Ok(w) => w,
            Err(_) => return,
        };
        
        let mut current_dir = std::env::current_dir().unwrap_or_else(|_| PathBuf::from("."));
        current_dir.push(".swarm");
        current_dir.push("mailbox");
        let _ = std::fs::create_dir_all(&current_dir);
        
        if watcher.watch(&current_dir, RecursiveMode::Recursive).is_err() {
            return;
        }
        
        for res in rx {
            if let Ok(event) = res {
                for path in event.paths {
                    if let Some(file_name) = path.file_name() {
                        let msg = SwarmActivity {
                            event: format!("{:?}", event.kind),
                            path: file_name.to_string_lossy().to_string(),
                        };
                        let _ = app_handle.emit("swarm-activity", msg);
                    }
                }
            }
        }
    });

    Ok(())
}

#[tauri::command]
pub fn get_swarm_status() -> Result<String, String> {
    Ok("Active".to_string())
}

