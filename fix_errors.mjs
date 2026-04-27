import fs from 'fs';

let content = fs.readFileSync('mcp-server/server.mjs', 'utf8');

// Replace "return { error: `msg` };" with "return makeToolText(`msg`, true);"
// but only inside executeHandoffTask, executeSubmitAdaptivePatch, etc.

// Since the MCP tools expect makeToolText for errors, we can just replace all occurrences of `return { error: X }` inside the specific tool execution functions to use makeToolText.

function replaceErrorsInFunction(funcName) {
  const regex = new RegExp(`(export function ${funcName}[\\s\\S]*?)(^export function|$)`, 'm');
  const match = content.match(regex);
  if (match) {
    const originalBody = match[1];
    const newBody = originalBody.replace(/return\s*\{\s*error:\s*(.*?)\s*\};?/g, 'return makeToolText($1, true);');
    content = content.replace(originalBody, newBody);
  }
}

replaceErrorsInFunction('executeHandoffTask');
replaceErrorsInFunction('executeSubmitAdaptivePatch'); // Note: The function might be named appendAdaptivePatch
replaceErrorsInFunction('appendAdaptivePatch');

fs.writeFileSync('mcp-server/server.mjs', content);
