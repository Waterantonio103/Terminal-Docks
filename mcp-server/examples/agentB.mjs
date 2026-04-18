import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';
import { CreateMessageRequestSchema } from '@modelcontextprotocol/sdk/types.js';

// Receiver agent: connects, prints session id, and registers a sampling handler
// that replies with "I hear you" when asked to create a message.

const MCP_URL = process.env.MCP_URL || 'http://localhost:3741/mcp';

async function main() {
  // Client must declare sampling capability to accept sampling/createMessage requests
  const client = new Client({ name: 'agent-b', version: '1.0.0' }, { capabilities: { sampling: {} } });

  // Register sampling handler
  client.setRequestHandler(CreateMessageRequestSchema, async (request) => {
    console.log('Agent B received sampling/createMessage request. params:', request.params);
    return {
      model: 'mock-model',
      role: 'assistant',
      content: { type: 'text', text: 'I hear you' }
    };
  });

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  await client.connect(transport);

  console.log('Agent B connected. sessionId:', transport.sessionId);

  // Keep process alive
  process.stdin.resume();
}

main().catch(err => {
  console.error('Agent B error', err);
  process.exit(1);
});
