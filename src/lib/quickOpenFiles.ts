import { joinWorkspacePath, normalizeWorkspacePath } from './workspacePaths.js';

export interface QuickOpenDirEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface QuickOpenFileEntry {
  path: string;
  name: string;
}

export type QuickOpenReadDir = (path: string) => Promise<QuickOpenDirEntry[]>;

export interface CollectQuickOpenFilesOptions {
  maxFiles?: number;
  maxDepth?: number;
  signal?: AbortSignal;
  ignoredDirectories?: Iterable<string>;
  throwOnRootReadError?: boolean;
}

const DEFAULT_IGNORED_DIRECTORIES = new Set([
  '.git',
  '.next',
  '.nuxt',
  '.svelte-kit',
  '.tmp-tests',
  'build',
  'coverage',
  'dist',
  'node_modules',
  'out',
  'target',
]);

const DEFAULT_VISIBLE_FILE_LIMIT = 50;

const quickOpenEntrySorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function normalizePositiveInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value <= 0) return fallback;
  return Math.floor(value);
}

function normalizeNonNegativeInteger(value: number | undefined, fallback: number): number {
  if (value === undefined || !Number.isFinite(value) || value < 0) return fallback;
  return Math.floor(value);
}

function cleanEntryName(entry: QuickOpenDirEntry): string {
  return typeof entry.name === 'string' ? entry.name.trim() : '';
}

function normalizeIgnoredDirectoryName(value: string): string | null {
  const name = value.replace(/\0/g, '').trim().toLowerCase();
  return name && !/[\\/]/.test(name) ? name : null;
}

function quickOpenFileKey(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  return /^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')
    ? normalized.toLowerCase()
    : normalized;
}

function shouldSkipEntry(entry: QuickOpenDirEntry, ignoredDirectories: Set<string>): boolean {
  const name = cleanEntryName(entry);
  if (!name || name === '.' || name === '..' || name.includes('\0') || /[\\/]/.test(name)) return true;
  if (entry.isDirectory === entry.isFile) return true;
  return entry.isDirectory && (name.startsWith('.') || ignoredDirectories.has(name.toLowerCase()));
}

function isQuickOpenDirEntry(value: unknown): value is QuickOpenDirEntry {
  if (typeof value !== 'object' || value === null) return false;
  const entry = value as Partial<QuickOpenDirEntry>;
  return (
    typeof entry.name === 'string' &&
    typeof entry.isDirectory === 'boolean' &&
    typeof entry.isFile === 'boolean'
  );
}

function sortEntries(entries: unknown): QuickOpenDirEntry[] {
  if (!Array.isArray(entries)) return [];
  return entries.filter(isQuickOpenDirEntry).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return quickOpenEntrySorter.compare(cleanEntryName(a), cleanEntryName(b));
  });
}

function isQuickOpenFileEntry(value: unknown): value is QuickOpenFileEntry {
  if (typeof value !== 'object' || value === null) return false;
  const file = value as Partial<QuickOpenFileEntry>;
  return (
    typeof file.name === 'string' &&
    typeof file.path === 'string' &&
    Boolean(file.name.trim()) &&
    Boolean(file.path.trim())
  );
}

function cleanQuickOpenQuery(query: unknown): string {
  return typeof query === 'string' ? query.replace(/\0/g, '').trim() : '';
}

export function cleanQuickOpenStatusText(
  value: unknown,
  fallback = 'Unable to scan workspace files',
): string {
  const text = typeof value === 'string'
    ? value.replace(/\0/g, '').replace(/\s+/g, ' ').trim()
    : '';
  return text ? text.slice(0, 180) : fallback;
}

export async function collectQuickOpenFiles(
  rootDir: string,
  readDir: QuickOpenReadDir,
  options: CollectQuickOpenFilesOptions = {},
): Promise<QuickOpenFileEntry[]> {
  const cleanRootDir = typeof rootDir === 'string' ? rootDir.replace(/\0/g, '').trim() : '';
  if (!cleanRootDir) return [];

  const maxFiles = normalizePositiveInteger(options.maxFiles, 500);
  const maxDepth = normalizeNonNegativeInteger(options.maxDepth, 4);
  const ignoredDirectories = new Set(
    [...DEFAULT_IGNORED_DIRECTORIES, ...(options.ignoredDirectories ?? [])]
      .map(normalizeIgnoredDirectoryName)
      .filter((directory): directory is string => Boolean(directory)),
  );
  const results: QuickOpenFileEntry[] = [];
  const seenFilePaths = new Set<string>();

  async function visit(dir: string, depth: number): Promise<void> {
    if (options.signal?.aborted || results.length >= maxFiles || depth > maxDepth) return;

    let entries: unknown;
    try {
      entries = await readDir(dir);
    } catch (error) {
      if (depth === 0 && options.throwOnRootReadError && !options.signal?.aborted) {
        throw error;
      }
      return;
    }

    for (const entry of sortEntries(entries)) {
      if (options.signal?.aborted || results.length >= maxFiles) return;
      if (shouldSkipEntry(entry, ignoredDirectories)) continue;

      const name = cleanEntryName(entry);
      const fullPath = joinWorkspacePath(dir, name);
      if (entry.isDirectory) {
        await visit(fullPath, depth + 1);
      } else if (entry.isFile) {
        const fileKey = quickOpenFileKey(fullPath);
        if (seenFilePaths.has(fileKey)) continue;
        seenFilePaths.add(fileKey);
        results.push({ path: fullPath, name });
      }
    }
  }

  await visit(cleanRootDir, 0);
  return options.signal?.aborted ? [] : results;
}

function quickOpenMatchScore(file: QuickOpenFileEntry, query: string): number | null {
  const normalizedQuery = cleanQuickOpenQuery(query).replace(/\\/g, '/').toLowerCase();
  if (!normalizedQuery) return null;

  const name = file.name.toLowerCase();
  const path = file.path.replace(/\\/g, '/').toLowerCase();
  if (name === normalizedQuery) return 0;
  if (name.startsWith(normalizedQuery)) return 1;
  if (name.includes(normalizedQuery)) return 2;
  if (path.includes(normalizedQuery)) return 3;

  const tokens = normalizedQuery.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every(token => path.includes(token))) return 4;
  return null;
}

export function filterQuickOpenFiles(
  files: QuickOpenFileEntry[] | unknown,
  query: unknown,
  limit = DEFAULT_VISIBLE_FILE_LIMIT,
): QuickOpenFileEntry[] {
  const normalizedLimit = normalizePositiveInteger(limit, DEFAULT_VISIBLE_FILE_LIMIT);
  const safeFiles = Array.isArray(files) ? files.filter(isQuickOpenFileEntry) : [];
  const trimmed = cleanQuickOpenQuery(query);
  if (!trimmed) return safeFiles.slice(0, normalizedLimit);

  return safeFiles
    .map((file, index) => ({ file, index, score: quickOpenMatchScore(file, trimmed) }))
    .filter((item): item is { file: QuickOpenFileEntry; index: number; score: number } => item.score !== null)
    .sort((a, b) => (
      a.score - b.score ||
      a.file.name.length - b.file.name.length ||
      a.file.path.length - b.file.path.length ||
      a.index - b.index
    ))
    .slice(0, normalizedLimit)
    .map(item => item.file);
}
