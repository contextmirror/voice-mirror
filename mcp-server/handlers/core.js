/**
 * Core MCP handlers: claude_send, claude_inbox, claude_listen, claude_status
 * Plus lock/heartbeat helpers.
 */

const fs = require('fs');
const path = require('path');
const {
    HOME_DATA_DIR,
    CLAUDE_MESSAGES_PATH,
    CLAUDE_STATUS_PATH,
    LISTENER_LOCK_PATH,
    STALE_TIMEOUT_MS,
    AUTO_CLEANUP_HOURS,
    LISTENER_LOCK_TIMEOUT_MS
} = require('../paths');

// Setter for autoLoadByIntent — wired by index.js after init
let _autoLoadByIntent = async () => [];

function setAutoLoadByIntent(fn) {
    _autoLoadByIntent = fn;
}

// ============================================
// Lock / Heartbeat Helpers
// ============================================

/**
 * Acquire exclusive listener lock
 * Returns { success: true } or { success: false, lockedBy: string }
 */
function acquireListenerLock(instanceId) {
    try {
        const now = Date.now();

        // Check existing lock
        if (fs.existsSync(LISTENER_LOCK_PATH)) {
            const lock = JSON.parse(fs.readFileSync(LISTENER_LOCK_PATH, 'utf-8'));

            // If lock is still valid and held by another instance, deny
            if (lock.expires_at > now && lock.instance_id !== instanceId) {
                return { success: false, lockedBy: lock.instance_id };
            }
        }

        // Acquire or refresh lock
        const lock = {
            instance_id: instanceId,
            acquired_at: now,
            expires_at: now + LISTENER_LOCK_TIMEOUT_MS
        };
        fs.writeFileSync(LISTENER_LOCK_PATH, JSON.stringify(lock, null, 2), 'utf-8');

        return { success: true };
    } catch (err) {
        // On error, assume we can acquire (fail open for resilience)
        console.warn('[MCP Core] acquireListenerLock failed, proceeding anyway:', err?.message || err);
        return { success: true };
    }
}

/**
 * Release listener lock
 */
function releaseListenerLock(instanceId) {
    try {
        if (fs.existsSync(LISTENER_LOCK_PATH)) {
            const lock = JSON.parse(fs.readFileSync(LISTENER_LOCK_PATH, 'utf-8'));

            // Only release if we own the lock
            if (lock.instance_id === instanceId) {
                fs.unlinkSync(LISTENER_LOCK_PATH);
            }
        }
    } catch (e) {
        console.error('[MCP Core]', 'Failed to release listener lock:', e?.message || e);
    }
}

/**
 * Refresh listener lock (extend timeout)
 */
function refreshListenerLock(instanceId) {
    try {
        if (fs.existsSync(LISTENER_LOCK_PATH)) {
            const lock = JSON.parse(fs.readFileSync(LISTENER_LOCK_PATH, 'utf-8'));

            if (lock.instance_id === instanceId) {
                lock.expires_at = Date.now() + LISTENER_LOCK_TIMEOUT_MS;
                fs.writeFileSync(LISTENER_LOCK_PATH, JSON.stringify(lock, null, 2), 'utf-8');
            }
        }
    } catch (e) {
        console.error('[MCP Core]', 'Failed to refresh listener lock:', e?.message || e);
    }
}

/**
 * Update heartbeat for presence tracking
 */
function updateHeartbeat(instanceId, status = 'active', currentTask) {
    try {
        let store = { statuses: [] };
        if (fs.existsSync(CLAUDE_STATUS_PATH)) {
            store = JSON.parse(fs.readFileSync(CLAUDE_STATUS_PATH, 'utf-8'));
        }

        const now = new Date().toISOString();
        const existingIndex = store.statuses.findIndex(s => s.instance_id === instanceId);

        const newStatus = {
            instance_id: instanceId,
            status,
            current_task: currentTask,
            last_heartbeat: now
        };

        if (existingIndex >= 0) {
            store.statuses[existingIndex] = newStatus;
        } else {
            store.statuses.push(newStatus);
        }

        fs.writeFileSync(CLAUDE_STATUS_PATH, JSON.stringify(store, null, 2), 'utf-8');
    } catch (e) {
        console.error('[MCP Core]', 'Failed to update heartbeat:', e?.message || e);
    }
}

// ============================================
// Tool Handlers
// ============================================

/**
 * claude_send - Send message to inbox
 */
async function handleClaudeSend(args) {
    try {
        const instanceId = args?.instance_id;
        const message = args?.message;
        const threadId = args?.thread_id;
        const replyTo = args?.reply_to;

        if (!instanceId || !message) {
            return {
                content: [{ type: 'text', text: 'Error: instance_id and message are required' }],
                isError: true
            };
        }

        updateHeartbeat(instanceId, 'active', 'Sending message');

        // Load existing messages
        let messages = [];
        if (fs.existsSync(CLAUDE_MESSAGES_PATH)) {
            try {
                const data = JSON.parse(fs.readFileSync(CLAUDE_MESSAGES_PATH, 'utf-8'));
                messages = data.messages || [];
            } catch (e) {
                console.error('[MCP Core]', 'Failed to read existing messages:', e?.message || e);
            }
        }

        // Resolve thread ID
        let resolvedThreadId = threadId;
        if (!resolvedThreadId && replyTo) {
            const parent = messages.find(m => m.id === replyTo);
            if (parent?.thread_id) resolvedThreadId = parent.thread_id;
        }
        if (!resolvedThreadId) {
            // Default to "voice-mirror" for voice instances to ensure watchers pick up messages
            if (instanceId === 'voice-claude') {
                resolvedThreadId = 'voice-mirror';
            } else {
                resolvedThreadId = `thread_${Date.now()}`;
            }
        }

        // Create new message
        const newMessage = {
            id: `msg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
            from: instanceId,
            message: message,
            timestamp: new Date().toISOString(),
            read_by: [],
            thread_id: resolvedThreadId,
            reply_to: replyTo || null
        };
        messages.push(newMessage);

        // Keep last 100 messages
        if (messages.length > 100) {
            messages = messages.slice(-100);
        }

        fs.writeFileSync(CLAUDE_MESSAGES_PATH, JSON.stringify({ messages }, null, 2), 'utf-8');

        // Create trigger file for Voice Mirror notification
        const triggerPath = path.join(HOME_DATA_DIR, 'claude_message_trigger.json');
        fs.writeFileSync(triggerPath, JSON.stringify({
            from: instanceId,
            messageId: newMessage.id,
            timestamp: newMessage.timestamp,
            thread_id: resolvedThreadId
        }, null, 2), 'utf-8');

        return {
            content: [{
                type: 'text',
                text: `Message sent in thread [${resolvedThreadId}]:\n"${message.slice(0, 100)}${message.length > 100 ? '...' : ''}"`
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * claude_inbox - Read messages from inbox
 */
async function handleClaudeInbox(args) {
    try {
        const instanceId = args?.instance_id;
        const limit = args?.limit || 10;
        const includeRead = args?.include_read || false;
        const markAsRead = args?.mark_as_read || false;

        if (!instanceId) {
            return {
                content: [{ type: 'text', text: 'Error: instance_id is required' }],
                isError: true
            };
        }

        updateHeartbeat(instanceId, 'active', 'Checking inbox');

        if (!fs.existsSync(CLAUDE_MESSAGES_PATH)) {
            return {
                content: [{ type: 'text', text: 'No messages in inbox.' }]
            };
        }

        let data = JSON.parse(fs.readFileSync(CLAUDE_MESSAGES_PATH, 'utf-8'));
        let allMessages = data.messages || [];

        // Auto-cleanup old messages
        const cutoff = Date.now() - (AUTO_CLEANUP_HOURS * 60 * 60 * 1000);
        allMessages = allMessages.filter(m => new Date(m.timestamp).getTime() > cutoff);

        // Filter out own messages
        let inbox = allMessages.filter(m => m.from !== instanceId);

        // Filter by read status
        if (!includeRead) {
            inbox = inbox.filter(m => {
                const readBy = m.read_by || [];
                return !readBy.includes(instanceId);
            });
        }

        // Mark as read if requested
        if (markAsRead) {
            for (const msg of allMessages) {
                if (msg.from === instanceId) continue;
                if (!msg.read_by) msg.read_by = [];
                if (!msg.read_by.includes(instanceId)) {
                    msg.read_by.push(instanceId);
                }
            }
            fs.writeFileSync(CLAUDE_MESSAGES_PATH, JSON.stringify({ messages: allMessages }, null, 2), 'utf-8');
        }

        // Apply limit
        inbox = inbox.slice(-limit);

        if (inbox.length === 0) {
            return {
                content: [{ type: 'text', text: 'No new messages.' }]
            };
        }

        // Auto-load tool groups based on message intent
        for (const msg of inbox) {
            await _autoLoadByIntent(msg.message);
        }

        const formatted = inbox.map(m => {
            const time = new Date(m.timestamp).toLocaleTimeString();
            let text = `[${time}] [${m.from}] (id: ${m.id}):\n${m.message}`;
            if (m.image_path) {
                text += `\n[Attached image: ${m.image_path}]`;
            }
            return text;
        }).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `=== Inbox (${inbox.length} message(s)) ===\n\n${formatted}`
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * claude_listen - Wait for messages from a specific sender
 * Uses exclusive locking to ensure only ONE Claude instance can listen at a time.
 */
async function handleClaudeListen(args) {
    let lockAcquired = false;

    try {
        const instanceId = args?.instance_id;
        const fromSender = args?.from_sender;
        const threadFilter = args?.thread_id;
        const timeoutSeconds = Math.min(args?.timeout_seconds || 300, 600);

        if (!instanceId || !fromSender) {
            return {
                content: [{ type: 'text', text: 'Error: instance_id and from_sender are required' }],
                isError: true
            };
        }

        // Try to acquire exclusive listener lock
        const lockResult = acquireListenerLock(instanceId);
        if (!lockResult.success) {
            return {
                content: [{
                    type: 'text',
                    text: `Cannot listen: Another Claude instance (${lockResult.lockedBy}) is already listening.\n` +
                          `Only one listener is allowed to prevent duplicate responses.`
                }],
                isError: true
            };
        }
        lockAcquired = true;

        updateHeartbeat(instanceId, 'active', `Listening for ${fromSender}`);

        const startTime = Date.now();
        const timeoutMs = timeoutSeconds * 1000;
        const lockRefreshIntervalMs = 30000;  // Refresh lock every 30s
        let lastLockRefresh = Date.now();

        // Capture existing message IDs
        const existingIds = new Set();
        try {
            if (fs.existsSync(CLAUDE_MESSAGES_PATH)) {
                const data = JSON.parse(fs.readFileSync(CLAUDE_MESSAGES_PATH, 'utf-8'));
                (data.messages || []).forEach(m => existingIds.add(m.id));
            }
        } catch (e) {
            console.error('[MCP Core]', 'Failed to load existing message IDs:', e?.message || e);
        }

        // Helper: check inbox for new messages from sender
        function checkForNewMessages() {
            try {
                if (!fs.existsSync(CLAUDE_MESSAGES_PATH)) return null;
                const data = JSON.parse(fs.readFileSync(CLAUDE_MESSAGES_PATH, 'utf-8'));
                const messages = data.messages || [];
                let fromSenderMsgs = messages.filter(m => m.from.toLowerCase() === fromSender.toLowerCase());
                if (threadFilter) {
                    fromSenderMsgs = fromSenderMsgs.filter(m => m.thread_id === threadFilter);
                }
                const newMsgs = fromSenderMsgs.filter(m => !existingIds.has(m.id));
                return newMsgs.length > 0 ? newMsgs[newMsgs.length - 1] : null;
            } catch (e) {
                console.error('[MCP Core]', 'Failed to check for new messages:', e?.message || e);
                return null;
            }
        }

        // Use fs.watch to wake on file changes instead of 500ms polling
        const inboxDir = path.dirname(CLAUDE_MESSAGES_PATH);
        const inboxFilename = path.basename(CLAUDE_MESSAGES_PATH);
        let fileWatcher = null;

        try {
            // Wait for new messages using fs.watch + lock refresh interval
            while (Date.now() - startTime < timeoutMs) {
                // Periodically refresh lock to keep it valid during long listens
                if (Date.now() - lastLockRefresh > lockRefreshIntervalMs) {
                    refreshListenerLock(instanceId);
                    lastLockRefresh = Date.now();
                }

                // Wait for file change or timeout (check every 5s as fallback)
                const remainingMs = Math.min(timeoutMs - (Date.now() - startTime), 5000);
                await new Promise((resolve) => {
                    const timer = setTimeout(resolve, remainingMs);
                    try {
                        fileWatcher = fs.watch(inboxDir, (eventType, filename) => {
                            if (filename === inboxFilename) {
                                clearTimeout(timer);
                                try { fileWatcher.close(); } catch {}
                                fileWatcher = null;
                                resolve();
                            }
                        });
                        fileWatcher.on('error', () => {
                            // fs.watch failed, fall through to timeout
                        });
                    } catch (e) {
                        console.error('[MCP Core]', 'Failed to set up fs.watch, using polling fallback:', e?.message || e);
                    }
                });

                // Clean up watcher if still open
                if (fileWatcher) { try { fileWatcher.close(); } catch {} fileWatcher = null; }

                const latest = checkForNewMessages();
                if (latest) {
                    const waitTime = Math.round((Date.now() - startTime) / 1000);

                    // Auto-load tool groups based on message intent
                    await _autoLoadByIntent(latest.message);

                    // Release lock before returning
                    releaseListenerLock(instanceId);

                    // Build response text
                    let responseText = `=== Message from ${fromSender} (after ${waitTime}s) ===\n` +
                                       `Thread: ${latest.thread_id || 'none'}\n` +
                                       `Time: ${latest.timestamp}\n` +
                                       `ID: ${latest.id}\n`;

                    if (latest.image_path) {
                        responseText += `Image: ${latest.image_path}\n`;
                    }

                    responseText += `\n${latest.message}`;

                    if (latest.image_path) {
                        responseText += `\n\n[Attached image at: ${latest.image_path} - use the Read tool to view it]`;
                    }

                    return {
                        content: [{
                            type: 'text',
                            text: responseText
                        }]
                    };
                }
            }
        } finally {
            // Ensure watcher is closed on any exit path
            if (fileWatcher) { try { fileWatcher.close(); } catch {} }
        }

        // Release lock on timeout
        releaseListenerLock(instanceId);

        return {
            content: [{
                type: 'text',
                text: `Timeout: No message from ${fromSender} after ${timeoutSeconds}s.`
            }]
        };
    } catch (err) {
        // Release lock on error
        if (lockAcquired) {
            releaseListenerLock(args?.instance_id);
        }
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * claude_status - Presence tracking
 */
async function handleClaudeStatus(args) {
    try {
        const instanceId = args?.instance_id;
        const action = args?.action || 'update';
        const status = args?.status || 'active';
        const currentTask = args?.current_task;

        if (!instanceId) {
            return {
                content: [{ type: 'text', text: 'Error: instance_id is required' }],
                isError: true
            };
        }

        if (action === 'list') {
            if (!fs.existsSync(CLAUDE_STATUS_PATH)) {
                return {
                    content: [{ type: 'text', text: 'No active instances.' }]
                };
            }

            const store = JSON.parse(fs.readFileSync(CLAUDE_STATUS_PATH, 'utf-8'));
            const now = Date.now();

            const formatted = store.statuses.map(s => {
                const lastHB = new Date(s.last_heartbeat).getTime();
                const isStale = (now - lastHB) > STALE_TIMEOUT_MS;
                const staleIndicator = isStale ? ' [STALE]' : '';
                return `[${s.instance_id}] ${s.status}${staleIndicator} - ${s.current_task || 'idle'}`;
            }).join('\n');

            return {
                content: [{ type: 'text', text: `=== Claude Instances ===\n\n${formatted}` }]
            };
        }

        // Update status
        updateHeartbeat(instanceId, status, currentTask);

        return {
            content: [{
                type: 'text',
                text: `Status updated: [${instanceId}] ${status}${currentTask ? ` - ${currentTask}` : ''}`
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

module.exports = {
    setAutoLoadByIntent,
    handleClaudeSend,
    handleClaudeInbox,
    handleClaudeListen,
    handleClaudeStatus
};
