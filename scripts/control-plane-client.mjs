import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, '..');

export class BackendRpcClient {
  constructor(options = {}) {
    this.backendPath = options.backendPath ?? defaultBackendPath();
    this.cwd = options.cwd ?? process.env.TD_BACKEND_CWD ?? REPO_ROOT;
    this.env = { ...process.env, ...(options.env ?? {}) };
    this.nextId = 1;
    this.pending = new Map();
    this.buffer = '';
    this.events = [];
    this.process = null;
  }

  async start() {
    if (this.process) return;
    if (!existsSync(this.backendPath)) {
      throw new Error(`Backend binary not found at ${this.backendPath}. Build it with: cargo build --manifest-path backend/Cargo.toml`);
    }

    this.process = spawn(this.backendPath, [], {
      cwd: this.cwd,
      env: this.env,
      stdio: ['pipe', 'pipe', 'pipe'],
    });

    this.process.stdout.setEncoding('utf8');
    this.process.stderr.setEncoding('utf8');
    this.process.stdout.on('data', chunk => this.handleStdout(chunk));
    this.process.stderr.on('data', chunk => {
      if (process.env.TDCTL_DEBUG) process.stderr.write(chunk);
    });
    this.process.on('exit', code => {
      const error = new Error(`Backend process exited with code ${code ?? 'null'}.`);
      for (const { reject, timer } of this.pending.values()) {
        clearTimeout(timer);
        reject(error);
      }
      this.pending.clear();
    });
  }

  async request(cmd, payload = {}) {
    await this.start();
    const id = String(this.nextId++);
    const message = JSON.stringify({ id, cmd, payload }) + '\n';
    const response = new Promise((resolveResponse, reject) => {
      const timer = setTimeout(() => {
        if (!this.pending.has(id)) return;
        this.pending.delete(id);
        reject(new Error(`Timed out waiting for backend command "${cmd}".`));
      }, Number(process.env.TDCTL_RPC_TIMEOUT_MS ?? 30_000));
      this.pending.set(id, { resolve: resolveResponse, reject, timer });
    });
    this.process.stdin.write(message);
    return response;
  }

  close() {
    if (!this.process) return;
    this.process.kill();
    this.process = null;
  }

  handleStdout(chunk) {
    this.buffer += chunk;
    let index;
    while ((index = this.buffer.indexOf('\n')) >= 0) {
      const line = this.buffer.slice(0, index).trim();
      this.buffer = this.buffer.slice(index + 1);
      if (!line) continue;
      let parsed;
      try {
        parsed = JSON.parse(line);
      } catch {
        if (process.env.TDCTL_DEBUG) console.error(line);
        continue;
      }

      if (parsed.type === 'event') {
        this.events.push(parsed);
        continue;
      }

      if (parsed.type !== 'response') continue;
      const pending = this.pending.get(parsed.id);
      if (!pending) continue;
      this.pending.delete(parsed.id);
      clearTimeout(pending.timer);
      if (parsed.error) {
        pending.reject(new Error(parsed.error));
      } else {
        pending.resolve(parsed.payload);
      }
    }
  }
}

export class ControlPlaneClient {
  constructor(rpc = new BackendRpcClient()) {
    this.rpc = rpc;
  }

  startHeadlessRun(payload) {
    return this.rpc.request('start_agent_run', { payload });
  }

  launchWorkflow(missionId, graph) {
    return this.rpc.request('start_mission_graph', { missionId, graph });
  }

  listSessions({ missionId = null } = {}) {
    return this.rpc.request('list_agent_runs', { missionId });
  }

  inspectSession(runId) {
    return this.rpc.request('get_agent_run', { runId });
  }

  killSession(runId, reason = 'cancelled_by_control_plane') {
    return this.rpc.request('cancel_agent_run', { runId, reason });
  }

  close() {
    this.rpc.close();
  }
}

export function defaultBackendPath() {
  return process.env.TD_BACKEND_BIN || resolve(REPO_ROOT, 'backend/target/debug/backend');
}
