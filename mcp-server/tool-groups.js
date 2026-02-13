/**
 * Tool group definitions for the Voice Mirror MCP server.
 *
 * Each group contains tool schemas (name, description, inputSchema).
 * Groups marked `alwaysLoaded: true` are always available; others
 * are loaded/unloaded dynamically based on keyword intent or explicit
 * user request.
 *
 * Extracted from index.js to keep the main entry point focused on
 * server wiring and request handling.
 */

const TOOL_GROUPS = {
    core: {
        alwaysLoaded: true,
        description: 'Core voice communication (send, inbox, listen, status)',
        tools: [
            {
                name: 'claude_send',
                description: 'Send a message to the Voice Mirror inbox. Use this to respond to voice queries - your message will be spoken aloud.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        instance_id: { type: 'string', description: 'Your instance ID (use "voice-claude" for Voice Mirror)' },
                        message: { type: 'string', description: 'The message to send (will be spoken via TTS)' },
                        thread_id: { type: 'string', description: 'Optional thread ID for grouping messages' },
                        reply_to: { type: 'string', description: 'Optional message ID this replies to' }
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
                        instance_id: { type: 'string', description: 'Your instance ID' },
                        limit: { type: 'number', description: 'Max messages to return (default: 10)' },
                        include_read: { type: 'boolean', description: 'Include already-read messages (default: false)' },
                        mark_as_read: { type: 'boolean', description: 'Mark messages as read after viewing' }
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
                        instance_id: { type: 'string', description: 'Your instance ID' },
                        from_sender: { type: 'string', description: 'Sender to listen for (use the user\'s configured name for voice input)' },
                        thread_id: { type: 'string', description: 'Optional thread filter' },
                        timeout_seconds: { type: 'number', description: 'Max wait time (default: 300, max: 600)' }
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
                        instance_id: { type: 'string', description: 'Your instance ID' },
                        action: { type: 'string', enum: ['update', 'list'], description: 'Action to perform' },
                        status: { type: 'string', enum: ['active', 'idle'], description: 'Your current status' },
                        current_task: { type: 'string', description: 'What you are working on' }
                    },
                    required: ['instance_id']
                }
            }
        ]
    },
    meta: {
        alwaysLoaded: true,
        description: 'Tool management (load, unload, list groups)',
        tools: [
            {
                name: 'load_tools',
                description: 'Load a tool group to make its tools available. Call list_tool_groups first to see what groups exist. Groups: screen, memory, voice-clone, browser.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group: { type: 'string', description: 'Tool group to load (e.g. "browser", "memory", "screen", "voice-clone")' }
                    },
                    required: ['group']
                }
            },
            {
                name: 'unload_tools',
                description: 'Unload a tool group to reduce context. Cannot unload core or meta groups.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        group: { type: 'string', description: 'Tool group to unload' }
                    },
                    required: ['group']
                }
            },
            {
                name: 'list_tool_groups',
                description: 'List all available tool groups and their loaded status.',
                inputSchema: { type: 'object', properties: {} }
            }
        ]
    },
    screen: {
        description: 'Screen capture and vision analysis',
        keywords: ['screen', 'screenshot', 'look at', 'what do you see', 'my display', 'monitor', 'what\'s on', 'show me'],
        tools: [
            {
                name: 'capture_screen',
                description: 'Capture a screenshot of the user\'s screen for visual analysis.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        display: { description: 'Display index (default: 0). Response includes displays_available count so you can request other monitors.' }
                    }
                }
            }
        ]
    },
    memory: {
        description: 'Persistent memory system (search, store, recall, forget)',
        keywords: ['remember', 'memory', 'recall', 'forget', 'what did i say', 'previously', 'last time', 'you told me', 'i mentioned'],
        tools: [
            {
                name: 'memory_search',
                description: 'Mandatory recall step: search Voice Mirror memories using hybrid semantic + keyword search. You MUST call this before answering any question about prior work, decisions, dates, people, user preferences, todos, or previous conversations. If results are empty, say you checked but found nothing.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        query: { type: 'string', description: 'What to search for in memories' },
                        max_results: { type: 'number', description: 'Maximum results to return (default: 5)' },
                        min_score: { type: 'number', description: 'Minimum relevance score 0-1 (default: 0.3)' }
                    },
                    required: ['query']
                }
            },
            {
                name: 'memory_get',
                description: 'Read full content of a memory chunk or file. Use after memory_search to pull only the needed lines and keep context small.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        path: { type: 'string', description: 'File path or chunk ID from search results' },
                        from_line: { type: 'number', description: 'Start reading from this line (optional)' },
                        lines: { type: 'number', description: 'Number of lines to read (optional)' }
                    },
                    required: ['path']
                }
            },
            {
                name: 'memory_remember',
                description: 'Store a persistent memory. You MUST proactively use this when the user shares preferences, makes decisions, states facts about themselves, or says "remember this". Also use it to save important outcomes of tasks you complete. Do NOT use for casual chat (greetings, thanks, acknowledgments) or vague observations. Only store concrete facts, preferences, or decisions. Tier guide: core=permanent facts, stable=decisions and context (7-day TTL), notes=temporary reminders (24h TTL).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        content: { type: 'string', description: 'What to remember' },
                        tier: { type: 'string', enum: ['core', 'stable', 'notes'], description: 'Memory tier: core=permanent, stable=7 days, notes=temporary' }
                    },
                    required: ['content']
                }
            },
            {
                name: 'memory_forget',
                description: 'Delete a memory by content or chunk ID. Requires confirmed: true (ask user first).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        content_or_id: { type: 'string', description: 'Memory content to match, or chunk_* ID' },
                        confirmed: { type: 'boolean', description: 'Set to true after getting user confirmation' }
                    },
                    required: ['content_or_id']
                }
            },
            {
                name: 'memory_stats',
                description: 'Get memory system statistics including storage, index, and embedding info.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'memory_flush',
                description: 'Flush important context to persistent memory before context compaction. Call this before your context window is about to be compacted to preserve key decisions, topics, and action items.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        topics: { type: 'array', items: { type: 'string' }, description: 'Key topics discussed in this session' },
                        decisions: { type: 'array', items: { type: 'string' }, description: 'Important decisions made' },
                        action_items: { type: 'array', items: { type: 'string' }, description: 'Action items or TODOs' },
                        summary: { type: 'string', description: 'Brief summary of the session' }
                    }
                }
            }
        ]
    },
    'voice-clone': {
        description: 'Voice cloning for TTS customization',
        keywords: ['clone voice', 'voice clone', 'sound like', 'voice sample', 'mimic', 'change voice', 'my voice'],
        tools: [
            {
                name: 'clone_voice',
                description: 'Clone a voice from an audio sample for TTS. Provide either a URL to download or a local file path. The audio will be processed (converted to WAV, trimmed to ~3s) and used for voice synthesis. Requires Qwen3-TTS adapter.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        audio_url: { type: 'string', description: 'URL to download audio from (YouTube, direct audio links, etc.)' },
                        audio_path: { type: 'string', description: 'Local file path to an audio file' },
                        voice_name: { type: 'string', description: 'Name for this voice clone (default: "custom")' },
                        transcript: { type: 'string', description: 'Optional transcript of what is said in the audio. If not provided, will auto-transcribe using STT.' }
                    }
                }
            },
            {
                name: 'clear_voice_clone',
                description: 'Clear the current voice clone and return to using preset speaker voices.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'list_voice_clones',
                description: 'List all saved voice clones.',
                inputSchema: { type: 'object', properties: {} }
            }
        ]
    },
    browser: {
        description: 'Chrome browser control and web research (16 tools)',
        keywords: ['search', 'browse', 'website', 'web', 'google', 'open page', 'fetch url', 'look up', 'find online', 'what is', 'who is', 'latest news'],
        dependencies: ['screen'],
        tools: [
            {
                name: 'browser_start',
                description: 'Launch a managed Chrome browser instance with CDP debugging enabled. Call this before using other browser control tools.',
                inputSchema: { type: 'object', properties: { profile: { type: 'string', description: 'Browser profile name (default: "default")' } } }
            },
            {
                name: 'browser_stop',
                description: 'Stop the managed Chrome browser instance.',
                inputSchema: { type: 'object', properties: { profile: { type: 'string', description: 'Browser profile name' } } }
            },
            {
                name: 'browser_status',
                description: 'Get the status of the browser (running, CDP ready, tab count).',
                inputSchema: { type: 'object', properties: { profile: { type: 'string', description: 'Browser profile name' } } }
            },
            {
                name: 'browser_tabs',
                description: 'List all open browser tabs with their targetId, title, and URL.',
                inputSchema: { type: 'object', properties: { profile: { type: 'string', description: 'Browser profile name' } } }
            },
            {
                name: 'browser_open',
                description: 'Open a new browser tab with the given URL.',
                inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'URL to open' }, profile: { type: 'string', description: 'Browser profile name' } }, required: ['url'] }
            },
            {
                name: 'browser_close_tab',
                description: 'Close a browser tab by its targetId.',
                inputSchema: { type: 'object', properties: { targetId: { type: 'string', description: 'Target ID of the tab to close' }, profile: { type: 'string', description: 'Browser profile name' } }, required: ['targetId'] }
            },
            {
                name: 'browser_focus',
                description: 'Focus/activate a browser tab by its targetId.',
                inputSchema: { type: 'object', properties: { targetId: { type: 'string', description: 'Target ID of the tab to focus' }, profile: { type: 'string', description: 'Browser profile name' } }, required: ['targetId'] }
            },
            {
                name: 'browser_navigate',
                description: 'Navigate a browser tab to a new URL.',
                inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'URL to navigate to' }, targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' }, profile: { type: 'string', description: 'Browser profile name' } }, required: ['url'] }
            },
            {
                name: 'browser_screenshot',
                description: 'Take a screenshot of a browser tab. Returns the screenshot as a base64 image.',
                inputSchema: { type: 'object', properties: { targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' }, fullPage: { type: 'boolean', description: 'Capture full page (default: false)' }, ref: { type: 'string', description: 'Element ref (e1, e2...) to screenshot' }, profile: { type: 'string', description: 'Browser profile name' } } }
            },
            {
                name: 'browser_snapshot',
                description: 'Take an accessibility snapshot of a browser tab. Returns the page structure with element refs (e1, e2...) that can be used with browser_act. Token-efficiency options: use ifChanged=true to get a short "unchanged" response when page hasn\'t changed; use maxPageText=0 to skip page text on follow-up snapshots.',
                inputSchema: { type: 'object', properties: { targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' }, format: { type: 'string', enum: ['role', 'aria', 'ai'], description: 'Snapshot format (default: role)' }, interactive: { type: 'boolean', description: 'Only show interactive elements' }, compact: { type: 'boolean', description: 'Remove unnamed structural elements' }, selector: { type: 'string', description: 'CSS selector to scope snapshot' }, ifChanged: { type: 'boolean', description: 'If true, returns {unchanged: true} when the page structure has not changed since the last snapshot. Saves tokens on follow-up calls.' }, maxPageText: { type: 'number', description: 'Max characters of page text to include (default: 4000). Set to 0 to skip page text entirely for smaller responses.' }, profile: { type: 'string', description: 'Browser profile name' } } }
            },
            {
                name: 'browser_act',
                description: 'Execute an action on a browser page element. Use refs from browser_snapshot (e.g. e1, e2). Actions: click, type, fill, hover, press, select, drag, evaluate, wait, upload, resize, dialog_accept, dialog_dismiss.',
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
                        profile: { type: 'string', description: 'Browser profile name' },
                        confirmed: { type: 'boolean', description: 'Required for evaluate action — set to true after getting user confirmation' }
                    },
                    required: ['request']
                }
            },
            {
                name: 'browser_console',
                description: 'Get console logs and errors from a browser tab.',
                inputSchema: { type: 'object', properties: { targetId: { type: 'string', description: 'Target ID (uses active tab if omitted)' }, profile: { type: 'string', description: 'Browser profile name' } } }
            },
            {
                name: 'browser_search',
                description: 'Search Google using a headless browser. Returns parsed search results. Unlimited searches (no API limits).',
                inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'The search query' }, max_results: { type: 'number', description: 'Maximum results to return (default: 5, max: 10)' } }, required: ['query'] }
            },
            {
                name: 'browser_fetch',
                description: 'Fetch and extract text content from a URL using a headless browser. Handles JavaScript-rendered pages. Returns clean text content.',
                inputSchema: { type: 'object', properties: { url: { type: 'string', description: 'The URL to fetch' }, timeout: { type: 'number', description: 'Timeout in milliseconds (default: 30000, max: 60000)' }, max_length: { type: 'number', description: 'Maximum content length to return (default: 8000)' }, include_links: { type: 'boolean', description: 'Include links found on the page (default: false)' } }, required: ['url'] }
            },
            {
                name: 'browser_cookies',
                description: 'Manage browser cookies. Actions: list (get cookies, optionally filter by url/domain/name), set (create/update a cookie), delete (remove matching cookies), clear (remove all cookies).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['list', 'set', 'delete', 'clear'], description: 'Cookie action to perform' },
                        name: { type: 'string', description: 'Cookie name (required for set/delete)' },
                        value: { type: 'string', description: 'Cookie value (for set)' },
                        url: { type: 'string', description: 'URL to scope cookies to' },
                        domain: { type: 'string', description: 'Domain filter' },
                        path: { type: 'string', description: 'Cookie path' },
                        secure: { type: 'boolean', description: 'Secure flag' },
                        httpOnly: { type: 'boolean', description: 'HttpOnly flag' },
                        sameSite: { type: 'string', enum: ['Strict', 'Lax', 'None'], description: 'SameSite attribute' },
                        profile: { type: 'string', description: 'Browser profile name' }
                    },
                    required: ['action']
                }
            },
            {
                name: 'browser_storage',
                description: 'Read/write browser localStorage or sessionStorage. Actions: get (read entries or a single key), set (write a key-value pair), delete (remove a key), clear (remove all entries).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        type: { type: 'string', enum: ['localStorage', 'sessionStorage'], description: 'Storage type (default: localStorage)' },
                        action: { type: 'string', enum: ['get', 'set', 'delete', 'clear'], description: 'Storage action to perform' },
                        key: { type: 'string', description: 'Storage key (required for set/delete, optional for get)' },
                        value: { type: 'string', description: 'Value to store (for set)' },
                        profile: { type: 'string', description: 'Browser profile name' }
                    },
                    required: ['action']
                }
            }
        ]
    },
    n8n: {
        description: 'n8n workflow automation (22 tools: workflows, executions, credentials, tags, templates)',
        keywords: ['n8n', 'workflow', 'automation', 'trigger', 'webhook', 'execution', 'credential', 'template'],
        tools: [
            {
                name: 'n8n_search_nodes',
                description: 'Search for n8n nodes by keyword (e.g., \'gmail\', \'webhook\', \'slack\'). Returns node types and descriptions.',
                inputSchema: { type: 'object', properties: { query: { type: 'string', description: 'Search keyword (e.g., \'gmail\', \'webhook\', \'http\')' }, limit: { type: 'number', description: 'Max results (default: 10)' } }, required: ['query'] }
            },
            {
                name: 'n8n_get_node',
                description: 'Get detailed node info including operations, parameters, and config examples. Use after search_nodes.',
                inputSchema: { type: 'object', properties: { node_type: { type: 'string', description: 'Node type (e.g., \'nodes-base.gmail\')' }, detail: { type: 'string', enum: ['minimal', 'standard', 'full'], description: 'Detail level (default: standard)' } }, required: ['node_type'] }
            },
            {
                name: 'n8n_list_workflows',
                description: 'List all workflows in the n8n instance. Shows name, active status, and ID.',
                inputSchema: { type: 'object', properties: { active_only: { type: 'boolean', description: 'Only show active workflows' } } }
            },
            {
                name: 'n8n_get_workflow',
                description: 'Get details of a specific workflow by ID. Returns nodes, connections, and settings.',
                inputSchema: { type: 'object', properties: { workflow_id: { type: 'string', description: 'Workflow ID' } }, required: ['workflow_id'] }
            },
            {
                name: 'n8n_create_workflow',
                description: 'Create a new n8n workflow. Use \'n8n-nodes-base.xxx\' for node types. Connections use node NAMES not IDs.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        name: { type: 'string', description: 'Workflow name' },
                        nodes: { type: 'array', description: 'Array of node configurations', items: { type: 'object' } },
                        connections: { type: 'object', description: 'Node connections (source name -> targets)' }
                    },
                    required: ['name', 'nodes', 'connections']
                }
            },
            {
                name: 'n8n_update_workflow',
                description: 'Update workflow via operations (addNode, removeNode, updateNode, updateNodeCode, addConnection, removeConnection, activateWorkflow, deactivateWorkflow) or full replacement via workflow_data.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        workflow_id: { type: 'string', description: 'Workflow ID' },
                        operations: { type: 'array', description: 'List of operations', items: { type: 'object', properties: { type: { type: 'string' }, nodeName: { type: 'string' }, node: { type: 'object' }, parameters: { type: 'object' }, jsCode: { type: 'string' }, fromNode: { type: 'string' }, toNode: { type: 'string' }, fromIndex: { type: 'number' }, toIndex: { type: 'number' } }, required: ['type'] } },
                        workflow_data: { type: 'object', description: 'Full workflow data for replacement' }
                    },
                    required: ['workflow_id']
                }
            },
            {
                name: 'n8n_delete_workflow',
                description: 'Delete a workflow by ID. This action is permanent. Requires confirmed: true (ask user first).',
                inputSchema: { type: 'object', properties: { workflow_id: { type: 'string', description: 'Workflow ID' }, confirmed: { type: 'boolean', description: 'Set to true after getting user confirmation' } }, required: ['workflow_id'] }
            },
            {
                name: 'n8n_validate_workflow',
                description: 'Validate a workflow configuration. Checks for errors and warnings.',
                inputSchema: { type: 'object', properties: { workflow_id: { type: 'string', description: 'Existing workflow ID' }, workflow_json: { type: 'object', description: 'Or provide workflow JSON directly' } } }
            },
            {
                name: 'n8n_trigger_workflow',
                description: 'Trigger a workflow execution via webhook.',
                inputSchema: { type: 'object', properties: { workflow_id: { type: 'string', description: 'Workflow ID' }, webhook_path: { type: 'string', description: 'Webhook path (if known)' }, data: { type: 'object', description: 'Data to send' } }, required: ['workflow_id'] }
            },
            {
                name: 'n8n_deploy_template',
                description: 'Deploy a template from n8n.io to the local instance.',
                inputSchema: { type: 'object', properties: { template_id: { type: 'number', description: 'Template ID from n8n.io' }, name: { type: 'string', description: 'Custom name (optional)' } }, required: ['template_id'] }
            },
            {
                name: 'n8n_get_executions',
                description: 'Get recent executions for a workflow. Check if workflows ran successfully.',
                inputSchema: { type: 'object', properties: { workflow_id: { type: 'string', description: 'Workflow ID (optional)' }, status: { type: 'string', enum: ['success', 'error', 'waiting'], description: 'Filter by status' }, limit: { type: 'number', description: 'Max results (default: 10)' } } }
            },
            {
                name: 'n8n_get_execution',
                description: 'Get details of a specific execution. Use include_data=true for debugging.',
                inputSchema: { type: 'object', properties: { execution_id: { type: 'string', description: 'Execution ID' }, include_data: { type: 'boolean', description: 'Include full execution data' } }, required: ['execution_id'] }
            },
            {
                name: 'n8n_delete_execution',
                description: 'Delete an execution by ID. Requires confirmed: true (ask user first).',
                inputSchema: { type: 'object', properties: { execution_id: { type: 'string', description: 'Execution ID' }, confirmed: { type: 'boolean', description: 'Set to true after getting user confirmation' } }, required: ['execution_id'] }
            },
            {
                name: 'n8n_retry_execution',
                description: 'Retry a failed execution. By default uses latest workflow version.',
                inputSchema: { type: 'object', properties: { execution_id: { type: 'string', description: 'Execution ID' }, load_workflow: { type: 'boolean', description: 'Use latest workflow version (default: true)' } }, required: ['execution_id'] }
            },
            {
                name: 'n8n_list_credentials',
                description: 'List credentials. NOTE: Not supported by n8n public API - shows available operations instead.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'n8n_create_credential',
                description: 'Create a new credential. OAuth credentials may need manual browser auth.',
                inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Credential name' }, type: { type: 'string', description: 'Credential type (e.g., \'slackApi\', \'gmailOAuth2\')' }, data: { type: 'object', description: 'Credential data' } }, required: ['name', 'type'] }
            },
            {
                name: 'n8n_delete_credential',
                description: 'Delete a credential by ID. Requires confirmed: true (ask user first).',
                inputSchema: { type: 'object', properties: { credential_id: { type: 'string', description: 'Credential ID' }, confirmed: { type: 'boolean', description: 'Set to true after getting user confirmation' } }, required: ['credential_id'] }
            },
            {
                name: 'n8n_get_credential_schema',
                description: 'Get schema for a credential type. Shows required fields.',
                inputSchema: { type: 'object', properties: { credential_type: { type: 'string', description: 'Credential type (e.g., \'gmailOAuth2\', \'slackApi\')' } }, required: ['credential_type'] }
            },
            {
                name: 'n8n_list_tags',
                description: 'List all tags used for organizing workflows.',
                inputSchema: { type: 'object', properties: {} }
            },
            {
                name: 'n8n_create_tag',
                description: 'Create a new tag for workflow organization.',
                inputSchema: { type: 'object', properties: { name: { type: 'string', description: 'Tag name' } }, required: ['name'] }
            },
            {
                name: 'n8n_delete_tag',
                description: 'Delete a tag by ID. Requires confirmed: true (ask user first).',
                inputSchema: { type: 'object', properties: { tag_id: { type: 'string', description: 'Tag ID' }, confirmed: { type: 'boolean', description: 'Set to true after getting user confirmation' } }, required: ['tag_id'] }
            },
            {
                name: 'n8n_list_variables',
                description: 'List global variables. NOTE: Requires n8n Enterprise license.',
                inputSchema: { type: 'object', properties: {} }
            }
        ]
    },
    diagnostic: {
        description: 'Pipeline diagnostic tools — trace message flow through the app with real data',
        keywords: ['diagnostic', 'trace', 'pipeline', 'debug', 'test pipeline'],
        tools: [
            {
                name: 'pipeline_trace',
                description: 'Send a test message through the live Voice Mirror pipeline and trace every stage (inbox \u2192 provider \u2192 tool calls \u2192 browser \u2192 formatting \u2192 truncation \u2192 model response \u2192 TTS). Returns detailed trace showing what data is captured, transformed, truncated, and lost at each stage.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        message: {
                            type: 'string',
                            description: 'The test message to send through the pipeline (e.g. "What is the Premier League table?")'
                        },
                        timeout_seconds: {
                            type: 'number',
                            description: 'Max wait time for pipeline completion (default: 30)'
                        }
                    },
                    required: ['message']
                }
            }
        ]
    },
    'memory-facade': {
        description: 'Memory system (single tool: memory_manage)',
        keywords: ['remember', 'memory', 'recall', 'forget', 'what did i say', 'previously', 'last time', 'you told me', 'i mentioned'],
        tools: [
            {
                name: 'memory_manage',
                description: 'Manage persistent memories. Actions: search (query memories), remember (store a memory), forget (delete \u2014 requires confirmed:true), stats (system info), flush (save context before compaction). Pass action as first parameter, plus action-specific args.',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['search', 'remember', 'forget', 'stats', 'flush'], description: 'Action to perform' },
                        query: { type: 'string', description: 'Search query (for search)' },
                        content: { type: 'string', description: 'What to remember (for remember)' },
                        tier: { type: 'string', enum: ['core', 'stable', 'notes'], description: 'Memory tier (for remember)' },
                        content_or_id: { type: 'string', description: 'Memory to forget (for forget)' },
                        confirmed: { type: 'boolean', description: 'Confirm destructive action (for forget)' },
                        max_results: { type: 'number', description: 'Max results (for search)' },
                        topics: { type: 'array', items: { type: 'string' }, description: 'Topics (for flush)' },
                        decisions: { type: 'array', items: { type: 'string' }, description: 'Decisions (for flush)' },
                        action_items: { type: 'array', items: { type: 'string' }, description: 'Action items (for flush)' },
                        summary: { type: 'string', description: 'Session summary (for flush)' }
                    },
                    required: ['action']
                }
            }
        ]
    },
    'n8n-facade': {
        description: 'n8n workflow automation (single tool: n8n_manage)',
        keywords: ['n8n', 'workflow', 'automation', 'trigger', 'webhook'],
        tools: [
            {
                name: 'n8n_manage',
                description: 'Manage n8n workflows. Actions: list (all workflows), get (workflow details), create (new workflow), trigger (run via webhook), status (recent executions), delete (requires confirmed:true).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['list', 'get', 'create', 'trigger', 'status', 'delete'], description: 'Action to perform' },
                        workflow_id: { type: 'string', description: 'Workflow ID (for get, trigger, status, delete)' },
                        name: { type: 'string', description: 'Workflow name (for create)' },
                        nodes: { type: 'array', description: 'Node configs (for create)', items: { type: 'object' } },
                        connections: { type: 'object', description: 'Node connections (for create)' },
                        data: { type: 'object', description: 'Data to send (for trigger)' },
                        confirmed: { type: 'boolean', description: 'Confirm destructive action (for delete)' },
                        active_only: { type: 'boolean', description: 'Only active workflows (for list)' }
                    },
                    required: ['action']
                }
            }
        ]
    },
    'browser-facade': {
        description: 'Browser control and web research (single tool: browser_manage)',
        keywords: ['search', 'browse', 'website', 'web', 'google', 'open page', 'fetch url', 'look up', 'find online', 'what is', 'who is', 'latest news'],
        dependencies: ['screen'],
        tools: [
            {
                name: 'browser_manage',
                description: 'Control Chrome browser and do web research. Actions: search (Google search), open (new tab), fetch (extract page text), snapshot (accessibility tree), screenshot (capture tab), click (click element by ref), type (type text into element), tabs (list tabs), navigate (go to URL), start (launch browser), stop (close browser).',
                inputSchema: {
                    type: 'object',
                    properties: {
                        action: { type: 'string', enum: ['search', 'open', 'fetch', 'snapshot', 'screenshot', 'click', 'type', 'tabs', 'navigate', 'start', 'stop'], description: 'Action to perform' },
                        query: { type: 'string', description: 'Search query (for search)' },
                        url: { type: 'string', description: 'URL (for open, fetch, navigate)' },
                        ref: { type: 'string', description: 'Element ref from snapshot (for click, type)' },
                        text: { type: 'string', description: 'Text to type (for type)' },
                        request: { type: 'object', description: 'Full action request (for advanced click/type)' },
                        targetId: { type: 'string', description: 'Tab target ID' },
                        profile: { type: 'string', description: 'Browser profile name' },
                        max_results: { type: 'number', description: 'Max results (for search)' },
                        timeout: { type: 'number', description: 'Timeout in ms (for fetch)' },
                        max_length: { type: 'number', description: 'Max content length (for fetch)' }
                    },
                    required: ['action']
                }
            }
        ]
    }
};

module.exports = TOOL_GROUPS;
