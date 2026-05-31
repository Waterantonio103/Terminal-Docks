import assert from 'node:assert/strict';

const { readMcpJsonResponse } = await import('../.tmp-tests/lib/mcpResponse.js');

function response(body, init = {}) {
  return new Response(body, init);
}

async function run(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await run('parses regular JSON object MCP responses', async () => {
  const parsed = await readMcpJsonResponse(response('{"jsonrpc":"2.0","result":{"ok":true}}', {
    status: 200,
    headers: { 'content-type': 'application/json' },
  }));
  assert.deepEqual(parsed, { jsonrpc: '2.0', result: { ok: true } });
});

await run('parses CRLF event-stream data payloads', async () => {
  const parsed = await readMcpJsonResponse(response('event: message\r\ndata: {"result":{"content":[{"text":"ok"}]}}\r\n\r\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }));
  assert.deepEqual(parsed, { result: { content: [{ text: 'ok' }] } });
});

await run('detects event-stream content type case-insensitively', async () => {
  const parsed = await readMcpJsonResponse(response('data: {"result":{"content":[{"text":"ok"}]}}\n\n', {
    status: 200,
    headers: { 'content-type': 'Text/Event-Stream; Charset=UTF-8' },
  }));
  assert.deepEqual(parsed, { result: { content: [{ text: 'ok' }] } });
});

await run('skips empty event-stream messages before data payloads', async () => {
  const parsed = await readMcpJsonResponse(response(': keep-alive\n\n\ndata: [DONE]\n\n\ndata: {"result":{"done":true}}\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }));
  assert.deepEqual(parsed, { result: { done: true } });
});

await run('parses event-stream data fields with leading whitespace', async () => {
  const parsed = await readMcpJsonResponse(response(' event: message\n data: {"result":{"content":[{"text":"ok"}]}}\n\n', {
    status: 200,
    headers: { 'content-type': 'text/event-stream' },
  }));
  assert.deepEqual(parsed, { result: { content: [{ text: 'ok' }] } });
});

await run('rejects successful non-object JSON responses', async () => {
  await assert.rejects(
    () => readMcpJsonResponse(response('[]', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
    /expected a JSON object/,
  );
});

await run('uses Starlink wording for successful non-JSON responses', async () => {
  await assert.rejects(
    () => readMcpJsonResponse(response('not json', {
      status: 200,
      headers: { 'content-type': 'application/json' },
    })),
    /Starlink returned a non-JSON response/,
  );
});
