use std::{collections::BTreeMap, sync::Arc};

use serde_json::{json, Value};

use super::types::{
    NodeInstance, NodeSocketDataType, NodeSocketDefinition, NodeSocketDirection,
    NodeSocketDisplayShape, NodeTree, NodeTreeDocument,
};

#[derive(Debug, Clone, Default)]
pub struct NodeDeclaration {
    pub inputs: Vec<NodeSocketDefinition>,
    pub outputs: Vec<NodeSocketDefinition>,
    pub use_custom_socket_order: bool,
    pub allow_any_socket_order: bool,
}

#[derive(Debug, Clone)]
pub struct NodeDeclarationContext<'a> {
    pub document: &'a NodeTreeDocument,
    pub tree: &'a NodeTree,
    pub node: &'a NodeInstance,
}

#[derive(Debug, Default)]
pub struct NodeDeclarationBuilder {
    declaration: NodeDeclaration,
}

impl NodeDeclarationBuilder {
    pub fn add_input(
        &mut self,
        identifier: &str,
        name: &str,
        data_type: NodeSocketDataType,
    ) -> &mut Self {
        self.declaration.inputs.push(NodeSocketDefinition {
            id: identifier.to_string(),
            identifier: identifier.to_string(),
            name: name.to_string(),
            direction: NodeSocketDirection::Input,
            data_type,
            shape: NodeSocketDisplayShape::Circle,
            multi_input: false,
            hidden: false,
            available: true,
            link_limit: None,
            default_value: None,
            description: None,
        });
        self
    }

    pub fn add_output(
        &mut self,
        identifier: &str,
        name: &str,
        data_type: NodeSocketDataType,
    ) -> &mut Self {
        self.declaration.outputs.push(NodeSocketDefinition {
            id: identifier.to_string(),
            identifier: identifier.to_string(),
            name: name.to_string(),
            direction: NodeSocketDirection::Output,
            data_type,
            shape: NodeSocketDisplayShape::Circle,
            multi_input: false,
            hidden: false,
            available: true,
            link_limit: None,
            default_value: None,
            description: None,
        });
        self
    }

    pub fn use_custom_socket_order(&mut self) -> &mut Self {
        self.declaration.use_custom_socket_order = true;
        self
    }

    pub fn allow_any_socket_order(&mut self) -> &mut Self {
        self.declaration.allow_any_socket_order = true;
        self
    }

    pub fn build(self) -> NodeDeclaration {
        self.declaration
    }
}

pub trait NodeDeclarationProvider: Send + Sync {
    fn type_name(&self) -> &'static str;
    fn label(&self) -> &'static str;
    fn default_properties(&self) -> Value;
    fn declare(&self, context: &NodeDeclarationContext<'_>, builder: &mut NodeDeclarationBuilder);
}

#[derive(Default)]
pub struct NodeDeclarationRegistry {
    providers: BTreeMap<String, Arc<dyn NodeDeclarationProvider>>,
}

impl NodeDeclarationRegistry {
    pub fn register(&mut self, provider: Arc<dyn NodeDeclarationProvider>) {
        self.providers
            .insert(provider.type_name().to_string(), provider);
    }

    pub fn get(&self, type_name: &str) -> Option<Arc<dyn NodeDeclarationProvider>> {
        self.providers.get(type_name).cloned()
    }
}

pub struct WorkflowTaskDeclaration;

impl NodeDeclarationProvider for WorkflowTaskDeclaration {
    fn type_name(&self) -> &'static str {
        "workflow.task"
    }

    fn label(&self) -> &'static str {
        "Task"
    }

    fn default_properties(&self) -> Value {
        json!({
            "prompt": "",
            "mode": "build",
            "workspaceDir": "",
        })
    }

    fn declare(&self, _context: &NodeDeclarationContext<'_>, builder: &mut NodeDeclarationBuilder) {
        builder.add_output("start", "Start", NodeSocketDataType::Flow);
    }
}

