/**
 * terminal.js - xterm.js terminal + AI provider control
 *
 * Model-agnostic terminal that supports Claude Code, Ollama, LM Studio, and other providers.
 */

import { state } from './state.js';
import { PROVIDER_ICON_CLASSES } from './settings.js';
import { onTerminalThemeChanged } from './theme-engine.js';

// xterm.js instance
let term = null;
let fitAddon = null;
let resizeObserver = null;
let resizeTimeout = null;  // For debouncing resize events
let lastPtyCols = 0;       // Track last PTY size to avoid duplicate SIGWINCH
let lastPtyRows = 0;

// DOM elements (initialized in initTerminal)
let terminalContainer;      // Chat page bottom panel container
let xtermContainer;         // Chat page xterm mount point
let fullscreenContainer;    // Fullscreen page xterm mount point
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
 * Uses term.cols directly — safeFit() already shrinks xterm by 1 col,
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
 * Safe fit: run FitAddon then shrink xterm by 1 column.
 *
 * FitAddon calculates the maximum columns that fit the container, but
 * subpixel font rounding on Windows HiDPI, container padding measurement
 * differences, and scrollbar width can cause a 1-col overcount. This makes
 * the xterm canvas wider than its container, causing characters (especially
 * Claude Code's box-drawing UI) to visually overflow into the sidebar.
 *
 * By calling term.resize(cols-1, rows) after fitAddon.fit(), we shrink the
 * actual canvas — not just the PTY — so both agree on the safe column count.
 */
function safeFit() {
    if (!fitAddon || !term) return;
    fitAddon.fit();
    const safeCols = Math.max(1, term.cols - 1);
    if (safeCols !== term.cols) {
        term.resize(safeCols, term.rows);
    }
}

/**
 * Initialize xterm.js terminal
 */
export async function initXterm() {
    // Get DOM elements
    terminalContainer = document.getElementById('terminal-container');
    xtermContainer = document.getElementById('xterm-container');
    fullscreenContainer = document.getElementById('xterm-fullscreen-container');
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

    // xterm.js loaded via script tags (UMD bundles expose on window)
    const Terminal = window.Terminal;
    const FitAddon = window.FitAddon.FitAddon;

    if (!Terminal) {
        console.error('[xterm] Terminal not loaded - check script tags');
        return;
    }

    // Load saved terminal location preference
    try {
        const config = await window.voiceMirror.config.get();
        if (config.behavior?.terminalLocation) {
            state.terminalLocation = config.behavior.terminalLocation;
        }
    } catch (err) {
        console.warn('[xterm] Failed to load terminal location preference:', err);
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
            selection: 'rgba(102, 126, 234, 0.3)',
        },
        scrollback: 1000,
        convertEol: true
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

    // Register terminal theme callback — theme engine will push color + font updates
    onTerminalThemeChanged((xtermTheme, fontMono) => {
        if (!term) return;
        term.options.theme = xtermTheme;
        if (fontMono) {
            term.options.fontFamily = fontMono;
        }
        // Re-fit after font/theme change to recalculate character metrics
        if (fitAddon) {
            try { fitAddon.fit(); } catch { /* not mounted yet */ }
        }
    });

    // Mount terminal to the appropriate container based on saved preference
    const mountContainer = state.terminalLocation === 'chat-bottom' ? xtermContainer : fullscreenContainer;
    term.open(mountContainer);

    // Update visibility based on location
    if (state.terminalLocation === 'chat-bottom') {
        terminalContainer.classList.remove('hidden');
        state.terminalVisible = true;
    } else {
        terminalContainer.classList.add('hidden');
        state.terminalVisible = false;
    }

    // Send keyboard input to PTY
    term.onData((data) => {
        window.voiceMirror.claude.sendInput(data);
    });

    // Handle Ctrl+V paste via Electron clipboard (xterm.js browser paste is blocked on Windows)
    term.attachCustomKeyEventHandler((event) => {
        if (event.type === 'keydown' && event.ctrlKey && event.key === 'v') {
            const text = window.voiceMirror.readClipboard();
            if (text) {
                window.voiceMirror.claude.sendInput(text);
            }
            return false; // Prevent default handling
        }
        return true;
    });

    // Handle resize - suspend terminal rendering during active resize,
    // then fit once when settled. This prevents xterm.js canvas repaints
    // on every frame during drag-resize (major CPU savings).
    //
    // Strategy (informed by xterm.js ecosystem research):
    // - There is no xterm.js API to pause/freeze rendering
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
                const currentContainer = state.terminalLocation === 'chat-bottom' ? xtermContainer : fullscreenContainer;
                if (currentContainer.offsetParent !== null) {
                    // Use requestAnimationFrame to ensure layout is settled
                    requestAnimationFrame(() => {
                        safeFit();
                        // Only send resize to PTY if dimensions actually changed
                        // (avoids duplicate SIGWINCH causing Claude Code to redraw its UI)
                        resizePtyIfChanged();
                        // Force re-render visible rows to clean up stale line artifacts
                        term.refresh(0, term.rows - 1);
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
                const currentContainer = state.terminalLocation === 'chat-bottom' ? xtermContainer : fullscreenContainer;
                if (currentContainer && currentContainer.offsetParent !== null) {
                    safeFit();
                    resizePtyIfChanged();
                    term.refresh(0, term.rows - 1);
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

    console.log('[xterm] Initialized at:', state.terminalLocation);
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
        state.terminalVisible = true;
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
        state.terminalVisible = false;
    }
    if (terminalBtn) terminalBtn.classList.toggle('active', state.terminalVisible);
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
                    term.refresh(0, term.rows - 1);
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
 * Hide terminal completely
 */
export function hideTerminal() {
    terminalContainer.classList.add('hidden');
    state.terminalVisible = false;
    if (terminalBtn) terminalBtn.classList.remove('active');
}

/**
 * Relocate terminal between fullscreen and chat-bottom views
 * @param {string} location - 'fullscreen' | 'chat-bottom'
 */
export async function relocateTerminal(location) {
    if (!term || !term.element) {
        console.warn('[xterm] Cannot relocate - terminal not initialized');
        return;
    }

    if (location === state.terminalLocation) {
        console.log('[xterm] Already at location:', location);
        return;
    }

    const xtermElement = term.element;
    const oldContainer = state.terminalLocation === 'chat-bottom' ? xtermContainer : fullscreenContainer;
    const newContainer = location === 'chat-bottom' ? xtermContainer : fullscreenContainer;

    // Update resize observer to watch new container
    if (resizeObserver) {
        resizeObserver.unobserve(oldContainer);
    }

    // Move the xterm DOM element to new container
    newContainer.appendChild(xtermElement);

    // Update visibility of chat page terminal panel
    if (location === 'chat-bottom') {
        terminalContainer.classList.remove('hidden');
        state.terminalVisible = true;
    } else {
        terminalContainer.classList.add('hidden');
        state.terminalVisible = false;
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
        console.log('[xterm] Relocated to:', location);
    } catch (err) {
        console.error('[xterm] Failed to save terminal location:', err);
    }
}

/**
 * Get current terminal location
 * @returns {string} 'fullscreen' | 'chat-bottom'
 */
export function getTerminalLocation() {
    return state.terminalLocation;
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

    console.log(`[Terminal] Provider display updated: ${providerName} (${providerType}${model ? ', model: ' + model : ''})`);
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
        await window.voiceMirror.claude.start();
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

/**
 * Handle terminal output from AI provider
 */
export function handleAIOutput(data) {
    if (!term) return;

    switch (data.type) {
        case 'start':
            // Clear terminal on provider switch BEFORE writing new output
            if (state.pendingProviderClear) {
                state.pendingProviderClear = false;
                clearTerminal();
            }
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

    // Full reset: clear screen, scrollback, and cursor position
    term.reset();

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

    console.log('[Terminal] Cleared');
}

// Expose functions globally for onclick handlers
window.startAI = startAI;
window.stopAI = stopAI;
window.toggleTerminal = toggleTerminal;
window.minimizeTerminal = minimizeTerminal;
window.hideTerminal = hideTerminal;
window.relocateTerminal = relocateTerminal;
window.getTerminalLocation = getTerminalLocation;
window.updateProviderDisplay = updateProviderDisplay;
window.clearTerminal = clearTerminal;
