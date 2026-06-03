import { syntaxTree } from '@codemirror/language';
import { linter, type Diagnostic } from '@codemirror/lint';
import type { EditorState } from '@codemirror/state';
import type { EditorView } from '@codemirror/view';
import { editorLanguageKindForPath } from './editorLanguage.js';

const MAX_SYNTAX_DIAGNOSTICS = 100;

const DIAGNOSTIC_LANGUAGE_KINDS = new Set([
  'json',
  'tsx',
  'typescript',
  'jsx',
  'javascript',
  'markdown',
  'css',
  'scss',
  'sass',
  'html',
  'xml',
  'vue',
  'svelte',
  'rust',
  'python',
  'go',
  'java',
  'kotlin',
  'swift',
  'c',
  'cpp',
  'csharp',
  'php',
  'ruby',
  'shell',
  'powershell',
  'sql',
  'dockerfile',
  'makefile',
  'diff',
  'toml',
  'yaml',
  'ini',
]);

export function supportsEditorDiagnostics(path?: string): boolean {
  return DIAGNOSTIC_LANGUAGE_KINDS.has(editorLanguageKindForPath(path));
}

export function syntaxDiagnosticsForState(state: EditorState): Diagnostic[] {
  const diagnostics: Diagnostic[] = [];
  const cursor = syntaxTree(state).cursor();

  do {
    if (!cursor.type.isError) continue;
    const from = Math.max(0, Math.min(cursor.from, state.doc.length));
    const to = Math.max(from, Math.min(cursor.to > cursor.from ? cursor.to : cursor.from + 1, state.doc.length));
    diagnostics.push({
      from,
      to,
      severity: 'error',
      message: 'Syntax error',
    });
    if (diagnostics.length >= MAX_SYNTAX_DIAGNOSTICS) break;
  } while (cursor.next());

  return diagnostics;
}

export function editorDiagnosticsExtensions(path?: string) {
  if (!supportsEditorDiagnostics(path)) return [];
  return [
    linter((view: EditorView) => syntaxDiagnosticsForState(view.state), {
      delay: 300,
    }),
  ];
}
