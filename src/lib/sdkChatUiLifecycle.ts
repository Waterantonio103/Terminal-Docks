import { formatSdkPatchProposalContent, type SdkAppActionResultContent, type SdkChatArtifact, type SdkChatMessage } from './sdkChat.js';
import { splitAgentContent } from './agentChatFormatting.js';

export type SdkCommandCompletionActionResult = SdkAppActionResultContent & {
  status: 'completed' | 'failed';
};

export type SdkDeniedActionResult = SdkAppActionResultContent & {
  status: 'failed';
  error: string;
};

export type SdkCardResolution = {
  status: 'started' | 'completed' | 'failed';
  label: string;
};

export type SdkCardResolutionMessage = {
  content: string;
};

export type SdkArtifactToolMessageFields = {
  content: string;
  artifactIds: string[];
  filePaths?: string[];
};

export type SdkAutoContinueFlushOptions = {
  pendingPrompt?: string | null;
  submitting: boolean;
  selectedCli: string;
  hasApiKey: boolean;
};

export type SdkFollowUpHistoryMessage = {
  role: string;
  content: string;
};

export function buildSdkArtifactToolMessageFields(artifact: SdkChatArtifact): SdkArtifactToolMessageFields {
  return {
    content: formatSdkPatchProposalContent(artifact),
    artifactIds: [artifact.id],
    filePaths: artifact.kind === 'patch' || artifact.kind === 'directory' ? [artifact.path] : undefined,
  };
}

export function buildSdkFollowUpMessagesForRun(options: {
  priorMessages: SdkFollowUpHistoryMessage[];
  latestUserContent: SdkChatMessage['content'];
  historyLimit?: number;
}): SdkChatMessage[] {
  const limit = Math.max(0, Math.floor(options.historyLimit ?? 24));
  return [
    ...options.priorMessages
      .filter(message => message.role === 'user' || message.role === 'agent' || message.role === 'tool')
      .filter(message => message.role !== 'tool' || sdkToolHistoryMessageIsDurable(message.content))
      .slice(-limit)
      .map(message => ({
        role: message.role === 'agent' ? 'assistant' as const : message.role as 'user' | 'tool',
        content: message.content,
      })),
    { role: 'user' as const, content: options.latestUserContent },
  ];
}

export function sdkToolHistoryMessageIsDurable(content: string): boolean {
  const blocks = splitAgentContent(content);
  return blocks.some(block =>
    block.kind === 'action_result' ||
    block.kind === 'command' ||
    block.kind === 'patch' ||
    block.kind === 'directory' ||
    block.kind === 'preview' ||
    block.kind === 'terminal_stop' ||
    block.kind === 'todos'
  );
}

export function followUpToolMessageHasInteractiveSdkContent(content: string): boolean {
  const blocks = splitAgentContent(content);
  return blocks.some(block =>
    block.kind === 'todos' ||
    block.kind === 'command' ||
    block.kind === 'patch' ||
    block.kind === 'directory' ||
    block.kind === 'preview' ||
    block.kind === 'terminal_stop' ||
    block.kind === 'action_result'
  );
}

export function sdkCardResolutionKey(kind: string, target: string): string {
  return `${kind.trim().toLowerCase()}::${target.trim().toLowerCase()}`;
}

export function sdkCardIdResolutionKey(cardId: string): string {
  return sdkCardResolutionKey('card', cardId);
}

export function buildSdkCardResolutionMap(messages: SdkCardResolutionMessage[]): Map<string, SdkCardResolution> {
  const resolved = new Map<string, SdkCardResolution>();
  for (const message of messages) {
    for (const block of splitAgentContent(message.content)) {
      if (block.kind !== 'action_result') continue;
      const resolution: SdkCardResolution = {
        status: block.status,
        label: block.status === 'failed' ? 'denied/failed' : block.status,
      };
      if (block.cardId) {
        resolved.set(sdkCardIdResolutionKey(block.cardId), resolution);
      }
      resolved.set(sdkCardResolutionKey(block.actionKind, block.target), resolution);
      if (block.actionKind === 'command' && block.command) {
        resolved.set(sdkCardResolutionKey(block.actionKind, block.command), resolution);
      }
    }
  }
  return resolved;
}

export function resolveSdkCardResolution(
  resolutions: Map<string, SdkCardResolution> | undefined,
  options: { cardId?: string | null; kind: string; target: string },
): SdkCardResolution | undefined {
  return (options.cardId ? resolutions?.get(sdkCardIdResolutionKey(options.cardId)) : undefined)
    ?? resolutions?.get(sdkCardResolutionKey(options.kind, options.target));
}

export function shouldSuppressEmptySdkAssistantMessage(options: {
  finalText?: string | null;
  streamedContent?: string | null;
  emittedApprovalCard: boolean;
}): boolean {
  const visibleAgentContent = `${options.finalText ?? ''}${options.streamedContent ?? ''}`.trim();
  return options.emittedApprovalCard && visibleAgentContent.length === 0;
}

export function shouldQueueSdkAutoContinue(options: { selectedCli: string; hasApiKey: boolean }): boolean {
  return options.selectedCli === 'codex' && options.hasApiKey;
}

export function getSdkAutoContinueFlushPrompt(options: SdkAutoContinueFlushOptions): string | null {
  if (!shouldQueueSdkAutoContinue(options)) return null;
  if (options.submitting) return null;
  const prompt = options.pendingPrompt?.trim();
  return prompt ? prompt : null;
}

export function buildSdkCommandCompletionResult(
  startedResult: SdkAppActionResultContent,
  exitCode: number,
): SdkCommandCompletionActionResult {
  return {
    ...startedResult,
    status: exitCode === 0 ? 'completed' : 'failed',
    error: exitCode === 0 ? undefined : `Command exited with code ${exitCode}`,
  };
}

export function buildSdkDeniedActionResult(
  result: Omit<SdkAppActionResultContent, 'status' | 'error'> & { error?: string },
): SdkDeniedActionResult {
  return {
    ...result,
    status: 'failed',
    error: result.error?.trim() || 'User denied this action.',
  };
}
