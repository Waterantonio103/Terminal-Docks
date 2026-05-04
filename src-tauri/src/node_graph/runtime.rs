use serde::{Deserialize, Serialize};

use super::types::{NodeId, NodeTreeId, Point2D};

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeEditorView {
    pub pan: Point2D,
    pub zoom: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeSelection {
    pub node_ids: Vec<NodeId>,
    pub link_ids: Vec<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeEditorState {
    pub tree_path: Vec<NodeTreeId>,
    pub active_node_id: Option<NodeId>,
    pub selection: NodeSelection,
}

#[derive(Debug, Clone, Default)]
pub struct NodeGraphRuntime {
    pub declaration_version: u64,
    pub topology_version: u64,
}

