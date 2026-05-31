import http from 'http';

process.env.MCP_INTERNAL_PUSH_TOKEN = 'test_token';
process.env.MCP_DB_PATH = ':memory:';
process.env.MCP_DISABLE_HTTP = '1';

async function runTest() {
  const { app } = await import('./server.mjs');
  const server = app.listen(3745);

  const payload = {
    type: "runtime_bootstrap",
    sessionId: "test-session-1",
    missionId: "mission-1",
    nodeId: "node-1",
    attempt: 1,
    role: "agent",
    agentId: "claude",
    terminalId: "term-1",
    cli: "claude"
  };

  const data = JSON.stringify(payload);

  const req = http.request({
    hostname: '127.0.0.1',
    port: 3745,
    path: '/internal/push',
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Content-Length': Buffer.byteLength(data),
      'x-comet-push-token': 'test_token'
    }
  }, (res) => {
    let body = '';
    res.on('data', d => body += d);
    res.on('end', () => {
      console.log('Status:', res.statusCode);
      console.log('Body:', body);
      server.close();
      process.exit(res.statusCode === 200 ? 0 : 1);
    });
  });
  
  req.on('error', (e) => {
    console.error(e);
    server.close();
    process.exit(1);
  });
  
  req.write(data);
  req.end();
}

runTest();
