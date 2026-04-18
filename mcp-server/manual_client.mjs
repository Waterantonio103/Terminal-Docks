
import { randomUUID } from 'crypto';

const SERVER_URL = 'http://localhost:3741/mcp';

async function createAgent(name, onMessage) {
  console.log(`[${name}] Connecting...`);
  const controller = new AbortController();
  const res = await fetch(SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: { sampling: {} },
        clientInfo: { name: `Agent-${name}`, version: '1.0.0' }
      }
    }),
    signal: controller.signal
  });

  if (!res.ok) throw new Error(`Init failed: ${res.status}`);

  const sessionId = res.headers.get('mcp-session-id');
  console.log(`[${name}] Session ID: ${sessionId}`);

  const pendingRequests = new Map();
  // The first request (initialize) had id: 1
  let resolveInit;
  const initPromise = new Promise(resolve => resolveInit = resolve);
  pendingRequests.set(1, resolveInit);

  // Start reading the stream in the background
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';

  (async () => {
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop();
        for (const line of lines) {
          if (line.startsWith('data: ')) {
            const data = JSON.parse(line.substring(6));
            console.log(`[${name}] Received event:`, JSON.stringify(data).substring(0, 100));
            if (data.id && pendingRequests.has(data.id)) {
              pendingRequests.get(data.id)(data);
              pendingRequests.delete(data.id);
            } else {
              onMessage(data, sessionId);
            }
          }
        }
      }
    } catch (err) {
      if (err.name !== 'AbortError') console.error(`[${name}] Stream error:`, err);
    }
  })();

  // Wait for initialize response
  await initPromise;

  // Send initialized
  await fetch(SERVER_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Accept': 'application/json, text/event-stream',
      'mcp-session-id': sessionId
    },
    body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' })
  });

  return {
    sessionId,
    callTool: async (toolName, args) => {
      const id = randomUUID();
      const promise = new Promise(resolve => pendingRequests.set(id, resolve));
      await fetch(SERVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sessionId
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          method: 'tools/call',
          params: { name: toolName, arguments: args }
        })
      });
      return await promise;
    },
    respond: async (id, result) => {
      await fetch(SERVER_URL, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Accept': 'application/json, text/event-stream',
          'mcp-session-id': sessionId
        },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id,
          result
        })
      });
    },
    close: () => controller.abort()
  };
}

async function runTest() {
  const agentB = await createAgent('B', async (data, sid) => {
    if (data.method === 'sampling/createMessage') {
      const msg = data.params.messages[0].content.text;
      console.log(`Agent B received sampling request: "${msg}"`);
      await agentB.respond(data.id, {
        role: 'assistant',
        content: { type: 'text', text: `Agent B says: I received your message "${msg}"` }
      });
    }
  });

  const agentA = await createAgent('A', (data) => {});

  console.log(`Agent A calling relay_message to Agent B...`);
  const result = await agentA.callTool('relay_message', {
    targetSessionId: agentB.sessionId,
    message: 'Hello from Agent A!'
  });

  console.log('Result for Agent A:', JSON.stringify(result, null, 2));

  if (result.result && result.result.content && result.result.content[0].text.includes('Agent B says')) {
    console.log('\nSUCCESS: Relay worked!');
  } else {
    console.log('\nFAILURE: Relay did not return expected response.');
  }

  agentA.close();
  agentB.close();
  process.exit(0);
}

runTest().catch(console.error);
