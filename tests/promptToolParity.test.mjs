import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { resolve, join } from 'node:path';

const root = resolve('.');
const toolsDir = resolve(root, 'mcp-server/src/tools');
const serverPath = resolve(root, 'mcp-server/src/server.mjs');
const promptPath = resolve(root, 'src/lib/buildPrompt.ts');
const agentsPath = resolve(root, 'src/config/agents.json');
const launcherPath = resolve(root, 'src/components/Launcher/LauncherPane.tsx');

const serverSource = readFileSync(serverPath, 'utf8');
let registeredToolSource = '';
for (const file of readdirSync(toolsDir)) {
  if (file.endsWith('.mjs')) {
    const source = readFileSync(join(toolsDir, file), 'utf8');
    const registerFn = /export function (register[A-Za-z0-9_]+)\(/.exec(source)?.[1];
    if (registerFn && serverSource.includes(`${registerFn}(server`)) {
      registeredToolSource += source + '\n';
    }
  }
}

const promptSource = readFileSync(promptPath, 'utf8');
const agentsSource = readFileSync(agentsPath, 'utf8');
const launcherSource = readFileSync(launcherPath, 'utf8');

const registeredTools = new Set(
  [...registeredToolSource.matchAll(/server\.registerTool\('([^']+)'/g)].map((match) => match[1]),
);

const toolLikeToken = /^[a-z]+(?:_[a-z]+)+$/;
const referencedTools = new Set();
for (const source of [promptSource, agentsSource, launcherSource]) {
  for (const match of source.matchAll(/`([^`]+)`/g)) {
    const token = match[1].trim().match(/^([a-z]+(?:_[a-z]+)+)(?:\s*\(|$)/)?.[1] ?? '';
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

for (const requiredTool of ['get_workspace_context', 'update_workspace_context', 'write_artifact']) {
  assert.ok(registeredTools.has(requiredTool), `${requiredTool} must be registered for workflow agents`);
}

const agents = JSON.parse(agentsSource);
const byId = Object.fromEntries(agents.agents.map(agent => [agent.id, agent.coreInstructions]));
assert.match(byId.frontend_product, /Product intake owns product-decision coverage only/);
assert.match(byId.frontend_product, /create or patch PRD\.md as the durable product handoff/);
assert.match(byId.frontend_product, /Do not create DESIGN\.md, structure\.md, implementation plans/);
assert.match(byId.frontend_designer, /Designer owns durable UI guidance only/);
assert.match(byId.frontend_designer, /Do not create PRD\.md, structure\.md, implementation plans/);
assert.match(byId.frontend_architect, /Architecture owns implementation-plan coverage only/);
assert.match(byId.frontend_architect, /create or patch structure\.md as the durable implementation handoff/);
assert.match(byId.frontend_architect, /Do not create PRD\.md, DESIGN\.md, visual specs/);
assert.match(byId.frontend_builder, /clear generated project folder or existing app root/);

assert.deepEqual(
  missing,
  [],
  `Prompt/config tool references are not registered in MCP server: ${missing.join(', ')}`,
);

console.log('PASS promptToolParity');
