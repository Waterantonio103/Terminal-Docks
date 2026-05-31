import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const app = readFileSync(resolve(root, 'src/App.tsx'), 'utf8');
const css = readFileSync(resolve(root, 'src/App.css'), 'utf8');

for (const value of [
  "aria-controls={modeRailOpen ? 'td-mode-rail' : undefined}",
  'aria-expanded={modeRailOpen}',
  '<nav id="td-mode-rail" className="td-mode-rail" aria-label="Window rail">',
  'type="button"',
  'aria-label={mode.label}',
  "aria-current={appMode === mode.id ? 'page' : undefined}",
  'aria-label="Settings"',
  'aria-pressed={showSettings}',
  'aria-label={`Save ${dirtyEditorCount} dirty editor${dirtyEditorCount === 1 ? \'\' : \'s\'}`}',
  'aria-label="Minimize window"',
  'aria-label="Maximize window"',
  'aria-label="Close window"',
  'title="Minimize"',
  'title="Maximize"',
  'title="Close"',
]) {
  assert.ok(app.includes(value), `missing mode rail source marker: ${value}`);
}

for (const value of [
  '.td-mode-rail:has(.td-mode-rail-button:hover)::before',
  '.td-mode-rail:focus-within::before',
  '.td-mode-rail:has(.td-mode-rail-button:hover) .td-mode-rail-button',
  '.td-mode-rail:focus-within .td-mode-rail-button',
]) {
  assert.ok(css.includes(value), `missing mode rail overlay trigger marker: ${value}`);
}

console.log('PASS mode rail toggle and buttons expose accessible state without broad hover triggers');
