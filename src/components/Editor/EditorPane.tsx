import { useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { open } from '@tauri-apps/plugin-dialog';
import { FolderOpen } from 'lucide-react';
import { Pane, useWorkspaceStore } from '../../store/workspace';

const WELCOME = '// Welcome to the Editor\nconsole.log("Hello, world!");';

export function EditorPane({ pane }: { pane: Pane }) {
  const { id, title, data } = pane;
  const filePath = data?.filePath as string | undefined;
  const updatePaneData = useWorkspaceStore(s => s.updatePaneData);
  const [content, setContent] = useState(filePath ? '' : WELCOME);
  const [isDirty, setIsDirty] = useState(false);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!filePath) {
      setContent(WELCOME);
      setIsDirty(false);
      return;
    }
    setLoading(true);
    setContent('');
    readTextFile(filePath)
      .then(val => {
        setContent(val);
        setIsDirty(false);
      })
      .catch(err => {
        console.error('Failed to read file:', filePath, err);
        setContent(`// Error loading file:\n// ${err}`);
      })
      .finally(() => setLoading(false));
  }, [filePath]);

  const handleOpenFile = async () => {
    try {
      const selected = await open({ multiple: false, directory: false });
      const path = Array.isArray(selected) ? selected[0] : selected;
      if (path) {
        updatePaneData(id, { filePath: path });
      }
    } catch (err) {
      console.error('File dialog error:', err);
    }
  };

  const handleSave = async () => {
    if (filePath) {
      try {
        await writeTextFile(filePath, content);
        setIsDirty(false);
      } catch (err) {
        console.error('Failed to save file', err);
      }
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 's') {
      e.preventDefault();
      handleSave();
    }
  };

  return (
    <div className="flex flex-col h-full bg-bg-panel" onKeyDown={handleKeyDown}>
      <div className="flex items-center justify-between px-3 py-1.5 text-xs border-b border-border-panel shrink-0 bg-bg-titlebar">
        <span className="text-text-muted truncate max-w-[70%]">
          {loading ? 'Loading…' : filePath ? filePath.split(/[\\/]/).pop() : title}
          {isDirty && <span className="ml-1 text-accent-primary">●</span>}
        </span>
        <div className="flex items-center gap-2 shrink-0">
          <button
            onClick={handleOpenFile}
            className="text-text-muted hover:text-accent-primary transition-colors"
            title="Open file"
          >
            <FolderOpen size={13} />
          </button>
          {filePath && (
            <button
              onClick={handleSave}
              className="text-text-muted hover:text-accent-primary text-xs transition-colors"
            >
              Save
            </button>
          )}
        </div>
      </div>
      <div className="flex-1 overflow-auto h-full">
        <CodeMirror
          key={filePath || '__welcome__'}
          value={content}
          height="100%"
          theme="dark"
          extensions={[javascript({ jsx: true })]}
          onChange={(val) => {
            setContent(val);
            if (filePath && !isDirty) setIsDirty(true);
          }}
          className="h-full text-sm"
        />
      </div>
    </div>
  );
}
