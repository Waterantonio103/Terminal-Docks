import { useEffect, useRef, useState } from 'react';
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { SearchAddon } from '@xterm/addon-search';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import { invoke } from '@tauri-apps/api/core';
import { listen, UnlistenFn, emit } from '@tauri-apps/api/event';
import { writeText, readText } from '@tauri-apps/plugin-clipboard-manager';
import { openUrl } from '@tauri-apps/plugin-opener';
import { useWorkspaceStore, Pane } from '../../store/workspace';
import { ChevronDown, ChevronUp, X } from 'lucide-react';

interface ContextMenuState { x: number; y: number }

export function TerminalPane({ pane }: { pane: Pane }) {
  const terminalRef      = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon         = useRef<FitAddon | null>(null);
  const searchAddon      = useRef<SearchAddon | null>(null);
  const searchInputRef   = useRef<HTMLInputElement>(null);

  const [showSearch,  setShowSearch]  = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  const showSearchRef = useRef(false);
  useEffect(() => { showSearchRef.current = showSearch; }, [showSearch]);

  const terminalId     = pane.data?.terminalId || `term-${pane.id}`;
  const currentTheme   = useWorkspaceStore((s) => s.theme);

  // Close context menu on any click elsewhere
  useEffect(() => {
    if (!contextMenu) return;
    const handler = () => setContextMenu(null);
    document.addEventListener('click', handler);
    return () => document.removeEventListener('click', handler);
  }, [contextMenu]);

  // Focus search input when it opens, re-focus terminal when it closes
  useEffect(() => {
    if (showSearch) {
      setTimeout(() => searchInputRef.current?.focus(), 30);
    } else {
      terminalInstance.current?.focus();
    }
  }, [showSearch]);

  useEffect(() => {
    if (!terminalRef.current) return;
    const terminalElement = terminalRef.current;

    const rootStyle  = getComputedStyle(document.documentElement);
    const bgColor    = rootStyle.getPropertyValue('--bg-app').trim()        || '#0c0c14';
    const fgColor    = rootStyle.getPropertyValue('--text-primary').trim()  || '#e2e4f0';
    const cursorColor = rootStyle.getPropertyValue('--accent-primary').trim() || '#7059f5';

    const term = new Terminal({
      cursorBlink: true,
      cursorStyle: 'bar',
      cursorWidth: 2,
      fontFamily: '"Cascadia Code", "Fira Code", "JetBrains Mono", Menlo, Monaco, Consolas, monospace',
      fontSize: 13,
      lineHeight: 1.2,
      letterSpacing: 0,
      theme: {
        background: bgColor,
        foreground: fgColor,
        cursor: cursorColor,
        cursorAccent: bgColor,
        selectionBackground: 'rgba(112, 89, 245, 0.3)',
        black: '#1a1a2e', red: '#f38ba8',
        green: '#a6e3a1', yellow: '#f9e2af',
        blue: '#89b4fa', magenta: '#cba6f7',
        cyan: '#89dceb', white: '#cdd6f4',
        brightBlack: '#585b70', brightRed: '#f38ba8',
        brightGreen: '#a6e3a1', brightYellow: '#f9e2af',
        brightBlue: '#89b4fa', brightMagenta: '#cba6f7',
        brightCyan: '#89dceb', brightWhite: '#cdd6f4',
      },
      scrollback: 5000,
      allowTransparency: false,
      screenReaderMode: false,
    });

    const fit    = new FitAddon();
    const search = new SearchAddon();
    const links  = new WebLinksAddon((event, uri) => {
      // Only open if Ctrl (or Cmd on Mac) is held
      if (event.ctrlKey || event.metaKey) {
        openUrl(uri);
      }
    });

    term.loadAddon(fit);
    term.loadAddon(search);
    term.loadAddon(links);
    term.open(terminalElement);
    fitAddon.current   = fit;
    searchAddon.current = search;

    // Handle paste events ourselves to prevent duplication
    // Use capture phase to run before xterm.js's internal handler
    const pasteHandler = (e: ClipboardEvent) => {
      e.preventDefault();
      e.stopPropagation();

      // Handle paste manually
      const text = e.clipboardData?.getData('text');
      if (text) {
        invoke('write_to_pty', { id: terminalId, data: text });
      }
    };
    terminalElement.addEventListener('paste', pasteHandler, true);

    try {
      const webgl = new WebglAddon();
      term.loadAddon(webgl);
    } catch { /* WebGL not available */ }

    // Use a small timeout to ensure the container is stable before fitting
    setTimeout(() => fit.fit(), 50);
    terminalInstance.current = term;

    // Scroll tracking
    term.onScroll(() => {
      const buf = term.buffer.active;
      setIsScrolledUp(buf.viewportY < buf.baseY);
    });

    // Intercept Ctrl/Cmd+F to open inline search, and Ctrl+C/V for clipboard
    term.attachCustomKeyEventHandler((event) => {
      if (event.type !== 'keydown') return true;
      const mod = event.ctrlKey || event.metaKey;
      
      if (mod && event.key === 'f') {
        setShowSearch(true);
        return false;
      }
      
      if (event.key === 'Escape' && showSearchRef.current) {
        setShowSearch(false);
        setSearchQuery('');
        return false;
      }

      // Ctrl+C: copy if selection exists
      if (mod && event.key === 'c' && term.hasSelection()) {
        const sel = term.getSelection();
        if (sel) writeText(sel).catch(() => {});
        return false;
      }

      // Ctrl+V: block xterm.js processing so native paste event fires
      if (mod && event.key === 'v') {
        return false;
      }



      return true;
    });

    let unlisten: UnlistenFn | null = null;

    const initPty = async () => {
      unlisten = await listen<{ id: string; data: number[] }>('pty-out', (event) => {
        if (event.payload.id === terminalId) {
          term.write(new Uint8Array(event.payload.data));
        }
      });

      const workspaceDir = useWorkspaceStore.getState().workspaceDir;

      await invoke<boolean>('spawn_pty', {
        id: terminalId,
        rows: term.rows || 24,
        cols: term.cols || 80,
        cwd: workspaceDir,
      });

      const initialCommand = pane.data?.initialCommand;
      if (initialCommand) {
        // Small delay to ensure the shell is ready to receive input
        setTimeout(() => {
          invoke('write_to_pty', { id: terminalId, data: initialCommand + '\r' });
        }, 1000);
      }

      emit('pty-spawned', { id: terminalId });
    };

    initPty();

    term.onData((data) => {
      invoke('write_to_pty', { id: terminalId, data });
    });

    // Debounced resize to prevent layout thrashing and PTY issues
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!terminalInstance.current) return;
        fit.fit();
        if (term.rows && term.cols) {
          invoke('resize_pty', { id: terminalId, rows: term.rows, cols: term.cols });
        }
      }, 100);
    });

    resizeObserver.observe(terminalElement);

    return () => {
      clearTimeout(resizeTimeout);
      resizeObserver.disconnect();
      terminalElement.removeEventListener('paste', pasteHandler, true);
      if (unlisten) unlisten();
      term.dispose();
    };
  }, [terminalId]);

  // Update terminal colors on theme change
  useEffect(() => {
    if (!terminalInstance.current) return;
    const rootStyle = getComputedStyle(document.documentElement);
    terminalInstance.current.options.theme = {
      background: rootStyle.getPropertyValue('--bg-app').trim() || '#0c0c14',
      foreground: rootStyle.getPropertyValue('--text-primary').trim() || '#e2e4f0',
      cursor:     rootStyle.getPropertyValue('--accent-primary').trim() || '#7059f5',
    };
  }, [currentTheme]);

  const handleSearch = (query: string, forward = true) => {
    if (!searchAddon.current || !query) return;
    const opts = { caseSensitive: false, wholeWord: false, regex: false, decorations: {
      matchBackground: '#f59e0b40',
      matchBorder: '#f59e0b',
      matchOverviewRuler: '#f59e0b',
      activeMatchBackground: '#f59e0b80',
      activeMatchBorder: '#f59e0bff',
      activeMatchColorOverviewRuler: '#f59e0b',
    }};
    if (forward) searchAddon.current.findNext(query, opts);
    else searchAddon.current.findPrevious(query, opts);
  };

  const handleContextMenu = (e: React.MouseEvent) => {
    e.preventDefault();
    setContextMenu({ x: e.clientX, y: e.clientY });
  };

  const handleContextAction = async (action: string) => {
    setContextMenu(null);
    const term = terminalInstance.current;
    if (!term) return;
    switch (action) {
      case 'copy': {
        const sel = term.getSelection();
        if (sel) writeText(sel).catch(() => {});
        break;
      }
      case 'paste': {
        const text = await readText().catch(() => '');
        if (text) invoke('write_to_pty', { id: terminalId, data: text });
        break;
      }
      case 'clear':
        term.clear();
        break;
      case 'split':
        useWorkspaceStore.getState().addPane('terminal', 'Terminal');
        break;
    }
  };

  const closeSearch = () => {
    setShowSearch(false);
    setSearchQuery('');
    searchAddon.current?.clearDecorations?.();
  };

  return (
    <div className="flex flex-col h-full bg-bg-app" onContextMenu={handleContextMenu}>
      {/* Inline search bar */}
      {showSearch && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 bg-bg-titlebar border-b border-border-panel shrink-0 animate-fade-in">
          <input
            ref={searchInputRef}
            type="text"
            value={searchQuery}
            onChange={(e) => {
              setSearchQuery(e.target.value);
              handleSearch(e.target.value, true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Escape') closeSearch();
              else if (e.key === 'Enter') handleSearch(searchQuery, !e.shiftKey);
            }}
            placeholder="Search terminal… (Enter / Shift+Enter)"
            className="flex-1 bg-bg-surface border border-border-panel text-text-primary text-xs px-2.5 py-1 rounded-md focus:outline-none focus:border-accent-primary min-w-0 transition-colors"
          />
          <button
            onClick={() => handleSearch(searchQuery, false)}
            className="p-1.5 text-text-muted hover:text-text-primary rounded transition-colors"
            title="Previous (Shift+Enter)"
          >
            <ChevronUp size={13} />
          </button>
          <button
            onClick={() => handleSearch(searchQuery, true)}
            className="p-1.5 text-text-muted hover:text-text-primary rounded transition-colors"
            title="Next (Enter)"
          >
            <ChevronDown size={13} />
          </button>
          <button
            onClick={closeSearch}
            className="p-1.5 text-text-muted hover:text-text-primary rounded transition-colors"
            title="Close (Esc)"
          >
            <X size={13} />
          </button>
        </div>
      )}

      <div 
        className="flex-1 p-2 overflow-hidden relative cursor-text"
        onClick={() => terminalInstance.current?.focus()}
      >
        <div ref={terminalRef} className="h-full w-full" />

        {/* Scroll-to-bottom indicator */}
        {isScrolledUp && (
          <button
            onClick={() => {
              terminalInstance.current?.scrollToBottom();
              setIsScrolledUp(false);
            }}
            className="absolute bottom-4 right-4 bg-accent-primary hover:bg-accent-hover text-accent-text rounded-full w-7 h-7 flex items-center justify-center shadow-lg shadow-accent-primary/30 transition-colors"
            title="Scroll to bottom"
          >
            <ChevronDown size={14} />
          </button>
        )}
      </div>

      {/* Context menu */}
      {contextMenu && (
        <div
          className="fixed z-50 bg-bg-panel border border-border-panel rounded-lg shadow-xl py-1 min-w-[150px] animate-fade-in"
          style={{ left: contextMenu.x, top: contextMenu.y }}
          onClick={(e) => e.stopPropagation()}
        >
          {[
            { id: 'copy',  label: 'Copy',  shortcut: 'Ctrl+C' },
            { id: 'paste', label: 'Paste', shortcut: 'Ctrl+V' },
            null,
            { id: 'clear', label: 'Clear', shortcut: '' },
            { id: 'split', label: 'Split', shortcut: 'Ctrl+D' },
          ].map((item, i) =>
            item === null ? (
              <div key={i} className="h-px bg-border-divider mx-1 my-1" />
            ) : (
              <button
                key={item.id}
                onClick={() => handleContextAction(item.id)}
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-text-secondary hover:bg-bg-surface hover:text-text-primary transition-colors"
              >
                <span>{item.label}</span>
                {item.shortcut && <span className="text-text-muted ml-6 font-mono text-[10px]">{item.shortcut}</span>}
              </button>
            )
          )}
        </div>
      )}
    </div>
  );
}
