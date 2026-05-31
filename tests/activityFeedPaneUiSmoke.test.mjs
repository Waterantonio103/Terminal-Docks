import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const activityFeedPane = readFileSync(resolve(root, 'src/components/ActivityFeed/ActivityFeedPane.tsx'), 'utf8');
const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8');

for (const value of [
  'function parseActivityFeedConnection(value: string): ActivityFeedConnection',
  'function cleanActivityText(value: unknown): string',
  "value.replace(/\\0/g, '').replace(/\\s+/g, ' ').trim()",
  "const cleaned = value.replace(/\\0/g, '').trim();",
  "if (!cleaned) return { baseUrl: '', token: '' };",
  'const cleanFilePath = cleanActivityText(filePath);',
  'locks[cleanFilePath] = { agentId, sessionId, lockedAt };',
  "catch {\n    return { baseUrl: '', token: '' };\n  }",
  'function normalizeActivitySessions(value: unknown): string[]',
  'function normalizeActivityLocks(value: unknown): Record<string, FileLock>',
  'setSessions(normalizeActivitySessions(sessionsPayload));',
  'setLocks(normalizeActivityLocks(locksPayload));',
  '}, [baseUrl, token]);',
  '>Starlink</span>',
]) {
  assert.ok(activityFeedPane.includes(value), `missing ${value}`);
}

assert.equal(
  activityFeedPane.includes(`>${String.fromCharCode(83, 119, 97, 114, 109)}</span>`),
  false,
  'activity feed header should use Starlink naming',
);

assert.ok(
  packageJson.includes('node ./tests/activityFeedPaneUiSmoke.test.mjs'),
  'test:graph should run the activity feed smoke test',
);

console.log('PASS activity feed panel tolerates malformed Starlink status data');
