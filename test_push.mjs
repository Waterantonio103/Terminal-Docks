import { request } from 'http';

const token = process.env.MCP_INTERNAL_PUSH_TOKEN || 'test-token';

const data = JSON.stringify({
  type: "runtime_bootstrap",
  sessionId: "test-session-123",
  missionId: "test-mission-123",
  nodeId: "test-node-123",
  attempt: 1,
  role: "agent",
  agentId: "claude",
  terminalId: "term-1",
  cli: "claude"
});

const options = {
  hostname: 'localhost',
  port: 3741,
  path: '/internal/push',
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Content-Length': Buffer.byteLength(data),
    'x-td-push-token': token
  }
};

const req = request(options, res => {
  let body = '';
  res.on('data', d => body += d);
  res.on('end', () => {
    console.log('Status:', res.statusCode);
    console.log('Headers:', res.headers);
    console.log('Body:', body);
  });
});

req.on('error', console.error);
req.write(data);
req.end();
