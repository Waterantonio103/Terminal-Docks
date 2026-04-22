use crate::db::DbState;
use crate::workflow::{CompiledMission, WorkflowEdgeCondition};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter, Manager};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeOutcome {
    Success,
    Failure,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct HandoffEvent {
    pub task_id: Option<i64>,
    pub from_node_id: Option<String>,
    pub target_node_id: Option<String>,
    pub payload: Option<String>,
    pub outcome: Option<NodeOutcome>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct TriggeredInput {
    task_id: Option<i64>,
    from_node_id: String,
    outcome: NodeOutcome,
    payload: Option<String>,
}

#[derive(Debug, Clone, Default)]
struct PendingActivation {
    activated_from: HashSet<String>,
    inputs: Vec<TriggeredInput>,
}

#[derive(Debug, Clone)]
struct ActiveMission {
    mission: CompiledMission,
    node_statuses: HashMap<String, String>,
    node_attempts: HashMap<String, u32>,
    node_waves: HashMap<String, String>,
    node_last_outcomes: HashMap<String, NodeOutcome>,
    pending_activations: HashMap<(String, String), PendingActivation>,
    layer_index: HashMap<String, usize>,
}

pub struct WorkflowState {
    active_missions: Arc<Mutex<HashMap<String, ActiveMission>>>,
}

impl WorkflowState {
    pub fn new() -> Self {
        Self {
            active_missions: Arc::new(Mutex::new(HashMap::new())),
        }
    }
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct NodeStatusEvent {
    id: String,
    status: String,
    attempt: Option<u32>,
    outcome: Option<NodeOutcome>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct TriggerEvent {
    mission_id: String,
    node_id: String,
    role_id: String,
    attempt: u32,
    payload: Option<String>,
}

fn root_wave_id(mission_id: &str) -> String {
    format!("root:{mission_id}")
}

fn build_layer_index(mission: &CompiledMission) -> HashMap<String, usize> {
    let mut index = HashMap::new();
    for (layer_idx, layer) in mission.metadata.execution_layers.iter().enumerate() {
        for node_id in layer {
            index.insert(node_id.clone(), layer_idx);
        }
    }
    index
}

fn outcome_to_status(outcome: &NodeOutcome) -> &'static str {
    match outcome {
        NodeOutcome::Success => "completed",
        NodeOutcome::Failure => "failed",
    }
}

fn edge_matches_outcome(condition: &WorkflowEdgeCondition, outcome: &NodeOutcome) -> bool {
    match condition {
        WorkflowEdgeCondition::Always => true,
        WorkflowEdgeCondition::OnSuccess => matches!(outcome, NodeOutcome::Success),
        WorkflowEdgeCondition::OnFailure => matches!(outcome, NodeOutcome::Failure),
    }
}

fn mission_node<'a>(mission: &'a CompiledMission, node_id: &str) -> Option<&'a crate::workflow::CompiledMissionNode> {
    mission.nodes.iter().find(|node| node.id == node_id)
}

fn emit_node_status(
    app: &AppHandle,
    node_id: &str,
    status: &str,
    attempt: Option<u32>,
    outcome: Option<NodeOutcome>,
) {
    let _ = app.emit(
        "workflow-node-update",
        NodeStatusEvent {
            id: node_id.to_string(),
            status: status.to_string(),
            attempt,
            outcome,
        },
    );
}

fn persist_compiled_mission(app: &AppHandle, mission: &CompiledMission, status: &str) {
    let serialized = match serde_json::to_string(mission) {
        Ok(value) => value,
        Err(_) => return,
    };

    let state = app.state::<DbState>();
    let db_lock = match state.db.lock() {
        Ok(lock) => lock,
        Err(_) => return,
    };
    let Some(conn) = db_lock.as_ref() else {
        return;
    };

    let _ = conn.execute(
        "INSERT INTO compiled_missions (mission_id, graph_id, mission_json, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(mission_id) DO UPDATE SET
           graph_id = excluded.graph_id,
           mission_json = excluded.mission_json,
           status = excluded.status,
           updated_at = CURRENT_TIMESTAMP",
        params![&mission.mission_id, &mission.graph_id, serialized, status],
    );
}

fn persist_node_runtime(
    app: &AppHandle,
    mission_id: &str,
    node_id: &str,
    role_id: &str,
    status: &str,
    attempt: u32,
    current_wave_id: Option<&str>,
    last_outcome: Option<&NodeOutcome>,
    last_payload: Option<&str>,
) {
    let state = app.state::<DbState>();
    let db_lock = match state.db.lock() {
        Ok(lock) => lock,
        Err(_) => return,
    };
    let Some(conn) = db_lock.as_ref() else {
        return;
    };

    let last_outcome_str = last_outcome.map(|value| match value {
        NodeOutcome::Success => "success",
        NodeOutcome::Failure => "failure",
    });

    let _ = conn.execute(
        "INSERT INTO mission_node_runtime
           (mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome, last_payload, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, CURRENT_TIMESTAMP)
         ON CONFLICT(mission_id, node_id) DO UPDATE SET
           role_id = excluded.role_id,
           status = excluded.status,
           attempt = excluded.attempt,
           current_wave_id = excluded.current_wave_id,
           last_outcome = excluded.last_outcome,
           last_payload = excluded.last_payload,
           updated_at = CURRENT_TIMESTAMP",
        params![
            mission_id,
            node_id,
            role_id,
            status,
            attempt,
            current_wave_id,
            last_outcome_str,
            last_payload
        ],
    );
}

fn relevant_parent_ids_for_wave(
    active_mission: &ActiveMission,
    target_node_id: &str,
    wave_id: &str,
) -> HashSet<String> {
    active_mission
        .mission
        .edges
        .iter()
        .filter(|edge| edge.to_node_id == target_node_id)
        .filter_map(|edge| {
            let parent_wave = active_mission.node_waves.get(&edge.from_node_id)?;
            if parent_wave != wave_id {
                return None;
            }

            let status = active_mission
                .node_statuses
                .get(&edge.from_node_id)
                .map(String::as_str)
                .unwrap_or("idle");

            if status == "idle" {
                return None;
            }

            if status == "completed" || status == "failed" {
                let outcome = active_mission.node_last_outcomes.get(&edge.from_node_id)?;
                if !edge_matches_outcome(&edge.condition, outcome) {
                    return None;
                }
            }

            Some(edge.from_node_id.clone())
        })
        .collect()
}

fn is_node_ready_for_wave(active_mission: &ActiveMission, target_node_id: &str, wave_id: &str) -> bool {
    let key = (target_node_id.to_string(), wave_id.to_string());
    let Some(pending) = active_mission.pending_activations.get(&key) else {
        return false;
    };

    if pending.activated_from.is_empty() {
        return false;
    }

    let relevant_parents = relevant_parent_ids_for_wave(active_mission, target_node_id, wave_id);
    !relevant_parents.is_empty() && relevant_parents == pending.activated_from
}

fn next_wave_id(active_mission: &ActiveMission, from_node_id: &str, target_node_id: &str) -> String {
    let current_wave = active_mission
        .node_waves
        .get(from_node_id)
        .cloned()
        .unwrap_or_else(|| root_wave_id(&active_mission.mission.mission_id));

    let from_layer = active_mission.layer_index.get(from_node_id).copied();
    let target_layer = active_mission.layer_index.get(target_node_id).copied();

    if let (Some(from), Some(to)) = (from_layer, target_layer) {
        if to <= from {
            let attempt = active_mission.node_attempts.get(from_node_id).copied().unwrap_or(0);
            return format!("retry:{from_node_id}:{attempt}");
        }
    }

    current_wave
}

fn trigger_node_locked(
    app: &AppHandle,
    mission_id: &str,
    active_mission: &mut ActiveMission,
    node_id: &str,
    wave_id: String,
    payload: Option<String>,
) {
    let current_status = active_mission
        .node_statuses
        .get(node_id)
        .cloned()
        .unwrap_or_else(|| "idle".to_string());
    if current_status == "running" {
        return;
    }

    let Some(role_id) = mission_node(&active_mission.mission, node_id).map(|node| node.role_id.clone()) else {
        return;
    };

    let attempt = {
        let counter = active_mission
            .node_attempts
            .entry(node_id.to_string())
            .or_insert(0);
        *counter += 1;
        *counter
    };

    active_mission
        .node_statuses
        .insert(node_id.to_string(), "running".to_string());
    active_mission
        .node_waves
        .insert(node_id.to_string(), wave_id.clone());

    persist_node_runtime(
        app,
        mission_id,
        node_id,
        &role_id,
        "running",
        attempt,
        Some(&wave_id),
        None,
        payload.as_deref(),
    );
    emit_node_status(app, node_id, "running", Some(attempt), None);

    let _ = app.emit(
        "workflow-node-triggered",
        TriggerEvent {
            mission_id: mission_id.to_string(),
            node_id: node_id.to_string(),
            role_id,
            attempt,
            payload,
        },
    );
}

fn get_start_node_ids(mission: &CompiledMission) -> Vec<String> {
    if !mission.metadata.start_node_ids.is_empty() {
        return mission.metadata.start_node_ids.clone();
    }

    mission
        .nodes
        .iter()
        .filter(|node| !mission.edges.iter().any(|edge| edge.to_node_id == node.id))
        .map(|node| node.id.clone())
        .collect()
}

pub fn start_mission(app: &AppHandle, mission: CompiledMission) {
    let mission_id = mission.mission_id.clone();
    let start_node_ids = get_start_node_ids(&mission);
    let layer_index = build_layer_index(&mission);

    persist_compiled_mission(app, &mission, "active");

    let mut node_statuses = HashMap::new();
    let mut node_attempts = HashMap::new();
    for node in &mission.nodes {
        node_statuses.insert(node.id.clone(), "idle".to_string());
        node_attempts.insert(node.id.clone(), 0);
        persist_node_runtime(
            app,
            &mission_id,
            &node.id,
            &node.role_id,
            "idle",
            0,
            None,
            None,
            None,
        );
    }

    let mut active_mission = ActiveMission {
        mission,
        node_statuses,
        node_attempts,
        node_waves: HashMap::new(),
        node_last_outcomes: HashMap::new(),
        pending_activations: HashMap::new(),
        layer_index,
    };

    let root_wave = root_wave_id(&mission_id);
    for node_id in &start_node_ids {
        trigger_node_locked(
            app,
            &mission_id,
            &mut active_mission,
            node_id,
            root_wave.clone(),
            None,
        );
    }

    let state = app.state::<WorkflowState>();
    let mut missions = state.active_missions.lock().unwrap();
    missions.insert(mission_id, active_mission);
}

pub fn handle_handoff(app: &AppHandle, mission_id: &str, handoff: HandoffEvent) {
    let Some(from_id) = handoff.from_node_id.clone() else {
        return;
    };
    let Some(outcome) = handoff.outcome.clone() else {
        return;
    };

    let state = app.state::<WorkflowState>();
    let mut missions = state.active_missions.lock().unwrap();

    let Some(active_mission) = missions.get_mut(mission_id) else {
        return;
    };
    if mission_node(&active_mission.mission, &from_id).is_none() {
        return;
    }

    let from_status = outcome_to_status(&outcome).to_string();
    let from_attempt = active_mission.node_attempts.get(&from_id).copied().unwrap_or(0);
    let from_wave = active_mission.node_waves.get(&from_id).cloned();
    active_mission
        .node_statuses
        .insert(from_id.clone(), from_status.clone());
    active_mission
        .node_last_outcomes
        .insert(from_id.clone(), outcome.clone());

    if let Some(role_id) = mission_node(&active_mission.mission, &from_id).map(|node| node.role_id.clone()) {
        persist_node_runtime(
            app,
            mission_id,
            &from_id,
            &role_id,
            &from_status,
            from_attempt,
            from_wave.as_deref(),
            Some(&outcome),
            handoff.payload.as_deref(),
        );
    }
    emit_node_status(
        app,
        &from_id,
        &from_status,
        Some(from_attempt),
        Some(outcome.clone()),
    );

    let Some(target_id) = handoff.target_node_id.clone() else {
        return;
    };
    if mission_node(&active_mission.mission, &target_id).is_none() {
        return;
    }

    let wave_id = next_wave_id(active_mission, &from_id, &target_id);
    let pending_key = (target_id.clone(), wave_id.clone());
    let pending = active_mission
        .pending_activations
        .entry(pending_key.clone())
        .or_default();

    pending.activated_from.insert(from_id.clone());
    pending.inputs.push(TriggeredInput {
        task_id: handoff.task_id,
        from_node_id: from_id.clone(),
        outcome: outcome.clone(),
        payload: handoff.payload.clone(),
    });

    if is_node_ready_for_wave(active_mission, &target_id, &wave_id) {
        let pending = active_mission
            .pending_activations
            .remove(&pending_key)
            .unwrap_or_default();
        let aggregated_payload = serde_json::to_string(&pending.inputs).ok();
        trigger_node_locked(
            app,
            mission_id,
            active_mission,
            &target_id,
            wave_id,
            aggregated_payload,
        );
        return;
    }

    let target_attempt = active_mission.node_attempts.get(&target_id).copied().unwrap_or(0);
    let current_status = active_mission
        .node_statuses
        .get(&target_id)
        .cloned()
        .unwrap_or_else(|| "idle".to_string());

    if current_status != "running" {
        active_mission
            .node_statuses
            .insert(target_id.clone(), "waiting".to_string());
        active_mission
            .node_waves
            .insert(target_id.clone(), wave_id.clone());

        if let Some(role_id) = mission_node(&active_mission.mission, &target_id).map(|node| node.role_id.clone()) {
            persist_node_runtime(
                app,
                mission_id,
                &target_id,
                &role_id,
                "waiting",
                target_attempt,
                Some(&wave_id),
                active_mission.node_last_outcomes.get(&target_id),
                handoff.payload.as_deref(),
            );
        }
        emit_node_status(app, &target_id, "waiting", Some(target_attempt), None);
    }
}

#[tauri::command]
pub fn start_mission_graph(
    app: AppHandle,
    mission_id: String,
    graph: CompiledMission,
) -> Result<(), String> {
    if graph.mission_id != mission_id {
        return Err(format!(
            "Mission ID mismatch: command received {}, payload contains {}",
            mission_id, graph.mission_id
        ));
    }
    start_mission(&app, graph);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::workflow::{
        CompiledMissionEdge, CompiledMissionMetadata, CompiledMissionNode,
        CompiledMissionTaskContext, CompiledMissionTerminalBinding, WorkflowAgentCli, WorkflowMode,
    };

    fn test_terminal(title: &str) -> CompiledMissionTerminalBinding {
        CompiledMissionTerminalBinding {
            terminal_id: format!("term-{title}"),
            terminal_title: title.to_string(),
            cli: WorkflowAgentCli::Claude,
            pane_id: None,
            reused_existing: true,
        }
    }

    fn retry_mission() -> CompiledMission {
        CompiledMission {
            mission_id: "mission-1".to_string(),
            graph_id: "graph-1".to_string(),
            task: CompiledMissionTaskContext {
                node_id: "task-1".to_string(),
                prompt: "Ship it".to_string(),
                mode: WorkflowMode::Build,
                workspace_dir: Some("C:/workspace".to_string()),
            },
            metadata: CompiledMissionMetadata {
                compiled_at: 1,
                source_graph_id: "graph-1".to_string(),
                start_node_ids: vec!["builder".to_string(), "tester".to_string(), "security".to_string()],
                execution_layers: vec![
                    vec!["builder".to_string(), "tester".to_string(), "security".to_string()],
                    vec!["reviewer".to_string()],
                ],
            },
            nodes: vec![
                CompiledMissionNode {
                    id: "builder".to_string(),
                    role_id: "builder".to_string(),
                    instruction_override: String::new(),
                    terminal: test_terminal("builder"),
                },
                CompiledMissionNode {
                    id: "tester".to_string(),
                    role_id: "tester".to_string(),
                    instruction_override: String::new(),
                    terminal: test_terminal("tester"),
                },
                CompiledMissionNode {
                    id: "security".to_string(),
                    role_id: "security".to_string(),
                    instruction_override: String::new(),
                    terminal: test_terminal("security"),
                },
                CompiledMissionNode {
                    id: "reviewer".to_string(),
                    role_id: "reviewer".to_string(),
                    instruction_override: String::new(),
                    terminal: test_terminal("reviewer"),
                },
            ],
            edges: vec![
                CompiledMissionEdge {
                    id: "builder-reviewer".to_string(),
                    from_node_id: "builder".to_string(),
                    to_node_id: "reviewer".to_string(),
                    condition: WorkflowEdgeCondition::Always,
                },
                CompiledMissionEdge {
                    id: "tester-reviewer".to_string(),
                    from_node_id: "tester".to_string(),
                    to_node_id: "reviewer".to_string(),
                    condition: WorkflowEdgeCondition::Always,
                },
                CompiledMissionEdge {
                    id: "security-reviewer".to_string(),
                    from_node_id: "security".to_string(),
                    to_node_id: "reviewer".to_string(),
                    condition: WorkflowEdgeCondition::Always,
                },
                CompiledMissionEdge {
                    id: "reviewer-builder-fail".to_string(),
                    from_node_id: "reviewer".to_string(),
                    to_node_id: "builder".to_string(),
                    condition: WorkflowEdgeCondition::OnFailure,
                },
                CompiledMissionEdge {
                    id: "reviewer-tester-fail".to_string(),
                    from_node_id: "reviewer".to_string(),
                    to_node_id: "tester".to_string(),
                    condition: WorkflowEdgeCondition::OnFailure,
                },
                CompiledMissionEdge {
                    id: "reviewer-security-fail".to_string(),
                    from_node_id: "reviewer".to_string(),
                    to_node_id: "security".to_string(),
                    condition: WorkflowEdgeCondition::OnFailure,
                },
            ],
        }
    }

    fn conditional_mission() -> CompiledMission {
        CompiledMission {
            mission_id: "mission-2".to_string(),
            graph_id: "graph-2".to_string(),
            task: CompiledMissionTaskContext {
                node_id: "task-1".to_string(),
                prompt: "Route by outcome".to_string(),
                mode: WorkflowMode::Build,
                workspace_dir: None,
            },
            metadata: CompiledMissionMetadata {
                compiled_at: 1,
                source_graph_id: "graph-2".to_string(),
                start_node_ids: vec!["source".to_string()],
                execution_layers: vec![
                    vec!["source".to_string()],
                    vec!["success-node".to_string(), "failure-node".to_string()],
                ],
            },
            nodes: vec![
                CompiledMissionNode {
                    id: "source".to_string(),
                    role_id: "builder".to_string(),
                    instruction_override: String::new(),
                    terminal: test_terminal("source"),
                },
                CompiledMissionNode {
                    id: "success-node".to_string(),
                    role_id: "reviewer".to_string(),
                    instruction_override: String::new(),
                    terminal: test_terminal("success"),
                },
                CompiledMissionNode {
                    id: "failure-node".to_string(),
                    role_id: "reviewer".to_string(),
                    instruction_override: String::new(),
                    terminal: test_terminal("failure"),
                },
            ],
            edges: vec![
                CompiledMissionEdge {
                    id: "source-success".to_string(),
                    from_node_id: "source".to_string(),
                    to_node_id: "success-node".to_string(),
                    condition: WorkflowEdgeCondition::OnSuccess,
                },
                CompiledMissionEdge {
                    id: "source-failure".to_string(),
                    from_node_id: "source".to_string(),
                    to_node_id: "failure-node".to_string(),
                    condition: WorkflowEdgeCondition::OnFailure,
                },
            ],
        }
    }

    fn active_mission_from(mission: CompiledMission) -> ActiveMission {
        let mut node_statuses = HashMap::new();
        let mut node_attempts = HashMap::new();
        for node in &mission.nodes {
            node_statuses.insert(node.id.clone(), "idle".to_string());
            node_attempts.insert(node.id.clone(), 0);
        }

        ActiveMission {
            layer_index: build_layer_index(&mission),
            mission,
            node_statuses,
            node_attempts,
            node_waves: HashMap::new(),
            node_last_outcomes: HashMap::new(),
            pending_activations: HashMap::new(),
        }
    }

    #[test]
    fn edge_matching_respects_condition() {
        assert!(edge_matches_outcome(
            &WorkflowEdgeCondition::Always,
            &NodeOutcome::Success
        ));
        assert!(edge_matches_outcome(
            &WorkflowEdgeCondition::Always,
            &NodeOutcome::Failure
        ));
        assert!(edge_matches_outcome(
            &WorkflowEdgeCondition::OnSuccess,
            &NodeOutcome::Success
        ));
        assert!(!edge_matches_outcome(
            &WorkflowEdgeCondition::OnSuccess,
            &NodeOutcome::Failure
        ));
        assert!(edge_matches_outcome(
            &WorkflowEdgeCondition::OnFailure,
            &NodeOutcome::Failure
        ));
        assert!(!edge_matches_outcome(
            &WorkflowEdgeCondition::OnFailure,
            &NodeOutcome::Success
        ));
    }

    #[test]
    fn status_follows_outcome() {
        assert_eq!(outcome_to_status(&NodeOutcome::Success), "completed");
        assert_eq!(outcome_to_status(&NodeOutcome::Failure), "failed");
    }

    #[test]
    fn success_and_failure_branches_resolve_differently() {
        let mut mission = active_mission_from(conditional_mission());
        let wave = root_wave_id(&mission.mission.mission_id);

        mission
            .node_statuses
            .insert("source".to_string(), "completed".to_string());
        mission.node_attempts.insert("source".to_string(), 1);
        mission.node_waves.insert("source".to_string(), wave.clone());
        mission
            .node_last_outcomes
            .insert("source".to_string(), NodeOutcome::Success);

        let success_parents = relevant_parent_ids_for_wave(&mission, "success-node", &wave);
        let failure_parents = relevant_parent_ids_for_wave(&mission, "failure-node", &wave);

        assert_eq!(success_parents, HashSet::from(["source".to_string()]));
        assert!(failure_parents.is_empty());
    }

    #[test]
    fn reviewer_failure_retry_wave_only_waits_for_retriggered_specialist() {
        let mut mission = active_mission_from(retry_mission());
        let root_wave = root_wave_id(&mission.mission.mission_id);

        for node_id in ["builder", "tester", "security"] {
            mission
                .node_statuses
                .insert(node_id.to_string(), "completed".to_string());
            mission.node_attempts.insert(node_id.to_string(), 1);
            mission
                .node_waves
                .insert(node_id.to_string(), root_wave.clone());
            mission
                .node_last_outcomes
                .insert(node_id.to_string(), NodeOutcome::Success);
        }

        mission
            .node_statuses
            .insert("reviewer".to_string(), "failed".to_string());
        mission.node_attempts.insert("reviewer".to_string(), 1);
        mission
            .node_waves
            .insert("reviewer".to_string(), root_wave.clone());
        mission
            .node_last_outcomes
            .insert("reviewer".to_string(), NodeOutcome::Failure);

        let retry_wave = next_wave_id(&mission, "reviewer", "builder");
        assert!(retry_wave.starts_with("retry:reviewer:1"));

        mission
            .node_statuses
            .insert("builder".to_string(), "completed".to_string());
        mission.node_attempts.insert("builder".to_string(), 2);
        mission
            .node_waves
            .insert("builder".to_string(), retry_wave.clone());
        mission
            .node_last_outcomes
            .insert("builder".to_string(), NodeOutcome::Success);

        let reviewer_parents = relevant_parent_ids_for_wave(&mission, "reviewer", &retry_wave);
        assert_eq!(reviewer_parents, HashSet::from(["builder".to_string()]));
    }

    #[test]
    fn fan_in_node_waits_for_every_activated_parent_in_the_wave() {
        let mut mission = active_mission_from(retry_mission());
        let root_wave = root_wave_id(&mission.mission.mission_id);

        for node_id in ["builder", "tester", "security"] {
            mission
                .node_statuses
                .insert(node_id.to_string(), "completed".to_string());
            mission.node_attempts.insert(node_id.to_string(), 1);
            mission
                .node_waves
                .insert(node_id.to_string(), root_wave.clone());
            mission
                .node_last_outcomes
                .insert(node_id.to_string(), NodeOutcome::Success);
        }

        let pending_key = ("reviewer".to_string(), root_wave.clone());
        let pending = mission
            .pending_activations
            .entry(pending_key.clone())
            .or_default();
        pending.activated_from.insert("builder".to_string());
        pending.activated_from.insert("tester".to_string());

        assert!(!is_node_ready_for_wave(&mission, "reviewer", &root_wave));

        mission
            .pending_activations
            .get_mut(&pending_key)
            .expect("pending reviewer activation should exist")
            .activated_from
            .insert("security".to_string());

        assert!(is_node_ready_for_wave(&mission, "reviewer", &root_wave));
    }
}
