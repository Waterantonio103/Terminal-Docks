import { normalizeWorkspacePath, workspacePathEquals } from './workspacePaths.js';

export interface FileTreeEntry {
  name: string;
  isDirectory: boolean;
  isFile: boolean;
}

export interface NormalizeFileTreeEntriesOptions {
  parentPath?: string | null;
}

const fileTreeEntrySorter = new Intl.Collator(undefined, {
  numeric: true,
  sensitivity: 'base',
});

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function cleanEntryName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  if (value.includes('\0')) return null;
  const name = value.trim();
  if (!name || name === '.' || name === '..') return null;
  if (/[\\/]/.test(name)) return null;
  return name;
}

function shouldUseCaseInsensitiveEntryKeys(parentPath: string | null | undefined): boolean {
  if (typeof parentPath !== 'string') return false;
  const path = parentPath.replace(/\0/g, '').trim();
  return /^[A-Za-z]:[\\/]/.test(path) || /^\\\\/.test(path) || path.startsWith('//');
}

function fileTreeEntryKey(name: string, caseInsensitive: boolean): string {
  return caseInsensitive ? name.toLowerCase() : name;
}

function shouldCompareFileNamesCaseInsensitive(filePath: string): boolean {
  const cleanPath = filePath.replace(/\0/g, '').trim();
  return /^[A-Za-z]:[\\/]/.test(cleanPath) || /^\\\\/.test(cleanPath) || cleanPath.startsWith('//');
}

function isAbsoluteFileTreeLockPath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]/.test(path);
}

function pathContainsSeparator(path: string): boolean {
  return /[\\/]/.test(path);
}

function relativeLockPathMatchesFilePath(lockPath: string, filePath: string): boolean {
  if (isAbsoluteFileTreeLockPath(lockPath) || !pathContainsSeparator(lockPath)) return false;
  const normalizedLockPath = normalizeWorkspacePath(lockPath);
  const normalizedFilePath = normalizeWorkspacePath(filePath);
  if (!normalizedLockPath || !normalizedFilePath) return false;
  const lockKey = shouldCompareFileNamesCaseInsensitive(filePath)
    ? normalizedLockPath.toLowerCase()
    : normalizedLockPath;
  const fileKey = shouldCompareFileNamesCaseInsensitive(filePath)
    ? normalizedFilePath.toLowerCase()
    : normalizedFilePath;
  return fileKey === lockKey || fileKey.endsWith(`/${lockKey}`);
}

export function fileTreeLockMatchesPath(lockPath: unknown, filePath: string, fileName: string): boolean {
  if (typeof lockPath !== 'string' || typeof filePath !== 'string' || typeof fileName !== 'string') return false;
  const cleanLockPath = lockPath.replace(/\0/g, '').trim();
  const cleanFilePath = filePath.replace(/\0/g, '').trim();
  const cleanFileName = fileName.replace(/\0/g, '').trim();
  if (!cleanLockPath || !cleanFilePath || !cleanFileName) return false;
  if (workspacePathEquals(cleanLockPath, cleanFilePath)) return true;
  if (relativeLockPathMatchesFilePath(cleanLockPath, cleanFilePath)) return true;
  if (pathContainsSeparator(cleanLockPath)) return false;

  const lockFileName = cleanLockPath.split(/[\\/]/).filter(Boolean).pop();
  if (!lockFileName) return false;
  return shouldCompareFileNamesCaseInsensitive(cleanFilePath)
    ? lockFileName.toLowerCase() === cleanFileName.toLowerCase()
    : lockFileName === cleanFileName;
}

export function normalizeFileTreeEntries(
  entries: unknown,
  options: NormalizeFileTreeEntriesOptions = {},
): FileTreeEntry[] {
  if (!Array.isArray(entries)) return [];

  const caseInsensitiveKeys = shouldUseCaseInsensitiveEntryKeys(options.parentPath);
  const normalizedByName = new Map<string, FileTreeEntry>();
  for (const entry of entries) {
    if (!isObject(entry)) continue;
    const name = cleanEntryName(entry.name);
    if (!name) continue;

    const isDirectory = entry.isDirectory === true;
    const isFile = entry.isFile === true && !isDirectory;
    if (!isDirectory && !isFile) continue;

    const entryKey = fileTreeEntryKey(name, caseInsensitiveKeys);
    const existing = normalizedByName.get(entryKey);
    if (!existing || (!existing.isDirectory && isDirectory)) {
      normalizedByName.set(entryKey, { name, isDirectory, isFile });
    }
  }

  return Array.from(normalizedByName.values()).sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1;
    return fileTreeEntrySorter.compare(a.name, b.name);
  });
}
