import { dirname, joinWorkspacePath, normalizeWorkspacePath } from './workspacePaths.js';

export interface WorkspaceTabLike {
  id?: string | null;
  panes?: Array<{ id?: string | null }>;
}

export interface WorkspacePaneLike {
  id?: string;
  title?: string | null;
  type?: string | null;
  data?: {
    cwd?: unknown;
    filePath?: unknown;
    workspaceDir?: unknown;
  } | null;
}

export interface WorkspaceGridPosLike {
  x: number;
  y: number;
  w: number;
  h: number;
}

function isWorkspacePaneLike(value: unknown): value is WorkspacePaneLike {
  return typeof value === 'object' && value !== null;
}

function isWorkspaceTabLike(value: unknown): value is WorkspaceTabLike {
  return typeof value === 'object' && value !== null;
}

function isWorkspaceTabPaneLike(value: unknown): value is { id?: string | null } {
  return typeof value === 'object' && value !== null;
}

function safeWorkspaceTabs(tabs: WorkspaceTabLike[] | null | undefined): WorkspaceTabLike[] {
  return Array.isArray(tabs) ? tabs.filter(isWorkspaceTabLike) : [];
}

function safeTabPanes(tab: WorkspaceTabLike | undefined): Array<{ id?: string | null }> {
  return Array.isArray(tab?.panes) ? tab.panes.filter(isWorkspaceTabPaneLike) : [];
}

function safeWorkspacePanes(panes: WorkspacePaneLike[] | null | undefined): WorkspacePaneLike[] {
  return Array.isArray(panes) ? panes.filter(isWorkspacePaneLike) : [];
}

function cleanWorkspaceEntityId(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/[\x00-\x1F\x7F]/g, '').trim()
    : '';
}

export function arrayMoveSafely<T>(array: T[], fromIndex: number, toIndex: number): T[] {
  if (
    !Number.isInteger(fromIndex)
    || !Number.isInteger(toIndex)
    || fromIndex < 0
    || toIndex < 0
    || fromIndex >= array.length
    || toIndex >= array.length
    || fromIndex === toIndex
  ) {
    return array;
  }

  const next = [...array];
  const [item] = next.splice(fromIndex, 1);
  next.splice(toIndex, 0, item);
  return next;
}

export function clampPaneInsertIndex(length: number, index: number): number {
  if (!Number.isInteger(length) || length <= 0) return 0;
  if (!Number.isInteger(index)) return length;
  return Math.max(0, Math.min(length, index));
}

export function normalizeWorkspaceGridPos(
  value: unknown,
  fallback: WorkspaceGridPosLike,
): WorkspaceGridPosLike {
  if (!value || typeof value !== 'object') return fallback;
  const gridPos = value as Partial<WorkspaceGridPosLike>;
  const width = Number.isFinite(gridPos.w) ? Math.max(2, Math.min(100, Math.floor(gridPos.w as number))) : fallback.w;
  const x = Number.isFinite(gridPos.x) ? Math.max(0, Math.floor(gridPos.x as number)) : fallback.x;
  return {
    x: Math.min(x, 100 - width),
    y: Number.isFinite(gridPos.y) ? Math.max(0, Math.floor(gridPos.y as number)) : fallback.y,
    w: width,
    h: Number.isFinite(gridPos.h) ? Math.max(2, Math.floor(gridPos.h as number)) : fallback.h,
  };
}

export function activeTabIdForTabs(
  tabs: WorkspaceTabLike[],
  requestedTabId: string | null | undefined,
  fallbackTabId?: string | null,
): string | null {
  const safeTabs = safeWorkspaceTabs(tabs);
  const requestedKey = cleanWorkspaceEntityId(requestedTabId);
  const fallbackKey = cleanWorkspaceEntityId(fallbackTabId);
  const requestedTab = requestedKey
    ? safeTabs.find(tab => cleanWorkspaceEntityId(tab.id) === requestedKey)
    : undefined;
  if (requestedTab?.id) {
    return requestedTab.id;
  }
  const fallbackTab = fallbackKey
    ? safeTabs.find(tab => cleanWorkspaceEntityId(tab.id) === fallbackKey)
    : undefined;
  if (fallbackTab?.id) {
    return fallbackTab.id;
  }
  const firstTabId = safeTabs.find(tab => cleanWorkspaceEntityId(tab.id))?.id;
  return firstTabId ?? null;
}

export function activePaneIdForTab(
  tabs: WorkspaceTabLike[],
  tabId: string | null | undefined,
  preferredPaneId?: string | null,
): string | null {
  const safeTabs = safeWorkspaceTabs(tabs);
  const tabKey = cleanWorkspaceEntityId(tabId);
  const preferredKey = cleanWorkspaceEntityId(preferredPaneId);
  const tab = safeTabs.find(candidate => cleanWorkspaceEntityId(candidate.id) === tabKey);
  if (!tab) return null;
  const panes = safeTabPanes(tab);
  const preferredPane = preferredKey
    ? panes.find(pane => cleanWorkspaceEntityId(pane.id) === preferredKey)
    : undefined;
  if (preferredPane?.id) {
    return preferredPane.id;
  }
  const firstPaneId = panes.find(pane => cleanWorkspaceEntityId(pane.id))?.id;
  return firstPaneId ?? null;
}

export function activePaneIdAfterReplacingTabPanes(
  tabs: WorkspaceTabLike[],
  tabId: string | null | undefined,
): string | null {
  return activePaneIdForTab(tabs, tabId, null);
}

export function activePaneIdForPanes(
  panes: WorkspacePaneLike[],
  preferredPaneId?: string | null,
): string | null {
  const safePanes = safeWorkspacePanes(panes);
  const preferredKey = cleanWorkspaceEntityId(preferredPaneId);
  const preferredPane = preferredKey
    ? safePanes.find(pane => cleanWorkspaceEntityId(pane.id) === preferredKey)
    : undefined;
  if (preferredPane?.id) {
    return preferredPane.id;
  }
  const firstPaneId = safePanes.find(pane => cleanWorkspaceEntityId(pane.id))?.id;
  return firstPaneId ?? null;
}

function isAbsoluteWorkspacePath(path: string): boolean {
  return /^[A-Za-z]:[\\/]/.test(path) || /^[\\/]/.test(path);
}

function isDriveRelativeWorkspacePath(path: string): boolean {
  return /^[A-Za-z]:(?![\\/])/.test(path);
}

function cleanWorkspacePathValue(value: unknown): string {
  return typeof value === 'string' ? value.replace(/\0/g, '').trim() : '';
}

function normalizeRelativeWorkspacePath(path: string): string | null {
  const segments: string[] = [];
  for (const part of path.replace(/\\/g, '/').split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (segments.length === 0) return null;
      segments.pop();
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}

function formatRelativePathForRoot(relativePath: string, root: string): string {
  return root.includes('\\') ? relativePath.replace(/\//g, '\\') : relativePath;
}

function formatNormalizedPathForSource(normalizedPath: string, sourcePath: string): string {
  if (!sourcePath.includes('\\')) return normalizedPath;
  if (normalizedPath.startsWith('//')) return `\\\\${normalizedPath.slice(2).replace(/\//g, '\\')}`;
  return normalizedPath.replace(/\//g, '\\');
}

function normalizeWorkspaceDirectoryValue(value: string): string {
  return formatNormalizedPathForSource(normalizeWorkspacePath(value), value);
}

function positiveTitleNumber(value: string | undefined): number | null {
  if (!value) return 1;
  const number = Number(value);
  return Number.isInteger(number) && number > 0 ? number : null;
}

function cleanPaneTitleValue(value: unknown): string {
  return typeof value === 'string'
    ? value.replace(/\0/g, '').replace(/\s+/g, ' ').trim()
    : '';
}

export function currentDirectoryForPane(
  pane: WorkspacePaneLike | null | undefined,
  workspaceDir: string | null | undefined,
): string | null {
  const paneCwd = cleanWorkspacePathValue(pane?.data?.cwd);
  const paneWorkspaceDir = cleanWorkspacePathValue(pane?.data?.workspaceDir);
  const rawRoot = paneWorkspaceDir || cleanWorkspacePathValue(workspaceDir);
  const root = rawRoot ? normalizeWorkspaceDirectoryValue(rawRoot) : '';
  if (paneCwd) {
    if (isDriveRelativeWorkspacePath(paneCwd)) return root || null;
    if (!isAbsoluteWorkspacePath(paneCwd)) {
      const relativeCwd = normalizeRelativeWorkspacePath(paneCwd);
      if (!relativeCwd) return root || null;
      return root ? joinWorkspacePath(root, formatRelativePathForRoot(relativeCwd, root)) : null;
    }
    return normalizeWorkspaceDirectoryValue(paneCwd);
  }

  const filePath = cleanWorkspacePathValue(pane?.data?.filePath);
  if (filePath) {
    if (isDriveRelativeWorkspacePath(filePath)) return root || null;
    const parentDirectory = dirname(filePath);
    if (parentDirectory !== filePath || /[\\/]/.test(filePath)) {
      if (!isAbsoluteWorkspacePath(parentDirectory)) {
        const relativeParent = normalizeRelativeWorkspacePath(parentDirectory);
        if (!relativeParent) return root || null;
        return root ? joinWorkspacePath(root, formatRelativePathForRoot(relativeParent, root)) : null;
      }
      return normalizeWorkspaceDirectoryValue(parentDirectory);
    }
  }

  return root || null;
}

export function nextUntitledEditorTitle(panes: WorkspacePaneLike[] | null | undefined): string {
  const safePanes = safeWorkspacePanes(panes);
  const usedNumbers = new Set<number>();

  for (const pane of safePanes) {
    if (pane.type && pane.type !== 'editor') continue;
    const title = cleanPaneTitleValue(pane.title);
    const match = title.match(/^Untitled(?:\s+(\d+))?$/i);
    if (!match) continue;
    const number = positiveTitleNumber(match[1]);
    if (number !== null) usedNumbers.add(number);
  }

  if (!usedNumbers.has(1)) return 'Untitled';

  let index = 2;
  while (usedNumbers.has(index)) index += 1;
  return `Untitled ${index}`;
}

export function nextTerminalTitle(panes: WorkspacePaneLike[] | null | undefined): string {
  const safePanes = safeWorkspacePanes(panes);
  const usedNumbers = new Set<number>();

  for (const pane of safePanes) {
    if (pane.type && pane.type !== 'terminal') continue;
    const title = cleanPaneTitleValue(pane.title);
    const match = title.match(/^Terminal(?:\s+(\d+))?$/i);
    if (!match) continue;
    const number = positiveTitleNumber(match[1]);
    if (number !== null) usedNumbers.add(number);
  }

  let index = 1;
  while (usedNumbers.has(index)) index += 1;
  return `Terminal ${index}`;
}
