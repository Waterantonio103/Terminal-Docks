use std::collections::BTreeMap;

use serde::{Deserialize, Serialize};
use serde_json::Value;

pub type NodeTreeId = String;
pub type NodeId = String;
pub type NodeLinkId = String;
pub type NodeSocketId = String;

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeTreeKind {
    Workflow,
    Group,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeSocketDirection {
    Input,
    Output,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeSocketDataType {
    Flow,
    String,
    Path,
    Enum,
    Opaque,
}

#[derive(Serialize, Deserialize, Debug, Clone, PartialEq, Eq)]
#[serde(rename_all = "snake_case")]
pub enum NodeSocketDisplayShape {
    Circle,
    Square,
    Diamond,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Point2D {
    pub x: f32,
    pub y: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct Size2D {
    pub width: f32,
    pub height: f32,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeSocketRef {
    pub node_id: NodeId,
    pub socket_id: NodeSocketId,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeSocketDefinition {
    pub id: NodeSocketId,
    pub identifier: String,
    pub name: String,
    pub direction: NodeSocketDirection,
    pub data_type: NodeSocketDataType,
    pub shape: NodeSocketDisplayShape,
    pub multi_input: bool,
    pub hidden: bool,
    pub available: bool,
    pub link_limit: Option<u16>,
    pub default_value: Option<Value>,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeTreeInterfaceSocket {
    pub id: String,
    pub identifier: String,
    pub name: String,
    pub direction: NodeSocketDirection,
    pub data_type: NodeSocketDataType,
    pub default_value: Option<Value>,
    pub description: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeTreeInterfacePanel {
    pub id: String,
    pub name: String,
    pub parent_id: Option<String>,
    pub collapsed: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeTreeInterface {
    pub sockets: Vec<NodeTreeInterfaceSocket>,
    pub panels: Vec<NodeTreeInterfacePanel>,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeRuntime {
    pub declaration_dirty: bool,
    pub validation_error: Option<String>,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeInstance {
    pub id: NodeId,
    pub type_name: String,
    pub label: Option<String>,
    pub location: Point2D,
    pub size: Option<Size2D>,
    pub parent_id: Option<NodeId>,
    pub properties: Value,
    #[serde(skip, default)]
    pub runtime: NodeRuntime,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeLink {
    pub id: NodeLinkId,
    pub from: NodeSocketRef,
    pub to: NodeSocketRef,
    pub muted: bool,
    pub hidden: bool,
    pub valid: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone, Default)]
#[serde(rename_all = "camelCase")]
pub struct NodeTreeRuntime {
    pub topology_version: u64,
    pub has_invalid_links: bool,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeTree {
    pub id: NodeTreeId,
    pub name: String,
    pub kind: NodeTreeKind,
    pub interface: NodeTreeInterface,
    pub nodes: BTreeMap<NodeId, NodeInstance>,
    pub links: BTreeMap<NodeLinkId, NodeLink>,
    #[serde(skip, default)]
    pub runtime: NodeTreeRuntime,
}

#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct NodeTreeDocument {
    pub schema_version: u32,
    pub root_tree_id: NodeTreeId,
    pub trees: BTreeMap<NodeTreeId, NodeTree>,
}

