/**
 * main.js - Entry point, initialization, event binding
 * Voice Mirror Electron overlay
 */

import { state } from './state.js';
import { initMarkdown } from './markdown.js';
import { addMessage, isDuplicate, copyMessage, addToolCallCard, addToolResultCard, initScrollButtons } from './messages.js';
import { initXterm, handleAIOutput, updateAIStatus, toggleTerminal, startAI, stopAI, updateProviderDisplay } from './terminal.js';
import { initSettings, toggleSettings } from './settings.js';
import { initNavigation, navigateTo, toggleSidebarCollapse } from './navigation.js';
import { initBrowserPanel, navigateToBrowserPage } from './browser-panel.js';
import { initChatInput, setRecordingVisual } from './chat-input.js';
import { initChatStore, autoSave } from './chat-store.js';
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
 * Quit the application
 */
function quitApp() {
    window.voiceMirror.quitApp();
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

// ========== AI Activity Status Bar ==========
const aiStatusBar = document.getElementById('ai-status-bar');
const aiStatusText = document.getElementById('ai-status-text');
let aiStatusTimer = null;

const TOOL_DISPLAY_NAMES = {
    capture_screen: 'Capturing screen',
    browser_search: 'Searching the web',
    browser_fetch: 'Fetching page',
    browser_navigate: 'Navigating browser',
    browser_open: 'Opening tab',
    browser_close_tab: 'Closing tab',
    browser_focus: 'Focusing tab',
    browser_tabs: 'Listing tabs',
    browser_start: 'Starting browser',
    browser_stop: 'Stopping browser',
    browser_status: 'Checking browser',
    browser_act: 'Interacting with page',
    browser_click: 'Clicking element',
    browser_type: 'Typing in browser',
    browser_screenshot: 'Taking screenshot',
    browser_snapshot: 'Reading page structure',
    browser_console: 'Reading console',
    browser_cookies: 'Managing cookies',
    browser_storage: 'Managing storage',
    browser_evaluate: 'Running script',
    memory_search: 'Searching memory',
    memory_get: 'Reading memory',
    memory_remember: 'Saving to memory',
    memory_forget: 'Forgetting memory',
    memory_stats: 'Checking memory stats',
    memory_flush: 'Flushing memory',
    claude_listen: 'Listening for voice',
    claude_send: 'Sending response',
    claude_inbox: 'Reading inbox',
    claude_status: 'Checking status',
    get_diagnostic_logs: 'Reading diagnostics',
    clone_voice: 'Cloning voice',
    clear_voice_clone: 'Clearing voice clone',
    list_voice_clones: 'Listing voice clones',
    n8n_list_workflows: 'Listing workflows',
    n8n_get_workflow: 'Reading workflow',
    n8n_create_workflow: 'Creating workflow',
    n8n_update_workflow: 'Updating workflow',
    n8n_delete_workflow: 'Deleting workflow',
    n8n_trigger_workflow: 'Triggering workflow',
    n8n_search_nodes: 'Searching nodes',
    n8n_get_node: 'Reading node',
    web_search: 'Searching the web',
    load_tools: 'Loading tools',
    unload_tools: 'Unloading tools',
    list_tool_groups: 'Listing tool groups',
};

/**
 * Status priority levels — higher priority sources can override lower ones.
 * MCP watcher events (concrete actions) outrank noisy PTY parsing.
 * Voice events (from Python backend) take top priority.
 */
const STATUS_PRIORITY = { idle: 0, pty: 1, mcp: 2, voice: 3 };
let currentStatusPriority = STATUS_PRIORITY.idle;
let currentStatusSource = 'idle';

/**
 * Minimum display duration — prevents rapid flickering by holding a status
 * on screen for at least this long before allowing changes.
 */
let statusHoldUntil = 0;
const STATUS_HOLD_MS = 1200; // 1.2s minimum for meaningful statuses

/**
 * Set the AI activity status bar text.
 * @param {string} text - Status text to display
 * @param {boolean} active - Whether to show shimmer animation
 * @param {number} [autoClearMs] - Auto-hide after this many ms (0 = don't auto-hide)
 * @param {string} [source] - Source: 'idle', 'pty', or 'voice' (for priority)
 */
function setAIStatus(text, active = true, autoClearMs = 0, source = 'idle') {
    if (!aiStatusBar || !aiStatusText) return;

    const priority = STATUS_PRIORITY[source] ?? STATUS_PRIORITY.idle;
    const now = Date.now();

    // Don't let lower-priority sources override higher-priority active states
    if (text && currentStatusPriority > priority && currentStatusSource !== 'idle') {
        return;
    }

    // Respect minimum hold time — keep current status visible long enough to read.
    // Only voice events (highest priority) can break through the hold.
    if (text && now < statusHoldUntil && source !== 'voice' && priority <= currentStatusPriority) {
        return;
    }

    if (aiStatusTimer) { clearTimeout(aiStatusTimer); aiStatusTimer = null; }

    if (!text) {
        // Don't clear to idle if we're still within the hold period
        if (now < statusHoldUntil) {
            aiStatusTimer = setTimeout(() => setAIStatus(null), statusHoldUntil - now + 50);
            return;
        }
        aiStatusText.textContent = 'Waiting for input';
        aiStatusText.classList.remove('shiny-text');
        currentStatusPriority = STATUS_PRIORITY.idle;
        currentStatusSource = 'idle';
        return;
    }

    // Avoid redundant DOM updates for the same text
    if (aiStatusText.textContent === text) {
        // Still update timer if needed
        if (autoClearMs > 0) {
            aiStatusTimer = setTimeout(() => setAIStatus(null), autoClearMs);
        }
        return;
    }

    aiStatusText.textContent = text;
    currentStatusPriority = priority;
    currentStatusSource = source;

    // Set hold time so the status stays readable
    statusHoldUntil = now + STATUS_HOLD_MS;

    if (active) {
        aiStatusText.classList.add('shiny-text');
    } else {
        aiStatusText.classList.remove('shiny-text');
    }

    if (autoClearMs > 0) {
        aiStatusTimer = setTimeout(() => setAIStatus(null), autoClearMs);
    }
}

/**
 * Strip ANSI escape codes and TUI control sequences from a string.
 * Claude Code uses a full TUI (cursor positioning, DEC private modes, etc.)
 * so we need to handle much more than basic SGR sequences.
 */
function stripAnsi(str) {
    return str
        // CSI sequences: \x1b[ followed by optional prefix (?!>), params, and terminator
        // Covers: SGR, cursor movement, DEC private modes (?25l, ?25h), erase, etc.
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b\[[?!>]?[0-9;]*[a-zA-Z~]/g, '')
        // OSC sequences: \x1b] ... BEL or ST
        .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
        // Other 2-char escapes: charset selection, keypad modes, etc.
        // eslint-disable-next-line no-control-regex
        .replace(/\x1b[()#=<>A-Za-z]/g, '')
        // Stray control characters (except \t \n \r)
        // eslint-disable-next-line no-control-regex
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '');
}

/**
 * Parse Claude Code PTY output for activity status.
 * PTY data arrives in small chunks, so we accumulate into a rolling buffer.
 * Uses debouncing to prevent flickering between rapid state changes.
 */
let ptyActivityTimer = null;
let ptyBuffer = '';
const PTY_BUFFER_MAX = 3000;
let lastPtyStatus = '';
let ptyDebounceTimer = null;
let _lastPtyDiag = 0; // Throttle for PTY diagnostic logging

/**
 * Debounced PTY status setter — prevents flickering from rapid PTY output.
 */
function setPtyStatus(text, active = true, autoClearMs = 0) {
    if (text === lastPtyStatus) return; // Skip duplicates
    lastPtyStatus = text;

    if (ptyDebounceTimer) clearTimeout(ptyDebounceTimer);
    ptyDebounceTimer = setTimeout(() => {
        setAIStatus(text, active, autoClearMs, 'pty');
    }, 300); // 300ms debounce — prevents rapid flickering from chunked PTY output
}

function parsePtyActivity(rawText) {
    const text = stripAnsi(rawText);
    ptyBuffer += text;
    if (ptyBuffer.length > PTY_BUFFER_MAX) {
        ptyBuffer = ptyBuffer.slice(-PTY_BUFFER_MAX);
    }

    // --- MCP tool calls ---
    // Patterns: "• voice-mirror-electron - tool_name (MCP)" or "tool_name (MCP)"
    const mcpMatch = ptyBuffer.match(/[•●]\s*\S+\s*[-–]\s*(\w+)\s*\(?MCP\)?/);
    if (mcpMatch) {
        const tool = mcpMatch[1];
        const displayName = TOOL_DISPLAY_NAMES[tool] || formatToolName(tool);
        setPtyStatus(displayName, true);
        ptyBuffer = '';
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 15000);
        return;
    }

    // --- Claude Code built-in tools ---
    // Match tool names with flexible prefix — covers all Claude Code TUI versions:
    //   "⏺ Read(...)" / "+ Read file.js" / "● Edit(...)" / just "Read(" at line start
    const builtinMatch = ptyBuffer.match(/(?:[⏺+●•]\s*|\n\s*)(Read|Edit|Write|Bash|Glob|Grep|WebSearch|WebFetch|Task|NotebookEdit|TodoWrite|TodoRead)\s*[(\[]/);
    if (builtinMatch) {
        const names = {
            Read: 'Reading file', Edit: 'Editing file', Write: 'Writing file',
            Bash: 'Running command', Glob: 'Searching files', Grep: 'Searching code',
            WebSearch: 'Searching the web', WebFetch: 'Fetching page', Task: 'Running task',
            NotebookEdit: 'Editing notebook', TodoWrite: 'Updating todos', TodoRead: 'Reading todos'
        };
        setPtyStatus(names[builtinMatch[1]] || builtinMatch[1], true);
        ptyBuffer = '';
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 10000);
        return;
    }

    // --- Search/glob result counts ---
    const searchMatch = text.match(/Searched for (\d+) pattern/i);
    if (searchMatch) {
        setPtyStatus(`Searched ${searchMatch[1]} patterns`, false, 3000);
        ptyBuffer = '';
        return;
    }

    // --- Thinking / running states ---
    // Match Claude Code spinners: "Running…", "Thinking…", "Ionizing…", etc.
    const stateMatch = text.match(/(Running|Ionizing|Thinking|Boondoggling|Crystallizing|Percolating|Synthesizing|Generating|Analyzing|Compiling|Processing|Evaluating|Reasoning|Planning|Reflecting)[….…]/i);
    if (stateMatch) {
        setPtyStatus(`${stateMatch[1]}...`, true);
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 15000);
        return;
    }

    // "thought for X seconds" / "thought for Xs"
    if (text.match(/thought for \d+/i)) {
        setPtyStatus('Thinking...', true);
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 15000);
        return;
    }

    // --- Streaming response indicator ---
    // Only show "Responding..." for substantial text output with no tool markers.
    // High threshold avoids false positives from tool result summaries.
    if (text.length > 300 && !text.includes('⏺') && !text.includes('●') && !text.includes('MCP') && !text.includes('•')) {
        setPtyStatus('Responding...', true);
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 5000);
        return;
    }

    // --- Specific events ---
    if (text.includes('Message sent in thread')) {
        setPtyStatus('Message sent', false, 2000);
        ptyBuffer = '';
        return;
    }

    if (text.includes('Listening for your voice') || text.includes('listening for voice')) {
        setPtyStatus('Listening for voice...', true);
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 600000); // Long timeout for listen
        return;
    }

    // --- Prompt / waiting for input detection ---
    if (text.includes('❯') || (text.includes('$') && text.trim().endsWith('$'))) {
        // Claude Code returned to prompt — force clear, bypass hold timer
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        statusHoldUntil = 0;
        setAIStatus(null);
        lastPtyStatus = '';
        ptyBuffer = '';
        return;
    }

    // --- Generic activity fallback ---
    // Show "Working..." when idle and receiving substantial PTY data.
    // Skip status-line noise (short chunks with tokens/cost/context stats).
    const isStatusLineNoise = text.length < 80 && /tokens|cost|context|model|%|\d+k/i.test(text);
    if (text.length > 20 && !isStatusLineNoise) {
        if (currentStatusSource === 'idle') {
            setPtyStatus('Working...', true);
            // Diagnostic: log buffer when fallback triggers (once per 10s)
            const now = Date.now();
            if (now - _lastPtyDiag > 10000 && window.voiceMirror?.devlog) {
                _lastPtyDiag = now;
                window.voiceMirror.devlog('STATUS', 'pty-no-match', { text: ptyBuffer.slice(-400) });
            }
        }
        // Refresh auto-clear timer — keeps status alive while real data flows
        if (ptyActivityTimer) clearTimeout(ptyActivityTimer);
        ptyActivityTimer = setTimeout(() => setAIStatus(null), 4000);
    }
}

/**
 * Format a raw tool name into a readable display string.
 * e.g. "browser_screenshot" → "Browser screenshot"
 */
function formatToolName(name) {
    return name.replace(/_/g, ' ').replace(/^\w/, c => c.toUpperCase());
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
            // Hide reconnect button on successful connection
            const reconnectBtnReady = document.getElementById('voice-reconnect-btn');
            if (reconnectBtnReady) reconnectBtnReady.style.display = 'none';
            window.voiceMirror.config.get().then(cfg => {
                const mode = cfg.behavior?.activationMode || 'wakeWord';
                if (mode === 'pushToTalk') {
                    const key = cfg.behavior?.pttKey || 'Space';
                    statusText.textContent = `Ready - hold ${key} to talk`;
                } else {
                    const phrase = (cfg.wakeWord?.phrase || 'hey_claude')
                        .replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
                    statusText.textContent = `Ready - say "${phrase}"`;
                }
            }).catch(() => {
                statusText.textContent = 'Ready';
            });
            break;
        case 'reconnecting':
            statusText.textContent = `Reconnecting (${data.attempt}/${data.maxAttempts})...`;
            statusIndicator.className = 'warning';
            showToast(`Voice backend disconnected. Reconnecting (attempt ${data.attempt})...`, 'warning', 5000);
            break;
        case 'restart_failed':
            statusText.textContent = 'Voice backend offline';
            statusIndicator.className = 'error';
            showToast('Voice backend failed to restart. Click Reconnect to try again.', 'error', 0);
            // Show reconnect button
            const reconnectBtnFailed = document.getElementById('voice-reconnect-btn');
            if (reconnectBtnFailed) reconnectBtnFailed.style.display = 'inline-block';
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
            setRecordingVisual(true);
            setAIStatus('Recording...', true, 0, 'voice');
            break;
        case 'processing':
            setOrbState('thinking');
            statusIndicator.className = 'thinking';
            statusText.textContent = 'Processing...';
            setRecordingVisual(false);
            setAIStatus('Processing speech...', true, 0, 'voice');
            break;
        case 'thinking':
            setOrbState('thinking');
            statusIndicator.className = 'thinking';
            statusText.textContent = data.source ? `Asking ${data.source}...` : 'Thinking...';
            setAIStatus(data.source ? `Asking ${data.source}...` : 'Thinking...', true, 0, 'voice');
            break;
        case 'speaking':
            setOrbState('speaking');
            statusIndicator.className = 'speaking';
            statusText.textContent = 'Speaking...';
            setAIStatus('Speaking...', true, 0, 'voice');
            break;
        case 'idle':
            setOrbState('idle');
            statusIndicator.className = '';
            statusText.textContent = 'Listening...';
            setRecordingVisual(false);
            setAIStatus(null, true, 0, 'voice');
            break;
        case 'claude_message':
            // Claude responded via inbox — transition to idle after a short delay
            // (gives Python TTS time to claim 'speaking' state if notifications are on)
            setTimeout(() => {
                if (statusText.textContent === 'Processing...') {
                    setOrbState('idle');
                    statusIndicator.className = '';
                    statusText.textContent = 'Listening...';
                }
            }, 2000);
            break;
        case 'dictation_start':
            setRecordingVisual(true);
            break;
        case 'dictation_stop':
            setRecordingVisual(false);
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
        // Only append model name for non-CLI providers (Claude Code doesn't use localModel)
        const cliProviders = ['claude'];
        if (model && !cliProviders.includes(provider)) {
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

    // Initialize chat input bar (textarea, send/mic buttons, clear/save actions)
    initChatInput();

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
        console.log('[Tool Call]', data);
        window.voiceMirror.devlog('TOOL', 'tool-call', { tool: data.tool, text: JSON.stringify(data.args)?.slice(0, 200) });
        const displayName = TOOL_DISPLAY_NAMES[data.tool] || `Running ${data.tool.replace(/_/g, ' ')}`;
        setAIStatus(`${displayName}...`, true, 8000, 'mcp');
    });

    window.voiceMirror.tools.onToolResult((data) => {
        console.log('[Tool Result]', data);
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
    state.isExpanded = initialState.expanded;
    updateUI();

    // Check Python status
    const pythonStatus = await window.voiceMirror.python.getStatus();
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
    const claudeStatus = await window.voiceMirror.claude.getStatus();
    updateAIStatus(claudeStatus.running);

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

    console.log('[Voice Mirror] Initialized');
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
