import { z } from 'zod';
import { db } from '../db/index.mjs';
import { makeToolText } from '../utils/index.mjs';
import { fileLocks, fileWaitQueues, sessions, broadcast, messageQueues } from '../state.mjs';
import { writeFileSync, readFileSync, existsSync, mkdirSync } from 'fs';
import { dirname, resolve, isAbsolute, relative, sep } from 'path';

const DEFAULT_LOCK_TTL_MS = 15 * 60 * 1000; // 15 minutes

function isInsideResolvedWorkspace(resolvedPath, resolvedWorkspace) {
  const rel = relative(resolvedWorkspace, resolvedPath);
  return rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function resolveWorkspaceFilePath(filePath, workingDir) {
  const resolvedWorkspace = typeof workingDir === 'string' && workingDir.trim()
    ? resolve(workingDir)
    : null;
  const resolvedPath = isAbsolute(filePath)
    ? resolve(filePath)
    : resolve(resolvedWorkspace ?? process.cwd(), filePath);

  if (resolvedWorkspace && !isInsideResolvedWorkspace(resolvedPath, resolvedWorkspace)) {
    return { ok: false, resolvedPath, error: 'Security Error: Cannot access outside workspace directory.' };
  }

  return { ok: true, resolvedPath };
}

function terminalSessionStatus(status) {
  return ['completed', 'failed', 'cancelled', 'disconnected'].includes(String(status ?? '').toLowerCase());
}

function isLiveSession(sessionId) {
  if (!sessionId) return false;
  const session = sessions[sessionId];
  return Boolean(session) && !terminalSessionStatus(session.status);
}

function normalizeLockTarget(filePath, workingDir) {
  const resolution = resolveWorkspaceFilePath(filePath, workingDir);
  if (!resolution.ok) return resolution;
  return {
    ...resolution,
    lockPath: resolution.resolvedPath,
    displayPath: filePath,
  };
}

function hasSecretLookingContent(content) {
  return /AIza[0-9A-Za-z-_]{35}/.test(content) || /(?:sk-[a-zA-Z0-9]{20,})/.test(content);
}

function clearLock(filePath) {
  delete fileLocks[filePath];
  db.prepare('DELETE FROM file_locks WHERE file_path = ?').run(filePath);
}

function pruneWaitQueue(filePath) {
  const queue = fileWaitQueues[filePath];
  if (!queue) return [];
  const live = queue.filter(next => isLiveSession(next.sessionId));
  if (live.length === 0) {
    delete fileWaitQueues[filePath];
    return [];
  }
  fileWaitQueues[filePath] = live;
  return live;
}

function loadPersistedLock(filePath) {
  if (fileLocks[filePath]) return fileLocks[filePath];

  const persisted = db.prepare("SELECT agent_id, expires_at FROM file_locks WHERE file_path = ?").get(filePath);
  if (!persisted) return null;

  const expiresAt = new Date(persisted.expires_at).getTime();
  if (!Number.isFinite(expiresAt) || expiresAt < Date.now()) {
    clearLock(filePath);
    return null;
  }

  fileLocks[filePath] = {
    agentId: persisted.agent_id,
    sessionId: null,
    lockedAt: Date.now(),
    expiresAt,
  };
  return fileLocks[filePath];
}

function staleLockReason(lock) {
  if (!lock) return 'missing';
  if (lock.expiresAt < Date.now()) return 'expired';
  if (!isLiveSession(lock.sessionId)) return 'owner session is not active';
  return null;
}

/**
 * Cleanup expired locks from DB and in-memory state.
 */
function cleanupExpiredLocks() {
  const now = new Date().toISOString();
  
  // 1. Find expired locks in DB
  const expired = db.prepare("SELECT file_path FROM file_locks WHERE expires_at < ?").all(now);
  
  for (const row of expired) {
    const filePath = row.file_path;
    clearLock(filePath);
    
    // Process queue for the freed file
    processWaitQueue(filePath);
  }
}

/**
 * Process the wait queue for a file path after a lock is released or expired.
 */
function processWaitQueue(filePath) {
  const queue = pruneWaitQueue(filePath);
  let granted = null;
  
  while (queue.length > 0) {
    const next = queue.shift();
    if (!isLiveSession(next.sessionId)) continue; // Skip disconnected agents
    
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
    const message = `[LOCK GRANTED] You now hold the lock on ${filePath}. Expires at ${expiresAt}.`;
    messageQueues[next.sessionId].push({
      from: 'Starlink',
      text: message,
      timestamp: Date.now(),
    });
    if (next.missionId && next.nodeId) {
      db.prepare(
        "INSERT INTO session_log (session_id, event_type, content, mission_id, recipient_node_id) VALUES (?, 'message', ?, ?, ?)"
      ).run('Starlink', message, next.missionId, next.nodeId);
    }
    
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
  
  const lock = loadPersistedLock(filePath);
  if (!lock) return { allowed: false, reason: `No lock held for ${filePath}.` };
  
  const staleReason = staleLockReason(lock);
  if (staleReason) {
    clearLock(filePath);
    processWaitQueue(filePath);
    return { allowed: false, reason: `Lock on ${filePath} is no longer active (${staleReason}).` };
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
    const session = sessions[sid];
    const pathResolution = normalizeLockTarget(filePath, session?.workingDir);
    
    if (!pathResolution.ok) {
      return { isError: true, content: [{ type: 'text', text: pathResolution.error }] };
    }

    if (hasSecretLookingContent(content)) {
      return { isError: true, content: [{ type: 'text', text: `Security Error: Secret-looking content detected in write.` }] };
    }

    const graphScoped = Boolean(missionId || nodeId);
    const ownerId = graphScoped ? `mission:${missionId}:node:${nodeId}` : (agentId?.trim() ?? sid ?? 'unknown');
    
    const verification = verifyLockOwnership(pathResolution.lockPath, ownerId, sid);
    if (!verification.allowed) {
      return { isError: true, content: [{ type: 'text', text: verification.reason }] };
    }

    try {
      mkdirSync(dirname(pathResolution.resolvedPath), { recursive: true });
      writeFileSync(pathResolution.resolvedPath, content);
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
    const session = sessions[sid];
    const pathResolution = normalizeLockTarget(filePath, session?.workingDir);

    if (!pathResolution.ok) {
      return { isError: true, content: [{ type: 'text', text: pathResolution.error }] };
    }

    const graphScoped = Boolean(missionId || nodeId);
    const ownerId = graphScoped ? `mission:${missionId}:node:${nodeId}` : (agentId?.trim() ?? sid ?? 'unknown');
    
    const verification = verifyLockOwnership(pathResolution.lockPath, ownerId, sid);
    if (!verification.allowed) {
      return { isError: true, content: [{ type: 'text', text: verification.reason }] };
    }

    try {
      if (!existsSync(pathResolution.resolvedPath)) {
        return { isError: true, content: [{ type: 'text', text: `File not found: ${filePath}` }] };
      }
      const content = readFileSync(pathResolution.resolvedPath, 'utf8');
      const updated = content.replace(oldString, newString);
      if (updated === content) {
        return { isError: true, content: [{ type: 'text', text: 'Target pattern not found or no changes made.' }] };
      }
      if (hasSecretLookingContent(updated)) {
        return { isError: true, content: [{ type: 'text', text: `Security Error: Secret-looking content detected in patch result.` }] };
      }
      writeFileSync(pathResolution.resolvedPath, updated);
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
    const session = sessions[sid];
    const pathResolution = normalizeLockTarget(filePath, session?.workingDir);
    if (!pathResolution.ok) {
      return { isError: true, content: [{ type: 'text', text: pathResolution.error }] };
    }
    const lockPath = pathResolution.lockPath;

    const graphScoped = Boolean(missionId || nodeId);
    const ownerId = graphScoped ? `mission:${missionId}:node:${nodeId}` : (agentId?.trim() ?? sid ?? 'unknown');

    cleanupExpiredLocks();
    const existing = loadPersistedLock(lockPath);
    const staleReason = staleLockReason(existing);
    if (staleReason) {
      clearLock(lockPath);
    }
    const expiresAt = new Date(Date.now() + DEFAULT_LOCK_TTL_MS).toISOString();

    if (!existing || staleReason) {
      fileLocks[lockPath] = { 
        agentId: ownerId, 
        sessionId: sid, 
        lockedAt: Date.now(),
        expiresAt: Date.now() + DEFAULT_LOCK_TTL_MS
      };
      db.prepare(
        'INSERT INTO file_locks (file_path, agent_id, locked_at, expires_at) VALUES (?, ?, CURRENT_TIMESTAMP, ?) ' +
        'ON CONFLICT(file_path) DO UPDATE SET agent_id = excluded.agent_id, locked_at = CURRENT_TIMESTAMP, expires_at = excluded.expires_at'
      ).run(lockPath, ownerId, expiresAt);
      broadcast('Starlink', 'lock_update', 'lock_update');
      return { content: [{ type: 'text', text: `Lock acquired: ${filePath}. Expires at ${expiresAt}` }] };
    }

    if (existing.agentId === ownerId) {
      // Renew lock
      existing.expiresAt = Date.now() + DEFAULT_LOCK_TTL_MS;
      db.prepare('UPDATE file_locks SET expires_at = ?, locked_at = CURRENT_TIMESTAMP WHERE file_path = ?').run(expiresAt, lockPath);
      return { content: [{ type: 'text', text: `Lock renewed: ${filePath}. New expiry: ${expiresAt}` }] };
    }

    // Queue for the lock
    const queue = pruneWaitQueue(lockPath);
    if (!fileWaitQueues[lockPath]) fileWaitQueues[lockPath] = queue;
    const alreadyQueued = queue.some(w => w.sessionId === sid);
    if (!alreadyQueued) {
      queue.push({ ownerId, sessionId: sid, missionId: missionId ?? null, nodeId: nodeId ?? null, queuedAt: Date.now() });
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
    const session = sessions[sid];
    const pathResolution = normalizeLockTarget(filePath, session?.workingDir);
    if (!pathResolution.ok) {
      return { isError: true, content: [{ type: 'text', text: pathResolution.error }] };
    }
    const lockPath = pathResolution.lockPath;
    const graphScoped = Boolean(missionId || nodeId);
    const ownerId = graphScoped ? `mission:${missionId}:node:${nodeId}` : (agentId?.trim() ?? sid ?? 'unknown');

    const existing = loadPersistedLock(lockPath);
    if (!existing) return { content: [{ type: 'text', text: `${filePath} was not locked.` }] };
    
    // Allow forced release if the session that held it is gone
    const ownerSessionDead = !isLiveSession(existing.sessionId);
    
    if (existing.agentId !== ownerId && existing.sessionId !== sid && !ownerSessionDead) {
      return { isError: true, content: [{ type: 'text', text: `Cannot unlock: owned by "${existing.agentId}".` }] };
    }

    clearLock(lockPath);

    const granted = processWaitQueue(lockPath);

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
