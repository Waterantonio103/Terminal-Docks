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
import { detectRuntimeAction } from '../../lib/runtimeActivity';

interface ContextMenuState { x: number; y: number }

export function TerminalPane({ pane, dragEndSeq }: { pane: Pane; dragEndSeq?: number }) {
  const terminalRef      = useRef<HTMLDivElement>(null);
  const terminalInstance = useRef<Terminal | null>(null);
  const fitAddon         = useRef<FitAddon | null>(null);
  const searchAddon      = useRef<SearchAddon | null>(null);
  const searchInputRef   = useRef<HTMLInputElement>(null);

  const [showSearch,  setShowSearch]  = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [isScrolledUp, setIsScrolledUp] = useState(false);
  const [contextMenu, setContextMenu] = useState<ContextMenuState | null>(null);

  useEffect(() => {
    console.log(`[TerminalPane] Mounted pane: ${pane.id}`, pane.data);
  }, [pane.id]);

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

    const rootStyle  = getComputedStyle(terminalRef.current || document.documentElement);
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

    const publishTerminalSize = () => {
      if (!term.rows || !term.cols) return;
      useWorkspaceStore.getState().updatePaneDataByTerminalId(terminalId, {
        terminalRows: term.rows,
        terminalCols: term.cols,
      });
    };

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
      // On macOS (WKWebView), compositing layer changes during drag can silently
      // kill the WebGL context. Detect this and fall back to the canvas renderer.
      webgl.onContextLoss(() => {
        webgl.dispose();
      });
      term.loadAddon(webgl);
    } catch { /* WebGL not available */ }

    // Use a timeout longer than the panel's 200ms CSS transition so dimensions are stable
    setTimeout(() => {
      fit.fit();
      publishTerminalSize();
      invoke('resize_pty', { id: terminalId, rows: term.rows, cols: term.cols }).catch(() => {});
    }, 260);
    terminalInstance.current = term;

    // Multi-pass repaint — Tauri WKWebView blanks the WebGL canvas during
    // store-write re-renders. Three passes ensure at least one lands after
    // the compositor settles.
    const doRepaint = () => {
      if (!terminalInstance.current) return;
      fitAddon.current?.fit();
      terminalInstance.current.refresh(0, terminalInstance.current.rows - 1);
      terminalInstance.current.scrollToBottom();
    };
    const repaintT1 = setTimeout(doRepaint, 300);
    const repaintT2 = setTimeout(doRepaint, 1100);
    const repaintT3 = setTimeout(doRepaint, 2500);

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
    let refitUnlisten: UnlistenFn | null = null;

    const initPty = async () => {
      const storeSnap = useWorkspaceStore.getState();
      const workspaceDir = storeSnap.workspaceDir;
      const boundNodeId = typeof pane.data?.nodeId === 'string' ? pane.data.nodeId : null;
      // Read CLI from globalGraph (authoritative) by matching terminalId. pane.data.cli can
      // be stale when the CLI was changed in workflow mode while the app was in workspace mode,
      // or when NodeTreePane's useLayoutEffect sync never ran (e.g. app opened in workspace mode).
      const graphNode = storeSnap.globalGraph.nodes.find(n => n.config?.terminalId === terminalId);
      const cli = graphNode?.config?.cli ?? pane.data?.cli;

      unlisten = await listen<{ id: string; data: number[] }>('pty-out', (event) => {
        if (event.payload.id === terminalId) {
          const bytes = new Uint8Array(event.payload.data);
          term.write(bytes);
          const chunk = new TextDecoder().decode(bytes);
          if (boundNodeId) {
            emit('workflow-node-action', {
              nodeId: boundNodeId,
              terminalId,
              action: detectRuntimeAction(chunk),
            }).catch(() => {});
          }
        }
      });

      refitUnlisten = await listen<{ terminalId: string }>('terminal-refit-requested', (event) => {
        if (event.payload.terminalId !== terminalId) return;
        if (terminalElement.offsetWidth === 0 || terminalElement.offsetHeight === 0) return;
        fit.fit();
        publishTerminalSize();
        if (term.rows && term.cols) {
          invoke('resize_pty', { id: terminalId, rows: term.rows, cols: term.cols }).catch(() => {});
        }
        term.refresh(0, term.rows - 1);
      });

      const customCommand = pane.data?.customCliCommand;
      // Re-read from store at decision time — the flag may arrive after mount
      // because RuntimeManager writes it during the activation pipeline.
      // Also check live PTY state: if RuntimeManager already spawned the PTY,
      // never put a shell on top of it regardless of the flag.
      const latestPaneSnap = useWorkspaceStore.getState().tabs.flatMap(t => t.panes).find(p => p.id === pane.id);
      const runtimeManagedByFlag = Boolean(latestPaneSnap?.data?.runtimeManaged);
      const runtimeManagedByBinding = boundNodeId
        ? Boolean(useWorkspaceStore.getState().nodeRuntimeBindings[boundNodeId]?.runtimeSessionId)
        : false;
      const ptyAlreadyExists = await invoke<boolean>('is_pty_active', { id: terminalId }).catch(() => false);
      const runtimeManaged = runtimeManagedByFlag || runtimeManagedByBinding || ptyAlreadyExists;
      if (ptyAlreadyExists && !runtimeManagedByFlag) {
        console.log(`[TerminalPane] PTY pre-exists — treating as runtime-managed terminal=${terminalId}`);
      }

      await invoke('register_pty_runtime_metadata', {
        terminalId,
        nodeId: boundNodeId,
        runtimeSessionId: typeof pane.data?.runtimeSessionId === 'string' ? pane.data.runtimeSessionId : null,
        cli: typeof cli === 'string' ? cli : 'generic',
      }).catch(() => {});

      console.log(`[TerminalPane] Auto-launch check for ${pane.id} (${terminalId})`, { customCommand, cli, runtimeManaged, spawned: false });

      const trySpawnPty = async (opts: Parameters<typeof invoke>[1]): Promise<boolean> => {
        try {
          return await invoke<boolean>('spawn_pty', opts);
        } catch (err) {
          if (String(err).includes('already exists')) {
            console.log(`[TerminalPane] PTY already exists for ${terminalId} — attaching to existing`);
            return false;
          }
          throw err;
        }
      };

      const trySpawnPtyWithCommand = async (opts: Parameters<typeof invoke>[1]): Promise<boolean> => {
        try {
          return await invoke<boolean>('spawn_pty_with_command', opts);
        } catch (err) {
          if (String(err).includes('already exists')) {
            console.log(`[TerminalPane] PTY already exists for ${terminalId} — attaching to existing`);
            return false;
          }
          throw err;
        }
      };

      if (runtimeManaged) {
        // RuntimeManager owns spawning for this terminal — attach only, no spawn.
        console.log(`[TerminalPane] runtimeManaged=true; skipping spawn for ${terminalId}`);
        // The PTY may have already output data before our pty-out listener registered.
        // Trigger a resize — on Tauri/WKWebView this causes the PTY backend to flush
        // its output buffer to all active listeners, replaying any missed startup output.
        setTimeout(() => {
          if (!terminalInstance.current) return;
          const rows = terminalInstance.current.rows || 24;
          const cols = terminalInstance.current.cols || 80;
          fitAddon.current?.fit();
          invoke('resize_pty', { id: terminalId, rows, cols }).catch(() => {});
          terminalInstance.current.refresh(0, rows - 1);
          terminalInstance.current.scrollToBottom();
          console.log(`[TerminalPane] post-attach flush triggered terminal=${terminalId}`);
        }, 150);
        // Second flush after CLI has had more time to render its initial UI
        setTimeout(() => {
          if (!terminalInstance.current) return;
          const rows = terminalInstance.current.rows || 24;
          const cols = terminalInstance.current.cols || 80;
          fitAddon.current?.fit();
          invoke('resize_pty', { id: terminalId, rows, cols }).catch(() => {});
          terminalInstance.current.refresh(0, rows - 1);
          terminalInstance.current.scrollToBottom();
        }, 800);
      } else if (customCommand) {
        const spawned = await trySpawnPtyWithCommand({
          id: terminalId,
          rows: term.rows || 24,
          cols: term.cols || 80,
          cwd: workspaceDir,
          command: customCommand,
          args: Array.isArray(pane.data?.customCliArgs) ? pane.data?.customCliArgs : [],
          env: pane.data?.customCliEnv ?? null,
        });
        console.log(`[TerminalPane] Spawned with command: ${spawned}`, customCommand);
      } else if (cli && cli !== 'custom') {
        const command = String(cli).replace(/\0/g, '');
        // For known CLIs in "interactive PTY" mode, we spawn a default shell
        // and then send the command. This is more robust on Windows where
        // binaries like 'codex' or 'claude' are often .cmd shims.
        const spawned = await trySpawnPty({
          id: terminalId,
          rows: term.rows || 24,
          cols: term.cols || 80,
          cwd: workspaceDir,
        });
        console.log(`[TerminalPane] Spawned default shell: ${spawned} for CLI ${command}`);

        // Only send the CLI launch command if we actually spawned a new PTY
        // and it's not managed by RuntimeManager (which handles its own booting).
        // Re-read pane data at fire time — RuntimeManager may have registered
        // runtimeSessionId after mount but before this timeout fires.
        if (spawned && !(command === 'codex' && boundNodeId)) {
          setTimeout(() => {
            const storeState = useWorkspaceStore.getState();
            const allPanes = storeState.tabs.flatMap(t => t.panes);
            const latestPane = allPanes.find(p => p.id === pane.id);
            const hasPaneSessionId = typeof latestPane?.data?.runtimeSessionId === 'string';
            const isRuntimeManaged = Boolean(latestPane?.data?.runtimeManaged);
            const nodeId = latestPane?.data?.nodeId as string | undefined;
            const hasStoreBinding = nodeId
              ? Boolean(storeState.nodeRuntimeBindings[nodeId]?.runtimeSessionId)
              : Object.values(storeState.nodeRuntimeBindings).some(binding =>
                  binding?.terminalId === terminalId &&
                  typeof binding.runtimeSessionId === 'string'
                );
            const cliAlreadyRunning = latestPane?.data?.cliSource === 'stdout' || latestPane?.data?.cliSource === 'connect_agent';
            if (!hasPaneSessionId && !hasStoreBinding && !cliAlreadyRunning && !isRuntimeManaged) {
              console.log(`[TerminalPane] Auto-launching CLI: ${command}`);
              invoke('write_to_pty', { id: terminalId, data: `${command}\r` }).catch(() => {});
            }
          }, 600);
        }
      } else {
        const spawned = await trySpawnPty({
          id: terminalId,
          rows: term.rows || 24,
          cols: term.cols || 80,
          cwd: workspaceDir,
        });
        console.log(`[TerminalPane] Spawned empty shell: ${spawned}`);
      }

      const initialCommand = pane.data?.initialCommand;
      if (initialCommand) {
        // Small delay to ensure the shell is ready to receive input
        setTimeout(() => {
          invoke('write_to_pty', { id: terminalId, data: initialCommand + '\r' });
        }, 1000);
      }

      emit('pty-spawned', { id: terminalId });
    };

    initPty().catch((err) => {
      console.error(`[TerminalPane] initPty failed for ${terminalId}:`, err);
    });

    term.onData((data) => {
      invoke('write_to_pty', { id: terminalId, data });
    });

    // Debounced resize to prevent layout thrashing and PTY issues.
    // Debounce is 250ms — longer than the panel's 200ms CSS transition — so fit.fit()
    // only runs after the container has reached its final stable dimensions.
    let resizeTimeout: ReturnType<typeof setTimeout>;
    const resizeObserver = new ResizeObserver(() => {
      clearTimeout(resizeTimeout);
      resizeTimeout = setTimeout(() => {
        if (!terminalInstance.current) return;
        // Guard against zero-dimension containers (e.g. during CSS transitions or hidden states)
        if (terminalElement.offsetWidth === 0 || terminalElement.offsetHeight === 0) return;
        fit.fit();
        publishTerminalSize();
        if (term.rows && term.cols) {
          invoke('resize_pty', { id: terminalId, rows: term.rows, cols: term.cols });
        }
      }, 250);
    });

    resizeObserver.observe(terminalElement);

    return () => {
      clearTimeout(resizeTimeout);
      clearTimeout(repaintT1);
      clearTimeout(repaintT2);
      clearTimeout(repaintT3);
      resizeObserver.disconnect();
      terminalElement.removeEventListener('paste', pasteHandler, true);
      if (unlisten) unlisten();
      if (refitUnlisten) refitUnlisten();
      term.dispose();
    };
  }, [terminalId]);

  useEffect(() => {
    let unlisten: UnlistenFn | null = null;

    const bindFocus = async () => {
      unlisten = await listen<{ terminalId: string }>('focus-terminal', (event) => {
        if (event.payload.terminalId !== terminalId) return;
        terminalInstance.current?.focus();
        terminalInstance.current?.scrollToBottom();
        emit('terminal-focused', { terminalId }).catch(() => {});
      });
    };

    bindFocus();

    return () => {
      if (unlisten) unlisten();
    };
  }, [terminalId]);

  // Update terminal colors on theme change
  useEffect(() => {
    if (!terminalInstance.current) return;
    const rootStyle = getComputedStyle(terminalRef.current || document.documentElement);
    terminalInstance.current.options.theme = {
      background: rootStyle.getPropertyValue('--bg-app').trim() || '#0c0c14',
      foreground: rootStyle.getPropertyValue('--text-primary').trim() || '#e2e4f0',
      cursor:     rootStyle.getPropertyValue('--accent-primary').trim() || '#7059f5',
    };
  }, [currentTheme]);

  // After a drag/resize operation ends, force xterm to repaint.
  // On macOS (WKWebView), moving an overflow:hidden container to a new absolute
  // position can leave the canvas with a stale compositor frame — the terminal
  // is functional but visually blank. refresh() forces WebKit to repaint the rows.
  useEffect(() => {
    if (!dragEndSeq || !terminalInstance.current) return;
    const term = terminalInstance.current;
    // Wait for the 200ms CSS position transition to finish before refreshing.
    const id = setTimeout(() => {
      fitAddon.current?.fit();
      term.refresh(0, term.rows - 1);
    }, 220);
    return () => clearTimeout(id);
  }, [dragEndSeq]);

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
    <div className="flex flex-col h-full background-bg-app" onContextMenu={handleContextMenu}>
      {/* Inline search bar */}
      {showSearch && (
        <div className="flex items-center gap-1.5 px-3 py-1.5 background-bg-titlebar border-b border-border-panel shrink-0 animate-fade-in">
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
            className="flex-1 background-bg-surface border border-border-panel text-text-primary text-xs px-2.5 py-1 rounded-md focus:outline-none focus:border-accent-primary min-w-0 transition-colors"
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
        onClick={() => {
          terminalInstance.current?.focus();
          emit('terminal-focused', { terminalId }).catch(() => {});
        }}
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
          className="fixed z-50 background-bg-panel border border-border-panel rounded-lg shadow-xl py-1 min-w-[150px] animate-fade-in"
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
                className="w-full flex items-center justify-between px-3 py-1.5 text-xs text-text-secondary hover:background-bg-surface hover:text-text-primary transition-colors"
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
