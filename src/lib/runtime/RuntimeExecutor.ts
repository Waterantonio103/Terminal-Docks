import type { RuntimeSession } from './RuntimeSession.js';
import type {
  CreateRuntimeArgs,
  RuntimeManagerEvent,
  RuntimeReuseExpectation,
  SendInputArgs,
  SendTaskArgs,
  SessionLivenessResult,
  StopRuntimeArgs,
} from './RuntimeTypes.js';
import { runtimeManager, type RuntimeManager } from './RuntimeManager.js';
import { missionRepository } from '../missionRepository.js';

export interface StartNodeRunInput extends CreateRuntimeArgs {
  prompt?: string;
}

export type RuntimeLaunchResult =
  | {
      ok: true;
      session: RuntimeSession;
      sessionId: string;
      terminalId: string;
    }
  | {
      ok: false;
      missionId: string;
      nodeId: string;
      attempt: number;
      reason: string;
    };

export interface TerminalAttachment {
  sessionId: string;
  terminalId: string;
}

export class RuntimeExecutor {
  constructor(private readonly manager: RuntimeManager = runtimeManager) {}

  async startNodeRun(input: StartNodeRunInput): Promise<RuntimeSession> {
    const result = await this.startNodeRunWithResult(input);
    if (!result.ok) {
      throw new Error(result.reason);
    }
    return result.session;
  }

  async startNodeRunWithResult(input: StartNodeRunInput): Promise<RuntimeLaunchResult> {
    try {
      await this.appendEvent(input, 'runtime_launch_requested', 'info', `Runtime launch requested for node ${input.nodeId}.`);
      const session = await this.manager.ensureRuntimeReadyForTask(input);
      await this.appendEvent(
        input,
        'runtime_launch_succeeded',
        'info',
        `Runtime session ${session.sessionId} is ready for node ${input.nodeId}.`,
        { sessionId: session.sessionId, terminalId: session.terminalId, state: session.state },
      );
      return {
        ok: true,
        session,
        sessionId: session.sessionId,
        terminalId: session.terminalId,
      };
    } catch (error) {
      const reason = error instanceof Error ? error.message : String(error);
      await this.appendEvent(input, 'runtime_launch_failed', 'error', reason);
      return {
        ok: false,
        missionId: input.missionId,
        nodeId: input.nodeId,
        attempt: input.attempt,
        reason,
      };
    }
  }

  async stopSession(sessionId: string, reason: string): Promise<void> {
    await this.manager.stopRuntime({ sessionId, reason } satisfies StopRuntimeArgs);
  }

  async stopRuntime(args: StopRuntimeArgs): Promise<void> {
    await this.manager.stopRuntime(args);
  }

  async cancelNode(nodeId: string, reason: string): Promise<void> {
    const sessions = this.manager.getActiveSessions().filter(session => session.nodeId === nodeId);
    await Promise.all(sessions.map(session => this.stopSession(session.sessionId, reason)));
  }

  async attachTerminal(sessionId: string): Promise<TerminalAttachment> {
    const session = this.manager.getSession(sessionId);
    if (!session) throw new Error(`No runtime session: ${sessionId}`);
    return {
      sessionId,
      terminalId: session.terminalId,
    };
  }

  async getSession(sessionId: string): Promise<RuntimeSession> {
    const session = this.manager.getSession(sessionId);
    if (!session) throw new Error(`No runtime session: ${sessionId}`);
    return session;
  }

  getSessionForNode(missionId: string, nodeId: string, attempt: number): RuntimeSession | undefined {
    return this.manager.getSessionForNode(missionId, nodeId, attempt);
  }

  async ensureRuntimeReadyForTask(input: CreateRuntimeArgs): Promise<RuntimeSession> {
    return this.startNodeRun(input);
  }

  async validateSessionForReuse(
    sessionId: string,
    expected: RuntimeReuseExpectation,
  ): Promise<SessionLivenessResult> {
    return this.manager.validateSessionForReuse(sessionId, expected);
  }

  async reinjectTask(sessionId: string): Promise<void> {
    await this.manager.reinjectTask(sessionId);
  }

  async sendTask(args: SendTaskArgs): Promise<void> {
    await this.manager.sendTask(args);
  }

  async sendInput(args: SendInputArgs): Promise<void> {
    await this.manager.sendInput(args);
  }

  async writeBootstrapToTerminal(terminalId: string, data: string, caller: string): Promise<void> {
    await this.manager.writeBootstrapToTerminal(terminalId, data, caller);
  }

  subscribe(listener: (event: RuntimeManagerEvent) => void): () => void {
    return this.manager.subscribe(listener);
  }

  private async appendEvent(
    input: Pick<CreateRuntimeArgs, 'missionId' | 'nodeId' | 'attempt' | 'terminalId'>,
    eventType: string,
    severity: 'info' | 'error',
    message: string,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    if (input.missionId.startsWith('adhoc-')) return;
    await missionRepository.appendWorkflowEvent({
      missionId: input.missionId,
      nodeId: input.nodeId,
      terminalId: input.terminalId || null,
      eventType,
      severity,
      message,
      payloadJson: JSON.stringify({ attempt: input.attempt, ...payload }),
    }).catch(() => {});
  }
}

export const runtimeExecutor = new RuntimeExecutor();
