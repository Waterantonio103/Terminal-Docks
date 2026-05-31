pub mod agent_run;
pub mod db;
pub mod fs_watcher;
pub mod mcp;
pub mod model_detection;
pub mod pty;
pub mod sdk_http;
pub mod workflow;
pub mod workflow_engine;
pub mod workflow_log;
pub mod workspace;

use tauri::Emitter;

#[tauri::command]
fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}

#[tauri::command]
async fn get_command_output(command: String, args: Vec<String>) -> Result<String, String> {
    let output = std::process::Command::new(&command)
        .args(&args)
        .output()
        .map_err(|e| e.to_string())?;
    let stdout = String::from_utf8_lossy(&output.stdout).to_string();
    let stderr = String::from_utf8_lossy(&output.stderr).to_string();
    Ok(stdout + &stderr)
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
        .manage(fs_watcher::WatcherState::new())
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
            pty::handle_workflow_permission_decision,
            pty::register_pty_runtime_metadata,
            reveal_in_explorer,
            pty::list_active_permission_requests,
            pty::list_permission_audit_entries,
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
            db::get_workflow_definition,
            db::save_workflow_definition,
            db::get_mission_snapshot,
            db::upsert_mission_record,
            db::update_mission_status,
            db::write_artifact,
            db::list_artifacts,
            db::append_workflow_event,
            db::get_workflow_events,
            db::upsert_follow_up_message,
            db::list_follow_up_messages,
            db::list_workflow_run_history,
            db::get_workflow_run_history,
            db::create_task_inbox_item,
            db::get_task_inbox_items,
            db::update_task_inbox_item_status,
            db::upsert_node_edge,
            agent_run::start_agent_run,
            agent_run::write_prompt_temp_file,
            agent_run::cancel_agent_run,
            agent_run::get_agent_run,
            agent_run::list_agent_runs,
            mcp::get_mcp_url,
            mcp::get_mcp_base_url,
            mcp::mcp_register_runtime_session,
            mcp::mcp_notify_agent,
            fs_watcher::get_fs_watcher_status,
            fs_watcher::watch_directory,
            workflow_log::export_workflow_log,
            workflow_engine::start_mission_graph,
            workflow_engine::seed_mission_to_db,
            workflow_engine::retry_mission_node,
            workflow_engine::append_mission_patch,
            workflow_engine::register_runtime_activation_dispatch,
            workflow_engine::acknowledge_runtime_activation,
            workflow_engine::get_runtime_activation,
            workflow_engine::get_mission_activations,
            workspace::workspace_read_dir,
            workspace::workspace_create_file,
            workspace::workspace_create_dir,
            workspace::workspace_create_dir_all,
            workspace::workspace_rename,
            workspace::workspace_delete,
            workspace::workspace_read_text_file,
            workspace::workspace_read_binary_file_base64,
            workspace::workspace_write_text_file,
            workspace::workspace_copy,
            workspace::workspace_move,
            workspace::workspace_search,
            sdk_http::sdk_http_request,
            sdk_http::sdk_http_stream,
            model_detection::detect_models,
            model_detection::discover_models,
            model_detection::discover_cli_models,
            model_detection::discover_cli_capabilities,
            get_command_output,
        ])
        .setup(|app| {
            db::init_db(app.handle()).expect("Failed to init db");
            if let Err(error) = mcp::init_mcp_server(app.handle()) {
                eprintln!("Failed to init Starlink server: {}", error);
                let _ = app.emit("mcp-startup-error", error);
            }
            fs_watcher::init_fs_watcher(app.handle()).ok();
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

#[tauri::command]
fn reveal_in_explorer(path: String) {
    #[cfg(target_os = "windows")]
    {
        use std::process::Command;
        let path_ref = std::path::Path::new(&path);
        let p = path.replace("/", "\\");
        let mut command = Command::new("explorer");
        if path_ref.is_dir() {
            command.arg(p);
        } else {
            command.arg(format!("/select,{}", p));
        }
        command.spawn().ok();
    }
    #[cfg(target_os = "macos")]
    {
        use std::process::Command;
        let path_ref = std::path::Path::new(&path);
        if path_ref.is_dir() {
            Command::new("open").arg(path).spawn().ok();
        } else {
            Command::new("open").arg("-R").arg(path).spawn().ok();
        }
    }
    #[cfg(target_os = "linux")]
    {
        use std::process::Command;
        let p = std::path::Path::new(&path);
        let dir = if p.is_dir() {
            p
        } else {
            p.parent().unwrap_or(std::path::Path::new("/"))
        };
        Command::new("xdg-open").arg(dir).spawn().ok();
    }
}
