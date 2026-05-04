use serde_json::Value;

use super::types::{NodeInstance, NodeTree, NodeTreeDocument};

pub trait WorkflowBackendAdapter {
    fn backend_key(&self, node: &NodeInstance) -> Option<String>;
    fn default_payload(&self, tree: &NodeTree, node: &NodeInstance) -> Value;
    fn validate_node(&self, document: &NodeTreeDocument, tree: &NodeTree, node: &NodeInstance)
        -> Result<(), String>;
}

