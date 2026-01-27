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

    web_search: {
        name: 'web_search',
        description: 'Search Google using a headless browser (unlimited searches)',
        args: {
            query: {
                type: 'string',
                required: true,
                description: 'The search query'
            },
            max_results: {
                type: 'number',
                required: false,
                default: 5,
                description: 'Maximum number of results to return (max: 10)'
            }
        },
        example: '{"tool": "web_search", "args": {"query": "weather in Edinburgh"}}'
    },

    memory_search: {
        name: 'memory_search',
        description: 'Search past conversations and stored memories',
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
        description: 'Store important information for later recall',
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
                description: 'Memory tier: core (permanent), stable (7 days), notes (temporary)'
            }
        },
        example: '{"tool": "memory_remember", "args": {"content": "User prefers dark mode", "tier": "core"}}'
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
