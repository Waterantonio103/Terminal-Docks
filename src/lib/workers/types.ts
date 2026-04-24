export type WorkerKind = 'claude' | 'gemini' | 'codex' | 'opencode' | 'generic' | 'custom' | 'ollama' | 'lmstudio';

export type ReadyState = 'spawning' | 'booting' | 'ready' | 'busy' | 'stale' | 'dead';

// Adapter lifecycle — owned by Terminal Docks, not by the AI CLI.
// The adapter progresses through these states independently of the CLI.
export type AdapterLifecycle =
  | 'created'
  | 'unbound'
  | 'spawning'
  | 'terminal_started'
  | 'starting'
  | 'adapter_starting'
  | 'mcp_connecting'
  | 'registered'
  | 'ready'
  | 'activation_pending'
  | 'activation_acked'
  | 'task_acked'
  | 'running'
  | 'completed'
  | 'failed'
  | 'disconnected';

export interface AdapterRegistration {
  sessionId: string;
  terminalId: string;
  nodeId: string;
  missionId: string;
  role: string;
  cli: WorkerKind;
  cwd: string | null;
}

// The full adapter contract Terminal Docks exposes to implementations.
// The CLI is a child the adapter drives — it is NOT the adapter.
export interface RuntimeAdapterContract {
  startRuntime(args: {
    sessionId: string;
    missionId: string;
    nodeId: string;
    role: string;
    cli: WorkerKind;
    command: string;
    cwd: string | null;
    mcpBaseUrl: string;
  }): Promise<void>;
  sendTask(args: {
    sessionId: string;
    missionId: string;
    nodeId: string;
    taskSeq: number;
    prompt: string;
  }): Promise<void>;
  stopRuntime(args: { sessionId: string }): Promise<void>;
  onOutput(text: string): void;
  onAck(taskSeq: number): void;
  onComplete(result: StructuredResult): void;
  onError(error: Error): void;
}

export interface WorkerSession {
  readonly sessionId: string;
  readonly paneId: string;
  readonly terminalId: string;
  readonly kind: WorkerKind;
  readonly agentId: string;
  readonly profileId: string;
  readonly workspaceDir: string | null;
  readyState: ReadyState;
  lastHeartbeatAt: number;
  currentTask?: {
    missionId: string;
    nodeId: string;
    attempt: number;
    taskSeq: number;
    startedAt: number;
  };
}

export interface SpawnArgs {
  paneId: string;
  agentId: string;
  profileId: string;
  workspaceDir: string | null;
  rows: number;
  cols: number;
}

export interface TaskEnvelope {
  signal?: 'NEW_TASK';
  missionId: string;
  nodeId: string;
  roleId: string;
  agentId: string;
  sessionId: string;
  terminalId: string;
  attempt: number;
  taskSeq: number;
  activatedAt: number;
  payloadPreview: string | null;
  handoffPayloadPreview: string | null;
}

export interface StructuredResult {
  outcome: 'success' | 'failure';
  summary?: string;
  payload?: unknown;
}

export type WorkerEvent =
  | { kind: 'banner'; cli: WorkerKind; confidence: 'low' | 'medium' | 'high' }
  | { kind: 'ready' }
  | { kind: 'heartbeat'; at: number }
  | { kind: 'task-acked'; taskSeq: number }
  | { kind: 'task-completed'; taskSeq: number; outcome: 'success' | 'failure' }
  | { kind: 'prompt-line'; line: string }
  | { kind: 'crash'; detail: string }
  | { kind: 'stale'; detail: string };

export interface WorkerAdapter {
  readonly kind: WorkerKind;
  spawnWorker(args: SpawnArgs): Promise<WorkerSession>;
  bootstrapWorker(session: WorkerSession): Promise<void>;
  sendTask(session: WorkerSession, envelope: TaskEnvelope): Promise<number>;
  streamOutput(session: WorkerSession, onEvent: (e: WorkerEvent) => void): () => void;
  focus(session: WorkerSession): Promise<void>;
  cancel(session: WorkerSession, reason: string): Promise<void>;
  collectResult(session: WorkerSession, taskSeq: number): Promise<StructuredResult | null>;
  dispose(session: WorkerSession): Promise<void>;
}

export interface McpServerEvent {
  type:
    | 'agent:ready'
    | 'agent:heartbeat'
    | 'agent:disconnected'
    | 'agent:artifact'
    | 'task:acked'
    | 'task:completed'
    | 'task:pushed'
    | 'bootstrap:requested'
    | 'workspace:context-updated'
    | 'activation:acked';
  sessionId: string;
  at: number;
  missionId?: string;
  nodeId?: string;
  taskSeq?: number;
  attempt?: number | null;
  outcome?: 'success' | 'failure';
  summary?: string;
  filesChanged?: string[];
  artifactReferences?: string[];
  logRef?: string | null;
  targetNodeId?: string | null;
  agentId?: string | null;
  profileId?: string | null;
  role?: string | null;
  key?: string;
  reason?: string;
  artifactType?: 'file_change' | 'summary' | 'reference';
  label?: string;
  content?: string;
  path?: string;
}
