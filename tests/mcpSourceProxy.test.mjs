import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const tempRoot = mkdtempSync(join(tmpdir(), 'terminal-docks-mcp-sources-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
process.env.MCP_DISABLE_HTTP = '1';

const { db, initDb } = await import('../mcp-server/src/db/index.mjs');
const {
  archiveMcpSource,
  callProxyTool,
  createMcpSource,
  createRemoteMcpSource,
  createStdioMcpSource,
  getCuratedMcpSourceCatalog,
  getExternalProxyEntries,
  initMcpSourceRegistry,
  listAgentVisibleProxyResources,
  listAgentVisibleProxyTools,
  listMcpProxyAudit,
  listMcpSources,
  listPendingMcpToolApprovals,
  migrateStarlinkToolConfig,
  probeMcpSourcePorts,
  previewMcpClientConfig,
  readProxyResource,
  resolveProxyTool,
  resolveMcpToolApproval,
  restoreMcpSource,
  updateMcpSource,
  updateMcpSourceTool,
  validateRemoteSourceUrl,
} = await import('../mcp-server/src/mcp-sources.mjs');

function resetRegistry() {
  db.exec(`
    DROP TABLE IF EXISTS mcp_tool_approvals;
    DROP TABLE IF EXISTS mcp_proxy_audit;
    DROP TABLE IF EXISTS mcp_source_resources;
    DROP TABLE IF EXISTS mcp_source_tools;
    DROP TABLE IF EXISTS mcp_sources;
  `);
  initMcpSourceRegistry();
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch (error) {
        reject(error);
      }
    });
    req.on('error', reject);
  });
}

async function startFakeMcpServer(tools, handler = () => ({ content: [{ type: 'text', text: 'ok' }] }), options = {}) {
  const calls = [];
  const requests = [];
  const server = createServer(async (req, res) => {
    requests.push({ headers: req.headers });
    if (req.method !== 'POST') {
      res.statusCode = 404;
      res.end('not found');
      return;
    }
    const body = await readJson(req);
    if (body.method === 'initialize') {
      res.setHeader('content-type', 'application/json');
      res.setHeader('mcp-session-id', 'fake-session');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'fake', version: '1' } } }));
      return;
    }
    if (body.method === 'notifications/initialized') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', result: {} }));
      return;
    }
    if (body.method === 'tools/list') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { tools } }));
      return;
    }
    if (body.method === 'resources/list') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result: { resources: options.resources ?? [] } }));
      return;
    }
    if (body.method === 'resources/read') {
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({
        jsonrpc: '2.0',
        id: body.id,
        result: options.resourceRead?.(body.params) ?? { contents: [{ uri: body.params.uri, mimeType: 'text/plain', text: 'resource text' }] },
      }));
      return;
    }
    if (body.method === 'tools/call') {
      calls.push(body.params);
      const result = await handler(body.params);
      res.setHeader('content-type', 'application/json');
      res.end(JSON.stringify({ jsonrpc: '2.0', id: body.id, result }));
      return;
    }
    res.statusCode = 400;
    res.end('unsupported');
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    url: `http://127.0.0.1:${address.port}/mcp`,
    calls,
    requests,
    close: () => new Promise(resolve => server.close(resolve)),
  };
}

async function startFakeSseProbeServer() {
  const sockets = new Set();
  const server = createServer(async (req, res) => {
    if (req.method === 'GET' && req.url === '/sse') {
      res.writeHead(200, { 'content-type': 'text/event-stream' });
      res.write(': ready\n\n');
      return;
    }
    res.statusCode = 404;
    res.end('not found');
  });
  server.on('connection', socket => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  return {
    port: address.port,
    close: () => new Promise(resolve => {
      for (const socket of sockets) socket.destroy();
      server.close(resolve);
    }),
  };
}

function writeFakeStdioServer() {
  const file = join(tempRoot, `fake-stdio-${Date.now()}.mjs`);
  writeFileSync(file, `
import readline from 'node:readline';
const rl = readline.createInterface({ input: process.stdin });
function send(message) { process.stdout.write(JSON.stringify(message) + '\\n'); }
rl.on('line', line => {
  const body = JSON.parse(line);
  if (body.method === 'initialize') send({ jsonrpc: '2.0', id: body.id, result: { protocolVersion: '2025-11-25', capabilities: {}, serverInfo: { name: 'stdio', version: '1' } } });
  if (body.method === 'tools/list') send({ jsonrpc: '2.0', id: body.id, result: { tools: [{ name: 'echo', inputSchema: { type: 'object', properties: { message: { type: 'string' } } } }] } });
  if (body.method === 'resources/list') send({ jsonrpc: '2.0', id: body.id, result: { resources: [{ uri: 'file://stdio-note', name: 'Stdio Note', mimeType: 'text/plain' }] } });
  if (body.method === 'tools/call') send({ jsonrpc: '2.0', id: body.id, result: { content: [{ type: 'text', text: body.params.arguments.message || 'empty' }] } });
  if (body.method === 'resources/read') send({ jsonrpc: '2.0', id: body.id, result: { contents: [{ uri: body.params.uri, mimeType: 'text/plain', text: 'stdio resource' }] } });
});
`, 'utf8');
  return file;
}

async function run(name, fn) {
  try {
    resetRegistry();
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

try {
  initDb();
  initMcpSourceRegistry();

  await run('blocks public internet MCP URLs in v1', async () => {
    const result = validateRemoteSourceUrl('https://example.com/mcp');
    assert.equal(result.ok, false);
    assert.match(result.error, /localhost and private-network/);
    assert.equal(validateRemoteSourceUrl('https://example.com/mcp', { allowPublic: true }).ok, true);
  });

  await run('probes explicit local MCP ports without credentials or broad scans', async () => {
    const fake = await startFakeMcpServer([{ name: 'probe_ok', inputSchema: { type: 'object', properties: {} } }]);
    try {
      const port = new URL(fake.url).port;
      const result = await probeMcpSourcePorts({ host: '127.0.0.1', ports: [port], paths: ['/mcp'], timeoutMs: 600 });
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].status, 'valid_mcp');
      assert.equal(result.results[0].url, fake.url);
      assert.ok(!fake.requests.some(request => request.headers.authorization));
      await assert.rejects(() => probeMcpSourcePorts({ ports: ['1-32'] }), /no wider than 16 ports/);
    } finally {
      await fake.close();
    }
  });

  await run('classifies legacy SSE-looking probe endpoints as possible MCP', async () => {
    const fake = await startFakeSseProbeServer();
    try {
      const result = await probeMcpSourcePorts({ host: '127.0.0.1', ports: [fake.port], paths: ['/sse'], timeoutMs: 600 });
      assert.equal(result.results.length, 1);
      assert.equal(result.results[0].status, 'possible_mcp_sse');
    } finally {
      await fake.close();
    }
  });

  await run('discovers and exposes enabled remote HTTP tools with source-scoped names', async () => {
    const fake = await startFakeMcpServer([
      {
        name: 'create_scene',
        title: 'Create Scene',
        description: 'Create an Excalidraw scene',
        inputSchema: { type: 'object', properties: { title: { type: 'string' } } },
      },
    ]);
    try {
      await createRemoteMcpSource({ id: 'excalidraw', displayName: 'Excalidraw', url: fake.url, enabled: true });
      const tools = listAgentVisibleProxyTools();
      assert.equal(tools.length, 1);
      assert.equal(tools[0].name, 'excalidraw_create_scene');
      assert.deepEqual(Object.keys(tools[0].inputSchema.properties), ['title']);
    } finally {
      await fake.close();
    }
  });

  await run('forwards proxied calls to original upstream tool names', async () => {
    const fake = await startFakeMcpServer([
      { name: 'draw-box', title: 'Draw Box', inputSchema: { type: 'object', properties: { x: { type: 'number' } } } },
    ], params => ({ content: [{ type: 'text', text: `called ${params.name}` }] }));
    try {
      await createRemoteMcpSource({ id: 'canvas', displayName: 'Canvas', url: fake.url, enabled: true });
      const result = await callProxyTool('canvas_draw_box', { x: 2 });
      assert.equal(result.content[0].text, 'called draw-box');
      assert.equal(fake.calls[0].name, 'draw-box');
      assert.deepEqual(fake.calls[0].arguments, { x: 2 });
    } finally {
      await fake.close();
    }
  });

  await run('hides disabled sources and rejects cached calls immediately', async () => {
    const fake = await startFakeMcpServer([{ name: 'ping', inputSchema: { type: 'object', properties: {} } }]);
    try {
      await createRemoteMcpSource({ id: 'localbox', displayName: 'Local Box', url: fake.url, enabled: true });
      updateMcpSource('localbox', { enabled: false });
      assert.equal(listAgentVisibleProxyTools().length, 0);
      const resolved = resolveProxyTool('localbox_ping');
      assert.equal(resolved.ok, false);
      assert.equal(resolved.reason, 'disabled');
      await assert.rejects(() => callProxyTool('localbox_ping', {}), /disabled/);
    } finally {
      await fake.close();
    }
  });

  await run('hides disabled tools without disabling the whole source', async () => {
    const fake = await startFakeMcpServer([
      { name: 'safe', inputSchema: { type: 'object', properties: {} } },
      { name: 'danger', inputSchema: { type: 'object', properties: {} } },
    ]);
    try {
      await createRemoteMcpSource({ id: 'lab', displayName: 'Lab', url: fake.url, enabled: true });
      updateMcpSourceTool('lab', 'danger', { enabled: false });
      assert.deepEqual(listAgentVisibleProxyTools().map(tool => tool.name), ['lab_safe']);
    } finally {
      await fake.close();
    }
  });

  await run('blocks colliding normalized proxy names', async () => {
    const fakeA = await startFakeMcpServer([{ name: 'bar_baz', inputSchema: { type: 'object', properties: {} } }]);
    const fakeB = await startFakeMcpServer([{ name: 'baz', inputSchema: { type: 'object', properties: {} } }]);
    try {
      await createRemoteMcpSource({ id: 'foo', displayName: 'Foo', url: fakeA.url, enabled: true });
      await createRemoteMcpSource({ id: 'foo_bar', displayName: 'Foo Bar', url: fakeB.url, enabled: true });
      assert.equal(listAgentVisibleProxyTools().length, 0);
      assert.equal(getExternalProxyEntries().filter(entry => entry.collision).length, 2);
      const resolved = resolveProxyTool('foo_bar_baz');
      assert.equal(resolved.ok, false);
      assert.equal(resolved.reason, 'collision');
    } finally {
      await fakeA.close();
      await fakeB.close();
    }
  });

  await run('archives sources without reusing active tool surface', async () => {
    const fake = await startFakeMcpServer([{ name: 'ping', inputSchema: { type: 'object', properties: {} } }]);
    try {
      await createRemoteMcpSource({ id: 'archive_me', displayName: 'Archive Me', url: fake.url, enabled: true });
      archiveMcpSource('archive_me');
      assert.equal(listAgentVisibleProxyTools().length, 0);
      await assert.rejects(
        () => createRemoteMcpSource({ id: 'archive_me', displayName: 'Again', url: fake.url, enabled: true }),
        /already reserved/,
      );
    } finally {
      await fake.close();
    }
  });

  await run('MCP handler lists and calls proxied tools through Starlink', async () => {
    const fake = await startFakeMcpServer([
      { name: 'create_scene', inputSchema: { type: 'object', properties: { title: { type: 'string' } } } },
    ], params => ({ content: [{ type: 'text', text: `upstream:${params.name}` }] }));
    let server;
    try {
      await createRemoteMcpSource({ id: 'excalidraw', displayName: 'Excalidraw', url: fake.url, enabled: true });
      const { app } = await import('../mcp-server/server.mjs');
      server = app.listen(0, '127.0.0.1');
      await new Promise(resolve => server.once('listening', resolve));
      const base = `http://127.0.0.1:${server.address().port}/mcp`;
      const headers = { accept: 'application/json, text/event-stream', 'content-type': 'application/json' };
      const initialized = await fetch(base, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: '2025-11-25',
            capabilities: {},
            clientInfo: { name: 'proxy-test', version: '1' },
          },
        }),
      });
      const sessionId = initialized.headers.get('mcp-session-id');
      await initialized.text();
      await fetch(base, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} }),
      });
      const listed = await fetch(base, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      });
      const listedText = await listed.text();
      const listedPayload = JSON.parse(listedText.split('\n').find(line => line.startsWith('data: '))?.slice(6) ?? listedText);
      assert.ok(listedPayload.result.tools.some(tool => tool.name === 'excalidraw_create_scene'));

      const called = await fetch(base, {
        method: 'POST',
        headers: { ...headers, 'mcp-session-id': sessionId },
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 3,
          method: 'tools/call',
          params: { name: 'excalidraw_create_scene', arguments: { title: 'demo' } },
        }),
      });
      const calledPayload = JSON.parse(await called.text());
      assert.equal(calledPayload.result.content[0].text, 'upstream:create_scene');
    } finally {
      if (server) await new Promise(resolve => server.close(resolve));
      await fake.close();
    }
  });

  await run('stores remote auth settings safely and forwards auth headers', async () => {
    const fake = await startFakeMcpServer([{ name: 'secure', inputSchema: { type: 'object', properties: {} } }]);
    try {
      await createRemoteMcpSource({
        id: 'securebox',
        displayName: 'Secure Box',
        url: fake.url,
        enabled: true,
        auth: { type: 'bearer', bearerToken: 'secret-token' },
      });
      const source = listMcpSources().find(item => item.id === 'securebox');
      assert.deepEqual(source.auth, { type: 'bearer', hasBearerToken: true, headerNames: ['Authorization'] });
      await callProxyTool('securebox_secure', {});
      assert.ok(fake.requests.some(request => request.headers.authorization === 'Bearer secret-token'));
    } finally {
      await fake.close();
    }
  });

  await run('supports supervised stdio sources and unflattened resource reads', async () => {
    const script = writeFakeStdioServer();
    await createStdioMcpSource({
      id: 'localstdio',
      displayName: 'Local Stdio',
      command: process.execPath,
      args: [script],
      enabled: true,
    });
    assert.deepEqual(listAgentVisibleProxyTools().map(tool => tool.name), ['localstdio_echo']);
    const result = await callProxyTool('localstdio_echo', { message: 'hello stdio' });
    assert.equal(result.content[0].text, 'hello stdio');
    const resources = listAgentVisibleProxyResources();
    assert.equal(resources[0].uri, 'td-mcp://localstdio/file%3A%2F%2Fstdio-note');
    const read = await readProxyResource(resources[0].uri);
    assert.equal(read.result.contents[0].text, 'stdio resource');
  });

  await run('restores archived sources disabled for explicit repair', async () => {
    const fake = await startFakeMcpServer([{ name: 'ping', inputSchema: { type: 'object', properties: {} } }]);
    try {
      await createRemoteMcpSource({ id: 'restore_me', displayName: 'Restore Me', url: fake.url, enabled: true });
      archiveMcpSource('restore_me');
      const restored = restoreMcpSource('restore_me');
      assert.equal(restored.archived, false);
      assert.equal(restored.enabled, false);
      assert.equal(restored.status, 'disabled');
      assert.equal(listMcpSources({ includeArchived: true }).some(source => source.id === 'restore_me'), true);
    } finally {
      await fake.close();
    }
  });

  await run('enforces role filters, pending approvals, risk policy, defaults, and audit rows', async () => {
    const fake = await startFakeMcpServer([{ name: 'deploy', inputSchema: { type: 'object', properties: { env: { type: 'string' } } } }]);
    try {
      await createMcpSource({
        type: 'remote',
        id: 'policybox',
        displayName: 'Policy Box',
        url: fake.url,
        enabled: true,
        allowedRoles: ['builder'],
        defaultArgs: { env: 'staging' },
      });
      updateMcpSourceTool('policybox', 'deploy', {
        risk: 'high',
        confirmation: 'ask',
        defaultArgs: { force: false },
      });
      assert.equal(listAgentVisibleProxyTools({ role: 'reviewer' }).length, 0);
      await assert.rejects(() => callProxyTool('policybox_deploy', {}, { sessionId: 's-reviewer', role: 'reviewer' }), /role_denied/);
      await assert.rejects(() => callProxyTool('policybox_deploy', { force: true }, { sessionId: 's-builder', role: 'builder' }), /approval_required/);
      const pending = listPendingMcpToolApprovals();
      assert.equal(pending.length, 1);
      resolveMcpToolApproval(pending[0].id, { approved: true, resolvedBy: 'test' });
      const result = await callProxyTool('policybox_deploy', { force: true }, { sessionId: 's-builder', role: 'builder' });
      assert.equal(result.content[0].text, 'ok');
      assert.deepEqual(fake.calls.at(-1).arguments, { env: 'staging', force: true });
      const statuses = listMcpProxyAudit().map(row => row.status);
      assert.ok(statuses.includes('pending_approval'));
      assert.ok(statuses.includes('completed'));
    } finally {
      await fake.close();
    }
  });

  await run('proxies remote resources without flattening contents', async () => {
    const fake = await startFakeMcpServer(
      [{ name: 'noop', inputSchema: { type: 'object', properties: {} } }],
      undefined,
      { resources: [{ uri: 'image://one', name: 'Image One', mimeType: 'image/png' }] },
    );
    try {
      await createRemoteMcpSource({ id: 'resourcebox', displayName: 'Resource Box', url: fake.url, enabled: true });
      const resources = listAgentVisibleProxyResources();
      assert.equal(resources[0].mimeType, 'image/png');
      const read = await readProxyResource(resources[0].uri);
      assert.equal(read.result.contents[0].uri, 'image://one');
      assert.equal(read.result.contents[0].text, 'resource text');
    } finally {
      await fake.close();
    }
  });

  await run('previews client config imports and exposes curated catalog entries', async () => {
    const preview = previewMcpClientConfig({
      mcpServers: {
        github: { url: 'http://127.0.0.1:9999/mcp', name: 'GitHub' },
        files: { command: 'node', args: ['server.mjs'] },
      },
    });
    assert.deepEqual(preview.sources.map(source => source.id), ['github', 'files']);
    assert.ok(getCuratedMcpSourceCatalog().some(item => item.type === 'stdio'));
  });

  await run('migrates legacy toolbox config into Starlink source rows', async () => {
    const migrated = migrateStarlinkToolConfig({
      complete_task: {
        displayName: 'Complete Task',
        enabled: false,
        confirmation: 'ask',
        risk: 'high',
        allowedRoles: ['builder'],
      },
    });
    assert.equal(migrated.migrated, 1);
    const source = listMcpSources().find(item => item.id === 'starlink');
    const tool = source.tools.find(item => item.originalName === 'complete_task');
    assert.equal(tool.title, 'Complete Task');
    assert.equal(tool.enabled, false);
    assert.equal(tool.confirmation, 'ask');
    assert.equal(tool.risk, 'high');
    assert.deepEqual(tool.allowedRoles, ['builder']);
  });
} finally {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
}
