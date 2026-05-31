use serde::{Deserialize, Deserializer, Serialize};

#[derive(Serialize, Debug, Clone, PartialEq, Eq)]
pub enum WorkflowAgentCli {
    #[serde(rename = "claude")]
    Claude,
    #[serde(rename = "gemini")]
    Gemini,
    #[serde(rename = "opencode")]
    OpenCode,
    #[serde(rename = "codex")]
    Codex,
    #[serde(rename = "custom")]
    Custom,
    #[serde(rename = "ollama")]
    Ollama,
    #[serde(rename = "lmstudio")]
    Lmstudio,
}

fn normalize_workflow_cli_id(value: &str) -> String {
    value
        .trim()
        .to_lowercase()
        .split_whitespace()
        .collect::<Vec<_>>()
        .join("_")
        .replace('-', "_")
}

impl<'de> Deserialize<'de> for WorkflowAgentCli {
    fn deserialize<D>(deserializer: D) -> Result<Self, D::Error>
    where
        D: Deserializer<'de>,
    {
        let value = String::deserialize(deserializer)?;
        match normalize_workflow_cli_id(&value).as_str() {
            "claude" => Ok(Self::Claude),
            "gemini" => Ok(Self::Gemini),
            "open_code" | "opencode" => Ok(Self::OpenCode),
            "codex" => Ok(Self::Codex),
            "custom" => Ok(Self::Custom),
            "ollama" => Ok(Self::Ollama),
            "lm_studio" | "lmstudio" => Ok(Self::Lmstudio),
            _ => Err(serde::de::Error::unknown_variant(
                value.as_str(),
                &[
                    "claude",
                    "gemini",
                    "opencode",
                    "codex",
                    "custom",
                    "ollama",
                    "lmstudio",
                ],
            )),
        }
    }
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum WorkflowExecutionMode {
    Headless,
    StreamingHeadless,
    InteractivePty,
}

fn default_execution_mode() -> WorkflowExecutionMode {
    WorkflowExecutionMode::InteractivePty
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
    #[serde(default)]
    pub frontend_mode: Option<String>,
    #[serde(default)]
    pub frontend_category: Option<String>,
    #[serde(default)]
    pub frontend_direction: Option<serde_json::Value>,
    #[serde(default)]
    pub spec_profile: Option<String>,
    #[serde(default)]
    pub final_readme_enabled: Option<bool>,
    #[serde(default)]
    pub final_readme_owner_node_id: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CompiledMissionTerminalBinding {
    pub terminal_id: String,
    pub terminal_title: String,
    pub cli: WorkflowAgentCli,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub yolo: Option<bool>,
    #[serde(default = "default_execution_mode")]
    pub execution_mode: WorkflowExecutionMode,
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
    #[serde(default)]
    pub frontend_mode: Option<String>,
    #[serde(default)]
    pub frontend_category: Option<String>,
    #[serde(default)]
    pub frontend_direction: Option<serde_json::Value>,
    #[serde(default)]
    pub spec_profile: Option<String>,
    #[serde(default)]
    pub final_readme_enabled: Option<bool>,
    #[serde(default)]
    pub final_readme_owner_node_id: Option<String>,
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

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn workflow_cli_deserialization_accepts_common_aliases() {
        assert_eq!(
            serde_json::from_str::<WorkflowAgentCli>(r#""open-code""#).unwrap(),
            WorkflowAgentCli::OpenCode
        );
        assert_eq!(
            serde_json::from_str::<WorkflowAgentCli>(r#""Open Code""#).unwrap(),
            WorkflowAgentCli::OpenCode
        );
        assert_eq!(
            serde_json::from_str::<WorkflowAgentCli>(r#""LM Studio""#).unwrap(),
            WorkflowAgentCli::Lmstudio
        );
        assert_eq!(
            serde_json::from_str::<WorkflowAgentCli>(r#""ollama""#).unwrap(),
            WorkflowAgentCli::Ollama
        );
    }

    #[test]
    fn workflow_cli_serialization_stays_canonical() {
        assert_eq!(
            serde_json::to_string(&WorkflowAgentCli::OpenCode).unwrap(),
            r#""opencode""#
        );
        assert_eq!(
            serde_json::to_string(&WorkflowAgentCli::Lmstudio).unwrap(),
            r#""lmstudio""#
        );
    }
}
