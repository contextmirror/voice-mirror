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

  let { onRegisterActions = undefined } = $props();

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
  let pendingEvents = [];
  let providerSwitchHandler = null;

  // Provider switch: hide the canvas via direct DOM style during the transition
  // so the user never sees garbled partial-frame renders from the TUI setup.
  // We use direct DOM manipulation (not Svelte $state) because Svelte batches
  // reactive DOM updates to the next microtask — by then the render loop has
  // already painted garbled frames.
  let switchRevealTimer = null;
  let isSwitching = false;

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

  // Register toolbar actions for parent TerminalTabs
  onRegisterActions?.({ clear: handleClear, copy: handleCopy, paste: handlePaste });

  // ---- AI output handler ----

  /**
   * Strip SGR mouse event echoes from PTY output.
   * On Windows, ConPTY can echo mouse tracking input back as output,
   * with ESC and/or [ stripped. Cross-chunk splitting means a sequence
   * like \x1b[<32;62;11M can arrive as "[" at the end of chunk N
   * and "<32;62;11M" at the start of chunk N+1. Making both \x1b and [
   * optional catches all variants:
   *   \x1b[<btn;col;rowM  (full SGR sequence)
   *   [<btn;col;rowM       (ESC stripped)
   *   <btn;col;rowM         (ESC and [ stripped — cross-chunk split)
   */
  const SGR_MOUSE_ECHO_RE = /\x1b?\[?<\d+;\d+;\d+[Mm]/g;

  /**
   * Process a single ai-output event payload.
   * Extracted so it can be called both from the live listener and
   * when draining events buffered during the initialization gap.
   * @param {{ type: string, text?: string, code?: number }} data
   */
  function handleAiOutput(data) {
    if (!term) return;

    switch (data.type) {
      case 'clear':
        term.write('\x1b[2J\x1b[3J\x1b[H');
        break;
      case 'start':
        // Provider is ready. Reveal the terminal after a delay to let
        // the TUI finish drawing. Uses direct DOM to bypass Svelte batching.
        isSwitching = false;
        if (switchRevealTimer) clearTimeout(switchRevealTimer);
        switchRevealTimer = setTimeout(() => {
          switchRevealTimer = null;
          if (term) {
            fitTerminal();
            resizePtyIfChanged();
            // Force a full canvas resize + redraw cycle. This resets
            // canvas.width/height + ctx.scale() for DPI + forceAll render.
            // Same thing that happens when you move/resize the window.
            if (term.refresh) term.refresh();
          }
          if (containerEl) containerEl.style.visibility = '';
        }, 500);
        break;
      case 'stdout':
      case 'tui':
      case 'stderr':
        if (data.text) {
          const cleaned = data.text.replace(SGR_MOUSE_ECHO_RE, '');
          if (cleaned) term.write(cleaned);
        }
        break;
      case 'exit':
        // Reset terminal modes on provider exit so stale state
        // (mouse tracking, alt screen) doesn't leak to next provider.
        // Use escape sequences here (not term.reset()) to preserve the
        // exit message in the scrollback for user visibility.
        term.write(
          '\x1b[?1000l\x1b[?1002l\x1b[?1003l\x1b[?1006l' + // Disable mouse tracking
          '\x1b[?1049l' +  // Exit alternate screen
          '\x1b[0m'        // Reset attributes
        );
        term.writeln('');
        term.writeln(`\x1b[33m[Process exited with code ${data.code ?? '?'}]\x1b[0m`);
        // Only reveal the terminal if this is a standalone exit (not a switch).
        // During a provider switch, the container stays hidden until the
        // 'start' handler's reveal timer fires — otherwise the user sees
        // garbled partial-frame renders from the new TUI's initialization.
        if (!isSwitching) {
          if (switchRevealTimer) {
            clearTimeout(switchRevealTimer);
            switchRevealTimer = null;
          }
          if (containerEl) containerEl.style.visibility = '';
        }
        break;
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

      // Create ghostty-web Terminal instance
      const ghosttyTerm = new Terminal({
        cursorBlink: false,
        cursorStyle: 'none',
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

      // Send keyboard input to PTY.
      // Suppress SGR mouse MOTION events (button 32-63) — ConPTY on Windows
      // echoes these back as stdout, corrupting the terminal display.
      // Clicks (button 0-31), releases (lowercase m), and scroll (button 64+)
      // are still sent. Motion events are cosmetic (hover feedback) and not
      // needed for TUI interaction.
      ghosttyTerm.onData((data) => {
        const motionMatch = data.match(/^\x1b\[<(\d+);\d+;\d+M$/);
        if (motionMatch) {
          const btn = parseInt(motionMatch[1], 10);
          if (btn >= 32 && btn < 64) return; // Mouse motion — suppress
        }
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
        if (!initialized) {
          // Buffer events until terminal is fully initialized
          pendingEvents.push(event);
          return;
        }
        handleAiOutput(event.payload);
      });

      if (cancelled) {
        unlisten();
        ghosttyTerm.dispose();
        return;
      }

      unlistenAiOutput = unlisten;

      // Pre-emptive canvas hide on provider switch.
      // When the user switches providers, the new CLI process starts outputting
      // immediately (startup banner, TUI setup), causing garbled partial-frame
      // renders. Instead of trying to control the renderer, we simply hide the
      // canvas container with CSS and reveal it once the provider is ready.
      // This handler fires SYNCHRONOUSLY (dispatchEvent is sync) from _setStarting()
      // in ai-status.svelte.js, BEFORE the Tauri command and BEFORE any stdout events.
      providerSwitchHandler = () => {
        if (!containerEl || !initialized) return;
        // Hide the canvas INSTANTLY via direct DOM — bypasses Svelte's
        // deferred reactive batching so the hide is synchronous.
        containerEl.style.visibility = 'hidden';
        isSwitching = true;
        if (switchRevealTimer) {
          clearTimeout(switchRevealTimer);
          switchRevealTimer = null;
        }
        // Nuclear reset: free the old WASM terminal, create a fresh one,
        // clear the canvas, restart the render loop. This puts the terminal
        // in the exact same state as initial startup — which always renders
        // cleanly. Without this, the old provider's canvas pixels, dirty-row
        // tracking, and WASM buffer state leak into the new provider's render.
        if (term) term.reset();
      };
      window.addEventListener('ai-provider-switching', providerSwitchHandler);

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
          // Gate: terminal is now fully initialized and ready for ai-output events
          initialized = true;
          // Replay any events that arrived during initialization
          for (const evt of pendingEvents) {
            handleAiOutput(evt.payload);
          }
          pendingEvents = [];
        });
      });
    }

    setup().catch((err) => {
      console.error('[Terminal] ghostty-web initialization failed:', err);
    });

    // Cleanup on unmount
    return () => {
      cancelled = true;
      // Immediately gate off event handlers before tearing down resources
      initialized = false;
      isSwitching = false;
      if (resizeTimeout) clearTimeout(resizeTimeout);
      if (switchRevealTimer) clearTimeout(switchRevealTimer);
      if (resizeObserver) {
        resizeObserver.disconnect();
        resizeObserver = null;
      }
      if (providerSwitchHandler) {
        window.removeEventListener('ai-provider-switching', providerSwitchHandler);
        providerSwitchHandler = null;
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
      pendingEvents = [];
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
  <div class="terminal-container" bind:this={containerEl}></div>
</div>

<style>
  .terminal-view {
    display: flex;
    flex-direction: column;
    height: 100%;
    overflow: hidden;
    background: var(--bg);
    /* Visual spacing around terminal — applied here (not on inner container)
       so ghostty-web's canvas fills the container exactly without clipping */
    padding: 4px;
  }

  .terminal-container {
    flex: 1;
    overflow: hidden;
    /* Ensure ghostty-web fills the container */
    min-height: 0;
    position: relative;
    /* Clip canvas rendering to container bounds */
    contain: strict;
  }

  /* ghostty-web renders into a canvas; ensure it fills the container */
  .terminal-container :global(canvas) {
    display: block;
  }

  /* Prevent ghostty-web wrapper from overflowing */
  .terminal-container :global(.ghostty-web),
  .terminal-container :global(.xterm) {
    overflow: hidden !important;
  }
</style>
