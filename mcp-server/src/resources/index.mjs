import { db } from '../db/index.mjs';
import { loadAgentRoster } from '../utils/index.mjs';
import { sessions } from '../state.mjs';
import { buildFrontendSpecFramework } from '../utils/frontend-spec-framework.mjs';
import { registerFrontendLibraryResources } from './frontend-library.mjs';
import { ResourceTemplate } from '@modelcontextprotocol/sdk/server/mcp.js';

export function registerResources(server) {
  server.registerResource('mission', new ResourceTemplate('mission://{missionId}', { list: undefined }), {
    title: 'Mission Data',
    description: 'Full record of a mission including graph and status.',
  }, async (_uri, { missionId }) => {
    const row = db.prepare('SELECT * FROM compiled_missions WHERE mission_id = ?').get(missionId);
    return { contents: [{ uri: `mission://${missionId}`, mimeType: 'application/json', text: JSON.stringify(row, null, 2) }] };
  });

  server.registerResource('node', new ResourceTemplate('node://{missionId}/{nodeId}', { list: undefined }), {
    title: 'Node Status',
    description: 'Runtime status of a specific node in a mission.',
  }, async (_uri, { missionId, nodeId }) => {
    const row = db.prepare('SELECT * FROM mission_node_runtime WHERE mission_id = ? AND node_id = ?').get(missionId, nodeId);
    return { contents: [{ uri: `node://${missionId}/${nodeId}`, mimeType: 'application/json', text: JSON.stringify(row, null, 2) }] };
  });

  server.registerResource('artifact', new ResourceTemplate('artifact://{artifactId}', { list: undefined }), {
    title: 'Artifact Content',
    description: 'Read the full content of an artifact.',
  }, async (_uri, { artifactId }) => {
    const row = db.prepare('SELECT * FROM artifacts WHERE id = ?').get(artifactId);
    return { contents: [{ uri: `artifact://${artifactId}`, mimeType: 'application/json', text: JSON.stringify(row, null, 2) }] };
  });

  server.registerResource('agent_roster', 'roster://agents', {
    title: 'Agent Roster',
    description: 'Team roster: defined agent roles and responsibilities.',
  }, async () => ({
    contents: [{ uri: 'roster://agents', mimeType: 'application/json', text: JSON.stringify(loadAgentRoster(), null, 2) }]
  }));

  server.registerResource('active_sessions', 'sessions://live', {
    title: 'Active Sessions',
  }, async () => ({
    contents: [{ uri: 'sessions://live', mimeType: 'application/json', text: JSON.stringify(Object.keys(sessions), null, 2) }]
  }));

  server.registerResource('frontend_spec_framework', 'frontend-spec://framework', {
    title: 'Frontend Spec Framework',
    description: 'Fill-in schemas, category overlays, intake steps, and rubrics for frontend product decisions, DESIGN.md, and implementation-plan context.',
  }, async () => ({
    contents: [{
      uri: 'frontend-spec://framework',
      mimeType: 'application/json',
      text: JSON.stringify(buildFrontendSpecFramework(), null, 2),
    }]
  }));

  registerFrontendLibraryResources(server);
}
