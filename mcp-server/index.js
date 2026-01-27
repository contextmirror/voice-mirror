#!/usr/bin/env node
/**
 * Voice Mirror Electron - MCP Server
 *
 * Stripped-down MCP server based on Context Mirror's claude.ts handlers.
 * Provides tools for Claude Code to interact with Voice Mirror:
 * - claude_send: Send messages to the inbox
 * - claude_inbox: Read messages from inbox
 * - claude_listen: Wait for voice messages from user
 * - claude_status: Presence tracking
 * - capture_screen: Request screenshot from Electron
 *
 * Uses the same message format as Context Mirror for compatibility.
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');
const path = require('path');
const os = require('os');

// Memory system (lazy loaded)
const { getMemoryManager } = require('./lib/memory/MemoryManager');

// Paths (Voice Mirror standalone - NOT Context Mirror)
const HOME_DATA_DIR = path.join(os.homedir(), '.config', 'voice-mirror-electron', 'data');
const CLAUDE_MESSAGES_PATH = path.join(HOME_DATA_DIR, 'inbox.json');
const CLAUDE_STATUS_PATH = path.join(HOME_DATA_DIR, 'status.json');

// Constants
const STALE_TIMEOUT_MS = 2 * 60 * 1000;  // 2 minutes
const AUTO_CLEANUP_HOURS = 24;
const LISTENER_LOCK_TIMEOUT_MS = 70 * 1000;  // Lock expires after 70s (slightly longer than default 60s listen timeout)

// Lock file for exclusive listener
const LISTENER_LOCK_PATH = path.join(HOME_DATA_DIR, 'listener_lock.json');

// Ensure directory exists
if (!fs.existsSync(HOME_DATA_DIR)) {
    fs.mkdirSync(HOME_DATA_DIR, { recursive: true });
}

// Clean up any stale listener lock from previous crashes
if (fs.existsSync(LISTENER_LOCK_PATH)) {
    try {
        const lock = JSON.parse(fs.readFileSync(LISTENER_LOCK_PATH, 'utf-8'));
        if (lock.expires_at < Date.now()) {
            fs.unlinkSync(LISTENER_LOCK_PATH);
            console.error('[MCP] Cleaned up stale listener lock');
        }
    } catch {
        // If we can't read it, remove it
        fs.unlinkSync(LISTENER_LOCK_PATH);
    }
}

// Create MCP server
const server = new Server(
    {
        name: 'voice-mirror-electron',
        version: '1.0.0'
    },
    {
        capabilities: {
            tools: {}
        }
    }
);

// Tool definitions (matching Context Mirror's format)
const TOOLS = [
    {
        name: 'claude_send',
        description: 'Send a message to the Voice Mirror inbox. Use this to respond to voice queries - your message will be spoken aloud.',
        inputSchema: {
            type: 'object',
            properties: {
                instance_id: {
                    type: 'string',
                    description: 'Your instance ID (use "voice-claude" for Voice Mirror)'
                },
                message: {
                    type: 'string',
                    description: 'The message to send (will be spoken via TTS)'
                },
                thread_id: {
                    type: 'string',
                    description: 'Optional thread ID for grouping messages'
                },
                reply_to: {
                    type: 'string',
                    description: 'Optional message ID this replies to'
                }
            },
            required: ['instance_id', 'message']
        }
    },
    {
        name: 'claude_inbox',
        description: 'Read messages from the Voice Mirror inbox. Voice queries from the user appear here.',
        inputSchema: {
            type: 'object',
            properties: {
                instance_id: {
                    type: 'string',
                    description: 'Your instance ID'
                },
                limit: {
                    type: 'number',
                    description: 'Max messages to return (default: 10)'
                },
                include_read: {
                    type: 'boolean',
                    description: 'Include already-read messages (default: false)'
                },
                mark_as_read: {
                    type: 'boolean',
                    description: 'Mark messages as read after viewing'
                }
            },
            required: ['instance_id']
        }
    },
    {
        name: 'claude_listen',
        description: 'Wait for new voice messages from the user. Blocks until a message arrives or timeout. This is the primary way to receive voice input.',
        inputSchema: {
            type: 'object',
            properties: {
                instance_id: {
                    type: 'string',
                    description: 'Your instance ID'
                },
                from_sender: {
                    type: 'string',
                    description: 'Sender to listen for (use "nathan" for voice input)'
                },
                thread_id: {
                    type: 'string',
                    description: 'Optional thread filter'
                },
                timeout_seconds: {
                    type: 'number',
                    description: 'Max wait time (default: 60, max: 600)'
                }
            },
            required: ['instance_id', 'from_sender']
        }
    },
    {
        name: 'claude_status',
        description: 'Update or list Claude instance status for presence tracking.',
        inputSchema: {
            type: 'object',
            properties: {
                instance_id: {
                    type: 'string',
                    description: 'Your instance ID'
                },
                action: {
                    type: 'string',
                    enum: ['update', 'list'],
                    description: 'Action to perform'
                },
                status: {
                    type: 'string',
                    enum: ['active', 'idle'],
                    description: 'Your current status'
                },
                current_task: {
                    type: 'string',
                    description: 'What you are working on'
                }
            },
            required: ['instance_id']
        }
    },
    {
        name: 'capture_screen',
        description: 'Capture a screenshot of the user\'s screen for visual analysis.',
        inputSchema: {
            type: 'object',
            properties: {
                display: {
                    type: 'number',
                    description: 'Display index (default: 0)'
                }
            }
        }
    },
    // Memory System Tools
    {
        name: 'memory_search',
        description: 'Search Voice Mirror memories using hybrid semantic + keyword search. Use this before answering questions about past conversations, user preferences, or previous decisions.',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'What to search for in memories'
                },
                max_results: {
                    type: 'number',
                    description: 'Maximum results to return (default: 5)'
                },
                min_score: {
                    type: 'number',
                    description: 'Minimum relevance score 0-1 (default: 0.3)'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'memory_get',
        description: 'Get full content of a memory chunk or file. Use after memory_search to read complete context.',
        inputSchema: {
            type: 'object',
            properties: {
                path: {
                    type: 'string',
                    description: 'File path or chunk ID from search results'
                },
                from_line: {
                    type: 'number',
                    description: 'Start reading from this line (optional)'
                },
                lines: {
                    type: 'number',
                    description: 'Number of lines to read (optional)'
                }
            },
            required: ['path']
        }
    },
    {
        name: 'memory_remember',
        description: 'Store a persistent memory. Use to save important information about the user, preferences, or decisions.',
        inputSchema: {
            type: 'object',
            properties: {
                content: {
                    type: 'string',
                    description: 'What to remember'
                },
                tier: {
                    type: 'string',
                    enum: ['core', 'stable', 'notes'],
                    description: 'Memory tier: core=permanent, stable=7 days, notes=temporary'
                }
            },
            required: ['content']
        }
    },
    {
        name: 'memory_forget',
        description: 'Delete a memory by content or chunk ID.',
        inputSchema: {
            type: 'object',
            properties: {
                content_or_id: {
                    type: 'string',
                    description: 'Memory content to match, or chunk_* ID'
                }
            },
            required: ['content_or_id']
        }
    },
    {
        name: 'memory_stats',
        description: 'Get memory system statistics including storage, index, and embedding info.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    // Voice Cloning Tools
    {
        name: 'clone_voice',
        description: 'Clone a voice from an audio sample for TTS. Provide either a URL to download or a local file path. The audio will be processed (converted to WAV, trimmed to ~3s) and used for voice synthesis. Requires Qwen3-TTS adapter.',
        inputSchema: {
            type: 'object',
            properties: {
                audio_url: {
                    type: 'string',
                    description: 'URL to download audio from (YouTube, direct audio links, etc.)'
                },
                audio_path: {
                    type: 'string',
                    description: 'Local file path to an audio file'
                },
                voice_name: {
                    type: 'string',
                    description: 'Name for this voice clone (default: "custom")'
                },
                transcript: {
                    type: 'string',
                    description: 'Optional transcript of what is said in the audio. If not provided, will auto-transcribe using STT.'
                }
            }
        }
    },
    {
        name: 'clear_voice_clone',
        description: 'Clear the current voice clone and return to using preset speaker voices.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    {
        name: 'list_voice_clones',
        description: 'List all saved voice clones.',
        inputSchema: {
            type: 'object',
            properties: {}
        }
    },
    // Browser Control Tools (CDP agent browser)
    {
        name: 'browser_start',
        description: 'Launch a managed Chrome browser instance with CDP debugging enabled. Call this before using other browser control tools.',
        inputSchema: {
            type: 'object',
            properties: {
                profile: { type: 'string', description: 'Browser profile name (default: "default")' }
            }
        }
    },
    {
        name: 'browser_stop',
        description: 'Stop the managed Chrome browser instance.',
        inputSchema: {
            type: 'object',
            properties: {
                profile: { type: 'string', description: 'Browser profile name' }
            }
        }
    },
    {
        name: 'browser_status',
        description: 'Get the status of the browser (running, CDP ready, tab count).',
        inputSchema: {
            type: 'object',
            properties: {
                profile: { type: 'string', description: 'Browser profile name' }
            }
        }
    },
    {
        name: 'browser_tabs',
        description: 'List all open browser tabs with their targetId, title, and URL.',
        inputSchema: {
            type: 'object',
            properties: {
                profile: { type: 'string', description: 'Browser profile name' }
            }
        }
    },
    {
        name: 'browser_open',
        description: 'Open a new browser tab with the given URL.',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to open' },
                profile: { type: 'string', description: 'Browser profile name' }
            },
            required: ['url']
        }
    },
    {
        name: 'browser_close_tab',
        description: 'Close a browser tab by its targetId.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: { type: 'string', description: 'Target ID of the tab to close' },
                profile: { type: 'string', description: 'Browser profile name' }
            },
            required: ['targetId']
        }
    },
    {
        name: 'browser_focus',
        description: 'Focus/activate a browser tab by its targetId.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: { type: 'string', description: 'Target ID of the tab to focus' },
                profile: { type: 'string', description: 'Browser profile name' }
            },
            required: ['targetId']
        }
    },
    {
        name: 'browser_navigate',
        description: 'Navigate a browser tab to a new URL.',
        inputSchema: {
            type: 'object',
            properties: {
                url: { type: 'string', description: 'URL to navigate to' },
                targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' },
                profile: { type: 'string', description: 'Browser profile name' }
            },
            required: ['url']
        }
    },
    {
        name: 'browser_screenshot',
        description: 'Take a screenshot of a browser tab. Returns the screenshot as a base64 image.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' },
                fullPage: { type: 'boolean', description: 'Capture full page (default: false)' },
                ref: { type: 'string', description: 'Element ref (e1, e2...) to screenshot' },
                profile: { type: 'string', description: 'Browser profile name' }
            }
        }
    },
    {
        name: 'browser_snapshot',
        description: 'Take an accessibility snapshot of a browser tab. Returns the page structure with element refs (e1, e2...) that can be used with browser_act.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' },
                format: { type: 'string', enum: ['role', 'aria', 'ai'], description: 'Snapshot format (default: role)' },
                interactive: { type: 'boolean', description: 'Only show interactive elements' },
                compact: { type: 'boolean', description: 'Remove unnamed structural elements' },
                selector: { type: 'string', description: 'CSS selector to scope snapshot' },
                profile: { type: 'string', description: 'Browser profile name' }
            }
        }
    },
    {
        name: 'browser_act',
        description: 'Execute an action on a browser page element. Use refs from browser_snapshot (e.g. e1, e2). Actions: click, type, fill, hover, press, select, drag, evaluate, wait, upload, resize.',
        inputSchema: {
            type: 'object',
            properties: {
                request: {
                    type: 'object',
                    description: 'Action request: {kind: "click"|"type"|"fill"|"hover"|"press"|"select"|"drag"|"evaluate"|"wait"|"upload"|"resize", ref?: "e1", text?: "...", ...}',
                    properties: {
                        kind: { type: 'string', description: 'Action type' },
                        ref: { type: 'string', description: 'Element ref from snapshot' },
                        text: { type: 'string', description: 'Text to type/fill' },
                        key: { type: 'string', description: 'Key to press (e.g. "Enter")' },
                        expression: { type: 'string', description: 'JS expression for evaluate' },
                        selector: { type: 'string', description: 'CSS selector (alternative to ref)' },
                        value: { type: 'string', description: 'Value for select' },
                        startRef: { type: 'string', description: 'Drag start ref' },
                        endRef: { type: 'string', description: 'Drag end ref' }
                    },
                    required: ['kind']
                },
                targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' },
                profile: { type: 'string', description: 'Browser profile name' }
            },
            required: ['request']
        }
    },
    {
        name: 'browser_console',
        description: 'Get console logs and errors from a browser tab.',
        inputSchema: {
            type: 'object',
            properties: {
                targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' },
                profile: { type: 'string', description: 'Browser profile name' }
            }
        }
    },
    // Browser Tools (headless Playwright — search/fetch)
    {
        name: 'browser_search',
        description: 'Search Google using a headless browser. Returns parsed search results. Unlimited searches (no API limits).',
        inputSchema: {
            type: 'object',
            properties: {
                query: {
                    type: 'string',
                    description: 'The search query'
                },
                max_results: {
                    type: 'number',
                    description: 'Maximum results to return (default: 5, max: 10)'
                }
            },
            required: ['query']
        }
    },
    {
        name: 'browser_fetch',
        description: 'Fetch and extract text content from a URL using a headless browser. Handles JavaScript-rendered pages. Returns clean text content.',
        inputSchema: {
            type: 'object',
            properties: {
                url: {
                    type: 'string',
                    description: 'The URL to fetch'
                },
                timeout: {
                    type: 'number',
                    description: 'Timeout in milliseconds (default: 30000, max: 60000)'
                },
                max_length: {
                    type: 'number',
                    description: 'Maximum content length to return (default: 8000)'
                },
                include_links: {
                    type: 'boolean',
                    description: 'Include links found on the page (default: false)'
                }
            },
            required: ['url']
        }
    }
];

// List tools handler
server.setRequestHandler(ListToolsRequestSchema, async () => {
    return { tools: TOOLS };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    switch (name) {
        case 'claude_send':
            return await handleClaudeSend(args);
        case 'claude_inbox':
            return await handleClaudeInbox(args);
        case 'claude_listen':
            return await handleClaudeListen(args);
        case 'claude_status':
            return await handleClaudeStatus(args);
        case 'capture_screen':
            return handleCaptureScreen(args);
        // Memory tools
        case 'memory_search':
            return await handleMemorySearch(args);
        case 'memory_get':
            return await handleMemoryGet(args);
        case 'memory_remember':
            return await handleMemoryRemember(args);
        case 'memory_forget':
            return await handleMemoryForget(args);
        case 'memory_stats':
            return await handleMemoryStats(args);
        // Voice cloning tools
        case 'clone_voice':
            return await handleCloneVoice(args);
        case 'clear_voice_clone':
            return await handleClearVoiceClone(args);
        case 'list_voice_clones':
            return await handleListVoiceClones(args);
        // Browser control tools (CDP agent browser)
        case 'browser_start':
            return await handleBrowserControl('start', args);
        case 'browser_stop':
            return await handleBrowserControl('stop', args);
        case 'browser_status':
            return await handleBrowserControl('status', args);
        case 'browser_tabs':
            return await handleBrowserControl('tabs', args);
        case 'browser_open':
            return await handleBrowserControl('open', args);
        case 'browser_close_tab':
            return await handleBrowserControl('close_tab', args);
        case 'browser_focus':
            return await handleBrowserControl('focus', args);
        case 'browser_navigate':
            return await handleBrowserControl('navigate', args);
        case 'browser_screenshot':
            return await handleBrowserControl('screenshot', args);
        case 'browser_snapshot':
            return await handleBrowserControl('snapshot', args);
        case 'browser_act':
            return await handleBrowserControl('act', args);
        case 'browser_console':
            return await handleBrowserControl('console', args);
        // Browser search/fetch tools (headless Playwright)
        case 'browser_search':
            return await handleBrowserSearch(args);
        case 'browser_fetch':
            return await handleBrowserFetch(args);
        default:
            return {
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                isError: true
            };
    }
});

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
    } catch {}
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
    } catch {}
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
    } catch {}
}

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
            } catch {}
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
        const timeoutSeconds = Math.min(args?.timeout_seconds || 60, 600);

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
        const pollIntervalMs = 500;
        const lockRefreshIntervalMs = 30000;  // Refresh lock every 30s
        let lastLockRefresh = Date.now();

        // Capture existing message IDs
        const existingIds = new Set();
        try {
            if (fs.existsSync(CLAUDE_MESSAGES_PATH)) {
                const data = JSON.parse(fs.readFileSync(CLAUDE_MESSAGES_PATH, 'utf-8'));
                (data.messages || []).forEach(m => existingIds.add(m.id));
            }
        } catch {}

        while (Date.now() - startTime < timeoutMs) {
            await new Promise(resolve => setTimeout(resolve, pollIntervalMs));

            // Periodically refresh lock to keep it valid during long listens
            if (Date.now() - lastLockRefresh > lockRefreshIntervalMs) {
                refreshListenerLock(instanceId);
                lastLockRefresh = Date.now();
            }

            try {
                if (!fs.existsSync(CLAUDE_MESSAGES_PATH)) continue;

                const data = JSON.parse(fs.readFileSync(CLAUDE_MESSAGES_PATH, 'utf-8'));
                const messages = data.messages || [];

                // Find new messages from sender
                let fromSenderMsgs = messages.filter(m => m.from === fromSender);
                if (threadFilter) {
                    fromSenderMsgs = fromSenderMsgs.filter(m => m.thread_id === threadFilter);
                }
                const newMsgs = fromSenderMsgs.filter(m => !existingIds.has(m.id));

                if (newMsgs.length > 0) {
                    const latest = newMsgs[newMsgs.length - 1];
                    const waitTime = Math.round((Date.now() - startTime) / 1000);

                    // Release lock before returning
                    releaseListenerLock(instanceId);

                    // Build response text
                    let responseText = `=== Message from ${fromSender} (after ${waitTime}s) ===\n` +
                                       `Thread: ${latest.thread_id || 'none'}\n` +
                                       `Time: ${latest.timestamp}\n` +
                                       `ID: ${latest.id}\n`;

                    // Include image path if present
                    if (latest.image_path) {
                        responseText += `Image: ${latest.image_path}\n`;
                    }

                    responseText += `\n${latest.message}`;

                    // If there's an image, tell Claude to read it
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
            } catch {}
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

/**
 * Clean up old screenshots, keeping only the most recent N
 */
function cleanupOldScreenshots(imagesDir, keepCount = 3) {
    try {
        if (!fs.existsSync(imagesDir)) return;

        // Get all screenshot files (various naming patterns)
        const files = fs.readdirSync(imagesDir)
            .filter(f => f.endsWith('.png'))
            .map(f => ({
                name: f,
                path: path.join(imagesDir, f),
                mtime: fs.statSync(path.join(imagesDir, f)).mtime.getTime()
            }))
            .sort((a, b) => b.mtime - a.mtime);  // Sort newest first

        // Delete all but the most recent keepCount files
        if (files.length > keepCount) {
            const toDelete = files.slice(keepCount);
            for (const file of toDelete) {
                fs.unlinkSync(file.path);
                console.error(`[capture_screen] Cleaned up old screenshot: ${file.name}`);
            }
        }
    } catch (err) {
        console.error(`[capture_screen] Cleanup error: ${err.message}`);
    }
}

/**
 * capture_screen - Request screenshot
 * Uses cosmic-screenshot on Cosmic desktop (bypasses permission dialog)
 * Falls back to Electron desktopCapturer on other platforms
 */
async function handleCaptureScreen(args) {
    const { execSync } = require('child_process');
    const imagesDir = path.join(HOME_DATA_DIR, 'images');

    // Ensure images directory exists
    if (!fs.existsSync(imagesDir)) {
        fs.mkdirSync(imagesDir, { recursive: true });
    }

    // Clean up old screenshots before capturing new one (keep last 5)
    cleanupOldScreenshots(imagesDir, 5);

    // Try cosmic-screenshot first (works on Pop!_OS Cosmic without permission dialog)
    try {
        const result = execSync(
            `cosmic-screenshot --interactive=false --modal=false --notify=false --save-dir="${imagesDir}"`,
            { encoding: 'utf-8', timeout: 5000 }
        ).trim();

        // cosmic-screenshot returns the file path on success
        if (result && fs.existsSync(result)) {
            return {
                content: [{
                    type: 'text',
                    text: `Screenshot captured and saved to: ${result}\n` +
                          `You can now analyze this image. The path is: ${result}`
                }]
            };
        }
    } catch (err) {
        // cosmic-screenshot not available or failed, fall back to Electron
        console.error('[capture_screen] cosmic-screenshot failed, falling back to Electron:', err.message);
    }

    // Fallback: Request screenshot from Electron via file-based IPC
    const requestPath = path.join(HOME_DATA_DIR, 'screen_capture_request.json');
    const responsePath = path.join(HOME_DATA_DIR, 'screen_capture_response.json');

    // Delete old response file if exists
    if (fs.existsSync(responsePath)) {
        fs.unlinkSync(responsePath);
    }

    // Write request
    fs.writeFileSync(requestPath, JSON.stringify({
        display: args?.display || 0,
        timestamp: new Date().toISOString()
    }, null, 2));

    // Wait for Electron to capture (up to 10 seconds)
    const startTime = Date.now();
    const timeoutMs = 10000;

    while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 200));

        if (fs.existsSync(responsePath)) {
            try {
                const response = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));

                if (response.success) {
                    return {
                        content: [{
                            type: 'text',
                            text: `Screenshot captured and saved to: ${response.image_path}\n` +
                                  `You can now analyze this image. The path is: ${response.image_path}`
                        }]
                    };
                } else {
                    return {
                        content: [{
                            type: 'text',
                            text: `Screenshot failed: ${response.error}`
                        }],
                        isError: true
                    };
                }
            } catch (err) {
                // Continue waiting
            }
        }
    }

    return {
        content: [{
            type: 'text',
            text: 'Screenshot request timed out. Is the Electron app running?'
        }],
        isError: true
    };
}

// ============================================
// Memory System Handlers
// ============================================

/**
 * memory_search - Hybrid semantic + keyword search
 */
async function handleMemorySearch(args) {
    try {
        const query = args?.query;
        const maxResults = args?.max_results || 5;
        const minScore = args?.min_score || 0.3;

        if (!query) {
            return {
                content: [{ type: 'text', text: 'Error: query is required' }],
                isError: true
            };
        }

        const manager = getMemoryManager();
        const results = await manager.search(query, { maxResults, minScore });

        if (results.length === 0) {
            return {
                content: [{
                    type: 'text',
                    text: `No memories found for: "${query}"`
                }]
            };
        }

        const formatted = results.map((r, i) => {
            const scoreInfo = `[score: ${r.score.toFixed(2)} | vec: ${r.vectorScore.toFixed(2)} | kw: ${r.textScore.toFixed(2)}]`;
            const location = `${r.path}:${r.startLine}-${r.endLine}`;
            const preview = r.text.length > 200 ? r.text.slice(0, 200) + '...' : r.text;
            return `${i + 1}. ${scoreInfo}\n   ID: ${r.id}\n   Location: ${location}\n   ---\n   ${preview.split('\n').join('\n   ')}`;
        }).join('\n\n');

        return {
            content: [{
                type: 'text',
                text: `=== Memory Search: "${query}" ===\nFound ${results.length} result(s)\n\n${formatted}`
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
 * memory_get - Get full content of chunk or file
 */
async function handleMemoryGet(args) {
    try {
        const pathOrId = args?.path;
        const fromLine = args?.from_line;
        const lines = args?.lines;

        if (!pathOrId) {
            return {
                content: [{ type: 'text', text: 'Error: path is required' }],
                isError: true
            };
        }

        const manager = getMemoryManager();
        const result = await manager.get(pathOrId, { fromLine, lines });

        if (result.type === 'chunk') {
            return {
                content: [{
                    type: 'text',
                    text: `=== Chunk: ${result.id} ===\n` +
                          `Path: ${result.path}\n` +
                          `Lines: ${result.startLine}-${result.endLine}\n` +
                          `Tier: ${result.tier}\n` +
                          `---\n${result.text}`
                }]
            };
        } else if (result.type === 'file_excerpt') {
            return {
                content: [{
                    type: 'text',
                    text: `=== File Excerpt: ${result.path} ===\n` +
                          `From line ${result.fromLine} (${result.lines} lines)\n` +
                          `---\n${result.content}`
                }]
            };
        } else {
            return {
                content: [{
                    type: 'text',
                    text: `=== File: ${result.path} ===\n` +
                          `Size: ${result.size} bytes\n` +
                          `Hash: ${result.hash.slice(0, 8)}...\n` +
                          `---\n${result.content}`
                }]
            };
        }
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * memory_remember - Store a new memory
 */
async function handleMemoryRemember(args) {
    try {
        const content = args?.content;
        const tier = args?.tier || 'stable';

        if (!content) {
            return {
                content: [{ type: 'text', text: 'Error: content is required' }],
                isError: true
            };
        }

        if (!['core', 'stable', 'notes'].includes(tier)) {
            return {
                content: [{ type: 'text', text: 'Error: tier must be core, stable, or notes' }],
                isError: true
            };
        }

        const manager = getMemoryManager();
        const result = await manager.remember(content, tier);

        return {
            content: [{
                type: 'text',
                text: `Memory saved to ${tier} tier:\n"${result.content}"`
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
 * memory_forget - Delete a memory
 */
async function handleMemoryForget(args) {
    try {
        const contentOrId = args?.content_or_id;

        if (!contentOrId) {
            return {
                content: [{ type: 'text', text: 'Error: content_or_id is required' }],
                isError: true
            };
        }

        const manager = getMemoryManager();
        const result = await manager.forget(contentOrId);

        if (result.success) {
            return {
                content: [{
                    type: 'text',
                    text: `Memory deleted:\n"${result.content}"`
                }]
            };
        } else {
            return {
                content: [{
                    type: 'text',
                    text: `Memory not found: "${result.content}"`
                }]
            };
        }
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * memory_stats - Get memory system statistics
 */
async function handleMemoryStats(args) {
    try {
        const manager = getMemoryManager();
        const stats = await manager.getStats();

        const output = [
            '=== Voice Mirror Memory Stats ===',
            '',
            '## Storage',
            `Memory file: ${stats.storage.memoryFile}`,
            `Daily logs: ${stats.storage.dailyLogs} files`,
            `Total conversations: ${stats.storage.conversations}`,
            `Memories: ${stats.storage.memories.total} (core: ${stats.storage.memories.core}, stable: ${stats.storage.memories.stable}, notes: ${stats.storage.memories.notes})`,
            '',
            '## Index',
            `Database: ${stats.index.dbPath}`,
            `Total chunks: ${stats.index.totalChunks}`,
            `Indexed files: ${stats.index.totalFiles}`,
            `Cached embeddings: ${stats.index.cachedEmbeddings}`,
            `FTS available: ${stats.index.ftsAvailable}`,
            '',
            '## Embedding',
            stats.embedding
                ? `Provider: ${stats.embedding.provider}/${stats.embedding.model} (${stats.embedding.dimensions} dims)`
                : 'Provider: none (keyword search only)',
            '',
            '## Config',
            `Chunking: ${stats.config.chunking.tokens} tokens, ${stats.config.chunking.overlap} overlap`,
            `Search: ${stats.config.search.vectorWeight * 100}% vector + ${stats.config.search.textWeight * 100}% keyword`
        ].join('\n');

        return {
            content: [{ type: 'text', text: output }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

// ============================================
// Voice Cloning Handlers
// ============================================

const VOICES_DIR = path.join(HOME_DATA_DIR, 'voices');
const VOICE_CLONE_REQUEST_PATH = path.join(HOME_DATA_DIR, 'voice_clone_request.json');
const VOICE_CLONE_RESPONSE_PATH = path.join(HOME_DATA_DIR, 'voice_clone_response.json');

// Ensure voices directory exists
if (!fs.existsSync(VOICES_DIR)) {
    fs.mkdirSync(VOICES_DIR, { recursive: true });
}

/**
 * clone_voice - Clone a voice from audio sample
 * Uses file-based IPC to communicate with Python voice agent
 */
async function handleCloneVoice(args) {
    const { execSync } = require('child_process');

    try {
        const audioUrl = args?.audio_url;
        const audioPath = args?.audio_path;
        const voiceName = args?.voice_name || 'custom';
        const transcript = args?.transcript;

        if (!audioUrl && !audioPath) {
            return {
                content: [{ type: 'text', text: 'Error: Either audio_url or audio_path is required' }],
                isError: true
            };
        }

        let sourceAudioPath = audioPath;
        let downloadedFile = null;

        // Download audio if URL provided
        if (audioUrl) {
            console.error(`[clone_voice] Downloading audio from: ${audioUrl}`);
            const downloadPath = path.join(VOICES_DIR, `download_${Date.now()}.tmp`);

            try {
                // Try yt-dlp first (handles YouTube, SoundCloud, etc.)
                if (audioUrl.includes('youtube.com') || audioUrl.includes('youtu.be') ||
                    audioUrl.includes('soundcloud.com') || audioUrl.includes('vimeo.com')) {
                    execSync(
                        `yt-dlp -x --audio-format wav -o "${downloadPath}.%(ext)s" "${audioUrl}"`,
                        { encoding: 'utf-8', timeout: 60000 }
                    );
                    // Find the downloaded file
                    const files = fs.readdirSync(VOICES_DIR).filter(f => f.startsWith(`download_${downloadPath.split('_').pop()}`));
                    if (files.length > 0) {
                        sourceAudioPath = path.join(VOICES_DIR, files[0]);
                        downloadedFile = sourceAudioPath;
                    }
                } else {
                    // Direct download with curl/wget
                    execSync(`curl -L -o "${downloadPath}" "${audioUrl}"`, { timeout: 30000 });
                    sourceAudioPath = downloadPath;
                    downloadedFile = downloadPath;
                }
            } catch (dlErr) {
                return {
                    content: [{ type: 'text', text: `Failed to download audio: ${dlErr.message}` }],
                    isError: true
                };
            }
        }

        // Verify source file exists
        if (!fs.existsSync(sourceAudioPath)) {
            return {
                content: [{ type: 'text', text: `Audio file not found: ${sourceAudioPath}` }],
                isError: true
            };
        }

        // Process audio: convert to WAV 16kHz mono, trim to 3 seconds
        const processedPath = path.join(VOICES_DIR, `${voiceName}_processed.wav`);
        console.error(`[clone_voice] Processing audio to: ${processedPath}`);

        try {
            // Use ffmpeg to:
            // 1. Convert to WAV
            // 2. Resample to 16kHz
            // 3. Convert to mono
            // 4. Trim to first 3-10 seconds (or find best segment)
            // 5. Normalize audio
            execSync(
                `ffmpeg -y -i "${sourceAudioPath}" -ar 16000 -ac 1 -t 5 -af "silenceremove=1:0:-50dB,loudnorm" "${processedPath}"`,
                { encoding: 'utf-8', timeout: 30000 }
            );
        } catch (ffmpegErr) {
            // Clean up downloaded file
            if (downloadedFile && fs.existsSync(downloadedFile)) {
                fs.unlinkSync(downloadedFile);
            }
            return {
                content: [{ type: 'text', text: `Failed to process audio with ffmpeg: ${ffmpegErr.message}` }],
                isError: true
            };
        }

        // Clean up downloaded file (keep processed file)
        if (downloadedFile && fs.existsSync(downloadedFile) && downloadedFile !== processedPath) {
            fs.unlinkSync(downloadedFile);
        }

        // Delete old response file if exists
        if (fs.existsSync(VOICE_CLONE_RESPONSE_PATH)) {
            fs.unlinkSync(VOICE_CLONE_RESPONSE_PATH);
        }

        // Write request for Python voice agent
        const request = {
            action: 'clone',
            audio_path: processedPath,
            voice_name: voiceName,
            transcript: transcript || null,  // null = auto-transcribe
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(VOICE_CLONE_REQUEST_PATH, JSON.stringify(request, null, 2), 'utf-8');
        console.error(`[clone_voice] Request written, waiting for Python response...`);

        // Wait for Python response (up to 60 seconds for model loading + transcription)
        const startTime = Date.now();
        const timeoutMs = 60000;

        while (Date.now() - startTime < timeoutMs) {
            await new Promise(resolve => setTimeout(resolve, 500));

            if (fs.existsSync(VOICE_CLONE_RESPONSE_PATH)) {
                try {
                    const response = JSON.parse(fs.readFileSync(VOICE_CLONE_RESPONSE_PATH, 'utf-8'));

                    if (response.success) {
                        // Save voice metadata
                        const voiceMetaPath = path.join(VOICES_DIR, `${voiceName}.json`);
                        fs.writeFileSync(voiceMetaPath, JSON.stringify({
                            name: voiceName,
                            audio_path: processedPath,
                            transcript: response.transcript || transcript,
                            created_at: new Date().toISOString()
                        }, null, 2), 'utf-8');

                        return {
                            content: [{
                                type: 'text',
                                text: `Voice "${voiceName}" cloned successfully!\n` +
                                      `Audio: ${processedPath}\n` +
                                      `Transcript: "${response.transcript || transcript}"\n\n` +
                                      `The TTS will now use this voice. Try speaking to hear it!`
                            }]
                        };
                    } else {
                        return {
                            content: [{ type: 'text', text: `Voice cloning failed: ${response.error}` }],
                            isError: true
                        };
                    }
                } catch (parseErr) {
                    // Continue waiting
                }
            }
        }

        return {
            content: [{
                type: 'text',
                text: 'Voice cloning request timed out. Is the Python voice agent running with Qwen3-TTS?'
            }],
            isError: true
        };

    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

/**
 * clear_voice_clone - Clear current voice clone
 */
async function handleClearVoiceClone(args) {
    try {
        // Delete old response file if exists
        if (fs.existsSync(VOICE_CLONE_RESPONSE_PATH)) {
            fs.unlinkSync(VOICE_CLONE_RESPONSE_PATH);
        }

        // Write clear request
        const request = {
            action: 'clear',
            timestamp: new Date().toISOString()
        };
        fs.writeFileSync(VOICE_CLONE_REQUEST_PATH, JSON.stringify(request, null, 2), 'utf-8');

        // Wait for response
        const startTime = Date.now();
        const timeoutMs = 5000;

        while (Date.now() - startTime < timeoutMs) {
            await new Promise(resolve => setTimeout(resolve, 200));

            if (fs.existsSync(VOICE_CLONE_RESPONSE_PATH)) {
                const response = JSON.parse(fs.readFileSync(VOICE_CLONE_RESPONSE_PATH, 'utf-8'));
                if (response.success) {
                    return {
                        content: [{
                            type: 'text',
                            text: 'Voice clone cleared. TTS will now use the default preset voice.'
                        }]
                    };
                }
            }
        }

        return {
            content: [{
                type: 'text',
                text: 'Voice clone clear request sent. The preset voice will be used for the next response.'
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
 * list_voice_clones - List saved voice clones
 */
async function handleListVoiceClones(args) {
    try {
        if (!fs.existsSync(VOICES_DIR)) {
            return {
                content: [{ type: 'text', text: 'No voice clones saved yet.' }]
            };
        }

        const voiceFiles = fs.readdirSync(VOICES_DIR).filter(f => f.endsWith('.json'));

        if (voiceFiles.length === 0) {
            return {
                content: [{ type: 'text', text: 'No voice clones saved yet.' }]
            };
        }

        const voices = voiceFiles.map(f => {
            try {
                const meta = JSON.parse(fs.readFileSync(path.join(VOICES_DIR, f), 'utf-8'));
                return `- ${meta.name}: "${meta.transcript?.slice(0, 50) || 'No transcript'}..." (created: ${meta.created_at})`;
            } catch {
                return `- ${f.replace('.json', '')}: (metadata unavailable)`;
            }
        });

        return {
            content: [{
                type: 'text',
                text: `=== Saved Voice Clones ===\n\n${voices.join('\n')}`
            }]
        };
    } catch (err) {
        return {
            content: [{ type: 'text', text: `Error: ${err.message}` }],
            isError: true
        };
    }
}

// ============================================================================
// Browser Tools (headless Playwright via Electron)
// ============================================================================

/**
 * Generic handler for browser control tools (CDP agent browser).
 * Uses file-based IPC to communicate with Electron's browser-watcher.
 */
async function handleBrowserControl(action, args) {
    const requestPath = path.join(HOME_DATA_DIR, 'browser_request.json');
    const responsePath = path.join(HOME_DATA_DIR, 'browser_response.json');

    // Delete old response
    if (fs.existsSync(responsePath)) {
        fs.unlinkSync(responsePath);
    }

    // Write request
    const requestId = `req-${Date.now()}`;
    fs.writeFileSync(requestPath, JSON.stringify({
        id: requestId,
        action,
        args: args || {},
        timestamp: new Date().toISOString()
    }, null, 2));

    // Wait for response (up to 30s for most actions, 60s for screenshot/snapshot)
    const longActions = new Set(['screenshot', 'snapshot', 'act', 'start']);
    const timeoutMs = longActions.has(action) ? 60000 : 30000;
    const startTime = Date.now();

    while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 200));

        if (fs.existsSync(responsePath)) {
            try {
                const response = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));

                // Screenshot returns base64 image
                if (action === 'screenshot' && response.base64) {
                    return {
                        content: [
                            { type: 'image', data: response.base64, mimeType: response.contentType || 'image/png' },
                            { type: 'text', text: `Screenshot captured.` }
                        ]
                    };
                }

                // Format result as text
                const text = typeof response === 'string' ? response : JSON.stringify(response, null, 2);
                return {
                    content: [{ type: 'text', text }],
                    isError: !!response.error
                };
            } catch {
                // JSON parse error, continue waiting
            }
        }
    }

    return {
        content: [{ type: 'text', text: `Browser ${action} timed out. Is the Voice Mirror app running?` }],
        isError: true
    };
}

/**
 * browser_search - Search the web using headless browser
 * Communicates with Electron main process via file-based IPC
 */
async function handleBrowserSearch(args) {
    const requestPath = path.join(HOME_DATA_DIR, 'browser_request.json');
    const responsePath = path.join(HOME_DATA_DIR, 'browser_response.json');

    // Validate query
    if (!args?.query) {
        return {
            content: [{ type: 'text', text: 'Search query is required' }],
            isError: true
        };
    }

    // Delete old response file if exists
    if (fs.existsSync(responsePath)) {
        fs.unlinkSync(responsePath);
    }

    // Write request
    const requestId = `req-${Date.now()}`;
    fs.writeFileSync(requestPath, JSON.stringify({
        id: requestId,
        action: 'search',
        args: {
            query: args.query,
            engine: args.engine || 'duckduckgo',
            max_results: Math.min(args.max_results || 5, 10)
        },
        timestamp: new Date().toISOString()
    }, null, 2));

    // Wait for Electron to process (up to 60 seconds for slow pages)
    const startTime = Date.now();
    const timeoutMs = 60000;

    while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 200));

        if (fs.existsSync(responsePath)) {
            try {
                const response = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));

                if (response.success) {
                    return {
                        content: [{
                            type: 'text',
                            text: response.result
                        }]
                    };
                } else {
                    return {
                        content: [{ type: 'text', text: `Search failed: ${response.error}` }],
                        isError: true
                    };
                }
            } catch (err) {
                // JSON parse error, continue waiting
            }
        }
    }

    return {
        content: [{ type: 'text', text: 'Browser search timed out. Is the Voice Mirror app running?' }],
        isError: true
    };
}

/**
 * browser_fetch - Fetch and extract content from a URL using headless browser
 * Communicates with Electron main process via file-based IPC
 */
async function handleBrowserFetch(args) {
    const requestPath = path.join(HOME_DATA_DIR, 'browser_request.json');
    const responsePath = path.join(HOME_DATA_DIR, 'browser_response.json');

    // Validate URL
    if (!args?.url) {
        return {
            content: [{ type: 'text', text: 'URL is required' }],
            isError: true
        };
    }

    // Delete old response file if exists
    if (fs.existsSync(responsePath)) {
        fs.unlinkSync(responsePath);
    }

    // Write request
    const requestId = `req-${Date.now()}`;
    fs.writeFileSync(requestPath, JSON.stringify({
        id: requestId,
        action: 'fetch',
        args: {
            url: args.url,
            timeout: Math.min(args.timeout || 30000, 60000),
            max_length: args.max_length || 8000,
            include_links: args.include_links || false
        },
        timestamp: new Date().toISOString()
    }, null, 2));

    // Wait for Electron to process (up to 90 seconds for slow pages)
    const startTime = Date.now();
    const timeoutMs = 90000;

    while (Date.now() - startTime < timeoutMs) {
        await new Promise(resolve => setTimeout(resolve, 200));

        if (fs.existsSync(responsePath)) {
            try {
                const response = JSON.parse(fs.readFileSync(responsePath, 'utf-8'));

                if (response.success) {
                    let text = response.result;

                    // Add metadata
                    if (response.title) {
                        text = `Title: ${response.title}\nURL: ${response.url}\n\n${text}`;
                    }

                    if (response.truncated) {
                        text += '\n\n(Content was truncated due to length)';
                    }

                    return {
                        content: [{
                            type: 'text',
                            text: text
                        }]
                    };
                } else {
                    return {
                        content: [{ type: 'text', text: `Fetch failed: ${response.error}` }],
                        isError: true
                    };
                }
            } catch (err) {
                // JSON parse error, continue waiting
            }
        }
    }

    return {
        content: [{ type: 'text', text: 'Browser fetch timed out. Is the Voice Mirror app running?' }],
        isError: true
    };
}

// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Voice Mirror MCP server running');
}

main().catch(console.error);
