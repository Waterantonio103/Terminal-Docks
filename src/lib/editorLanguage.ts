export type EditorLanguageKind =
  | 'json'
  | 'tsx'
  | 'typescript'
  | 'jsx'
  | 'javascript'
  | 'markdown'
  | 'css'
  | 'html'
  | 'rust'
  | 'toml'
  | 'yaml'
  | 'env'
  | 'plain';

export function fileNameFromPath(path?: string): string {
  if (typeof path !== 'string') return '';
  const cleaned = path.replace(/\0/g, '').trim().replace(/[\\/]+$/g, '');
  return cleaned ? cleaned.split(/[\\/]/).pop() ?? cleaned : '';
}

export function extensionForPath(path?: string): string {
  const fileName = fileNameFromPath(path).toLowerCase();
  if (!fileName || !fileName.includes('.')) return '';
  return fileName.slice(fileName.lastIndexOf('.') + 1);
}

export function editorLanguageKindForPath(path?: string): EditorLanguageKind {
  const fileName = fileNameFromPath(path).toLowerCase();
  const ext = extensionForPath(path);

  if (
    fileName === 'package.json' ||
    fileName === 'package-lock.json' ||
    fileName === 'tsconfig.json' ||
    fileName.startsWith('tsconfig.') && ext === 'json' ||
    ext === 'json' ||
    ext === 'jsonc'
  ) return 'json';
  if (ext === 'tsx') return 'tsx';
  if (ext === 'ts') return 'typescript';
  if (ext === 'jsx') return 'jsx';
  if (['js', 'mjs', 'cjs'].includes(ext)) return 'javascript';
  if (['md', 'markdown'].includes(ext)) return 'markdown';
  if (ext === 'css') return 'css';
  if (['html', 'htm'].includes(ext)) return 'html';
  if (ext === 'rs') return 'rust';
  if (fileName === 'cargo.lock' || ext === 'toml') return 'toml';
  if (['yaml', 'yml'].includes(ext)) return 'yaml';
  if (fileName === '.env' || fileName.startsWith('.env.') || fileName.startsWith('.env-')) return 'env';

  return 'plain';
}

export function languageLabelForPath(path?: string): string {
  switch (editorLanguageKindForPath(path)) {
    case 'json':
      return 'JSON';
    case 'tsx':
      return 'TSX';
    case 'typescript':
      return 'TypeScript';
    case 'jsx':
      return 'JSX';
    case 'javascript':
      return 'JavaScript';
    case 'markdown':
      return 'Markdown';
    case 'css':
      return 'CSS';
    case 'html':
      return 'HTML';
    case 'rust':
      return 'Rust';
    case 'toml':
      return 'TOML';
    case 'yaml':
      return 'YAML';
    case 'env':
      return 'ENV';
    case 'plain':
    default:
      return 'Plain Text';
  }
}
