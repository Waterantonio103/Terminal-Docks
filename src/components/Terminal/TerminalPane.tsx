import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn } from '@tauri-apps/api/event';

export function TerminalPane({ title, initialCommand }: { title: string; initialCommand?: string }) {
  const terminalRef = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon = useRef<FitAddon | null>(null);
  const [terminalId] = useState(() => crypto.randomUUID());

  useEffect(() => {
    if (!terminalRef.current) return;

    const term = new Terminal({
      cursorBlink: true,
      fontFamily: 'monospace',
      fontSize: 14,
      theme: {
        background: '#000000',
      },
    });

    const fit = new FitAddon();
    term.loadAddon(fit);
    
    term.open(terminalRef.current);
    
    // Add WebGL addon for performance if available
    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch (e) {
      console.warn('WebGL addon could not be loaded', e);
    }

    fit.fit();

    terminalInstance.current = term;
    fitAddon.current = fit;

    let unlisten: UnlistenFn | null = null;

    const initPty = async () => {
      unlisten = await listen<{ id: string; data: number[] }>('pty-out', (event) => {
        if (event.payload.id === terminalId) {
          term.write(new Uint8Array(event.payload.data));
        }
      });

      await invoke('spawn_pty', {
        id: terminalId,
        rows: term.rows || 24,
        cols: term.cols || 80,
      });

      if (initialCommand) {
        setTimeout(() => {
          invoke('write_to_pty', { id: terminalId, data: initialCommand + '\r' });
        }, 500);
      }
    };

    initPty();

    term.onData((data) => {
      invoke('write_to_pty', { id: terminalId, data });
    });

    const resizeObserver = new ResizeObserver(() => {
      fit.fit();
      if (term.rows && term.cols) {
        invoke('resize_pty', { id: terminalId, rows: term.rows, cols: term.cols });
      }
    });

    resizeObserver.observe(terminalRef.current);

    return () => {
      resizeObserver.disconnect();
      if (unlisten) unlisten();
      invoke('destroy_pty', { id: terminalId }).catch(console.error);
      term.dispose();
    };
  }, [title, terminalId]);

  return (
    <div className="flex flex-col h-full bg-bg-app">
      <div className="text-text-muted bg-bg-panel px-3 py-1 text-xs border-b border-border-panel shrink-0">
        {title}
      </div>
      <div className="flex-1 p-2 overflow-hidden">
        <div ref={terminalRef} className="h-full w-full" />
      </div>
    </div>
  );
}
