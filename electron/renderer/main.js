/**
 * main.js - Entry point, initialization, event binding
 * Voice Mirror Electron overlay
 */

import { state } from './state.js';
import { createLog } from './log.js';
const log = createLog('[Main]');
import { initMarkdown } from './markdown.js';
import { addMessage, isDuplicate, copyMessage, initScrollButtons } from './messages.js';
import { initTerminal, handleAIOutput, updateAIStatus, toggleTerminal, startAI, stopAI, updateProviderDisplay } from './terminal.js';
import { initSettings, toggleSettings } from './settings.js';
import { initNavigation, navigateTo, toggleSidebarCollapse } from './navigation.js';
import { initBrowserPanel, navigateToBrowserPage } from './browser-panel.js';
import { initChatInput, setSendImageWithPrompt } from './chat-input.js';
import { initChatStore, autoSave } from './chat-store.js';
import { initOrbCanvas } from './orb-canvas.js';
import { showToast } from './notifications.js';
import { resolveTheme, applyTheme as applyThemeEngine, applyMessageCardOverrides } from './theme-engine.js';

// New extracted modules
import { handleImageBlob, handleVoiceForImage, sendImageWithPrompt, captureScreen, sendImage, cancelImage, updateCaptureButtonState } from './image-handler.js';
import { setAIStatus, TOOL_DISPLAY_NAMES, parsePtyActivity } from './ai-status.js';
import { handleVoiceEvent } from './voice-handler.js';

// DOM elements
const orb = document.getElementById('orb');
const panel = document.getElementById('panel');
const statusText = document.getElementById('status-text');
const dropZone = document.getElementById('drop-zone');
const interruptBtn = document.getElementById('action-interrupt-ai');

// Wire up interrupt button click
if (interruptBtn) {
    interruptBtn.addEventListener('click', async () => {
        try {
            await window.voiceMirror.claude.interrupt();
        } catch (err) {
            log.error('Failed to interrupt:', err);
        }
    });
}

/**
 * Update welcome message based on activation mode
 */
export async function updateWelcomeMessage() {
    try {
        const config = await window.voiceMirror.config.get();
        const mode = config.behavior?.activationMode || 'wakeWord';
        const welcomeBubble = document.getElementById('welcome-bubble');
        const copyBtn = welcomeBubble.querySelector('.message-copy-btn');

        // Build provider prefix if available
        const providerName = state.currentProviderName;
        const prefix = providerName ? `Connected to ${providerName}. ` : '';

        let message = '';
        switch (mode) {
            case 'wakeWord':
                const phrase = config.wakeWord?.phrase || 'hey_claude';
                const displayPhrase = phrase.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                message = `${prefix}Say "${displayPhrase}" to start talking.`;
                break;
            case 'pushToTalk':
                const pttKey = config.behavior?.pttKey || 'Space';
                message = `${prefix}Hold ${pttKey} to talk.`;
                break;
            default:
                message = `${prefix}Ready to assist.`;
        }

        // Update bubble text while preserving copy button
        welcomeBubble.innerHTML = message + copyBtn.outerHTML;
    } catch (err) {
        log.error('Failed to load welcome config:', err);
        document.getElementById('welcome-bubble').textContent = 'Ready to assist.';
    }
}

/**
 * Update UI based on expanded state
 */
function updateUI() {
    if (state.isExpanded) {
        orb.style.display = 'none';
        panel.classList.add('visible');
    } else {
        orb.style.display = 'flex';
        panel.classList.remove('visible');
    }
}

/**
 * Collapse panel back to orb
 */
function collapse() {
    window.voiceMirror.toggleExpand().then(result => {
        state.isExpanded = result.data;
        updateUI();
    });
}

/**
 * Minimize window to taskbar
 */
function minimizeWindow() {
    window.voiceMirror.minimizeWindow();
}

/**
 * Quit the application
 */
function quitApp() {
    window.voiceMirror.quitApp();
}

/**
 * Initialize the application
 */
async function init() {
    // Initialize markdown renderer
    initMarkdown();

    // Initialize canvas orb renderer
    const orbCanvas = document.getElementById('orb-canvas');
    if (orbCanvas) {
        initOrbCanvas(orbCanvas);
    }

    // Load provider display from config FIRST (before terminal init)
    try {
        const config = await window.voiceMirror.config.get();
        const provider = config.ai?.provider || 'claude';
        const model = config.ai?.model || config.ai?.localModel || null;
        // Get display name based on provider
        const providerNames = {
            claude: 'Claude Code',
            ollama: 'Ollama',
            lmstudio: 'LM Studio',
            jan: 'Jan',
            opencode: 'OpenCode'
        };
        let displayName = providerNames[provider] || provider;
        // Only append model name for non-CLI providers (CLI tools manage their own model)
        const cliProviders = ['claude', 'opencode'];
        if (model && !cliProviders.includes(provider)) {
            const shortModel = model.split(':')[0];
            displayName = `${displayName} (${shortModel})`;
        }
        updateProviderDisplay(displayName, provider, model);

        // Inject custom fonts before theme application so CSS variables reference valid families
        try {
            const fontsResult = await window.voiceMirror.fonts.list();
            const customFonts = fontsResult.data || [];
            for (const font of customFonts) {
                const data = await window.voiceMirror.fonts.getDataUrl(font.id);
                if (data.success) {
                    const style = document.createElement('style');
                    style.dataset.fontId = font.id;
                    style.textContent = `@font-face { font-family: '${data.familyName}'; src: url('${data.dataUrl}') format('${data.format}'); font-weight: 100 900; font-style: normal; }`;
                    document.head.appendChild(style);
                }
            }
        } catch (err) {
            log.warn('Failed to load custom fonts at startup:', err);
        }

        // Apply saved theme (colors, fonts, orb) before first paint
        const { colors: themeColors, fonts: themeFonts } = resolveTheme(config.appearance);
        applyThemeEngine(themeColors, themeFonts);

        // Apply message card customizations if saved
        if (config.appearance?.messageCard) {
            applyMessageCardOverrides(config.appearance.messageCard);
        }
        if (config.appearance?.messageCard?.showAvatars === false) {
            document.getElementById('chat-container')?.classList.add('chat-hide-avatars');
        }
    } catch (err) {
        log.warn('Failed to load provider config:', err);
    }

    // Load welcome message
    updateWelcomeMessage();

    // Initialize navigation (sidebar + page routing)
    initNavigation();

    // Initialize terminal
    try {
        await initTerminal();
        // Re-apply theme to terminal now that it's mounted and listening
        try {
            const config = await window.voiceMirror.config.get();
            const { colors: c, fonts: f } = resolveTheme(config.appearance);
            applyThemeEngine(c, f);
        } catch { /* theme already applied, terminal will use fallback */ }
    } catch (err) {
        log.error('Failed to initialize terminal:', err);
    }

    // Initialize browser panel
    initBrowserPanel();

    // Initialize chat input bar (textarea, send/mic buttons, clear/save actions)
    initChatInput();
    setSendImageWithPrompt(sendImageWithPrompt);

    // Initialize scroll navigation buttons
    initScrollButtons();

    // Initialize chat store (sidebar history, persistence)
    initChatStore();

    // Initialize settings (loads tab templates, then wires event handlers)
    await initSettings();

    // Manual drag for Windows (CSS -webkit-app-region: drag is unreliable on small transparent windows)
    // Uses screen.getCursorScreenPoint() via IPC — works even when cursor leaves the 64px window.
    // Window moves with cursor so mouseup always fires (cursor stays over window).
    if (navigator.platform.startsWith('Win')) {
        let dragging = false;
        let dragStartCursor = null;
        let dragStartWin = null;
        let dragTimer = null;

        orb.addEventListener('mousedown', async (e) => {
            if (e.button !== 0 || state.isExpanded) return;
            e.preventDefault();
            dragStartCursor = (await window.voiceMirror.getCursorPosition()).data;
            dragStartWin = (await window.voiceMirror.getWindowPosition()).data;
            dragging = true;
            // Start polling immediately at ~60fps
            const poll = async () => {
                if (!dragging) return;
                const cursor = (await window.voiceMirror.getCursorPosition()).data;
                const dx = cursor.x - dragStartCursor.x;
                const dy = cursor.y - dragStartCursor.y;
                await window.voiceMirror.setWindowPosition(dragStartWin.x + dx, dragStartWin.y + dy);
                if (dragging) dragTimer = requestAnimationFrame(poll);
            };
            dragTimer = requestAnimationFrame(poll);
        });

        window.addEventListener('mouseup', () => {
            if (!dragging) return;
            dragging = false;
            if (dragTimer) { cancelAnimationFrame(dragTimer); dragTimer = null; }
            dragStartCursor = null;
            dragStartWin = null;
        });

        // Disable CSS drag on Windows (handled by manual drag above)
        orb.style.webkitAppRegion = 'no-drag';
    }

    // Right-click on orb to expand
    orb.addEventListener('contextmenu', async (e) => {
        e.preventDefault();
        log.info('Orb right-click, toggling expand');
        const toggleResult = await window.voiceMirror.toggleExpand();
        state.isExpanded = toggleResult.data;
        updateUI();
    });

    // Listen for state changes from main process
    window.voiceMirror.onStateChange((data) => {
        state.isExpanded = data.expanded;
        updateUI();
    });

    // Listen for voice events
    window.voiceMirror.onVoiceEvent(handleVoiceEvent);

    // Listen for chat messages from Python backend
    window.voiceMirror.onChatMessage((data) => {
        log.debug('Chat message:', data);
        window.voiceMirror.devlog('IPC', 'chat-message-received', {
            role: data.role,
            text: data.text?.slice(0, 200),
            source: data.source,
            msgId: data.id,
        });

        // Check if this is a user voice transcription and we're waiting for image prompt
        if (data.role === 'user' && state.awaitingVoiceForImage) {
            const handled = handleVoiceForImage(data.text);
            if (handled) {
                return;
            }
        }

        if (!isDuplicate(data.text)) {
            addMessage(data.role, data.text);
            autoSave();
        }
    });

    // Listen for AI terminal output (+ parse for Claude Code activity)
    window.voiceMirror.claude.onOutput((data) => {
        handleAIOutput(data);
        // Parse PTY stdout for Claude Code activity status
        if (data.type === 'stdout' && state.currentProvider === 'claude') {
            parsePtyActivity(data.text);
        } else if (data.type === 'start') {
            setAIStatus(`Starting ${state.currentProviderName || 'AI'}...`, true, 3000);
        } else if (data.type === 'exit') {
            setAIStatus(null);
        }
    });

    // Listen for tool events (local LLM tool system) — status bar + existing logging
    window.voiceMirror.tools.onToolCall((data) => {
        log.debug('Tool call:', data);
        window.voiceMirror.devlog('TOOL', 'tool-call', { tool: data.tool, text: JSON.stringify(data.args)?.slice(0, 200) });
        const displayName = TOOL_DISPLAY_NAMES[data.tool] || `Running ${data.tool.replace(/_/g, ' ')}`;
        setAIStatus(`${displayName}...`, true, 8000, 'mcp');
    });

    window.voiceMirror.tools.onToolResult((data) => {
        log.debug('Tool result:', data);
        window.voiceMirror.devlog('TOOL', 'tool-result', { tool: data.tool, success: data.success, text: data.result?.slice(0, 200) });
        const displayName = TOOL_DISPLAY_NAMES[data.tool] || data.tool.replace(/_/g, ' ');
        setAIStatus(`${displayName} ${data.success ? 'done' : 'failed'}`, false, 2500, 'mcp');
    });

    // Listen for MCP tool activity (Claude Code via file IPC watchers)
    // These are concrete actions (screen capture, browser search) — use 'mcp' priority
    // so they aren't overridden by noisy PTY output.
    if (window.voiceMirror.tools.onToolActivity) {
        window.voiceMirror.tools.onToolActivity((data) => {
            const displayName = TOOL_DISPLAY_NAMES[data.tool] || data.tool.replace(/_/g, ' ');
            setAIStatus(`${displayName}...`, true, 8000, 'mcp');
        });
    }

    // Listen for open-settings command from tray menu
    window.voiceMirror.onOpenSettings(() => {
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel && !settingsPanel.classList.contains('visible')) {
            toggleSettings();
        }
    });

    // Initialize state from main process
    const initialState = await window.voiceMirror.getState();
    state.isExpanded = initialState.data.expanded;
    updateUI();

    // Check Python status
    const pythonStatusResult = await window.voiceMirror.python.getStatus();
    const pythonStatus = pythonStatusResult.data;
    if (!pythonStatus.running) {
        statusText.textContent = 'Voice backend not running';
    }

    // Reconnect button handler
    const reconnectBtn = document.getElementById('voice-reconnect-btn');
    if (reconnectBtn) {
        reconnectBtn.addEventListener('click', async () => {
            reconnectBtn.style.display = 'none';
            showToast('Reconnecting to voice backend...', 'info');
            await window.voiceMirror.python.restart();
        });
    }

    // Check AI provider status
    const claudeStatusResult = await window.voiceMirror.claude.getStatus();
    updateAIStatus(claudeStatusResult.data.running);

    // Paste handler for images
    document.addEventListener('paste', async (e) => {
        const items = e.clipboardData?.items;
        if (!items) return;

        for (const item of items) {
            if (item.type.startsWith('image/')) {
                e.preventDefault();
                const blob = item.getAsFile();
                await handleImageBlob(blob, 'pasted-image.png');
                break;
            }
        }
    });

    // Handle link clicks - open in external browser
    document.addEventListener('click', (e) => {
        const link = e.target.closest('a[href]');
        if (link) {
            const url = link.getAttribute('href');
            // Only handle http/https URLs
            if (url && (url.startsWith('http://') || url.startsWith('https://'))) {
                e.preventDefault();
                window.voiceMirror.openExternal(url);
            }
        }
    });

    // Drag and drop handlers
    document.addEventListener('dragover', (e) => {
        e.preventDefault();
        if (state.isExpanded) {
            dropZone.classList.add('visible');
        }
    });

    document.addEventListener('dragleave', (e) => {
        if (e.relatedTarget === null || !document.contains(e.relatedTarget)) {
            dropZone.classList.remove('visible');
        }
    });

    document.addEventListener('drop', async (e) => {
        e.preventDefault();
        dropZone.classList.remove('visible');

        const file = e.dataTransfer?.files[0];
        if (file && file.type.startsWith('image/')) {
            await handleImageBlob(file, file.name);
        }
    });

    // Set initial capture button state based on vision support
    updateCaptureButtonState();

    // Performance stats bar
    const perfBar = document.getElementById('perf-stats-bar');
    const perfCpu = document.getElementById('perf-cpu');
    const perfMem = document.getElementById('perf-mem');
    if (perfBar) {
        window.voiceMirror.onPerfStats((stats) => {
            perfCpu.textContent = `CPU: ${stats.cpu.toFixed(1)}%`;
            perfMem.textContent = `MEM: ${stats.rss}MB`;
        });

        // Listen for toggle-stats-bar from main process (global hotkey)
        window.voiceMirror.onToggleStatsBar(() => {
            perfBar.classList.toggle('hidden');
            window.voiceMirror.togglePerfMonitor();
        });
    }

    // Context usage indicator (local LLMs only)
    const perfCtxSep = document.getElementById('perf-ctx-sep');
    const perfCtx = document.getElementById('perf-ctx');
    if (perfCtx && window.voiceMirror.onContextUsage) {
        window.voiceMirror.onContextUsage((usage) => {
            const usedK = (usage.used / 1000).toFixed(1);
            const limitK = (usage.limit / 1000).toFixed(0);
            perfCtx.textContent = `CTX: ${usedK}K/${limitK}K`;
            perfCtxSep.style.display = '';
            perfCtx.style.display = '';
        });
    }

    // Name required check — show modal if no userName configured
    const currentConfig = await window.voiceMirror.config.get();
    if (!currentConfig.user?.name) {
        const nameOverlay = document.getElementById('name-required-overlay');
        const nameInput = document.getElementById('name-required-input');
        const nameBtn = document.getElementById('name-required-submit');
        nameOverlay.style.display = 'flex';

        nameInput.addEventListener('input', () => {
            nameBtn.disabled = !nameInput.value.trim();
        });

        nameBtn.addEventListener('click', async () => {
            const name = nameInput.value.trim();
            if (name) {
                await window.voiceMirror.config.set({ user: { name } });
                nameOverlay.style.display = 'none';
                const settingsInput = document.getElementById('user-name');
                if (settingsInput) settingsInput.value = name;
            }
        });

        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' && nameInput.value.trim()) nameBtn.click();
        });
    }

    // Update checker notifications — sidebar banner
    const updateBanner = document.getElementById('sidebar-update-banner');
    const updateText = document.getElementById('update-banner-text');
    const updateBtn = document.getElementById('update-banner-btn');

    window.voiceMirror.onUpdateAvailable((data) => {
        if (!updateBanner) return;
        updateText.textContent = `Update (${data.behind} new)`;
        updateBtn.textContent = 'Update';
        updateBtn.disabled = false;
        updateBtn.onclick = async () => {
            updateBtn.disabled = true;
            updateText.textContent = 'Pulling...';
            updateBanner.className = 'loading';
            await window.voiceMirror.applyUpdate();
        };
        updateBanner.style.display = '';
        updateBanner.className = 'available';
    });

    window.voiceMirror.onUpdateStatus((data) => {
        if (!updateBanner || updateBanner.style.display === 'none') return;
        if (data.status === 'pulling') {
            updateText.textContent = 'Pulling...';
            updateBanner.className = 'loading';
        } else if (data.status === 'installing') {
            updateText.textContent = 'Installing...';
        } else if (data.status === 'ready') {
            updateText.textContent = 'Restart to apply';
            updateBanner.className = 'success';
            updateBtn.textContent = 'Restart';
            updateBtn.disabled = false;
            updateBtn.onclick = () => window.voiceMirror.relaunch();
        } else if (data.status === 'error') {
            updateText.textContent = 'Update failed';
            updateBanner.className = 'error';
            updateBtn.textContent = 'Retry';
            updateBtn.disabled = false;
            updateBtn.onclick = async () => {
                updateBtn.disabled = true;
                updateText.textContent = 'Pulling...';
                updateBanner.className = 'loading';
                await window.voiceMirror.applyUpdate();
            };
        }
    });

    log.info('Voice Mirror initialized');
}

// Expose functions globally for onclick handlers in HTML
window.collapse = collapse;
window.captureScreen = captureScreen;
window.sendImage = sendImage;
window.cancelImage = cancelImage;
window.copyMessage = copyMessage;
window.minimizeWindow = minimizeWindow;
window.quitApp = quitApp;
window.updateWelcomeMessage = updateWelcomeMessage;
// Terminal functions (from terminal.js)
window.toggleTerminal = toggleTerminal;
window.startAI = startAI;
window.stopAI = stopAI;
window.updateProviderDisplay = updateProviderDisplay;
// Settings (from settings.js)
window.toggleSettings = toggleSettings;
// Navigation (from navigation.js)
window.navigateTo = navigateTo;
window.toggleSidebarCollapse = toggleSidebarCollapse;
// Browser panel (from browser-panel.js)
window.navigateToBrowserPage = navigateToBrowserPage;

// Tertiary hotkey fallback: detect Ctrl+Shift+V (or Cmd+Shift+V on Mac) via DOM keydown.
// This only works when the Electron window has focus, but provides a safety net
// when both uiohook and globalShortcut layers have failed.
// Fallback keydown listener for when window has focus but global hotkeys fail
// Note: Stats bar toggle is now handled by global hotkey manager (configurable)
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        window.voiceMirror.hotkeyFallback('toggle-panel');
    }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
