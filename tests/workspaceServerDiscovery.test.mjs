import assert from 'node:assert/strict';
import {
  discoverWorkspaceServers,
  formatWorkspaceServerLabel,
  shortWorkspaceServerUrl,
} from '../.tmp-tests/lib/workspaceServerDiscovery.js';

const terminalOutput = new Map([
  ['term-1', `
    VITE ready in 300 ms
    Local: http://localhost:5173/
    Network: http://192.168.1.25:5173/
    Duplicate: http://0.0.0.0:5173/
    Public: http://8.8.8.8:5173/
  `],
  ['term-2', 'Docs: docs.localhost:8080/help\nAPI: 127.0.0.1:8000/api'],
]);

const panes = [
  { type: 'preview', title: 'Current preview', data: { url: 'http://localhost:5173/' } },
  { type: 'preview', title: 'External preview', data: { url: 'https://example.com' } },
  { type: 'terminal', title: 'Inline metadata server', data: { url: 'http://localhost:9000/docs' } },
  { type: 'terminal', title: 'Dev server', data: { terminalId: 'term-1' } },
  { type: 'terminal', title: 'Docs terminal', data: { terminalId: 'term-2' } },
  { type: 'terminal', title: 'Missing id', data: {} },
];

const servers = discoverWorkspaceServers(
  panes,
  (terminalId) => terminalOutput.get(terminalId) ?? '',
);

assert.deepEqual(servers, [
  { url: 'http://localhost:9000/docs', label: 'Inline metadata server' },
  { url: 'http://localhost:5173', label: 'Dev server' },
  { url: 'http://docs.localhost:8080/help', label: 'Docs terminal' },
  { url: 'http://127.0.0.1:8000/api', label: 'Docs terminal' },
]);

assert.equal(shortWorkspaceServerUrl('http://localhost:5173/'), 'localhost:5173');
assert.equal(shortWorkspaceServerUrl('http://localhost:5173/?token=abc&view=app&api_key=secret#preview'), 'localhost:5173?token=redacted&view=app&api_key=redacted#preview');
assert.equal(shortWorkspaceServerUrl('http://localhost:5173/?accessToken=abc&refreshToken=def&apiKey=secret&view=app'), 'localhost:5173?accessToken=redacted&refreshToken=redacted&apiKey=redacted&view=app');
assert.equal(shortWorkspaceServerUrl('http://localhost:5173/callback?code=abc&signature=def&sig=ghi&view=app'), 'localhost:5173/callback?code=redacted&signature=redacted&sig=redacted&view=app');
assert.equal(shortWorkspaceServerUrl('http://localhost:5173/callback#access_token=abc&view=app'), 'localhost:5173/callback#access_token=redacted&view=app');
assert.equal(shortWorkspaceServerUrl('http://localhost:5173/callback#/auth?accessToken=abc&view=app'), 'localhost:5173/callback#/auth?accessToken=redacted&view=app');
assert.equal(shortWorkspaceServerUrl('http://localhost:5173/callback#/auth?code=abc&signature=def&view=app'), 'localhost:5173/callback#/auth?code=redacted&signature=redacted&view=app');
assert.equal(formatWorkspaceServerLabel(servers[1]), 'Dev server - localhost:5173');
assert.equal(formatWorkspaceServerLabel({ url: 'http://localhost:5173', label: 'localhost:5173' }), 'localhost:5173');
assert.equal(formatWorkspaceServerLabel({ url: 'http://localhost:5173', label: 'http://0.0.0.0:5173/' }), 'localhost:5173');
assert.equal(formatWorkspaceServerLabel({ url: 'http://localhost:5173', label: 'VITE ready at HTTP://LOCALHOST:5173/' }), 'localhost:5173');
assert.equal(formatWorkspaceServerLabel({ url: 'http://localhost:5173', label: 'Preview LOCALHOST:5173' }), 'localhost:5173');
assert.equal(formatWorkspaceServerLabel({ url: 'http://localhost:5173/?token=abc&view=app', label: 'Started http://localhost:5173/?token=secret' }), 'localhost:5173?token=redacted&view=app');
assert.equal(formatWorkspaceServerLabel({ url: 'http://localhost:5173', label: '  Dev\u0000   server \n preview  ' }), 'Dev server preview - localhost:5173');

assert.deepEqual(
  discoverWorkspaceServers(panes, (terminalId) => terminalOutput.get(terminalId) ?? '', { maxServers: 2 }),
  [
    { url: 'http://localhost:9000/docs', label: 'Inline metadata server' },
    { url: 'http://localhost:5173', label: 'Dev server' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'preview', title: 'Open preview', data: { url: 'http://localhost:5173/' } },
    ],
    () => '',
  ),
  [
    { url: 'http://localhost:5173', label: 'Open preview' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'preview', title: 'Current preview', data: { url: 'http://localhost:5173/' } },
      { type: 'terminal', title: 'Dev server', data: { terminalId: 'term-1' } },
    ],
    terminalId => terminalOutput.get(terminalId) ?? '',
  ),
  [
    { url: 'http://localhost:5173', label: 'Dev server' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Token refresh server', data: { terminalId: 'term-1' } },
      { type: 'preview', title: 'Token preview', data: { url: 'http://localhost:5173/app?token=second&view=preview#access_token=two' } },
    ],
    () => [
      'First: http://localhost:5173/app?token=first&view=preview#access_token=one',
      'Second: http://127.0.0.1:5173/app?token=rotated&view=preview#access_token=rotated',
    ].join('\n'),
  ),
  [
    { url: 'http://localhost:5173/app?token=first&view=preview#access_token=one', label: 'Token refresh server' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'LAN only server', data: { terminalId: 'term-1' } },
    ],
    () => 'Network: http://192.168.1.25:5173/',
  ),
  [
    { url: 'http://192.168.1.25:5173', label: 'LAN only server' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Two LAN servers', data: { terminalId: 'term-1' } },
    ],
    () => 'One: http://192.168.1.25:5173/\nTwo: http://192.168.1.26:5173/',
  ),
  [
    { url: 'http://192.168.1.25:5173', label: 'Two LAN servers' },
    { url: 'http://192.168.1.26:5173', label: 'Two LAN servers' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Private first', data: { terminalId: 'term-1' } },
    ],
    () => 'Network: http://192.168.1.25:5173/\nLocal: http://localhost:5173/',
  ),
  [
    { url: 'http://localhost:5173', label: 'Private first' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Loopback aliases', data: { terminalId: 'term-1' } },
    ],
    () => 'IPv4: http://127.0.0.1:5173/\nAlt: http://127.0.0.2:5173/\nIPv6: http://[::1]:5173/\nLocal: http://localhost:5173/',
  ),
  [
    { url: 'http://localhost:5173', label: 'Loopback aliases' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Alternate loopback only', data: { terminalId: 'term-1' } },
    ],
    () => 'Alt: http://127.0.0.2:5174/',
  ),
  [
    { url: 'http://127.0.0.2:5174', label: 'Alternate loopback only' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'IPv6 then IPv4', data: { terminalId: 'term-1' } },
    ],
    () => 'IPv6: http://[::1]:1420/\nIPv4: http://127.0.0.1:1420/',
  ),
  [
    { url: 'http://127.0.0.1:1420', label: 'IPv6 then IPv4' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Capped private first', data: { terminalId: 'term-1' } },
    ],
    () => 'Network: http://192.168.1.25:5173/\nLocal: http://localhost:5173/\nDocs: http://localhost:8080/',
    { maxServers: 1 },
  ),
  [
    { url: 'http://localhost:5173', label: 'Capped private first' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Invalid cap', data: { terminalId: 'term-1' } },
    ],
    () => 'One: http://localhost:5173/\nTwo: http://localhost:8080/\nThree: http://localhost:9000/',
    { maxServers: Number.NaN },
  ),
  [
    { url: 'http://localhost:5173', label: 'Invalid cap' },
    { url: 'http://localhost:8080', label: 'Invalid cap' },
    { url: 'http://localhost:9000', label: 'Invalid cap' },
  ],
);

assert.equal(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Large noisy log', data: { terminalId: 'term-1' } },
    ],
    () => Array.from({ length: 40 }, (_, index) => `Local ${index}: http://localhost:${3200 + index}/`).join('\n'),
    { maxServers: 1000 },
  ).length,
  24,
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      null,
      'terminal',
      { title: 'Missing type', data: { url: 'http://localhost:2999/' } },
      { type: 'terminal', title: 'Broken terminal', data: { terminalId: 'broken-term' } },
      { type: 'terminal', title: 'Malformed terminal', data: { terminalId: 'malformed-term' } },
      { type: 'terminal', title: 'Healthy terminal', data: { terminalId: 'healthy-term' } },
    ],
    terminalId => {
      if (terminalId === 'broken-term') throw new Error('tail unavailable');
      if (terminalId === 'malformed-term') return null;
      return 'Healthy: http://localhost:3000/';
    },
  ),
  [
    { url: 'http://localhost:3000', label: 'Healthy terminal' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    null,
    () => 'Local: http://localhost:2998/',
  ),
  [],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Dirty terminal id', data: { terminalId: ' healthy-term\u0000 ' } },
      { type: 'terminal', title: 'Blank terminal id', data: { terminalId: ' \u0000 ' } },
    ],
    terminalId => {
      assert.equal(terminalId, 'healthy-term');
      return 'Healthy: http://localhost:3001/';
    },
  ),
  [
    { url: 'http://localhost:3001', label: 'Dirty terminal id' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: '  Dev\u0000   server \n preview  ', data: { terminalId: 'term-1' } },
    ],
    () => 'Local: http://localhost:4321/',
  ),
  [
    { url: 'http://localhost:4321', label: 'Dev server preview' },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'x'.repeat(120), data: { terminalId: 'term-1' } },
    ],
    () => 'Local: http://localhost:4322/',
  ),
  [
    { url: 'http://localhost:4322', label: 'x'.repeat(80) },
  ],
);

assert.deepEqual(
  discoverWorkspaceServers(
    [
      { type: 'terminal', title: 'Terminal 1', data: { terminalId: 'term-1' } },
      { type: 'terminal', title: 'Terminal', data: { terminalId: 'term-2' } },
      { type: 'terminal', title: 'Dev server', data: { terminalId: 'term-3' } },
    ],
    terminalId => ({
      'term-1': 'Local: http://localhost:3101/',
      'term-2': 'Local: http://localhost:3102/',
      'term-3': 'Local: http://localhost:3103/',
    }[terminalId] ?? ''),
  ),
  [
    { url: 'http://localhost:3101', label: 'Terminal server' },
    { url: 'http://localhost:3102', label: 'Terminal server' },
    { url: 'http://localhost:3103', label: 'Dev server' },
  ],
);

console.log('PASS workspace server discovery dedupes local server aliases and caps preview targets');
