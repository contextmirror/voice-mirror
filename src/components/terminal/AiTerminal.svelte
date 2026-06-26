<script>
  /**
   * AiTerminal.svelte -- xterm.js terminal for AI provider PTY output.
   *
   * Mounts an xterm.js Terminal instance, listens for Tauri `ai-output` events
   * to write data to the terminal, and captures keyboard input to send back
   * to the PTY via the `aiRawInput()` API wrapper. Uses xterm.js's FitAddon
   * to auto-resize the terminal to fill its container.
   *
   * NOTE (xterm experiment): this is the AI/voice-provider terminal swapped from
   * ghostty-web to xterm.js. The user-shell terminal (Terminal.svelte) still uses
   * ghostty-web, so the two can be compared side by side. ghostty-web mirrored the
   * xterm.js API, so most calls are identical; the meaningful differences handled
   * below are: (1) xterm has no `cursorStyle: 'none'` — we hide the cursor for
   * Claude by setting the cursor color to the background; (2) ghostty-only methods
   * (freeze/unfreeze/forceDirty) don't exist on xterm and are guarded so they
   * no-op; (3) attachCustomKeyEventHandler return semantics are inverted in
   * xterm.js (return false = prevent terminal processing).
   */
  import { untrack } from 'svelte';
  import { Terminal } from '@xterm/xterm';
  import { FitAddon } from '@xterm/addon-fit';
  import { WebglAddon } from '@xterm/addon-webgl';
  import '@xterm/xterm/css/xterm.css';
  import { listen } from '@tauri-apps/api/event';
  import { aiRawInput, aiPtyResize, saveImageToTemp } from '../../lib/api.js';
  import { unwrapResult } from '../../lib/utils.js';
  import { currentThemeName } from '../../lib/stores/theme.svelte.js';
  import { aiStatusStore } from '../../lib/stores/ai-status.svelte.js';

  let { onRegisterActions = undefined } = $props();

  // ---- State ----
  let containerEl = $state(null);
  let term = $state(null);
  let fitAddon = $state(null);
  let webglAddon = $state(null);
  let resizeObserver = $state(null);
  let unlistenAiOutput = $state(null);
  let resizeTimeout = $state(null);
  let lastPtyCols = $state(0);
  let lastPtyRows = $state(0);
  let initialized = $state(false);
  let pendingEvents = [];
  let providerSwitchHandler = null;

  // Cover the terminal with the app background while no provider is running.
  // An empty ghostty terminal paints its cells with the WASM's built-in default
  // background (#0c0d10) — Ghostty treats a pure-black #000000 theme bg as
  // "unset" and falls back to it — which reads as a grey box against the
  // #000000 UI on cold start. The cover guarantees the empty/stopped state
  // matches the surrounding background; it's hidden the moment a provider runs.
  let showEmptyCover = $derived(!aiStatusStore.running);

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
    // Fallback is pure black to match the app's --bg (#000000). On a cold boot
    // the terminal can construct before --bg is applied; a near-black fallback
    // like #0c0d10 would render fractionally lighter than the surrounding UI and
    // read as a grey box on the empty/stopped terminal until a provider starts.
    const bg = getCssVar('--bg') || '#000000';
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
      // xterm.js has no cursorStyle: 'none'. Claude Code draws its own cursor,
      // so hide the terminal cursor for it by painting the cursor in the
      // background color; other providers get the visible accent cursor.
      cursor: aiStatusStore.providerType === 'claude' ? bg : accent,
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
   * Apply the terminal theme, retrying until the app's CSS variables are loaded.
   *
   * On a cold boot the terminal can mount before the theme vars are applied to
   * :root, so buildTermTheme() falls back to #0c0d10 — fractionally lighter than
   * the #000000 UI, which shows as a grey box that only a remount clears.
   * getCssVar('--bg') returns '' until the vars exist, so we keep re-applying
   * (ghostty-web now honors post-open theme changes) until --bg resolves, then
   * the final apply paints the real background.
   */
  function applyThemeWhenReady(tries = 0) {
    if (!term) return;
    term.options.theme = buildTermTheme();
    if (!getCssVar('--bg') && tries < 20) {
      setTimeout(() => applyThemeWhenReady(tries + 1), 100);
    }
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
    // Image-aware paste: if the clipboard holds an image (e.g. a Win+Shift+S
    // screenshot or a copied picture), save it to disk and type its path into
    // the Claude Code prompt — the terminal-native way to hand Claude an image.
    // Otherwise fall back to the usual text paste.
    try {
      if (navigator.clipboard?.read) {
        const items = await navigator.clipboard.read();
        for (const item of items) {
          const imgType = item.types.find((t) => t.startsWith('image/'));
          if (imgType) {
            const blob = await item.getType(imgType);
            const dataUrl = await blobToDataUrl(blob);
            await injectImageFromDataUrl(dataUrl, imgType);
            return; // Handled as an image — don't also paste text.
          }
        }
      }
    } catch {
      // clipboard.read() can throw (no permission / no readable data) — fall
      // through to the text path, which is the common case anyway.
    }
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

  // ---- Image drop / paste → file-path injection ----
  // The terminal hands Claude Code an image by typing the image's file path
  // into the prompt (just like dragging a file into a real terminal). We only
  // have the image *bytes* (HTML5 drops and clipboard images give content, not
  // a real path), so we persist them via save_image_to_temp and inject the
  // returned path. Claude Code reads the image from that path.

  /** Whether an image file is currently being dragged over the terminal. */
  let dragActive = $state(false);
  /** Ref-count enter/leave so the overlay doesn't flicker over child elements. */
  let dragDepth = 0;

  /** Read a File/Blob as a base64 data URL. */
  function blobToDataUrl(blob) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = () => reject(reader.error);
      reader.readAsDataURL(blob);
    });
  }

  /** Type a file path into the Claude Code prompt, then refocus the terminal.
   *  A trailing space is appended so the user can keep typing their question. */
  function injectImagePath(path) {
    if (!path) return;
    aiRawInput(path + ' ').catch((err) => {
      console.warn('[Terminal] Image path injection failed:', err);
    });
    term?.focus();
  }

  /** Persist a data-URL image and inject its temp path into the prompt. */
  async function injectImageFromDataUrl(dataUrl, mime) {
    const ext = (mime && mime.split('/')[1]) || 'png';
    const res = await saveImageToTemp(dataUrl, ext);
    const data = unwrapResult(res);
    if (data?.path) injectImagePath(data.path);
    else console.warn('[Terminal] save_image_to_temp returned no path:', res);
  }

  /** True only when the drag carries OS files (not an internal app drag). */
  function isFileDrag(e) {
    const types = e.dataTransfer?.types;
    return !!types && Array.from(types).includes('Files');
  }

  function handleDragEnter(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth += 1;
    dragActive = true;
  }

  function handleDragOver(e) {
    if (!isFileDrag(e)) return;
    // preventDefault marks this as a valid drop target and stops WebView2 from
    // navigating to the dropped file.
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'copy';
  }

  function handleDragLeave(e) {
    if (!isFileDrag(e)) return;
    dragDepth -= 1;
    if (dragDepth <= 0) {
      dragDepth = 0;
      dragActive = false;
    }
  }

  async function handleDrop(e) {
    if (!isFileDrag(e)) return;
    e.preventDefault();
    dragDepth = 0;
    dragActive = false;

    const files = Array.from(e.dataTransfer?.files ?? []);
    const images = files.filter((f) => f.type.startsWith('image/'));
    if (images.length === 0) return;

    // Inject sequentially so multiple dropped images land in prompt order.
    for (const file of images) {
      try {
        const dataUrl = await blobToDataUrl(file);
        const ext =
          (file.type && file.type.split('/')[1]) ||
          file.name.split('.').pop() ||
          'png';
        const res = await saveImageToTemp(dataUrl, ext);
        const data = unwrapResult(res);
        if (data?.path) injectImagePath(data.path);
      } catch (err) {
        console.warn('[Terminal] Failed to handle dropped image:', err);
      }
    }
  }

  // Register toolbar actions for parent TerminalTabs (one-time registration at setup)
  untrack(() => onRegisterActions)?.({ clear: handleClear, copy: handleCopy, paste: handlePaste });

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
        // Provider is ready. The terminal was frozen during the switch
        // (see providerSwitchHandler) — all TUI output has been accumulating
        // in the WASM buffer without rendering. Now we unfreeze after a delay
        // to let the TUI finish its initial draw burst.
        //
        // CRITICAL: Before unfreezing, do a nuclear reset to discard any
        // stale output from the OLD provider that leaked into the WASM buffer
        // between the switch and this 'start' event. During the gap, the old
        // process was still sending stdout before it exited, and those bytes
        // were write()-ed to the fresh terminal — polluting it with content
        // meant for the old layout. The reset wipes that slate clean.
        if (isSwitching && term.reset) {
          term.reset();
          if (term.freeze) term.freeze();
        }
        isSwitching = false;
        // Update cursor for the new provider — Claude Code renders its own
        // cursor (hidden here via the theme cursor color), others (OpenCode)
        // rely on the terminal cursor. xterm.js has no 'none' style, so we
        // keep a 'bar' and toggle visibility through the theme + blink.
        if (term && term.options) {
          const isClaude = aiStatusStore.providerType === 'claude';
          term.options.cursorStyle = 'bar';
          term.options.cursorBlink = !isClaude;
          // Re-apply theme so the cursor color (visible vs. background) tracks
          // the new provider.
          term.options.theme = buildTermTheme();
        }
        if (switchRevealTimer) clearTimeout(switchRevealTimer);
        switchRevealTimer = setTimeout(() => {
          switchRevealTimer = null;
          if (term) {
            // Unfreeze rendering first so the resize triggers a visible repaint
            if (term.unfreeze) term.unfreeze();
            fitTerminal();
            resizePtyIfChanged();
            // Automated "jiggle" — the ONE thing that always fixes the display.
            // Resize by -1 row then restore on next frame. This forces the full
            // WASM terminal resize path (text reflow + DirtyState.FULL + canvas
            // reset + forceAll render) which consistently produces clean output.
            // Every other approach (forceAll, forceDirty, freeze/unfreeze alone)
            // has failed because they don't trigger WASM text reflow.
            const savedCols = term.cols;
            const savedRows = term.rows;
            if (savedRows > 2) {
              term.resize(savedCols, savedRows - 1);
              requestAnimationFrame(() => {
                if (term && !isSwitching) {
                  term.resize(savedCols, savedRows);
                  resizePtyIfChanged();
                }
              });
            }
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
        // During a provider switch, drop the exit event entirely.
        // The old process's mode-reset sequences and "Process exited" message
        // would pollute the new terminal's WASM buffer. The 'start' handler
        // does a second reset to clear any leaked output.
        if (isSwitching) break;
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
        if (switchRevealTimer) {
          clearTimeout(switchRevealTimer);
          switchRevealTimer = null;
        }
        if (containerEl) containerEl.style.visibility = '';
        break;
    }
  }

  // ---- Lifecycle: mount ----

  $effect(() => {
    if (!containerEl) return;

    // Set up the terminal inside the $effect so it runs on mount. (xterm.js
    // needs no async WASM init — setup stays async only to await the Tauri
    // event listener registration.)
    let cancelled = false;

    async function setup() {
      if (cancelled) return;

      // Create xterm.js Terminal instance. Claude Code renders its own cursor —
      // we hide the terminal cursor for it via the theme cursor color (xterm has
      // no 'none' style). Other TUIs (OpenCode) rely on the terminal cursor for
      // their input field.
      const xterm = new Terminal({
        cursorBlink: aiStatusStore.providerType !== 'claude',
        cursorStyle: 'bar',
        fontSize: 13,
        fontFamily: getCssVar('--font-mono') || "'Cascadia Code', 'Fira Code', monospace",
        theme: buildTermTheme(),
        scrollback: 5000,
        convertEol: false,
      });

      // Create FitAddon for auto-resize
      const fit = new FitAddon();
      xterm.loadAddon(fit);

      // Mount into DOM
      xterm.open(containerEl);

      if (cancelled) {
        xterm.dispose();
        return;
      }

      // Load the WebGL renderer for GPU-accelerated drawing. xterm.js v6 ships
      // the DOM renderer by default (slow for the heavy repaints TUI apps like
      // Claude Code produce); WebGL is dramatically faster. It must be loaded
      // AFTER open(). If the GPU context is lost (driver reset, tab backgrounded,
      // too many WebGL contexts), the addon emits onContextLoss — we dispose it
      // there and xterm.js automatically falls back to the DOM renderer rather
      // than rendering a blank terminal.
      try {
        const webgl = new WebglAddon();
        webgl.onContextLoss(() => {
          console.warn('[Terminal] WebGL context lost — falling back to DOM renderer');
          webgl.dispose();
          if (webglAddon === webgl) webglAddon = null;
        });
        xterm.loadAddon(webgl);
        webglAddon = webgl;
      } catch (err) {
        // WebGL unavailable (e.g. blocklisted GPU) — DOM renderer stays active.
        console.warn('[Terminal] WebGL renderer unavailable, using DOM renderer:', err);
      }

      // Store refs
      term = xterm;
      fitAddon = fit;

      // Send keyboard input to PTY.
      // Suppress SGR mouse MOTION events (button 32-63) — ConPTY on Windows
      // echoes these back as stdout, corrupting the terminal display.
      // Clicks (button 0-31), releases (lowercase m), and scroll (button 64+)
      // are still sent. Motion events are cosmetic (hover feedback) and not
      // needed for TUI interaction.
      xterm.onData((data) => {
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
      // xterm.js convention (INVERTED vs ghostty-web): return true = "let the
      //   terminal process the key normally"; return false = "stop, terminal
      //   should NOT process this key".
      xterm.attachCustomKeyEventHandler((event) => {
        // Only intercept keydown to avoid double-firing
        if (event.type !== 'keydown') return true;

        // Ctrl+C: copy selected text if there is a selection
        if (event.ctrlKey && event.key === 'c' && !event.shiftKey && !event.altKey) {
          if (xterm.hasSelection()) {
            handleCopy();
            return false; // Prevent terminal from sending \x03
          }
          return true; // Let terminal send interrupt (\x03)
        }

        // Ctrl+V: paste from clipboard
        if (event.ctrlKey && event.key === 'v' && !event.shiftKey && !event.altKey) {
          handlePaste();
          return false; // Prevent terminal default
        }

        return true; // Let terminal process all other keys
      });

      // Listen for resize events from the terminal to send to PTY
      xterm.onResize(({ cols, rows }) => {
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
        xterm.dispose();
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
        if (term) {
          term.reset();
          // Freeze rendering IMMEDIATELY after reset. The render loop keeps
          // running but skips all drawing. Writes via write() still go to the
          // WASM parser (maintaining terminal state), but the canvas is not
          // updated. This prevents painting partial TUI frames during startup
          // — the TUI sends 8-14 separate write() calls with escape sequence
          // fragments, and each intermediate state looks garbled. We unfreeze
          // in the 'start' handler to paint a single clean frame.
          if (term.freeze) term.freeze();
        }
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

      // Initial fit after layout settles (double rAF).
      requestAnimationFrame(() => {
        requestAnimationFrame(async () => {
          // Wait for the monospace web font before the first fit. On a cold
          // start (now hit because the app boots straight into the Lens IDE),
          // the font may not be loaded yet, so fitAddon.fit() miscomputes the
          // cell size and the canvas leaves a grey band that only a later
          // resize/remount fixes. fonts.ready resolves instantly once cached.
          try {
            await document.fonts.ready;
          } catch {
            // fonts API unavailable — proceed anyway
          }
          if (cancelled) return;

          fitTerminal();
          resizePtyIfChanged();
          // Gate: terminal is now fully initialized and ready for ai-output events
          initialized = true;
          // Replay any events that arrived during initialization
          for (const evt of pendingEvents) {
            handleAiOutput(evt.payload);
          }
          pendingEvents = [];

          // Apply the theme once the app's CSS variables are actually loaded.
          // On a cold boot the terminal can mount before the theme vars are set,
          // so buildTermTheme() falls back to #0c0d10 — slightly lighter than the
          // #000000 UI around it, which reads as a grey box that only a remount
          // (after vars load) clears. getCssVar('--bg') is empty until the vars
          // are applied, so retry briefly until it resolves, then paint the real
          // background. (ghostty-web now honors post-open theme changes.)
          applyThemeWhenReady();
        });
      });
    }

    setup().catch((err) => {
      console.error('[Terminal] xterm.js initialization failed:', err);
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
        // term.dispose() also disposes loaded addons (fit, webgl); just drop refs.
        term.dispose();
        term = null;
      }
      fitAddon = null;
      webglAddon = null;
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

<!-- svelte-ignore a11y_no_static_element_interactions -->
<div
  class="terminal-view"
  ondragenter={handleDragEnter}
  ondragover={handleDragOver}
  ondragleave={handleDragLeave}
  ondrop={handleDrop}
>
  <div class="terminal-container" class:ready={initialized} bind:this={containerEl}></div>
  {#if showEmptyCover}
    <div class="terminal-empty-cover"></div>
  {/if}
  {#if dragActive}
    <div class="terminal-drop-overlay">
      <div class="drop-overlay-inner">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" width="40" height="40">
          <rect x="3" y="3" width="18" height="18" rx="2" ry="2"/>
          <circle cx="8.5" cy="8.5" r="1.5"/>
          <polyline points="21 15 16 10 5 21"/>
        </svg>
        <p class="drop-overlay-text">Drop image to add its path to the prompt</p>
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
    /* Visual spacing around terminal — applied here (not on inner container)
       so xterm.js's render area fills the container exactly without clipping */
    padding: 4px;
    position: relative;
  }

  /* Covers the empty/stopped terminal so no stale/default cell background
     shows; hidden as soon as a provider is running. */
  .terminal-empty-cover {
    position: absolute;
    inset: 0;
    background: var(--bg);
    pointer-events: none;
  }

  /* Drag-and-drop overlay shown while an image is dragged over the terminal.
     pointer-events: none so it never intercepts the drop (which must reach the
     .terminal-view handler). */
  .terminal-drop-overlay {
    position: absolute;
    inset: 6px;
    z-index: 50;
    display: flex;
    align-items: center;
    justify-content: center;
    pointer-events: none;
    background: color-mix(in srgb, var(--bg) 72%, transparent);
    border: 2px dashed var(--accent);
    border-radius: var(--radius-md);
  }

  .drop-overlay-inner {
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: 10px;
    color: var(--accent);
  }

  .drop-overlay-text {
    margin: 0;
    font-size: 14px;
    font-weight: 600;
    color: var(--text-strong);
  }

  .terminal-container {
    flex: 1;
    overflow: hidden;
    /* Ensure xterm.js fills the container */
    min-height: 0;
    position: relative;
    /* Clip terminal rendering to container bounds */
    contain: strict;
    /* Hidden until first fit completes — prevents flash of raw escape sequences */
    visibility: hidden;
  }

  .terminal-container.ready {
    visibility: visible;
  }

  /* Make xterm.js fill the container (its element is sized to rows*cellHeight;
     letting it stretch keeps the themed background edge-to-edge). */
  .terminal-container :global(.xterm) {
    width: 100%;
    height: 100%;
    overflow: hidden !important;
  }

  /* xterm.js (DOM renderer) renders rows as divs; if a canvas/webgl addon is
     added later, ensure the canvas fills the container too. */
  .terminal-container :global(canvas) {
    display: block;
  }
</style>
