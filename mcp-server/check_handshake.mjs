
const SERVER_URL = 'http://localhost:3741/mcp';

async function check() {
  console.log('Testing handshake...');
  const res = await fetch(SERVER_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'Accept': 'application/json, text/event-stream' },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: '2024-11-05',
        capabilities: {},
        clientInfo: { name: 'test', version: '1.0.0' }
      }
    })
  });

  console.log('Status:', res.status);
  console.log('Headers:', JSON.stringify(Object.fromEntries(res.headers.entries()), null, 2));
  const body = await res.text();
  console.log('Body:', body);
}

check().catch(console.error);
