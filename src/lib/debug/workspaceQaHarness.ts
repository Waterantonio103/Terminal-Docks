import { invoke } from '@tauri-apps/api/core';
import { Window } from '@tauri-apps/api/window';
import { useWorkspaceStore } from '../../store/workspace.js';
import { languageLabelForPath } from '../editorLanguage.js';

interface WorkspaceQaOptions {
  workspaceDir: string;
  reportPath: string;
  closeWhenDone: boolean;
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function waitFor(condition: () => boolean, timeoutMs: number, label: string): Promise<number> {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    if (condition()) return Date.now() - startedAt;
    await sleep(100);
  }
  throw new Error(`Timed out waiting for ${label}`);
}

function bodyText(): string {
  return document.body.innerText.replace(/\s+/g, ' ').trim();
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export async function runWorkspaceQaHarness(options: WorkspaceQaOptions): Promise<void> {
  const files = [
    `${options.workspaceDir}\\comet-editor-config.json`,
    `${options.workspaceDir}\\comet-editor-notes.md`,
    `${options.workspaceDir}\\comet-editor-large.tsx`,
  ];
  const report: Record<string, unknown> = {
    startedAt: new Date().toISOString(),
    workspaceDir: options.workspaceDir,
    files: [],
    rendered: null,
    status: 'running',
  };

  const writeReport = async () => {
    await invoke('workspace_write_text_file', {
      path: options.reportPath,
      content: JSON.stringify(report, null, 2),
    });
  };

  try {
    await writeReport();

    const fileFacts = [];
    for (const filePath of files) {
      const content = await invoke<string>('workspace_read_text_file', { path: filePath });
      fileFacts.push({
        filePath,
        bytes: new Blob([content]).size,
        lines: content.split(/\r?\n/).length,
        language: languageLabelForPath(filePath),
      });
    }
    report.files = fileFacts;

    const store = useWorkspaceStore.getState();
    store.setAppMode('workspace');
    store.setWorkspaceDir(options.workspaceDir);
    store.clearPanes();

    const openedAt = Date.now();
    for (const filePath of files) {
      const title = filePath.split(/[\\/]/).pop() ?? filePath;
      useWorkspaceStore.getState().addPane('editor', title, { filePath });
    }

    const renderedMs = await waitFor(() => {
      const text = bodyText();
      return files.every(filePath => text.includes(filePath.split(/[\\/]/).pop() ?? filePath));
    }, 15_000, 'editor file tabs');

    await waitFor(() => document.querySelectorAll('.cm-editor').length >= 1, 30_000, 'CodeMirror editor');
    await waitFor(() => document.querySelectorAll('.cm-gutters').length >= 1, 30_000, 'CodeMirror gutters');

    const text = bodyText();
    const rendered = {
      openedMs: Date.now() - openedAt,
      renderedMs,
      editorCount: document.querySelectorAll('.cm-editor').length,
      gutterCount: document.querySelectorAll('.cm-gutters').length,
      visibleLineCount: document.querySelectorAll('.cm-line').length,
      bodyTextIncludesFileNames: files.every(filePath => text.includes(filePath.split(/[\\/]/).pop() ?? filePath)),
      activeLanguageLabelVisible: text.includes('TSX'),
      largeFileActive: text.includes('comet-editor-large.tsx'),
    };
    const checksPassed =
      rendered.editorCount >= 1 &&
      rendered.gutterCount >= 1 &&
      rendered.visibleLineCount >= 1 &&
      rendered.bodyTextIncludesFileNames &&
      rendered.activeLanguageLabelVisible &&
      rendered.largeFileActive;

    report.rendered = {
      ...rendered,
      checksPassed,
    };
    report.status = checksPassed ? 'passed' : 'failed';
    report.finishedAt = new Date().toISOString();
    await writeReport();

    if (!checksPassed) {
      throw new Error(`Workspace editor QA checks failed: ${JSON.stringify(rendered)}`);
    }

    if (options.closeWhenDone) {
      await Window.getCurrent().close();
    }
  } catch (error) {
    report.status = 'failed';
    report.error = errorMessage(error);
    report.debug = {
      bodyText: bodyText().slice(0, 2000),
      editorCount: document.querySelectorAll('.cm-editor').length,
      gutterCount: document.querySelectorAll('.cm-gutters').length,
      paneTextCount: document.querySelectorAll('[data-pane-id]').length,
    };
    report.finishedAt = new Date().toISOString();
    await writeReport().catch(console.error);
    throw error;
  }
}

export function workspaceQaOptionsFromEnv(): WorkspaceQaOptions {
  const repoRoot = import.meta.env.VITE_WORKSPACE_QA_REPO_ROOT || 'C:\\VSCODE\\comet-ai';
  return {
    workspaceDir: import.meta.env.VITE_WORKSPACE_QA_DIR || `${repoRoot}\\tmp-qa\\editor-files`,
    reportPath: import.meta.env.VITE_WORKSPACE_QA_REPORT || `${repoRoot}\\.tmp-tests\\workspace-qa-report.json`,
    closeWhenDone: import.meta.env.VITE_WORKSPACE_QA_CLOSE !== '0',
  };
}
