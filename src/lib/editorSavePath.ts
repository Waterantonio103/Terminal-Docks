const WINDOWS_RESERVED_BASENAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i;
const MAX_SAVE_NAME_LENGTH = 120;

function truncateSaveName(name: string): string {
  if (name.length <= MAX_SAVE_NAME_LENGTH) return name;

  const extensionMatch = name.match(/(\.[^.\s]+)$/);
  const extension = extensionMatch?.[1] ?? '';
  const basename = extension ? name.slice(0, -extension.length) : name;
  const basenameLimit = Math.max(1, MAX_SAVE_NAME_LENGTH - extension.length);
  return `${basename.slice(0, basenameLimit)}${extension}`;
}

export function sanitizeEditorSaveName(title: unknown): string {
  const trimmed = typeof title === 'string' ? title.trim() || 'Untitled' : 'Untitled';
  const cleaned = trimmed
    .replace(/[<>:"/\\|?*\x00-\x1F]/g, '-')
    .replace(/\s+/g, ' ')
    .replace(/-+$/g, '')
    .replace(/[. ]+$/g, '')
    .replace(/^\.+(?:-|$)/g, '')
    .trim();
  const fallback = cleaned || 'Untitled';
  const safeName = WINDOWS_RESERVED_BASENAMES.test(fallback) ? `_${fallback}` : fallback;
  return truncateSaveName(safeName);
}

export function defaultEditorSavePath(workspaceDir: string | null | undefined, title: unknown): string {
  const fallbackTitle = sanitizeEditorSaveName(title);
  const fallbackName = /\.[^\\/.\s]+$/.test(fallbackTitle) ? fallbackTitle : `${fallbackTitle}.txt`;
  const root = workspaceDir?.replace(/\0/g, '').trim();
  if (!root) return fallbackName;
  const separator = root.includes('\\') ? '\\' : '/';
  return `${root.replace(/[\\/]+$/, '')}${separator}${fallbackName}`;
}
