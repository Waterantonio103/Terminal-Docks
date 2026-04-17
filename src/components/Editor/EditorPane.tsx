import { useState, useEffect } from 'react';
import CodeMirror from '@uiw/react-codemirror';
import { javascript } from '@codemirror/lang-javascript';
import { readTextFile, writeTextFile } from '@tauri-apps/plugin-fs';

export function EditorPane({ title, filePath }: { title: string; filePath?: string }) {
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
      <div className="text-text-muted bg-bg-panel px-3 py-1 text-xs border-b border-border-panel shrink-0 flex justify-between items-center">
        <span>{filePath ? filePath : title} {isDirty ? '*' : ''}</span>
        {filePath && (
          <button onClick={handleSave} className="text-accent-primary hover:text-accent-hover">Save (Ctrl+S)</button>
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
