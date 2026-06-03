import assert from 'node:assert/strict';

const {
  buildAgentConversationContext,
  classifyAgentStatusMessage,
  compactAgentConversation,
  parseAgentActionResult,
  parseAgentCommandSuggestion,
  parseAgentDirectoryProposal,
  parseAgentPatchProposal,
  parseAgentPreviewProposal,
  parseAgentTerminalStopProposal,
  parseAgentStatusLine,
  parseAgentTodoLine,
  parseStructuredAgentTodos,
  runtimeStepLabel,
  splitAgentContent,
  stripAgentAnsi,
} = await import('../.tmp-tests/lib/agentChatFormatting.js');

function run(name, fn) {
  try {
    fn();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

run('strips terminal control sequences and normalizes carriage returns', () => {
  assert.equal(stripAgentAnsi('\u001b[32mDone\u001b[0m\rNext'), 'Done\nNext');
});

run('parses markdown checklists into todo statuses', () => {
  assert.deepEqual(parseAgentTodoLine('- [ ] Read runtime events'), {
    label: 'Read runtime events',
    status: 'pending',
  });
  assert.deepEqual(parseAgentTodoLine('2. [x] Render toast cards'), {
    label: 'Render toast cards',
    status: 'completed',
  });
  assert.deepEqual(parseAgentTodoLine('* [>] Stream response'), {
    label: 'Stream response',
    status: 'in_progress',
  });
});

run('parses common agent progress lines into status blocks', () => {
  assert.deepEqual(parseAgentStatusLine('Running command: npm run test:graph'), {
    kind: 'status',
    label: 'Running command',
    detail: 'npm run test:graph',
    tone: 'info',
    icon: 'terminal',
  });
  assert.deepEqual(parseAgentStatusLine('Read file src/App.tsx'), {
    kind: 'status',
    label: 'Reading file',
    detail: 'src/App.tsx',
    tone: 'info',
    icon: 'file',
  });
  assert.deepEqual(parseAgentStatusLine('reading C:\\VSCODE\\comet-repo'), {
    kind: 'status',
    label: 'Reading path',
    detail: 'C:\\VSCODE\\comet-repo',
    tone: 'info',
    icon: 'file',
  });
  assert.equal(parseAgentStatusLine('read the codebase and tell me what it is about'), null);
  assert.equal(parseAgentStatusLine('read this folder and summarize it'), null);
  assert.deepEqual(parseAgentStatusLine('PASS parses todo output'), {
    kind: 'status',
    label: 'Check passed',
    detail: 'parses todo output',
    tone: 'success',
    icon: 'test',
  });
});

run('parses Terax-style todo_write payloads into todo items', () => {
  const content = 'tool-call todo_write {"todos":[{"title":"Inspect runtime output","description":"Find event shapes","status":"completed"},{"title":"Render todos","status":"in_progress"},{"title":"Verify UI","status":"pending"}]}';
  assert.deepEqual(parseStructuredAgentTodos(content), [
    { label: 'Inspect runtime output', description: 'Find event shapes', status: 'completed' },
    { label: 'Render todos', status: 'in_progress' },
    { label: 'Verify UI', status: 'pending' },
  ]);
});

run('parses nested todo_write input payloads from streamed tool text', () => {
  assert.deepEqual(parseStructuredAgentTodos(JSON.stringify({
    toolName: 'todo_write',
    input: {
      todos: [
        { content: 'Read Terax TodoStrip', state: 'done' },
        { task: 'Mirror compact rendering', state: 'active' },
      ],
    },
  })), [
    { label: 'Read Terax TodoStrip', status: 'completed' },
    { label: 'Mirror compact rendering', status: 'in_progress' },
  ]);
});

run('parses todo_write arguments serialized as JSON strings', () => {
  assert.deepEqual(parseStructuredAgentTodos(JSON.stringify({
    name: 'todo_write',
    arguments: JSON.stringify({
      todos: [
        { content: 'Read streamed arguments', status: 'completed' },
        { content: 'Render todo card', status: 'in_progress' },
      ],
    }),
  })), [
    { label: 'Read streamed arguments', status: 'completed' },
    { label: 'Render todo card', status: 'in_progress' },
  ]);
});

run('splits chat output into markdown and consecutive todo blocks', () => {
  assert.deepEqual(splitAgentContent('Plan:\n- [x] Inspect Terax\n- [>] Wire chat\n\nDone soon.'), [
    { kind: 'markdown', text: 'Plan:' },
    {
      kind: 'todos',
      items: [
        { label: 'Inspect Terax', status: 'completed' },
        { label: 'Wire chat', status: 'in_progress' },
      ],
    },
    { kind: 'markdown', text: 'Done soon.' },
  ]);
});

run('splits agent progress lines into inline status blocks', () => {
  assert.deepEqual(splitAgentContent('I will verify it.\nRunning command: npm run build\nPASS build completed\nDone.'), [
    { kind: 'markdown', text: 'I will verify it.' },
    { kind: 'status', label: 'Running command', detail: 'npm run build', tone: 'info', icon: 'terminal' },
    { kind: 'status', label: 'Check passed', detail: 'build completed', tone: 'success', icon: 'test' },
    { kind: 'markdown', text: 'Done.' },
  ]);
});

run('parses SDK command suggestions into command blocks', () => {
  const content = 'Suggested command\n\nReason: Verify SDK chat behavior\n\nWorking directory: C:/VSCODE/comet-ai\n\n```powershell\nnpm run test:graph\n```';
  assert.deepEqual(parseAgentCommandSuggestion(content), {
    kind: 'command',
    command: 'npm run test:graph',
    reason: 'Verify SDK chat behavior',
    cwd: 'C:/VSCODE/comet-ai',
    language: 'powershell',
    action: 'insert',
  });
  assert.deepEqual(splitAgentContent(`Before\n${content}\nAfter`), [
    { kind: 'markdown', text: 'Before' },
    {
      kind: 'command',
      command: 'npm run test:graph',
      reason: 'Verify SDK chat behavior',
      cwd: 'C:/VSCODE/comet-ai',
      language: 'powershell',
      action: 'insert',
    },
    { kind: 'markdown', text: 'After' },
  ]);

  assert.deepEqual(parseAgentActionResult([
    'Action result',
    'Kind: patch_review',
    'Status: started',
    'Title: Patch: update app',
    'Target: C:/repo/src/App.tsx',
  ].join('\n')), {
    kind: 'action_result',
    actionKind: 'patch_review',
    status: 'started',
    target: 'C:/repo/src/App.tsx',
    cardId: undefined,
    title: 'Patch: update app',
    command: undefined,
    cwd: undefined,
    action: undefined,
    terminalId: undefined,
    error: undefined,
  });
});

run('parses SDK command run proposals into command blocks', () => {
  const content = 'Command proposed\n\nReason: Verify production bundle\n\nWorking directory: C:/VSCODE/comet-ai\n\n```bash\nnpm run build\n```';
  assert.deepEqual(parseAgentCommandSuggestion(content), {
    kind: 'command',
    command: 'npm run build',
    reason: 'Verify production bundle',
    cwd: 'C:/VSCODE/comet-ai',
    language: 'bash',
    action: 'run',
  });
  assert.deepEqual(splitAgentContent(`Before\n${content}\nAfter`), [
    { kind: 'markdown', text: 'Before' },
    {
      kind: 'command',
      command: 'npm run build',
      reason: 'Verify production bundle',
      cwd: 'C:/VSCODE/comet-ai',
      language: 'bash',
      action: 'run',
    },
    { kind: 'markdown', text: 'After' },
  ]);
});

run('parses SDK background command proposals into command blocks', () => {
  const content = 'Background command proposed\n\nReason: Start local dev server\n\nWorking directory: C:/VSCODE/comet-ai\n\n```bash\nnpm run dev\n```';
  assert.deepEqual(parseAgentCommandSuggestion(content), {
    kind: 'command',
    command: 'npm run dev',
    reason: 'Start local dev server',
    cwd: 'C:/VSCODE/comet-ai',
    language: 'bash',
    action: 'background',
  });
  assert.deepEqual(splitAgentContent(`Before\n${content}\nAfter`), [
    { kind: 'markdown', text: 'Before' },
    {
      kind: 'command',
      command: 'npm run dev',
      reason: 'Start local dev server',
      cwd: 'C:/VSCODE/comet-ai',
      language: 'bash',
      action: 'background',
    },
    { kind: 'markdown', text: 'After' },
  ]);
});

run('parses SDK patch proposals into patch blocks', () => {
  const patch = [
    'diff --git a/src/App.tsx b/src/App.tsx',
    '--- a/src/App.tsx',
    '+++ b/src/App.tsx',
    '@@ -1,1 +1,1 @@',
    '-old',
    '+new',
  ].join('\n');
  const content = `Patch proposed\nTitle: Patch: update app\nPath: C:/repo/src/App.tsx\n\n\`\`\`diff\n${patch}\n\`\`\``;

  assert.deepEqual(parseAgentPatchProposal(content), {
    kind: 'patch',
    title: 'Patch: update app',
    path: 'C:/repo/src/App.tsx',
    patch,
  });
  assert.deepEqual(splitAgentContent(`Before\n${content}\nAfter`), [
    { kind: 'markdown', text: 'Before' },
    {
      kind: 'patch',
      title: 'Patch: update app',
      path: 'C:/repo/src/App.tsx',
      patch,
    },
    { kind: 'markdown', text: 'After' },
  ]);
});

run('parses SDK directory proposals into directory blocks', () => {
  const content = 'Directory proposed\nTitle: Create directory: fixtures\nPath: C:/repo/tests/fixtures';

  assert.deepEqual(parseAgentDirectoryProposal(content), {
    kind: 'directory',
    title: 'Create directory: fixtures',
    path: 'C:/repo/tests/fixtures',
  });
  assert.deepEqual(splitAgentContent(`Before\n${content}\nAfter`), [
    { kind: 'markdown', text: 'Before' },
    {
      kind: 'directory',
      title: 'Create directory: fixtures',
      path: 'C:/repo/tests/fixtures',
    },
    { kind: 'markdown', text: 'After' },
  ]);
});

run('parses SDK preview proposals into preview blocks', () => {
  const content = 'Preview proposed\nTitle: Local app\nURL: [http://0.0.0.0:5173/]';

  assert.deepEqual(parseAgentPreviewProposal(content), {
    kind: 'preview',
    title: 'Local app',
    url: 'http://localhost:5173',
  });
  assert.deepEqual(splitAgentContent(`Before\n${content}\nAfter`), [
    { kind: 'markdown', text: 'Before' },
    {
      kind: 'preview',
      title: 'Local app',
      url: 'http://localhost:5173',
    },
    { kind: 'markdown', text: 'After' },
  ]);
});

run('parses SDK terminal stop proposals into terminal stop blocks', () => {
  const content = 'Terminal stop proposed\nTitle: Stop terminal: Vite dev server\nTerminal ID:  term-123\u0000 \nReason: Restart requested';
  assert.deepEqual(parseAgentTerminalStopProposal(content), {
    kind: 'terminal_stop',
    title: 'Stop terminal: Vite dev server',
    terminalId: 'term-123',
    reason: 'Restart requested',
  });
  assert.deepEqual(splitAgentContent(`Before\n${content}\nAfter`), [
    { kind: 'markdown', text: 'Before' },
    {
      kind: 'terminal_stop',
      title: 'Stop terminal: Vite dev server',
      terminalId: 'term-123',
      reason: 'Restart requested',
    },
    { kind: 'markdown', text: 'After' },
  ]);

  assert.equal(parseAgentTerminalStopProposal('Terminal stop proposed\nTerminal ID: \u0000 '), null);
});

run('parses app action results into structured action blocks', () => {
  const content = [
    'Action result',
    'Kind: command',
    'Status: started',
    'Card ID: agent-1:0',
    'Target: sdk-command-abc123',
    'Command: npm run build',
    'Working directory: C:/repo',
    'Action: run',
    'Terminal ID:  sdk-command-abc123\u0000 ',
  ].join('\n');
  assert.deepEqual(parseAgentActionResult(content), {
    kind: 'action_result',
    actionKind: 'command',
    status: 'started',
    target: 'sdk-command-abc123',
    cardId: 'agent-1:0',
    title: undefined,
    command: 'npm run build',
    cwd: 'C:/repo',
    action: 'run',
    terminalId: 'sdk-command-abc123',
    error: undefined,
  });
  assert.deepEqual(splitAgentContent(`Before\n${content}\nAfter`), [
    { kind: 'markdown', text: 'Before' },
    {
      kind: 'action_result',
      actionKind: 'command',
      status: 'started',
      target: 'sdk-command-abc123',
      cardId: 'agent-1:0',
      title: undefined,
      command: 'npm run build',
      cwd: 'C:/repo',
      action: 'run',
      terminalId: 'sdk-command-abc123',
      error: undefined,
    },
    { kind: 'markdown', text: 'After' },
  ]);

  assert.equal(parseAgentActionResult([
    'Action result',
    'Kind: command',
    'Status: started',
    'Target: sdk-command-abc123',
    'Terminal ID: \u0000 ',
  ].join('\n'))?.terminalId, undefined);
});


run('splits structured todo_write lines into todo blocks instead of raw JSON', () => {
  assert.deepEqual(splitAgentContent('Updating plan:\n{"toolName":"todo_write","input":{"todos":[{"title":"Make chat functional","status":"in_progress"}]}}\nContinuing.'), [
    { kind: 'markdown', text: 'Updating plan:' },
    { kind: 'todos', items: [{ label: 'Make chat functional', status: 'in_progress' }] },
    { kind: 'markdown', text: 'Continuing.' },
  ]);
});

run('splits fenced structured todo JSON into todo blocks', () => {
  assert.deepEqual(splitAgentContent('Plan update:\n```json\n{\n  "toolName": "todo_write",\n  "input": {\n    "todos": [\n      { "title": "Read reference", "status": "completed" },\n      { "title": "Format chat output", "status": "in_progress" }\n    ]\n  }\n}\n```\nBack to work.'), [
    { kind: 'markdown', text: 'Plan update:' },
    {
      kind: 'todos',
      items: [
        { label: 'Read reference', status: 'completed' },
        { label: 'Format chat output', status: 'in_progress' },
      ],
    },
    { kind: 'markdown', text: 'Back to work.' },
  ]);
});

run('builds readable conversation context without raw todo JSON', () => {
  const context = buildAgentConversationContext([
    { role: 'user', content: 'Please inspect the agent window.' },
    { role: 'agent', content: '{"toolName":"todo_write","input":{"todos":[{"title":"Inspect Terax","status":"completed"},{"title":"Wire formatter","status":"in_progress"}]}}' },
    { role: 'system', content: 'Runtime session completed with success.' },
  ]);
  assert.match(context, /User: Please inspect the agent window\./);
  assert.match(context, /Todos:\n- \[x\] Inspect Terax\n- \[>\] Wire formatter/);
  assert.doesNotMatch(context, /toolName/);
  assert.doesNotMatch(context, /Runtime session completed/);
});

run('includes suggested commands in compact conversation context', () => {
  const context = buildAgentConversationContext([
    { role: 'tool', content: 'Suggested command\n\nReason: Run tests\n\n```bash\nnpm run test:graph\n```' },
  ]);
  assert.match(context, /Tool: Suggested command \(Run tests\): npm run test:graph/);
});

run('includes user card actions in compact conversation context', () => {
  const context = buildAgentConversationContext([
    {
      role: 'tool',
      content: [
        'Action result',
        'Kind: preview',
        'Status: completed',
        'Title: Local app',
        'Target: http://localhost:5173',
      ].join('\n'),
      status: 'completed',
    },
    {
      role: 'tool',
      content: [
        'Action result',
        'Kind: directory',
        'Status: completed',
        'Title: Create directory: fixtures',
        'Target: C:/repo/tests/fixtures',
      ].join('\n'),
      status: 'completed',
    },
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
      status: 'completed',
    },
  ]);
  assert.match(context, /Action result: preview completed \(http:\/\/localhost:5173\)/);
  assert.match(context, /Action result: directory completed \(C:\/repo\/tests\/fixtures\)/);
  assert.match(context, /Action result: command started \(sdk-command-abc123\)/);
  assert.match(context, /Terminal ID: sdk-command-abc123/);
  assert.match(context, /Action: run/);
});

run('summarizes patch proposals in compact conversation context', () => {
  const context = buildAgentConversationContext([
    {
      role: 'tool',
      artifactIds: ['sdk-patch-123'],
      filePaths: ['C:/repo/src/App.tsx'],
      content: [
        'Patch proposed',
        'Title: Patch: update app',
        'Path: C:/repo/src/App.tsx',
        '',
        '```diff',
        'diff --git a/src/App.tsx b/src/App.tsx',
        '--- a/src/App.tsx',
        '+++ b/src/App.tsx',
        '@@ -1,1 +1,1 @@',
        '-old',
        '+new',
        '```',
      ].join('\n'),
    },
  ]);
  assert.match(context, /Tool: Patch proposed: Patch: update app \(C:\/repo\/src\/App\.tsx\)/);
  assert.match(context, /Artifacts: sdk-patch-123/);
  assert.match(context, /Files: C:\/repo\/src\/App\.tsx/);
  assert.doesNotMatch(context, /diff --git/);
});

run('summarizes directory proposals in compact conversation context', () => {
  const context = buildAgentConversationContext([
    {
      role: 'tool',
      content: 'Directory proposed\nTitle: Create directory: fixtures\nPath: C:/repo/tests/fixtures',
    },
  ]);
  assert.match(context, /Tool: Directory proposed: Create directory: fixtures \(C:\/repo\/tests\/fixtures\)/);
});

run('summarizes preview proposals in compact conversation context', () => {
  const context = buildAgentConversationContext([
    {
      role: 'tool',
      content: 'Preview proposed\nTitle: Local app\nURL: [http://0.0.0.0:5173/]',
    },
  ]);
  assert.match(context, /Tool: Preview proposed: Local app \(http:\/\/localhost:5173\)/);
});

run('compacts older conversation while retaining recent tail', () => {
  const result = compactAgentConversation([
    { role: 'user', content: 'First ask' },
    { role: 'agent', content: 'First answer' },
    { role: 'user', content: 'Second ask' },
    { role: 'agent', content: 'Second answer' },
  ], { keepTail: 2 });
  assert.equal(result.compacted, true);
  assert.equal(result.droppedCount, 2);
  assert.deepEqual(result.retainedMessages, [
    { role: 'user', content: 'Second ask' },
    { role: 'agent', content: 'Second answer' },
  ]);
  assert.match(result.summary, /Compacted 2 earlier follow-up messages/);
  assert.match(result.summary, /First ask/);
});

run('compacted conversation summaries preserve artifact ids', () => {
  const result = compactAgentConversation([
    {
      role: 'tool',
      artifactIds: ['sdk-patch-abc'],
      filePaths: ['C:/repo/src/App.tsx'],
      content: 'Patch proposed\nTitle: Patch: update app\nPath: C:/repo/src/App.tsx\n\n```diff\ndiff --git a/src/App.tsx b/src/App.tsx\n@@ -1,1 +1,1 @@\n-old\n+new\n```',
    },
    { role: 'user', content: 'Continue' },
  ], { keepTail: 1 });
  assert.match(result.summary, /Referenced artifacts: sdk-patch-abc/);
  assert.match(result.summary, /Referenced files: C:\/repo\/src\/App\.tsx/);
});

run('classifies runtime system messages as UI status cards', () => {
  assert.deepEqual(classifyAgentStatusMessage({
    role: 'system',
    status: 'completed',
    content: 'Runtime session completed with success.',
  }), {
    kind: 'run_completed',
    label: 'Run completed',
    detail: 'Runtime session completed with success.',
    tone: 'success',
  });

  assert.deepEqual(classifyAgentStatusMessage({
    role: 'system',
    content: 'Waiting for permission: edit src/App.tsx',
  }), {
    kind: 'approval_needed',
    label: 'Permission needed',
    detail: 'edit src/App.tsx',
    tone: 'warn',
  });

  assert.deepEqual(classifyAgentStatusMessage({
    role: 'tool',
    content: 'Artifact: patch summary (src/App.tsx)',
  }), {
    kind: 'artifact_published',
    label: 'Artifact published',
    detail: 'patch summary (src/App.tsx)',
    tone: 'success',
  });

  assert.deepEqual(classifyAgentStatusMessage({
    role: 'tool',
    status: 'completed',
    content: 'Tool: Read file - src/App.tsx (1200 chars)',
  }), {
    kind: 'tool_used',
    label: 'Tool used',
    detail: 'Read file - src/App.tsx (1200 chars)',
    tone: 'info',
  });
});

run('maps runtime states to compact thinking labels', () => {
  assert.equal(runtimeStepLabel('running'), 'Thinking');
  assert.equal(runtimeStepLabel('awaiting_mcp_ready'), 'Connecting workspace tools');
  assert.equal(runtimeStepLabel('custom_phase'), 'Custom Phase');
  assert.equal(runtimeStepLabel(null), 'Thinking');
});
