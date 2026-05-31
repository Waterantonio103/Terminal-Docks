import { normalizeWorkspacePath } from './workspacePaths.js';

export interface EditorViewSnapshot {
  cursor: number;
  scrollTop: number;
  scrollLeft: number;
}

const contentCache = new Map<string, string>();
const dirtyContentCache = new Map<string, string>();
const viewStateCache = new Map<string, EditorViewSnapshot>();

function cleanEditorCachePath(path: string): string {
  return path.replace(/\0/g, '').trim();
}

function normalizeEditorCachePath(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
    return normalized.toLowerCase();
  }
  return normalized;
}

function getByNormalizedPath<T>(map: Map<string, T>, path: string): T | undefined {
  const exact = map.get(path);
  if (exact !== undefined) return exact;
  const normalized = normalizeEditorCachePath(path);
  for (const [candidate, value] of map.entries()) {
    if (normalizeEditorCachePath(candidate) === normalized) return value;
  }
  return undefined;
}

function deleteByNormalizedPath<T>(map: Map<string, T>, path: string): void {
  if (map.delete(path)) return;
  const normalized = normalizeEditorCachePath(path);
  for (const candidate of map.keys()) {
    if (normalizeEditorCachePath(candidate) === normalized) {
      map.delete(candidate);
      return;
    }
  }
}

function cleanViewStateNumber(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? Math.floor(value)
    : 0;
}

function cleanEditorViewSnapshot(snapshot: EditorViewSnapshot): EditorViewSnapshot {
  return {
    cursor: cleanViewStateNumber(snapshot.cursor),
    scrollTop: cleanViewStateNumber(snapshot.scrollTop),
    scrollLeft: cleanViewStateNumber(snapshot.scrollLeft),
  };
}

export function getCachedEditorContent(path?: string): string | undefined {
  return path ? getByNormalizedPath(contentCache, path) : undefined;
}

export function setCachedEditorContent(path: string, content: string) {
  const cleanPath = cleanEditorCachePath(path);
  if (!cleanPath) return;
  deleteByNormalizedPath(contentCache, cleanPath);
  contentCache.set(cleanPath, content);
}

export function markCachedEditorDirty(path: string, content: string) {
  const cleanPath = cleanEditorCachePath(path);
  if (!cleanPath) return;
  deleteByNormalizedPath(contentCache, cleanPath);
  deleteByNormalizedPath(dirtyContentCache, cleanPath);
  contentCache.set(cleanPath, content);
  dirtyContentCache.set(cleanPath, content);
}

export function clearCachedEditorDirty(path: string) {
  deleteByNormalizedPath(dirtyContentCache, path);
}

export function getCachedDirtyEditorContent(path: string): string | undefined {
  return getByNormalizedPath(dirtyContentCache, path);
}

export function listCachedDirtyEditorPaths(): string[] {
  return Array.from(dirtyContentCache.keys());
}

export function getCachedEditorViewState(path?: string): EditorViewSnapshot | undefined {
  return path ? getByNormalizedPath(viewStateCache, path) : undefined;
}

export function setCachedEditorViewState(path: string, snapshot: EditorViewSnapshot) {
  const cleanPath = cleanEditorCachePath(path);
  if (!cleanPath) return;
  deleteByNormalizedPath(viewStateCache, cleanPath);
  viewStateCache.set(cleanPath, cleanEditorViewSnapshot(snapshot));
}

export function resetEditorSessionCacheForTests() {
  contentCache.clear();
  dirtyContentCache.clear();
  viewStateCache.clear();
}
