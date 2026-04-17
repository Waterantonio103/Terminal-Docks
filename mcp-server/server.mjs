import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js';
import express from 'express';
import { z } from 'zod';
import { writeFileSync, mkdirSync } from 'fs';
import { randomUUID } from 'crypto';

const PORT = parseInt(process.env.MCP_PORT || '3741');

const projects = [];
const tasks = [];
const agents = [];

const server = new McpServer({ name: 'terminal-docks-bridge', version: '1.0.0' });

// Project Tools
server.tool(
  'list_projects',
  'List all projects for the authenticated builder. Use this first to discover project IDs.',
  {},
  async () => {
    return {
      content: [{ type: 'text', text: JSON.stringify(projects.map(p => ({
        id: p.id,
        name: p.name,
        description: p.description
      }))) }]
    };
  }
);

server.tool(
  'create_project',
  'Create a new project container.',
  {
    name: z.string().min(1).max(255).describe('Project name (1–255 characters)'),
    description: z.string().max(2000).optional().describe('Project description (max 2,000 characters)')
  },
  async ({ name, description }) => {
    const project = { id: randomUUID(), name, description: description || '' };
    projects.push(project);
    return { content: [{ type: 'text', text: JSON.stringify(project) }] };
  }
);

// Task Tools
server.tool(
  'list_tasks',
  'List all tasks in a project.',
  {
    projectId: z.string().uuid().describe('The project to list tasks from')
  },
  async ({ projectId }) => {
    const filteredTasks = tasks.filter(t => t.projectId === projectId);
    return {
      content: [{ type: 'text', text: JSON.stringify(filteredTasks.map(t => ({
        id: t.id,
        status: t.status,
        instructionsSummary: t.instructions.substring(0, 100),
        knowledge: t.taskKnowledge
      }))) }]
    };
  }
);

server.tool(
  'get_task',
  'Get full details for a single task, including complete instructions, knowledge, and metadata.',
  {
    taskId: z.string().uuid().describe('The task to retrieve')
  },
  async ({ taskId }) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found` }] };
    return { content: [{ type: 'text', text: JSON.stringify(task) }] };
  }
);

server.tool(
  'create_task',
  'Create a new task in a project.',
  {
    projectId: z.string().uuid().describe('The project to create the task in'),
    instructions: z.string().min(1).max(5000).describe('What the agent should do (1–5,000 characters)'),
    taskKnowledge: z.string().max(50000).optional().describe('Context and reference material (max 50,000 characters)'),
    status: z.enum(['todo', 'in-progress', 'in-review', 'complete', 'cancelled']).optional().default('todo').describe('Initial status')
  },
  async ({ projectId, instructions, taskKnowledge, status }) => {
    const task = {
      id: randomUUID(),
      projectId,
      instructions,
      taskKnowledge: taskKnowledge || '',
      status,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    tasks.push(task);
    return { content: [{ type: 'text', text: JSON.stringify(task) }] };
  }
);

server.tool(
  'update_task',
  'Update a task\'s status, instructions, or knowledge.',
  {
    taskId: z.string().uuid().describe('The task to update'),
    instructions: z.string().min(1).max(5000).optional().describe('Updated instructions'),
    taskKnowledge: z.string().max(50000).optional().describe('Updated knowledge context'),
    status: z.enum(['todo', 'in-progress', 'in-review', 'complete', 'cancelled']).optional().describe('New status')
  },
  async ({ taskId, instructions, taskKnowledge, status }) => {
    const task = tasks.find(t => t.id === taskId);
    if (!task) return { isError: true, content: [{ type: 'text', text: `Task ${taskId} not found` }] };
    
    if (!instructions && !taskKnowledge && !status) {
      return { isError: true, content: [{ type: 'text', text: 'At least one of instructions, taskKnowledge, or status must be provided.' }] };
    }

    if (instructions !== undefined) task.instructions = instructions;
    if (taskKnowledge !== undefined) task.taskKnowledge = taskKnowledge;
    if (status !== undefined) task.status = status;
    task.updatedAt = Date.now();

    return { content: [{ type: 'text', text: JSON.stringify(task) }] };
  }
);

// Agent Tools
server.tool(
  'list_agents',
  'List all agents configured for a project.',
  {
    projectId: z.string().uuid().describe('The project to list agents for')
  },
  async ({ projectId }) => {
    const filteredAgents = agents.filter(a => a.projectId === projectId);
    return {
      content: [{ type: 'text', text: JSON.stringify(filteredAgents.map(a => ({
        id: a.id,
        name: a.name,
        systemPrompt: a.systemPrompt
      }))) }]
    };
  }
);

server.tool(
  'get_agent',
  'Get full details for a single agent.',
  {
    agentId: z.string().uuid().describe('The agent to retrieve')
  },
  async ({ agentId }) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return { isError: true, content: [{ type: 'text', text: `Agent ${agentId} not found` }] };
    return { content: [{ type: 'text', text: JSON.stringify(agent) }] };
  }
);

server.tool(
  'create_agent',
  'Create a new agent with a custom system prompt, scoped to a project.',
  {
    projectId: z.string().uuid().describe('The project this agent belongs to'),
    name: z.string().min(1).max(255).describe('Agent name (1–255 characters)'),
    systemPrompt: z.string().min(1).max(100000).describe('System prompt defining the agent\'s behavior (1–100,000 characters)')
  },
  async ({ projectId, name, systemPrompt }) => {
    const agent = {
      id: randomUUID(),
      projectId,
      name,
      systemPrompt,
      createdAt: Date.now(),
      updatedAt: Date.now()
    };
    agents.push(agent);
    return { content: [{ type: 'text', text: JSON.stringify(agent) }] };
  }
);

server.tool(
  'update_agent',
  'Update an agent\'s name or system prompt.',
  {
    agentId: z.string().uuid().describe('The agent to update'),
    name: z.string().min(1).max(255).optional().describe('Updated name'),
    systemPrompt: z.string().min(1).max(100000).optional().describe('Updated system prompt')
  },
  async ({ agentId, name, systemPrompt }) => {
    const agent = agents.find(a => a.id === agentId);
    if (!agent) return { isError: true, content: [{ type: 'text', text: `Agent ${agentId} not found` }] };

    if (!name && !systemPrompt) {
      return { isError: true, content: [{ type: 'text', text: 'At least one of name or systemPrompt must be provided.' }] };
    }

    if (name !== undefined) agent.name = name;
    if (systemPrompt !== undefined) agent.systemPrompt = systemPrompt;
    agent.updatedAt = Date.now();

    return { content: [{ type: 'text', text: JSON.stringify(agent) }] };
  }
);

server.tool(
  'delete_agent',
  'Delete an agent.',
  {
    agentId: z.string().uuid().describe('The agent to delete')
  },
  async ({ agentId }) => {
    const index = agents.findIndex(a => a.id === agentId);
    if (index === -1) return { isError: true, content: [{ type: 'text', text: `Agent ${agentId} not found` }] };
    agents.splice(index, 1);
    return { content: [{ type: 'text', text: `Agent ${agentId} deleted` }] };
  }
);

const transport = new StreamableHTTPServerTransport({
  sessionIdGenerator: () => randomUUID(),
});
await server.connect(transport);

const app = express();
app.use(express.json());

app.get('/health', (_req, res) => res.json({ ok: true, port: PORT }));

app.all('/mcp', (req, res) => transport.handleRequest(req, res, req.body));

app.listen(PORT, () => {
  mkdirSync('.mcp', { recursive: true });
  writeFileSync(
    '.mcp/server.json',
    JSON.stringify({ url: `http://localhost:${PORT}/mcp`, port: PORT }, null, 2)
  );
  console.log(`MCP server listening on port ${PORT}`);
});
