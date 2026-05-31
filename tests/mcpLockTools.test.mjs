import assert from 'node:assert/strict';
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const tempRoot = mkdtempSync(join(tmpdir(), 'comet-ai-lock-tools-'));
process.env.MCP_DB_PATH = join(tempRoot, 'tasks.db');
let dbHandle = null;

try {
  const { initDb, db } = await import('../mcp-server/src/db/index.mjs');
  const { registerLockTools } = await import('../mcp-server/src/tools/locks.mjs');
  const { sessions, fileLocks } = await import('../mcp-server/src/state.mjs');

  dbHandle = db;
  initDb();

  const workspaceDir = join(tempRoot, 'workspace');
  sessions['session-lock'] = {
    role: 'frontend_builder',
    agentId: 'frontend_builder',
    workingDir: workspaceDir,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
  };

  const tools = new Map();
  const server = {
    registerTool(name, config, handler) {
      tools.set(name, { config, handler });
    },
  };
  let currentSessionId = 'session-lock';
  registerLockTools(server, () => currentSessionId);

  const relativeFile = `starv-site-lock-test-${Date.now()}/index.html`;
  const lock = await tools.get('request_file_lock').handler({
    missionId: 'mission-1',
    nodeId: 'builder-1',
    agentId: 'frontend_builder',
    filePath: relativeFile,
  });
  assert.equal(lock.isError, undefined);

  const write = await tools.get('validated_write').handler({
    missionId: 'mission-1',
    nodeId: 'builder-1',
    agentId: 'frontend_builder',
    filePath: relativeFile,
    content: '<!doctype html><title>StarV</title>',
  });
  assert.equal(write.isError, undefined);

  const workspaceFile = join(workspaceDir, relativeFile);
  assert.equal(existsSync(workspaceFile), true);
  assert.equal(readFileSync(workspaceFile, 'utf8'), '<!doctype html><title>StarV</title>');

  const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
  assert.equal(existsSync(join(repoRoot, 'mcp-server', relativeFile)), false);

  const patch = await tools.get('validated_patch').handler({
    missionId: 'mission-1',
    nodeId: 'builder-1',
    agentId: 'frontend_builder',
    filePath: relativeFile,
    oldString: 'StarV',
    newString: 'StarV App',
  });
  assert.equal(patch.isError, undefined);
  assert.match(readFileSync(workspaceFile, 'utf8'), /StarV App/);

  const escape = await tools.get('request_file_lock').handler({
    filePath: '../outside.txt',
  });
  assert.equal(escape.isError, true);

  sessions['session-lock-2'] = {
    role: 'frontend_builder',
    agentId: 'frontend_builder',
    workingDir: workspaceDir,
    connectedAt: Date.now(),
    updatedAt: Date.now(),
  };
  const queuedFile = `starv-site-lock-test-${Date.now()}/queued.css`;
  currentSessionId = 'session-lock';
  const firstLock = await tools.get('request_file_lock').handler({
    missionId: 'mission-1',
    nodeId: 'builder-core',
    filePath: queuedFile,
  });
  assert.equal(firstLock.isError, undefined);

  currentSessionId = 'session-lock-2';
  const queuedLock = await tools.get('request_file_lock').handler({
    missionId: 'mission-1',
    nodeId: 'builder-responsive',
    filePath: queuedFile,
  });
  assert.match(queuedLock.content[0].text, /queued at position 1/);

  currentSessionId = 'session-lock';
  const release = await tools.get('release_file_lock').handler({
    missionId: 'mission-1',
    nodeId: 'builder-core',
    filePath: queuedFile,
  });
  assert.match(release.content[0].text, /Auto-granted/);

  const lockGrantMessage = db.prepare(
    "SELECT content FROM session_log WHERE mission_id = ? AND recipient_node_id = ? AND event_type = 'message' ORDER BY id DESC LIMIT 1"
  ).get('mission-1', 'builder-responsive');
  assert.match(lockGrantMessage.content, /\[LOCK GRANTED\]/);

  const canonicalFile = `starv-site-lock-test-${Date.now()}/canonical.txt`;
  const canonicalAbsolute = join(workspaceDir, canonicalFile);
  currentSessionId = 'session-lock';
  const absoluteLock = await tools.get('request_file_lock').handler({
    missionId: 'mission-1',
    nodeId: 'builder-core',
    filePath: canonicalAbsolute,
  });
  assert.equal(absoluteLock.isError, undefined);

  const relativeWrite = await tools.get('validated_write').handler({
    missionId: 'mission-1',
    nodeId: 'builder-core',
    filePath: canonicalFile,
    content: 'same canonical file',
  });
  assert.equal(relativeWrite.isError, undefined);
  assert.equal(readFileSync(canonicalAbsolute, 'utf8'), 'same canonical file');

  currentSessionId = 'session-lock-2';
  const relativeCanonicalLock = await tools.get('request_file_lock').handler({
    missionId: 'mission-1',
    nodeId: 'builder-responsive',
    filePath: canonicalFile,
  });
  assert.match(relativeCanonicalLock.content[0].text, /queued at position 1/);

  const staleAbsolute = join(workspaceDir, `starv-site-lock-test-${Date.now()}/stale.txt`);
  delete fileLocks[staleAbsolute];
  db.prepare(
    "INSERT INTO file_locks (file_path, agent_id, locked_at, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP, datetime('now', '+15 minutes'))"
  ).run(staleAbsolute, 'mission:old-aborted-mission:node:frontend_product');
  currentSessionId = 'session-lock';
  const staleRecovered = await tools.get('request_file_lock').handler({
    missionId: 'mission-2',
    nodeId: 'frontend_product',
    filePath: staleAbsolute,
  });
  assert.match(staleRecovered.content[0].text, /Lock acquired/);
  const staleRow = db.prepare('SELECT agent_id FROM file_locks WHERE file_path = ?').get(staleAbsolute);
  assert.equal(staleRow.agent_id, 'mission:mission-2:node:frontend_product');

  console.log('PASS MCP lock tools resolve relative writes, canonicalize paths, and reap stale owners');
} finally {
  try { dbHandle?.close(); } catch {}
  rmSync(tempRoot, { recursive: true, force: true });
}
