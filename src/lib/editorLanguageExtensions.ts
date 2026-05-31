import { StreamLanguage } from '@codemirror/language';
import type { Extension } from '@codemirror/state';
import { editorLanguageKindForPath } from './editorLanguage.js';

export async function loadLanguageExtensionForPath(path?: string): Promise<Extension> {
  const kind = editorLanguageKindForPath(path);

  if (kind === 'json') {
    const { json } = await import('@codemirror/lang-json');
    return json();
  }
  if (kind === 'tsx') {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: true, typescript: true });
  }
  if (kind === 'typescript') {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ typescript: true });
  }
  if (kind === 'jsx') {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript({ jsx: true });
  }
  if (kind === 'javascript') {
    const { javascript } = await import('@codemirror/lang-javascript');
    return javascript();
  }
  if (kind === 'markdown') {
    const { markdown } = await import('@codemirror/lang-markdown');
    return markdown();
  }
  if (kind === 'css') {
    const { css } = await import('@codemirror/lang-css');
    return css();
  }
  if (kind === 'html') {
    const { html } = await import('@codemirror/lang-html');
    return html();
  }
  if (kind === 'rust') {
    const { rust } = await import('@codemirror/lang-rust');
    return rust();
  }
  if (kind === 'toml') {
    const { toml } = await import('@codemirror/legacy-modes/mode/toml');
    return StreamLanguage.define(toml);
  }
  if (kind === 'yaml') {
    const { yaml } = await import('@codemirror/legacy-modes/mode/yaml');
    return StreamLanguage.define(yaml);
  }

  return [];
}
