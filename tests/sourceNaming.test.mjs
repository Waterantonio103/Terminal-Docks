import assert from 'node:assert/strict';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const sourceRoots = [
  'src',
  'src-tauri/src',
  'mcp-server/src',
  'README.md',
  'PRD.md',
  'architecture.md',
].map(entry => resolve(root, entry));

const textExtensions = new Set([
  '',
  '.css',
  '.html',
  '.js',
  '.json',
  '.md',
  '.mjs',
  '.rs',
  '.ts',
  '.tsx',
]);

const blockedTerms = [
  [116, 101, 114, 109, 105, 110, 97, 108, 45, 100, 111, 99, 107, 115],
  [84, 101, 114, 109, 105, 110, 97, 108, 32, 68, 111, 99, 107, 115],
  [67, 111, 109, 101, 116, 65, 73],
  [67, 111, 109, 101, 116, 32, 65, 73],
  [77, 67, 80, 32, 84, 111, 111, 108, 98, 111, 120],
  [77, 67, 80, 32, 83, 79, 85, 82, 67, 69, 83],
  [115, 119, 97, 114, 109],
  [83, 119, 97, 114, 109],
  [109, 112, 99],
].map(chars => String.fromCharCode(...chars));

function* walk(path) {
  if (!existsSync(path)) return;
  const stat = statSync(path);
  if (stat.isFile()) {
    yield path;
    return;
  }
  for (const entry of readdirSync(path)) {
    if (entry === 'target' || entry === 'dist' || entry === 'node_modules') continue;
    yield* walk(join(path, entry));
  }
}

const violations = [];
for (const sourceRoot of sourceRoots) {
  for (const file of walk(sourceRoot)) {
    if (!textExtensions.has(extname(file))) continue;
    const text = readFileSync(file, 'utf8');
    for (const term of blockedTerms) {
      if (text.includes(term)) {
        violations.push(`${file.slice(root.length + 1)} contains stale name ${JSON.stringify(term)}`);
      }
    }
  }
}

assert.deepEqual(violations, []);

console.log('PASS source naming stays on Comet-AI and Starlink terminology');
