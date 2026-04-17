pub mod db;
pub mod pty;
pub mod swarm;

// Learn more about Tauri commands at https://tauri.app/develop/calling-rust/
#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty::spawn_pty,
            pty::write_to_pty,
            pty::resize_pty,
            pty::destroy_pty,
            db::get_tasks,
            db::add_task,
            db::update_task_status,
            db::delete_task,
            swarm::get_swarm_status
        ])
        .setup(|app| {
            use tauri::Manager;
            app.manage(pty::PtyState::new());

            // Initialize db
            db::init_db(app.handle()).expect("Failed to init db");

            // Initialize swarm
            swarm::init_swarm_watcher(app.handle()).expect("Failed to init swarm");
            Ok(())
        })
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
