use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};
use crate::workflow::{WorkflowGraph, WorkflowNode};
use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HandoffEvent {
    pub task_id: Option<i64>,
    pub from_node_id: Option<String>,
    pub target_node_id: Option<String>,
    pub payload: Option<String>,
}

pub struct WorkflowState {
    pub active_missions: Arc<Mutex<HashMap<String, WorkflowGraph>>>,
}

impl WorkflowState {
    pub fn new() -> Self {
        Self {
            active_missions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

pub fn start_mission(app: &AppHandle, mission_id: String, graph: WorkflowGraph) {
    let state = app.state::<WorkflowState>();
    let mut missions = state.active_missions.lock().unwrap();
    missions.insert(mission_id.clone(), graph.clone());

    // Find starting nodes (nodes with no incoming edges)
    let mut starting_nodes = Vec::new();
    for node in &graph.nodes {
        let has_incoming = graph.edges.iter().any(|e| e.to_node_id == node.id);
        if !has_incoming {
            starting_nodes.push(node.id.clone());
        }
    }

    // Trigger starting nodes
    for node_id in starting_nodes {
        trigger_node(app, &mission_id, &node_id, None);
    }
}

pub fn handle_handoff(app: &AppHandle, mission_id: &str, handoff: HandoffEvent) {
    let state = app.state::<WorkflowState>();
    let mut missions = state.active_missions.lock().unwrap();
    
    if let Some(graph) = missions.get_mut(mission_id) {
        // Mark from_node as completed
        if let Some(ref from_id) = handoff.from_node_id {
            if let Some(from_node) = graph.nodes.iter_mut().find(|n| n.id == *from_id) {
                from_node.status = "completed".to_string();
                let _ = app.emit("workflow-node-update", from_node.clone());
            }
        }

        // Check if target_node is ready to be triggered
        // It's ready if all its incoming edges' from_nodes are 'completed'
        if let Some(ref target_id) = handoff.target_node_id {
            let mut all_parents_completed = true;
            for edge in graph.edges.iter().filter(|e| e.to_node_id == *target_id) {
                if let Some(parent) = graph.nodes.iter().find(|n| n.id == edge.from_node_id) {
                    if parent.status != "completed" {
                        all_parents_completed = false;
                        break;
                    }
                }
            }

            if all_parents_completed {
                // Trigger target node
                trigger_node(app, mission_id, target_id, handoff.payload);
            }
        }
    }
}

fn trigger_node(app: &AppHandle, mission_id: &str, node_id: &str, payload: Option<String>) {
    let state = app.state::<WorkflowState>();
    let mut missions = state.active_missions.lock().unwrap();
    
    if let Some(graph) = missions.get_mut(mission_id) {
        if let Some(node) = graph.nodes.iter_mut().find(|n| n.id == node_id) {
            node.status = "running".to_string();
            
            // Emit event to update UI and wake up agent
            #[derive(Serialize, Clone)]
            #[serde(rename_all = "camelCase")]
            struct TriggerEvent {
                mission_id: String,
                node_id: String,
                role_id: String,
                payload: Option<String>,
            }
            
            let _ = app.emit("workflow-node-triggered", TriggerEvent {
                mission_id: mission_id.to_string(),
                node_id: node_id.to_string(),
                role_id: node.role_id.clone(),
                payload,
            });
            
            let _ = app.emit("workflow-node-update", node.clone());
        }
    }
}

#[tauri::command]
pub fn start_mission_graph(app: AppHandle, mission_id: String, graph: WorkflowGraph) -> Result<(), String> {
    start_mission(&app, mission_id, graph);
    Ok(())
}
