/**
 * image-handler.js - Image paste/drop/capture workflow
 * Handles image preview, screen capture picker, and sending images to backend.
 */

import { state } from './state.js';
import { createLog } from './log.js';
import { blobToBase64, formatSize } from './utils.js';
import { addMessage, isDuplicate } from './messages.js';
import { triggerAutoName } from './chat-store.js';

const log = createLog('[Image]');

// DOM elements
const imagePreview = document.getElementById('image-preview');
const previewImage = document.getElementById('preview-image');
const previewFilename = document.getElementById('preview-filename');
const previewSize = document.getElementById('preview-size');
const statusText = document.getElementById('status-text');

/**
 * Handle image blob (from paste or drop)
 * Starts voice listening based on activation mode
 */
export async function handleImageBlob(blob, filename) {
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

    log.info('Starting image voice workflow, mode:', mode);

    // Set timeout based on mode
    // For PTT: longer timeout (user needs to press button)
    // For wake word: 5 seconds then auto-send
    const timeoutMs = mode === 'pushToTalk' ? 30000 : 5000;

    statusText.textContent = mode === 'pushToTalk'
        ? 'Screenshot ready - press PTT to describe...'
        : 'Screenshot ready - speak now or wait 5s...';

    state.imageVoiceTimeout = setTimeout(() => {
        // Timeout reached - send image with default prompt
        if (state.awaitingVoiceForImage && state.pendingImageData) {
            log.info('Image voice timeout - sending with default prompt');
            sendImageWithPrompt('Describe this image.');
        }
    }, timeoutMs);
}

/**
 * Handle voice transcription when awaiting image
 * Called from the chat-message event handler
 */
export function handleVoiceForImage(text) {
    if (!state.awaitingVoiceForImage || !state.pendingImageData) {
        return false; // Not awaiting voice for image
    }

    log.info('Got image voice prompt:', text);

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
export async function sendImageWithPrompt(prompt) {
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
        isDuplicate(prompt); // Register in dedup map so inbox echo is suppressed
    }

    // Clear preview immediately so UI feels fast
    cancelImage();
    triggerAutoName();

    // Send to backend (response comes via inbox watcher, not inline)
    window.voiceMirror.sendImageToBackend({ ...imageData, prompt })
        .catch(err => {
            log.error('Failed to send image:', err);
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
        const captureResult = await window.voiceMirror.captureScreen(sourceId);
        const dataUrl = captureResult.data;
        if (captureResult.success && dataUrl) {
            const sizeEstimate = Math.round((dataUrl.length * 3) / 4);

            state.pendingImageData = {
                base64: dataUrl,
                filename: 'screenshot.png',
                size: sizeEstimate,
                type: 'image/png'
            };

            previewImage.src = dataUrl;
            previewFilename.textContent = 'screenshot.png';
            previewSize.textContent = formatSize(sizeEstimate);
            imagePreview.classList.add('visible');

            // Start voice listening workflow
            startImageVoiceWorkflow();
        }
    } catch (err) {
        log.error('Screen capture failed:', err);
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
export function updateCaptureButtonState() {
    const btn = document.getElementById('capture-screen-btn');
    if (!btn) return;
    btn.disabled = false;
    btn.title = 'Capture Screen';
    btn.style.opacity = '';
}

/**
 * Capture screen — single monitor captures immediately,
 * multiple monitors show a picker.
 */
export async function captureScreen() {
    try {
        const result = await window.voiceMirror.getScreens();
        const screens = result.data;
        if (!screens || screens.length === 0) return;
        if (screens.length === 1) {
            await captureAndPreview(screens[0].id);
        } else {
            showScreenPicker(screens);
        }
    } catch (err) {
        log.error('Screen capture failed:', err);
    }
}

/**
 * Send pending image to Claude (manual send button click)
 * Uses whatever voice prompt was captured, or empty string if none
 */
export async function sendImage() {
    if (!state.pendingImageData) return;

    const prompt = state.imageVoicePrompt || '';
    sendImageWithPrompt(prompt);
}

/**
 * Cancel image preview
 */
export function cancelImage() {
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
