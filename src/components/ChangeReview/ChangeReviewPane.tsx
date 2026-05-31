import { useMemo, useState } from 'react';
import { Check, FileText, ListChecks, RotateCcw, X } from 'lucide-react';
import { invoke } from '@tauri-apps/api/core';
import { emit } from '@tauri-apps/api/event';
import type { Pane } from '../../store/workspace';
import { selectActivePanes, useWorkspaceStore } from '../../store/workspace';
import { CHANGE_REVIEW_APPLIED_EVENT, type ChangeReviewAppliedEvent } from '../../lib/changeReviewEvents';

interface ReviewArtifact {
  id: string;
  title: string;
  kind: string;
  path?: string | null;
  contentText?: string | null;
  content?: string | null;
}

interface DiffLine {
  type: 'context' | 'add' | 'remove';
  text: string;
}

interface DiffHunk {
  id: string;
  header: string;
  oldStart: number;
  oldLines: number;
  newStart: number;
  newLines: number;
  lines: DiffLine[];
}

interface FileDiff {
  id: string;
  oldPath: string;
  newPath: string;
  isNewFile: boolean;
  isDeletedFile: boolean;
  hunks: DiffHunk[];
}

type HunkState = 'pending' | 'accepted' | 'rejected';

function parseHunkHeader(header: string) {
  const match = header.match(/@@\s+-(\d+)(?:,(\d+))?\s+\+(\d+)(?:,(\d+))?/);
  return {
    oldStart: match ? Number(match[1]) : 1,
    oldLines: match?.[2] ? Number(match[2]) : 1,
    newStart: match ? Number(match[3]) : 1,
    newLines: match?.[4] ? Number(match[4]) : 1,
  };
}

function normalizePatchPath(path: string) {
  return path.replace(/^["']|["']$/g, '').replace(/^[ab]\//, '').trim();
}

function parseUnifiedDiff(input: string): FileDiff[] {
  const lines = input.split(/\r?\n/);
  const files: FileDiff[] = [];
  let current: FileDiff | null = null;
  let currentHunk: DiffHunk | null = null;

  const ensureFile = () => {
    if (!current) {
      current = { id: `file-${files.length}`, oldPath: '', newPath: '', isNewFile: false, isDeletedFile: false, hunks: [] };
      files.push(current);
    }
    return current;
  };

  for (const line of lines) {
    if (line.startsWith('diff --git ')) {
      const parts = line.split(/\s+/);
      current = {
        id: `file-${files.length}`,
        oldPath: normalizePatchPath(parts[2] ?? ''),
        newPath: normalizePatchPath(parts[3] ?? parts[2] ?? ''),
        isNewFile: false,
        isDeletedFile: false,
        hunks: [],
      };
      currentHunk = null;
      files.push(current);
      continue;
    }

    if (line.startsWith('--- ')) {
      ensureFile().oldPath = normalizePatchPath(line.slice(4));
      continue;
    }

    if (line.startsWith('+++ ')) {
      ensureFile().newPath = normalizePatchPath(line.slice(4));
      continue;
    }

    if (line.startsWith('@@ ')) {
      const file = ensureFile();
      const parsed = parseHunkHeader(line);
      currentHunk = {
        id: `${file.id}:hunk-${file.hunks.length}`,
        header: line,
        ...parsed,
        lines: [],
      };
      file.hunks.push(currentHunk);
      continue;
    }

    if (!currentHunk || line.startsWith('\\ No newline')) continue;
    const marker = line[0];
    if (marker === '+') currentHunk.lines.push({ type: 'add', text: line.slice(1) });
    else if (marker === '-') currentHunk.lines.push({ type: 'remove', text: line.slice(1) });
    else if (marker === ' ') currentHunk.lines.push({ type: 'context', text: line.slice(1) });
  }

  return files
    .map(file => {
      const oldPath = file.oldPath || file.newPath;
      const newPath = file.newPath || file.oldPath;
      return {
        ...file,
        oldPath,
        newPath,
        isNewFile: oldPath === '/dev/null',
        isDeletedFile: newPath === '/dev/null',
      };
    })
    .filter(file => file.hunks.length > 0 && (file.oldPath || file.newPath) && !(file.oldPath === '/dev/null' && file.newPath === '/dev/null'));
}

function extractPatchText(artifacts: ReviewArtifact[], explicitPatch?: string) {
  const parts = [
    explicitPatch,
    ...artifacts.map(artifact => artifact.contentText ?? artifact.content ?? ''),
  ].filter((value): value is string => Boolean(value?.includes('@@ ')));
  return parts.join('\n');
}

function collectChangedFiles(artifacts: ReviewArtifact[], explicitFiles: string[]) {
  return Array.from(new Set([
    ...explicitFiles,
    ...artifacts.flatMap(artifact => artifact.path ? [artifact.path] : []),
  ].filter(Boolean))).sort((a, b) => a.localeCompare(b));
}

function splitPreservingNewline(content: string) {
  const newline = content.includes('\r\n') ? '\r\n' : '\n';
  return {
    newline,
    trailingNewline: content.endsWith('\n'),
    lines: content.replace(/\r\n/g, '\n').split('\n').filter((_, index, arr) => index < arr.length - 1 || arr[index] !== ''),
  };
}

function findLineBlock(lines: string[], block: string[], fallbackIndex: number) {
  if (block.length === 0) return Math.max(0, Math.min(lines.length, fallbackIndex));
  outer: for (let i = 0; i <= lines.length - block.length; i += 1) {
    for (let j = 0; j < block.length; j += 1) {
      if (lines[i + j] !== block[j]) continue outer;
    }
    return i;
  }
  return -1;
}

function applyHunksToContent(content: string, hunks: DiffHunk[]) {
  const split = splitPreservingNewline(content);
  let lines = [...split.lines];
  let offset = 0;

  for (const hunk of hunks) {
    const oldBlock = hunk.lines.filter(line => line.type !== 'add').map(line => line.text);
    const newBlock = hunk.lines.filter(line => line.type !== 'remove').map(line => line.text);
    const fallbackIndex = Math.max(0, hunk.oldStart - 1 + offset);
    const index = findLineBlock(lines, oldBlock, fallbackIndex);
    if (index < 0) {
      throw new Error(`Could not apply ${hunk.header}; source lines no longer match.`);
    }
    lines.splice(index, oldBlock.length, ...newBlock);
    offset += newBlock.length - oldBlock.length;
  }

  return `${lines.join(split.newline)}${split.trailingNewline ? split.newline : ''}`;
}

function pathForReviewPath(path: string, workspaceDir?: string | null) {
  if (!path || path === '/dev/null') return '';
  if (!workspaceDir || /^[A-Za-z]:[\\/]/.test(path) || path.startsWith('/') || path.startsWith('\\')) return path;
  return `${workspaceDir.replace(/[\\/]+$/, '')}/${path}`;
}

function pathForFileDiff(diff: FileDiff, workspaceDir?: string | null) {
  return pathForReviewPath(diff.isDeletedFile ? diff.oldPath : diff.newPath || diff.oldPath, workspaceDir);
}

function parentDirectoryForPath(path: string) {
  const normalized = path.replace(/[\\/]+$/g, '');
  const match = normalized.match(/^(.*)[\\/]+([^\\/]+)$/);
  return match?.[1] || '';
}

function displayPathForFileDiff(diff: FileDiff) {
  if (diff.isNewFile) return diff.newPath;
  if (diff.isDeletedFile) return `${diff.oldPath} deleted`;
  if (diff.oldPath && diff.newPath && diff.oldPath !== diff.newPath) return `${diff.oldPath} -> ${diff.newPath}`;
  return diff.newPath || diff.oldPath;
}

function titleForPath(path: string) {
  return path.split(/[\\/]/).pop() || path || 'Untitled';
}

function comparePath(path: string) {
  return path.replace(/\\/g, '/').toLocaleLowerCase();
}

export function ChangeReviewPane({ pane }: { pane: Pane }) {
  const addPane = useWorkspaceStore(s => s.addPane);
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const activePanes = useWorkspaceStore(selectActivePanes);
  const workspaceDir = useWorkspaceStore(s => s.tabs.find(tab => tab.id === s.activeTabId)?.workspaceDir ?? s.workspaceDir);
  const artifacts = (pane.data?.artifacts ?? []) as ReviewArtifact[];
  const files = (pane.data?.files ?? []) as string[];
  const patch = pane.data?.patch as string | undefined;
  const sourceMissionId = pane.data?.missionId as string | undefined;
  const sourceThreadId = pane.data?.sourceThreadId as string | undefined;
  const sourceRuntimeSessionId = pane.data?.sourceRuntimeSessionId as string | undefined;
  const sourceCardId = pane.data?.sourceCardId as string | undefined;
  const sourceArtifactIds = (pane.data?.sourceArtifactIds ?? []) as string[];
  const [hunkStates, setHunkStates] = useState<Record<string, HunkState>>({});
  const [applying, setApplying] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  const fileDiffs = useMemo(() => parseUnifiedDiff(extractPatchText(artifacts, patch)), [artifacts, patch]);
  const changedFiles = useMemo(() => collectChangedFiles(artifacts, files), [artifacts, files]);
  const hunks = fileDiffs.flatMap(file => file.hunks.map(hunk => ({ file, hunk })));
  const acceptedHunks = hunks.filter(({ hunk }) => hunkStates[hunk.id] === 'accepted');

  const setAll = (state: HunkState) => {
    setHunkStates(Object.fromEntries(hunks.map(({ hunk }) => [hunk.id, state])));
  };

  const updateHunk = (id: string, state: HunkState) => {
    setHunkStates(previous => ({ ...previous, [id]: state }));
  };

  const applySelected = async (mode: 'accepted' | 'all') => {
    const selected = mode === 'all' ? hunks : acceptedHunks;
    if (selected.length === 0) {
      setMessage('No accepted hunks to apply.');
      return;
    }

    const byFile = new Map<string, { file: FileDiff; hunks: DiffHunk[] }>();
    for (const item of selected) {
      const key = item.file.id;
      const existing = byFile.get(key) ?? { file: item.file, hunks: [] };
      existing.hunks.push(item.hunk);
      byFile.set(key, existing);
    }

    setApplying(true);
    setMessage(null);
    const touchedPaths = new Set<string>();
    const artifactIds = Array.from(new Set([
      ...sourceArtifactIds,
      ...artifacts.map(artifact => artifact.id),
    ].filter(Boolean)));
    const publishApplyEvent = (status: ChangeReviewAppliedEvent['status'], error?: unknown) => {
      const payload: ChangeReviewAppliedEvent = {
        missionId: sourceMissionId ?? null,
        threadId: sourceThreadId ?? null,
        runtimeSessionId: sourceRuntimeSessionId ?? null,
        cardId: sourceCardId ?? null,
        title: pane.title || 'Review Changes',
        mode,
        status,
        hunkCount: selected.length,
        filePaths: Array.from(touchedPaths),
        artifactIds,
        error: error instanceof Error ? error.message : error ? String(error) : null,
      };
      void emit(CHANGE_REVIEW_APPLIED_EVENT, payload).catch(console.error);
    };
    try {
      for (const { file, hunks: fileHunks } of byFile.values()) {
        const filePath = pathForFileDiff(file, workspaceDir);
        if (!filePath) throw new Error(`No writable path found for ${displayPathForFileDiff(file)}`);
        touchedPaths.add(filePath);
        const content = file.isNewFile ? '' : await invoke<string>('workspace_read_text_file', { path: filePath });
        const nextContent = applyHunksToContent(content, fileHunks);
        if (file.isDeletedFile && fileHunks.length === file.hunks.length) {
          await invoke('workspace_delete', { targetPath: filePath });
        } else {
          if (file.isNewFile) {
            const parentPath = parentDirectoryForPath(filePath);
            if (parentPath) {
              await invoke('workspace_create_dir_all', { path: parentPath });
            }
          }
          await invoke('workspace_write_text_file', { path: filePath, content: nextContent });
        }

        const normalized = comparePath(filePath);
        activePanes
          .filter(openPane => openPane.type === 'editor' && openPane.data?.filePath && comparePath(openPane.data.filePath) === normalized)
          .forEach(openPane => updatePaneData(openPane.id, { editorReloadToken: `${Date.now()}-${openPane.id}` }));
      }
      setAll('accepted');
      setMessage(`Applied ${selected.length} hunk${selected.length === 1 ? '' : 's'}.`);
      publishApplyEvent('completed');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : String(error));
      publishApplyEvent('failed', error);
    } finally {
      setApplying(false);
    }
  };

  return (
    <div className="flex h-full flex-col bg-bg-panel text-text-secondary">
      <div className="flex items-center justify-between gap-3 border-b border-border-panel bg-bg-titlebar px-3 py-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-xs font-semibold text-text-primary">
            <ListChecks size={14} className="text-accent-primary" />
            <span className="truncate">{pane.title || 'Review Changes'}</span>
          </div>
          <div className="mt-0.5 truncate text-[10px] text-text-muted">
            {fileDiffs.length > 0 ? `${fileDiffs.length} diff file${fileDiffs.length === 1 ? '' : 's'} · ${hunks.length} hunk${hunks.length === 1 ? '' : 's'}` : `${changedFiles.length} changed file${changedFiles.length === 1 ? '' : 's'}`}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-1">
          <button type="button" onClick={() => setAll('accepted')} disabled={hunks.length === 0} className="td-review-button" title="Accept all hunks">
            <Check size={13} />
            <span>Accept All</span>
          </button>
          <button type="button" onClick={() => setAll('rejected')} disabled={hunks.length === 0} className="td-review-button" title="Reject all hunks">
            <X size={13} />
            <span>Reject All</span>
          </button>
          <button type="button" onClick={() => void applySelected('accepted')} disabled={applying || acceptedHunks.length === 0} className="td-review-button is-primary" title="Apply accepted hunks">
            <RotateCcw size={13} />
            <span>Apply Accepted</span>
          </button>
          <button type="button" onClick={() => void applySelected('all')} disabled={applying || hunks.length === 0} className="td-review-button is-primary" title="Apply all hunks">
            <Check size={13} />
            <span>Apply All</span>
          </button>
        </div>
      </div>

      {message && (
        <div className="border-b border-border-panel bg-bg-surface px-3 py-2 text-[11px] text-text-secondary">
          {message}
        </div>
      )}

      <div className="flex-1 overflow-y-auto p-3">
        {fileDiffs.length === 0 ? (
          <div className="rounded-lg border border-border-panel bg-bg-surface p-3">
            <div className="mb-2 text-xs font-semibold text-text-primary">Changed Files</div>
            {changedFiles.length === 0 ? (
              <div className="text-xs text-text-muted">No patch hunks or changed files were found in the selected agent output.</div>
            ) : (
              <div className="space-y-1">
                {changedFiles.map(file => (
                  <button
                    key={file}
                    type="button"
                    className="flex w-full items-center gap-2 rounded px-2 py-1 text-left text-[11px] text-text-secondary hover:bg-bg-panel hover:text-text-primary"
                    onClick={() => {
                      const filePath = pathForReviewPath(file, workspaceDir);
                      if (filePath) addPane('editor', titleForPath(filePath), { filePath });
                    }}
                  >
                    <FileText size={12} className="text-accent-primary" />
                    <span className="truncate">{file}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
        ) : (
          <div className="space-y-3">
            {fileDiffs.map(file => (
              <div key={file.id} className="overflow-hidden rounded-lg border border-border-panel bg-bg-surface">
                <div className="flex items-center justify-between gap-2 border-b border-border-panel bg-bg-titlebar px-3 py-2">
                  <button
                    type="button"
                    className="min-w-0 truncate text-left text-xs font-semibold text-text-primary hover:text-accent-primary"
                    onClick={() => {
                      const filePath = pathForFileDiff(file, workspaceDir);
                      if (filePath) addPane('editor', titleForPath(filePath), { filePath });
                    }}
                  >
                    {displayPathForFileDiff(file)}
                  </button>
                  <span className="text-[10px] text-text-muted">{file.hunks.length} hunks</span>
                </div>
                <div className="divide-y divide-border-panel/70">
                  {file.hunks.map(hunk => {
                    const state = hunkStates[hunk.id] ?? 'pending';
                    return (
                      <div key={hunk.id}>
                        <div className="flex items-center justify-between gap-2 px-3 py-2">
                          <div className="font-mono text-[10px] text-text-muted">{hunk.header}</div>
                          <div className="flex items-center gap-1">
                            <span className={`rounded border px-1.5 py-0.5 text-[9px] uppercase ${state === 'accepted' ? 'border-green-400/30 text-green-300' : state === 'rejected' ? 'border-red-400/30 text-red-300' : 'border-border-panel text-text-muted'}`}>
                              {state}
                            </span>
                            <button type="button" onClick={() => updateHunk(hunk.id, 'accepted')} className="td-review-icon-button" title="Accept hunk">
                              <Check size={12} />
                            </button>
                            <button type="button" onClick={() => updateHunk(hunk.id, 'rejected')} className="td-review-icon-button" title="Reject hunk">
                              <X size={12} />
                            </button>
                          </div>
                        </div>
                        <pre className="overflow-x-auto px-3 pb-3 font-mono text-[11px] leading-5">
                          {hunk.lines.map((line, index) => (
                            <div key={index} className={line.type === 'add' ? 'text-green-300' : line.type === 'remove' ? 'text-red-300' : 'text-text-muted'}>
                              <span className="select-none opacity-70">{line.type === 'add' ? '+' : line.type === 'remove' ? '-' : ' '}</span>
                              <span>{line.text || ' '}</span>
                            </div>
                          ))}
                        </pre>
                      </div>
                    );
                  })}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      <style>{`
        .td-review-button {
          display: inline-flex;
          align-items: center;
          gap: 4px;
          border: 1px solid var(--border-panel);
          border-radius: 6px;
          padding: 4px 7px;
          font-size: 10px;
          color: var(--text-secondary);
          background: var(--bg-surface);
        }
        .td-review-button:hover:not(:disabled) {
          color: var(--text-primary);
          border-color: color-mix(in srgb, var(--accent-primary) 40%, var(--border-panel));
        }
        .td-review-button:disabled {
          opacity: 0.4;
        }
        .td-review-button.is-primary {
          color: var(--accent-text);
          background: var(--accent-primary);
          border-color: var(--accent-primary);
        }
        .td-review-icon-button {
          display: inline-flex;
          align-items: center;
          justify-content: center;
          width: 22px;
          height: 22px;
          border-radius: 5px;
          color: var(--text-muted);
        }
        .td-review-icon-button:hover {
          color: var(--text-primary);
          background: var(--bg-panel);
        }
      `}</style>
    </div>
  );
}

export default ChangeReviewPane;
