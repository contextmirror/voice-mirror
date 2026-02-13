/**
 * terminal.js - ghostty-web terminal + AI provider control
 *
 * Model-agnostic terminal that supports Claude Code, Ollama, LM Studio, and other providers.
 * Uses ghostty-web (Ghostty's VT parser compiled to WASM) as the terminal emulator.
 */

import { state } from './state.js';
import { PROVIDER_ICON_CLASSES } from './settings.js';
import { onTerminalThemeChanged } from './theme-engine.js';
import { createLog } from './log.js';
const log = createLog('[Terminal]');

// ghostty-web instance
let term = null;
let fitAddon = null;
let resizeObserver = null;
let resizeTimeout = null;  // For debouncing resize events
let lastPtyCols = 0;       // Track last PTY size to avoid duplicate SIGWINCH
let lastPtyRows = 0;
let lastOutputTime = 0;    // Timestamp of last PTY output — used to switch render mode

// DOM elements (initialized in initTerminal)
let terminalContainer;      // Chat page bottom panel container
let terminalMount;          // Chat page terminal mount point
let fullscreenMount;        // Fullscreen page terminal mount point
let terminalStatus;
let terminalStartBtn;
let terminalBtn;
let aiBadge;

// Dynamic UI elements for provider display
let navTerminalLabel;
let navProviderName;
let navProviderIcon;
let terminalTitle;
let terminalFullscreenTitle;

/**
 * Send resize to PTY only if cols/rows actually changed.
 * Prevents duplicate SIGWINCH signals that cause Claude Code CLI
 * to redraw its entire UI (header, prompt, etc.) on each resize.
 *
 * Uses term.cols directly — safeFit() already fits the terminal,
 * so the PTY and canvas share the same safe column count.
 */
function resizePtyIfChanged() {
    if (!term || !term.cols || !term.rows) return;
    if (term.cols === lastPtyCols && term.rows === lastPtyRows) return;
    lastPtyCols = term.cols;
    lastPtyRows = term.rows;
    window.voiceMirror.claude.resize(term.cols, term.rows);
}

/**
 * Safe fit: run FitAddon to calculate and apply correct terminal dimensions.
 *
 * ghostty-web's canvas renderer handles subpixel metrics correctly,
 * so no column adjustment is needed (unlike xterm.js which required -1 col hack).
 */
function safeFit() {
    if (!fitAddon || !term) return;
    fitAddon.fit();
}

/**
 * Initialize ghostty-web terminal
 */
export async function initTerminal() {
    // Get DOM elements
    terminalContainer = document.getElementById('terminal-container');
    terminalMount = document.getElementById('terminal-mount');
    fullscreenMount = document.getElementById('terminal-fullscreen-mount');
    terminalStatus = document.getElementById('terminal-status');
    terminalStartBtn = document.getElementById('terminal-start');
    terminalBtn = document.querySelector('.terminal-btn');
    aiBadge = document.getElementById('nav-ai-badge');

    // Dynamic provider display elements
    navTerminalLabel = document.getElementById('nav-terminal-label');
    navProviderName = document.getElementById('nav-provider-name');
    navProviderIcon = document.getElementById('nav-provider-icon');
    terminalTitle = document.getElementById('terminal-title');
    terminalFullscreenTitle = document.getElementById('terminal-fullscreen-title');

    // ghostty-web loaded via UMD script tag (exposes window.GhosttyWeb)
    const GhosttyWeb = window.GhosttyWeb;
    if (!GhosttyWeb) {
        log.error('GhosttyWeb not loaded - check script tags');
        return;
    }

    // Initialize WASM before creating any Terminal instances
    try {
        await GhosttyWeb.init();
        log.info('WASM initialized');
    } catch (err) {
        log.error('WASM init failed:', err);
        return;
    }

    const Terminal = GhosttyWeb.Terminal;
    const FitAddon = GhosttyWeb.FitAddon;

    // Load saved terminal location preference
    try {
        const config = await window.voiceMirror.config.get();
        if (config.behavior?.terminalLocation) {
            state.terminalLocation = config.behavior.terminalLocation;
        }
    } catch (err) {
        log.warn('Failed to load terminal location preference:', err);
    }

    term = new Terminal({
        cursorBlink: true,
        fontSize: 13,
        fontFamily: "'Cascadia Code', 'Fira Code', monospace",
        theme: {
            // Sensible fallback — will be overwritten by theme engine callback
            background: '#0c0d10',
            foreground: '#e4e4e7',
            cursor: '#667eea',
            cursorAccent: '#0c0d10',
            selectionBackground: 'rgba(102, 126, 234, 0.3)',
        },
        scrollback: 1000
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Register terminal theme callback — theme engine will push color + font updates
    onTerminalThemeChanged((termTheme, fontMono) => {
        if (!term) return;
        // ghostty-web v0.4.0: options.theme after open() logs a warning and
        // doesn't apply. Work around by calling renderer.setTheme() directly.
        if (term.renderer) {
            term.renderer.setTheme(termTheme);
        } else {
            // Not mounted yet — set via options (applies on open())
            term.options.theme = termTheme;
        }
        if (fontMono) {
            term.options.fontFamily = fontMono;
        }
        // Re-fit after font/theme change to recalculate character metrics
        if (fitAddon) {
            try { fitAddon.fit(); } catch { /* not mounted yet */ }
        }
    });

    // Mount terminal to the appropriate container based on saved preference
    const mountContainer = state.terminalLocation === 'chat-bottom' ? terminalMount : fullscreenMount;
    term.open(mountContainer);

    // Override ghostty-web's render loop with adaptive rendering.
    // ghostty-web's WASM dirty tracking can miss rows during fast streaming output,
    // causing characters to appear shifted/truncated. We force full renders during
    // active streaming (within 150ms of last PTY output) but use efficient partial
    // renders during typing/idle for lower input latency.
    if (term.animationFrameId) {
        cancelAnimationFrame(term.animationFrameId);
    }
    const renderLoop = () => {
        if (term && term.renderer && term.wasmTerm) {
            // Full renders during active streaming, partial renders when idle/typing
            const streaming = (performance.now() - lastOutputTime) < 150;
            term.renderer.render(
                term.wasmTerm,
                streaming,  // forceAll only during active PTY output
                term.viewportY ?? 0,
                term,
                term.scrollbarOpacity ?? 1
            );
            // Track cursor movement for onCursorMove event
            const cursor = term.wasmTerm.getCursor();
            if (cursor.y !== term.lastCursorY) {
                term.lastCursorY = cursor.y;
                if (term.cursorMoveEmitter) {
                    term.cursorMoveEmitter.fire();
                }
            }
        }
        term._voiceMirrorRafId = requestAnimationFrame(renderLoop);
    };
    term._voiceMirrorRafId = requestAnimationFrame(renderLoop);

    // Fix DPI scaling bug in ghostty-web's Terminal.resize():
    // renderer.resize() correctly sets canvas.width = cssWidth * DPI and ctx.scale(DPI),
    // but Terminal.resize() then overwrites canvas.width/height WITHOUT DPI scaling,
    // resetting the context transform. Patch resize to restore DPI after the original runs.
    const origResize = term.resize.bind(term);
    term.resize = (cols, rows) => {
        origResize(cols, rows);
        // After original resize, fix canvas dimensions with DPI scaling
        if (term.renderer && term.canvas) {
            const dpr = term.renderer.devicePixelRatio || window.devicePixelRatio || 1;
            if (dpr !== 1) {
                const metrics = term.renderer.getMetrics();
                const cssW = metrics.width * cols;
                const cssH = metrics.height * rows;
                term.canvas.width = cssW * dpr;
                term.canvas.height = cssH * dpr;
                term.renderer.ctx.scale(dpr, dpr);
                term.renderer.ctx.textBaseline = 'alphabetic';
                term.renderer.ctx.textAlign = 'left';
            }
        }
    };

    // Wheel scroll — ghostty-web's built-in handler (on the container) doesn't fire
    // reliably in Electron due to contenteditable + frameless-window quirks.
    // Use a window-level capture handler with coordinate hit-testing.
    window.addEventListener('wheel', (e) => {
        if (!term || !term.wasmTerm) return;

        // Coordinate-based hit test — more reliable than contains(e.target)
        const container = state.terminalLocation === 'chat-bottom' ? terminalMount : fullscreenMount;
        if (!container) return;
        const rect = container.getBoundingClientRect();
        if (e.clientX < rect.left || e.clientX > rect.right ||
            e.clientY < rect.top || e.clientY > rect.bottom) return;

        e.preventDefault();
        e.stopPropagation();

        if (term.wasmTerm.isAlternateScreen()) {
            if (term.wasmTerm.hasMouseTracking()) {
                // TUI with mouse tracking (Bubble Tea apps like OpenCode):
                // Send proper SGR mouse wheel events so the app scrolls its viewport,
                // not arrow keys which navigate input history.
                const button = e.deltaY < 0 ? 64 : 65; // 64=scroll up, 65=scroll down
                const metrics = term.renderer?.getMetrics();
                // Convert mouse pixel position to 1-based cell coordinates
                const col = Math.max(1, Math.floor((e.clientX - rect.left) / (metrics?.width ?? 8)) + 1);
                const row = Math.max(1, Math.floor((e.clientY - rect.top) / (metrics?.height ?? 16)) + 1);
                const count = Math.max(1, Math.min(Math.abs(Math.round(e.deltaY / 33)), 5));
                for (let i = 0; i < count; i++) {
                    // SGR extended mouse format (mode 1006) — used by modern TUIs
                    window.voiceMirror.claude.sendInput(`\x1b[<${button};${col};${row}M`);
                }
            } else {
                // Alternate screen without mouse tracking (Claude Code, vim, etc.):
                // Use terminal viewport scrolling — same approach as normal mode.
                const lineHeight = term.renderer?.getMetrics()?.height ?? 20;
                const deltaLines = Math.round(e.deltaY / lineHeight);
                if (deltaLines !== 0) {
                    term.scrollLines(deltaLines);
                }
            }
        } else {
            // Normal mode: use ghostty-web's viewport scrolling
            const lineHeight = term.renderer?.getMetrics()?.height ?? 20;
            const deltaLines = Math.round(e.deltaY / lineHeight);
            if (deltaLines !== 0) {
                term.scrollLines(deltaLines);
            }
        }
    }, { passive: false, capture: true });

    // Update visibility based on location
    if (state.terminalLocation === 'chat-bottom') {
        terminalContainer.classList.remove('hidden');
    } else {
        terminalContainer.classList.add('hidden');
    }

    // Send keyboard input to PTY
    term.onData((data) => {
        window.voiceMirror.claude.sendInput(data);
    });

    // Handle Ctrl+V paste via Electron clipboard (browser paste is blocked on Windows)
    // ghostty-web semantics: return true = "handled, stop processing", false = "pass through"
    // (this is inverted from xterm.js — in ghostty-web true = "handled")
    term.attachCustomKeyEventHandler((event) => {
        if (event.ctrlKey && event.key === 'v') {
            const text = window.voiceMirror.readClipboard();
            if (text) {
                window.voiceMirror.claude.sendInput(text);
            }
            return true; // We handled paste — stop ghostty-web from processing
        }
        return false; // Let ghostty-web handle all other keys normally
    });

    // Handle resize - suspend terminal rendering during active resize,
    // then fit once when settled. This prevents terminal canvas repaints
    // on every frame during drag-resize (major CPU savings).
    //
    // Strategy:
    // - There is no ghostty-web API to pause/freeze rendering
    // - Every PTY resize sends SIGWINCH which makes CLI apps (Claude Code) redraw
    // - XOFF/XON flow control was rejected upstream (breaks Windows + zsh)
    // - Our only lever: minimize the number of PTY resizes that fire
    //
    // We use visibility:hidden during resize (no canvas repaints) + a 300ms
    // debounce (long enough to absorb brief pauses during drag). After the
    // final fit+resize, we delay 50ms before showing the terminal to let
    // the CLI process SIGWINCH and send its redraw output.
    resizeObserver = new ResizeObserver(() => {
        // Hide terminal canvas immediately to stop intermediate repaints
        if (term && term.element && !state.terminalMinimized) {
            term.element.style.visibility = 'hidden';
        }

        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (fitAddon && !state.terminalMinimized) {
                // Only fit if the current container is visible
                const currentContainer = state.terminalLocation === 'chat-bottom' ? terminalMount : fullscreenMount;
                if (currentContainer.offsetParent !== null) {
                    // Use requestAnimationFrame to ensure layout is settled
                    requestAnimationFrame(() => {
                        safeFit();
                        // Only send resize to PTY if dimensions actually changed
                        // (avoids duplicate SIGWINCH causing Claude Code to redraw its UI)
                        resizePtyIfChanged();
                        // Force re-render visible rows to clean up stale line artifacts
                        if (term.refresh) term.refresh(0, term.rows - 1);
                        // Brief delay before showing terminal — gives the CLI
                        // time to process SIGWINCH and send redraw output
                        setTimeout(() => {
                            if (term && term.element) {
                                term.element.style.visibility = '';
                            }
                        }, 50);
                    });
                } else {
                    // Container not visible — restore visibility anyway
                    if (term && term.element) {
                        term.element.style.visibility = '';
                    }
                }
            } else {
                // Terminal minimized or no fitAddon — restore visibility
                if (term && term.element) {
                    term.element.style.visibility = '';
                }
            }
        }, 300);  // 300ms debounce — absorbs brief pauses during drag-resize
    });
    resizeObserver.observe(mountContainer);

    // Initial fit after layout settles
    // Double rAF ensures browser has completed initial layout
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            safeFit();
            resizePtyIfChanged();
        });
    });

    // Deferred re-fit: the PTY starts at hardcoded 120x30 before FitAddon runs.
    // Claude Code renders at 120 cols, then gets resized to the actual width.
    // Its Ink TUI redraws but can leave orphaned characters from the initial
    // 120-col rendering. We run fit+refresh cycles after startup to clear these,
    // mimicking what a manual window resize does.
    for (const delay of [1500, 3000, 5000]) {
        setTimeout(() => {
            if (fitAddon && term && !state.terminalMinimized) {
                const currentContainer = state.terminalLocation === 'chat-bottom' ? terminalMount : fullscreenMount;
                if (currentContainer && currentContainer.offsetParent !== null) {
                    safeFit();
                    resizePtyIfChanged();
                    if (term.refresh) term.refresh(0, term.rows - 1);
                }
            }
        }, delay);
    }

    // Welcome message - use current provider name
    const providerName = state.currentProviderName || 'AI Provider';
    const bannerText = `Voice Mirror - ${providerName}`;
    const padding = Math.max(0, Math.floor((38 - bannerText.length) / 2));
    const paddedBanner = ' '.repeat(padding) + bannerText + ' '.repeat(padding);
    term.writeln('\x1b[36m╔════════════════════════════════════════╗\x1b[0m');
    term.writeln(`\x1b[36m║\x1b[0m \x1b[1;35m${paddedBanner}\x1b[0m \x1b[36m║\x1b[0m`);
    term.writeln('\x1b[36m╚════════════════════════════════════════╝\x1b[0m');
    term.writeln('');
    term.writeln(`\x1b[90mClick "Start" to launch ${providerName}...\x1b[0m`);
    term.writeln('');

    log.info('Initialized at:', state.terminalLocation);
}

/**
 * Toggle terminal visibility
 */
export function toggleTerminal() {
    const isHidden = terminalContainer.classList.contains('hidden');
    if (isHidden) {
        terminalContainer.classList.remove('hidden');
        terminalContainer.classList.remove('minimized');
        state.terminalMinimized = false;
        // Refit terminal after layout settles
        requestAnimationFrame(() => {
            requestAnimationFrame(() => {
                if (fitAddon) {
                    safeFit();
                    if (term.cols && term.rows) {
                        resizePtyIfChanged();
                    }
                }
            });
        });
    } else {
        terminalContainer.classList.add('hidden');
    }
    if (terminalBtn) terminalBtn.classList.toggle('active', !terminalContainer.classList.contains('hidden'));
}

/**
 * Minimize terminal (collapse to header only)
 */
export function minimizeTerminal() {
    state.terminalMinimized = !state.terminalMinimized;

    // Enable CSS transition only for the minimize/expand animation
    terminalContainer.classList.add('transitioning');
    terminalContainer.classList.toggle('minimized', state.terminalMinimized);

    const onTransitionEnd = (e) => {
        // Only respond to height transition on the container itself
        if (e.propertyName === 'height' && e.target === terminalContainer) {
            terminalContainer.removeEventListener('transitionend', onTransitionEnd);
            // Remove transition class so window resize doesn't animate
            terminalContainer.classList.remove('transitioning');

            // Refit when expanding
            if (!state.terminalMinimized && fitAddon) {
                requestAnimationFrame(() => {
                    safeFit();
                    if (term.cols && term.rows) {
                        resizePtyIfChanged();
                    }
                    if (term.refresh) term.refresh(0, term.rows - 1);
                });
            }
        }
    };
    terminalContainer.addEventListener('transitionend', onTransitionEnd);

    // Fallback: clean up transition class if transitionend doesn't fire
    setTimeout(() => {
        terminalContainer.removeEventListener('transitionend', onTransitionEnd);
        terminalContainer.classList.remove('transitioning');
    }, 300);
}

/**
 * Relocate terminal between fullscreen and chat-bottom views
 * @param {string} location - 'fullscreen' | 'chat-bottom'
 */
export async function relocateTerminal(location) {
    if (!term || !term.element) {
        log.warn('Cannot relocate - terminal not initialized');
        return;
    }

    if (location === state.terminalLocation) {
        log.info('Already at location:', location);
        return;
    }

    const termElement = term.element;
    const oldContainer = state.terminalLocation === 'chat-bottom' ? terminalMount : fullscreenMount;
    const newContainer = location === 'chat-bottom' ? terminalMount : fullscreenMount;

    // Update resize observer to watch new container
    if (resizeObserver) {
        resizeObserver.unobserve(oldContainer);
    }

    // Move the terminal DOM element to new container
    newContainer.appendChild(termElement);

    // Update visibility of chat page terminal panel
    if (location === 'chat-bottom') {
        terminalContainer.classList.remove('hidden');
    } else {
        terminalContainer.classList.add('hidden');
    }

    // Observe new container
    if (resizeObserver) {
        resizeObserver.observe(newContainer);
    }

    // Update state
    state.terminalLocation = location;

    // Refit terminal to new container size after layout settles
    // Double rAF ensures browser has completed layout recalculation
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (fitAddon) {
                safeFit();
                resizePtyIfChanged();
            }
        });
    });

    // Save preference to config
    try {
        await window.voiceMirror.config.set({
            behavior: { terminalLocation: location }
        });
        log.info('Relocated to:', location);
    } catch (err) {
        log.error('Failed to save terminal location:', err);
    }
}

/**
 * Update AI provider status display
 */
export function updateAIStatus(running) {
    state.aiRunning = running;

    // Update terminal panel status (if elements exist)
    if (terminalStatus) {
        if (running) {
            terminalStatus.textContent = 'Running';
            terminalStatus.classList.remove('stopped');
        } else {
            terminalStatus.textContent = 'Stopped';
            terminalStatus.classList.add('stopped');
        }
    }

    // Update sidebar nav badge
    if (aiBadge) {
        aiBadge.classList.toggle('stopped', !running);
    }

    // Update start/stop button
    if (terminalStartBtn) {
        if (running) {
            terminalStartBtn.textContent = 'Stop';
            terminalStartBtn.className = 'control-btn stop';
            terminalStartBtn.onclick = stopAI;
        } else {
            terminalStartBtn.textContent = 'Start';
            terminalStartBtn.className = 'control-btn start';
            terminalStartBtn.onclick = startAI;
        }
    }

    // Update fullscreen terminal status (if it exists)
    const fullscreenStatus = document.getElementById('terminal-fullscreen-status');
    if (fullscreenStatus) {
        if (running) {
            fullscreenStatus.textContent = 'Running';
            fullscreenStatus.classList.remove('stopped');
        } else {
            fullscreenStatus.textContent = 'Stopped';
            fullscreenStatus.classList.add('stopped');
        }
    }

    const fullscreenStartBtn = document.getElementById('terminal-fullscreen-start');
    if (fullscreenStartBtn) {
        if (running) {
            fullscreenStartBtn.textContent = 'Stop';
            fullscreenStartBtn.className = 'control-btn stop';
            fullscreenStartBtn.onclick = stopAI;
        } else {
            fullscreenStartBtn.textContent = 'Start';
            fullscreenStartBtn.className = 'control-btn start';
            fullscreenStartBtn.onclick = startAI;
        }
    }
}

/**
 * Update provider display in UI elements
 * @param {string} providerName - Display name (e.g., 'Claude Code', 'Ollama (llama3.2)')
 * @param {string} providerType - Provider type ID (e.g., 'claude', 'ollama')
 * @param {string|null} model - Model name if applicable
 */
export function updateProviderDisplay(providerName, providerType = 'claude', model = null) {
    // Update state
    state.currentProvider = providerType;
    state.currentProviderName = providerName;
    state.currentModel = model;

    // Update sidebar nav sub-label (main label stays "Terminal")
    if (navProviderName) {
        navProviderName.textContent = providerName;
    }
    if (navProviderIcon) {
        navProviderIcon.className = 'provider-icon';
        const iconClass = PROVIDER_ICON_CLASSES[providerType];
        if (iconClass) navProviderIcon.classList.add(iconClass);
    }

    // Update terminal header titles (with terminal icon)
    const titleText = `⌘ ${providerName}`;
    if (terminalTitle) {
        terminalTitle.textContent = titleText;
    }
    if (terminalFullscreenTitle) {
        terminalFullscreenTitle.textContent = titleText;
    }

    // Update nav button tooltip
    const navTerminal = document.getElementById('nav-terminal');
    if (navTerminal) {
        navTerminal.setAttribute('data-tooltip', providerName);
    }

    log.info(`Provider display updated: ${providerName} (${providerType}${model ? ', model: ' + model : ''})`);
}

/**
 * Start AI provider process
 */
export async function startAI() {
    if (term) {
        term.writeln('');
        term.writeln(`\x1b[34m[Starting ${state.currentProviderName}...]\x1b[0m`);
    }
    try {
        // Pass actual terminal dimensions so PTY spawns at the correct size
        // (avoids TUI apps rendering at 120x30 then resizing)
        await window.voiceMirror.claude.start(term?.cols, term?.rows);
    } catch (err) {
        if (term) {
            term.writeln(`\x1b[31m[Failed to start: ${err.message}]\x1b[0m`);
        }
    }
}

/**
 * Stop AI provider process
 */
export async function stopAI() {
    if (term) {
        term.writeln('');
        term.writeln(`\x1b[34m[Stopping ${state.currentProviderName}...]\x1b[0m`);
    }
    try {
        await window.voiceMirror.claude.stop();
    } catch (err) {
        if (term) {
            term.writeln(`\x1b[31m[Failed to stop: ${err.message}]\x1b[0m`);
        }
    }
}

// Generation counter for the currently accepted provider session.
// Output from older generations is silently dropped.
let acceptedGeneration = 0;

/**
 * Handle terminal output from AI provider
 */
export function handleAIOutput(data) {
    if (!term) return;

    // Generation-based output gating for provider switches.
    // When the user changes provider, providerGeneration is bumped and
    // pendingProviderClear is set. ALL output is dropped until the new
    // provider's 'start' event arrives and stamps acceptedGeneration.
    // After that, any stale output from an older generation is still dropped.
    if (state.pendingProviderClear) {
        if (data.type !== 'start') {
            log.debug(`GATED (pendingClear): type=${data.type} len=${(data.text || '').length}`);
            return;
        }
        // 'start' from the new provider — accept this generation
        log.info(`Accepting gen ${state.providerGeneration}: ${(data.text || '').substring(0, 60)}`);
        acceptedGeneration = state.providerGeneration;
        state.pendingProviderClear = false;
        clearTerminal();
        // Reset tracked PTY size so the resize below always fires
        lastPtyCols = 0;
        lastPtyRows = 0;
    } else if (state.providerGeneration !== acceptedGeneration) {
        // Late-arriving output from an old provider after flag was cleared
        log.debug(`GATED (stale gen): type=${data.type} provGen=${state.providerGeneration} accepted=${acceptedGeneration}`);
        return;
    }

    // Track when PTY output arrives so the render loop can use full renders
    // during streaming and efficient partial renders during typing/idle.
    lastOutputTime = performance.now();

    switch (data.type) {
        case 'start':
            term.writeln(`\x1b[34m${data.text}\x1b[0m`);
            updateAIStatus(true);
            // Fit terminal after provider starts - wait for layout
            requestAnimationFrame(() => {
                requestAnimationFrame(() => {
                    if (fitAddon) {
                        safeFit();
                        resizePtyIfChanged();
                    }
                });
            });
            break;
        case 'stdout':
            // Write raw PTY data directly (includes ANSI codes)
            term.write(data.text);
            break;
        case 'stderr':
            // stderr also gets written as raw data
            term.write(data.text);
            break;
        case 'exit':
            term.writeln('');
            term.writeln(`\x1b[33m[Process exited with code ${data.code}]\x1b[0m`);
            updateAIStatus(false);
            break;
    }
}

/**
 * Clear terminal contents and show welcome banner
 */
export function clearTerminal() {
    if (!term) return;

    // Full reset: creates a fresh WASM terminal and clears the renderer canvas.
    // This discards all state including alternate screen buffers and scrollback.
    term.reset();

    // Belt-and-suspenders: write ANSI clear sequences to the NEW terminal
    // in case reset() didn't fully wipe the display state.
    // \x1b[2J = clear screen, \x1b[3J = clear scrollback, \x1b[H = cursor home
    term.write('\x1b[2J\x1b[3J\x1b[H');

    // Explicitly clear the renderer canvas to remove any stale pixels.
    // After our DPI resize monkey-patch, ctx has scale(dpr, dpr) applied,
    // so we save/restore to get clean untransformed coordinates for the fill.
    if (term.renderer && term.renderer.ctx && term.canvas) {
        const ctx = term.renderer.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);  // Reset to identity (physical pixels)
        ctx.fillStyle = term.renderer.theme?.background || '#0c0d10';
        ctx.fillRect(0, 0, term.canvas.width, term.canvas.height);
        ctx.restore();
    }

    // Reset viewport scroll position to top
    if (typeof term.viewportY !== 'undefined') {
        term.viewportY = 0;
    }

    // Show welcome banner again
    const providerName = state.currentProviderName || 'AI Provider';
    const bannerText = `Voice Mirror - ${providerName}`;
    const padding = Math.max(0, Math.floor((38 - bannerText.length) / 2));
    const paddedBanner = ' '.repeat(padding) + bannerText + ' '.repeat(padding);
    term.writeln('\x1b[36m╔════════════════════════════════════════╗\x1b[0m');
    term.writeln(`\x1b[36m║\x1b[0m \x1b[1;35m${paddedBanner}\x1b[0m \x1b[36m║\x1b[0m`);
    term.writeln('\x1b[36m╚════════════════════════════════════════╝\x1b[0m');
    term.writeln('');

    // Show appropriate message based on running state
    if (state.aiRunning) {
        term.writeln(`\x1b[90m${providerName} is running...\x1b[0m`);
    } else {
        term.writeln(`\x1b[90mClick "Start" to launch ${providerName}...\x1b[0m`);
    }
    term.writeln('');

    log.info('Cleared');
}

// Expose functions globally for onclick handlers
window.startAI = startAI;
window.stopAI = stopAI;
window.toggleTerminal = toggleTerminal;
window.minimizeTerminal = minimizeTerminal;
window.relocateTerminal = relocateTerminal;
window.updateProviderDisplay = updateProviderDisplay;
window.clearTerminal = clearTerminal;
