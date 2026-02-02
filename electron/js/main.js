/**
 * main.js - Entry point, initialization, event binding
 * Voice Mirror Electron overlay
 */

import { state } from './state.js';
import { initMarkdown } from './markdown.js';
import { addMessage, isDuplicate, copyMessage, addToolCallCard, addToolResultCard } from './messages.js';
import { initXterm, handleAIOutput, updateAIStatus, toggleTerminal, startAI, stopAI, updateProviderDisplay } from './terminal.js';
import { initSettings, toggleSettings } from './settings.js';
import { initNavigation, navigateTo, toggleSidebarCollapse } from './navigation.js';
import { initBrowserPanel, navigateToBrowserPage } from './browser-panel.js';
import { blobToBase64, formatSize } from './utils.js';
import { initOrbCanvas, setOrbState, destroyOrbCanvas } from './orb-canvas.js';
import { showToast, updateToast } from './notifications.js';

// DOM elements
const orb = document.getElementById('orb');
const panel = document.getElementById('panel');
const statusIndicator = document.getElementById('status-indicator');
const statusText = document.getElementById('status-text');
const imagePreview = document.getElementById('image-preview');
const previewImage = document.getElementById('preview-image');
const previewFilename = document.getElementById('preview-filename');
const previewSize = document.getElementById('preview-size');
const dropZone = document.getElementById('drop-zone');
const chatContainer = document.getElementById('chat-container');
const callModeBtn = document.getElementById('call-mode-btn');

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
            case 'callMode':
                message = `${prefix}Call mode active - I'm listening. Just start speaking.`;
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
        console.error('[Welcome] Failed to load config:', err);
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
    window.voiceMirror.toggleExpand().then(expanded => {
        state.isExpanded = expanded;
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
 * Hide window to system tray
 */
function hideToTray() {
    window.voiceMirror.hideToTray();
}

/**
 * Handle image blob (from paste or drop)
 * Starts voice listening based on activation mode
 */
async function handleImageBlob(blob, filename) {
    const base64 = await blobToBase64(blob);
    state.pendingImageData = {
        base64: base64,
        filename: filename,
        size: blob.size,
        type: blob.type
    };

    previewImage.src = base64;
    previewFilename.textContent = filename;
    previewSize.textContent = formatSize(blob.size);
    imagePreview.classList.add('visible');

    // Start voice listening workflow based on activation mode
    startImageVoiceWorkflow();
}

/**
 * Start voice listening workflow for image
 * Based on activation mode, waits for voice input before sending image
 */
async function startImageVoiceWorkflow() {
    // Clear any existing timeout
    if (state.imageVoiceTimeout) {
        clearTimeout(state.imageVoiceTimeout);
        state.imageVoiceTimeout = null;
    }

    // Get activation mode from config
    const config = await window.voiceMirror.config.get();
    const mode = config.behavior?.activationMode || 'wakeWord';

    state.awaitingVoiceForImage = true;
    state.imageVoicePrompt = null;

    console.log('[Image] Starting voice workflow, mode:', mode);

    // Set timeout based on mode
    // For PTT: longer timeout (user needs to press button)
    // For call mode: 5 seconds then auto-send
    // For wake word: 5 seconds then auto-send
    const timeoutMs = mode === 'pushToTalk' ? 30000 : 5000;

    statusText.textContent = mode === 'pushToTalk'
        ? 'Screenshot ready - press PTT to describe...'
        : 'Screenshot ready - speak now or wait 5s...';

    state.imageVoiceTimeout = setTimeout(() => {
        // Timeout reached - send image with default prompt
        if (state.awaitingVoiceForImage && state.pendingImageData) {
            console.log('[Image] Voice timeout - sending with default prompt');
            sendImageWithPrompt('Describe this image.');
        }
    }, timeoutMs);
}

/**
 * Handle voice transcription when awaiting image
 * Called from the chat-message event handler
 */
function handleVoiceForImage(text) {
    if (!state.awaitingVoiceForImage || !state.pendingImageData) {
        return false; // Not awaiting voice for image
    }

    console.log('[Image] Got voice prompt:', text);

    // Clear timeout
    if (state.imageVoiceTimeout) {
        clearTimeout(state.imageVoiceTimeout);
        state.imageVoiceTimeout = null;
    }

    // Send image with voice prompt
    sendImageWithPrompt(text);
    return true; // Handled
}

/**
 * Send image with a specific prompt
 */
async function sendImageWithPrompt(prompt) {
    if (!state.pendingImageData) return;

    // Reset state
    state.awaitingVoiceForImage = false;
    if (state.imageVoiceTimeout) {
        clearTimeout(state.imageVoiceTimeout);
        state.imageVoiceTimeout = null;
    }

    // Capture image data before clearing
    const imageData = state.pendingImageData;

    // Show user's image in chat
    addMessage('user', null, imageData.base64);
    // Only add prompt message if there is one
    if (prompt) {
        addMessage('user', prompt);
    }

    // Clear preview immediately so UI feels fast
    cancelImage();

    // Send to backend (response comes via inbox watcher, not inline)
    window.voiceMirror.sendImageToBackend({ ...imageData, prompt })
        .catch(err => {
            console.error('Failed to send image:', err);
            addMessage('assistant', 'Sorry, I could not process that image.');
        });
    // Note: We don't show "waiting for response" - the inbox watcher handles responses
}

/**
 * Capture a specific screen and show preview.
 * @param {string} sourceId - desktopCapturer source ID
 */
async function captureAndPreview(sourceId) {
    statusText.textContent = 'Capturing screen...';
    try {
        const dataUrl = await window.voiceMirror.captureScreen(sourceId);
        if (dataUrl) {
            const base64 = dataUrl;
            const sizeEstimate = Math.round((base64.length * 3) / 4);

            state.pendingImageData = {
                base64: base64,
                filename: 'screenshot.png',
                size: sizeEstimate,
                type: 'image/png'
            };

            previewImage.src = base64;
            previewFilename.textContent = 'screenshot.png';
            previewSize.textContent = formatSize(sizeEstimate);
            imagePreview.classList.add('visible');

            // Start voice listening workflow
            startImageVoiceWorkflow();
        }
    } catch (err) {
        console.error('Screen capture failed:', err);
        statusText.textContent = 'Capture failed';
        setTimeout(() => {
            statusText.textContent = 'Listening...';
        }, 2000);
    }
}

/**
 * Show a picker overlay when multiple screens are detected.
 * @param {Array} screens - Array of {id, name, thumbnail}
 */
function showScreenPicker(screens) {
    // Remove existing picker if any
    dismissScreenPicker();

    const overlay = document.createElement('div');
    overlay.className = 'screen-picker-overlay';
    overlay.id = 'screen-picker';

    const title = document.createElement('div');
    title.className = 'screen-picker-title';
    title.textContent = 'Choose a screen to capture';
    overlay.appendChild(title);

    const grid = document.createElement('div');
    grid.className = 'screen-picker-grid';

    for (const scr of screens) {
        const item = document.createElement('div');
        item.className = 'screen-picker-item';
        item.addEventListener('click', () => {
            dismissScreenPicker();
            captureAndPreview(scr.id);
        });

        const img = document.createElement('img');
        img.src = scr.thumbnail;
        img.alt = scr.name;
        item.appendChild(img);

        const label = document.createElement('span');
        label.className = 'screen-picker-label';
        label.textContent = scr.name;
        item.appendChild(label);

        grid.appendChild(item);
    }

    overlay.appendChild(grid);

    // Click backdrop to dismiss
    overlay.addEventListener('click', (e) => {
        if (e.target === overlay) dismissScreenPicker();
    });

    document.body.appendChild(overlay);

    // Escape to dismiss
    const onKey = (e) => {
        if (e.key === 'Escape') {
            dismissScreenPicker();
            document.removeEventListener('keydown', onKey);
        }
    };
    document.addEventListener('keydown', onKey);
}

function dismissScreenPicker() {
    const existing = document.getElementById('screen-picker');
    if (existing) existing.remove();
}

/**
 * Update the capture button enabled/disabled state based on vision support.
 */
async function updateCaptureButtonState() {
    const btn = document.getElementById('capture-screen-btn');
    if (!btn) return;
    try {
        const hasVision = await window.voiceMirror.supportsVision();
        btn.disabled = !hasVision;
        btn.title = hasVision ? 'Capture Screen' : 'Requires a vision-capable model';
        btn.style.opacity = hasVision ? '' : '0.4';
    } catch {
        // If check fails, leave enabled
    }
}

/**
 * Capture screen — single monitor captures immediately,
 * multiple monitors show a picker.
 */
async function captureScreen() {
    try {
        const screens = await window.voiceMirror.getScreens();
        if (!screens || screens.length === 0) return;
        if (screens.length === 1) {
            await captureAndPreview(screens[0].id);
        } else {
            showScreenPicker(screens);
        }
    } catch (err) {
        console.error('Screen capture failed:', err);
    }
}

/**
 * Send pending image to Claude (manual send button click)
 * Uses whatever voice prompt was captured, or empty string if none
 */
async function sendImage() {
    if (!state.pendingImageData) return;

    const prompt = state.imageVoicePrompt || '';
    sendImageWithPrompt(prompt);
}

/**
 * Cancel image preview
 */
function cancelImage() {
    state.pendingImageData = null;
    state.awaitingVoiceForImage = false;
    state.imageVoicePrompt = null;
    if (state.imageVoiceTimeout) {
        clearTimeout(state.imageVoiceTimeout);
        state.imageVoiceTimeout = null;
    }
    imagePreview.classList.remove('visible');
    previewImage.src = '';
    statusText.textContent = 'Listening...';
}

/**
 * Toggle call mode
 */
async function toggleCallMode() {
    state.callModeActive = !state.callModeActive;
    try {
        await window.voiceMirror.python.setCallMode(state.callModeActive);
        updateCallModeUI();
    } catch (err) {
        console.error('Failed to toggle call mode:', err);
        state.callModeActive = !state.callModeActive;
    }
}

/**
 * Update call mode UI
 */
function updateCallModeUI() {
    if (state.callModeActive) {
        callModeBtn.classList.add('call-active');
        callModeBtn.title = 'Call Mode ON (always listening)';
        statusText.textContent = 'Call active - speak anytime';
    } else {
        callModeBtn.classList.remove('call-active');
        callModeBtn.title = 'Call Mode (always listening)';
        statusText.textContent = 'Listening...';
    }
}

/**
 * Handle voice events from Python backend
 */
function handleVoiceEvent(data) {
    console.log('[Voice Event]', data);
    switch (data.type) {
        case 'starting':
            statusText.textContent = 'Starting...';
            statusIndicator.className = '';
            break;
        case 'ready':
            statusIndicator.className = '';
            window.voiceMirror.config.get().then(cfg => {
                const mode = cfg.behavior?.activationMode || 'wakeWord';
                if (mode === 'pushToTalk') {
                    const key = cfg.behavior?.pttKey || 'Space';
                    statusText.textContent = `Ready - hold ${key} to talk`;
                } else if (mode === 'callMode') {
                    statusText.textContent = 'Ready - listening';
                } else {
                    const phrase = (cfg.wakeWord?.phrase || 'hey_claude')
                        .replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    statusText.textContent = `Ready - say "${phrase}"`;
                }
            }).catch(() => {
                statusText.textContent = 'Ready';
            });
            break;
        case 'wake':
            setOrbState('idle');
            statusText.textContent = 'Wake word detected!';
            statusIndicator.className = 'wake';
            break;
        case 'recording':
            setOrbState('recording');
            statusIndicator.className = 'recording';
            statusText.textContent = 'Recording...';
            break;
        case 'processing':
            setOrbState('thinking');
            statusIndicator.className = 'thinking';
            statusText.textContent = 'Processing...';
            break;
        case 'thinking':
            setOrbState('thinking');
            statusIndicator.className = 'thinking';
            statusText.textContent = data.source ? `Asking ${data.source}...` : 'Thinking...';
            break;
        case 'speaking':
            setOrbState('speaking');
            statusIndicator.className = 'speaking';
            statusText.textContent = 'Speaking...';
            break;
        case 'idle':
            setOrbState('idle');
            statusIndicator.className = '';
            statusText.textContent = 'Listening...';
            break;
        case 'call_active':
            statusText.textContent = 'Call active - speak anytime';
            break;
        case 'mode_change':
            console.log('Mode changed to:', data.mode);
            break;
        case 'claude_connected':
            // Note: terminal clear on provider switch is handled in handleAIOutput('start')
            // which fires before this event, ensuring old output is wiped before new output
            updateAIStatus(true);
            // Update provider display if info is included
            if (data.provider && data.providerName) {
                updateProviderDisplay(data.providerName, data.provider, data.model);
            }
            updateCaptureButtonState();
            break;
        case 'claude_disconnected':
            updateAIStatus(false);
            updateCaptureButtonState();
            break;
        case 'disconnected':
            statusText.textContent = 'Disconnected';
            statusIndicator.className = 'error';
            break;
        case 'error':
            statusText.textContent = 'Error: ' + (data.message || 'Unknown');
            statusIndicator.className = 'error';
            break;
    }

    // Handle call mode in event
    if (data.callMode !== undefined) {
        state.callModeActive = data.callMode;
        updateCallModeUI();
    }
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
            openai: 'OpenAI',
            gemini: 'Gemini',
            grok: 'Grok',
            groq: 'Groq',
            mistral: 'Mistral',
            openrouter: 'OpenRouter',
            deepseek: 'DeepSeek'
        };
        let displayName = providerNames[provider] || provider;
        if (model) {
            const shortModel = model.split(':')[0];
            displayName = `${displayName} (${shortModel})`;
        }
        updateProviderDisplay(displayName, provider, model);
    } catch (err) {
        console.warn('[Init] Failed to load provider config:', err);
    }

    // Load welcome message
    updateWelcomeMessage();

    // Initialize navigation (sidebar + page routing)
    initNavigation();

    // Initialize xterm terminal
    try {
        await initXterm();
    } catch (err) {
        console.error('[xterm] Failed to initialize:', err);
    }

    // Initialize browser panel
    initBrowserPanel();

    // Initialize settings
    initSettings();

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
            dragStartCursor = await window.voiceMirror.getCursorPosition();
            dragStartWin = await window.voiceMirror.getWindowPosition();
            dragging = true;
            // Start polling immediately at ~60fps
            const poll = async () => {
                if (!dragging) return;
                const cursor = await window.voiceMirror.getCursorPosition();
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
        console.log('[Orb] Right-click, toggling expand');
        state.isExpanded = await window.voiceMirror.toggleExpand();
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
        console.log('[Chat Message]', data);
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
        }
    });

    // Listen for AI terminal output
    window.voiceMirror.claude.onOutput(handleAIOutput);

    // Listen for tool events (local LLM tool system)
    window.voiceMirror.tools.onToolCall((data) => {
        console.log('[Tool Call]', data);
        window.voiceMirror.devlog('TOOL', 'tool-call', { tool: data.tool, text: JSON.stringify(data.args)?.slice(0, 200) });
    });

    window.voiceMirror.tools.onToolResult((data) => {
        console.log('[Tool Result]', data);
        window.voiceMirror.devlog('TOOL', 'tool-result', { tool: data.tool, success: data.success, text: data.result?.slice(0, 200) });
    });

    // Listen for open-settings command from tray menu
    window.voiceMirror.onOpenSettings(() => {
        const settingsPanel = document.getElementById('settings-panel');
        if (settingsPanel && !settingsPanel.classList.contains('visible')) {
            toggleSettings();
        }
    });

    // Initialize state from main process
    const initialState = await window.voiceMirror.getState();
    state.isExpanded = initialState.expanded;
    updateUI();

    // Check Python status
    const pythonStatus = await window.voiceMirror.python.getStatus();
    if (!pythonStatus.running) {
        statusText.textContent = 'Voice backend not running';
    }

    // Check AI provider status
    const claudeStatus = await window.voiceMirror.claude.getStatus();
    updateAIStatus(claudeStatus.running);

    // Check call mode
    const callModeStatus = await window.voiceMirror.python.getCallMode();
    state.callModeActive = callModeStatus.active;
    updateCallModeUI();

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
    }

    // Update checker notifications
    window.voiceMirror.onUpdateAvailable((data) => {
        const toast = showToast(
            `Update available (${data.behind} commit${data.behind > 1 ? 's' : ''} behind) — click to update`,
            'info',
            0
        );
        toast.style.cursor = 'pointer';
        toast.addEventListener('click', async (e) => {
            if (e.target.closest('.toast-close')) return;
            updateToast(toast, 'Pulling updates...', 'loading');
            await window.voiceMirror.applyUpdate();
        });
    });

    window.voiceMirror.onUpdateStatus((data) => {
        const existing = document.querySelector('.toast.loading') || document.querySelector('.toast.info');
        if (data.status === 'pulling') {
            if (existing) updateToast(existing, 'Pulling updates...', 'loading');
        } else if (data.status === 'installing') {
            if (existing) updateToast(existing, 'Installing dependencies...', 'loading');
        } else if (data.status === 'ready') {
            if (existing) updateToast(existing, 'Update complete — restart to apply', 'success');
        } else if (data.status === 'error') {
            if (existing) updateToast(existing, `Update failed: ${data.message}`, 'error');
        }
    });

    console.log('[Voice Mirror] Initialized');
}

// Expose functions globally for onclick handlers in HTML
window.collapse = collapse;
window.captureScreen = captureScreen;
window.sendImage = sendImage;
window.cancelImage = cancelImage;
window.toggleCallMode = toggleCallMode;
window.copyMessage = copyMessage;
window.minimizeWindow = minimizeWindow;
window.hideToTray = hideToTray;
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
document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyV') {
        e.preventDefault();
        window.voiceMirror.hotkeyFallback('toggle-panel');
    }
    // Ctrl+Shift+M toggles performance stats bar
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.code === 'KeyM') {
        e.preventDefault();
        const bar = document.getElementById('perf-stats-bar');
        if (bar) {
            bar.classList.toggle('hidden');
            window.voiceMirror.togglePerfMonitor();
        }
    }
});

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
