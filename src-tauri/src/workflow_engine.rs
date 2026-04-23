use crate::db::DbState;
use crate::workflow::{CompiledMission, WorkflowEdgeCondition};
use rusqlite::params;
use serde::{Deserialize, Serialize};
use std::collections::{HashMap, HashSet};
use std::sync::{Arc, Mutex};
use std::thread;
use std::time::{Duration, SystemTime, UNIX_EPOCH};
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
    pub from_attempt: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct TriggeredInput {
    task_id: Option<i64>,
    from_node_id: String,
    outcome: NodeOutcome,
    payload: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct MissionGraphPatch {
    #[serde(default)]
    pub nodes: Vec<crate::workflow::CompiledMissionNode>,
    #[serde(default)]
    pub edges: Vec<crate::workflow::CompiledMissionEdge>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct MissionPatchResult {
    pub mission_id: String,
    pub previous_run_version: u32,
    pub run_version: u32,
    pub appended_node_ids: Vec<String>,
    pub appended_edge_ids: Vec<String>,
}

#[derive(Debug, Clone, Default)]
struct PendingActivation {
    activated_from: HashSet<String>,
    inputs: Vec<TriggeredInput>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeExpectedActionContract {
    pub signal: String,
    pub required_follow_up: Vec<String>,
    pub handoff_contract: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssignmentLegalTarget {
    pub target_node_id: String,
    pub target_role_id: String,
    pub condition: String,
    pub allowed_outcomes: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssignmentWorkspaceContext {
    pub workspace_dir: Option<String>,
    pub mission_id: String,
    pub node_id: String,
    pub run_id: String,
    pub attempt: u32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssignmentExpectedDeliverable {
    pub schema: String,
    pub required_fields: Vec<String>,
    pub status_options: Vec<String>,
    pub notes: String,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssignmentHandoffMetadata {
    pub from_node_ids: Vec<String>,
    pub legal_targets: Vec<RuntimeAssignmentLegalTarget>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeAssignmentPayload {
    pub role_instructions: String,
    pub mission_goal: String,
    pub upstream_outputs: serde_json::Value,
    pub workspace_context: RuntimeAssignmentWorkspaceContext,
    pub expected_deliverable: RuntimeAssignmentExpectedDeliverable,
    pub handoff: RuntimeAssignmentHandoffMetadata,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActivationPayload {
    pub activation_id: String,
    pub mission_id: String,
    pub run_id: String,
    pub node_id: String,
    pub role: String,
    pub profile_id: Option<String>,
    pub capabilities: Option<Vec<crate::workflow::WorkerCapability>>,
    pub cli_type: String,
    pub terminal_id: String,
    pub pane_id: Option<String>,
    pub session_id: String,
    pub agent_id: String,
    pub attempt: u32,
    pub goal: String,
    pub workspace_dir: Option<String>,
    pub input_payload: Option<String>,
    pub assignment: RuntimeAssignmentPayload,
    pub expected_next_action: RuntimeExpectedActionContract,
    pub emitted_at: u64,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
struct PendingRuntimeActivation {
    status: String,
    reason: Option<String>,
    deadline_at: u64,
    payload: RuntimeActivationPayload,
}

#[derive(Debug, Clone)]
struct ActiveMission {
    mission: CompiledMission,
    node_statuses: HashMap<String, String>,
    node_attempts: HashMap<String, u32>,
    node_waves: HashMap<String, String>,
    node_last_outcomes: HashMap<String, NodeOutcome>,
    node_input_payloads: HashMap<String, String>,
    pending_activations: HashMap<(String, String), PendingActivation>,
    pending_runtime_activations: HashMap<(String, u32), PendingRuntimeActivation>,
    node_failure_reasons: HashMap<String, String>,
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
    reason: Option<String>,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeActivationRequestedEvent {
    mission_id: String,
    node_id: String,
    attempt: u32,
    status: String,
    payload: RuntimeActivationPayload,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct RuntimeWarningEvent {
    mission_id: String,
    node_id: String,
    message: String,
}

#[derive(Serialize, Clone)]
#[serde(rename_all = "camelCase")]
struct MissionPatchedEvent {
    mission_id: String,
    previous_run_version: u32,
    run_version: u32,
    appended_node_ids: Vec<String>,
    appended_edge_ids: Vec<String>,
}

#[derive(Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeActivationRecord {
    pub session_id: String,
    pub agent_id: String,
    pub mission_id: String,
    pub node_id: String,
    pub attempt: u32,
    pub terminal_id: String,
    pub status: String,
    pub activation_id: Option<String>,
    pub run_id: Option<String>,
    pub status_reason: Option<String>,
    pub activation_payload: Option<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
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

fn derive_execution_layers(mission: &CompiledMission) -> Result<Vec<Vec<String>>, String> {
    if mission.nodes.is_empty() {
        return Ok(Vec::new());
    }

    let mut indegree: HashMap<String, usize> = mission
        .nodes
        .iter()
        .map(|node| (node.id.clone(), 0usize))
        .collect();
    let mut adjacency: HashMap<String, Vec<String>> = mission
        .nodes
        .iter()
        .map(|node| (node.id.clone(), Vec::new()))
        .collect();
    let node_ids: HashSet<String> = mission.nodes.iter().map(|node| node.id.clone()).collect();

    for edge in &mission.edges {
        if matches!(edge.condition, WorkflowEdgeCondition::OnFailure) {
            continue;
        }
        if !node_ids.contains(&edge.from_node_id) || !node_ids.contains(&edge.to_node_id) {
            return Err(format!(
                "Patch contains edge with unknown node reference: {} -> {}",
                edge.from_node_id, edge.to_node_id
            ));
        }
        adjacency
            .entry(edge.from_node_id.clone())
            .or_default()
            .push(edge.to_node_id.clone());
        *indegree.entry(edge.to_node_id.clone()).or_insert(0) += 1;
    }

    let order: HashMap<String, usize> = mission
        .nodes
        .iter()
        .enumerate()
        .map(|(index, node)| (node.id.clone(), index))
        .collect();
    let mut frontier: Vec<String> = mission
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .filter(|id| indegree.get(id).copied().unwrap_or(0) == 0)
        .collect();
    frontier.sort_by_key(|id| order.get(id).copied().unwrap_or(usize::MAX));

    let mut visited = 0usize;
    let mut layers = Vec::new();

    while !frontier.is_empty() {
        visited += frontier.len();
        layers.push(frontier.clone());

        let mut next: HashSet<String> = HashSet::new();
        for source in &frontier {
            if let Some(targets) = adjacency.get(source) {
                for target in targets {
                    if let Some(value) = indegree.get_mut(target) {
                        *value = value.saturating_sub(1);
                        if *value == 0 {
                            next.insert(target.clone());
                        }
                    }
                }
            }
        }

        frontier = next.into_iter().collect();
        frontier.sort_by_key(|id| order.get(id).copied().unwrap_or(usize::MAX));
    }

    if visited != mission.nodes.len() {
        return Err("Adaptive patch introduces a cycle.".to_string());
    }

    Ok(layers)
}

fn derive_start_node_ids(mission: &CompiledMission) -> Vec<String> {
    let incoming: HashSet<String> = mission
        .edges
        .iter()
        .filter(|edge| !matches!(edge.condition, WorkflowEdgeCondition::OnFailure))
        .map(|edge| edge.to_node_id.clone())
        .collect();
    mission
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .filter(|node_id| !incoming.contains(node_id))
        .collect()
}

const ACTIVATION_TIMEOUT_MS: u64 = 20_000;

fn outcome_to_status(outcome: &NodeOutcome) -> &'static str {
    match outcome {
        NodeOutcome::Success => "done",
        NodeOutcome::Failure => "failed",
    }
}

fn mission_run_id(mission: &CompiledMission) -> String {
    let version = mission.metadata.run_version.unwrap_or(1);
    format!("run:{}:v{}", mission.mission_id, version)
}

fn cli_type_label(cli: &crate::workflow::WorkflowAgentCli) -> &'static str {
    match cli {
        crate::workflow::WorkflowAgentCli::Claude => "claude",
        crate::workflow::WorkflowAgentCli::Gemini => "gemini",
        crate::workflow::WorkflowAgentCli::OpenCode => "opencode",
        crate::workflow::WorkflowAgentCli::Codex => "codex",
    }
}

fn edge_matches_outcome(condition: &WorkflowEdgeCondition, outcome: &NodeOutcome) -> bool {
    match condition {
        WorkflowEdgeCondition::Always => true,
        WorkflowEdgeCondition::OnSuccess => matches!(outcome, NodeOutcome::Success),
        WorkflowEdgeCondition::OnFailure => matches!(outcome, NodeOutcome::Failure),
    }
}

fn edge_condition_label(condition: &WorkflowEdgeCondition) -> &'static str {
    match condition {
        WorkflowEdgeCondition::Always => "always",
        WorkflowEdgeCondition::OnSuccess => "on_success",
        WorkflowEdgeCondition::OnFailure => "on_failure",
    }
}

fn allowed_outcomes_for_condition(condition: &WorkflowEdgeCondition) -> Vec<String> {
    match condition {
        WorkflowEdgeCondition::OnSuccess => vec!["success".to_string()],
        WorkflowEdgeCondition::OnFailure => vec!["failure".to_string()],
        WorkflowEdgeCondition::Always => vec!["success".to_string(), "failure".to_string()],
    }
}

fn parse_upstream_outputs(input_payload: Option<&str>) -> serde_json::Value {
    let Some(raw) = input_payload else {
        return serde_json::Value::Null;
    };
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return serde_json::Value::Null;
    }
    serde_json::from_str::<serde_json::Value>(trimmed)
        .unwrap_or_else(|_| serde_json::Value::String(trimmed.to_string()))
}

fn collect_upstream_from_node_ids(upstream_outputs: &serde_json::Value) -> Vec<String> {
    let mut ids = Vec::new();
    let Some(items) = upstream_outputs.as_array() else {
        return ids;
    };

    for item in items {
        let Some(from_node_id) = item
            .as_object()
            .and_then(|entry| entry.get("fromNodeId"))
            .and_then(|value| value.as_str())
        else {
            continue;
        };

        let normalized = from_node_id.trim();
        if normalized.is_empty() {
            continue;
        }
        if !ids.iter().any(|existing| existing == normalized) {
            ids.push(normalized.to_string());
        }
    }

    ids
}

fn legal_targets_for_node(
    mission: &CompiledMission,
    from_node_id: &str,
) -> Vec<RuntimeAssignmentLegalTarget> {
    let mut targets: Vec<RuntimeAssignmentLegalTarget> = mission
        .edges
        .iter()
        .filter(|edge| edge.from_node_id == from_node_id)
        .map(|edge| RuntimeAssignmentLegalTarget {
            target_node_id: edge.to_node_id.clone(),
            target_role_id: mission_node(mission, &edge.to_node_id)
                .map(|node| node.role_id.clone())
                .unwrap_or_else(|| "unknown".to_string()),
            condition: edge_condition_label(&edge.condition).to_string(),
            allowed_outcomes: allowed_outcomes_for_condition(&edge.condition),
        })
        .collect();

    targets.sort_by(|left, right| {
        left.target_node_id
            .cmp(&right.target_node_id)
            .then_with(|| left.condition.cmp(&right.condition))
    });
    targets
}

fn has_legal_handoff_edge(
    mission: &CompiledMission,
    from_node_id: &str,
    target_node_id: &str,
    outcome: &NodeOutcome,
) -> bool {
    mission.edges.iter().any(|edge| {
        edge.from_node_id == from_node_id
            && edge.to_node_id == target_node_id
            && edge_matches_outcome(&edge.condition, outcome)
    })
}

fn build_runtime_assignment_payload(
    active_mission: &ActiveMission,
    node: &crate::workflow::CompiledMissionNode,
    node_id: &str,
    attempt: u32,
    run_id: &str,
    input_payload: Option<&String>,
) -> RuntimeAssignmentPayload {
    let upstream_outputs = parse_upstream_outputs(input_payload.map(String::as_str));
    let from_node_ids = collect_upstream_from_node_ids(&upstream_outputs);

    RuntimeAssignmentPayload {
        role_instructions: node.instruction_override.trim().to_string(),
        mission_goal: active_mission.mission.task.prompt.clone(),
        upstream_outputs,
        workspace_context: RuntimeAssignmentWorkspaceContext {
            workspace_dir: active_mission.mission.task.workspace_dir.clone(),
            mission_id: active_mission.mission.mission_id.clone(),
            node_id: node_id.to_string(),
            run_id: run_id.to_string(),
            attempt,
        },
        expected_deliverable: RuntimeAssignmentExpectedDeliverable {
            schema: "completion_payload_v1".to_string(),
            required_fields: vec![
                "status".to_string(),
                "summary".to_string(),
                "artifactReferences".to_string(),
                "filesChanged".to_string(),
                "downstreamPayload".to_string(),
            ],
            status_options: vec!["success".to_string(), "failure".to_string()],
            notes: "Produce a structured completion payload and route only through legal graph targets."
                .to_string(),
        },
        handoff: RuntimeAssignmentHandoffMetadata {
            from_node_ids,
            legal_targets: legal_targets_for_node(&active_mission.mission, node_id),
        },
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
    reason: Option<String>,
) {
    let _ = app.emit(
        "workflow-node-update",
        NodeStatusEvent {
            id: node_id.to_string(),
            status: status.to_string(),
            attempt,
            outcome,
            reason,
        },
    );
}

fn emit_runtime_warning(app: &AppHandle, mission_id: &str, node_id: &str, message: impl Into<String>) {
    let _ = app.emit(
        "workflow-runtime-warning",
        RuntimeWarningEvent {
            mission_id: mission_id.to_string(),
            node_id: node_id.to_string(),
            message: message.into(),
        },
    );
}

fn unix_millis_now() -> u64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_millis() as u64)
        .unwrap_or(0)
}

fn runtime_session_id(mission_id: &str, node_id: &str, attempt: u32) -> String {
    format!("session:{mission_id}:{node_id}:{attempt}")
}

fn runtime_agent_id(mission_id: &str, node_id: &str, terminal_id: &str) -> String {
    format!("agent:{mission_id}:{node_id}:{terminal_id}")
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

fn persist_runtime_session(
    app: &AppHandle,
    session_id: &str,
    agent_id: &str,
    mission_id: &str,
    node_id: &str,
    attempt: u32,
    terminal_id: &str,
    status: &str,
) {
    let state = app.state::<DbState>();
    let db_lock = match state.db.lock() {
        Ok(lock) => lock,
        Err(_) => return,
    };
    let Some(conn) = db_lock.as_ref() else {
        return;
    };

    let _ = conn.execute(
        "INSERT INTO agent_runtime_sessions
           (session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, created_at, updated_at)
         VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(session_id) DO UPDATE SET
           agent_id = excluded.agent_id,
           mission_id = excluded.mission_id,
           node_id = excluded.node_id,
           attempt = excluded.attempt,
           terminal_id = excluded.terminal_id,
           status = excluded.status,
           updated_at = CURRENT_TIMESTAMP",
        params![
            session_id,
            agent_id,
            mission_id,
            node_id,
            attempt,
            terminal_id,
            status
        ],
    );
}

fn mark_runtime_session_status(
    app: &AppHandle,
    mission_id: &str,
    node_id: &str,
    attempt: u32,
    status: &str,
) {
    let state = app.state::<DbState>();
    let db_lock = match state.db.lock() {
        Ok(lock) => lock,
        Err(_) => return,
    };
    let Some(conn) = db_lock.as_ref() else {
        return;
    };

    let _ = conn.execute(
        "UPDATE agent_runtime_sessions
         SET status = ?1, updated_at = CURRENT_TIMESTAMP
         WHERE mission_id = ?2 AND node_id = ?3 AND attempt = ?4",
        params![status, mission_id, node_id, attempt],
    );
}

fn clear_runtime_sessions_for_mission(app: &AppHandle, mission_id: &str) {
    let state = app.state::<DbState>();
    let db_lock = match state.db.lock() {
        Ok(lock) => lock,
        Err(_) => return,
    };
    let Some(conn) = db_lock.as_ref() else {
        return;
    };

    let _ = conn.execute(
        "DELETE FROM agent_runtime_sessions WHERE mission_id = ?1",
        params![mission_id],
    );
}

fn persist_mission_timeline_event(
    app: &AppHandle,
    mission_id: &str,
    event_type: &str,
    payload: Option<&str>,
    run_version: Option<u32>,
) {
    let state = app.state::<DbState>();
    let db_lock = match state.db.lock() {
        Ok(lock) => lock,
        Err(_) => return,
    };
    let Some(conn) = db_lock.as_ref() else {
        return;
    };

    let _ = conn.execute(
        "INSERT INTO mission_timeline (mission_id, event_type, payload, run_version, created_at)
         VALUES (?1, ?2, ?3, ?4, CURRENT_TIMESTAMP)",
        params![mission_id, event_type, payload, run_version.map(|v| v as i64)],
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

            if status == "done" || status == "failed" {
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

fn schedule_activation_timeout(app: &AppHandle, mission_id: String, node_id: String, attempt: u32) {
    let app_handle = app.clone();
    thread::spawn(move || {
        thread::sleep(Duration::from_millis(ACTIVATION_TIMEOUT_MS));
        let _ = timeout_runtime_activation(&app_handle, mission_id, node_id, attempt);
    });
}

fn timeout_runtime_activation(app: &AppHandle, mission_id: String, node_id: String, attempt: u32) -> bool {
    let (role_id, current_wave_id, input_payload, reason, run_version) = {
        let state = app.state::<WorkflowState>();
        let mut missions = state.active_missions.lock().unwrap();
        let Some(active_mission) = missions.get_mut(&mission_id) else {
            return false;
        };
        let key = (node_id.clone(), attempt);
        let Some(pending) = active_mission.pending_runtime_activations.remove(&key) else {
            return false;
        };

        let current_status = active_mission
            .node_statuses
            .get(&node_id)
            .cloned()
            .unwrap_or_else(|| "idle".to_string());
        if current_status == "running" || current_status == "done" || current_status == "failed" {
            return false;
        }

        let reason = pending
            .reason
            .unwrap_or_else(|| "Runtime never acknowledged activation before timeout.".to_string());
        active_mission
            .node_statuses
            .insert(node_id.clone(), "failed".to_string());
        active_mission
            .node_failure_reasons
            .insert(node_id.clone(), reason.clone());
        (
            mission_node(&active_mission.mission, &node_id).map(|node| node.role_id.clone()),
            active_mission.node_waves.get(&node_id).cloned(),
            pending.payload.input_payload.clone(),
            reason,
            active_mission.mission.metadata.run_version,
        )
    };

    if let Some(role_id) = role_id {
        persist_node_runtime(
            app,
            &mission_id,
            &node_id,
            &role_id,
            "failed",
            attempt,
            current_wave_id.as_deref(),
            None,
            input_payload.as_deref(),
        );
    }
    mark_runtime_session_status(app, &mission_id, &node_id, attempt, "failed");
    emit_node_status(
        app,
        &node_id,
        "failed",
        Some(attempt),
        None,
        Some(reason.clone()),
    );
    emit_runtime_warning(app, &mission_id, &node_id, reason.clone());

    let timeline_payload = serde_json::json!({
        "nodeId": node_id,
        "attempt": attempt,
        "reason": reason,
    })
    .to_string();
    persist_mission_timeline_event(
        app,
        &mission_id,
        "activation_timeout",
        Some(&timeline_payload),
        run_version,
    );

    true
}

fn request_node_activation_locked(
    app: &AppHandle,
    mission_id: &str,
    active_mission: &mut ActiveMission,
    node_id: &str,
    wave_id: String,
    input_payload: Option<String>,
) {
    let current_status = active_mission
        .node_statuses
        .get(node_id)
        .cloned()
        .unwrap_or_else(|| "idle".to_string());
    if current_status == "launching"
        || current_status == "connecting"
        || current_status == "ready"
        || current_status == "running"
    {
        return;
    }

    let Some(node) = mission_node(&active_mission.mission, node_id) else {
        return;
    };
    let role_id = node.role_id.clone();
    let terminal_id = node.terminal.terminal_id.clone();
    let terminal_cli = cli_type_label(&node.terminal.cli).to_string();

    if terminal_id.trim().is_empty() {
        let reason = "No terminal bound to this node runtime.".to_string();
        active_mission
            .node_statuses
            .insert(node_id.to_string(), "unbound".to_string());
        active_mission
            .node_failure_reasons
            .insert(node_id.to_string(), reason.clone());
        let attempt = active_mission.node_attempts.get(node_id).copied().unwrap_or(0);
        persist_node_runtime(
            app,
            mission_id,
            node_id,
            &role_id,
            "unbound",
            attempt,
            Some(&wave_id),
            None,
            input_payload.as_deref(),
        );
        emit_node_status(
            app,
            node_id,
            "unbound",
            Some(attempt),
            None,
            Some(reason.clone()),
        );
        emit_runtime_warning(app, mission_id, node_id, reason);
        return;
    }

    let attempt = {
        let counter = active_mission
            .node_attempts
            .entry(node_id.to_string())
            .or_insert(0);
        *counter += 1;
        *counter
    };
    let session_id = runtime_session_id(mission_id, node_id, attempt);
    let agent_id = runtime_agent_id(mission_id, node_id, &terminal_id);
    let activated_at = unix_millis_now();
    let activation_id = format!("activation:{mission_id}:{node_id}:{attempt}");
    let run_id = mission_run_id(&active_mission.mission);
    let assignment = build_runtime_assignment_payload(
        active_mission,
        node,
        node_id,
        attempt,
        &run_id,
        input_payload.as_ref(),
    );

    let payload = RuntimeActivationPayload {
        activation_id: activation_id.clone(),
        mission_id: mission_id.to_string(),
        run_id,
        node_id: node_id.to_string(),
        role: role_id.clone(),
        profile_id: node.profile_id.clone(),
        capabilities: node.capabilities.clone(),
        cli_type: terminal_cli,
        terminal_id: terminal_id.clone(),
        pane_id: node.terminal.pane_id.clone(),
        session_id: session_id.clone(),
        agent_id: agent_id.clone(),
        attempt,
        goal: active_mission.mission.task.prompt.clone(),
        workspace_dir: active_mission.mission.task.workspace_dir.clone(),
        input_payload: input_payload.clone(),
        assignment,
        expected_next_action: RuntimeExpectedActionContract {
            signal: "NEW_TASK".to_string(),
            required_follow_up: vec![
                "Parse the NEW_TASK JSON envelope and preserve mission/node/attempt identifiers."
                    .to_string(),
                "Call get_task_details({ missionId, nodeId }) before execution.".to_string(),
                "Call receive_messages({ missionId, nodeId }) to process mission inbox."
                    .to_string(),
            ],
            handoff_contract:
                "Route with handoff_task using exact targetNodeId and explicit outcome. Include fromAttempt."
                    .to_string(),
        },
        emitted_at: activated_at,
    };

    if let Some(payload) = input_payload.as_ref() {
        active_mission.node_input_payloads.insert(node_id.to_string(), payload.clone());
    }

    active_mission
        .pending_runtime_activations
        .insert(
            (node_id.to_string(), attempt),
            PendingRuntimeActivation {
                status: "launching".to_string(),
                reason: None,
                deadline_at: activated_at.saturating_add(ACTIVATION_TIMEOUT_MS),
                payload: payload.clone(),
            },
        );
    active_mission
        .node_statuses
        .insert(node_id.to_string(), "launching".to_string());
    active_mission
        .node_waves
        .insert(node_id.to_string(), wave_id.clone());
    active_mission.node_failure_reasons.remove(node_id);

    println!(
        "[Mission {}] Requested activation for {} (attempt {}, session {})",
        mission_id, node_id, attempt, session_id
    );

    persist_node_runtime(
        app,
        mission_id,
        node_id,
        &role_id,
        "launching",
        attempt,
        Some(&wave_id),
        None,
        input_payload.as_deref(),
    );
    persist_runtime_session(
        app,
        &session_id,
        &agent_id,
        mission_id,
        node_id,
        attempt,
        &terminal_id,
        "launching",
    );
    emit_node_status(app, node_id, "launching", Some(attempt), None, None);

    let _ = app.emit(
        "workflow-runtime-activation-requested",
        RuntimeActivationRequestedEvent {
            mission_id: mission_id.to_string(),
            node_id: node_id.to_string(),
            attempt,
            status: "launching".to_string(),
            payload: payload.clone(),
        },
    );

    let timeline_payload = serde_json::to_string(&payload).ok();
    persist_mission_timeline_event(
        app,
        mission_id,
        "activation_requested",
        timeline_payload.as_deref(),
        active_mission.mission.metadata.run_version,
    );

    schedule_activation_timeout(app, mission_id.to_string(), node_id.to_string(), attempt);
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

fn apply_append_patch(active_mission: &mut ActiveMission, run_version: u32, patch: &MissionGraphPatch) -> Result<MissionPatchResult, String> {
    let current_version = active_mission.mission.metadata.run_version.unwrap_or(1);
    if run_version != current_version {
        return Err(format!(
            "Stale adaptive patch runVersion {} (current {}).",
            run_version, current_version
        ));
    }

    if patch.nodes.is_empty() && patch.edges.is_empty() {
        return Err("Adaptive patch is empty.".to_string());
    }

    let mut existing_ids: HashSet<String> = active_mission
        .mission
        .nodes
        .iter()
        .map(|node| node.id.clone())
        .collect();
    for node in &patch.nodes {
        if node.id.trim().is_empty() {
            return Err("Adaptive patch node id cannot be empty.".to_string());
        }
        if !existing_ids.insert(node.id.clone()) {
            return Err(format!("Adaptive patch node id collision: {}", node.id));
        }
    }

    for edge in &patch.edges {
        if !existing_ids.contains(&edge.from_node_id) || !existing_ids.contains(&edge.to_node_id) {
            return Err(format!(
                "Adaptive patch edge references unknown node: {} -> {}",
                edge.from_node_id, edge.to_node_id
            ));
        }
    }

    let appended_node_ids: Vec<String> = patch.nodes.iter().map(|node| node.id.clone()).collect();
    let appended_edge_ids: Vec<String> = patch.edges.iter().map(|edge| edge.id.clone()).collect();

    active_mission
        .mission
        .nodes
        .extend(patch.nodes.iter().cloned());
    active_mission
        .mission
        .edges
        .extend(patch.edges.iter().cloned());

    let layers = derive_execution_layers(&active_mission.mission)?;
    active_mission.mission.metadata.execution_layers = layers;
    active_mission.mission.metadata.start_node_ids = derive_start_node_ids(&active_mission.mission);
    active_mission.mission.metadata.run_version = Some(current_version + 1);
    active_mission.layer_index = build_layer_index(&active_mission.mission);

    for node in &patch.nodes {
        active_mission
            .node_statuses
            .entry(node.id.clone())
            .or_insert_with(|| "idle".to_string());
        active_mission.node_attempts.entry(node.id.clone()).or_insert(0);
    }

    Ok(MissionPatchResult {
        mission_id: active_mission.mission.mission_id.clone(),
        previous_run_version: current_version,
        run_version: current_version + 1,
        appended_node_ids,
        appended_edge_ids,
    })
}

pub fn start_mission(app: &AppHandle, mut mission: CompiledMission) {
    if mission.metadata.run_version.is_none() {
        mission.metadata.run_version = Some(1);
    }
    let mission_id = mission.mission_id.clone();
    let start_node_ids = get_start_node_ids(&mission);
    let layer_index = build_layer_index(&mission);

    persist_compiled_mission(app, &mission, "active");
    clear_runtime_sessions_for_mission(app, &mission_id);

    let mut node_statuses = HashMap::new();
    let mut node_attempts = HashMap::new();
    let mut node_input_payloads = HashMap::new();
    let mut node_failure_reasons = HashMap::new();
    for node in &mission.nodes {
        let mut initial_status = "idle".to_string();
        if node.terminal.terminal_id.trim().is_empty() {
            initial_status = "unbound".to_string();
            node_failure_reasons.insert(
                node.id.clone(),
                "No terminal is bound for this node.".to_string(),
            );
        }
        node_statuses.insert(node.id.clone(), initial_status.clone());
        node_attempts.insert(node.id.clone(), 0);
        persist_node_runtime(
            app,
            &mission_id,
            &node.id,
            &node.role_id,
            &initial_status,
            0,
            None,
            None,
            None,
        );
        emit_node_status(
            app,
            &node.id,
            &initial_status,
            Some(0),
            None,
            node_failure_reasons.get(&node.id).cloned(),
        );
    }

    println!(
        "[Mission {}] Starting mission with {} start node(s)",
        mission_id,
        start_node_ids.len()
    );

    let active_mission = ActiveMission {
        mission,
        node_statuses,
        node_attempts,
        node_input_payloads,
        node_waves: HashMap::new(),
        node_last_outcomes: HashMap::new(),
        pending_activations: HashMap::new(),
        pending_runtime_activations: HashMap::new(),
        node_failure_reasons,
        layer_index,
    };

    let state = app.state::<WorkflowState>();
    let mut missions = state.active_missions.lock().unwrap();
    missions.insert(mission_id.clone(), active_mission);

    let root_wave = root_wave_id(&mission_id);
    if let Some(mission) = missions.get_mut(&mission_id) {
        for node_id in &start_node_ids {
            request_node_activation_locked(
                app,
                &mission_id,
                mission,
                node_id,
                root_wave.clone(),
                None,
            );
        }
    }

    let run_version = missions
        .get(&mission_id)
        .and_then(|mission| mission.mission.metadata.run_version)
        .unwrap_or(1);
    persist_mission_timeline_event(app, &mission_id, "mission_started", None, Some(run_version));
}

pub fn handle_handoff(app: &AppHandle, mission_id: &str, handoff: HandoffEvent) {
    println!(
        "[Mission {}] Received handoff: from={:?}, target={:?}, attempt={:?}, outcome={:?}",
        mission_id, handoff.from_node_id, handoff.target_node_id, handoff.from_attempt, handoff.outcome
    );
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

    let from_attempt = active_mission.node_attempts.get(&from_id).copied().unwrap_or(0);
    let Some(from_attempt_from_event) = handoff.from_attempt else {
        emit_runtime_warning(
            app,
            mission_id,
            &from_id,
            "Rejected handoff: missing fromAttempt in handoff payload.",
        );
        return;
    };
    if from_attempt_from_event != from_attempt {
        emit_runtime_warning(
            app,
            mission_id,
            &from_id,
            format!(
                "Rejected handoff: stale fromAttempt {} (current attempt {}).",
                from_attempt_from_event, from_attempt
            ),
        );
        return;
    }

    let current_from_status = active_mission
        .node_statuses
        .get(&from_id)
        .map(String::as_str)
        .unwrap_or("idle");
    if current_from_status != "running" {
        emit_runtime_warning(
            app,
            mission_id,
            &from_id,
            format!(
                "Rejected handoff: node status is \"{}\"; only running nodes may hand off.",
                current_from_status
            ),
        );
        return;
    }

    let validated_target_id = if let Some(target_id) = handoff.target_node_id.as_ref() {
        if mission_node(&active_mission.mission, target_id).is_none() {
            emit_runtime_warning(
                app,
                mission_id,
                &from_id,
                format!(
                    "Rejected handoff: target node \"{}\" is not part of mission {}.",
                    target_id, mission_id
                ),
            );
            return;
        }
        if !has_legal_handoff_edge(&active_mission.mission, &from_id, target_id, &outcome) {
            emit_runtime_warning(
                app,
                mission_id,
                &from_id,
                format!(
                    "Rejected handoff: illegal graph route {} -> {} for outcome {:?}.",
                    from_id, target_id, outcome
                ),
            );
            return;
        }
        Some(target_id.clone())
    } else {
        let has_legal_target_for_outcome = active_mission.mission.edges.iter().any(|edge| {
            edge.from_node_id == from_id && edge_matches_outcome(&edge.condition, &outcome)
        });
        if has_legal_target_for_outcome {
            emit_runtime_warning(
                app,
                mission_id,
                &from_id,
                "Rejected handoff: missing targetNodeId while legal downstream targets exist.",
            );
            return;
        }
        None
    };

    active_mission
        .node_statuses
        .insert(from_id.clone(), "handoff_pending".to_string());
    emit_node_status(
        app,
        &from_id,
        "handoff_pending",
        Some(from_attempt),
        None,
        None,
    );

    let from_status = outcome_to_status(&outcome).to_string();
    let from_wave = active_mission.node_waves.get(&from_id).cloned();
    active_mission
        .node_statuses
        .insert(from_id.clone(), from_status.clone());
    active_mission
        .node_last_outcomes
        .insert(from_id.clone(), outcome.clone());
    active_mission.node_failure_reasons.remove(&from_id);

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
    mark_runtime_session_status(app, mission_id, &from_id, from_attempt, &from_status);
    emit_node_status(
        app,
        &from_id,
        &from_status,
        Some(from_attempt),
        Some(outcome.clone()),
        None,
    );
    let handoff_timeline_payload = serde_json::json!({
        "fromNodeId": from_id,
        "targetNodeId": handoff.target_node_id,
        "outcome": match outcome {
            NodeOutcome::Success => "success",
            NodeOutcome::Failure => "failure",
        },
        "fromAttempt": from_attempt,
    })
    .to_string();
    persist_mission_timeline_event(
        app,
        mission_id,
        "handoff_received",
        Some(&handoff_timeline_payload),
        active_mission.mission.metadata.run_version,
    );

    let Some(target_id) = validated_target_id else {
        return;
    };

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
        request_node_activation_locked(
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
            .insert(target_id.clone(), "handoff_pending".to_string());
        active_mission
            .node_waves
            .insert(target_id.clone(), wave_id.clone());

        if let Some(role_id) = mission_node(&active_mission.mission, &target_id).map(|node| node.role_id.clone()) {
            persist_node_runtime(
                app,
                mission_id,
                &target_id,
                &role_id,
                "handoff_pending",
                target_attempt,
                Some(&wave_id),
                active_mission.node_last_outcomes.get(&target_id),
                handoff.payload.as_deref(),
            );
        }
        emit_node_status(
            app,
            &target_id,
            "handoff_pending",
            Some(target_attempt),
            None,
            None,
        );
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

#[tauri::command]
pub fn append_mission_patch(
    app: AppHandle,
    mission_id: String,
    run_version: u32,
    patch: MissionGraphPatch,
) -> Result<MissionPatchResult, String> {
    let (result, appended_nodes) = {
        let state = app.state::<WorkflowState>();
        let mut missions = state.active_missions.lock().unwrap();
        let active_mission = missions
            .get_mut(&mission_id)
            .ok_or_else(|| format!("Mission {} is not active.", mission_id))?;

        let result = apply_append_patch(active_mission, run_version, &patch)?;
        (result, patch.nodes.clone())
    };

    for node in &appended_nodes {
        persist_node_runtime(
            &app,
            &mission_id,
            &node.id,
            &node.role_id,
            "idle",
            0,
            None,
            None,
            None,
        );
        emit_node_status(&app, &node.id, "idle", Some(0), None, None);
    }

    {
        let state = app.state::<WorkflowState>();
        let missions = state.active_missions.lock().unwrap();
        if let Some(active_mission) = missions.get(&mission_id) {
            persist_compiled_mission(&app, &active_mission.mission, "active");
        }
    }

    let timeline_payload = serde_json::json!({
        "previousRunVersion": result.previous_run_version,
        "runVersion": result.run_version,
        "appendedNodeIds": result.appended_node_ids,
        "appendedEdgeIds": result.appended_edge_ids,
    })
    .to_string();
    persist_mission_timeline_event(
        &app,
        &mission_id,
        "patch_applied",
        Some(&timeline_payload),
        Some(result.run_version),
    );

    let _ = app.emit(
        "workflow-mission-patched",
        MissionPatchedEvent {
            mission_id: mission_id.clone(),
            previous_run_version: result.previous_run_version,
            run_version: result.run_version,
            appended_node_ids: result.appended_node_ids.clone(),
            appended_edge_ids: result.appended_edge_ids.clone(),
        },
    );

    Ok(result)
}

#[tauri::command]
pub fn retry_mission_node(
    app: AppHandle,
    mission_id: String,
    node_id: String,
) -> Result<(), String> {
    let state = app.state::<WorkflowState>();
    let mut missions = state.active_missions.lock().unwrap();
    let active_mission = missions
        .get_mut(&mission_id)
        .ok_or_else(|| format!("Mission {} is not active.", mission_id))?;

    let current_status = active_mission
        .node_statuses
        .get(&node_id)
        .cloned()
        .unwrap_or_else(|| "idle".to_string());

    if current_status == "launching"
        || current_status == "connecting"
        || current_status == "ready"
        || current_status == "running"
    {
        return Err(format!(
            "Node {} is already in an active state ({}). Stop it first or wait for completion.",
            node_id, current_status
        ));
    }

    let wave_id = active_mission
        .node_waves
        .get(&node_id)
        .cloned()
        .unwrap_or_else(|| root_wave_id(&mission_id));
    let input_payload = active_mission.node_input_payloads.get(&node_id).cloned();

    println!(
        "[Mission {}] Manual retry requested for node {}",
        mission_id, node_id
    );

    request_node_activation_locked(
        &app,
        &mission_id,
        active_mission,
        &node_id,
        wave_id,
        input_payload,
    );

    Ok(())
}

#[tauri::command]
pub fn acknowledge_runtime_activation(
    app: AppHandle,
    mission_id: String,
    node_id: String,
    attempt: u32,
    status: String,
    reason: Option<String>,
) -> Result<(), String> {
    println!(
        "[Mission {}] Acknowledge activation: node={}, attempt={}, status={}, reason={:?}",
        mission_id, node_id, attempt, status, reason
    );
    let (role_id, current_wave_id, last_payload, next_status, next_reason, run_version) = {
        let state = app.state::<WorkflowState>();
        let mut missions = state
            .active_missions
            .lock()
            .map_err(|_| "Failed to lock workflow state".to_string())?;
        let active_mission = missions
            .get_mut(&mission_id)
            .ok_or_else(|| format!("Mission {} is not active.", mission_id))?;
        let role_id = mission_node(&active_mission.mission, &node_id)
            .map(|node| node.role_id.clone())
            .ok_or_else(|| format!("Node {} is not part of mission {}.", node_id, mission_id))?;

        let current_attempt = active_mission.node_attempts.get(&node_id).copied().unwrap_or(0);
        if current_attempt != attempt {
            return Err(format!(
                "Activation attempt mismatch for {}/{}: got {}, current {}.",
                mission_id, node_id, attempt, current_attempt
            ));
        }

        let key = (node_id.clone(), attempt);
        let mut next_reason = reason;
        let mut last_payload = None;

        match status.as_str() {
            "connecting" => {
                let pending = active_mission
                    .pending_runtime_activations
                    .get_mut(&key)
                    .ok_or_else(|| {
                        format!(
                            "No pending activation request found for {}/{} attempt {}.",
                            mission_id, node_id, attempt
                        )
                    })?;
                pending.status = "connecting".to_string();
                if next_reason.is_some() {
                    pending.reason = next_reason.clone();
                }
                last_payload = pending.payload.input_payload.clone();
                active_mission
                    .node_statuses
                    .insert(node_id.clone(), "connecting".to_string());
                active_mission.node_failure_reasons.remove(&node_id);
            }
            "ready" => {
                let pending = active_mission
                    .pending_runtime_activations
                    .get_mut(&key)
                    .ok_or_else(|| {
                        format!(
                            "No pending activation request found for {}/{} attempt {}.",
                            mission_id, node_id, attempt
                        )
                    })?;
                pending.status = "ready".to_string();
                if next_reason.is_some() {
                    pending.reason = next_reason.clone();
                }
                last_payload = pending.payload.input_payload.clone();
                active_mission
                    .node_statuses
                    .insert(node_id.clone(), "ready".to_string());
                active_mission.node_failure_reasons.remove(&node_id);
            }
            "running" => {
                if let Some(pending) = active_mission.pending_runtime_activations.remove(&key) {
                    last_payload = pending.payload.input_payload;
                }
                active_mission
                    .node_statuses
                    .insert(node_id.clone(), "running".to_string());
                active_mission.node_failure_reasons.remove(&node_id);
                next_reason = None;
            }
            "failed" => {
                let pending = active_mission.pending_runtime_activations.remove(&key);
                if let Some(pending) = pending {
                    last_payload = pending.payload.input_payload;
                }
                let resolved_reason =
                    next_reason.unwrap_or_else(|| "Runtime activation failed.".to_string());
                next_reason = Some(resolved_reason.clone());
                active_mission
                    .node_statuses
                    .insert(node_id.clone(), "failed".to_string());
                active_mission
                    .node_failure_reasons
                    .insert(node_id.clone(), resolved_reason);
            }
            other => {
                return Err(format!(
                    "Unsupported activation status \"{}\". Expected connecting|ready|running|failed.",
                    other
                ));
            }
        }

        (
            role_id,
            active_mission.node_waves.get(&node_id).cloned(),
            last_payload,
            status,
            next_reason,
            active_mission.mission.metadata.run_version,
        )
    };

    persist_node_runtime(
        &app,
        &mission_id,
        &node_id,
        &role_id,
        &next_status,
        attempt,
        current_wave_id.as_deref(),
        None,
        last_payload.as_deref(),
    );
    mark_runtime_session_status(&app, &mission_id, &node_id, attempt, &next_status);
    emit_node_status(
        &app,
        &node_id,
        &next_status,
        Some(attempt),
        None,
        next_reason.clone(),
    );

    if next_status == "failed" {
        if let Some(message) = next_reason.clone() {
            emit_runtime_warning(&app, &mission_id, &node_id, message);
        }
    }

    let timeline_payload = serde_json::json!({
        "nodeId": node_id,
        "attempt": attempt,
        "status": next_status,
        "reason": next_reason,
    })
    .to_string();
    persist_mission_timeline_event(
        &app,
        &mission_id,
        "activation_status",
        Some(&timeline_payload),
        run_version,
    );

    Ok(())
}

#[tauri::command]
pub fn register_runtime_activation_dispatch(
    app: AppHandle,
    mission_id: String,
    node_id: String,
    attempt: u32,
    session_id: String,
    agent_id: String,
    terminal_id: String,
    activated_at: u64,
) -> Result<(), String> {
    println!(
        "[Mission {}] Runtime dispatch registered: node={}, attempt={}, session={}, agent={}, terminal={}",
        mission_id, node_id, attempt, session_id, agent_id, terminal_id
    );
    acknowledge_runtime_activation(
        app,
        mission_id,
        node_id,
        attempt,
        "connecting".to_string(),
        None,
    )
}

#[tauri::command]
pub fn get_runtime_activation(
    app: AppHandle,
    mission_id: String,
    node_id: String,
    attempt: u32,
) -> Result<Option<RuntimeActivationRecord>, String> {
    let state = app.state::<DbState>();
    let db_lock = state
        .db
        .lock()
        .map_err(|_| "Failed to lock database".to_string())?;
    let conn = db_lock.as_ref().ok_or("Database not initialized")?;

    let row = conn
        .prepare(
            "SELECT session_id, agent_id, mission_id, node_id, attempt, terminal_id, status,
                    datetime(created_at, 'localtime') AS created_at,
                    datetime(updated_at, 'localtime') AS updated_at
             FROM agent_runtime_sessions
             WHERE mission_id = ?1 AND node_id = ?2 AND attempt = ?3
             ORDER BY updated_at DESC
             LIMIT 1",
        )
        .map_err(|e| e.to_string())?
        .query_row(params![&mission_id, &node_id, attempt], |row| {
            Ok(RuntimeActivationRecord {
                session_id: row.get(0)?,
                agent_id: row.get(1)?,
                mission_id: row.get(2)?,
                node_id: row.get(3)?,
                attempt: row.get(4)?,
                terminal_id: row.get(5)?,
                status: row.get(6)?,
                activation_id: None,
                run_id: None,
                status_reason: None,
                activation_payload: None,
                created_at: row.get(7)?,
                updated_at: row.get(8)?,
            })
        });

    match row {
        Ok(mut value) => {
            let workflow_state = app.state::<WorkflowState>();
            if let Ok(missions) = workflow_state.active_missions.lock() {
                if let Some(active_mission) = missions.get(&mission_id) {
                    let key = (node_id.clone(), attempt);
                    if let Some(pending) = active_mission.pending_runtime_activations.get(&key) {
                        value.status = pending.status.clone();
                        value.activation_id = Some(pending.payload.activation_id.clone());
                        value.run_id = Some(pending.payload.run_id.clone());
                        value.status_reason = pending
                            .reason
                            .clone()
                            .or_else(|| active_mission.node_failure_reasons.get(&node_id).cloned());
                        value.activation_payload = serde_json::to_string(&pending.payload).ok();
                    } else {
                        value.status_reason = active_mission.node_failure_reasons.get(&node_id).cloned();
                    }
                }
            }
            Ok(Some(value))
        }
        Err(rusqlite::Error::QueryReturnedNoRows) => Ok(None),
        Err(error) => Err(error.to_string()),
    }
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
                authoring_mode: Some(crate::workflow::WorkflowAuthoringMode::Preset),
                preset_id: Some("parallel_delivery".to_string()),
                run_version: Some(1),
            },
            nodes: vec![
                CompiledMissionNode {
                    id: "builder".to_string(),
                    role_id: "builder".to_string(),
                    profile_id: None,
                    instruction_override: String::new(),
                    capabilities: None,
                    requirements: None,
                    terminal: test_terminal("builder"),
                },
                CompiledMissionNode {
                    id: "tester".to_string(),
                    role_id: "tester".to_string(),
                    profile_id: None,
                    instruction_override: String::new(),
                    capabilities: None,
                    requirements: None,
                    terminal: test_terminal("tester"),
                },
                CompiledMissionNode {
                    id: "security".to_string(),
                    role_id: "security".to_string(),
                    profile_id: None,
                    instruction_override: String::new(),
                    capabilities: None,
                    requirements: None,
                    terminal: test_terminal("security"),
                },
                CompiledMissionNode {
                    id: "reviewer".to_string(),
                    role_id: "reviewer".to_string(),
                    profile_id: None,
                    instruction_override: String::new(),
                    capabilities: None,
                    requirements: None,
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
                authoring_mode: Some(crate::workflow::WorkflowAuthoringMode::Graph),
                preset_id: None,
                run_version: Some(1),
            },
            nodes: vec![
                CompiledMissionNode {
                    id: "source".to_string(),
                    role_id: "builder".to_string(),
                    profile_id: None,
                    instruction_override: String::new(),
                    capabilities: None,
                    requirements: None,
                    terminal: test_terminal("source"),
                },
                CompiledMissionNode {
                    id: "success-node".to_string(),
                    role_id: "reviewer".to_string(),
                    profile_id: None,
                    instruction_override: String::new(),
                    capabilities: None,
                    requirements: None,
                    terminal: test_terminal("success"),
                },
                CompiledMissionNode {
                    id: "failure-node".to_string(),
                    role_id: "reviewer".to_string(),
                    profile_id: None,
                    instruction_override: String::new(),
                    capabilities: None,
                    requirements: None,
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
            pending_runtime_activations: HashMap::new(),
            node_failure_reasons: HashMap::new(),
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
        assert_eq!(outcome_to_status(&NodeOutcome::Success), "done");
        assert_eq!(outcome_to_status(&NodeOutcome::Failure), "failed");
    }

    #[test]
    fn success_and_failure_branches_resolve_differently() {
        let mut mission = active_mission_from(conditional_mission());
        let wave = root_wave_id(&mission.mission.mission_id);

        mission
            .node_statuses
            .insert("source".to_string(), "done".to_string());
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
                .insert(node_id.to_string(), "done".to_string());
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
            .insert("builder".to_string(), "done".to_string());
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
                .insert(node_id.to_string(), "done".to_string());
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

    #[test]
    fn append_patch_rejects_stale_run_version() {
        let mut mission = active_mission_from(retry_mission());
        let patch = MissionGraphPatch {
            nodes: vec![CompiledMissionNode {
                id: "doc".to_string(),
                role_id: "builder".to_string(),
                profile_id: None,
                instruction_override: String::new(),
                capabilities: None,
                requirements: None,
                terminal: test_terminal("doc"),
            }],
            edges: vec![],
        };

        let error = apply_append_patch(&mut mission, 99, &patch).expect_err("patch should reject stale runVersion");
        assert!(error.contains("Stale adaptive patch"));
    }

    #[test]
    fn append_patch_adds_node_and_recomputes_layers() {
        let mut mission = active_mission_from(retry_mission());
        let patch = MissionGraphPatch {
            nodes: vec![CompiledMissionNode {
                id: "doc".to_string(),
                role_id: "builder".to_string(),
                profile_id: None,
                instruction_override: String::new(),
                capabilities: None,
                requirements: None,
                terminal: test_terminal("doc"),
            }],
            edges: vec![CompiledMissionEdge {
                id: "reviewer-doc".to_string(),
                from_node_id: "reviewer".to_string(),
                to_node_id: "doc".to_string(),
                condition: WorkflowEdgeCondition::OnSuccess,
            }],
        };

        let result = apply_append_patch(&mut mission, 1, &patch).expect("patch should apply");
        assert_eq!(result.previous_run_version, 1);
        assert_eq!(result.run_version, 2);
        assert!(mission.mission.nodes.iter().any(|node| node.id == "doc"));
        assert!(mission
            .mission
            .metadata
            .execution_layers
            .last()
            .map(|layer| layer.contains(&"doc".to_string()))
            .unwrap_or(false));
    }
}
