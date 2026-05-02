import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText } from '../utils/index.mjs';
import { fileLocks, fileWaitQueues, sessions, broadcast, messageQueues } from '../state.mjs';
import { writeFileSync, readFileSync, existsSync } from 'fs';
import { resolve, isAbsolute, relative } from 'path';

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes

/**
 * Cleanup expired locks from DB and in-memory state.
 */
function cleanupExpiredLocks() {
  const now = new Date().toISOString();
  
  // 1. Find expired locks in DB
  const expired = db.prepare("SELECT file_path FROM file_locks WHERE expires_at < ?").all(now);
  
  for (const row of expired) {
    const filePath = row.file_path;
    delete fileLocks[filePath];
    db.prepare('DELETE FROM file_locks WHERE file_path = ?').run(filePath);
    
    // Process queue for the freed file
    processWaitQueue(filePath);
  }
}

/**
 * Process the wait queue for a file path after a lock is released or expired.
 */
function processWaitQueue(filePath) {
  const queue = fileWaitQueues[filePath] ?? [];
  let granted = null;
  
  while (queue.length > 0) {
    const next = queue.shift();
    if (!sessions[next.sessionId]) continue; // Skip disconnected agents
    
    const expiresAt = new Date(Date.now() + DEFAULT_LOCK_TTL_MS).toISOString();
    
    fileLocks[filePath] = { 
      agentId: next.ownerId, 
      sessionId: next.sessionId, 
      lockedAt: Date.now(),
      expiresAt: Date.now() + DEFAULT_LOCK_TTL_MS
    };
    
    db.prepare(
      'INSERT INTO file_locks (file_path, agent_id, locked_at, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP, ?) ' +
      'ON CONFLICT(file_path) DO UPDATE SET agent_id = excluded.agent_id, locked_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at'
    ).run(filePath, next.ownerId, expiresAt);
    
    if (!messageQueues[next.sessionId]) messageQueues[next.sessionId] = [];
    messageQueues[next.sessionId].push({
      from: 'Starlink',
      text: `[LOCK GRANTED] You now hold the lock on ${filePath}. Expires at ${expiresAt}.`,
      timestamp: Date.now(),
    });
    
    granted = next;
    break;
  }
  
  if (queue.length === 0) delete fileWaitQueues[filePath];
  broadcast('Starlink', 'lock_update', 'lock_update');
  return granted;
}

/**
 * Ensures the lock is held by the caller and not expired.
 */
function verifyLockOwnership(filePath, ownerId, sid) {
  cleanupExpiredLocks();
  
  // Sync in-memory if missing
  if (!fileLocks[filePath]) {
    const persisted = db.prepare("SELECT agent_id, expires_at FROM file_locks WHERE file_path = ?").get(filePath);
    if (persisted) {
      fileLocks[filePath] = { 
        agentId: persisted.agent_id, 
        sessionId: null, // Session ID might be lost on server restart, but agentId persists
        lockedAt: Date.now(),
        expiresAt: new Date(persisted.expires_at).getTime()
      };
    }
  }

  const lock = fileLocks[filePath];
  if (!lock) return { allowed: false, reason: `No lock held for ${filePath}.` };
  
  const now = Date.now();
  if (lock.expiresAt < now) {
    delete fileLocks[filePath];
    db.prepare('DELETE FROM file_locks WHERE file_path = ?').run(filePath);
    processWaitQueue(filePath);
    return { allowed: false, reason: `Lock on ${filePath} has expired.` };
  }

  if (lock.agentId !== ownerId && lock.sessionId !== sid) {
    return { allowed: false, reason: `Access denied: lock on ${filePath} is held by "${lock.agentId}".` };
  }

  return { allowed: true };
}

export function registerLockTools(server, getSessionId) {
  server.registerTool('validated_write', {
    title: 'Validated Write',
    description: 'Enforced file write tool. Requires holding an active file lock.',
    inputSchema: {
      filePath: z.string().min(1),
      content: z.string(),
      missionId: z.string().optional(),
      nodeId: z.string().optional(),
      agentId: z.string().optional(),
    }
  }, async ({ filePath, content, missionId, nodeId, agentId }) => {
    const sid = getSessionId();
    const graphScoped = Boolean(missionId || nodeId);
    const ownerId = graphScoped ? `mission:${missionId}:node:${nodeId}` : (agentId?.trim() ?? sid ?? 'unknown');
    
    const verification = verifyLockOwnership(filePath, ownerId, sid);
    if (!verification.allowed) {
      return { isError: true, content: [{ type: 'text', text: verification.reason }] };
    }

    try {
      writeFileSync(filePath, content);
      return { content: [{ type: 'text', text: `Successfully wrote to ${filePath}` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to write file: ${err.message}` }] };
    }
  });

  server.registerTool('validated_patch', {
    title: 'Validated Patch',
    description: 'Enforced file patch tool. Requires holding an active file lock.',
    inputSchema: {
      filePath: z.string().min(1),
      oldString: z.string(),
      newString: z.string(),
      missionId: z.string().optional(),
      nodeId: z.string().optional(),
      agentId: z.string().optional(),
    }
  }, async ({ filePath, oldString, newString, missionId, nodeId, agentId }) => {
    const sid = getSessionId();
    const graphScoped = Boolean(missionId || nodeId);
    const ownerId = graphScoped ? `mission:${missionId}:node:${nodeId}` : (agentId?.trim() ?? sid ?? 'unknown');
    
    const verification = verifyLockOwnership(filePath, ownerId, sid);
    if (!verification.allowed) {
      return { isError: true, content: [{ type: 'text', text: verification.reason }] };
    }

    try {
      if (!existsSync(filePath)) {
        return { isError: true, content: [{ type: 'text', text: `File not found: ${filePath}` }] };
      }
      const content = readFileSync(filePath, 'utf8');
      const updated = content.replace(oldString, newString);
      if (updated === content) {
        return { isError: true, content: [{ type: 'text', text: 'Target pattern not found or no changes made.' }] };
      }
      writeFileSync(filePath, updated);
      return { content: [{ type: 'text', text: `Successfully patched ${filePath}` }] };
    } catch (err) {
      return { isError: true, content: [{ type: 'text', text: `Failed to patch file: ${err.message}` }] };
    }
  });

  server.registerTool('request_file_lock', {
    title: 'Request File Lock',
    description: 'Claim exclusive write access to a file path. Locks expire after 15 minutes.',
    inputSchema: {
      filePath: z.string().min(1),
      missionId: z.string().optional(),
      nodeId: z.string().optional(),
      agentId: z.string().optional(),
    }
  }, async ({ filePath, missionId, nodeId, agentId }) => {
    const sid = getSessionId();
    const graphScoped = Boolean(missionId || nodeId);
    const ownerId = graphScoped ? `mission:${missionId}:node:${nodeId}` : (agentId?.trim() ?? sid ?? 'unknown');

    cleanupExpiredLocks();
    
    // Sync in-memory if missing
    if (!fileLocks[filePath]) {
      const persisted = db.prepare("SELECT agent_id, expires_at FROM file_locks WHERE file_path = ?").get(filePath);
      if (persisted) {
        fileLocks[filePath] = { 
          agentId: persisted.agent_id, 
          sessionId: null, 
          lockedAt: Date.now(),
          expiresAt: new Date(persisted.expires_at).getTime()
        };
      }
    }

    const existing = fileLocks[filePath];
    const expiresAt = new Date(Date.now() + DEFAULT_LOCK_TTL_MS).toISOString();

    if (!existing) {
      fileLocks[filePath] = { 
        agentId: ownerId, 
        sessionId: sid, 
        lockedAt: Date.now(),
        expiresAt: Date.now() + DEFAULT_LOCK_TTL_MS
      };
      db.prepare(
        'INSERT INTO file_locks (file_path, agent_id, locked_at, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP, ?) ' +
        'ON CONFLICT(file_path) DO UPDATE SET agent_id = excluded.agent_id, locked_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at'
      ).run(filePath, ownerId, expiresAt);
      broadcast('Starlink', 'lock_update', 'lock_update');
      return { content: [{ type: 'text', text: `Lock acquired: ${filePath}. Expires at ${expiresAt}` }] };
    }

    if (existing.agentId === ownerId) {
      // Renew lock
      existing.expiresAt = Date.now() + DEFAULT_LOCK_TTL_MS;
      db.prepare('UPDATE file_locks SET expires_at = ?, locked_at = CURRENT_TIMESTAMP WHERE file_path = ?').run(expiresAt, filePath);
      return { content: [{ type: 'text', text: `Lock renewed: ${filePath}. New expiry: ${expiresAt}` }] };
    }

    // Queue for the lock
    if (!fileWaitQueues[filePath]) fileWaitQueues[filePath] = [];
    const queue = fileWaitQueues[filePath];
    const alreadyQueued = queue.some(w => w.sessionId === sid);
    if (!alreadyQueued) {
      queue.push({ ownerId, sessionId: sid, queuedAt: Date.now() });
    }
    const position = queue.findIndex(w => w.sessionId === sid) + 1;

    if (existing.sessionId && sessions[existing.sessionId]) {
      if (!messageQueues[existing.sessionId]) messageQueues[existing.sessionId] = [];
      messageQueues[existing.sessionId].push({
        from: 'Starlink',
        text: `Agent "${ownerId}" is queued for your lock on: ${filePath}.`,
        timestamp: Date.now(),
      });
    }
    return { content: [{ type: 'text', text: `Locked by "${existing.agentId}". You are queued at position ${position}.` }] };
  });

  server.registerTool('release_file_lock', {
    title: 'Release File Lock',
    description: 'Release a held file lock.',
    inputSchema: {
      filePath: z.string().min(1),
      missionId: z.string().optional(),
      nodeId: z.string().optional(),
      agentId: z.string().optional(),
    }
  }, async ({ filePath, missionId, nodeId, agentId }) => {
    const sid = getSessionId();
    const graphScoped = Boolean(missionId || nodeId);
    const ownerId = graphScoped ? `mission:${missionId}:node:${nodeId}` : (agentId?.trim() ?? sid ?? 'unknown');

    const existing = fileLocks[filePath];
    if (!existing) return { content: [{ type: 'text', text: `${filePath} was not locked.` }] };
    
    // Allow forced release if the session that held it is gone
    const ownerSessionDead = existing.sessionId && !sessions[existing.sessionId];
    
    if (existing.agentId !== ownerId && existing.sessionId !== sid && !ownerSessionDead) {
      return { isError: true, content: [{ type: 'text', text: `Cannot unlock: owned by "${existing.agentId}".` }] };
    }

    delete fileLocks[filePath];
    db.prepare('DELETE FROM file_locks WHERE file_path = ?').run(filePath);

    const granted = processWaitQueue(filePath);

    return { content: [{ type: 'text', text: `Lock released: ${filePath}.${granted ? ` Auto-granted to "${granted.ownerId}".` : ''}` }] };
  });

  server.registerTool('list_active_locks', {
    title: 'List Active Locks',
    description: 'List all currently locked files with their owners and expiry times.',
    inputSchema: {}
  }, async () => {
    cleanupExpiredLocks();
    const rows = db.prepare(
      "SELECT file_path, agent_id, datetime(locked_at, 'localtime') AS locked_at, datetime(expires_at, 'localtime') AS expires_at FROM file_locks ORDER BY file_path"
    ).all();
    if (rows.length === 0) return { content: [{ type: 'text', text: 'No files currently locked.' }] };
    const text = rows.map(row => `${row.file_path} (owner: ${row.agent_id}, locked: ${row.locked_at}, expires: ${row.expires_at})`).join('\n');
    return { content: [{ type: 'text', text }] };
  });
}
