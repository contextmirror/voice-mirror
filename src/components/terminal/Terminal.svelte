<script>
  /**
   * Terminal.svelte -- ghostty-web terminal for user shell PTY sessions.
   *
   * Each instance is tied to a shellId and filters terminal-output events
   * by that ID. Used for user-created terminals and dev-server tabs.
   */
  import { init, Terminal, FitAddon } from 'ghostty-web';
  import { listen } from '@tauri-apps/api/event';
  import { terminalInput, terminalResize } from '../../lib/api.js';
  import { currentThemeName } from '../../lib/stores/theme.svelte.js';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';
  import { devServerManager } from '../../lib/stores/dev-server-manager.svelte.js';
  import { searchBuffer, nextMatch, prevMatch } from '../../lib/terminal-search.js';
  import { createLinkOverlay } from '../../lib/terminal-link-overlay.js';
  import { tabsStore } from '../../lib/stores/tabs.svelte.js';
  import { projectStore } from '../../lib/stores/project.svelte.js';
  import { open } from '@tauri-apps/plugin-shell';
  import TerminalSearch from './TerminalSearch.svelte';

  let { shellId, visible = true, onRegisterActions } = $props();

  let containerEl = $state(null);
  let term = $state(null);
  let fitAddon = $state(null);
  let resizeObserver = $state(null);
  let unlistenShellOutput = $state(null);
  let resizeTimeout = $state(null);
  let lastPtyCols = $state(0);
  let lastPtyRows = $state(0);
  let initialized = $state(false);
  let pendingEvents = [];
  let linkOverlay = null;

  // ---- Search state ----
  let searchVisible = $state(false);
  let searchQuery = $state('');
  let searchMatches = $state([]);
  let searchMatchCount = $state(0);
  let currentMatchIndex = $state(0);
  let searchCaseSensitive = $state(false);
  let searchRegex = $state(false);

  // ---- CSS token -> ghostty-web theme mapping ----

  /**
   * Read a CSS custom property value from :root.
   * @param {string} prop - CSS variable name (e.g. '--bg')
   * @returns {string} The computed value, or empty string
   */
  function getCssVar(prop) {
    return getComputedStyle(document.documentElement).getPropertyValue(prop).trim();
  }

  /**
   * Build a ghostty-web ITheme object from current CSS custom properties.
   * Maps design tokens to ghostty-web's ITheme keys.
   */
  function buildTermTheme() {
    const bg = getCssVar('--bg') || '#0c0d10';
    const bgElevated = getCssVar('--bg-elevated') || '#14161c';
    const text = getCssVar('--text') || '#e4e4e7';
    const textStrong = getCssVar('--text-strong') || '#fafafa';
    const muted = getCssVar('--muted') || '#71717a';
    const accent = getCssVar('--accent') || '#56b4e9';
    const ok = getCssVar('--ok') || '#0072b2';
    const warn = getCssVar('--warn') || '#e69f00';
    const danger = getCssVar('--danger') || '#d55e00';

    return {
      background: bg,
      foreground: text,
      cursor: accent,
      cursorAccent: bg,
      selectionBackground: accent + '4d', // ~30% opacity
      selectionForeground: textStrong,
      // Standard ANSI colors mapped to theme tokens
      black: bg,
      red: danger,
      green: ok,
      yellow: warn,
      blue: accent,
      magenta: accent,   // Use accent as magenta stand-in
      cyan: ok,           // Use ok as cyan stand-in
      white: text,
      // Bright variants
      brightBlack: muted,
      brightRed: danger,
      brightGreen: ok,
      brightYellow: warn,
      brightBlue: accent,
      brightMagenta: accent,
      brightCyan: ok,
      brightWhite: textStrong,
    };
  }

  /**
   * Send resize to PTY only if cols/rows actually changed.
   * Prevents duplicate SIGWINCH signals.
   */
  function resizePtyIfChanged() {
    if (!term || !term.cols || !term.rows) return;
    if (term.cols === lastPtyCols && term.rows === lastPtyRows) return;
    lastPtyCols = term.cols;
    lastPtyRows = term.rows;
    terminalResize(shellId, term.cols, term.rows).catch((err) => {
      console.warn('[Terminal] PTY resize failed:', err);
    });
  }

  /**
   * Fit the terminal to its container.
   */
  function fitTerminal() {
    if (!fitAddon || !term) return;
    try {
      fitAddon.fit();
    } catch {
      // Not mounted yet or container has zero size
    }
  }

  // ---- Search functions ----

  /**
   * Extract visible text lines from the terminal buffer.
   * ghostty-web exposes buffer via term.buffer.active.
   */
  function runSearch(query) {
    searchQuery = query;
    if (!term || !query) {
      searchMatches = [];
      searchMatchCount = 0;
      currentMatchIndex = 0;
      return;
    }

    const buffer = term.buffer?.active;
    if (!buffer) {
      searchMatches = [];
      searchMatchCount = 0;
      currentMatchIndex = 0;
      return;
    }

    const lineCount = buffer.length;
    const getLine = (y) => {
      const line = buffer.getLine(y);
      return line ? line.translateToString(true) : null;
    };

    const result = searchBuffer(getLine, lineCount, query, {
      caseSensitive: searchCaseSensitive,
      regex: searchRegex,
    });

    searchMatches = result.matches;
    searchMatchCount = result.total;
    currentMatchIndex = result.total > 0 ? 0 : 0;
  }

  function handleSearchNext() {
    if (searchMatchCount === 0) return;
    currentMatchIndex = nextMatch(searchMatchCount, currentMatchIndex);
    scrollToMatch(currentMatchIndex);
  }

  function handleSearchPrev() {
    if (searchMatchCount === 0) return;
    currentMatchIndex = prevMatch(searchMatchCount, currentMatchIndex);
    scrollToMatch(currentMatchIndex);
  }

  function scrollToMatch(index) {
    if (!term || !searchMatches[index]) return;
    const match = searchMatches[index];
    // Scroll the terminal to the match row if possible
    const buffer = term.buffer?.active;
    if (buffer) {
      const viewportTop = buffer.viewportY;
      const viewportBottom = viewportTop + term.rows;
      if (match.row < viewportTop || match.row >= viewportBottom) {
        // Scroll so match row is near the middle of the viewport
        const targetY = Math.max(0, match.row - Math.floor(term.rows / 2));
        term.scrollToLine(targetY);
      }
    }
  }

  function handleSearchClose() {
    searchVisible = false;
    searchQuery = '';
    searchMatches = [];
    searchMatchCount = 0;
    currentMatchIndex = 0;
    // Re-focus the terminal
    if (term) term.focus();
  }

  function handleToggleCase() {
    searchCaseSensitive = !searchCaseSensitive;
    if (searchQuery) runSearch(searchQuery);
  }

  function handleToggleRegex() {
    searchRegex = !searchRegex;
    if (searchQuery) runSearch(searchQuery);
  }

  // ---- Toolbar actions ----

  function handleClear() {
    if (!term) return;
    term.write('\x1b[2J\x1b[3J\x1b[H');
  }

  async function handleCopy() {
    if (!term) return;
    const selection = term.getSelection();
    if (selection) {
      try {
        await navigator.clipboard.writeText(selection);
        term.clearSelection();
      } catch (err) {
        console.warn('[Terminal] Copy failed:', err);
      }
    }
  }

  async function handlePaste() {
    if (!term) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        terminalInput(shellId, text).catch((err) => {
          console.warn('[Terminal] Paste failed:', err);
        });
      }
    } catch (err) {
      console.warn('[Terminal] Paste failed:', err);
    }
  }

  function handleSelectAll() {
    if (!term) return;
    term.selectAll();
  }

  // ---- Context menu state ----
  let ctxMenu = $state({ visible: false, x: 0, y: 0 });

  function handleTerminalContextMenu(event) {
    event.preventDefault();
    event.stopPropagation();
    ctxMenu = { visible: true, x: event.clientX, y: event.clientY };
  }

  function closeCtxMenu() {
    ctxMenu = { ...ctxMenu, visible: false };
  }

  function ctxCopy() { closeCtxMenu(); handleCopy(); }
  function ctxPaste() { closeCtxMenu(); handlePaste(); }
  function ctxSelectAll() { closeCtxMenu(); handleSelectAll(); }
  function ctxClear() { closeCtxMenu(); handleClear(); }
  function ctxFind() { closeCtxMenu(); searchVisible = true; }
  function ctxSplitRight() { closeCtxMenu(); terminalTabsStore.splitInstance({ direction: 'horizontal' }); }
  function ctxSplitDown() { closeCtxMenu(); terminalTabsStore.splitInstance({ direction: 'vertical' }); }

  function handleDocumentClick() { if (ctxMenu.visible) closeCtxMenu(); }
  function handleDocumentKeydown(e) { if (e.key === 'Escape' && ctxMenu.visible) closeCtxMenu(); }

  // Register toolbar actions for parent TerminalTabs.
  // Wrapped in $effect so we capture the latest prop value (not just initial).
  $effect(() => {
    onRegisterActions?.({ clear: handleClear, copy: handleCopy, paste: handlePaste });
  });

  // ---- Shell output handler ----

  /**
   * Process a single terminal-output event payload.
   * Filters by shellId and handles stdout/exit events.
   * @param {{ id: string, event_type?: string, type?: string, text?: string, code?: number }} data
   */
  function handleShellOutput(data) {
    if (!term) return;
    if (data.id !== shellId) return; // Filter by our session ID

    switch (data.event_type || data.type) {
      case 'stdout':
        if (data.text) term.write(data.text);
        break;
      case 'exit':
        term.writeln('');
        term.writeln(`\x1b[33m[Shell exited with code ${data.code ?? '?'}]\x1b[0m`);
        terminalTabsStore.markExited(shellId);
        devServerManager.handleShellExit(shellId, data.code);
        break;
    }
  }

  // ---- Lifecycle: mount ----

  $effect(() => {
    if (!containerEl) return;

    let cancelled = false;

    async function setup() {
      // Initialize the WASM module (idempotent -- safe to call multiple times)
      await init();

      if (cancelled) return;

      // Create ghostty-web Terminal instance
      const ghosttyTerm = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: getCssVar('--font-mono') || "'Cascadia Code', 'Fira Code', monospace",
        theme: buildTermTheme(),
        scrollback: 5000,
        convertEol: false,
      });

      // Create FitAddon for auto-resize
      const fit = new FitAddon();
      ghosttyTerm.loadAddon(fit);

      // Mount into DOM
      ghosttyTerm.open(containerEl);

      if (cancelled) {
        ghosttyTerm.dispose();
        return;
      }

      // Store refs
      term = ghosttyTerm;
      fitAddon = fit;

      // Keyboard input -> shell PTY
      ghosttyTerm.onData((data) => {
        terminalInput(shellId, data).catch((err) => {
          console.warn('[Terminal] PTY input failed:', err);
        });
      });

      // Custom keyboard handler for Ctrl+C (copy), Ctrl+V (paste), Ctrl+F (search)
      ghosttyTerm.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return false;

        // Ctrl+F: toggle terminal search
        if (event.ctrlKey && event.key === 'f' && !event.shiftKey && !event.altKey) {
          searchVisible = !searchVisible;
          if (!searchVisible) handleSearchClose();
          return true; // Handled: prevent browser find
        }

        // Ctrl+C: copy selected text if there is a selection
        if (event.ctrlKey && event.key === 'c' && !event.shiftKey && !event.altKey) {
          if (ghosttyTerm.hasSelection()) {
            handleCopy();
            return true; // Handled: prevent terminal from sending \x03
          }
          return false; // Not handled: let terminal send interrupt (\x03)
        }

        // Ctrl+V: paste from clipboard
        if (event.ctrlKey && event.key === 'v' && !event.shiftKey && !event.altKey) {
          handlePaste();
          return true; // Handled: prevent terminal default
        }

        return false; // Not handled: let terminal process all other keys
      });

      // Listen for resize events from the terminal to send to PTY
      ghosttyTerm.onResize(({ cols, rows }) => {
        if (cols === lastPtyCols && rows === lastPtyRows) return;
        lastPtyCols = cols;
        lastPtyRows = rows;
        terminalResize(shellId, cols, rows).catch((err) => {
          console.warn('[Terminal] PTY resize failed:', err);
        });
      });

      // Listen for shell output events from Tauri backend
      const unlisten = await listen('terminal-output', (event) => {
        if (!term) return;
        if (!initialized) {
          // Buffer events until terminal is fully initialized
          pendingEvents.push(event);
          return;
        }
        handleShellOutput(event.payload);
      });

      if (cancelled) {
        unlisten();
        ghosttyTerm.dispose();
        return;
      }

      unlistenShellOutput = unlisten;

      // Observe container resize for auto-fitting
      const observer = new ResizeObserver(() => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          fitTerminal();
          resizePtyIfChanged();
          // Force a full canvas redraw on the next frame
          if (term) {
            requestAnimationFrame(() => {
              term.write('');
            });
          }
        }, 150);
      });
      observer.observe(containerEl);
      resizeObserver = observer;

      // Initial fit after layout settles (double rAF)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitTerminal();
          resizePtyIfChanged();
          // Gate: terminal is now fully initialized
          initialized = true;
          // Replay any events that arrived during initialization
          for (const evt of pendingEvents) {
            handleShellOutput(evt.payload);
          }
          pendingEvents = [];

          // Initialize clickable link overlay (Ctrl+click to open URLs/files)
          linkOverlay = createLinkOverlay({
            container: containerEl,
            getTerm: () => term,
            getCwd: () => projectStore.activeProject?.path || '',
            onOpenUrl: (url) => {
              open(url).catch(err => console.warn('[Terminal] Failed to open URL:', err));
            },
            onOpenFile: (match) => {
              const fileName = match.path.split(/[/\\]/).pop() || match.path;
              if (match.line != null) {
                tabsStore.setPendingCursor(match.path, match.line - 1, (match.col || 1) - 1);
              }
              tabsStore.openFile({ name: fileName, path: match.path });
            },
          });
        });
      });
    }

    setup().catch((err) => {
      console.error('[Terminal] Init failed:', err);
    });

    // Cleanup on unmount
    return () => {
      cancelled = true;
      initialized = false;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (unlistenShellOutput) {
        unlistenShellOutput();
        unlistenShellOutput = null;
      }
      if (linkOverlay) {
        linkOverlay.destroy();
        linkOverlay = null;
      }
      if (term) {
        term.dispose();
        term = null;
      }
      fitAddon = null;
      lastPtyCols = 0;
      lastPtyRows = 0;
      pendingEvents = [];
    };
  });

  // ---- Re-fit when becoming visible ----

  $effect(() => {
    if (visible && fitAddon && term) {
      requestAnimationFrame(() => {
        fitTerminal();
        resizePtyIfChanged();
      });
    }
  });

  // ---- Theme reactivity ----

  $effect(() => {
    // Track theme name changes to trigger re-theming
    const _themeName = currentThemeName.value;

    if (!term) return;

    // Small delay to let CSS variables settle after theme application
    requestAnimationFrame(() => {
      term.options.theme = buildTermTheme();

      // Update font family in case it changed
      const fontMono = getCssVar('--font-mono');
      if (fontMono) {
        term.options.fontFamily = fontMono;
      }

      // Re-fit after theme/font change
      fitTerminal();
    });
  });
</script>

<svelte:document onclick={handleDocumentClick} onkeydown={handleDocumentKeydown} />

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div class="terminal-view" oncontextmenu={handleTerminalContextMenu}>
  <TerminalSearch
    visible={searchVisible}
    onClose={handleSearchClose}
    onSearch={runSearch}
    onNext={handleSearchNext}
    onPrev={handleSearchPrev}
    matchCount={searchMatchCount}
    currentMatch={currentMatchIndex}
    caseSensitive={searchCaseSensitive}
    regex={searchRegex}
    onToggleCase={handleToggleCase}
    onToggleRegex={handleToggleRegex}
  />
  <div class="terminal-container" class:ready={initialized} bind:this={containerEl}></div>

  {#if ctxMenu.visible}
    <!-- svelte-ignore a11y_no_static_element_interactions -->
    <div class="terminal-ctx-backdrop" onclick={closeCtxMenu} oncontextmenu={(e) => { e.preventDefault(); closeCtxMenu(); }}>
      <div class="terminal-ctx-menu" role="menu" style="left:{ctxMenu.x}px;top:{ctxMenu.y}px;">
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxCopy}>Copy<span class="terminal-ctx-shortcut">Ctrl+C</span></button>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxPaste}>Paste<span class="terminal-ctx-shortcut">Ctrl+V</span></button>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxSelectAll}>Select All</button>
        <div class="terminal-ctx-separator"></div>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxClear}>Clear Terminal</button>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxFind}>Find<span class="terminal-ctx-shortcut">Ctrl+F</span></button>
        <div class="terminal-ctx-separator"></div>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxSplitRight}>Split Right<span class="terminal-ctx-shortcut">Ctrl+Shift+5</span></button>
        <button class="terminal-ctx-item" role="menuitem" onclick={ctxSplitDown}>Split Down<span class="terminal-ctx-shortcut">Ctrl+Shift+&minus;</span></button>
      </div>
    </div>
  {/if}
</div>

<style>
  .terminal-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    position: relative;
    /* Minimal left/right padding so terminal text doesn't touch the edge.
       No top padding — avoids visible gap between tab bar and terminal. */
    padding: 0 4px;
  }

  .terminal-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    position: relative;
    contain: strict;
    border-top: none;
    visibility: hidden;
  }

  .terminal-container.ready {
    visibility: visible;
  }

  .terminal-container :global(canvas) {
    display: block;
  }

  .terminal-container :global(.ghostty-web),
  .terminal-container :global(.xterm) {
    overflow: hidden !important;
  }

  /* ---- Context menu ---- */
  .terminal-ctx-backdrop {
    position: fixed;
    inset: 0;
    z-index: 9999;
  }

  .terminal-ctx-menu {
    position: fixed;
    z-index: 10000;
    background: var(--bg-elevated);
    border: 1px solid var(--border, rgba(255,255,255,0.06));
    border-radius: 6px;
    padding: 4px 0;
    min-width: 180px;
    box-shadow: 0 4px 16px rgba(0,0,0,0.4);
  }

  .terminal-ctx-item {
    display: flex;
    align-items: center;
    justify-content: space-between;
    width: 100%;
    padding: 6px 12px;
    background: none;
    border: none;
    color: var(--text);
    font-size: 12px;
    cursor: pointer;
    text-align: left;
  }

  .terminal-ctx-item:hover {
    background: rgba(255,255,255,0.06);
  }

  .terminal-ctx-shortcut {
    color: var(--muted);
    font-size: 11px;
    margin-left: 24px;
  }

  .terminal-ctx-separator {
    height: 1px;
    background: var(--border, rgba(255,255,255,0.06));
    margin: 4px 0;
  }
</style>
