<script>
  /**
   * ShellTerminal.svelte -- ghostty-web terminal for shell PTY sessions.
   *
   * Simplified version of Terminal.svelte that connects to a shell PTY
   * session instead of the AI provider. Each instance is tied to a shellId
   * and filters shell-output events by that ID.
   */
  import { init, Terminal, FitAddon } from 'ghostty-web';
  import { listen } from '@tauri-apps/api/event';
  import { shellInput, shellResize } from '../../lib/api.js';
  import { currentThemeName } from '../../lib/stores/theme.svelte.js';
  import { terminalTabsStore } from '../../lib/stores/terminal-tabs.svelte.js';

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
    shellResize(shellId, term.cols, term.rows).catch((err) => {
      console.warn('[ShellTerminal] PTY resize failed:', err);
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
        console.warn('[ShellTerminal] Copy failed:', err);
      }
    }
  }

  async function handlePaste() {
    if (!term) return;
    try {
      const text = await navigator.clipboard.readText();
      if (text) {
        shellInput(shellId, text).catch((err) => {
          console.warn('[ShellTerminal] Paste failed:', err);
        });
      }
    } catch (err) {
      console.warn('[ShellTerminal] Paste failed:', err);
    }
  }

  // Register toolbar actions for parent TerminalTabs.
  // Wrapped in $effect so we capture the latest prop value (not just initial).
  $effect(() => {
    onRegisterActions?.({ clear: handleClear, copy: handleCopy, paste: handlePaste });
  });

  // ---- Shell output handler ----

  /**
   * Process a single shell-output event payload.
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
        shellInput(shellId, data).catch((err) => {
          console.warn('[ShellTerminal] PTY input failed:', err);
        });
      });

      // Custom keyboard handler for Ctrl+C (copy selection) and Ctrl+V (paste)
      ghosttyTerm.attachCustomKeyEventHandler((event) => {
        if (event.type !== 'keydown') return false;

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
        shellResize(shellId, cols, rows).catch((err) => {
          console.warn('[ShellTerminal] PTY resize failed:', err);
        });
      });

      // Listen for shell output events from Tauri backend
      const unlisten = await listen('shell-output', (event) => {
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
        });
      });
    }

    setup().catch((err) => {
      console.error('[ShellTerminal] Init failed:', err);
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

<div class="shell-terminal-view">
  <div class="shell-terminal-container" bind:this={containerEl}></div>
</div>

<style>
  .shell-terminal-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    /* Visual spacing around terminal — applied here (not on inner container)
       so ghostty-web's canvas fills the container exactly without clipping */
    padding: 4px;
  }

  .shell-terminal-container {
    flex: 1;
    overflow: hidden;
    min-height: 0;
    position: relative;
    contain: strict;
  }

  .shell-terminal-container :global(canvas) {
    display: block;
  }

  .shell-terminal-container :global(.ghostty-web),
  .shell-terminal-container :global(.xterm) {
    overflow: hidden !important;
  }
</style>
