import type {
  MaterializedNode,
  NodeInstance,
  NodeSocketDataType,
  NodeSocketDefinition,
  NodeSocketDirection,
  NodeTreeDefinition,
  NodeTreeDocument,
} from './types';

export interface NodeDeclaration {
  inputs: NodeSocketDefinition[];
  outputs: NodeSocketDefinition[];
  useCustomSocketOrder: boolean;
  allowAnySocketOrder: boolean;
}

export interface NodeDeclarationContext {
  document: NodeTreeDocument;
  tree: NodeTreeDefinition;
  node: NodeInstance;
  registry: NodeTypeRegistry;
}

export interface NodeTypeDefinition {
  type: string;
  label: string;
  category: string;
  width?: number;
  createProperties: () => Record<string, unknown>;
  declare: (context: NodeDeclarationContext, builder: NodeDeclarationBuilder) => void;
}

function makeSocket(
  direction: NodeSocketDirection,
  identifier: string,
  name: string,
  dataType: NodeSocketDataType,
  extras?: Partial<NodeSocketDefinition>
): NodeSocketDefinition {
  return {
    id: identifier,
    identifier,
    name,
    direction,
    dataType,
    shape: 'circle',
    available: true,
    hidden: false,
    ...extras,
  };
}

export class NodeDeclarationBuilder {
  private readonly declaration: NodeDeclaration = {
    inputs: [],
    outputs: [],
    useCustomSocketOrder: false,
    allowAnySocketOrder: false,
  };

  addInput(
    identifier: string,
    name: string,
    dataType: NodeSocketDataType,
    extras?: Partial<NodeSocketDefinition>
  ) {
    this.declaration.inputs.push(makeSocket('input', identifier, name, dataType, extras));
    return this;
  }

  addOutput(
    identifier: string,
    name: string,
    dataType: NodeSocketDataType,
    extras?: Partial<NodeSocketDefinition>
  ) {
    this.declaration.outputs.push(makeSocket('output', identifier, name, dataType, extras));
    return this;
  }

  useCustomSocketOrder() {
    this.declaration.useCustomSocketOrder = true;
    return this;
  }

  allowAnySocketOrder() {
    this.declaration.allowAnySocketOrder = true;
    return this;
  }

  build(): NodeDeclaration {
    return {
      ...this.declaration,
      inputs: [...this.declaration.inputs],
      outputs: [...this.declaration.outputs],
    };
  }
}

export class NodeTypeRegistry {
  private readonly definitions = new Map<string, NodeTypeDefinition>();

  register(definition: NodeTypeDefinition) {
    this.definitions.set(definition.type, definition);
    return this;
  }

  get(type: string): NodeTypeDefinition {
    const definition = this.definitions.get(type);
    if (!definition) {
      throw new Error(`Unknown node type "${type}".`);
    }
    return definition;
  }

  declarationFor(context: NodeDeclarationContext): NodeDeclaration {
    const builder = new NodeDeclarationBuilder();
    this.get(context.node.type).declare(context, builder);
    return builder.build();
  }

  list() {
    return Array.from(this.definitions.values());
  }
}

export function createWorkflowNodeRegistry() {
  const registry = new NodeTypeRegistry();

  registry.register({
    type: 'workflow.task',
    label: 'Task',
    category: 'Input',
    width: 280,
    createProperties: () => ({
      prompt: '',
      mode: 'build',
      workspaceDir: '',
      authoringMode: 'graph',
      presetId: '',
      runVersion: 1,
    }),
    declare: (_context, builder) => {
      builder.addOutput('start', 'Start', 'flow');
    },
  });

  registry.register({
    type: 'workflow.agent',
    label: 'Agent',
    category: 'Execution',
    width: 260,
    createProperties: () => ({
      roleId: 'agent',
      instructionOverride: '',
      terminalId: '',
      terminalTitle: '',
      paneId: '',
      cli: 'claude',
      executionMode: 'interactive_pty',
      autoLinked: false,
      authoringMode: 'graph',
      presetId: '',
      runVersion: 1,
      adaptiveSeed: false,
    }),
    declare: (_context, builder) => {
      builder.addInput('in', 'In', 'flow');
      builder.addOutput('success', 'Success', 'flow');
      builder.addOutput('failure', 'Failure', 'flow');
    },
  });

  registry.register({
    type: 'workflow.barrier',
    label: 'Barrier',
    category: 'Flow',
    width: 220,
    createProperties: () => ({}),
    declare: (_context, builder) => {
      builder.addInput('in', 'Wait For', 'flow', { multiInput: true, linkLimit: 4096 });
      builder.addOutput('out', 'Continue', 'flow');
    },
  });

  registry.register({
    type: 'workflow.reroute',
    label: 'Reroute',
    category: 'Flow',
    width: 120,
    createProperties: () => ({}),
    declare: (_context, builder) => {
      builder.useCustomSocketOrder().allowAnySocketOrder();
      builder.addInput('in', 'In', 'flow');
      builder.addOutput('out', 'Out', 'flow');
    },
  });

  registry.register({
    type: 'workflow.frame',
    label: 'Frame',
    category: 'Layout',
    width: 360,
    createProperties: () => ({
      label: 'Frame',
    }),
    declare: (_context, _builder) => {
      return;
    },
  });

  registry.register({
    type: 'workflow.group',
    label: 'Group',
    category: 'Group',
    width: 280,
    createProperties: () => ({
      treeId: '',
    }),
    declare: (context, builder) => {
      const treeId = String(context.node.properties.treeId ?? '');
      const groupTree = context.document.trees[treeId];
      if (!groupTree) {
        builder.addInput('missing_in', 'Missing Group', 'opaque', { hidden: true, available: false });
        return;
      }
      for (const socket of groupTree.interface.sockets.filter(entry => entry.direction === 'input')) {
        builder.addInput(socket.identifier, socket.name, socket.dataType, {
          defaultValue: socket.defaultValue,
          description: socket.description,
        });
      }
      for (const socket of groupTree.interface.sockets.filter(entry => entry.direction === 'output')) {
        builder.addOutput(socket.identifier, socket.name, socket.dataType, {
          defaultValue: socket.defaultValue,
          description: socket.description,
        });
      }
    },
  });

  registry.register({
    type: 'workflow.group_input',
    label: 'Group Input',
    category: 'Group',
    width: 220,
    createProperties: () => ({}),
    declare: (context, builder) => {
      for (const socket of context.tree.interface.sockets.filter(entry => entry.direction === 'input')) {
        builder.addOutput(socket.identifier, socket.name, socket.dataType, {
          defaultValue: socket.defaultValue,
          description: socket.description,
        });
      }
    },
  });

  registry.register({
    type: 'workflow.group_output',
    label: 'Group Output',
    category: 'Group',
    width: 220,
    createProperties: () => ({}),
    declare: (context, builder) => {
      for (const socket of context.tree.interface.sockets.filter(entry => entry.direction === 'output')) {
        builder.addInput(socket.identifier, socket.name, socket.dataType, {
          defaultValue: socket.defaultValue,
          description: socket.description,
        });
      }
    },
  });

  registry.register({
    type: 'workflow.output',
    label: 'Output',
    category: 'Execution',
    width: 240,
    createProperties: () => ({
      missionId: '',
      label: 'Artifacts',
    }),
    declare: (_context, builder) => {
      builder.addInput('in', 'In', 'flow');
    },
  });

  return registry;
}

export function materializeNode(
  document: NodeTreeDocument,
  tree: NodeTreeDefinition,
  node: NodeInstance,
  registry: NodeTypeRegistry
): MaterializedNode {
  const context: NodeDeclarationContext = { document, tree, node, registry };
  const declaration = registry.declarationFor(context);
  return {
    node,
    inputs: declaration.inputs.filter(socket => socket.hidden !== true && socket.available !== false),
    outputs: declaration.outputs.filter(socket => socket.hidden !== true && socket.available !== false),
    width: node.size?.width ?? registry.get(node.type).width ?? 240,
  };
}
