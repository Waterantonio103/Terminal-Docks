pub mod db;
pub mod agent_run;
pub mod pty;
pub mod mcp;
pub mod swarm;
pub mod workflow;
pub mod workflow_engine;
pub mod workflow_log;

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
        .manage(agent_run::AgentRunState::new())
        .manage(mcp::McpState::new())
        .manage(swarm::WatcherState::new())
        .manage(workflow_engine::WorkflowState::new())
        .invoke_handler(tauri::generate_handler![
            greet,
            pty::spawn_pty,
            pty::spawn_pty_with_command,
            pty::write_to_pty,
            pty::resize_pty,
            pty::destroy_pty,
            pty::get_pty_recent_output,
            pty::is_pty_active,
            db::get_tasks,
            db::add_task,
            db::update_task_status,
            db::delete_task,
            db::lock_file,
            db::unlock_file,
            db::get_file_locks,
            db::get_db_path,
            db::save_session_event,
            db::get_session_history,
            agent_run::start_agent_run,
            agent_run::cancel_agent_run,
            agent_run::get_agent_run,
            agent_run::list_agent_runs,
            mcp::get_mcp_url,
            mcp::get_mcp_base_url,
            mcp::mcp_register_runtime_session,
            mcp::mcp_notify_agent,
            swarm::get_swarm_status,
            swarm::watch_directory,
            workflow_log::export_workflow_log,
            workflow_engine::start_mission_graph,
            workflow_engine::retry_mission_node,
            workflow_engine::append_mission_patch,
            workflow_engine::register_runtime_activation_dispatch,
            workflow_engine::acknowledge_runtime_activation,
            workflow_engine::get_runtime_activation,
        ])
        .setup(|app| {
            db::init_db(app.handle()).expect("Failed to init db");
            mcp::init_mcp_server(app.handle()).expect("Failed to init MCP server");
            swarm::init_swarm_watcher(app.handle()).ok();
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
