import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const source = readFileSync(resolve(root, 'src/components/MissionControl/MissionControlPane.tsx'), 'utf8');
const agentDock = readFileSync(resolve(root, 'src/components/AgentDock/AgentDock.tsx'), 'utf8');
const workspaceGrid = readFileSync(resolve(root, 'src/components/Layout/WorkspaceGrid.tsx'), 'utf8');
const editorPane = readFileSync(resolve(root, 'src/components/Editor/EditorPane.tsx'), 'utf8');
const sdkChat = readFileSync(resolve(root, 'src/lib/sdkChat.ts'), 'utf8');
const runtimeManager = readFileSync(resolve(root, 'src/lib/runtime/RuntimeManager.ts'), 'utf8');
const cliCommandBuilders = readFileSync(resolve(root, 'src/lib/cliCommandBuilders.ts'), 'utf8');
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8');
const packageJson = readFileSync(resolve(root, 'package.json'), 'utf8');

for (const required of [
  'parseAgentSlashCommand',
  'resolveAgentSlashCommand',
  'buildAgentSlashCommandSuggestions',
  'handleSlashCommandSubmission',
  'slashCommandMenu',
  'slashPickerCommand',
  'slashPickerStandalone',
  'visibleSlashSuggestions',
  'runSlashMenuSelection',
  'promptWithActiveSlashCommand',
  'Enter runs. Space types. Tab opens options.',
  'scrollIntoView({ block: \'nearest\' })',
  'agentBrandIcon(brandKindForCli(cli), 14)',
  'agentBrandIcon(brandKindForModel(model, selectedCli), 14)',
  'reasoningOptionsForCli(selectedCli)',
  "if (value === 'xhigh') return 'XHigh'",
  "{ value: 'xhigh', label: 'XHigh'",
  'openReasoningPickerAfterModelSelection',
  'changeFollowUpModel(value, { promptForReasoning: true })',
  'trailingMeta={selectedReasoningLabel}',
  'td-agent-slash-icon',
  'td-agent-slash-menu',
  'skipSlashProcessing',
  'followUpGoal',
  'followUpReasoning',
  'entryKind === \'value\'',
  'const renamePane = useWorkspaceStore(s => s.renamePane)',
  'changeFollowUpAgentRole',
  'const paneWorkspaceDir = useWorkspaceStore',
  'workspaceDir={paneWorkspaceDir}',
  'FollowUpMessageTimeline',
  'AgentRunTranscriptGroup',
  'AgentTurnLiveGroup',
  'collectAgentWorkItems',
  'AGENT_TOKEN_USAGE_PREFIX',
  'contextInputTokens',
  'contextAgentTokenUsage(headerTokenUsage)',
  'formatAgentTokenUsageTotal(tokenUsage)',
  '`${formatContextTokenCount(totalAgentTokenUsage(usage))} used`',
  'stripAgentTokenUsage(message.content)',
  'appendAgentTokenUsage(completedText',
  'collectAgentTokenUsage(messages)',
  'filterAgentTurnSummaryItems',
  'mergeAgentWorkItemUpdate',
  'liveCodeChanges',
  'refreshFollowUpLiveFileChanges',
  'scheduleFollowUpLiveFileChangeRefresh',
  'td-agent-live-code-changes',
  'AgentDiffBlock',
  'AgentWorkItemCodeChangeCard',
  'Worked for {duration',
  'td-agent-turn-token-usage',
  'td-agent-turn-filtered-work',
  'initiallyExpanded={activeFilter === \'commands\' || activeFilter === \'failed\'}',
  'currentMeta',
  'td-agent-slash-current',
  'openReasoningPickerAfterModelSelection({ clearActiveSlash: options.clearActiveSlash })',
  'setSlashPickerStandalone(true)',
  'if (slashPickerStandalone) return;',
  "items.push({ kind: 'message', message });",
  "run = { key: `run:${message.id}`, sessionId: message.runtimeSessionId, messages: [] };",
  'AgentChangeSummaryCard',
  'formatAgentToolEventContent',
  'stableAgentToolEventId',
  'upsertFollowUpMessage',
  'parseAgentToolMessage',
  'parseCodexContextUsage',
  'parseAgentUsageLimits',
  'parseAgentUsageLimitMessage',
  'usagePopoverPayload',
  'usagePopoverStatus',
  'showUsageLimitsPopover',
  "invoke<CodexUsageLimitsResponse>('read_codex_usage_limits')",
  "command: 'account/rateLimits/read'",
  'extractTerminalUsageCommandOutput',
  'cliUsageLimitRows',
  'terminalOutputBus.getTail(activeRuntimeTerminalId, 16_000)',
  'No ${formatFollowUpCliLabel(selectedCli)} usage limits are visible',
  'terminalOutputBus.getTail(activeRuntimeTerminalId, 12_000)',
  'agentOutputShouldStickRef.current',
  'isAgentOutputScrolledToBottom',
  'contextTokenTitle',
  'cliContextTokenUsage',
  "if (message.role === 'user')",
  'mergePersistedFollowUpMessages(readFollowUpMessages(pane.id), loaded)',
  'followUpBusyState',
  'setFollowUpBusyState(sessionId, step)',
  'busyStateMatchesSession',
  'upsertFollowUpMessage(pane.id, { ...agentMessage, content: sanitizeAgentTranscriptForStorage(streamedContent) })',
  "selectedCli === 'codex' && selectedPermissionMode === 'full'",
  "selectedCli === 'codex' && configuredOpenAiApiKey",
  'runtimeWorkspaceDir',
  "state: 'Sending'",
  'reason: \'Agent context changed\'',
  'runtimeManager.setSessionPermissionMode',
  "state: 'Changing permissions'",
  '.slice(0, 100)',
  "toolMode: selectedPermissionMode === 'restricted' ? 'none' : 'full'",
  'td-agent-permission-mode-label',
  'td-agent-refresh-button',
  "className={`td-agent-chat-area ${visibleMessages.length > 0 ? 'has-messages' : ''}`}",
  '!isInternalAgentStatusMessage(message)',
  'AgentSystemNotice',
  'const queuedFollowUpPanel = pendingQueue.length > 0',
  'td-agent-queued-messages',
  'td-agent-queued-steer',
  'editQueuedFollowUp',
  'discardQueuedFollowUp',
  'steerQueuedFollowUp',
  'moveQueuedFollowUp',
  "event.key === 'Enter' && !event.altKey && !event.ctrlKey && !event.metaKey",
]) {
  assert.ok(source.includes(required), `MissionControlPane should include ${required}`);
}

assert.ok(
  !source.includes('runtimeManager.captureCliSlashCommandOutput'),
  'MissionControlPane /usage should not wait on a spawned CLI probe',
);

assert.ok(
  !source.includes('runCodexCliJson'),
  'MissionControlPane should use the reusable interactive runtime for no-key Codex CLI follow-ups',
);

assert.ok(
  source.includes("<span>{message.role === 'user' ? 'You' : 'Agent'}</span>") &&
    !source.includes('{message.cli && <span>{message.cli}</span>}') &&
    !source.includes('{message.status && <span>{message.status}</span>}'),
  'chat message meta should only show You/Agent',
);

for (const required of [
  'AgentFooterCompartment',
  'CometAgentLogo',
  '/comet-ai-logo.svg',
  'roleTitleForPane',
  'dockExpandedToTab: true',
  'workspaceDir: sourceWorkspaceDir',
  'sourceTab?.workspaceDir ?? state.workspaceDir ?? workspaceDir ?? sourcePaneWorkspaceDir',
]) {
  assert.ok(agentDock.includes(required), `AgentDock should include ${required}`);
}
assert.ok(!agentDock.includes('onSecondary'), 'AgentDock footer minimized block should not render a separate arrow action');

for (const required of [
  'cliIconForAgentPane',
  'siClaudecode',
  'siGooglegemini',
  'OpenAiLogo',
  'pane.data?.dockExpandedToTab === true',
]) {
  assert.ok(workspaceGrid.includes(required), `WorkspaceGrid should include ${required}`);
}

for (const required of [
  '.td-agent-slash-menu',
  '.td-agent-slash-option.is-current',
  '.td-agent-slash-option:disabled',
  '.td-agent-slash-icon',
  '.td-agent-brand-logo',
  '.td-followup-menu-meta',
  'font-size: 10.5px',
  'font-weight: 650',
  'line-height: 1.28',
  '.td-agent-slash-option',
  '.td-agent-slash-command',
  '.td-agent-slash-hint',
  '.td-agent-window-tab .td-agent-prompt-pill',
  '.td-agent-footer-compartment',
  '.td-agent-footer-logo',
  'font-family: "Cascadia Mono"',
  '.td-agent-run-group',
  '.td-agent-turn-summary-pills',
  '.td-agent-turn-summary button',
  '.td-agent-turn-token-usage',
  '.td-agent-turn-filtered-work',
  '.td-agent-slash-current',
  '.td-agent-slash-current code',
  '.td-agent-change-summary-card',
  '.td-agent-live-code-changes',
  '.td-agent-diff-line.is-added',
  '.td-agent-diff-line.is-removed',
  '.td-agent-tool-row',
  '.td-agent-tool-copy strong',
  '.td-agent-work-item-copy strong',
  'flex: 0 0 auto;',
  '.td-agent-window-tab .td-agent-chat-area.has-messages',
  '-webkit-mask-image: linear-gradient(',
  '.td-agent-window-tab .td-agent-prompt-pill',
  '.td-followup-glass',
  'z-index: 50;',
  '.td-agent-permission-popup',
  '.td-agent-permission-live-status',
  'bottom: calc(100% + 8px);',
  '.td-agent-permission-popup-option',
  'width: min(1100px, calc(100% - 24px));',
  'border-radius: 18px;',
  '.td-agent-window-tab .td-agent-permission-mode-label',
  '.td-agent-window-tab .td-agent-refresh-button span',
  'font-size: inherit;',
  '.td-agent-queued-messages',
  '.td-agent-queued-message',
  '.td-agent-queued-grip',
  '.td-agent-queued-steer',
  '--td-agent-queued-visible: 3;',
  '.td-agent-usage-popover',
  '.td-agent-usage-card',
  '.td-agent-usage-progress',
  '.td-agent-usage-row-top strong',
  '.td-agent-system-notice',
]) {
  assert.ok(css.includes(required), `App.css should style ${required}`);
}

for (const required of [
  "listen<string | { changedDir?: string; paths?: string[] }>('fs-change'",
  'event.payload.changedDir?.trim()',
  'const sameFile = changedPaths.some',
  "editorReloadToken: `fs-${Date.now()}`",
]) {
  assert.ok(editorPane.includes(required), `EditorPane should live-reload external file edits via ${required}`);
}

for (const required of [
  'CODEX_UPDATE_PROMPT_RE',
  'Update available(?:[!:]|\\s)',
  'requestRuntimePermission(session, permission.request)',
  'session.adapter.detectPermissionRequest(output)',
  "await writeToTerminal(terminalId, '2\\r')",
  'return existing;',
  'buildCodexInteractiveLaunchArgs({',
]) {
  assert.ok(runtimeManager.includes(required), `RuntimeManager should route Codex update prompts with ${required}`);
}

assert.ok(
  cliCommandBuilders.includes('mcp_servers.terminal-docks.enabled=false'),
  'Codex command builder should disable the noisy terminal-docks global MCP for app-launched sessions',
);

assert.ok(
  cliCommandBuilders.includes('mcp_servers.node_repl.enabled=false'),
  'Codex command builder should disable the noisy node_repl global MCP for app-launched sessions',
);

assert.ok(
  cliCommandBuilders.includes("'--disable',") && cliCommandBuilders.includes("'apps',"),
  'Codex command builder should disable built-in Codex app tools for app-launched sessions',
);

assert.ok(
  !runtimeManager.includes('disableKnownGlobalMcps: false'),
  'RuntimeManager Codex launches should not opt back into noisy global MCP startup',
);

for (const required of [
  'setSessionPermissionMode(args: SetPermissionModeArgs)',
  'buildCodexPermissionModeInput',
  "'\\x15/permissions\\r'",
  'session.setPermissionMode(targetMode)',
  'buildClaudePermissionModeInput',
  "'acceptEdits'",
  'buildGeminiPermissionModeInput',
  "'auto_edit'",
]) {
  assert.ok(runtimeManager.includes(required), `RuntimeManager should support live permission switching with ${required}`);
}

assert.ok(
  cliCommandBuilders.includes("'--allow-dangerously-skip-permissions'"),
  'Claude interactive launch should expose bypass as a live-cycle option without starting in bypass mode',
);

for (const required of [
  'captureFollowUpWorkspaceSnapshot',
  'diffFollowUpWorkspaceSnapshots',
  'formatFollowUpCodeChangeContent',
  'collectAppliedCodeChangeSummaries',
  'beginFollowUpFileTracking',
  'refreshFollowUpLiveFileChanges',
  'scheduleFollowUpLiveFileChangeRefresh',
  'publishFollowUpFileChanges',
  'publishRuntimeToolActivity',
  'parseRuntimeToolActivity',
  'sanitizeRuntimeOutputChunkForFollowUp',
  'CodexRuntimeOutputState',
  'processCodexRuntimeLine',
  'processCodexJsonRuntimeLine',
  "itemType === 'command_execution'",
  "itemType === 'file_change'",
  "itemType === 'mcp_tool_call'",
  "kind: 'session_title'",
  'rememberFollowUpSession({',
  'CODEX_COMMAND_START_RE',
  'CODEX_COMMAND_REJECTED_RE',
  'updateCodexCommandRecordStatus',
  '(?:WARN|ERROR)\\s+codex_',
  'completeRunningCodexCommands',
  'commandRecordToWorkEvent',
  'CODEX_HIDDEN_PROMPT_ECHO_PATTERNS',
  'CODEX_TUI_REDRAW_FRAGMENT_RE',
  'stripCodexPromptPlaceholderFromLine',
  'Implement\\s+\\{feature\\}',
  'Workspace agent for',
  'User follow-up:',
  'runtimeOutputDisplaySessionsRef',
  'runtimeOutputPendingLinesRef',
  'runtimeOutputLastEntryKindRef',
  'runtimeOutputDisplaySessionsRef.current.add(event.sessionId)',
  'AgentChangeSummaryCard changes={appliedChanges}',
  'messages.map(message => {',
  'if (workItem) return <AgentWorkItemCard key={message.id} item={workItem} />;',
  'await beginFollowUpFileTracking(sessionId)',
  'void publishFollowUpFileChanges(event.sessionId',
]) {
  assert.ok(source.includes(required), `MissionControlPane should track live runtime activity and file changes with ${required}`);
}

assert.ok(
  source.includes('AgentPermissionPopup') &&
    source.includes('const permissionPopup = activePermission && selectedSessionId') &&
    source.includes("setFollowUpBusyState(event.sessionId, 'awaiting_permission')") &&
    source.includes('const permissionLiveStatusActive = Boolean(activePermission)') &&
    source.includes('&& (permissionLiveStatusActive || !selectedSessionVisiblySettled)') &&
    source.includes('elapsedSeconds={runtimeLiveStatusElapsedSeconds}') &&
    source.includes('Waiting for permission') &&
    !source.includes('AgentPermissionDock') &&
    !css.includes('.td-agent-permission-dock'),
  'MissionControlPane should render permission requests as a prompt-anchored popup while preserving the live status row',
);

assert.ok(
  source.includes('suppressingHiddenContextEcho') &&
    source.includes('suppressingUserPromptEcho') &&
    source.includes('isCodexHiddenContextEchoStart') &&
    source.includes('isCodexUserPromptEchoStart') &&
    source.includes('Previous follow-up context for continuity only') &&
    source.includes('Do not quote,\\s+restate,\\s+or summarize this context'),
  'MissionControlPane should suppress echoed hidden continuity context and user prompt text during live Codex output',
);

assert.ok(
  /if \(isCodexPermissionPromptStart\(clean\)\) \{\s*state\.skippingPermissionPrompt = true;\s*return \{\};\s*\}/.test(source),
  'Codex permission prompts should not mark the pending command as completed before the user approves it',
);

assert.ok(
  !source.includes('Runtime session failed: ${event.error}') &&
    !source.includes('Runtime session completed with ${event.outcome}.') &&
    !source.includes('Sent to runtime session ${event.sessionId}.'),
  'MissionControlPane should not render runtime plumbing events as agent chat output',
);

assert.ok(
  runtimeManager.includes('CODEX_MANAGED_INJECTION_READY_WAIT_MS') &&
    runtimeManager.includes('managedInjectionReadyWaitMsForCli(session.cliId)') &&
    !runtimeManager.includes("waitForManagedInjectionReadyOrThrow(session, CLI_READY_WAIT_MS, 'sendTask')"),
  'RuntimeManager sendTask should use CLI-specific managed injection readiness waits',
);

assert.ok(
  runtimeManager.includes("session.missionId.startsWith('adhoc-followup-')") &&
    runtimeManager.includes('const launch = buildPtyLaunchCommandParts(session.cliId') &&
    runtimeManager.includes('launchedDirectCli') &&
    runtimeManager.includes('managedInjectionReadyWaitMsForCli(session.cliId)') &&
    runtimeManager.includes('for ad-hoc follow-up.') &&
    runtimeManager.includes("session.transitionTo('ready')") &&
    runtimeManager.includes("message: `CLI ${session.cliId} reported ready for ad-hoc follow-up") &&
    runtimeManager.includes("type: 'task_acked'"),
  'RuntimeManager should skip workflow MCP bootstrap and synthesize task ack for ad-hoc agent-window follow-ups',
);

for (const required of [
  'startToolActivity',
  "status: 'running'",
  'id: toolRunId',
]) {
  assert.ok(sdkChat.includes(required), `sdkChat should emit live tool activity with ${required}`);
}

assert.ok(
  packageJson.includes('node ./tests/agentSlashCommands.test.mjs') &&
    packageJson.includes('node ./tests/agentWindowSlashCommandsUiSmoke.test.mjs'),
  'test:graph should run agent slash command coverage',
);

console.log('PASS agent window slash command UI smoke coverage');
