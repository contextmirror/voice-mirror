/**
 * terminal.js - xterm.js terminal + Claude Code control
 */

import { state } from './state.js';

// xterm.js instance
let term = null;
let fitAddon = null;
let resizeObserver = null;

// DOM elements (initialized in initTerminal)
let terminalContainer;      // Chat page bottom panel container
let xtermContainer;         // Chat page xterm mount point
let fullscreenContainer;    // Fullscreen page xterm mount point
let terminalStatus;
let terminalStartBtn;
let terminalBtn;
let claudeBadge;

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
    claudeBadge = document.getElementById('claude-badge');

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

    // Handle resize - create observer for current container
    resizeObserver = new ResizeObserver(() => {
        if (fitAddon && !state.terminalMinimized) {
            // Only fit if the current container is visible
            const currentContainer = state.terminalLocation === 'chat-bottom' ? xtermContainer : fullscreenContainer;
            if (currentContainer.offsetParent !== null) {
                fitAddon.fit();
                // Tell PTY about new size
                if (term.cols && term.rows) {
                    window.voiceMirror.claude.resize(term.cols, term.rows);
                }
            }
        }
    });
    resizeObserver.observe(mountContainer);

    // Initial fit after a small delay to ensure container is sized
    setTimeout(() => {
        fitAddon.fit();
    }, 100);

    // Welcome message
    term.writeln('\x1b[36m╔════════════════════════════════════════╗\x1b[0m');
    term.writeln('\x1b[36m║\x1b[0m   \x1b[1;35mVoice Mirror\x1b[0m - Claude Code Terminal   \x1b[36m║\x1b[0m');
    term.writeln('\x1b[36m╚════════════════════════════════════════╝\x1b[0m');
    term.writeln('');
    term.writeln('\x1b[90mClick "Start" to launch Claude Code...\x1b[0m');
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
        // Refit terminal after showing
        setTimeout(() => {
            if (fitAddon) fitAddon.fit();
        }, 100);
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
    // Refit when expanding
    if (!state.terminalMinimized && fitAddon) {
        setTimeout(() => fitAddon.fit(), 100);
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

    // Refit terminal to new container size
    setTimeout(() => {
        if (fitAddon) {
            fitAddon.fit();
            if (term.cols && term.rows) {
                window.voiceMirror.claude.resize(term.cols, term.rows);
            }
        }
    }, 50);

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
 * Update Claude status display
 */
export function updateClaudeStatus(running) {
    state.claudeRunning = running;

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

    // Update status bar badge
    if (claudeBadge) {
        claudeBadge.classList.toggle('stopped', !running);
    }

    // Update start/stop button
    if (terminalStartBtn) {
        if (running) {
            terminalStartBtn.textContent = 'Stop';
            terminalStartBtn.className = 'control-btn stop';
            terminalStartBtn.onclick = stopClaude;
        } else {
            terminalStartBtn.textContent = 'Start';
            terminalStartBtn.className = 'control-btn start';
            terminalStartBtn.onclick = startClaude;
        }
    }

    // Update sidebar nav badge
    const navClaudeBadge = document.getElementById('nav-claude-badge');
    if (navClaudeBadge) {
        navClaudeBadge.classList.toggle('stopped', !running);
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
            fullscreenStartBtn.onclick = stopClaude;
        } else {
            fullscreenStartBtn.textContent = 'Start';
            fullscreenStartBtn.className = 'control-btn start';
            fullscreenStartBtn.onclick = startClaude;
        }
    }
}

/**
 * Start Claude Code process
 */
export async function startClaude() {
    if (term) {
        term.writeln('');
        term.writeln('\x1b[34m[Starting Claude Code...]\x1b[0m');
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
 * Stop Claude Code process
 */
export async function stopClaude() {
    if (term) {
        term.writeln('');
        term.writeln('\x1b[34m[Stopping Claude Code...]\x1b[0m');
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
 * Handle terminal output from Claude
 */
export function handleClaudeOutput(data) {
    if (!term) return;

    switch (data.type) {
        case 'start':
            term.writeln(`\x1b[34m${data.text}\x1b[0m`);
            updateClaudeStatus(true);
            // Fit terminal after Claude starts
            setTimeout(() => {
                if (fitAddon) fitAddon.fit();
            }, 100);
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
            updateClaudeStatus(false);
            break;
    }
}

// Expose functions globally for onclick handlers
window.startClaude = startClaude;
window.stopClaude = stopClaude;
window.toggleTerminal = toggleTerminal;
window.minimizeTerminal = minimizeTerminal;
window.hideTerminal = hideTerminal;
window.relocateTerminal = relocateTerminal;
window.getTerminalLocation = getTerminalLocation;
