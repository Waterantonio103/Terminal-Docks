pub mod db;
pub mod pty;
pub mod mcp;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_clipboard_manager::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_shell::init())
        .plugin(tauri_plugin_fs::init())
        .plugin(tauri_plugin_opener::init())
        .manage(pty::PtyState::new())
        .manage(mcp::McpState::new())
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
            db::lock_file,
            db::unlock_file,
            db::get_file_locks,
            mcp::get_mcp_url,
        ])
        .setup(|app| {
            db::init_db(app.handle()).expect("Failed to init db");
            mcp::init_mcp_server(app.handle()).expect("Failed to init MCP server");
            Ok(())
        })
        .build(tauri::generate_context!())
        .expect("error while building tauri application")
        .run(|app_handle, event| {
            if let tauri::RunEvent::Exit = event {
                pty::kill_all_ptys(app_handle);
                mcp::kill_mcp_server(app_handle);
            }
        });
}
