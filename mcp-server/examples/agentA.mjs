import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { StreamableHTTPClientTransport } from '@modelcontextprotocol/sdk/client/streamableHttp.js';

// Sender agent: connect, then call the server 'relay_message' tool to send a
// message to the given target session id.
// usage: node agentA.mjs <targetSessionId>

const MCP_URL = process.env.MCP_URL || 'http://localhost:3741/mcp';

async function main() {
  const target = process.argv[2];
  if (!target) {
    console.error('Usage: node agentA.mjs <targetSessionId>');
    process.exit(1);
  }

  const transport = new StreamableHTTPClientTransport(new URL(MCP_URL));
  const client = new Client({ name: 'agent-a', version: '1.0.0' });

  await client.connect(transport);

  console.log('Agent A connected. sessionId:', transport.sessionId);
  console.log('Calling relay tool to send message to', target);

  try {
    const result = await client.callTool({ name: 'relay_message', arguments: { targetSessionId: target, message: 'Hello from Agent A' } });
    console.log('Relay tool result:', result);
  } catch (err) {
    console.error('Failed to call relay tool', err);
  }

  process.exit(0);
}

main().catch(err => {
  console.error('Agent A error', err);
  process.exit(1);
});
