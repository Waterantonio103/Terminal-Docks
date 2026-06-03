import assert from 'node:assert/strict';
import {
  AGENT_SLASH_COMMANDS,
  buildAgentSlashCommandSuggestions,
  buildPlanPrompt,
  findAgentSlashCommand,
  parseAgentSlashCommand,
  resolveAgentRoleArgument,
  resolveAgentSlashCommand,
  resolveModelArgument,
  slashCommandHelpText,
} from '../.tmp-tests/lib/agentSlashCommands.js';
import {
  parseAgentUsageLimitMessage,
  parseAgentUsageLimits,
  serializeAgentUsageLimitMessage,
} from '../.tmp-tests/lib/agentUsageLimits.js';

assert.ok(AGENT_SLASH_COMMANDS.some(command => command.id === 'model'), 'registry exposes /model');
assert.ok(AGENT_SLASH_COMMANDS.some(command => command.id === 'reasoning'), 'registry exposes /reasoning');
assert.ok(AGENT_SLASH_COMMANDS.some(command => command.id === 'usage'), 'registry exposes /usage');
assert.equal(resolveAgentSlashCommand('m')?.id, 'model');
assert.equal(resolveAgentSlashCommand('effort')?.id, 'reasoning');
assert.equal(resolveAgentSlashCommand('commands')?.id, 'help');
assert.equal(resolveAgentSlashCommand('quota')?.id, 'usage');
assert.equal(resolveAgentSlashCommand('/permission')?.id, 'permission');
assert.equal(resolveAgentSlashCommand('missing'), null);

assert.deepEqual(parseAgentSlashCommand('/model gpt-5.5'), {
  kind: 'command',
  raw: '/model gpt-5.5',
  command: 'model',
  args: 'gpt-5.5',
});
assert.deepEqual(parseAgentSlashCommand('  /plan fix auth'), {
  kind: 'command',
  raw: '/plan fix auth',
  command: 'plan',
  args: 'fix auth',
});
assert.deepEqual(parseAgentSlashCommand('//model should be literal'), {
  kind: 'literal',
  text: '/model should be literal',
});
assert.equal(parseAgentSlashCommand('ask normally'), null);
assert.deepEqual(parseAgentSlashCommand('ask normally /usage'), {
  kind: 'command',
  raw: '/usage',
  command: 'usage',
  args: '',
});
assert.equal(parseAgentSlashCommand('path bla/blo'), null);
assert.equal(findAgentSlashCommand('ask normally /mo')?.start, 13);

const suggestions = buildAgentSlashCommandSuggestions('/mo', { max: 4 });
assert.equal(suggestions[0].id, 'model');
assert.equal(buildAgentSlashCommandSuggestions('ask normally /us', { max: 4 })[0].id, 'usage');
assert.equal(buildAgentSlashCommandSuggestions('path bla/blo', { max: 4 }).length, 0);
assert.ok(buildAgentSlashCommandSuggestions('/', { max: 20 }).length >= 8);

assert.equal(
  resolveModelArgument('5.5', [
    { cli: 'codex', id: 'gpt-5.5', label: 'GPT-5.5', source: 'default' },
  ])?.id,
  'gpt-5.5',
);
assert.equal(
  resolveAgentRoleArgument('review', [{ id: 'review', name: 'Review', role: 'reviewer' }])?.id,
  'review',
);
assert.match(buildPlanPrompt('fix auth'), /fix auth/);
assert.match(slashCommandHelpText(), /\/goal/);
assert.match(slashCommandHelpText(), /\/usage/);

const usageRows = parseAgentUsageLimits([
  'Daily limit: 425 / 1000 used, resets in 12h',
  'weekly-limit: 83% remaining',
  'Monthly usage: 20k remaining of 100k',
  'five-hour-limit: 25% used',
].join('\n'));
assert.deepEqual(
  usageRows.map(row => [row.label, row.percent]),
  [['5-hour limit', 25], ['Daily limit', 43], ['Weekly limit', 17], ['Monthly limit', 80]],
);
assert.equal(usageRows[1].used, 425);
assert.equal(usageRows[1].total, 1000);
assert.equal(usageRows[3].remaining, 20_000);

const usageMessage = serializeAgentUsageLimitMessage({
  kind: 'agent-usage-limits',
  cli: 'codex',
  command: 'usage',
  capturedAt: 1,
  rows: usageRows,
  raw: 'Daily limit: 425 / 1000',
});
assert.equal(parseAgentUsageLimitMessage(usageMessage)?.rows.length, 4);

console.log('PASS agent slash command parser and registry');
