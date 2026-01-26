/**
 * main.js - Entry point, initialization, event binding
 * Voice Mirror Electron overlay
 */

import { state } from './state.js';
import { initMarkdown } from './markdown.js';
import { addMessage, isDuplicate, copyMessage } from './messages.js';
import { initXterm, handleClaudeOutput, updateClaudeStatus, toggleTerminal, startClaude, stopClaude } from './terminal.js';
import { initSettings, toggleSettings } from './settings.js';
import { initNavigation, navigateTo, toggleSidebarCollapse } from './navigation.js';
import { blobToBase64, formatSize } from './utils.js';

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

        let message = '';
        switch (mode) {
            case 'wakeWord':
                const phrase = config.wakeWord?.phrase || 'hey_claude';
                const displayPhrase = phrase.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                message = `Say "${displayPhrase}" to start talking.`;
                break;
            case 'callMode':
                message = `Call mode active - I'm listening. Just start speaking.`;
                break;
            case 'pushToTalk':
                const pttKey = config.behavior?.pttKey || 'Space';
                message = `Hold ${pttKey} to talk.`;
                break;
            default:
                message = `Ready to assist.`;
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
 * Capture screen and show preview
 * Also starts voice listening workflow
 */
async function captureScreen() {
    statusText.textContent = 'Capturing screen...';
    try {
        const dataUrl = await window.voiceMirror.captureScreen();
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
            statusText.textContent = 'Ready - say "Hey Claude"';
            statusIndicator.className = '';
            break;
        case 'wake':
            orb.className = 'listening';
            statusText.textContent = 'Wake word detected!';
            statusIndicator.className = 'wake';
            break;
        case 'recording':
            orb.className = 'recording';
            statusIndicator.className = 'recording';
            statusText.textContent = 'Recording...';
            break;
        case 'processing':
            orb.className = 'thinking';
            statusIndicator.className = 'thinking';
            statusText.textContent = 'Processing...';
            break;
        case 'thinking':
            orb.className = 'thinking';
            statusIndicator.className = 'thinking';
            statusText.textContent = data.source ? `Asking ${data.source}...` : 'Thinking...';
            break;
        case 'speaking':
            orb.className = 'speaking';
            statusIndicator.className = 'speaking';
            statusText.textContent = 'Speaking...';
            break;
        case 'idle':
            orb.className = 'listening';
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
            updateClaudeStatus(true);
            break;
        case 'claude_disconnected':
            updateClaudeStatus(false);
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

    // Initialize settings
    initSettings();

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

        // Check if this is a user voice transcription and we're waiting for image prompt
        if (data.role === 'user' && state.awaitingVoiceForImage) {
            const handled = handleVoiceForImage(data.text);
            if (handled) {
                // Voice was used as image prompt - don't add as separate message
                return;
            }
        }

        if (!isDuplicate(data.text)) {
            addMessage(data.role, data.text);
        }
    });

    // Listen for Claude terminal output
    window.voiceMirror.claude.onOutput(handleClaudeOutput);

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

    // Check Claude status
    const claudeStatus = await window.voiceMirror.claude.getStatus();
    updateClaudeStatus(claudeStatus.running);

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

    console.log('[Voice Mirror] Initialized');
}

// Expose functions globally for onclick handlers in HTML
window.collapse = collapse;
window.captureScreen = captureScreen;
window.sendImage = sendImage;
window.cancelImage = cancelImage;
window.toggleCallMode = toggleCallMode;
window.copyMessage = copyMessage;
window.updateWelcomeMessage = updateWelcomeMessage;
// Terminal functions (from terminal.js)
window.toggleTerminal = toggleTerminal;
window.startClaude = startClaude;
window.stopClaude = stopClaude;
// Settings (from settings.js)
window.toggleSettings = toggleSettings;
// Navigation (from navigation.js)
window.navigateTo = navigateTo;
window.toggleSidebarCollapse = toggleSidebarCollapse;

// Initialize when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
} else {
    init();
}
