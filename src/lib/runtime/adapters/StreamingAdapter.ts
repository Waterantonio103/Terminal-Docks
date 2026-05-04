import type {
  CliAdapter,
  CompletionDetectionResult,
  LaunchCommand,
  LaunchContext,
  PermissionDecision,
  PermissionDetectionResult,
  PermissionRequest,
  PermissionResponse,
  ReadyDetectionResult,
  RuntimeOutputEvent,
  StatusDetectionResult,
  TaskContext,
} from './CliAdapter';

/**
 * StreamingAdapter.ts
 *
 * Mock adapter for 'api' and 'streaming_headless' modes that doesn't
 * require a local terminal process. It maps API tool calls directly
 * to MCP tool results.
 */
export const streamingAdapter: CliAdapter = {
  id: 'streaming',
  label: 'API/Streaming Backend',

  buildLaunchCommand(context: LaunchContext): LaunchCommand {
    // This mode doesn't actually launch a local PTY or process
    // but we return a stub so RuntimeManager doesn't crash.
    return {
      command: 'true', // or any nop
      args: [],
      env: {
        TD_SESSION_ID: context.sessionId,
        TD_AGENT_ID: context.agentId,
        TD_MISSION_ID: context.missionId,
        TD_NODE_ID: context.nodeId,
        TD_EXECUTION_MODE: context.executionMode,
      },
      promptDelivery: 'unsupported',
    };
  },

  detectReady(_output: string): ReadyDetectionResult {
    // Always ready
    return { ready: true, confidence: 'high', detail: 'Streaming backend always ready' };
  },

  detectStatus(_output: string): StatusDetectionResult {
    return { status: 'idle', confidence: 'high', detail: 'Streaming backend always ready' };
  },

  buildInitialPrompt(context: TaskContext): string {
    return context.payloadJson;
  },

  detectPermissionRequest(_output: string): PermissionDetectionResult | null {
    return null;
  },

  buildPermissionResponse(decision: PermissionDecision, _request: PermissionRequest): PermissionResponse {
    return { input: decision === 'approve' ? 'y\r' : 'n\r' };
  },

  detectCompletion(_output: string): CompletionDetectionResult | null {
    return null;
  },

  normalizeOutput(_output: string): RuntimeOutputEvent[] {
    return [];
  },

  buildActivationInput(_signal: string): { paste: string; submit: string } {
    return {
      paste: '',
      submit: '',
    };
  },
};
