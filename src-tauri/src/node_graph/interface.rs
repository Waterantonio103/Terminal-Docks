use super::types::{NodeSocketDataType, NodeTree, NodeTreeInterfaceSocket};

pub fn interface_inputs(tree: &NodeTree) -> Vec<NodeTreeInterfaceSocket> {
    tree.interface
        .sockets
        .iter()
        .filter(|socket| matches!(socket.direction, super::types::NodeSocketDirection::Input))
        .cloned()
        .collect()
}

pub fn interface_outputs(tree: &NodeTree) -> Vec<NodeTreeInterfaceSocket> {
    tree.interface
        .sockets
        .iter()
        .filter(|socket| matches!(socket.direction, super::types::NodeSocketDirection::Output))
        .cloned()
        .collect()
}

pub fn supports_socket_type(socket: &NodeTreeInterfaceSocket, data_type: NodeSocketDataType) -> bool {
    socket.data_type == data_type
}

