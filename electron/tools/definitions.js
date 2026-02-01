/**
 * Tool definitions for local LLM tool system.
 *
 * These define the tools available to local models (Ollama, LM Studio, Jan)
 * that don't have native tool support.
 */

const tools = {
    capture_screen: {
        name: 'capture_screen',
        description: 'Take a screenshot of the user\'s screen for visual analysis',
        args: {},
        example: '{"tool": "capture_screen", "args": {}}'
    },

    memory_search: {
        name: 'memory_search',
        description: 'MANDATORY recall step: search past conversations and stored memories. You MUST call this before answering questions about prior work, decisions, preferences, people, dates, or todos',
        args: {
            query: {
                type: 'string',
                required: true,
                description: 'What to search for in memories'
            }
        },
        example: '{"tool": "memory_search", "args": {"query": "user preferences"}}'
    },

    memory_remember: {
        name: 'memory_remember',
        description: 'Store important information for later recall. PROACTIVELY use this when the user shares preferences, makes decisions, states facts about themselves, or says "remember this". Do NOT use for casual chat like greetings, thanks, acknowledgments, or vague observations.',
        args: {
            content: {
                type: 'string',
                required: true,
                description: 'What to remember'
            },
            tier: {
                type: 'string',
                required: false,
                default: 'stable',
                description: 'Memory tier: core (permanent facts), stable (7 days), notes (temporary 24h)'
            }
        },
        example: '{"tool": "memory_remember", "args": {"content": "User prefers dark mode", "tier": "core"}}'
    },

    browser_control: {
        name: 'browser_control',
        description: 'Control the embedded browser — search the web, open pages, read content, click elements, type text. The browser is embedded in the Voice Mirror panel.',
        args: {
            action: {
                type: 'string',
                required: true,
                description: 'Action: search, open, snapshot, click, type, fill, press, navigate, screenshot, console, status, stop'
            },
            query: {
                type: 'string',
                required: false,
                description: 'Search query (for action: search)'
            },
            url: {
                type: 'string',
                required: false,
                description: 'URL (for action: open, navigate)'
            },
            ref: {
                type: 'string',
                required: false,
                description: 'Element ref from snapshot, e.g. "e1" (for action: click, type, fill)'
            },
            text: {
                type: 'string',
                required: false,
                description: 'Text to type/fill (for action: type, fill)'
            },
            key: {
                type: 'string',
                required: false,
                description: 'Key name (for action: press, e.g. "Enter", "Tab")'
            }
        },
        example: '{"tool": "browser_control", "args": {"action": "search", "query": "latest tech news"}}'
    },

    n8n_list_workflows: {
        name: 'n8n_list_workflows',
        description: 'List available n8n automation workflows',
        args: {},
        example: '{"tool": "n8n_list_workflows", "args": {}}'
    },

    n8n_trigger_workflow: {
        name: 'n8n_trigger_workflow',
        description: 'Trigger an n8n workflow via webhook',
        args: {
            webhook_path: {
                type: 'string',
                required: false,
                description: 'Webhook path to trigger (e.g., "email-summary")'
            },
            workflow_id: {
                type: 'string',
                required: false,
                description: 'Workflow ID (alternative to webhook_path)'
            },
            data: {
                type: 'object',
                required: false,
                description: 'Data to send to the workflow'
            }
        },
        example: '{"tool": "n8n_trigger_workflow", "args": {"webhook_path": "check-emails"}}'
    }
};

/**
 * Get tool definition by name
 */
function getTool(name) {
    return tools[name] || null;
}

/**
 * Get all tool definitions
 */
function getAllTools() {
    return Object.values(tools);
}

/**
 * Get tool names
 */
function getToolNames() {
    return Object.keys(tools);
}

/**
 * Validate tool arguments
 */
function validateArgs(toolName, args) {
    const tool = tools[toolName];
    if (!tool) {
        return { valid: false, error: `Unknown tool: ${toolName}` };
    }

    // Check required arguments
    for (const [argName, argDef] of Object.entries(tool.args)) {
        if (argDef.required && (args[argName] === undefined || args[argName] === null)) {
            return { valid: false, error: `Missing required argument: ${argName}` };
        }
    }

    return { valid: true };
}

module.exports = {
    tools,
    getTool,
    getAllTools,
    getToolNames,
    validateArgs
};
