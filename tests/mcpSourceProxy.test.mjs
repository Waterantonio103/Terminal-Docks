import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
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
  createRemoteMcpSource,
  getExternalProxyEntries,
  initMcpSourceRegistry,
  listAgentVisibleProxyTools,
  resolveProxyTool,
  updateMcpSource,
  updateMcpSourceTool,
  validateRemoteSourceUrl,
} = await import('../mcp-server/src/mcp-sources.mjs');

function resetRegistry() {
  db.exec(`
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

async function startFakeMcpServer(tools, handler = () => ({ content: [{ type: 'text', text: 'ok' }] })) {
  const calls = [];
  const server = createServer(async (req, res) => {
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
    close: () => new Promise(resolve => server.close(resolve)),
  };
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
} finally {
  db.close();
  rmSync(tempRoot, { recursive: true, force: true });
}
