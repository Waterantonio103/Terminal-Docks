#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { ControlPlaneClient } from './control-plane-client.mjs';

function usage(exitCode = 0) {
  const out = exitCode === 0 ? console.log : console.error;
  out(`Terminal Docks control plane

Usage:
  node scripts/tdctl.mjs workflow launch --mission <compiled-mission.json> [--mission-id <id>]
  node scripts/tdctl.mjs run headless --request <start-agent-run.json>
  node scripts/tdctl.mjs sessions list [--mission-id <id>]
  node scripts/tdctl.mjs sessions inspect <run-id>
  node scripts/tdctl.mjs sessions kill <run-id> [--reason <text>]

Environment:
  TD_BACKEND_BIN              Backend binary path. Defaults to backend/target/debug/backend.
  TD_BACKEND_CWD              Backend working directory. Defaults to the repository root.
  TDCTL_RPC_TIMEOUT_MS        Per-command timeout in ms. Defaults to 30000.
  TDCTL_DEBUG=1               Print backend stderr and non-JSON stdout.`);
  process.exit(exitCode);
}

function optionValue(args, name) {
  const index = args.indexOf(name);
  if (index === -1) return null;
  const value = args[index + 1];
  if (!value || value.startsWith('--')) throw new Error(`${name} requires a value.`);
  return value;
}

function readJsonFile(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function printJson(value) {
  console.log(JSON.stringify(value, null, 2));
}

async function main(argv) {
  if (argv.length === 0 || argv.includes('--help') || argv.includes('-h')) usage(0);

  const [area, command, ...rest] = argv;
  const client = new ControlPlaneClient();
  try {
    if (area === 'workflow' && command === 'launch') {
      const missionPath = optionValue(rest, '--mission');
      if (!missionPath) throw new Error('workflow launch requires --mission <compiled-mission.json>.');
      const graph = readJsonFile(missionPath);
      const missionId = optionValue(rest, '--mission-id') ?? graph.missionId;
      if (!missionId) throw new Error('workflow launch requires --mission-id or missionId in the graph JSON.');
      printJson(await client.launchWorkflow(missionId, graph));
      return;
    }

    if (area === 'run' && command === 'headless') {
      const requestPath = optionValue(rest, '--request');
      if (!requestPath) throw new Error('run headless requires --request <start-agent-run.json>.');
      printJson(await client.startHeadlessRun(readJsonFile(requestPath)));
      return;
    }

    if (area === 'sessions' && command === 'list') {
      printJson(await client.listSessions({ missionId: optionValue(rest, '--mission-id') }));
      return;
    }

    if (area === 'sessions' && command === 'inspect') {
      const runId = rest[0];
      if (!runId) throw new Error('sessions inspect requires <run-id>.');
      printJson(await client.inspectSession(runId));
      return;
    }

    if (area === 'sessions' && command === 'kill') {
      const runId = rest[0];
      if (!runId) throw new Error('sessions kill requires <run-id>.');
      printJson(await client.killSession(runId, optionValue(rest, '--reason') ?? undefined));
      return;
    }

    usage(1);
  } finally {
    client.close();
  }
}

main(process.argv.slice(2)).catch(error => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
