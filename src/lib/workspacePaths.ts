function cleanComparablePath(path: string): string {
  return path.replace(/\0/g, '').trim();
}

function normalizePathSegments(path: string, absoluteRoot = false): string {
  const segments: string[] = [];
  for (const part of path.split('/')) {
    if (!part || part === '.') continue;
    if (part === '..') {
      if (segments.length > 0 && segments[segments.length - 1] !== '..') {
        segments.pop();
      } else if (!absoluteRoot) {
        segments.push(part);
      }
      continue;
    }
    segments.push(part);
  }
  return segments.join('/');
}

export function dirname(path: string): string {
  const trimmed = cleanComparablePath(path);
  if (/^[A-Za-z]:[\\/]?$/.test(trimmed)) return `${trimmed[0]}:\\`;
  if (/^[\\/]+$/.test(trimmed)) return trimmed[0];

  const normalized = trimmed.replace(/[\\/]+$/, '');
  const uncRoot = normalized.match(/^([\\/]{2}[^\\/]+[\\/][^\\/]+)(?:[\\/].*)?$/)?.[1];
  const index = Math.max(normalized.lastIndexOf('/'), normalized.lastIndexOf('\\'));
  if (index === 2 && /^[A-Za-z]:/.test(normalized)) return normalized.slice(0, 3);
  if (index === 0) return normalized[0];
  const parent = index > 0 ? normalized.slice(0, index) : normalized;
  if (uncRoot && parent.length < uncRoot.length) return uncRoot;
  return parent;
}

export function joinWorkspacePath(parent: string, name: string): string {
  const cleanParent = cleanComparablePath(parent);
  const cleanName = cleanComparablePath(name);
  if (!cleanName) return cleanParent;
  const separator = cleanParent.includes('\\') ? '\\' : '/';
  if (!cleanParent) return separator === '\\' ? cleanName.replace(/\//g, '\\') : cleanName.replace(/\\/g, '/');
  const relativeName = cleanName.replace(/^[\\/]+/, '');
  const child = separator === '\\' ? relativeName.replace(/\//g, '\\') : relativeName.replace(/\\/g, '/');
  if (cleanParent.endsWith('/') || cleanParent.endsWith('\\')) return cleanParent + child;
  return `${cleanParent}${separator}${child}`;
}

export function normalizeWorkspacePath(path: string): string {
  const normalized = cleanComparablePath(path).replace(/\\/g, '/');
  if (/^[A-Za-z]:\/?$/.test(normalized)) return `${normalized[0]}:/`;
  if (/^\/+$/.test(normalized)) return '/';

  const driveMatch = normalized.match(/^([A-Za-z]:)(?:\/(.*))?$/);
  if (driveMatch) {
    const rest = normalizePathSegments(driveMatch[2] ?? '', true);
    return rest ? `${driveMatch[1]}/${rest}` : `${driveMatch[1]}/`;
  }

  const uncMatch = normalized.match(/^\/\/([^/]+)\/([^/]+)(?:\/(.*))?$/);
  if (uncMatch) {
    const rest = normalizePathSegments(uncMatch[3] ?? '', true);
    return rest ? `//${uncMatch[1]}/${uncMatch[2]}/${rest}` : `//${uncMatch[1]}/${uncMatch[2]}`;
  }

  if (normalized.startsWith('/')) {
    const rest = normalizePathSegments(normalized.slice(1), true);
    return rest ? `/${rest}` : '/';
  }

  return normalizePathSegments(normalized);
}

function workspacePathComparisonKey(path: string): string {
  const normalized = normalizeWorkspacePath(path);
  if (/^[A-Za-z]:\//.test(normalized) || normalized.startsWith('//')) {
    return normalized.toLowerCase();
  }
  return normalized;
}

export function workspacePathContains(parentPath: string, childPath: string): boolean {
  const normalizedParent = normalizeWorkspacePath(parentPath);
  const normalizedChild = normalizeWorkspacePath(childPath);
  if (!normalizedParent || !normalizedChild) return false;
  const parentKey = workspacePathComparisonKey(normalizedParent);
  const childKey = workspacePathComparisonKey(normalizedChild);
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`;
  return childKey === parentKey || childKey.startsWith(prefix);
}

export function workspacePathEquals(leftPath: string, rightPath: string): boolean {
  const leftKey = workspacePathComparisonKey(leftPath);
  const rightKey = workspacePathComparisonKey(rightPath);
  return Boolean(leftKey && rightKey && leftKey === rightKey);
}

export function relativeWorkspacePath(parentPath: string, childPath: string): string | null {
  const normalizedParent = normalizeWorkspacePath(parentPath);
  const normalizedChild = normalizeWorkspacePath(childPath);
  if (!normalizedParent || !normalizedChild) return null;
  const parentKey = workspacePathComparisonKey(normalizedParent);
  const childKey = workspacePathComparisonKey(normalizedChild);
  if (childKey === parentKey) return '';
  const prefix = parentKey.endsWith('/') ? parentKey : `${parentKey}/`;
  if (!childKey.startsWith(prefix)) return null;
  return normalizedChild.slice(prefix.length);
}

export function rebaseWorkspacePath(oldRoot: string, newRoot: string, childPath: string): string | null {
  const relative = relativeWorkspacePath(oldRoot, childPath);
  if (relative === null) return null;
  const cleanNewRoot = cleanComparablePath(newRoot);
  if (!cleanNewRoot) return null;
  return relative ? joinWorkspacePath(cleanNewRoot, relative) : cleanNewRoot;
}
