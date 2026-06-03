import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { MockLanguageModelV3, simulateReadableStream } from 'ai/test';

const {
  applyExactEdits,
  createOpenAiSdkFetch,
  createSdkAbortScope,
  createSdkReadFileResult,
  createSdkReadWindow,
  createSdkUserContent,
  createUnifiedDiff,
  extractSdkCommandExitCode,
  formatSdkAttachmentContext,
  formatSdkCommandSuggestionContent,
  formatSdkCommandProposalResult,
  formatSdkActionProposalResultForModel,
  formatSdkAppActionResultContent,
  formatSdkDirectoryProposalContent,
  formatSdkDirtyEditorContext,
  formatSdkEnvironmentContext,
  formatSdkPatchProposalContent,
  formatSdkPatchProposalResultForModel,
  formatSdkPreviewProposalContent,
  formatSdkProjectMemoryContext,
  formatSdkOperatingInstructions,
  formatSdkTerminalLogResult,
  formatSdkTerminalStopProposalContent,
  formatSdkTodoWriteResult,
  formatSdkTodoWriteContent,
  inferSdkImageMediaType,
  isSdkSensitivePath,
  matchesSdkGlobPattern,
  normalizeOpenAiSdkBaseUrl,
  normalizeSdkPreviewUrl,
  normalizeSdkCommandSuggestion,
  normalizeSdkTerminalContexts,
  normalizeSdkTodoItems,
  normalizeOpenAiSdkModel,
  readSdkWorkspaceTextFile,
  runSdkChat,
  resolveSdkWorkspacePath,
  resolveSdkWorkspacePathFromBase,
  SDK_MAX_AGENT_STEPS,
  SDK_APPROVAL_CARD_TOOLS,
  SDK_REQUEST_TIMEOUT_MS,
  SDK_SUBAGENT_MAX_STEPS,
  sdkApprovalCardIsPending,
  sdkSubagentSystemPrompt,
  validateSdkShellCommand,
  validateSdkPreviewUrl,
  validateSdkTodoItems,
  formatSdkUsageSummary,
} = await import('../.tmp-tests/lib/sdkChat.js');
const {
  CHANGE_REVIEW_APPLIED_EVENT,
  formatChangeReviewAppliedActionContent,
} = await import('../.tmp-tests/lib/changeReviewEvents.js');
const {
  buildCodexCliJsonRunRequest,
  parseCodexJsonEventLine,
} = await import('../.tmp-tests/lib/codexCliJsonTransport.js');
const {
  SDK_COMMAND_EXIT_MARKER,
  detectSdkTerminalPlatform,
  encodeSdkPowerShellCommand,
  formatSdkTerminalRunCommand,
  isSdkPowerShellLanguage,
} = await import('../.tmp-tests/lib/sdkCommandMarkers.js');
const {
  buildSdkArtifactToolMessageFields,
  buildSdkCardResolutionMap,
  buildSdkCommandCompletionResult,
  buildSdkDeniedActionResult,
  buildSdkFollowUpMessagesForRun,
  followUpToolMessageHasInteractiveSdkContent,
  getSdkAutoContinueFlushPrompt,
  resolveSdkCardResolution,
  sdkCardIdResolutionKey,
  sdkCardResolutionKey,
  sdkToolHistoryMessageIsDurable,
  shouldSuppressEmptySdkAssistantMessage,
  shouldQueueSdkAutoContinue,
} = await import('../.tmp-tests/lib/sdkChatUiLifecycle.js');
const {
  markCachedEditorDirty,
  resetEditorSessionCacheForTests,
} = await import('../.tmp-tests/lib/editorSessionCache.js');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run('normalizes OpenAI SDK model ids and strips provider prefix', () => {
  assert.equal(normalizeOpenAiSdkModel(''), 'gpt-5-mini');
  assert.equal(normalizeOpenAiSdkModel('openai/gpt-5.2'), 'gpt-5.2');
  assert.equal(normalizeOpenAiSdkModel('gpt-4.1-mini'), 'gpt-4.1-mini');
  assert.equal(normalizeOpenAiSdkModel('o4-mini'), 'o4-mini');
  assert.equal(normalizeOpenAiSdkModel('claude-opus-4-1'), 'gpt-5-mini');
});

run('builds Codex CLI JSON transport requests for no-key chat', () => {
  const request = buildCodexCliJsonRunRequest({
    prompt: 'hello',
    workspaceDir: 'C:/repo',
    model: 'gpt-5.2',
    missionId: 'mission-1',
    nodeId: 'followup:builder:mission-1',
    agentId: 'followup:builder:mission-1',
    sessionId: 'codex-cli:thread-1',
    runId: 'codex-cli-run-1',
  });
  assert.equal(request.command, 'codex');
  assert.deepEqual(request.args, [
    'exec',
    '--json',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--model',
    'gpt-5.2',
    '--cd',
    'C:/repo',
  ]);
  assert.equal(request.promptDelivery, 'stdin');
  assert.equal(request.prompt, 'hello');
  assert.equal(request.cli, 'codex');
  assert.equal(request.executionMode, 'streaming_headless');
});

run('maps Codex CLI JSON permission modes to official flags', () => {
  const base = {
    prompt: 'hello',
    workspaceDir: 'C:/repo',
    model: 'gpt-5.2',
    missionId: 'mission-1',
    nodeId: 'followup:builder:mission-1',
    agentId: 'followup:builder:mission-1',
    sessionId: 'codex-cli:thread-1',
    runId: 'codex-cli-run-1',
  };

  assert.deepEqual(buildCodexCliJsonRunRequest({ ...base, permissionMode: 'restricted' }).args, [
    'exec',
    '--json',
    '--color',
    'never',
    '--skip-git-repo-check',
    '--sandbox',
    'read-only',
    '--model',
    'gpt-5.2',
    '--cd',
    'C:/repo',
  ]);
  assert.equal(
    buildCodexCliJsonRunRequest({ ...base, permissionMode: 'full' }).args.includes('--dangerously-bypass-approvals-and-sandbox'),
    true,
  );
});

run('parses Codex CLI JSON events into professional chat events', () => {
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    type: 'turn.started',
  })), { kind: 'step', label: 'Thinking' });
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    type: 'response.output_text.delta',
    delta: 'Hello',
  })), { kind: 'delta', text: 'Hello' });
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    type: 'item.completed',
    item: { type: 'assistant_message', text: 'Final answer' },
  })), { kind: 'final', text: 'Final answer' });
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    type: 'item.completed',
    item: { type: 'agent_message', text: 'Actual Codex answer' },
  })), { kind: 'final', text: 'Actual Codex answer' });
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    type: 'turn.completed',
  })), { kind: 'done' });
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    type: 'tool.completed',
    item: { type: 'tool_call', name: 'shell', command: 'npm test', status: 'completed' },
  })), { kind: 'tool', toolName: 'shell', label: 'shell', detail: 'npm test', status: 'completed' });
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    type: ' turn.started ',
  })), { kind: 'step', label: 'Thinking' });
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    type: ' tool.completed ',
    item: { type: ' tool_call ', name: ' shell ', command: ' npm test ', status: ' success ' },
  })), { kind: 'tool', toolName: 'shell', label: 'shell', detail: 'npm test', status: 'completed' });
  assert.deepEqual(parseCodexJsonEventLine(JSON.stringify({
    method: 'item/fileChange/patchUpdated',
    params: {
      itemId: 'edit-1',
      changes: [
        { path: 'src/app.ts', diff: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new' },
      ],
    },
  })), {
    kind: 'tool',
    id: 'edit-1',
    toolName: 'apply_patch',
    label: 'Edit',
    detail: 'src/app.ts',
    output: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new',
    changes: [{ path: 'src/app.ts', diff: 'diff --git a/src/app.ts b/src/app.ts\n@@ -1 +1 @@\n-old\n+new' }],
    status: 'running',
  });
  assert.deepEqual(parseCodexJsonEventLine('[agent-run] launch'), { kind: 'none' });
});

run('normalizes OpenAI SDK base URLs for local OpenAI-compatible testing', () => {
  assert.equal(normalizeOpenAiSdkBaseUrl(''), undefined);
  assert.equal(normalizeOpenAiSdkBaseUrl('  https://api.openai.com/v1///  '), 'https://api.openai.com/v1');
  assert.equal(normalizeOpenAiSdkBaseUrl('http://127.0.0.1:8787/v1/'), 'http://127.0.0.1:8787/v1');
  assert.throws(() => normalizeOpenAiSdkBaseUrl('file:///tmp/openai'), /http or https/);
  assert.throws(() => normalizeOpenAiSdkBaseUrl('not a url'), /valid http\(s\) URL/);
});

run('uses a Terax-sized SDK step budget', () => {
  assert.equal(SDK_MAX_AGENT_STEPS, 24);
  assert.equal(SDK_SUBAGENT_MAX_STEPS, 12);
  assert.equal(SDK_REQUEST_TIMEOUT_MS, 120_000);
  assert.deepEqual(SDK_APPROVAL_CARD_TOOLS, ['edit', 'multi_edit', 'write_file', 'propose_patch', 'create_directory', 'bash_run', 'bash_background', 'bash_kill', 'open_preview', 'suggest_command']);
});

run('builds read-only SDK subagent prompts by type', () => {
  assert.match(sdkSubagentSystemPrompt('explore'), /read-only exploration subagent/);
  assert.match(sdkSubagentSystemPrompt('review'), /code-review subagent/);
  assert.match(sdkSubagentSystemPrompt('security'), /security-review subagent/);
  assert.match(sdkSubagentSystemPrompt('research'), /Do not edit files or run commands/);
});

run('formats Terax-style SDK operating instructions', () => {
  const instructions = formatSdkOperatingInstructions();
  assert.match(instructions, /Execute, do not echo/);
  assert.match(instructions, /approval card is the confirmation/);
  assert.match(instructions, /Chain actions until done/);
  assert.match(instructions, /Ask only when genuinely stuck/);
  assert.match(instructions, /Approval cards are stop points/);
  for (const toolName of SDK_APPROVAL_CARD_TOOLS) {
    assert.match(instructions, new RegExp(`\\b${toolName}\\b`));
  }
  assert.match(instructions, /wait for an Action result from the app/);
  assert.match(instructions, /automatically resume/);
  assert.match(instructions, /command started.*bash_logs.*Terminal ID/);
  assert.match(instructions, /commandFinished and commandExitCode/);
  assert.match(instructions, /__COMET_COMMAND_EXIT:<code>/);
  assert.match(instructions, /patch_review started.*only opened/);
  assert.match(instructions, /patch_review completed/);
  assert.match(instructions, /Before five or more tool calls.*todo_write/);
  assert.match(instructions, /replaces the full visible list/);
  assert.match(instructions, /at most one item in_progress/);
});

run('suppresses empty SDK assistant bubbles only when an approval card is visible', () => {
  assert.equal(shouldSuppressEmptySdkAssistantMessage({
    finalText: '',
    streamedContent: '',
    emittedApprovalCard: true,
  }), true);
  assert.equal(shouldSuppressEmptySdkAssistantMessage({
    finalText: 'Patch is ready.',
    streamedContent: '',
    emittedApprovalCard: true,
  }), false);
  assert.equal(shouldSuppressEmptySdkAssistantMessage({
    finalText: '',
    streamedContent: '',
    emittedApprovalCard: false,
  }), false);
});

run('queues SDK auto-continue only when the OpenAI SDK path can send', () => {
  assert.equal(shouldQueueSdkAutoContinue({ selectedCli: 'codex', hasApiKey: true }), true);
  assert.equal(shouldQueueSdkAutoContinue({ selectedCli: 'codex', hasApiKey: false }), false);
  assert.equal(shouldQueueSdkAutoContinue({ selectedCli: 'claude', hasApiKey: true }), false);
});

run('flushes pending SDK auto-continue only after the current send is idle', () => {
  assert.equal(getSdkAutoContinueFlushPrompt({
    pendingPrompt: 'continue from the command result',
    submitting: false,
    selectedCli: 'codex',
    hasApiKey: true,
  }), 'continue from the command result');
  assert.equal(getSdkAutoContinueFlushPrompt({
    pendingPrompt: 'continue from the command result',
    submitting: true,
    selectedCli: 'codex',
    hasApiKey: true,
  }), null);
  assert.equal(getSdkAutoContinueFlushPrompt({
    pendingPrompt: 'continue from the command result',
    submitting: false,
    selectedCli: 'codex',
    hasApiKey: false,
  }), null);
  assert.equal(getSdkAutoContinueFlushPrompt({
    pendingPrompt: 'continue from the command result',
    submitting: false,
    selectedCli: 'gemini',
    hasApiKey: true,
  }), null);
  assert.equal(getSdkAutoContinueFlushPrompt({
    pendingPrompt: '   ',
    submitting: false,
    selectedCli: 'codex',
    hasApiKey: true,
  }), null);
});

run('builds SDK command completion action results from terminal exit codes', () => {
  const started = {
    kind: 'command',
    status: 'started',
    target: 'sdk-command-1',
    command: 'npm test',
    action: 'run',
    terminalId: 'sdk-command-1',
  };
  assert.deepEqual(buildSdkCommandCompletionResult(started, 0), {
    ...started,
    status: 'completed',
    error: undefined,
  });
  assert.deepEqual(buildSdkCommandCompletionResult(started, 2), {
    ...started,
    status: 'failed',
    error: 'Command exited with code 2',
  });
});

run('builds SDK denial action results for approval-card resume', () => {
  assert.deepEqual(buildSdkDeniedActionResult({
    kind: 'command',
    target: 'npm test',
    command: 'npm test',
    action: 'run',
  }), {
    kind: 'command',
    status: 'failed',
    target: 'npm test',
    command: 'npm test',
    action: 'run',
    error: 'User denied this action.',
  });
  assert.deepEqual(buildSdkDeniedActionResult({
    kind: 'patch_review',
    title: 'Review patch',
    target: 'src/App.tsx',
    error: 'Skipped by user.',
  }), {
    kind: 'patch_review',
    status: 'failed',
    title: 'Review patch',
    target: 'src/App.tsx',
    error: 'Skipped by user.',
  });
});

run('builds persisted SDK card resolutions from action-result messages', () => {
  const resolutions = buildSdkCardResolutionMap([
    {
      content: formatSdkAppActionResultContent({
        kind: 'preview',
        status: 'completed',
        cardId: 'agent-1:0',
        title: 'Preview',
        target: 'http://localhost:5173',
      }),
    },
    {
      content: formatSdkAppActionResultContent({
        kind: 'command',
        status: 'started',
        target: 'sdk-command-abc123',
        command: 'npm run build',
        action: 'background',
        terminalId: 'sdk-command-abc123',
      }),
    },
    {
      content: formatSdkAppActionResultContent({
        kind: 'patch_review',
        status: 'failed',
        title: 'Review patch',
        target: 'src/App.tsx',
        error: 'User denied this action.',
      }),
    },
  ]);
  assert.deepEqual(resolutions.get(sdkCardResolutionKey('preview', 'http://localhost:5173')), {
    status: 'completed',
    label: 'completed',
  });
  assert.deepEqual(resolutions.get(sdkCardIdResolutionKey('agent-1:0')), {
    status: 'completed',
    label: 'completed',
  });
  assert.deepEqual(resolutions.get(sdkCardResolutionKey('command', 'sdk-command-abc123')), {
    status: 'started',
    label: 'started',
  });
  assert.deepEqual(resolutions.get(sdkCardResolutionKey('command', 'npm run build')), {
    status: 'started',
    label: 'started',
  });
  assert.deepEqual(resolutions.get(sdkCardResolutionKey('patch_review', 'src/App.tsx')), {
    status: 'failed',
    label: 'denied/failed',
  });
});

run('resolves SDK cards by stable card id before duplicate fallback targets', () => {
  const resolutions = buildSdkCardResolutionMap([
    {
      content: formatSdkAppActionResultContent({
        kind: 'patch_review',
        status: 'failed',
        cardId: 'agent-message-1:0',
        title: 'Reject first patch',
        target: 'src/App.tsx',
        error: 'Not this one.',
      }),
    },
    {
      content: formatSdkAppActionResultContent({
        kind: 'patch_review',
        status: 'completed',
        cardId: 'agent-message-2:0',
        title: 'Accept second patch',
        target: 'src/App.tsx',
      }),
    },
  ]);

  assert.deepEqual(resolveSdkCardResolution(resolutions, {
    cardId: 'agent-message-1:0',
    kind: 'patch_review',
    target: 'src/App.tsx',
  }), {
    status: 'failed',
    label: 'denied/failed',
  });
  assert.deepEqual(resolveSdkCardResolution(resolutions, {
    cardId: 'agent-message-2:0',
    kind: 'patch_review',
    target: 'src/App.tsx',
  }), {
    status: 'completed',
    label: 'completed',
  });
  assert.deepEqual(resolveSdkCardResolution(resolutions, {
    kind: 'patch_review',
    target: 'src/App.tsx',
  }), {
    status: 'completed',
    label: 'completed',
  });
});

run('only pauses SDK loop for approval tools with pending approval output', () => {
  assert.equal(sdkApprovalCardIsPending({ steps: [] }), false);
  assert.equal(sdkApprovalCardIsPending({
    steps: [{
      toolResults: [{
        toolName: 'bash_run',
        output: { error: 'Use bash_background for dev servers.' },
      }],
    }],
  }), false);
  assert.equal(sdkApprovalCardIsPending({
    steps: [{
      toolResults: [{
        toolName: 'bash_run',
        output: { approvalRequired: true, command: 'npm run build' },
      }],
    }],
  }), true);
  assert.equal(sdkApprovalCardIsPending({
    steps: [{
      toolResults: [{
        toolName: 'read_file',
        output: { queued_for_review: true },
      }],
    }],
  }), false);
});

run('resolves SDK workspace paths inside the selected root', () => {
  assert.equal(
    resolveSdkWorkspacePath('C:/repo/project', 'src/App.tsx'),
    'C:/repo/project\\src/App.tsx',
  );
  assert.equal(
    resolveSdkWorkspacePath('C:/repo/project', 'C:/repo/project/src/App.tsx'),
    'C:/repo/project/src/App.tsx',
  );
});

run('resolves relative SDK paths against active terminal cwd when available', () => {
  assert.equal(
    resolveSdkWorkspacePathFromBase('C:/repo/project', 'App.tsx', 'C:/repo/project/src'),
    'C:/repo/project/src\\App.tsx',
  );
  assert.throws(
    () => resolveSdkWorkspacePathFromBase('C:/repo/project', 'App.tsx', 'C:/repo/other'),
    /Base directory is outside the workspace root/,
  );
});

run('rejects SDK paths outside workspace or using traversal', () => {
  assert.throws(
    () => resolveSdkWorkspacePath('C:/repo/project', 'C:/repo/other.txt'),
    /outside the workspace root/,
  );
  assert.throws(
    () => resolveSdkWorkspacePath('C:/repo/project', '../secrets.txt'),
    /traversal/,
  );
});

run('rejects obvious sensitive SDK paths', () => {
  assert.equal(isSdkSensitivePath('src/App.tsx'), false);
  assert.equal(isSdkSensitivePath('.env'), true);
  assert.equal(isSdkSensitivePath('config/.env.local'), true);
  assert.equal(isSdkSensitivePath('C:/Users/me/.ssh/id_ed25519'), true);
  assert.throws(
    () => resolveSdkWorkspacePath('C:/repo/project', '.env.local'),
    /Sensitive paths/,
  );
});

run('creates SDK read windows with line metadata', () => {
  assert.deepEqual(createSdkReadWindow('a\nb\nc\nd\n', { offset: 1, limit: 2 }), {
    content: 'b\nc',
    totalLines: 4,
    startLine: 1,
    endLine: 3,
    truncated: true,
  });
  assert.deepEqual(createSdkReadWindow('a\nb', { offset: 10, limit: 2 }), {
    content: '',
    totalLines: 2,
    startLine: 2,
    endLine: 2,
    truncated: false,
  });
});

run('returns unchanged for repeated full SDK reads without re-emitting content', () => {
  const cache = new Map();
  const first = createSdkReadFileResult({
    path: 'C:/repo/src/App.tsx',
    source: 'disk',
    content: 'hello\nworld',
    window: createSdkReadWindow('hello\nworld'),
    cache,
    cacheKey: 'C:/repo/src/App.tsx',
  });
  assert.equal(first.unchanged, undefined);
  assert.equal(first.content, 'hello\nworld');
  const second = createSdkReadFileResult({
    path: 'C:/repo/src/App.tsx',
    source: 'disk',
    content: 'hello\nworld',
    window: createSdkReadWindow('hello\nworld'),
    cache,
    cacheKey: 'C:/repo/src/App.tsx',
  });
  assert.deepEqual(second, {
    path: 'C:/repo/src/App.tsx',
    source: 'disk',
    unchanged: true,
    size: 11,
    hint: 'Use the previous read_file result for this path; content has not changed.',
  });
});

run('creates reviewable whole-file unified diff for edits', () => {
  const diff = createUnifiedDiff('src/App.tsx', 'one\nold\n', 'one\nnew\n', false);
  assert.match(diff, /^diff --git a\/src\/App\.tsx b\/src\/App\.tsx/m);
  assert.match(diff, /^--- a\/src\/App\.tsx/m);
  assert.match(diff, /^\+\+\+ b\/src\/App\.tsx/m);
  assert.match(diff, /^-old$/m);
  assert.match(diff, /^\+new$/m);
});

run('creates reviewable unified diff for new files', () => {
  const diff = createUnifiedDiff('notes/new file.md', '', '# Notes\n', true);
  assert.match(diff, /^new file mode 100644$/m);
  assert.match(diff, /^--- \/dev\/null$/m);
  assert.match(diff, /^\+\+\+ b\/notes\/new file\.md$/m);
  assert.match(diff, /^\+# Notes$/m);
});

run('applies exact edits in order', () => {
  const result = applyExactEdits('one\ntwo\nthree\n', [
    { oldString: 'two', newString: 'TWO' },
    { oldString: 'three', newString: 'THREE' },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.content, 'one\nTWO\nTHREE\n');
  assert.equal(result.replacements, 2);
});

run('rejects non-unique exact edits without replace_all', () => {
  const result = applyExactEdits('same\nsame\n', [
    { oldString: 'same', newString: 'changed' },
  ]);
  assert.equal(result.ok, false);
  assert.match(result.error, /not unique/);
});

run('supports replace_all exact edits', () => {
  const result = applyExactEdits('same\nsame\n', [
    { oldString: 'same', newString: 'changed', replaceAll: true },
  ]);
  assert.equal(result.ok, true);
  assert.equal(result.content, 'changed\nchanged\n');
  assert.equal(result.replacements, 2);
});

run('normalizes and serializes SDK todo_write content', () => {
  const todos = normalizeSdkTodoItems([
    { title: '  Inspect reference  ', status: 'completed' },
    { title: '', status: 'pending' },
    { title: 'Wire SDK tool', status: 'in_progress', description: '  Render as card  ' },
  ]);
  assert.deepEqual(todos, [
    { title: 'Inspect reference', status: 'completed', description: undefined },
    { title: 'Wire SDK tool', status: 'in_progress', description: 'Render as card' },
  ]);
  assert.deepEqual(JSON.parse(formatSdkTodoWriteContent(todos)), {
    toolName: 'todo_write',
    input: {
      todos: [
        { title: 'Inspect reference', status: 'completed' },
        { title: 'Wire SDK tool', status: 'in_progress', description: 'Render as card' },
      ],
    },
  });
});

run('returns structured SDK todo_write results for model follow-up', () => {
  assert.deepEqual(
    formatSdkTodoWriteResult([
      { title: 'Inspect SDK send path', status: 'completed' },
      { title: 'Patch tool result shape', status: 'in_progress', description: 'Keep model loop grounded.' },
      { title: 'Verify build', status: 'pending' },
    ]),
    {
      ok: true,
      todos: [
        { title: 'Inspect SDK send path', status: 'completed', description: undefined },
        { title: 'Patch tool result shape', status: 'in_progress', description: 'Keep model loop grounded.' },
        { title: 'Verify build', status: 'pending', description: undefined },
      ],
      total: 3,
      completed: 1,
      in_progress: 1,
      pending: 1,
      inProgressTitle: 'Patch tool result shape',
      hint: 'The visible agent to-do list has been updated. Keep it current as work progresses.',
    },
  );
});

run('validates SDK todo_write anti-drift invariants', () => {
  assert.equal(validateSdkTodoItems([
    { title: 'One', status: 'in_progress' },
    { title: 'Two', status: 'pending' },
  ]), null);
  assert.match(validateSdkTodoItems([
    { title: 'One', status: 'in_progress' },
    { title: 'Two', status: 'in_progress' },
  ]), /only one todo may be in_progress/);
});

run('formats SDK command suggestions as visible command content', () => {
  const suggestion = normalizeSdkCommandSuggestion({
    command: '  npm run test:graph  ',
    reason: '  Verify SDK chat behavior  ',
    cwd: '  C:/VSCODE/comet-ai  ',
  });
  assert.deepEqual(suggestion, {
    command: 'npm run test:graph',
    reason: 'Verify SDK chat behavior',
    cwd: 'C:/VSCODE/comet-ai',
    action: 'insert',
  });
  assert.equal(
    formatSdkCommandSuggestionContent(suggestion),
    'Suggested command\n\nReason: Verify SDK chat behavior\n\nWorking directory: C:/VSCODE/comet-ai\n\n```bash\nnpm run test:graph\n```',
  );
});

run('wraps SDK run commands with terminal exit markers', () => {
  assert.equal(SDK_COMMAND_EXIT_MARKER, '__COMET_COMMAND_EXIT');
  assert.equal(detectSdkTerminalPlatform('Mozilla/5.0 Windows NT 10.0'), 'windows');
  assert.equal(detectSdkTerminalPlatform('Mozilla/5.0 X11; Linux x86_64'), 'posix');
  assert.equal(
    formatSdkTerminalRunCommand('npm run build', 'windows'),
    'npm run build & call echo __COMET_COMMAND_EXIT:%^ERRORLEVEL%',
  );
  assert.equal(
    formatSdkTerminalRunCommand('npm test', 'posix'),
    'npm test; printf \'\\n__COMET_COMMAND_EXIT:%s\\n\' "$?"',
  );
  assert.equal(
    formatSdkTerminalRunCommand('npm test & echo __COMET_COMMAND_EXIT:%ERRORLEVEL%', 'windows'),
    'npm test & echo __COMET_COMMAND_EXIT:%ERRORLEVEL%',
  );
  assert.equal(isSdkPowerShellLanguage('powershell'), true);
  assert.equal(isSdkPowerShellLanguage('pwsh'), true);
  assert.equal(isSdkPowerShellLanguage('bash'), false);
  assert.equal(encodeSdkPowerShellCommand('Write-Output "ok"'), 'VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAiAG8AawAiAA==');
  assert.equal(
    formatSdkTerminalRunCommand('Write-Output "ok"', 'windows', 'powershell'),
    'powershell.exe -NoProfile -ExecutionPolicy Bypass -EncodedCommand VwByAGkAdABlAC0ATwB1AHQAcAB1AHQAIAAiAG8AawAiAA== & call echo __COMET_COMMAND_EXIT:%^ERRORLEVEL%',
  );
});

run('formats SDK command run proposals as distinct durable content', () => {
  assert.equal(
    formatSdkCommandSuggestionContent({
      command: 'npm run build',
      reason: 'Verify production bundle',
      cwd: 'C:/VSCODE/comet-ai',
      action: 'run',
    }),
    'Command proposed\n\nReason: Verify production bundle\n\nWorking directory: C:/VSCODE/comet-ai\n\n```bash\nnpm run build\n```',
  );
});

run('returns structured SDK command proposal results for model follow-up', () => {
  assert.deepEqual(
    formatSdkCommandProposalResult({
      command: ' npm run build ',
      reason: ' Verify production bundle ',
      cwd: ' C:/repo ',
      action: 'run',
    }),
    {
      command: 'npm run build',
      action: 'run',
      reason: 'Verify production bundle',
      cwd: 'C:/repo',
      approvalRequired: true,
      executed: false,
      hint: 'A command card has been shown. The command will not run until the user clicks Run.',
    },
  );
  assert.deepEqual(
    formatSdkCommandProposalResult({ command: 'git status', action: 'insert' }),
    {
      command: 'git status',
      action: 'insert',
      reason: undefined,
      cwd: undefined,
      approvalRequired: false,
      executed: false,
      hint: 'A command card has been shown. The command has not run.',
    },
  );
});

run('formats SDK background command proposals as distinct durable content', () => {
  assert.equal(
    formatSdkCommandSuggestionContent({
      command: 'npm run dev',
      reason: 'Start local dev server',
      cwd: 'C:/VSCODE/comet-ai',
      action: 'background',
    }),
    'Background command proposed\n\nReason: Start local dev server\n\nWorking directory: C:/VSCODE/comet-ai\n\n```bash\nnpm run dev\n```',
  );
});

run('rejects unsafe SDK command card inputs', () => {
  assert.equal(validateSdkShellCommand('npm run build'), null);
  assert.match(validateSdkShellCommand('npm run build\nwhoami'), /single line/);
  assert.match(validateSdkShellCommand('vim src/App.tsx'), /interactive/);
  assert.match(validateSdkShellCommand('npm run dev'), /dev servers/);
  assert.equal(validateSdkShellCommand('npm run dev', { allowLongRunning: true }), null);
});

run('formats SDK usage summaries for compact status display', () => {
  assert.equal(formatSdkUsageSummary({ inputTokens: 950, outputTokens: 120, cachedInputTokens: 0 }), '950 in / 120 out');
  assert.equal(formatSdkUsageSummary({ inputTokens: 12_500, outputTokens: 1_250, cachedInputTokens: 10_000 }), '13k in / 1.3k out / 10k cached');
  assert.equal(formatSdkUsageSummary({ inputTokens: 0, outputTokens: 0, cachedInputTokens: 0 }), '');
});

run('formats SDK terminal logs with Terax-style next offsets', () => {
  assert.deepEqual(
    formatSdkTerminalLogResult({
      terminalId: 'term-1',
      output: 'server ready',
      nextOffset: 42,
      dropped: true,
      truncatedTo: 12000,
    }),
    {
      terminalId: 'term-1',
      output: 'server ready',
      next_offset: 42,
      dropped: true,
      truncatedTo: 12000,
      commandExitCode: null,
      commandFinished: false,
    },
  );
  assert.deepEqual(
    formatSdkTerminalLogResult({
      terminalId: 'term-1',
      output: 'build output\n__COMET_COMMAND_EXIT:1\n',
      nextOffset: 44,
    }),
    {
      terminalId: 'term-1',
      output: 'build output\n__COMET_COMMAND_EXIT:1\n',
      next_offset: 44,
      dropped: false,
      truncatedTo: undefined,
      commandExitCode: 1,
      commandFinished: true,
    },
  );
  assert.equal(extractSdkCommandExitCode('__COMET_COMMAND_EXIT:0\nmore\n__COMET_COMMAND_EXIT:2'), 2);
});

run('formats app action results as durable machine-readable content', () => {
  assert.equal(
    formatSdkAppActionResultContent({
      kind: 'command',
      status: 'started',
      target: 'sdk-command-abc123',
      command: 'npm run build',
      cwd: 'C:/repo',
      action: 'run',
      terminalId: 'sdk-command-abc123',
    }),
    [
      'Action result',
      'Kind: command',
      'Status: started',
      'Target: sdk-command-abc123',
      'Command: npm run build',
      'Working directory: C:/repo',
      'Action: run',
      'Terminal ID: sdk-command-abc123',
    ].join('\n'),
  );
  assert.equal(
    formatSdkAppActionResultContent({
      kind: 'patch_review',
      status: 'started',
      title: 'Patch: update app',
      target: 'C:/repo/src/App.tsx',
    }),
    [
      'Action result',
      'Kind: patch_review',
      'Status: started',
      'Title: Patch: update app',
      'Target: C:/repo/src/App.tsx',
    ].join('\n'),
  );
  assert.equal(
    formatSdkAppActionResultContent({
      kind: 'directory',
      status: 'failed',
      title: 'Create directory: fixtures',
      target: 'C:/repo/tests/fixtures',
      error: 'permission denied',
    }),
    [
      'Action result',
      'Kind: directory',
      'Status: failed',
      'Title: Create directory: fixtures',
      'Target: C:/repo/tests/fixtures',
      'Error: permission denied',
    ].join('\n'),
  );
});

run('formats change review apply events as SDK action results', () => {
  assert.equal(CHANGE_REVIEW_APPLIED_EVENT, 'change-review:applied');
  assert.equal(
    formatChangeReviewAppliedActionContent({
      missionId: 'mission-1',
      threadId: 'thread:mission-1',
      runtimeSessionId: 'sdk:thread:mission-1',
      cardId: 'agent-1:0',
      title: 'Patch: update app',
      mode: 'accepted',
      status: 'completed',
      hunkCount: 2,
      filePaths: ['C:/repo/src/App.tsx'],
      artifactIds: ['patch-1'],
    }),
    [
      'Action result',
      'Kind: patch_review',
      'Status: completed',
      'Card ID: agent-1:0',
      'Title: Patch: update app',
      'Target: C:/repo/src/App.tsx',
    ].join('\n'),
  );
  assert.equal(
    formatChangeReviewAppliedActionContent({
      mode: 'all',
      status: 'failed',
      hunkCount: 1,
      filePaths: [],
      artifactIds: ['patch-2'],
      error: 'source lines no longer match',
    }),
    [
      'Action result',
      'Kind: patch_review',
      'Status: failed',
      'Title: Applied all patch hunks',
      'Target: patch-2',
      'Error: source lines no longer match',
    ].join('\n'),
  );
});

run('formats PowerShell-looking SDK command suggestions with a PowerShell fence', () => {
  assert.match(
    formatSdkCommandSuggestionContent({ command: '$env:OPENAI_API_KEY' }),
    /```powershell\n\$env:OPENAI_API_KEY\n```/,
  );
});

run('formats SDK patch proposals as durable diff content', () => {
  const content = formatSdkPatchProposalContent({
    id: 'patch-1',
    kind: 'patch',
    title: 'Patch: update app',
    path: 'C:/repo/src/App.tsx',
    contentText: 'diff --git a/src/App.tsx b/src/App.tsx\n@@ -1,1 +1,1 @@\n-old\n+new\n',
  });

  assert.equal(
    content,
    'Patch proposed\nTitle: Patch: update app\nPath: C:/repo/src/App.tsx\n\n```diff\ndiff --git a/src/App.tsx b/src/App.tsx\n@@ -1,1 +1,1 @@\n-old\n+new\n```',
  );
});

run('returns structured SDK patch proposal results for model follow-up', () => {
  assert.deepEqual(
    formatSdkPatchProposalResultForModel({
      id: 'patch-1',
      kind: 'patch',
      title: 'Patch: update app',
      path: 'C:/repo/src/App.tsx',
      contentText: 'diff --git a/src/App.tsx b/src/App.tsx\n@@\n-old\n+new\n',
    }, { isNewFile: false, bytesProposed: 120 }),
    {
      ok: true,
      path: 'C:/repo/src/App.tsx',
      artifactId: 'patch-1',
      title: 'Patch: update app',
      queued_for_review: true,
      applied: false,
      isNewFile: false,
      bytesProposed: 120,
      hint: 'A patch card has been queued in the change review pane. The file is not modified until the user applies it.',
    },
  );
});

run('formats SDK directory proposals as durable card content', () => {
  const content = formatSdkDirectoryProposalContent({
    id: 'dir-1',
    kind: 'directory',
    title: 'Create directory: add feature fixtures',
    path: 'C:/repo/tests/fixtures',
    contentText: '',
  });

  assert.equal(
    content,
    'Directory proposed\nTitle: Create directory: add feature fixtures\nPath: C:/repo/tests/fixtures',
  );
});

run('formats SDK preview proposals as durable card content', () => {
  const content = formatSdkPreviewProposalContent({
    id: 'preview-1',
    kind: 'preview',
    title: 'Local app',
    path: 'http://localhost:5173',
    contentText: '',
  });

  assert.equal(
    content,
    'Preview proposed\nTitle: Local app\nURL: http://localhost:5173',
  );
});

run('formats SDK terminal stop proposals as durable card content', () => {
  const content = formatSdkTerminalStopProposalContent({
    id: 'stop-1',
    kind: 'terminal_stop',
    title: 'Stop terminal: Vite dev server',
    path: 'term-123',
    contentText: 'Restart requested by user',
  });

  assert.equal(
    content,
    'Terminal stop proposed\nTitle: Stop terminal: Vite dev server\nTerminal ID: term-123\nReason: Restart requested by user',
  );
});

run('builds SDK artifact tool messages without treating non-files as files', () => {
  assert.deepEqual(
    buildSdkArtifactToolMessageFields({
      id: 'patch-1',
      kind: 'patch',
      title: 'Patch: update app',
      path: 'C:/repo/src/App.tsx',
      contentText: 'diff --git a/src/App.tsx b/src/App.tsx\n@@ -1,1 +1,1 @@\n-old\n+new\n',
    }),
    {
      content: [
        'Patch proposed',
        'Title: Patch: update app',
        'Path: C:/repo/src/App.tsx',
        '',
        '```diff',
        'diff --git a/src/App.tsx b/src/App.tsx\n@@ -1,1 +1,1 @@\n-old\n+new',
        '```',
      ].join('\n'),
      artifactIds: ['patch-1'],
      filePaths: ['C:/repo/src/App.tsx'],
    },
  );
  assert.deepEqual(
    buildSdkArtifactToolMessageFields({
      id: 'dir-1',
      kind: 'directory',
      title: 'Create directory: fixtures',
      path: 'C:/repo/tests/fixtures',
      contentText: '',
    }),
    {
      content: 'Directory proposed\nTitle: Create directory: fixtures\nPath: C:/repo/tests/fixtures',
      artifactIds: ['dir-1'],
      filePaths: ['C:/repo/tests/fixtures'],
    },
  );
  assert.deepEqual(
    buildSdkArtifactToolMessageFields({
      id: 'preview-1',
      kind: 'preview',
      title: 'Local app',
      path: 'http://localhost:5173',
      contentText: '',
    }),
    {
      content: 'Preview proposed\nTitle: Local app\nURL: http://localhost:5173',
      artifactIds: ['preview-1'],
      filePaths: undefined,
    },
  );
  assert.deepEqual(
    buildSdkArtifactToolMessageFields({
      id: 'stop-1',
      kind: 'terminal_stop',
      title: 'Stop terminal',
      path: 'term-123',
      contentText: 'Restart requested',
    }),
    {
      content: 'Terminal stop proposed\nTitle: Stop terminal\nTerminal ID: term-123\nReason: Restart requested',
      artifactIds: ['stop-1'],
      filePaths: undefined,
    },
  );
});

run('builds SDK follow-up run messages from visible history and hidden continuation', () => {
  const actionResult = formatSdkAppActionResultContent({
    kind: 'command',
    status: 'completed',
    cardId: 'agent-1:0',
    target: 'sdk-command-abc123',
    command: 'npm run build',
    action: 'run',
    terminalId: 'sdk-command-abc123',
  });
  const messages = buildSdkFollowUpMessagesForRun({
    priorMessages: [
      { role: 'system', content: 'Runtime started.' },
      { role: 'user', content: 'Run the build.' },
      { role: 'agent', content: 'Command proposed\n\n```bash\nnpm run build\n```' },
      { role: 'tool', content: actionResult },
    ],
    latestUserContent: 'continue from the command result',
  });

  assert.deepEqual(messages, [
    { role: 'user', content: 'Run the build.' },
    { role: 'assistant', content: 'Command proposed\n\n```bash\nnpm run build\n```' },
    { role: 'tool', content: actionResult },
    { role: 'user', content: 'continue from the command result' },
  ]);
});

run('keeps durable SDK tool history but drops UI-only tool status from model follow-up', () => {
  assert.equal(sdkToolHistoryMessageIsDurable('Tool: Read file - src/App.tsx'), false);
  assert.equal(sdkToolHistoryMessageIsDurable(formatSdkTodoWriteContent([
    { title: 'Read Terax', status: 'completed' },
    { title: 'Patch SDK loop', status: 'in_progress' },
  ])), true);
  assert.equal(sdkToolHistoryMessageIsDurable(formatSdkAppActionResultContent({
    kind: 'preview',
    status: 'completed',
    target: 'http://localhost:5173',
  })), true);

  const messages = buildSdkFollowUpMessagesForRun({
    priorMessages: [
      { role: 'user', content: 'Inspect the app.' },
      { role: 'tool', content: 'Tool: Read file - src/App.tsx' },
      { role: 'tool', content: 'Preview proposed\nTitle: Local app\nURL: http://localhost:5173' },
      {
        role: 'tool',
        content: formatSdkAppActionResultContent({
          kind: 'preview',
          status: 'completed',
          target: 'http://localhost:5173',
        }),
      },
    ],
    latestUserContent: 'continue',
  });

  assert.deepEqual(messages, [
    { role: 'user', content: 'Inspect the app.' },
    { role: 'tool', content: 'Preview proposed\nTitle: Local app\nURL: http://localhost:5173' },
    {
      role: 'tool',
      content: formatSdkAppActionResultContent({
        kind: 'preview',
        status: 'completed',
        target: 'http://localhost:5173',
      }),
    },
    { role: 'user', content: 'continue' },
  ]);
});

run('keeps SDK command proposals interactive instead of status-toast only', () => {
  assert.equal(followUpToolMessageHasInteractiveSdkContent('Tool: Proposed command - npm run build'), false);
  assert.equal(followUpToolMessageHasInteractiveSdkContent(formatSdkCommandSuggestionContent({
    command: 'npm run build',
    reason: 'Verify the production bundle',
    action: 'run',
  })), true);
  assert.equal(followUpToolMessageHasInteractiveSdkContent(formatSdkCommandSuggestionContent({
    command: 'npm run dev',
    reason: 'Start the preview server',
    action: 'background',
  })), true);
  assert.equal(followUpToolMessageHasInteractiveSdkContent(formatSdkCommandSuggestionContent({
    command: 'npm test',
    action: 'insert',
  })), true);
});

run('returns structured SDK action proposal results for model follow-up', () => {
  assert.deepEqual(
    formatSdkActionProposalResultForModel({
      id: 'dir-1',
      kind: 'directory',
      title: 'Create directory: add feature fixtures',
      path: 'C:/repo/tests/fixtures',
      contentText: '',
    }),
    {
      ok: true,
      kind: 'directory',
      target: 'C:/repo/tests/fixtures',
      artifactId: 'dir-1',
      title: 'Create directory: add feature fixtures',
      queued_for_review: true,
      applied: false,
      hint: 'A directory creation card has been queued. The directory is not created until the user clicks Create.',
    },
  );
  assert.deepEqual(
    formatSdkActionProposalResultForModel({
      id: 'preview-1',
      kind: 'preview',
      title: 'Local app',
      path: 'http://localhost:5173',
      contentText: '',
    }),
    {
      ok: true,
      kind: 'preview',
      target: 'http://localhost:5173',
      artifactId: 'preview-1',
      title: 'Local app',
      queued_for_review: true,
      applied: false,
      hint: 'A preview card has been queued. The URL is not opened until the user clicks Open.',
    },
  );
  assert.deepEqual(
    formatSdkActionProposalResultForModel({
      id: 'stop-1',
      kind: 'terminal_stop',
      title: 'Stop terminal: Vite dev server',
      path: 'term-123',
      contentText: 'Restart requested by user',
    }),
    {
      ok: true,
      kind: 'terminal_stop',
      target: 'term-123',
      artifactId: 'stop-1',
      title: 'Stop terminal: Vite dev server',
      queued_for_review: true,
      applied: false,
      hint: 'A terminal stop card has been queued. The terminal is not stopped until the user clicks Stop.',
    },
  );
});


run('normalizes SDK preview URLs for local server shorthand', () => {
  assert.equal(normalizeSdkPreviewUrl('localhost:5173'), 'http://localhost:5173');
  assert.equal(normalizeSdkPreviewUrl('127.0.0.1:3000/app'), 'http://127.0.0.1:3000/app');
  assert.equal(normalizeSdkPreviewUrl('127.0.0.2:3000/app'), 'http://127.0.0.2:3000/app');
  assert.equal(normalizeSdkPreviewUrl('0.0.0.0:1420'), 'http://localhost:1420');
  assert.equal(normalizeSdkPreviewUrl('[::]:1420'), 'http://localhost:1420');
  assert.equal(normalizeSdkPreviewUrl('docs.localhost:8080/help'), 'http://docs.localhost:8080/help');
  assert.equal(normalizeSdkPreviewUrl('192.168.1.25:5173'), 'http://192.168.1.25:5173');
  assert.equal(normalizeSdkPreviewUrl('https://example.com'), 'https://example.com');
});

run('validates SDK preview URLs as local servers only', () => {
  assert.equal(validateSdkPreviewUrl('http://localhost:5173'), null);
  assert.equal(validateSdkPreviewUrl('https://127.0.0.1:3000/app'), null);
  assert.equal(validateSdkPreviewUrl('https://127.0.0.2:3000/app'), null);
  assert.equal(validateSdkPreviewUrl('http://localhost:1420'), null);
  assert.equal(validateSdkPreviewUrl('http://docs.localhost:8080/help'), null);
  assert.equal(validateSdkPreviewUrl('http://192.168.1.25:5173'), null);
  assert.match(validateSdkPreviewUrl('https://example.com'), /localhost, loopback, or a private LAN/);
  assert.match(validateSdkPreviewUrl('file:///C:/repo/index.html'), /http or https/);
  assert.match(validateSdkPreviewUrl('not a url'), /valid local-server/);
});

run('creates SDK abort scopes that follow manual aborts', () => {
  const parent = new AbortController();
  const scope = createSdkAbortScope(parent.signal, null);
  assert.equal(scope.signal?.aborted, false);
  parent.abort(new Error('manual stop'));
  assert.equal(scope.signal?.aborted, true);
  assert.equal(scope.timedOut(), false);
  scope.dispose();
});

run('formats readable SDK attachments with capped text context', () => {
  const context = formatSdkAttachmentContext([
    { name: 'notes.md', path: 'C:/repo/notes.md', kind: 'file', content: 'hello\nworld' },
    { name: 'screen.png', path: 'C:/repo/screen.png', kind: 'image' },
    { name: 'locked.txt', path: 'C:/repo/locked.txt', kind: 'file', error: 'permission denied' },
  ]);

  assert.match(context, /^Attached files:/);
  assert.match(context, /- notes\.md: C:\/repo\/notes\.md/);
  assert.match(context, /```text\nhello\nworld\n```/);
  assert.match(context, /\[image attachment; use the path if visual inspection is needed\]/);
  assert.match(context, /\[could not read attachment text: permission denied\]/);
});

run('truncates oversized SDK attachment text', () => {
  const context = formatSdkAttachmentContext([
    { name: 'huge.log', kind: 'file', content: 'x'.repeat(25_000) },
  ]);

  assert.match(context, /\[truncated at 24000 chars\]/);
  assert.equal(context.includes('x'.repeat(24_100)), false);
});

run('builds multimodal user content for SDK image attachments', () => {
  const content = createSdkUserContent('What is wrong in this screenshot?', [
    {
      name: 'screen.png',
      path: 'C:/repo/screen.png',
      base64: 'iVBORw0KGgo=',
    },
  ]);

  assert.deepEqual(content, [
    { type: 'text', text: 'What is wrong in this screenshot?' },
    { type: 'text', text: 'Image attachment: screen.png (C:/repo/screen.png)' },
    { type: 'image', image: 'iVBORw0KGgo=', mediaType: 'image/png' },
  ]);
});

run('keeps unreadable SDK image attachments visible as text context', () => {
  const content = createSdkUserContent('Check this', [
    { name: 'screen.webp', error: 'file not found' },
  ]);

  assert.deepEqual(content, [
    { type: 'text', text: 'Check this' },
    { type: 'text', text: 'Image attachment: screen.webp\n[could not read image: file not found]' },
  ]);
});

run('infers SDK image media types from paths', () => {
  assert.equal(inferSdkImageMediaType('clip.jpeg'), 'image/jpeg');
  assert.equal(inferSdkImageMediaType('clip.webp'), 'image/webp');
  assert.equal(inferSdkImageMediaType('clip.svg'), 'image/svg+xml');
  assert.equal(inferSdkImageMediaType('clip.unknown'), 'image/png');
});

run('matches Terax-style SDK glob patterns over relative paths', () => {
  assert.equal(matchesSdkGlobPattern('src/lib/sdkChat.ts', '**/*.ts'), true);
  assert.equal(matchesSdkGlobPattern('src/components/App.tsx', 'src/**/*.tsx'), true);
  assert.equal(matchesSdkGlobPattern('package.json', 'package.json'), true);
  assert.equal(matchesSdkGlobPattern('src/package.json', 'package.json'), true);
  assert.equal(matchesSdkGlobPattern('src/lib/sdkChat.ts', '**/*.tsx'), false);
});

run('formats dirty editor context for the SDK system prompt', () => {
  assert.equal(formatSdkDirtyEditorContext([]), '');
  assert.equal(
    formatSdkDirtyEditorContext(['C:\\repo\\src\\App.tsx', 'C:/repo/src/Other.ts'], 'C:/repo/src/App.tsx'),
    'Unsaved editor buffers are open. Treat these as newer than disk content; read_file will return the unsaved buffer when available.\n- C:\\repo\\src\\App.tsx (active file)\n- C:/repo/src/Other.ts',
  );
});

run('formats Terax-compatible project memory before AGENTS guidance', () => {
  assert.equal(formatSdkProjectMemoryContext([]), null);
  assert.equal(
    formatSdkProjectMemoryContext([
      { name: 'TERAX.md', content: 'Use the app SDK agent.' },
      { name: 'AGENTS.md', content: 'Keep changes scoped.' },
    ]),
    'Project memory:\n\n## PROJECT - TERAX.md\nUse the app SDK agent.\n\n## PROJECT - AGENTS.md\nKeep changes scoped.',
  );
});

run('formats SDK environment context with terminal id', () => {
  assert.equal(formatSdkEnvironmentContext({}), '');
  assert.equal(
    formatSdkEnvironmentContext({
      workspaceDir: 'C:/repo',
      activeTerminalCwd: 'C:/repo/src',
      activeFile: 'C:/repo/src/App.tsx',
      activeTerminalId: 'terminal-123',
    }),
    '<env>\nworkspace_root: C:/repo\nactive_terminal_cwd: C:/repo/src\nactive_file: C:/repo/src/App.tsx\nactive_terminal_id: terminal-123\n</env>',
  );
  assert.equal(
    formatSdkEnvironmentContext({ activeTerminalId: ' terminal-456\u0000 ' }),
    '<env>\nactive_terminal_id: terminal-456\n</env>',
  );
});

run('normalizes SDK terminal contexts for bash_list', () => {
  assert.deepEqual(
    normalizeSdkTerminalContexts([
      {
        terminalId: ' term-1\u0000 ',
        title: ' Terminal ',
        cwd: ' C:/repo ',
        cli: ' powershell ',
        initialCommand: ' npm run dev ',
        initialCommandShouldRun: true,
        runtimeManaged: true,
      },
      { terminalId: 'term-1', title: 'Duplicate' },
      { terminalId: '' },
    ], ' term-2\u0000 ', 'C:/repo/src'),
    [
      {
        terminalId: 'term-1',
        title: 'Terminal',
        cwd: 'C:/repo',
        cli: 'powershell',
        initialCommand: 'npm run dev',
        initialCommandShouldRun: true,
        runtimeManaged: true,
      },
      {
        terminalId: 'term-2',
        title: 'Active terminal',
        cwd: 'C:/repo/src',
        initialCommandShouldRun: false,
        runtimeManaged: false,
      },
    ],
  );
});

async function runAsync(name, fn) {
  try {
    await fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

await runAsync('uses primary fetch before the Tauri bridge', async () => {
  let bridgeCalled = false;
  const sdkFetch = createOpenAiSdkFetch(
    async () => new Response('primary', { status: 201, statusText: 'Created' }),
    async () => {
      bridgeCalled = true;
      return { status: 200, statusText: 'OK', headers: [], body: 'bridge' };
    },
  );

  const response = await sdkFetch('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' });
  assert.equal(response.status, 201);
  assert.equal(await response.text(), 'primary');
  assert.equal(bridgeCalled, false);
});

await runAsync('preserves primary OpenAI fetch streaming bodies for SDK chat', async () => {
  let bridgeCalled = false;
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    start(controller) {
      controller.enqueue(encoder.encode('first '));
      controller.enqueue(encoder.encode('second'));
      controller.close();
    },
  });
  const sdkFetch = createOpenAiSdkFetch(
    async () => new Response(stream, { status: 200, statusText: 'OK' }),
    async () => {
      bridgeCalled = true;
      return { status: 200, statusText: 'OK', headers: [], body: 'bridge' };
    },
  );

  const response = await sdkFetch('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' });
  const reader = response.body?.getReader();
  assert.ok(reader);
  const first = await reader.read();
  const second = await reader.read();
  const done = await reader.read();
  assert.equal(new TextDecoder().decode(first.value), 'first ');
  assert.equal(new TextDecoder().decode(second.value), 'second');
  assert.equal(done.done, true);
  assert.equal(bridgeCalled, false);
});

await runAsync('streams SDK chat through a local AI SDK test model', async () => {
  const deltas = [];
  const steps = [];
  const usage = [];
  let finishMeta = null;
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Hello' },
          { type: 'text-delta', id: 'text-1', delta: ' from SDK' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: { total: 12, noCache: 8, cacheRead: 4, cacheWrite: 0 },
              outputTokens: { total: 3, text: 3, reasoning: 0 },
            },
          },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    }),
  });

  const text = await runSdkChat({
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    modelOverride: model,
    workspaceDir: 'C:/repo',
    activeTerminalCwd: 'C:/repo/src',
    activeFile: 'C:/repo/src/App.tsx',
    activeTerminalId: 'terminal-123',
    systemContext: 'Test SDK send path.',
    messages: [{ role: 'user', content: 'say hello' }],
    requestTimeoutMs: null,
    onDelta: delta => deltas.push(delta),
    onStep: step => steps.push(step),
    onUsage: delta => usage.push(delta),
    onFinishMeta: meta => { finishMeta = meta; },
  });

  assert.equal(text, 'Hello from SDK');
  assert.deepEqual(deltas, ['Hello', ' from SDK']);
  assert.deepEqual(usage, [{
    inputTokens: 12,
    outputTokens: 3,
    cachedInputTokens: 4,
    lastInputTokens: 12,
    lastCachedTokens: 4,
  }]);
  assert.deepEqual(finishMeta, { hitStepCap: false, finishReason: 'other' });
  assert.equal(model.doStreamCalls.length, 1);
  assert.equal(model.doStreamCalls[0].prompt.some(part => part.role === 'user'), true);
  const userPrompt = model.doStreamCalls[0].prompt.find(part => part.role === 'user');
  const userPromptText = Array.isArray(userPrompt.content)
    ? userPrompt.content.filter(part => part.type === 'text').map(part => part.text).join('\n\n')
    : String(userPrompt.content);
  assert.match(userPromptText, /^<env>\nworkspace_root: C:\/repo\nactive_terminal_cwd: C:\/repo\/src\nactive_file: C:\/repo\/src\/App\.tsx\nactive_terminal_id: terminal-123\n<\/env>\n\nsay hello$/);
  assert.equal(steps[0], 'Contacting OpenAI');
  assert.equal(steps.includes('Writing'), true);
});

await runAsync('omits SDK workspace tools when tool mode is none', async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'I need permission before reading workspace files.' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: { total: 8, noCache: 8, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 9, text: 9, reasoning: 0 },
            },
          },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    }),
  });

  const text = await runSdkChat({
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    modelOverride: model,
    workspaceDir: 'C:/repo',
    systemContext: 'Permission mode: restricted. Workspace tools are disabled for this turn.',
    messages: [{ role: 'user', content: 'read the codebase' }],
    requestTimeoutMs: null,
    toolMode: 'none',
  });

  assert.equal(text, 'I need permission before reading workspace files.');
  assert.deepEqual(model.doStreamCalls[0].tools ?? [], []);
});

await runAsync('streams SDK chat through a local OpenAI-compatible Responses endpoint', async () => {
  let requestBody = '';
  let requestUrl = '';
  let authorization = '';
  const server = createServer((request, response) => {
    requestUrl = request.url ?? '';
    authorization = request.headers.authorization ?? '';
    request.setEncoding('utf8');
    request.on('data', chunk => {
      requestBody += chunk;
    });
    request.on('end', () => {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = chunk => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      send({
        type: 'response.created',
        response: {
          id: 'resp_local_mock',
          created_at: 1_700_000_000,
          model: 'gpt-5-mini',
          service_tier: null,
        },
      });
      send({
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_local_mock',
          phase: 'final_answer',
        },
      });
      send({
        type: 'response.output_text.delta',
        item_id: 'msg_local_mock',
        delta: 'Hello ',
      });
      send({
        type: 'response.output_text.delta',
        item_id: 'msg_local_mock',
        delta: 'over HTTP',
      });
      send({
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_local_mock',
          phase: 'final_answer',
        },
      });
      send({
        type: 'response.completed',
        response: {
          incomplete_details: null,
          usage: {
            input_tokens: 19,
            input_tokens_details: { cached_tokens: 5 },
            output_tokens: 4,
            output_tokens_details: { reasoning_tokens: 0 },
          },
          service_tier: null,
        },
      });
      response.end();
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const baseURL = `http://127.0.0.1:${address.port}/v1`;
  const deltas = [];
  const usage = [];

  try {
    const text = await runSdkChat({
      apiKey: 'test-local-key',
      baseURL,
      model: 'gpt-5-mini',
      workspaceDir: 'C:/repo',
      systemContext: 'Test local OpenAI-compatible SDK transport.',
      messages: [{ role: 'user', content: 'say hello over http' }],
      requestTimeoutMs: null,
      onDelta: delta => deltas.push(delta),
      onUsage: delta => usage.push(delta),
    });

    assert.equal(text, 'Hello over HTTP');
    assert.deepEqual(deltas, ['Hello ', 'over HTTP']);
    assert.equal(requestUrl, '/v1/responses');
    assert.equal(authorization, 'Bearer test-local-key');
    const parsedBody = JSON.parse(requestBody);
    assert.equal(parsedBody.model, 'gpt-5-mini');
    assert.equal(parsedBody.stream, true);
    assert.equal(Array.isArray(parsedBody.input), true);
    assert.equal(usage.length, 1);
    assert.deepEqual(usage[0], {
      inputTokens: 19,
      outputTokens: 4,
      cachedInputTokens: 5,
      lastInputTokens: 19,
      lastCachedTokens: 5,
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

await runAsync('pauses SDK chat on an HTTP-streamed approval-card tool call', async () => {
  let requestCount = 0;
  let requestBody = '';
  const server = createServer((request, response) => {
    requestCount += 1;
    request.setEncoding('utf8');
    request.on('data', chunk => {
      requestBody += chunk;
    });
    request.on('end', () => {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = chunk => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      send({
        type: 'response.created',
        response: {
          id: 'resp_tool_mock',
          created_at: 1_700_000_001,
          model: 'gpt-5-mini',
          service_tier: null,
        },
      });
      send({
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_bash_run',
          call_id: 'call_bash_run',
          name: 'bash_run',
          arguments: '{"command":"npm run build","reason":"Verify the production bundle"}',
          namespace: null,
        },
      });
      send({
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'function_call',
          id: 'fc_bash_run',
          call_id: 'call_bash_run',
          name: 'bash_run',
          arguments: '{"command":"npm run build","reason":"Verify the production bundle"}',
          status: 'completed',
          namespace: null,
        },
      });
      send({
        type: 'response.completed',
        response: {
          incomplete_details: null,
          usage: {
            input_tokens: 31,
            input_tokens_details: { cached_tokens: 0 },
            output_tokens: 6,
            output_tokens_details: { reasoning_tokens: 0 },
          },
          service_tier: null,
        },
      });
      response.end();
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');
  const commands = [];
  const toolEvents = [];

  try {
    const text = await runSdkChat({
      apiKey: 'test-local-key',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      model: 'gpt-5-mini',
      workspaceDir: 'C:/repo',
      systemContext: 'Test local OpenAI-compatible approval tool pause.',
      messages: [{ role: 'user', content: 'run the build' }],
      requestTimeoutMs: null,
      onCommand: event => commands.push(event),
      onToolEvent: event => toolEvents.push(event),
    });

    assert.equal(text, '');
    assert.equal(requestCount, 1);
    assert.deepEqual(commands, [{
      command: 'npm run build',
      reason: 'Verify the production bundle',
      cwd: 'C:/repo',
      action: 'run',
    }]);
    assert.equal(toolEvents.some(event => event.toolName === 'bash_run' && event.status === 'completed'), true);
    const parsedBody = JSON.parse(requestBody);
    assert.equal(parsedBody.stream, true);
    assert.match(JSON.stringify(parsedBody.tools), /bash_run/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

await runAsync('resumes SDK chat over HTTP from a durable app action result', async () => {
  let requestBody = '';
  const server = createServer((request, response) => {
    request.setEncoding('utf8');
    request.on('data', chunk => {
      requestBody += chunk;
    });
    request.on('end', () => {
      response.writeHead(200, {
        'content-type': 'text/event-stream; charset=utf-8',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      });
      const send = chunk => response.write(`data: ${JSON.stringify(chunk)}\n\n`);
      send({
        type: 'response.created',
        response: {
          id: 'resp_action_result_mock',
          created_at: 1_700_000_002,
          model: 'gpt-5-mini',
          service_tier: null,
        },
      });
      send({
        type: 'response.output_item.added',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_action_result_mock',
          phase: 'final_answer',
        },
      });
      send({
        type: 'response.output_text.delta',
        item_id: 'msg_action_result_mock',
        delta: 'Build result received.',
      });
      send({
        type: 'response.output_item.done',
        output_index: 0,
        item: {
          type: 'message',
          id: 'msg_action_result_mock',
          phase: 'final_answer',
        },
      });
      send({
        type: 'response.completed',
        response: {
          incomplete_details: null,
          usage: {
            input_tokens: 41,
            input_tokens_details: { cached_tokens: 3 },
            output_tokens: 5,
            output_tokens_details: { reasoning_tokens: 0 },
          },
          service_tier: null,
        },
      });
      response.end();
    });
  });

  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  assert.equal(typeof address, 'object');

  try {
    const actionResult = formatSdkAppActionResultContent({
      kind: 'command',
      status: 'completed',
      cardId: 'agent-message-1:0',
      target: 'sdk-command-abc123',
      command: 'npm run build',
      cwd: 'C:/repo',
      action: 'run',
      terminalId: 'sdk-command-abc123',
    });
    const text = await runSdkChat({
      apiKey: 'test-local-key',
      baseURL: `http://127.0.0.1:${address.port}/v1`,
      model: 'gpt-5-mini',
      workspaceDir: 'C:/repo',
      systemContext: 'Test local OpenAI-compatible action-result resume.',
      messages: [
        { role: 'user', content: 'Run the build.' },
        {
          role: 'assistant',
          content: 'Command proposed\n\nReason: Verify production bundle\n\nWorking directory: C:/repo\n\n```bash\nnpm run build\n```',
        },
        { role: 'tool', content: actionResult },
        { role: 'user', content: 'continue from the command result' },
      ],
      requestTimeoutMs: null,
    });

    assert.equal(text, 'Build result received.');
    const serializedBody = JSON.stringify(JSON.parse(requestBody));
    assert.match(serializedBody, /Tool\/action result from the app/);
    assert.match(serializedBody, /Action result/);
    assert.match(serializedBody, /Status: completed/);
    assert.match(serializedBody, /Command: npm run build/);
    assert.match(serializedBody, /Terminal ID: sdk-command-abc123/);
    assert.match(serializedBody, /continue from the command result/);
  } finally {
    await new Promise(resolve => server.close(resolve));
  }
});

await runAsync('surfaces SDK stream errors instead of returning empty assistant text', async () => {
  const steps = [];
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'error', error: new Error('invalid api key') },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    }),
  });

  await assert.rejects(
    () => runSdkChat({
      apiKey: 'test-key',
      model: 'gpt-5-mini',
      modelOverride: model,
      workspaceDir: 'C:/repo',
      systemContext: 'Test SDK error surfacing.',
      messages: [{ role: 'user', content: 'hello' }],
      requestTimeoutMs: null,
      onStep: step => steps.push(step),
    }),
    /invalid api key/,
  );
  assert.equal(steps[0], 'Contacting OpenAI');
  assert.equal(steps.at(-1), null);
});

await runAsync('preserves app tool action messages in SDK prompt context', async () => {
  const model = new MockLanguageModelV3({
    doStream: async () => ({
      stream: simulateReadableStream({
        chunks: [
          { type: 'stream-start', warnings: [] },
          { type: 'text-start', id: 'text-1' },
          { type: 'text-delta', id: 'text-1', delta: 'Continuing.' },
          { type: 'text-end', id: 'text-1' },
          {
            type: 'finish',
            finishReason: 'stop',
            usage: {
              inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
              outputTokens: { total: 3, text: 3, reasoning: 0 },
            },
          },
        ],
        initialDelayInMs: null,
        chunkDelayInMs: null,
      }),
    }),
  });

  await runSdkChat({
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    modelOverride: model,
    workspaceDir: 'C:/repo',
    systemContext: 'Test SDK card-action history.',
    messages: [
      { role: 'user', content: 'Run the build.' },
      {
        role: 'tool',
        content: [
          'Action result',
          'Kind: command',
          'Status: started',
          'Target: sdk-command-abc123',
          'Command: npm run build',
          'Terminal ID: sdk-command-abc123',
          'Working directory: C:/repo',
          'Action: run',
        ].join('\n'),
      },
      { role: 'user', content: 'continue' },
    ],
    requestTimeoutMs: null,
  });

  const prompt = model.doStreamCalls[0].prompt;
  const userPromptTexts = prompt
    .filter(part => part.role === 'user')
    .map(part => Array.isArray(part.content)
      ? part.content.filter(item => item.type === 'text').map(item => item.text).join('\n\n')
      : String(part.content));
  const toolContext = userPromptTexts.find(text => text.includes('Tool/action result from the app:'));
  assert.ok(toolContext);
  assert.match(toolContext, /Terminal ID: sdk-command-abc123/);
  assert.match(toolContext, /Action: run/);
});

await runAsync('executes SDK tool calls and continues the model loop', async () => {
  let callCount = 0;
  const todos = [];
  const model = new MockLanguageModelV3({
    doStream: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'todo-call-1',
                toolName: 'todo_write',
                input: JSON.stringify({
                  todos: [
                    { title: 'Read reference implementation', status: 'completed' },
                    { title: 'Wire SDK chat loop', status: 'in_progress' },
                  ],
                }),
              },
              {
                type: 'finish',
                finishReason: 'tool-calls',
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 4, text: 4, reasoning: 0 },
                },
              },
            ],
            initialDelayInMs: null,
            chunkDelayInMs: null,
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'final-text' },
            { type: 'text-delta', id: 'final-text', delta: 'Tool loop complete.' },
            { type: 'text-end', id: 'final-text' },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: {
                inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  });

  const text = await runSdkChat({
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    modelOverride: model,
    workspaceDir: 'C:/repo',
    messages: [{ role: 'user', content: 'make a todo plan' }],
    requestTimeoutMs: null,
    onTodos: event => todos.push(event.todos),
  });

  assert.equal(text, 'Tool loop complete.');
  assert.equal(callCount, 2);
  assert.deepEqual(todos, [[
    { title: 'Read reference implementation', status: 'completed', description: undefined },
    { title: 'Wire SDK chat loop', status: 'in_progress', description: undefined },
  ]]);
  assert.equal(
    model.doStreamCalls[1].prompt.some(part =>
      part.role === 'tool' &&
      JSON.stringify(part.content).includes('todo_write'),
    ),
    true,
  );
});

await runAsync('executes SDK read then edit tools and emits a reviewable patch artifact', async () => {
  resetEditorSessionCacheForTests();
  markCachedEditorDirty('C:/repo/src/App.tsx', 'const label = "old";\n');

  let callCount = 0;
  const artifacts = [];
  const toolEvents = [];
  const model = new MockLanguageModelV3({
    doStream: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'read-call-1',
                toolName: 'read_file',
                input: JSON.stringify({ path: 'src/App.tsx' }),
              },
              {
                type: 'finish',
                finishReason: 'tool-calls',
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 4, text: 4, reasoning: 0 },
                },
              },
            ],
            initialDelayInMs: null,
            chunkDelayInMs: null,
          }),
        };
      }
      if (callCount === 2) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'edit-call-1',
                toolName: 'edit',
                input: JSON.stringify({
                  path: 'src/App.tsx',
                  old_string: 'const label = "old";',
                  new_string: 'const label = "new";',
                  rationale: 'Update visible label',
                }),
              },
              {
                type: 'finish',
                finishReason: 'tool-calls',
                usage: {
                  inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 5, text: 5, reasoning: 0 },
                },
              },
            ],
            initialDelayInMs: null,
            chunkDelayInMs: null,
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'final-text' },
            { type: 'text-delta', id: 'final-text', delta: 'Patch is ready for review.' },
            { type: 'text-end', id: 'final-text' },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: {
                inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  });

  const text = await runSdkChat({
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    modelOverride: model,
    workspaceDir: 'C:/repo',
    messages: [{ role: 'user', content: 'update the app label' }],
    requestTimeoutMs: null,
    onArtifact: artifact => artifacts.push(artifact),
    onToolEvent: event => toolEvents.push(event),
  });

  assert.equal(text, '');
  assert.equal(callCount, 2);
  assert.equal(artifacts.length, 1);
  assert.equal(artifacts[0].kind, 'patch');
  assert.equal(artifacts[0].path, 'C:/repo\\src/App.tsx');
  assert.match(artifacts[0].title, /Update visible label/);
  assert.match(artifacts[0].contentText, /^diff --git a\/src\/App\.tsx b\/src\/App\.tsx/m);
  assert.match(artifacts[0].contentText, /^-const label = "old";$/m);
  assert.match(artifacts[0].contentText, /^\+const label = "new";$/m);
  assert.equal(toolEvents.some(event => event.toolName === 'read_file' && event.status === 'completed'), true);
  assert.equal(toolEvents.some(event => event.toolName === 'edit' && event.status === 'completed'), true);
});

await runAsync('pauses SDK loop after approval-card tools until app action evidence resumes it', async () => {
  let callCount = 0;
  const commands = [];
  const model = new MockLanguageModelV3({
    doStream: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'run-call-1',
                toolName: 'bash_run',
                input: JSON.stringify({
                  command: 'npm run build',
                  reason: 'Verify the app',
                }),
              },
              {
                type: 'finish',
                finishReason: 'tool-calls',
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 4, text: 4, reasoning: 0 },
                },
              },
            ],
            initialDelayInMs: null,
            chunkDelayInMs: null,
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'should-not-stream' },
            { type: 'text-delta', id: 'should-not-stream', delta: 'I should wait.' },
            { type: 'text-end', id: 'should-not-stream' },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: {
                inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  });

  const text = await runSdkChat({
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    modelOverride: model,
    workspaceDir: 'C:/repo',
    messages: [{ role: 'user', content: 'run the build' }],
    requestTimeoutMs: null,
    onCommand: event => commands.push(event),
  });

  assert.equal(text, '');
  assert.equal(callCount, 1);
  assert.deepEqual(commands, [{
    command: 'npm run build',
    reason: 'Verify the app',
    cwd: 'C:/repo',
    action: 'run',
  }]);
});

await runAsync('continues SDK loop after rejected approval-card tool input instead of hanging', async () => {
  let callCount = 0;
  const commands = [];
  const toolEvents = [];
  const model = new MockLanguageModelV3({
    doStream: async () => {
      callCount += 1;
      if (callCount === 1) {
        return {
          stream: simulateReadableStream({
            chunks: [
              { type: 'stream-start', warnings: [] },
              {
                type: 'tool-call',
                toolCallId: 'run-call-invalid',
                toolName: 'bash_run',
                input: JSON.stringify({
                  command: 'npm run dev',
                  reason: 'Start the dev server',
                }),
              },
              {
                type: 'finish',
                finishReason: 'tool-calls',
                usage: {
                  inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 },
                  outputTokens: { total: 4, text: 4, reasoning: 0 },
                },
              },
            ],
            initialDelayInMs: null,
            chunkDelayInMs: null,
          }),
        };
      }
      return {
        stream: simulateReadableStream({
          chunks: [
            { type: 'stream-start', warnings: [] },
            { type: 'text-start', id: 'final-text' },
            { type: 'text-delta', id: 'final-text', delta: 'I should use bash_background for dev servers instead.' },
            { type: 'text-end', id: 'final-text' },
            {
              type: 'finish',
              finishReason: 'stop',
              usage: {
                inputTokens: { total: 12, noCache: 12, cacheRead: 0, cacheWrite: 0 },
                outputTokens: { total: 5, text: 5, reasoning: 0 },
              },
            },
          ],
          initialDelayInMs: null,
          chunkDelayInMs: null,
        }),
      };
    },
  });

  const text = await runSdkChat({
    apiKey: 'test-key',
    model: 'gpt-5-mini',
    modelOverride: model,
    workspaceDir: 'C:/repo',
    messages: [{ role: 'user', content: 'start the dev server' }],
    requestTimeoutMs: null,
    onCommand: event => commands.push(event),
    onToolEvent: event => toolEvents.push(event),
  });

  assert.equal(text, 'I should use bash_background for dev servers instead.');
  assert.equal(callCount, 2);
  assert.deepEqual(commands, []);
  assert.equal(toolEvents.some(event => event.toolName === 'bash_run' && event.status === 'failed'), true);
});

await runAsync('creates SDK abort scopes that time out stalled sends', async () => {
  const scope = createSdkAbortScope(undefined, 5);
  assert.equal(scope.signal?.aborted, false);
  await new Promise(resolve => setTimeout(resolve, 20));
  assert.equal(scope.signal?.aborted, true);
  assert.equal(scope.timedOut(), true);
  scope.dispose();
});

await runAsync('falls back to the Tauri bridge for OpenAI fetch failures', async () => {
  let bridgeRequest = null;
  const sdkFetch = createOpenAiSdkFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async request => {
      bridgeRequest = request;
      return {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/event-stream']],
        body: 'bridge',
      };
    },
  );

  const response = await sdkFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    headers: { Authorization: 'Bearer test-key', 'Content-Type': 'application/json' },
    body: '{"stream":true}',
  });

  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'bridge');
  assert.equal(bridgeRequest.method, 'POST');
  assert.equal(bridgeRequest.url, 'https://api.openai.com/v1/responses');
  assert.equal(bridgeRequest.body, '{"stream":true}');
  assert.deepEqual(bridgeRequest.headers.find(([name]) => name === 'authorization'), ['authorization', 'Bearer test-key']);
});

await runAsync('can use a streamed Tauri bridge fallback for OpenAI fetch failures', async () => {
  let bufferedBridgeCalled = false;
  const encoder = new TextEncoder();
  const sdkFetch = createOpenAiSdkFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async () => {
      bufferedBridgeCalled = true;
      return { status: 200, statusText: 'OK', headers: [], body: 'buffered' };
    },
    async () => new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(encoder.encode('stream '));
        controller.enqueue(encoder.encode('fallback'));
        controller.close();
      },
    }), { status: 202, statusText: 'Accepted', headers: [['content-type', 'text/plain']] }),
  );

  const response = await sdkFetch('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' });
  assert.equal(response.status, 202);
  assert.equal(await response.text(), 'stream fallback');
  assert.equal(bufferedBridgeCalled, false);
});

await runAsync('falls back to buffered bridge if streamed Tauri bridge cannot start', async () => {
  let bufferedBridgeCalled = false;
  const sdkFetch = createOpenAiSdkFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async () => {
      bufferedBridgeCalled = true;
      return {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'text/plain']],
        body: 'buffered fallback',
      };
    },
    async () => {
      throw new Error('stream bridge unavailable');
    },
  );

  const response = await sdkFetch('https://api.openai.com/v1/responses', { method: 'POST', body: '{}' });
  assert.equal(response.status, 200);
  assert.equal(await response.text(), 'buffered fallback');
  assert.equal(bufferedBridgeCalled, true);
});

await runAsync('does not fall through to buffered bridge after streamed Tauri bridge aborts', async () => {
  const controller = new AbortController();
  let bufferedBridgeCalled = false;
  const sdkFetch = createOpenAiSdkFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async () => {
      bufferedBridgeCalled = true;
      return { status: 200, statusText: 'OK', headers: [], body: 'should not run' };
    },
    async (_request, signal) => {
      throw new DOMException(signal.reason?.message ?? 'The operation was aborted.', 'AbortError');
    },
  );

  controller.abort(new Error('user stopped'));
  await assert.rejects(
    () => sdkFetch('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: '{}',
      signal: controller.signal,
    }),
    /aborted|user stopped/i,
  );
  assert.equal(bufferedBridgeCalled, false);
});

await runAsync('aborts stalled Tauri bridge fallback requests', async () => {
  const controller = new AbortController();
  let bridgeCalled = false;
  const sdkFetch = createOpenAiSdkFetch(
    async () => {
      throw new TypeError('Failed to fetch');
    },
    async () => {
      bridgeCalled = true;
      return await new Promise(() => {});
    },
  );

  const promise = sdkFetch('https://api.openai.com/v1/responses', {
    method: 'POST',
    signal: controller.signal,
    body: '{}',
  });

  await new Promise(resolve => setTimeout(resolve, 0));
  controller.abort();

  await assert.rejects(
    promise,
    error => error instanceof DOMException && error.name === 'AbortError',
  );
  assert.equal(bridgeCalled, true);
});

await runAsync('does not bridge non-OpenAI fetch failures', async () => {
  const expected = new TypeError('network failed');
  let bridgeCalled = false;
  const sdkFetch = createOpenAiSdkFetch(
    async () => {
      throw expected;
    },
    async () => {
      bridgeCalled = true;
      return { status: 200, statusText: 'OK', headers: [], body: 'bridge' };
    },
  );

  await assert.rejects(
    () => sdkFetch('https://example.com/v1/responses', { method: 'POST', body: '{}' }),
    error => error === expected,
  );
  assert.equal(bridgeCalled, false);
});

await runAsync('prefers unsaved editor buffer content for SDK workspace reads', async () => {
  resetEditorSessionCacheForTests();
  markCachedEditorDirty('C:\\repo\\src\\App.tsx', 'unsaved editor text');
  let diskReadCalled = false;

  const result = await readSdkWorkspaceTextFile('C:/repo/src/App.tsx', async () => {
    diskReadCalled = true;
    return 'disk text';
  });

  assert.deepEqual(result, { content: 'unsaved editor text', source: 'editor' });
  assert.equal(diskReadCalled, false);
});

await runAsync('falls back to disk content for SDK workspace reads without dirty editor state', async () => {
  resetEditorSessionCacheForTests();
  const result = await readSdkWorkspaceTextFile('C:/repo/src/App.tsx', async path => `disk:${path}`);

  assert.deepEqual(result, { content: 'disk:C:/repo/src/App.tsx', source: 'disk' });
});
