import { useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';
import { Pane } from '../../store/workspace';

export function EditorPane({ pane }: { pane: Pane }) {
  const { title, data } = pane;
  const filePath = data?.filePath;
  const [content, setContent] = useState('// Welcome to the Editor\nconsole.log("Hello, world!");');
  const [isDirty, setIsDirty] = useState(false);

  useEffect(() => {
    if (filePath) {
      readTextFile(filePath)
        .then(val => {
          setContent(val);
          setIsDirty(false);
        })
        .catch(err => console.error("Failed to read file", err));
    }
  }, [filePath]);

  const handleSave = async () => {
    if (filePath) {
      try {
        await writeTextFile(filePath, content);
        setIsDirty(false);
      } catch (err) {
        console.error("Failed to save file", err);
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
          {filePath ? filePath.split(/[\\/]/).pop() : title}
          {isDirty && <span className="ml-1 text-accent-primary">●</span>}
        </span>
        {filePath && (
          <button
            onClick={handleSave}
            className="text-text-muted hover:text-accent-primary text-xs transition-colors shrink-0"
          >
            Save
          </button>
        )}
      </div>
      <div className="flex-1 overflow-auto h-full">
        <CodeMirror
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
