/**
 * terminal.js - xterm.js terminal + AI provider control
 *
 * Model-agnostic terminal that supports Claude Code, Ollama, LM Studio, and other providers.
 */

import { state } from './state.js';

// xterm.js instance
let term = null;
let fitAddon = null;
let resizeObserver = null;
let resizeTimeout = null;  // For debouncing resize events

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
let terminalTitle;
let terminalFullscreenTitle;

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
        fontFamily: "'SF Mono', 'Monaco', 'Consolas', 'Liberation Mono', monospace",
        theme: {
            background: '#0a0a12',
            foreground: '#e0e0e0',
            cursor: '#667eea',
            cursorAccent: '#0a0a12',
            selection: 'rgba(102, 126, 234, 0.3)',
            black: '#1a1a2e',
            red: '#f87171',
            green: '#4ade80',
            yellow: '#fbbf24',
            blue: '#60a5fa',
            magenta: '#c084fc',
            cyan: '#22d3ee',
            white: '#e0e0e0',
            brightBlack: '#4a4a5e',
            brightRed: '#fca5a5',
            brightGreen: '#86efac',
            brightYellow: '#fde047',
            brightBlue: '#93c5fd',
            brightMagenta: '#d8b4fe',
            brightCyan: '#67e8f9',
            brightWhite: '#ffffff'
        },
        scrollback: 1000,
        convertEol: true
    });

    fitAddon = new FitAddon();
    term.loadAddon(fitAddon);

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

    // Handle resize - create observer for current container (debounced)
    resizeObserver = new ResizeObserver(() => {
        if (resizeTimeout) clearTimeout(resizeTimeout);
        resizeTimeout = setTimeout(() => {
            if (fitAddon && !state.terminalMinimized) {
                // Only fit if the current container is visible
                const currentContainer = state.terminalLocation === 'chat-bottom' ? xtermContainer : fullscreenContainer;
                if (currentContainer.offsetParent !== null) {
                    // Use requestAnimationFrame to ensure layout is settled
                    requestAnimationFrame(() => {
                        fitAddon.fit();
                        // Tell PTY about new size
                        if (term.cols && term.rows) {
                            window.voiceMirror.claude.resize(term.cols, term.rows);
                        }
                    });
                }
            }
        }, 50);  // Debounce 50ms to prevent rapid-fire refits
    });
    resizeObserver.observe(mountContainer);

    // Initial fit after layout settles
    // Double rAF ensures browser has completed initial layout
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            fitAddon.fit();
        });
    });

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
                    fitAddon.fit();
                    if (term.cols && term.rows) {
                        window.voiceMirror.claude.resize(term.cols, term.rows);
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
    terminalContainer.classList.toggle('minimized', state.terminalMinimized);

    // Refit when expanding - wait for CSS transition to complete
    if (!state.terminalMinimized && fitAddon) {
        const onTransitionEnd = (e) => {
            // Only respond to height transition on the container itself
            if (e.propertyName === 'height' && e.target === terminalContainer) {
                terminalContainer.removeEventListener('transitionend', onTransitionEnd);
                requestAnimationFrame(() => {
                    fitAddon.fit();
                    if (term.cols && term.rows) {
                        window.voiceMirror.claude.resize(term.cols, term.rows);
                    }
                });
            }
        };
        terminalContainer.addEventListener('transitionend', onTransitionEnd);

        // Fallback in case transitionend doesn't fire (e.g., no transition defined)
        setTimeout(() => {
            terminalContainer.removeEventListener('transitionend', onTransitionEnd);
        }, 300);
    }
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
                fitAddon.fit();
                if (term.cols && term.rows) {
                    window.voiceMirror.claude.resize(term.cols, term.rows);
                }
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

    // Update sidebar nav label
    if (navTerminalLabel) {
        navTerminalLabel.textContent = providerName;
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
                    if (fitAddon) fitAddon.fit();
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
