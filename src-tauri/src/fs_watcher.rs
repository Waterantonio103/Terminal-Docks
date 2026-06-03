use notify::{Config, Event, RecommendedWatcher, RecursiveMode, Watcher};
use serde::Serialize;
use std::path::Path;
use std::sync::Mutex;
use tauri::AppHandle;
use tauri::Emitter;

pub struct WatcherState(pub Mutex<Option<RecommendedWatcher>>);

#[derive(Clone, Serialize)]
#[serde(rename_all = "camelCase")]
struct FsChangePayload {
    changed_dir: String,
    paths: Vec<String>,
    kind: String,
}

impl WatcherState {
    pub fn new() -> Self {
        WatcherState(Mutex::new(None))
    }
}

pub fn init_fs_watcher(_app: &AppHandle) -> Result<(), String> {
    Ok(())
}

#[tauri::command]
pub fn get_fs_watcher_status() -> Result<String, String> {
    Ok("Active".to_string())
}

#[tauri::command]
pub fn watch_directory(
    app: AppHandle,
    state: tauri::State<WatcherState>,
    path: String,
) -> Result<(), String> {
    let app_clone = app.clone();

    let mut watcher = RecommendedWatcher::new(
        move |res: notify::Result<Event>| {
            if let Ok(event) = res {
                match event.kind {
                    notify::EventKind::Any
                    | notify::EventKind::Create(_)
                    | notify::EventKind::Remove(_)
                    | notify::EventKind::Modify(_) => {
                        let changed_dir = event
                            .paths
                            .first()
                            .and_then(|p| {
                                if p.is_dir() {
                                    Some(p.to_string_lossy().to_string())
                                } else {
                                    p.parent().map(|d| d.to_string_lossy().to_string())
                                }
                            })
                            .unwrap_or_default();
                        let payload = FsChangePayload {
                            changed_dir,
                            paths: event
                                .paths
                                .iter()
                                .map(|p| p.to_string_lossy().to_string())
                                .collect(),
                            kind: format!("{:?}", event.kind),
                        };
                        let _ = app_clone.emit("fs-change", payload);
                    }
                    _ => {}
                }
            }
        },
        Config::default(),
    )
    .map_err(|e| e.to_string())?;

    watcher
        .watch(Path::new(&path), RecursiveMode::Recursive)
        .map_err(|e| e.to_string())?;

    let mut guard = state.0.lock().unwrap();
    *guard = Some(watcher);

    Ok(())
}
