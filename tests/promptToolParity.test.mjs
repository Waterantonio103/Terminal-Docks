import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const root = resolve('.');
const serverPath = resolve(root, 'mcp-server/server.mjs');
const promptPath = resolve(root, 'src/lib/buildPrompt.ts');
const agentsPath = resolve(root, 'src/config/agents.json');
const launcherPath = resolve(root, 'src/components/Launcher/LauncherPane.tsx');

const serverSource = readFileSync(serverPath, 'utf8');
const promptSource = readFileSync(promptPath, 'utf8');
const agentsSource = readFileSync(agentsPath, 'utf8');
const launcherSource = readFileSync(launcherPath, 'utf8');

const registeredTools = new Set(
  [...serverSource.matchAll(/server\.registerTool\('([^']+)'/g)].map((match) => match[1]),
);

const toolLikeToken = /^[a-z]+(?:_[a-z]+)+$/;
const referencedTools = new Set();
for (const source of [promptSource, agentsSource, launcherSource]) {
  for (const match of source.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim();
    if (toolLikeToken.test(token)) {
      referencedTools.add(token);
    }
  }
}

const ignored = new Set([
  'from_role',
  'target_role',
  'from_node_id',
  'target_node_id',
]);

const missing = [...referencedTools]
  .filter((toolName) => !ignored.has(toolName))
  .filter((toolName) => !registeredTools.has(toolName))
  .sort();

assert.deepEqual(
  missing,
  [],
  `Prompt/config tool references are not registered in MCP server: ${missing.join(', ')}`,
);

console.log('PASS promptToolParity');
