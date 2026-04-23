export type WorkerKind = 'claude' | 'gemini' | 'codex' | 'opencode' | 'generic';

export type ReadyState = 'spawning' | 'booting' | 'ready' | 'busy' | 'stale' | 'dead';

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
    | 'workspace:context-updated';
  sessionId: string;
  at: number;
  missionId?: string;
  nodeId?: string;
  taskSeq?: number;
  attempt?: number | null;
  outcome?: 'success' | 'failure';
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
