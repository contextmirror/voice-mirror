<script>
  /**
   * Terminal.svelte -- ghostty-web terminal for AI provider PTY output.
   *
   * Mounts a ghostty-web Terminal instance, listens for Tauri `ai-output` events
   * to write data to the terminal, and captures keyboard input to send back
   * to the PTY via the `aiRawInput()` API wrapper. Uses ghostty-web's FitAddon
   * to auto-resize the terminal to fill its container.
   *
   * ghostty-web provides an xterm.js-compatible API backed by Ghostty's
   * battle-tested WASM VT100 parser.
   */
  import { init, Terminal, FitAddon } from 'ghostty-web';
  import { listen } from '@tauri-apps/api/event';
  import { aiRawInput, aiPtyResize } from '../../lib/api.js';
  import { currentThemeName } from '../../lib/stores/theme.svelte.js';
  import TerminalToolbar from './TerminalToolbar.svelte';

  // ---- State ----
  let containerEl = $state(null);
  let term = $state(null);
  let fitAddon = $state(null);
  let resizeObserver = $state(null);
  let unlistenAiOutput = $state(null);
  let resizeTimeout = $state(null);
  let lastPtyCols = $state(0);
  let lastPtyRows = $state(0);
  let initialized = $state(false);

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
    aiPtyResize(term.cols, term.rows).catch((err) => {
      console.warn('[Terminal] PTY resize failed:', err);
    });
  }

  /**
   * Fit the terminal to its container and notify the PTY of size changes.
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
    // Send clear screen + clear scrollback + cursor home
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
        aiRawInput(text).catch((err) => {
          console.warn('[Terminal] Paste/input failed:', err);
        });
      }
    } catch (err) {
      console.warn('[Terminal] Paste failed:', err);
    }
  }

  // ---- Lifecycle: mount ----

  $effect(() => {
    if (!containerEl) return;

    // ghostty-web requires async WASM initialization before creating terminals.
    // We do this inside the $effect so it runs on mount.
    let cancelled = false;

    async function setup() {
      // Initialize the WASM module (idempotent -- safe to call multiple times)
      await init();

      if (cancelled) return;

      initialized = true;

      // Create ghostty-web Terminal instance
      const ghosttyTerm = new Terminal({
        cursorBlink: true,
        cursorStyle: 'bar',
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

      // Send keyboard input to PTY
      ghosttyTerm.onData((data) => {
        aiRawInput(data).catch((err) => {
          console.warn('[Terminal] PTY input failed:', err);
        });
      });

      // Custom keyboard handler for Ctrl+C (copy selection) and Ctrl+V (paste)
      // ghostty-web convention: return true = "handled, STOP processing"
      //                         return false = "not handled, let terminal process"
      ghosttyTerm.attachCustomKeyEventHandler((event) => {
        // Only intercept keydown to avoid double-firing
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
        aiPtyResize(cols, rows).catch((err) => {
          console.warn('[Terminal] PTY resize failed:', err);
        });
      });

      // Listen for AI output events from Tauri backend
      const unlisten = await listen('ai-output', (event) => {
        if (!term) return;
        const data = event.payload;

        switch (data.type) {
          case 'clear':
            term.write('\x1b[2J\x1b[3J\x1b[H');
            break;
          case 'start':
            if (data.text) {
              term.writeln(`\x1b[34m${data.text}\x1b[0m`);
            }
            // Fit after provider starts
            requestAnimationFrame(() => {
              requestAnimationFrame(() => {
                fitTerminal();
                resizePtyIfChanged();
              });
            });
            break;
          case 'stdout':
          case 'tui':
          case 'stderr':
            if (data.text) {
              term.write(data.text);
            }
            break;
          case 'exit':
            term.writeln('');
            term.writeln(`\x1b[33m[Process exited with code ${data.code ?? '?'}]\x1b[0m`);
            break;
        }
      });

      if (cancelled) {
        unlisten();
        ghosttyTerm.dispose();
        return;
      }

      unlistenAiOutput = unlisten;

      // Observe container resize for auto-fitting
      const observer = new ResizeObserver(() => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
          fitTerminal();
          resizePtyIfChanged();
        }, 150);
      });
      observer.observe(containerEl);
      resizeObserver = observer;

      // Initial fit after layout settles (double rAF)
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          fitTerminal();
          resizePtyIfChanged();
        });
      });
    }

    setup().catch((err) => {
      console.error('[Terminal] ghostty-web initialization failed:', err);
    });

    // Cleanup on unmount
    return () => {
      cancelled = true;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (unlistenAiOutput) {
        unlistenAiOutput();
        unlistenAiOutput = null;
      }
      if (term) {
        term.dispose();
        term = null;
      }
      fitAddon = null;
      lastPtyCols = 0;
      lastPtyRows = 0;
      initialized = false;
    };
  });

  // ---- Theme reactivity ----

  $effect(() => {
    // Track theme name changes to trigger re-theming
    const _themeName = currentThemeName.value;

    if (!term) return;

    // Small delay to let CSS variables settle after theme application
    requestAnimationFrame(() => {
      const newTheme = buildTermTheme();
      term.options.theme = newTheme;

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

<div class="terminal-view">
  <TerminalToolbar
    onClear={handleClear}
    onCopy={handleCopy}
    onPaste={handlePaste}
  />
  <div class="terminal-container" bind:this={containerEl}></div>
</div>

<style>
  .terminal-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
  }

  .terminal-container {
    flex: 1;
    overflow: hidden;
    padding: 4px;
    /* Ensure ghostty-web fills the container */
    min-height: 0;
    position: relative;
  }

  /* ghostty-web renders into a canvas; ensure it fills the container */
  .terminal-container :global(canvas) {
    display: block;
  }
</style>
