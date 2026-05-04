function parseDbJson(value, fallback) {
  if (typeof value !== 'string') return fallback;
  try {
    return JSON.parse(value);
  } catch {
    return fallback;
  }
}

function agentRunRowToRecord(row) {
  if (!row) return null;
  return {
    runId: row.run_id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    attempt: Number(row.attempt ?? 0),
    sessionId: row.session_id,
    agentId: row.agent_id,
    cli: row.cli,
    executionMode: row.execution_mode,
    cwd: row.cwd ?? null,
    command: row.command,
    args: parseDbJson(row.args_json, []),
    env: parseDbJson(row.env_json, {}),
    promptPath: row.prompt_path ?? null,
    stdoutPath: row.stdout_path ?? null,
    stderrPath: row.stderr_path ?? null,
    transcriptPath: row.transcript_path ?? null,
    status: row.status,
    exitCode: row.exit_code ?? null,
    error: row.error ?? null,
    startedAt: row.started_at ?? null,
    completedAt: row.completed_at ?? null,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

function runtimeSessionRowToRecord(row) {
  if (!row) return null;
  return {
    sessionId: row.session_id,
    agentId: row.agent_id,
    missionId: row.mission_id,
    nodeId: row.node_id,
    attempt: Number(row.attempt ?? 0),
    terminalId: row.terminal_id,
    runId: row.run_id ?? null,
    status: row.status,
    createdAt: row.created_at ?? null,
    updatedAt: row.updated_at ?? null,
  };
}

export function createMcpServiceStore(db) {
  const serviceGroups = Object.freeze([
    'missions',
    'taskInbox',
    'runtimeSessions',
    'agentRuns',
    'fileLocks',
    'workspaceContext',
    'adapters',
    'compatibility',
  ]);

  return {
    serviceGroups,

    logSession(sessionId, eventType, content) {
      db.prepare('INSERT INTO session_log (session_id, event_type, content) VALUES (?, ?, ?)')
        .run(sessionId, eventType, content ?? null);
    },

    loadCompiledMissionRecord(missionId) {
      return db.prepare(
        "SELECT mission_id, graph_id, mission_json, status, datetime(created_at, 'localtime') AS created_at, datetime(updated_at, 'localtime') AS updated_at FROM compiled_missions WHERE mission_id = ?"
      ).get(missionId) ?? null;
    },

    upsertCompiledMission({ missionId, graphId, mission, status = 'active' }) {
      db.prepare(
        `INSERT INTO compiled_missions (mission_id, graph_id, mission_json, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(mission_id) DO UPDATE SET
           graph_id = excluded.graph_id,
           mission_json = excluded.mission_json,
           status = excluded.status,
           updated_at = CURRENT_TIMESTAMP`
      ).run(missionId, graphId, JSON.stringify(mission), status);
    },

    getMissionNodeRuntime(missionId, nodeId) {
      return db.prepare(
        "SELECT mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome, last_payload, datetime(updated_at, 'localtime') AS updated_at FROM mission_node_runtime WHERE mission_id = ? AND node_id = ?"
      ).get(missionId, nodeId) ?? null;
    },

    getMissionNodeRuntimeStatusAttempt(missionId, nodeId) {
      return db.prepare(
        `SELECT status, attempt
           FROM mission_node_runtime
          WHERE mission_id = ? AND node_id = ?`
      ).get(missionId, nodeId) ?? null;
    },

    upsertMissionNodeRuntime({
      missionId,
      nodeId,
      roleId,
      status = 'idle',
      attempt = 0,
      currentWaveId = null,
      lastOutcome = null,
      lastPayload = null,
    }) {
      db.prepare(
        `INSERT INTO mission_node_runtime
           (mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome, last_payload, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
         ON CONFLICT(mission_id, node_id) DO UPDATE SET
           role_id = excluded.role_id,
           status = excluded.status,
           attempt = excluded.attempt,
           current_wave_id = excluded.current_wave_id,
           last_outcome = excluded.last_outcome,
           last_payload = excluded.last_payload,
           updated_at = CURRENT_TIMESTAMP`
      ).run(missionId, nodeId, roleId, status, attempt, currentWaveId, lastOutcome, lastPayload);
    },

    insertIdleMissionNodeRuntime({ missionId, nodeId, roleId }) {
      db.prepare(
        `INSERT INTO mission_node_runtime
           (mission_id, node_id, role_id, status, attempt, current_wave_id, last_outcome, last_payload, updated_at)
         VALUES (?, ?, ?, 'idle', 0, NULL, NULL, NULL, CURRENT_TIMESTAMP)
         ON CONFLICT(mission_id, node_id) DO NOTHING`
      ).run(missionId, nodeId, roleId);
    },

    upsertAdhocMissionNodeRuntime({ missionId, nodeId, attempt }) {
      db.prepare(
        `INSERT INTO mission_node_runtime (mission_id, node_id, role_id, status, attempt, updated_at)
         VALUES (?, ?, 'agent', 'running', ?, CURRENT_TIMESTAMP)
         ON CONFLICT(mission_id, node_id) DO UPDATE SET
           status = excluded.status,
           attempt = excluded.attempt,
           updated_at = CURRENT_TIMESTAMP`
      ).run(missionId, nodeId, attempt);
    },

    insertMissionTimeline({ missionId, eventType, payload, runVersion }) {
      db.prepare(
        'INSERT INTO mission_timeline (mission_id, event_type, payload, run_version, created_at) VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP)'
      ).run(missionId, eventType, JSON.stringify(payload), runVersion);
    },

    listMissionNodeRuntimes(missionId) {
      return db.prepare(
        `SELECT node_id, role_id, status, attempt, current_wave_id, last_outcome,
                datetime(updated_at, 'localtime') AS updated_at
           FROM mission_node_runtime WHERE mission_id = ?
          ORDER BY updated_at DESC`
      ).all(missionId);
    },

    getRuntimeSessionByAttempt(missionId, nodeId, attempt) {
      return db.prepare(
        "SELECT session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, datetime(created_at, 'localtime') AS created_at, datetime(updated_at, 'localtime') AS updated_at FROM agent_runtime_sessions WHERE mission_id = ? AND node_id = ? AND attempt = ? ORDER BY updated_at DESC LIMIT 1"
      ).get(missionId, nodeId, attempt) ?? null;
    },

    getRuntimeSessionForBootstrap({ sessionId, missionId, nodeId }) {
      return db.prepare(
        `SELECT session_id, attempt
           FROM agent_runtime_sessions
          WHERE session_id = ? AND mission_id = ? AND node_id = ?
          ORDER BY updated_at DESC
          LIMIT 1`
      ).get(sessionId, missionId, nodeId) ?? null;
    },

    upsertAdhocRuntimeSession({ sessionId, missionId, nodeId, attempt }) {
      db.prepare(
        `INSERT INTO agent_runtime_sessions (session_id, agent_id, mission_id, node_id, attempt, terminal_id, status)
         VALUES (?, 'agent', ?, ?, ?, '', 'registered')
         ON CONFLICT(session_id) DO UPDATE SET
           status = excluded.status,
           updated_at = CURRENT_TIMESTAMP`
      ).run(sessionId, missionId, nodeId, attempt);
    },

    upsertRuntimeSession({
      sessionId,
      agentId,
      missionId,
      nodeId,
      attempt,
      terminalId,
      status = 'activated',
    }) {
      db.prepare(
        `INSERT INTO agent_runtime_sessions
           (session_id, agent_id, mission_id, node_id, attempt, terminal_id, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(session_id) DO UPDATE SET
           agent_id = excluded.agent_id,
           mission_id = excluded.mission_id,
           node_id = excluded.node_id,
           attempt = excluded.attempt,
           terminal_id = excluded.terminal_id,
           status = excluded.status,
           updated_at = CURRENT_TIMESTAMP`
      ).run(sessionId, agentId, missionId, nodeId, attempt, terminalId, status);
    },

    updateRuntimeSessionStatus({ sessionId, status, missionId = null, nodeId = null, attempt = null }) {
      if (missionId && nodeId && Number.isInteger(attempt)) {
        return db.prepare(
          `UPDATE agent_runtime_sessions
              SET status = ?, updated_at = CURRENT_TIMESTAMP
            WHERE session_id = ? AND mission_id = ? AND node_id = ? AND attempt = ?`
        ).run(status, sessionId, missionId, nodeId, attempt);
      }
      return db.prepare(
        `UPDATE agent_runtime_sessions
            SET status = ?, updated_at = CURRENT_TIMESTAMP
          WHERE session_id = ?`
      ).run(status, sessionId);
    },

    getRuntimeSessionIdByAttempt({ missionId, nodeId, attempt }) {
      return db.prepare(
        `SELECT session_id FROM agent_runtime_sessions WHERE mission_id = ? AND node_id = ? AND attempt = ? LIMIT 1`
      ).get(missionId, nodeId, attempt) ?? null;
    },

    listRuntimeSessions({ missionId, status, limit = 50 } = {}) {
      const conditions = [];
      const params = [];
      if (typeof missionId === 'string' && missionId.trim()) {
        conditions.push('mission_id = ?');
        params.push(missionId.trim());
      }
      if (typeof status === 'string' && status.trim()) {
        conditions.push('status = ?');
        params.push(status.trim());
      }
      const boundedLimit = Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 50));
      let sql = `SELECT session_id, agent_id, mission_id, node_id, attempt, terminal_id, run_id, status,
                        datetime(created_at, 'localtime') AS created_at,
                        datetime(updated_at, 'localtime') AS updated_at
                   FROM agent_runtime_sessions`;
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY updated_at DESC LIMIT ?';
      params.push(boundedLimit);
      return db.prepare(sql).all(...params).map(runtimeSessionRowToRecord);
    },

    upsertAgentRun({
      runId,
      missionId,
      nodeId,
      attempt = 1,
      sessionId,
      agentId = 'agent',
      cli = 'codex',
      executionMode = 'headless',
      cwd = null,
      command = 'codex',
      args = [],
      env = {},
      promptPath = null,
      stdoutPath = null,
      stderrPath = null,
      transcriptPath = null,
      status = 'running',
      exitCode = null,
      error = null,
      startedAt = null,
      completedAt = null,
    }) {
      db.prepare(
        `INSERT INTO agent_runs
           (run_id, mission_id, node_id, attempt, session_id, agent_id, cli, execution_mode,
            cwd, command, args_json, env_json, prompt_path, stdout_path, stderr_path,
            transcript_path, status, exit_code, error, started_at, completed_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(run_id) DO UPDATE SET
           mission_id = excluded.mission_id,
           node_id = excluded.node_id,
           attempt = excluded.attempt,
           session_id = excluded.session_id,
           agent_id = excluded.agent_id,
           cli = excluded.cli,
           execution_mode = excluded.execution_mode,
           cwd = excluded.cwd,
           command = excluded.command,
           args_json = excluded.args_json,
           env_json = excluded.env_json,
           prompt_path = excluded.prompt_path,
           stdout_path = excluded.stdout_path,
           stderr_path = excluded.stderr_path,
           transcript_path = excluded.transcript_path,
           status = excluded.status,
           exit_code = excluded.exit_code,
           error = excluded.error,
           started_at = excluded.started_at,
           completed_at = excluded.completed_at,
           updated_at = CURRENT_TIMESTAMP`
      ).run(
        runId,
        missionId,
        nodeId,
        attempt,
        sessionId,
        agentId,
        cli,
        executionMode,
        cwd,
        command,
        JSON.stringify(args),
        JSON.stringify(env),
        promptPath,
        stdoutPath,
        stderrPath,
        transcriptPath,
        status,
        exitCode,
        error,
        startedAt,
        completedAt,
      );
    },

    listAgentRuns({ missionId, status, limit = 50 } = {}) {
      const conditions = [];
      const params = [];
      if (typeof missionId === 'string' && missionId.trim()) {
        conditions.push('mission_id = ?');
        params.push(missionId.trim());
      }
      if (typeof status === 'string' && status.trim()) {
        conditions.push('status = ?');
        params.push(status.trim());
      }
      const boundedLimit = Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 50));
      let sql = `SELECT run_id, mission_id, node_id, attempt, session_id, agent_id, cli, execution_mode,
                        cwd, command, args_json, env_json, prompt_path, stdout_path, stderr_path,
                        transcript_path, status, exit_code, error,
                        datetime(started_at, 'localtime') AS started_at,
                        datetime(completed_at, 'localtime') AS completed_at,
                        datetime(created_at, 'localtime') AS created_at,
                        datetime(updated_at, 'localtime') AS updated_at
                   FROM agent_runs`;
      if (conditions.length > 0) sql += ` WHERE ${conditions.join(' AND ')}`;
      sql += ' ORDER BY created_at DESC LIMIT ?';
      params.push(boundedLimit);
      return db.prepare(sql).all(...params).map(agentRunRowToRecord);
    },

    inspectAgentRun(runId) {
      const row = db.prepare(
        `SELECT run_id, mission_id, node_id, attempt, session_id, agent_id, cli, execution_mode,
                cwd, command, args_json, env_json, prompt_path, stdout_path, stderr_path,
                transcript_path, status, exit_code, error,
                datetime(started_at, 'localtime') AS started_at,
                datetime(completed_at, 'localtime') AS completed_at,
                datetime(created_at, 'localtime') AS created_at,
                datetime(updated_at, 'localtime') AS updated_at
           FROM agent_runs
          WHERE run_id = ?`
      ).get(runId);
      return agentRunRowToRecord(row);
    },

    createTask({
      title,
      description = null,
      agentId = null,
      parentTaskId = null,
      status = 'todo',
      fromRole = null,
      targetRole = null,
      payload = null,
      missionId = null,
      nodeId = null,
    }) {
      const info = db.prepare(
        `INSERT INTO tasks
           (title, description, agent_id, parent_id, status, from_role, target_role, payload, mission_id, node_id)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
      ).run(title, description, agentId, parentTaskId, status, fromRole, targetRole, payload, missionId, nodeId);
      return info.lastInsertRowid;
    },

    listTasks({ status, agentId } = {}) {
      let query = 'SELECT * FROM tasks';
      const conditions = [];
      const params = [];
      if (status) {
        conditions.push('status = ?');
        params.push(status);
      }
      if (agentId) {
        conditions.push('agent_id = ?');
        params.push(agentId);
      }
      if (conditions.length) query += ' WHERE ' + conditions.join(' AND ');
      query += ' ORDER BY id DESC';
      return db.prepare(query).all(...params);
    },

    updateTaskStatus({ taskId, status }) {
      return db.prepare('UPDATE tasks SET status = ? WHERE id = ?').run(status, taskId);
    },

    getTaskForAssignment(taskId) {
      return db.prepare('SELECT id, title, description, payload, status, agent_id FROM tasks WHERE id = ?')
        .get(taskId) ?? null;
    },

    updateTaskAgent({ taskId, agentId }) {
      return db.prepare('UPDATE tasks SET agent_id = ? WHERE id = ?').run(agentId, taskId);
    },

    countActiveTasksForAgent(agentId) {
      const row = db.prepare(
        "SELECT COUNT(1) AS active_count FROM tasks WHERE agent_id = ? AND status IN ('todo', 'in-progress')"
      ).get(agentId);
      return Number(row?.active_count ?? 0);
    },

    listTaskTreeRows() {
      return db.prepare(
        "SELECT id, title, description, status, agent_id, parent_id, from_role, target_role, payload, datetime(created_at, 'localtime') as created_at FROM tasks ORDER BY id"
      ).all();
    },

    listRecentTasksForNode({ missionId, nodeId }) {
      return db.prepare(
        `SELECT id, title, description, status, payload, from_role, target_role, parent_id, agent_id, mission_id, node_id,
                datetime(created_at, 'localtime') AS created_at
           FROM tasks
          WHERE mission_id = ? AND node_id = ?
          ORDER BY id DESC
          LIMIT 10`
      ).all(missionId, nodeId);
    },

    insertNodeMessage({
      sessionId,
      content,
      missionId,
      nodeId = null,
      recipientNodeId,
      eventType = 'message',
    }) {
      return db.prepare(
        `INSERT INTO session_log
           (session_id, event_type, content, mission_id, node_id, recipient_node_id, is_read)
         VALUES (?, ?, ?, ?, ?, ?, 0)`
      ).run(sessionId, eventType, content, missionId, nodeId, recipientNodeId);
    },

    listNodeInbox({ missionId, nodeId, limit = 20 }) {
      return db.prepare(
        `SELECT id, session_id, event_type, content,
                datetime(created_at, 'localtime') AS created_at,
                mission_id, node_id, recipient_node_id, is_read
           FROM session_log
          WHERE mission_id = ? AND recipient_node_id = ?
          ORDER BY id DESC
          LIMIT ?`
      ).all(missionId, nodeId, limit);
    },

    ackNodeMessages({ missionId, nodeId, throughSeq }) {
      return db.prepare(
        "UPDATE session_log SET is_read = 1 WHERE mission_id = ? AND recipient_node_id = ? AND event_type = 'message' AND id <= ?"
      ).run(missionId, nodeId, throughSeq);
    },

    listNodeMessagesAfter({ missionId, nodeId, afterSeq }) {
      return db.prepare(
        "SELECT id, session_id, event_type, content, datetime(created_at, 'localtime') AS created_at, mission_id, node_id, recipient_node_id, is_read FROM session_log WHERE mission_id = ? AND recipient_node_id = ? AND event_type = 'message' AND id > ? ORDER BY id ASC LIMIT 100"
      ).all(missionId, nodeId, afterSeq);
    },

    listSessionHistory({ limit = 50 } = {}) {
      return db.prepare(
        "SELECT session_id, event_type, content, datetime(created_at, 'localtime') as created_at FROM session_log ORDER BY id DESC LIMIT ?"
      ).all(limit);
    },

    recordTaskPush({ sessionId, missionId, nodeId, taskSeq, attempt = null }) {
      const existing = db.prepare(
        'SELECT task_seq FROM task_pushes WHERE session_id = ? AND mission_id = ? AND node_id = ? AND task_seq = ?'
      ).get(sessionId, missionId, nodeId, taskSeq);
      if (existing) return { inserted: false, reason: 'duplicate' };

      db.prepare(
        `INSERT INTO task_pushes (session_id, mission_id, node_id, task_seq, attempt, pushed_at)
         VALUES (?, ?, ?, ?, ?, CURRENT_TIMESTAMP)`
      ).run(sessionId, missionId, nodeId, taskSeq, attempt);
      return { inserted: true };
    },

    getPendingTaskPushes(sessionId) {
      return db.prepare(
        `SELECT mission_id, node_id, task_seq, attempt, datetime(pushed_at, 'localtime') AS pushed_at
           FROM task_pushes
          WHERE session_id = ? AND acked_at IS NULL
          ORDER BY task_seq ASC`
      ).all(sessionId);
    },

    ackTaskPush({ sessionId, missionId, nodeId, taskSeq }) {
      const info = db.prepare(
        `UPDATE task_pushes SET acked_at = CURRENT_TIMESTAMP
          WHERE session_id = ? AND mission_id = ? AND node_id = ? AND task_seq = ? AND acked_at IS NULL`
      ).run(sessionId, missionId, nodeId, taskSeq);
      return info.changes > 0;
    },

    listTaskPushesForSessionNode({ sessionId, missionId, nodeId }) {
      return db.prepare(
        `SELECT task_seq, attempt,
                datetime(pushed_at, 'localtime') AS pushed_at,
                datetime(acked_at, 'localtime') AS acked_at
           FROM task_pushes
          WHERE session_id = ? AND mission_id = ? AND node_id = ?
          ORDER BY task_seq ASC`
      ).all(sessionId, missionId, nodeId);
    },

    upsertWorkspaceContext({ key, value, updatedBy }) {
      db.prepare(
        'INSERT INTO workspace_context (key, value, updated_by, updated_at) VALUES (?, ?, ?, CURRENT_TIMESTAMP) ' +
        'ON CONFLICT(key) DO UPDATE SET value=excluded.value, updated_by=excluded.updated_by, updated_at=excluded.updated_at'
      ).run(key, value, updatedBy);
    },

    listWorkspaceContext(keys = null) {
      if (Array.isArray(keys) && keys.length > 0) {
        const placeholders = keys.map(() => '?').join(',');
        return db.prepare(
          `SELECT key, value, updated_by, datetime(updated_at, 'localtime') as updated_at FROM workspace_context WHERE key IN (${placeholders})`
        ).all(...keys);
      }
      return db.prepare(
        `SELECT key, value, updated_by, datetime(updated_at, 'localtime') as updated_at FROM workspace_context ORDER BY key`
      ).all();
    },

    getPersistedFileLock(filePath) {
      return db.prepare('SELECT file_path, agent_id FROM file_locks WHERE file_path = ?').get(filePath) ?? null;
    },

    upsertFileLock({ filePath, agentId }) {
      db.prepare(
        'INSERT INTO file_locks (file_path, agent_id, locked_at) VALUES (?, ?, CURRENT_TIMESTAMP) ON CONFLICT(file_path) DO UPDATE SET agent_id = excluded.agent_id, locked_at = CURRENT_TIMESTAMP'
      ).run(filePath, agentId);
    },

    deleteFileLock(filePath) {
      db.prepare('DELETE FROM file_locks WHERE file_path = ?').run(filePath);
    },

    listFileLocks() {
      return db.prepare(
        "SELECT file_path, agent_id, datetime(locked_at, 'localtime') AS locked_at FROM file_locks ORDER BY file_path"
      ).all();
    },

    upsertAdapterRegistration({ adapterId, sessionId, terminalId, nodeId, missionId, role, cli, cwd = null }) {
      db.prepare(
        `INSERT INTO adapter_registrations
           (adapter_id, session_id, terminal_id, node_id, mission_id, role, cli, cwd, lifecycle, registered_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'registered', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
         ON CONFLICT(adapter_id) DO UPDATE SET
           terminal_id = excluded.terminal_id,
           role = excluded.role,
           cli = excluded.cli,
           cwd = excluded.cwd,
           lifecycle = 'registered',
           updated_at = CURRENT_TIMESTAMP`
      ).run(adapterId, sessionId, terminalId, nodeId, missionId, role, cli, cwd);
    },

    updateAdapterLifecycle({ adapterId, lifecycle }) {
      db.prepare(
        `UPDATE adapter_registrations
            SET lifecycle = ?, updated_at = CURRENT_TIMESTAMP
          WHERE adapter_id = ?`
      ).run(lifecycle, adapterId);
    },

    resetAll() {
      db.exec(`
        DELETE FROM tasks;
        DELETE FROM file_locks;
        DELETE FROM session_log;
        DELETE FROM workspace_context;
        DELETE FROM compiled_missions;
        DELETE FROM mission_node_runtime;
        DELETE FROM agent_runtime_sessions;
        DELETE FROM mission_timeline;
        DELETE FROM task_pushes;
        DELETE FROM adapter_registrations;
        DELETE FROM agent_runs;
      `);
    },
  };
}
