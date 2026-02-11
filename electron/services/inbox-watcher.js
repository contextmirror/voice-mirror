/**
 * Inbox watcher service for Voice Mirror Electron.
 * Watches for Claude messages in the MCP inbox and forwards user messages
 * to non-Claude providers (Ollama, LM Studio, etc.)
 */

const fs = require('fs');
const fsPromises = fs.promises;
const path = require('path');

/**
 * Create an inbox watcher service instance.
 * @param {Object} options - Service options
 * @param {string} options.dataDir - Path to data directory
 * @param {Function} options.isClaudeRunning - Check if Claude is running
 * @param {Function} options.getProvider - Get active provider instance
 * @param {Function} options.onClaudeMessage - Callback for Claude messages
 * @param {Function} options.onUserMessage - Callback for user messages (chat UI)
 * @param {Function} options.onAssistantMessage - Callback for assistant messages (chat UI)
 * @param {Function} options.onVoiceEvent - Callback for voice events
 * @returns {Object} Inbox watcher service instance
 */
function createInboxWatcher(options = {}) {
    const {
        dataDir,
        getSenderName,
        isClaudeRunning,
        getProvider,
        onClaudeMessage,
        onUserMessage,
        onAssistantMessage,
        onVoiceEvent,
        log
    } = options;

    // Helper to get the current sender name (user-configurable)
    const _senderName = () => (getSenderName ? getSenderName() : 'user');

    // Dev log helper — uses logger.devlog if provided, else no-op
    const _devlog = log?.devlog
        ? (category, action, data) => log.devlog(category, action, data)
        : () => {};

    let watcher = null;
    let displayedMessageIds = new Set();  // Track messages already shown in UI
    let processedUserMessageIds = new Set();  // Track user messages already forwarded to non-Claude providers

    /**
     * Start watching for inbox messages.
     */
    function start() {
        if (watcher) {
            console.log('[InboxWatcher] Already running');
            return;
        }

        const contextMirrorDir = dataDir || require('./platform-paths').getDataDir();
        const inboxPath = path.join(contextMirrorDir, 'inbox.json');

        // Ensure data directory exists
        if (!fs.existsSync(contextMirrorDir)) {
            fs.mkdirSync(contextMirrorDir, { recursive: true });
        }

        // Seed displayedMessageIds with existing messages to avoid showing stale history
        // Also seed processedUserMessageIds to avoid re-forwarding old messages to non-Claude providers
        // Only NEW messages that arrive after app starts will be displayed/processed
        try {
            if (fs.existsSync(inboxPath)) {
                const data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
                const messages = data.messages || [];
                for (const msg of messages) {
                    if (msg.id) {
                        displayedMessageIds.add(msg.id);
                        // Also seed processedUserMessageIds for user messages
                        if (msg.from === _senderName()) {
                            processedUserMessageIds.add(msg.id);
                        }
                    }
                }
                console.log(`[InboxWatcher] Seeded ${displayedMessageIds.size} display IDs, ${processedUserMessageIds.size} user message IDs`);
            }
        } catch (err) {
            console.error('[InboxWatcher] Failed to seed message IDs:', err);
        }

        // Debounce: coalesce rapid file changes into a single check
        let debounceTimer = null;
        let fsWatcher = null;

        async function checkInbox() {
            try {
                let raw;
                try {
                    raw = await fsPromises.readFile(inboxPath, 'utf-8');
                } catch {
                    return; // File doesn't exist yet
                }

                const data = JSON.parse(raw);
                const messages = data.messages || [];

                if (messages.length === 0) return;

                // Watch for Claude responses and display in UI
                let latestClaudeMessage = null;
                for (let i = messages.length - 1; i >= 0; i--) {
                    const msg = messages[i];
                    const sender = (msg.from || '').toLowerCase();
                    if (sender.includes('claude') && msg.thread_id === 'voice-mirror') {
                        latestClaudeMessage = msg;
                        break;
                    }
                }

                if (latestClaudeMessage && !displayedMessageIds.has(latestClaudeMessage.id)) {
                    displayedMessageIds.add(latestClaudeMessage.id);

                    // Keep Set size bounded
                    if (displayedMessageIds.size > 100) {
                        const iterator = displayedMessageIds.values();
                        displayedMessageIds.delete(iterator.next().value);
                    }

                    console.log('[InboxWatcher] New Claude message:', latestClaudeMessage.message?.slice(0, 50));

                    if (onClaudeMessage) {
                        onClaudeMessage({
                            role: 'assistant',
                            text: latestClaudeMessage.message,
                            source: 'claude',
                            timestamp: latestClaudeMessage.timestamp,
                            id: latestClaudeMessage.id
                        });
                    }

                    if (onVoiceEvent) {
                        onVoiceEvent({
                            type: 'claude_message',
                            text: latestClaudeMessage.message
                        });
                    }
                }

                // === Inbox Bridge for Non-Claude Providers ===
                const claudeRunning = isClaudeRunning ? isClaudeRunning() : false;
                const activeProvider = getProvider ? getProvider() : null;

                if (!claudeRunning && activeProvider && activeProvider.isRunning()) {
                    for (const msg of messages) {
                        if (processedUserMessageIds.has(msg.id) || msg.from !== _senderName()) continue;

                        processedUserMessageIds.add(msg.id);

                        if (processedUserMessageIds.size > 100) {
                            const iterator = processedUserMessageIds.values();
                            processedUserMessageIds.delete(iterator.next().value);
                        }

                        const providerName = activeProvider.getDisplayName();
                        console.log(`[InboxWatcher] Forwarding inbox message to ${providerName}: ${msg.message?.slice(0, 50)}...`);
                        _devlog('BACKEND', 'forwarding', { text: msg.message, source: providerName, msgId: msg.id });

                        try {
                            const dc = require('./diagnostic-collector');
                            if (dc.hasActiveTrace()) {
                                dc.addActiveStage('provider_forward', {
                                    provider: providerName,
                                    message: msg.message,
                                    message_id: msg.id
                                });
                            }
                        } catch { /* diagnostic not available */ }

                        if (onUserMessage) {
                            onUserMessage({
                                role: 'user',
                                text: msg.message,
                                source: 'voice',
                                timestamp: msg.timestamp,
                                id: msg.id
                            });
                        }

                        captureProviderResponse(activeProvider, msg.message, _devlog, msg.image_data_url || null).then((response) => {
                            if (response) {
                                const cleanedResponse = stripEchoedContent(response);
                                writeResponseToInbox(contextMirrorDir, cleanedResponse, providerName, msg.id);
                                if (onAssistantMessage) {
                                    onAssistantMessage({
                                        role: 'assistant',
                                        text: cleanedResponse,
                                        source: providerName.toLowerCase(),
                                        timestamp: new Date().toISOString()
                                    });
                                }
                            } else {
                                console.log('[InboxWatcher] No response captured, sending idle event');
                                _devlog('BACKEND', 'no-response', { reason: 'capture returned null/empty' });
                                if (onVoiceEvent) {
                                    onVoiceEvent({ type: 'idle' });
                                }
                            }
                        }).catch((err) => {
                            console.error(`[InboxWatcher] Error forwarding to ${providerName}:`, err);
                            if (onVoiceEvent) {
                                onVoiceEvent({ type: 'idle' });
                            }
                        });
                    }
                }

            } catch (err) {
                if (!(err instanceof SyntaxError)) {
                    console.error('[InboxWatcher] Check error:', err.message);
                }
            }
        }

        function debouncedCheck() {
            if (debounceTimer) clearTimeout(debounceTimer);
            debounceTimer = setTimeout(() => checkInbox(), 100);
        }

        // Use fs.watch on the data directory for inbox changes
        try {
            fsWatcher = fs.watch(contextMirrorDir, (eventType, filename) => {
                if (filename === 'inbox.json') {
                    debouncedCheck();
                }
            });
            fsWatcher.on('error', (err) => {
                console.error('[InboxWatcher] fs.watch error, falling back to polling:', err.message);
                fsWatcher = null;
                // Fallback: poll at 2s instead of 500ms
                watcher = setInterval(() => checkInbox(), 2000);
            });
        } catch (err) {
            console.error('[InboxWatcher] fs.watch unavailable, using polling fallback:', err.message);
            watcher = setInterval(() => checkInbox(), 2000);
        }

        // Store references for cleanup
        watcher = {
            fsWatcher,
            debounceTimer: null,  // tracked via closure
            _close() {
                if (fsWatcher) { try { fsWatcher.close(); } catch {} }
                if (debounceTimer) clearTimeout(debounceTimer);
            }
        };

        console.log('[InboxWatcher] Started (fs.watch mode)');
    }

    /**
     * Stop watching for inbox messages.
     */
    function stop() {
        if (watcher) {
            if (watcher._close) {
                watcher._close(); // fs.watch mode
            } else if (typeof watcher.close === 'function') {
                watcher.close();
            } else {
                clearInterval(watcher); // polling fallback
            }
            watcher = null;
            console.log('[InboxWatcher] Stopped');
        }
    }

    /**
     * Check if watcher is running.
     * @returns {boolean} True if running
     */
    function isRunning() {
        return watcher !== null;
    }

    /**
     * Add a message ID to the displayed set (for deduplication).
     * @param {string} id - Message ID to add
     */
    function addDisplayedMessageId(id) {
        displayedMessageIds.add(id);
        // Keep Set size bounded
        if (displayedMessageIds.size > 100) {
            const iterator = displayedMessageIds.values();
            displayedMessageIds.delete(iterator.next().value);
        }
    }

    /**
     * Re-seed processed user message IDs from the current inbox file.
     * Called on provider switch so that old messages aren't re-forwarded
     * to the new provider, but new messages arriving after the switch are.
     */
    function clearProcessedUserMessageIds() {
        processedUserMessageIds.clear();
        displayedMessageIds.clear();

        // Re-seed from current inbox to mark all existing messages as already processed
        const contextMirrorDir = dataDir || require('./platform-paths').getDataDir();
        const inboxPath = path.join(contextMirrorDir, 'inbox.json');
        try {
            if (fs.existsSync(inboxPath)) {
                const data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
                const messages = data.messages || [];
                for (const msg of messages) {
                    if (msg.id) {
                        displayedMessageIds.add(msg.id);
                        if (msg.from === _senderName()) {
                            processedUserMessageIds.add(msg.id);
                        }
                    }
                }
                console.log(`[InboxWatcher] Re-seeded ${displayedMessageIds.size} display IDs, ${processedUserMessageIds.size} user message IDs for provider switch`);
            }
        } catch (err) {
            console.error('[InboxWatcher] Failed to re-seed message IDs:', err);
        }
    }

    /**
     * Get the current count of displayed message IDs.
     * @returns {number} Count of displayed message IDs
     */
    function getDisplayedMessageCount() {
        return displayedMessageIds.size;
    }

    return {
        start,
        stop,
        isRunning,
        addDisplayedMessageId,
        clearProcessedUserMessageIds,
        getDisplayedMessageCount
    };
}

/**
 * Capture streamed response from an OpenAI-compatible provider.
 * Intercepts the provider's output and collects the full response.
 * Handles tool calls by waiting for the tool loop to complete.
 * @param {Object} provider - The provider instance
 * @param {string} message - The message to send
 * @param {Function} _devlog - Dev logging function
 * @param {string|null} imageDataUrl - Optional image data URL to send with message
 * @returns {Promise<string|null>} The final response (after tool execution) or null on timeout
 */
async function captureProviderResponse(provider, message, _devlog = () => {}, imageDataUrl = null) {
    return new Promise((resolve) => {
        let fullResponse = '';
        let allOutput = '';  // Never reset — keeps everything for fallback extraction
        let toolInProgress = false;
        let finalResponse = '';
        let resolved = false;  // Guard: prevent double-resolve from timeout + stability race
        let timeoutHandle = null;
        const originalEmit = provider.emitOutput.bind(provider);

        // Track tool execution state via callbacks
        const originalOnToolCall = provider.onToolCall;
        const originalOnToolResult = provider.onToolResult;

        let lastLength = 0;
        let stableCount = 0;
        let toolCompleted = false;
        let toolCount = 0;
        let maxIterationsReached = false;
        let emptyAfterToolChecks = 0;

        function finish(response, reason) {
            if (resolved) return;
            resolved = true;
            clearInterval(checkInterval);
            if (timeoutHandle) clearTimeout(timeoutHandle);
            cleanup();
            resolve(response || null);
        }

        provider.onToolCall = (data) => {
            if (resolved) return;
            toolInProgress = true;
            toolCount++;
            console.log(`[InboxWatcher] Tool call in progress: ${data.tool} (call #${toolCount})`);
            _devlog('TOOL', 'call-started', { tool: data.tool, text: `call #${toolCount}` });
            if (originalOnToolCall) originalOnToolCall(data);
        };

        provider.onToolResult = (data) => {
            if (resolved) return;
            console.log(`[InboxWatcher] Tool result received: ${data.tool} (success: ${data.success})`);
            _devlog('TOOL', 'call-result', { tool: data.tool, success: data.success, text: `call #${toolCount}` });
            fullResponse = '';
            lastLength = 0;
            stableCount = 0;
            emptyAfterToolChecks = 0;
            toolCompleted = true;
            toolInProgress = false;
            if (originalOnToolResult) originalOnToolResult(data);
        };

        // Intercept output to capture the response
        provider.emitOutput = (type, text) => {
            originalEmit(type, text);
            if (resolved) return;
            if (type === 'stdout' && text) {
                fullResponse += text;
                allOutput += text;
                // Detect max tool iterations reached
                if (text.includes('[Max tool iterations reached]')) {
                    maxIterationsReached = true;
                }
            }
        };

        // Send the message (with optional image)
        provider.sendInput(message, false, imageDataUrl);
        const startTime = Date.now();

        // Wait for response to complete (detect when output stops)
        const requiredStableChecks = 4;  // 2 seconds of stability
        const checkInterval = setInterval(() => {
            if (resolved) return;

            // Don't count stability while tool is executing (waiting for result)
            if (toolInProgress && !toolCompleted) {
                stableCount = 0;
                lastLength = fullResponse.length;
                return;
            }

            // If max iterations reached, resolve quickly with whatever we have
            if (maxIterationsReached) {
                stableCount++;
                if (stableCount >= 2) {  // 1 second grace period
                    // Use allOutput since fullResponse may have been reset
                    finalResponse = extractSpeakableResponse(allOutput);
                    console.log(`[InboxWatcher] Max iterations reached, captured (${allOutput.length} chars) -> speakable: "${finalResponse?.slice(0, 100)}..."`);
                    _devlog('BACKEND', 'response-captured', { text: finalResponse, chars: allOutput.length, reason: 'max-iterations' });
                    finish(finalResponse, 'max-iterations');
                    return;
                }
            }

            // After tool completion, if fullResponse stays empty for too long,
            // the provider likely stopped generating (e.g., hit max iterations)
            if (toolCompleted && fullResponse.length === 0) {
                emptyAfterToolChecks++;
                // After 5 seconds of nothing post-tool, extract from allOutput
                if (emptyAfterToolChecks >= 10) {
                    finalResponse = extractSpeakableResponse(allOutput);
                    console.log(`[InboxWatcher] No follow-up after tool, using full output (${allOutput.length} chars) -> speakable: "${finalResponse?.slice(0, 100)}..."`);
                    _devlog('BACKEND', 'response-captured', { text: finalResponse, chars: allOutput.length, reason: 'no-followup-after-tool' });
                    finish(finalResponse, 'no-followup-after-tool');
                    return;
                }
            }

            const minFollowUpLength = toolCompleted ? 10 : 0;
            if (fullResponse.length === lastLength && fullResponse.length > minFollowUpLength) {
                stableCount++;

                // Determine how many stable checks we need
                // Post-tool: 3 seconds stability (was 4s — too long for slower models)
                let neededChecks = toolCompleted ? requiredStableChecks + 2 : requiredStableChecks;

                // Detect if response contains tool call JSON — if so, wait for
                // the provider's tool loop to pick it up and fire onToolCall
                const elapsed = Date.now() - startTime;
                if (!toolCompleted && !toolInProgress && elapsed < 15000) {
                    const raw = fullResponse.trim();
                    const containsToolJson = raw.includes('"tool"') && raw.includes('"args"');
                    const looksLikePreamble = fullResponse.length < 200 && (
                        /^(sure|ok|okay|closing|searching|let me|i'll|i will|opening|stopping)/i.test(raw)
                        || raw.includes('```')
                    );

                    if (containsToolJson) {
                        // Output contains tool JSON — provider will parse and execute it
                        // Wait for onToolCall to fire (up to 8 seconds)
                        neededChecks = 16;  // 8 seconds
                        if (stableCount === 1) {
                            _devlog('BACKEND', 'stability-wait', { text: raw.slice(0, 100), reason: 'tool-json-detected', neededChecks });
                        }
                    } else if (looksLikePreamble) {
                        // Short text that looks like preamble before a tool call
                        neededChecks = 12;  // 6 seconds
                        if (stableCount === 1) {
                            _devlog('BACKEND', 'stability-wait', { text: raw.slice(0, 80), reason: 'short-preamble-detected', neededChecks });
                        }
                    } else if (fullResponse.length < 80) {
                        // Very short early response — give extra time
                        neededChecks = Math.max(neededChecks, 8);
                    }
                }

                if (stableCount >= neededChecks) {
                    finalResponse = extractSpeakableResponse(fullResponse);

                    // Diagnostic trace: extract speakable
                    try {
                        const dc = require('./diagnostic-collector');
                        if (dc.hasActiveTrace()) {
                            dc.addActiveStage('extract_speakable', {
                                input_length: fullResponse.length,
                                input_preview: fullResponse.substring(0, 500),
                                output_length: finalResponse?.length || 0,
                                output_text: finalResponse || ''
                            });
                        }
                    } catch { /* diagnostic not available */ }

                    console.log(`[InboxWatcher] Captured response (${fullResponse.length} chars) -> speakable: "${finalResponse?.slice(0, 100)}..."`);
                    _devlog('BACKEND', 'response-captured', { text: finalResponse, chars: fullResponse.length, reason: 'stable' });
                    finish(finalResponse, 'stable');
                }
            } else {
                stableCount = 0;
            }
            lastLength = fullResponse.length;
        }, 500);

        function cleanup() {
            provider.emitOutput = originalEmit;
            provider.onToolCall = originalOnToolCall;
            provider.onToolResult = originalOnToolResult;
        }

        // Timeout after 60 seconds (longer to allow for tool execution)
        timeoutHandle = setTimeout(() => {
            if (resolved) return;
            // Use allOutput as fallback if fullResponse was reset and stayed empty
            const source = fullResponse.length > 0 ? fullResponse : allOutput;
            finalResponse = extractSpeakableResponse(source);
            if (finalResponse) {
                console.log(`[InboxWatcher] Timeout captured (${source.length} chars) -> speakable: "${finalResponse?.slice(0, 100)}..."`);
                _devlog('BACKEND', 'response-captured', { text: finalResponse, chars: source.length, reason: 'timeout-fallback' });
            } else {
                console.log(`[InboxWatcher] Timeout with no speakable content. fullResponse=${fullResponse.length} chars, allOutput=${allOutput.length} chars, toolCompleted=${toolCompleted}`);
            }
            finish(finalResponse, 'timeout');
        }, 60000);
    });
}

/**
 * Extract the final speakable response from provider output.
 * Filters out tool JSON, system messages, and intermediate output.
 * Returns only the final natural language response after tool execution.
 * @param {string} output - The full captured output
 * @returns {string} The final response suitable for TTS
 */
function extractSpeakableResponse(output) {
    if (!output) return '';

    // Split by common section markers to find the final response
    // After tool execution, the model typically outputs a natural response
    const sections = output.split(/\[Tool (?:succeeded|failed)\]/i);

    // If we have sections after tool execution, use the last one
    let relevantOutput = sections.length > 1 ? sections[sections.length - 1] : output;

    const lines = relevantOutput.split('\n');
    const speakableLines = [];
    let inCodeBlock = false;

    for (const line of lines) {
        const trimmed = line.trim();

        // Skip empty lines
        if (!trimmed) continue;

        // Track markdown code blocks (skip everything inside them)
        if (trimmed.startsWith('```')) {
            inCodeBlock = !inCodeBlock;
            continue;
        }
        if (inCodeBlock) continue;

        // Skip tool-related system messages
        if (trimmed.startsWith('[Executing tool:') ||
            trimmed.startsWith('[Tool Error:') ||
            trimmed.startsWith('[Max tool iterations') ||
            trimmed.startsWith('Tool "') ||
            trimmed.startsWith('[Tool succeeded]') ||
            trimmed.startsWith('[Tool failed]')) {
            continue;
        }

        // Skip JSON objects (tool calls, raw tool output, etc.)
        if (trimmed.startsWith('{') && trimmed.endsWith('}')) {
            try {
                JSON.parse(trimmed);
                continue; // Valid JSON object — skip it
            } catch {
                // Not valid JSON, keep it
            }
        }

        // Skip lines that look like pre-tool-call announcements
        if (trimmed.match(/I'll (?:search|look|check|use|execute|call)/i) &&
            trimmed.match(/tool|search|web_search/i)) {
            continue;
        }

        // Skip user echo lines (> prefix)
        if (trimmed.startsWith('>')) continue;

        // Skip numbered list items that are just URLs or metadata
        if (trimmed.match(/^\d+\.\s*(https?:|www\.)/)) continue;

        // Keep this line
        speakableLines.push(trimmed);
    }

    // Return the collected speakable content
    const result = speakableLines.join(' ').trim();

    // Clean up the result
    // Remove markdown artifacts and URLs (not speakable)
    let cleaned = result
        .replace(/\*\*/g, '')           // Bold markers
        .replace(/\*/g, '')              // Italic markers
        .replace(/`[^`]+`/g, '')         // Inline code
        .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')  // [text](url) -> just text
        .replace(/<(https?:\/\/[^>]+)>/g, '')     // <url> -> remove entirely
        .replace(/https?:\/\/[^\s)>\]]+/g, '')    // Raw URLs -> remove
        .replace(/www\.[^\s)>\]]+/g, '')          // www. URLs -> remove
        .replace(/#+\s*/g, '')           // Headers
        .replace(/\s*-\s*(?=\s|$)/g, ' ')         // Orphaned dashes from removed URLs
        .replace(/\s+/g, ' ')            // Multiple spaces
        .trim();

    // If the result is still mostly JSON or system output, return empty
    if (cleaned.startsWith('{') && cleaned.endsWith('}')) {
        try {
            JSON.parse(cleaned);
            return '';
        } catch {
            // Not valid JSON, keep it
        }
    }

    return cleaned;
}

/**
 * Strip echoed/quoted user message from AI response.
 * Many models quote the user's message before responding (e.g., "> User's question\n\nResponse")
 * @param {string} response - The AI response text
 * @returns {string} Cleaned response without quoted echo
 */
function stripEchoedContent(response) {
    if (!response) return response;

    // Pattern 1: Lines starting with > (blockquotes)
    // Pattern 2: Lines starting with "User:" or similar
    // Remove leading quoted lines until we hit actual content
    const lines = response.split('\n');
    let startIndex = 0;

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].trim();
        // Skip empty lines, blockquotes, and "User:" prefixes
        if (line === '' || line.startsWith('>') || line.match(/^(user|you|human):/i)) {
            startIndex = i + 1;
        } else {
            break;
        }
    }

    return lines.slice(startIndex).join('\n').trim();
}

/**
 * Write AI response to inbox so Python TTS can speak it.
 * @param {string} dataDir - Path to data directory
 * @param {string} response - The AI response text
 * @param {string} providerName - Display name of the provider
 * @param {string} replyToId - ID of the message being replied to
 */
function writeResponseToInbox(dataDir, response, providerName, replyToId) {
    // Diagnostic trace: response written to inbox
    try {
        const dc = require('./diagnostic-collector');
        if (dc.hasActiveTrace()) {
            dc.addActiveStage('inbox_response', {
                provider: providerName,
                reply_to: replyToId,
                final_text: response,
                final_length: response?.length || 0
            });
        }
    } catch { /* diagnostic not available */ }

    const inboxPath = path.join(dataDir, 'inbox.json');

    let data = { messages: [] };
    if (fs.existsSync(inboxPath)) {
        try {
            data = JSON.parse(fs.readFileSync(inboxPath, 'utf-8'));
            if (!data.messages) data.messages = [];
        } catch {
            data = { messages: [] };
        }
    }

    // Create sender ID from provider name (e.g., "Ollama (qwen-coder)" -> "ollama-qwen-coder")
    const senderId = providerName.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

    const newMessage = {
        id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        from: senderId,
        message: response,
        timestamp: new Date().toISOString(),
        read_by: [],
        reply_to: replyToId,
        thread_id: 'voice-mirror'
    };

    data.messages.push(newMessage);
    fs.writeFileSync(inboxPath, JSON.stringify(data));

    console.log(`[InboxWatcher] Wrote response to inbox from ${senderId}`);
}

module.exports = {
    createInboxWatcher
};
