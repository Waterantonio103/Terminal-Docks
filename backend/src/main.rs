use serde::{Deserialize, Serialize};
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, BufReader};
use std::io::Write;
use std::collections::HashMap;
use crate::workflow_log::{AgentExport, ResultExport};
use crate::workflow::CompiledMission;
use crate::workflow_engine::{HandoffEvent, MissionGraphPatch};
use crate::agent_run::{AgentRunRecord, StartAgentRunRequest};
use crate::mcp::RuntimeBootstrapRequest;


pub mod agent_run;
pub mod db;
pub mod mcp;
pub mod pty;
pub mod swarm;
pub mod workflow;
pub mod workflow_engine;
pub mod workflow_log;
pub mod workspace;

#[derive(Clone)]
pub struct AppState {
    pub pty_state: Arc<pty::PtyState>,
    pub agent_run_state: Arc<agent_run::AgentRunState>,
    pub mcp_state: Arc<mcp::McpState>,
    pub watcher_state: Arc<swarm::WatcherState>,
    pub workflow_state: Arc<workflow_engine::WorkflowState>,
    pub db_state: Arc<db::DbState>,
}

impl AppState {
    pub fn state<T: 'static>(&self) -> Arc<T> {
        // This is a dummy implementation to satisfy app.state::<T>()
        // In actual implementation, we might need a generic map or just use specific getters.
        unimplemented!()
    }
}

pub fn emit_event<T: Serialize>(event: &str, payload: &T) {
    let msg = serde_json::json!({
        "type": "event",
        "event": event,
        "payload": payload,
    });
    println!("{}", msg.to_string());
    std::io::stdout().flush().unwrap();
}

#[derive(Deserialize)]
struct RpcRequest {
    id: String,
    cmd: String,
    payload: serde_json::Value,
}

#[derive(Serialize)]
struct RpcResponse<T> {
    #[serde(rename = "type")]
    res_type: String,
    id: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    payload: Option<T>,
    #[serde(skip_serializing_if = "Option::is_none")]
    error: Option<String>,
}

#[tokio::main]
async fn main() {
    let db_state = Arc::new(db::init_db().unwrap_or_else(|e| {
        eprintln!("Failed to init db: {}", e);
        std::process::exit(1);
    }));

    let app_state = AppState {
        pty_state: Arc::new(pty::PtyState::new()),
        agent_run_state: Arc::new(agent_run::AgentRunState::new()),
        mcp_state: Arc::new(mcp::McpState::new()),
        watcher_state: Arc::new(swarm::WatcherState::new()),
        workflow_state: Arc::new(workflow_engine::WorkflowState::new()),
        db_state,
    };

    if let Err(e) = mcp::init_mcp_server(&app_state) {
        eprintln!("Failed to init MCP server: {}", e);
    }
    swarm::init_swarm_watcher(&app_state).ok();

    let stdin = tokio::io::stdin();
    let mut reader = BufReader::new(stdin);
    let mut line = String::new();

    loop {
        line.clear();
        match reader.read_line(&mut line).await {
            Ok(0) => break, // EOF
            Ok(_) => {
                if let Ok(req) = serde_json::from_str::<RpcRequest>(&line) {
                    let app_state_clone = app_state.clone();
                    tokio::spawn(async move {
                        handle_request(app_state_clone, req).await;
                    });
                }
            }
            Err(e) => {
                eprintln!("Error reading stdin: {}", e);
                break;
            }
        }
    }
}


async fn handle_request(app: AppState, req: RpcRequest) {
    let result: Result<serde_json::Value, String> = (|| -> Result<serde_json::Value, String> {
        match req.cmd.as_str() {

        "export_workflow_log" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub task_description: String, pub generated_at: String, pub file_ts: String, pub agents: Vec<AgentExport>, pub pipeline_names: Vec<String>, pub results: Vec<ResultExport>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(workflow_log::export_workflow_log(app.clone(), args.task_description, args.generated_at, args.file_ts, args.agents, args.pipeline_names, args.results, &app.db_state, &app.pty_state)?).map_err(|e| e.to_string())?)
        }

        "start_mission" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission: CompiledMission
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workflow_engine::start_mission(&app, args.mission);
        Ok(serde_json::json!(null))
        }

        "handle_handoff" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String, pub handoff: HandoffEvent
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workflow_engine::handle_handoff(&app, &args.mission_id, args.handoff);
        Ok(serde_json::json!(null))
        }

        "start_mission_graph" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String, pub graph: CompiledMission
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workflow_engine::start_mission_graph(app.clone(), args.mission_id, args.graph)?;
            Ok(serde_json::json!(null))
        }

        "seed_mission_to_db" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String, pub graph: CompiledMission
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workflow_engine::seed_mission_to_db(app.clone(), args.mission_id, args.graph)?;
            Ok(serde_json::json!(null))
        }

        "append_mission_patch" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String, pub run_version: u32, pub patch: MissionGraphPatch
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(workflow_engine::append_mission_patch(app.clone(), args.mission_id, args.run_version, args.patch)?).map_err(|e| e.to_string())?)
        }

        "retry_mission_node" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String, pub node_id: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workflow_engine::retry_mission_node(app.clone(), args.mission_id, args.node_id)?;
            Ok(serde_json::json!(null))
        }

        "acknowledge_runtime_activation" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String, pub node_id: String, pub attempt: u32, pub status: String, pub reason: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workflow_engine::acknowledge_runtime_activation(app.clone(), args.mission_id, args.node_id, args.attempt, args.status, args.reason)?;
            Ok(serde_json::json!(null))
        }

        "register_runtime_activation_dispatch" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String, pub node_id: String, pub attempt: u32, pub session_id: String, pub agent_id: String, pub terminal_id: String, pub _activated_at: u64
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workflow_engine::register_runtime_activation_dispatch(app.clone(), args.mission_id, args.node_id, args.attempt, args.session_id, args.agent_id, args.terminal_id, args._activated_at)?;
            Ok(serde_json::json!(null))
        }

        "get_mission_activations" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(workflow_engine::get_mission_activations(app.clone(), args.mission_id)?).map_err(|e| e.to_string())?)
        }

        "get_runtime_activation" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: String, pub node_id: String, pub attempt: u32
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(workflow_engine::get_runtime_activation(app.clone(), args.mission_id, args.node_id, args.attempt)?).map_err(|e| e.to_string())?)
        }

        "persist_agent_run" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub record: AgentRunRecord
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            agent_run::persist_agent_run(&app, &args.record)?;
            Ok(serde_json::json!(null))        }

        "start_agent_run" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub payload: StartAgentRunRequest
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(agent_run::start_agent_run(app.clone(), &app.agent_run_state, args.payload)?).map_err(|e| e.to_string())?)
        }

        "cancel_agent_run" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub run_id: String, pub reason: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            agent_run::cancel_agent_run(app.clone(), &app.agent_run_state, args.run_id, args.reason)?;
            Ok(serde_json::json!(null))
        }

        "get_agent_run" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub run_id: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(agent_run::get_agent_run(&app.db_state, args.run_id)?).map_err(|e| e.to_string())?)
        }

        "list_agent_runs" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub mission_id: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(agent_run::list_agent_runs(&app.db_state, args.mission_id)?).map_err(|e| e.to_string())?)
        }

        "watch_directory" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub path: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            swarm::watch_directory(app.clone(), &app.watcher_state, args.path)?;
            Ok(serde_json::json!(null))
        }

        "get_tasks" => {
            
            
            Ok(serde_json::to_value(db::get_tasks(&app.db_state)?).map_err(|e| e.to_string())?)
        }

        "add_task" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub title: String, pub description: Option<String>, pub parent_id: Option<i64>, pub agent_id: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(db::add_task(args.title, args.description, args.parent_id, args.agent_id, &app.db_state)?).map_err(|e| e.to_string())?)
        }

        "update_task_status" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: i64, pub status: String, pub agent_id: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            db::update_task_status(args.id, args.status, args.agent_id, &app.db_state)?;
            Ok(serde_json::json!(null))
        }

        "lock_file" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub file_path: String, pub agent_id: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            db::lock_file(args.file_path, args.agent_id, &app.db_state)?;
            Ok(serde_json::json!(null))
        }

        "unlock_file" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub file_path: String, pub agent_id: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            db::unlock_file(args.file_path, args.agent_id, &app.db_state)?;
            Ok(serde_json::json!(null))
        }

        "get_file_locks" => {
            
            
            Ok(serde_json::to_value(db::get_file_locks(&app.db_state)?).map_err(|e| e.to_string())?)
        }

        "delete_task" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: i64
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            db::delete_task(args.id, &app.db_state)?;
            Ok(serde_json::json!(null))
        }

        "get_db_path" => {
            
            
            Ok(serde_json::to_value(db::get_db_path(&app.db_state)).map_err(|e| e.to_string())?)
        }

        "save_session_event" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub session_id: String, pub event_type: String, pub content: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            db::save_session_event(args.session_id, args.event_type, args.content, &app.db_state)?;
            Ok(serde_json::json!(null))
        }

        "get_session_history" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub limit: Option<i64>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(db::get_session_history(args.limit, &app.db_state)?).map_err(|e| e.to_string())?)
        }

        "workspace_read_dir" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub path: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(workspace::workspace_read_dir(args.path)?).map_err(|e| e.to_string())?)
        }

        "workspace_read_text_file" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub path: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(workspace::workspace_read_text_file(args.path)?).map_err(|e| e.to_string())?)
        }

        "workspace_write_text_file" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub path: String, pub content: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workspace::workspace_write_text_file(args.path, args.content)?;
            Ok(serde_json::json!(null))
        }

        "workspace_create_file" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub parent_path: String, pub name: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workspace::workspace_create_file(args.parent_path, args.name)?;
            Ok(serde_json::json!(null))
        }

        "workspace_create_dir" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub parent_path: String, pub name: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workspace::workspace_create_dir(args.parent_path, args.name)?;
            Ok(serde_json::json!(null))
        }

        "workspace_delete" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub target_path: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workspace::workspace_delete(args.target_path)?;
            Ok(serde_json::json!(null))
        }

        "workspace_rename" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub target_path: String, pub new_name: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workspace::workspace_rename(args.target_path, args.new_name)?;
            Ok(serde_json::json!(null))
        }

        "workspace_copy" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub src: String, pub dest: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workspace::workspace_copy(args.src, args.dest)?;
            Ok(serde_json::json!(null))
        }

        "workspace_move" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub src: String, pub dest: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            workspace::workspace_move(args.src, args.dest)?;
            Ok(serde_json::json!(null))
        }

        "workspace_search" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub dir_path: String, pub query: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(workspace::workspace_search(args.dir_path, args.query)?).map_err(|e| e.to_string())?)
        }

        "classify_permission_prompt" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub raw: String, pub cli: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(pty::classify_permission_prompt(&args.raw, &args.cli)).map_err(|e| e.to_string())?)
        }

        "spawn_pty" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: String, pub rows: u16, pub cols: u16, pub cwd: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(pty::spawn_pty(app.clone(), &app.pty_state, args.id, args.rows, args.cols, args.cwd)?).map_err(|e| e.to_string())?)
        }

        "spawn_pty_with_command" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: String, pub rows: u16, pub cols: u16, pub cwd: Option<String>, pub command: String, pub args: Vec<String>, pub env: Option<HashMap<String, String>>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(pty::spawn_pty_with_command(app.clone(), &app.pty_state, args.id, args.rows, args.cols, args.cwd, args.command, args.args, args.env)?).map_err(|e| e.to_string())?)
        }

        "get_pty_recent_output" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: String, pub max_bytes: Option<usize>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(pty::get_pty_recent_output(&app.pty_state, args.id, args.max_bytes)?).map_err(|e| e.to_string())?)
        }

        "is_pty_active" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(pty::is_pty_active(&app.pty_state, args.id)).map_err(|e| e.to_string())?)
        }

        "write_to_pty" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: String, pub data: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            pty::write_to_pty(&app.pty_state, args.id, args.data)?;
            Ok(serde_json::json!(null))
        }

        "handle_workflow_permission_decision" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub request_id: String, pub decision: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            pty::handle_workflow_permission_decision(app.clone(), &app.pty_state, args.request_id, args.decision)?;
            Ok(serde_json::json!(null))
        }

        "register_pty_runtime_metadata" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub terminal_id: String, pub node_id: Option<String>, pub runtime_session_id: Option<String>, pub cli: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            pty::register_pty_runtime_metadata(&app.pty_state, args.terminal_id, args.node_id, args.runtime_session_id, args.cli)?;
            Ok(serde_json::json!(null))
        }

        "list_active_permission_requests" => {
            
            
            Ok(serde_json::to_value(pty::list_active_permission_requests(&app.pty_state)).map_err(|e| e.to_string())?)
        }

        "list_permission_audit_entries" => {
            
            
            Ok(serde_json::to_value(pty::list_permission_audit_entries(&app.pty_state)).map_err(|e| e.to_string())?)
        }

        "resize_pty" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: String, pub rows: u16, pub cols: u16
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            pty::resize_pty(&app.pty_state, args.id, args.rows, args.cols)?;
            Ok(serde_json::json!(null))
        }

        "destroy_pty" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub id: String
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            pty::destroy_pty(app.clone(), &app.pty_state, args.id)?;
            Ok(serde_json::json!(null))
        }

        "kill_all_ptys" => {
            
            
            pty::kill_all_ptys(&app);
        Ok(serde_json::json!(null))
        }

        "get_mcp_url" => {
            
            
            Ok(serde_json::to_value(mcp::get_mcp_url(&app.mcp_state)).map_err(|e| e.to_string())?)
        }

        "mcp_register_runtime_session" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub payload: RuntimeBootstrapRequest
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(mcp::mcp_register_runtime_session(&app.mcp_state, args.payload)?).map_err(|e| e.to_string())?)
        }

        "mcp_notify_agent" => {
            #[derive(serde::Deserialize)]
        struct Args {
            pub session_id: String, pub kind: String, pub mission_id: Option<String>, pub node_id: Option<String>, pub task_seq: Option<u64>, pub attempt: Option<u64>, pub reason: Option<String>, pub outcome: Option<String>, pub summary: Option<String>, pub raw_output: Option<String>
        }
            let args: Args = serde_json::from_value(req.payload.clone()).map_err(|e| e.to_string())?;
            Ok(serde_json::to_value(mcp::mcp_notify_agent(&app.mcp_state, args.session_id, args.kind, args.mission_id, args.node_id, args.task_seq, args.attempt, args.reason, args.outcome, args.summary, args.raw_output)?).map_err(|e| e.to_string())?)
        }
            _ => Err(format!("Method not implemented: {}", req.cmd)),
        }
    })();

    let res = match result {
        Ok(payload) => serde_json::json!({
            "type": "response",
            "id": req.id,
            "payload": payload,
        }),
        Err(err) => serde_json::json!({
            "type": "response",
            "id": req.id,
            "error": err,
        }),
    };
    println!("{}", res.to_string());
    std::io::stdout().flush().unwrap();
}


pub fn greet(name: &str) -> String {
    format!("Hello, {}! You've been greeted from Rust!", name)
}
