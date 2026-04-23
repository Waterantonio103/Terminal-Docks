use serde::{Deserialize, Serialize};

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowAgentCli {
    Claude,
    Gemini,
    OpenCode,
    Codex,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowEdgeCondition {
    Always,
    OnSuccess,
    OnFailure,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowMode {
    Build,
    Edit,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowAuthoringMode {
    Preset,
    Graph,
    Adaptive,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompiledMissionTaskContext {
    pub node_id: String,
    pub prompt: String,
    pub mode: WorkflowMode,
    pub workspace_dir: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompiledMissionTerminalBinding {
    pub terminal_id: String,
    pub terminal_title: String,
    pub cli: WorkflowAgentCli,
    pub pane_id: Option<String>,
    pub reused_existing: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct WorkerCapability {
    pub id: String,
    pub level: Option<u8>,
    pub verified_by: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompiledMissionNode {
    pub id: String,
    pub role_id: String,
    #[serde(default)]
    pub profile_id: Option<String>,
    pub instruction_override: String,
    #[serde(default)]
    pub capabilities: Option<Vec<WorkerCapability>>,
    #[serde(default)]
    pub requirements: Option<serde_json::Value>,
    pub terminal: CompiledMissionTerminalBinding,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompiledMissionEdge {
    pub id: String,
    pub from_node_id: String,
    pub to_node_id: String,
    pub condition: WorkflowEdgeCondition,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompiledMissionMetadata {
    pub compiled_at: u64,
    pub source_graph_id: String,
    pub start_node_ids: Vec<String>,
    pub execution_layers: Vec<Vec<String>>,
    pub authoring_mode: Option<WorkflowAuthoringMode>,
    pub preset_id: Option<String>,
    pub run_version: Option<u32>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompiledMission {
    pub mission_id: String,
    pub graph_id: String,
    pub task: CompiledMissionTaskContext,
    pub metadata: CompiledMissionMetadata,
    pub nodes: Vec<CompiledMissionNode>,
    pub edges: Vec<CompiledMissionEdge>,
}
