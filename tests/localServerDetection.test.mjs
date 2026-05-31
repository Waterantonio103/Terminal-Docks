import assert from 'node:assert/strict';
import {
  cleanLocalServerUrlInput,
  detectLocalServerUrls,
  isLoopbackLocalHostname,
  isLocalServerUrl,
  isPrivateIpv4Hostname,
  normalizeLocalServerHostname,
  normalizeLocalServerUrl,
} from '../.tmp-tests/lib/localServerDetection.js';

assert.equal(cleanLocalServerUrlInput(' [http://localhost:5173/app/]. '), 'http://localhost:5173/app/');
assert.equal(cleanLocalServerUrlInput('[::1]:1420/'), '[::1]:1420/');
assert.equal(cleanLocalServerUrlInput('[http://[::1]:1420/app/]'), 'http://[::1]:1420/app/');
assert.equal(normalizeLocalServerUrl(' [http://localhost:5173/app/]. '), 'http://localhost:5173/app');
assert.equal(normalizeLocalServerUrl('localhost:5173/'), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl(' localhost:5173\u0000 '), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl('HTTP://LOCALHOST:5173/'), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl('http://LOCALHOST:5173///'), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl('http://LOCALHOST:5173/app///'), 'http://localhost:5173/app');
assert.equal(normalizeLocalServerUrl('http://LOCALHOST:5173/app]'), 'http://localhost:5173/app');
assert.equal(normalizeLocalServerUrl('http://user:pass@localhost:5173/app'), 'http://localhost:5173/app');
assert.equal(normalizeLocalServerUrl('http://127.0.0.1:8000/app.'), 'http://127.0.0.1:8000/app');
assert.equal(normalizeLocalServerUrl('http://localhost:5173:'), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl('http://localhost:5173!'), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl('[http://localhost:5173/app/]'), 'http://localhost:5173/app');
assert.equal(normalizeLocalServerUrl('{http://localhost:5173/app/}'), 'http://localhost:5173/app');
assert.equal(normalizeLocalServerUrl('http://localhost:5173/app}'), 'http://localhost:5173/app');
assert.equal(normalizeLocalServerUrl('<http://[::1]:1420/>'), 'http://[::1]:1420');
assert.equal(normalizeLocalServerUrl('http://[::1]'), 'http://[::1]');
assert.equal(normalizeLocalServerUrl('http://[::1].'), 'http://[::1]');
assert.equal(normalizeLocalServerUrl('<http://[::1]>'), 'http://[::1]');
assert.equal(normalizeLocalServerUrl('\u001b[36mhttp://localhost:5173/\u001b[39m'), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl('http://local\u001bchost:5173/'), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl('0.0.0.0:4173'), 'http://localhost:4173');
assert.equal(normalizeLocalServerUrl('0.0.0.0.:4173'), 'http://localhost:4173');
assert.equal(normalizeLocalServerUrl('[::]:3000'), 'http://localhost:3000');
assert.equal(normalizeLocalServerUrl('http://[::]:3000/'), 'http://localhost:3000');
assert.equal(normalizeLocalServerUrl('http://localhost.:5173/'), 'http://localhost:5173');
assert.equal(normalizeLocalServerUrl('docs.localhost.:8080/help'), 'http://docs.localhost:8080/help');
assert.equal(normalizeLocalServerHostname('LOCALHOST'), 'localhost');
assert.equal(normalizeLocalServerHostname('LOCALHOST.'), 'localhost');
assert.equal(normalizeLocalServerHostname(' \u001b[36mLOCAL\u0000HOST\u001b[39m '), 'localhost');
assert.equal(normalizeLocalServerHostname('::1'), '[::1]');
assert.equal(isLoopbackLocalHostname('LOCALHOST'), true);
assert.equal(isLoopbackLocalHostname(' \u001b[36m127.0.0.1\u001b[39m '), true);
assert.equal(isLoopbackLocalHostname('::1'), true);
assert.equal(isLoopbackLocalHostname('127.0.0.2'), true);
assert.equal(isLoopbackLocalHostname('127.10.20.30'), true);
assert.equal(isLoopbackLocalHostname('127.0.0.256'), false);
assert.equal(isLoopbackLocalHostname('127.0.0.-1'), false);
assert.equal(isLoopbackLocalHostname('127..0.1'), false);
assert.equal(isLoopbackLocalHostname('192.168.1.25'), false);
assert.equal(isPrivateIpv4Hostname('192.168.1.25'), true);
assert.equal(isPrivateIpv4Hostname(' \u001b[36m192.168.1.25\u001b[39m '), true);
assert.equal(isPrivateIpv4Hostname('192.168..1'), false);
assert.equal(isPrivateIpv4Hostname('172.32.1.25'), false);
assert.equal(isLocalServerUrl('localhost:5173'), true);
assert.equal(isLocalServerUrl('localhost:5173\u0000'), true);
assert.equal(isLocalServerUrl('docs.localhost:8080/help'), true);
assert.equal(isLocalServerUrl('http://[::1]:1420'), true);
assert.equal(isLocalServerUrl('http://[::1]'), true);
assert.equal(isLocalServerUrl('http://127.0.0.2:5173'), true);
assert.equal(isLocalServerUrl('http://192.168.1.25:5173'), true);
assert.equal(isLocalServerUrl('http://10.0.0.4:5173'), true);
assert.equal(isLocalServerUrl('http://172.20.1.4:5173'), true);
assert.equal(isLocalServerUrl('http://169.254.10.2:5173'), true);
assert.equal(isLocalServerUrl('http://localhost.:5173'), true);
assert.equal(isLocalServerUrl('http://0.0.0.0.:4173'), true);
assert.equal(isLocalServerUrl('http://192.168.1.25.:5173'), true);
assert.equal(isLocalServerUrl('http://127..0.1:5173'), false);
assert.equal(isLocalServerUrl('http://192.168..1:5173'), false);
assert.equal(isLocalServerUrl('https://example.com'), false);
assert.equal(isLocalServerUrl('http://8.8.8.8:5173'), false);

const log = `
  VITE ready at http://localhost:5173/
  Local: localhost:3000
  API listening on 127.0.0.1:8000/api,
  Alternate loopback: http://127.0.0.2:4174/
  Preview: http://0.0.0.0:4173/
  Preview FQDN wildcard: http://0.0.0.0.:4178/
  Docs: docs.localhost:8080/help
  IPv6: [::1]:1420/
  IPv6 wildcard: http://[::]:3001/
  Network: http://192.168.1.25:5173/
  LinkLocal: http://169.254.10.2:5173
  Query: http://localhost:5173?workspace=one
  Hash: localhost:5173#preview
  Markdown: [http://localhost:5174/app]
  Braced: {http://localhost:5176/app/}
  duplicate: http://localhost:5173
  ignore: mylocalhost:9999 and not-localhost:3000 and http://8.8.8.8:5173
  uppercase duplicate: HTTP://LOCALHOST:5173/
  Null: http://localhost:5175\u0000/
  FQDN local: http://localhost.:5179/
  FQDN docs: docs.localhost.:8181/help
  Auth: http://user:pass@localhost:5180/app
`;

assert.deepEqual(detectLocalServerUrls(log), [
  'http://localhost:5173',
  'http://localhost:3000',
  'http://127.0.0.1:8000/api',
  'http://127.0.0.2:4174',
  'http://localhost:4173',
  'http://localhost:4178',
  'http://docs.localhost:8080/help',
  'http://[::1]:1420',
  'http://localhost:3001',
  'http://192.168.1.25:5173',
  'http://169.254.10.2:5173',
  'http://localhost:5173?workspace=one',
  'http://localhost:5173#preview',
  'http://localhost:5174/app',
  'http://localhost:5176/app',
  'http://localhost:5175',
  'http://localhost:5179',
  'http://docs.localhost:8181/help',
  'http://localhost:5180/app',
]);
assert.deepEqual(
  detectLocalServerUrls('\u001b[32mLocal:\u001b[39m \u001b[36mhttp://localhost:5173/\u001b[39m'),
  ['http://localhost:5173'],
);
assert.deepEqual(
  detectLocalServerUrls('Local: http://local\u001bchost:5173/\nAPI: http://127.0.0.1\u001bM:8000/health'),
  ['http://localhost:5173', 'http://127.0.0.1:8000/health'],
);
assert.deepEqual(
  detectLocalServerUrls('\u001b]8;;http://localhost:5173\u001b\\http://localhost:5173\u001b]8;;\u001b\\'),
  ['http://localhost:5173'],
);
assert.deepEqual(
  detectLocalServerUrls('Local: http://local\u0000host:5176/\nAPI: 127.0.0.1:\u00008000/api'),
  ['http://localhost:5176', 'http://127.0.0.1:8000/api'],
);
assert.deepEqual(
  detectLocalServerUrls('Open it here: http://localhost:5177: and http://localhost:5178!'),
  ['http://localhost:5177', 'http://localhost:5178'],
);

console.log('PASS local server detection normalizes dev-server output');
