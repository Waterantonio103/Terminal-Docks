
import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js';

const SERVER_URL = 'http://localhost:3741/mcp';

async function createAgent(name) {
  console.log(`Initial handshake for ${name}...`);
  const initRes = await fetch(SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 0,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { sampling: {} },
        clientInfo: { name: `Agent-${name}`, version: '1.0.0' }
      }
    })
  });

  if (!initRes.ok) throw new Error(`Init failed: ${initRes.status} ${await initRes.text()}`);

  const sessionId = initRes.headers.get('mcp-session-id');
  if (!sessionId) throw new Error(`No session ID returned for ${name}`);
  console.log(`${name} assigned session ID: ${sessionId}`);

  const transport = new SSEClientTransport(new URL(SERVER_URL), {
    eventSourceInit: {
      headers: { 'mcp-session-id': sessionId }
    },
    requestInit: {
      headers: { 'mcp-session-id': sessionId }
    }
  });

  const client = new Client(
    { name: `Agent-${name}`, version: '1.0.0' },
    { capabilities: { sampling: {} } }
  );

  await client.connect(transport);
  console.log(`${name} connected.`);

  // Send initialized notification (required after initialize)
  await client.notification({ method: 'notifications/initialized' });

  return { client, sessionId };
}

async function runTest() {
  console.log('Starting relay test...');

  // 1. Create Agent B first so it can receive messages
  const agentB = await createAgent('B');

  // 2. Set up Agent B to respond to sampling requests
  agentB.client.setRequestHandler(
    { method: 'sampling/createMessage' },
    async (request) => {
      const message = request.params.messages[0].content.text;
      console.log(`Agent B received message: "${message}"`);
      return {
        role: 'assistant',
        content: { type: 'text', text: `Hi! This is Agent B responding to your message: "${message}"` }
      };
    }
  );

  // 3. Create Agent A
  const agentA = await createAgent('A');

  // 4. Agent A sends a message to Agent B using the relay_message tool
  console.log(`Agent A calling relay_message to Agent B (${agentB.sessionId})...`);
  try {
    const result = await agentA.client.callTool({
      name: 'relay_message',
      arguments: {
        targetSessionId: agentB.sessionId,
        message: 'Hello Agent B, how are you today?'
      }
    });

    console.log('Agent A received reply from relay:');
    console.log(JSON.stringify(result, null, 2));

    if (result.content && result.content[0] && result.content[0].text.includes('Hi! This is Agent B')) {
      console.log('\nSUCCESS: Relay test passed!');
    } else {
      console.log('\nFAILURE: Unexpected reply content.');
    }
  } catch (error) {
    console.error('Error during relay_message call:', error);
  }

  // Cleanup
  process.exit(0);
}

runTest().catch(err => {
  console.error('Test failed:', err);
  process.exit(1);
});
