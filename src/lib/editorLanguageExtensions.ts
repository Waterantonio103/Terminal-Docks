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
  if (kind === 'scss') {
    const { sass } = await import('@codemirror/lang-sass');
    return sass();
  }
  if (kind === 'sass') {
    const { sass } = await import('@codemirror/lang-sass');
    return sass({ indented: true });
  }
  if (kind === 'html') {
    const { html } = await import('@codemirror/lang-html');
    return html();
  }
  if (kind === 'xml') {
    const { xml } = await import('@codemirror/lang-xml');
    return xml();
  }
  if (kind === 'vue') {
    const { html } = await import('@codemirror/lang-html');
    const { vue } = await import('@codemirror/lang-vue');
    return vue({ base: html() });
  }
  if (kind === 'svelte') {
    const { html } = await import('@codemirror/lang-html');
    return html();
  }
  if (kind === 'rust') {
    const { rust } = await import('@codemirror/lang-rust');
    return rust();
  }
  if (kind === 'python') {
    const { python } = await import('@codemirror/lang-python');
    return python();
  }
  if (kind === 'go') {
    const { go } = await import('@codemirror/lang-go');
    return go();
  }
  if (kind === 'java') {
    const { java } = await import('@codemirror/lang-java');
    return java();
  }
  if (kind === 'kotlin') {
    const { kotlin } = await import('@codemirror/legacy-modes/mode/clike');
    return StreamLanguage.define(kotlin);
  }
  if (kind === 'swift') {
    const { swift } = await import('@codemirror/legacy-modes/mode/swift');
    return StreamLanguage.define(swift);
  }
  if (kind === 'c') {
    const { c } = await import('@codemirror/legacy-modes/mode/clike');
    return StreamLanguage.define(c);
  }
  if (kind === 'cpp') {
    const { cpp } = await import('@codemirror/lang-cpp');
    return cpp();
  }
  if (kind === 'csharp') {
    const { csharp } = await import('@codemirror/legacy-modes/mode/clike');
    return StreamLanguage.define(csharp);
  }
  if (kind === 'php') {
    const { php } = await import('@codemirror/lang-php');
    return php();
  }
  if (kind === 'ruby') {
    const { ruby } = await import('@codemirror/legacy-modes/mode/ruby');
    return StreamLanguage.define(ruby);
  }
  if (kind === 'shell') {
    const { shell } = await import('@codemirror/legacy-modes/mode/shell');
    return StreamLanguage.define(shell);
  }
  if (kind === 'powershell') {
    const { powerShell } = await import('@codemirror/legacy-modes/mode/powershell');
    return StreamLanguage.define(powerShell);
  }
  if (kind === 'sql') {
    const { sql } = await import('@codemirror/lang-sql');
    return sql();
  }
  if (kind === 'dockerfile') {
    const { dockerFile } = await import('@codemirror/legacy-modes/mode/dockerfile');
    return StreamLanguage.define(dockerFile);
  }
  if (kind === 'makefile') {
    const { cmake } = await import('@codemirror/legacy-modes/mode/cmake');
    return StreamLanguage.define(cmake);
  }
  if (kind === 'diff') {
    const { diff } = await import('@codemirror/legacy-modes/mode/diff');
    return StreamLanguage.define(diff);
  }
  if (kind === 'toml') {
    const { toml } = await import('@codemirror/legacy-modes/mode/toml');
    return StreamLanguage.define(toml);
  }
  if (kind === 'yaml') {
    const { yaml } = await import('@codemirror/legacy-modes/mode/yaml');
    return StreamLanguage.define(yaml);
  }
  if (kind === 'ini' || kind === 'env') {
    const { properties } = await import('@codemirror/legacy-modes/mode/properties');
    return StreamLanguage.define(properties);
  }

  return [];
}
