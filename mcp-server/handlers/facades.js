/**
 * Facade tool handlers for voice mode.
 *
 * Each facade consolidates an entire tool group into a single tool with an
 * `action` parameter.  This reduces token overhead from ~9,400 to ~2,200
 * while preserving full functionality.
 *
 * Destructive sub-actions (forget, delete) check `args.confirmed` inside
 * the facade rather than in the global DESTRUCTIVE_TOOLS set, so non-
 * destructive actions on the same facade are never blocked.
 */

const { handleMemorySearch, handleMemoryRemember, handleMemoryForget, handleMemoryStats, handleMemoryFlush } = require('./memory');
const { handleBrowserControl, handleBrowserSearch, handleBrowserFetch } = require('./browser');
const n8n = require('./n8n');

// ============================================
// Confirmation gate helper
// ============================================

function confirmationRequired(toolName) {
    return {
        content: [{
            type: 'text',
            text: `\u26a0\ufe0f CONFIRMATION REQUIRED: "${toolName}" is a destructive operation.\n` +
                  `Ask the user for voice confirmation before proceeding.\n` +
                  `To execute, call ${toolName} again with confirmed: true in the arguments.`
        }]
    };
}

// ============================================
// memory_manage facade
// ============================================

async function handleMemoryManage(args) {
    const action = args?.action;
    if (!action) {
        return { content: [{ type: 'text', text: 'Error: action is required. Valid actions: search, remember, forget, stats, flush' }], isError: true };
    }

    switch (action) {
        case 'search':
            return await handleMemorySearch(args);
        case 'remember':
            return await handleMemoryRemember(args);
        case 'forget':
            if (!args.confirmed) return confirmationRequired('memory_manage(forget)');
            return await handleMemoryForget(args);
        case 'stats':
            return await handleMemoryStats(args);
        case 'flush':
            return await handleMemoryFlush(args);
        default:
            return { content: [{ type: 'text', text: `Unknown memory action: "${action}". Valid actions: search, remember, forget, stats, flush` }], isError: true };
    }
}

// ============================================
// n8n_manage facade
// ============================================

async function handleN8nManage(args) {
    const action = args?.action;
    if (!action) {
        return { content: [{ type: 'text', text: 'Error: action is required. Valid actions: list, get, create, trigger, status, delete' }], isError: true };
    }

    switch (action) {
        case 'list':
            return await n8n.handleN8nListWorkflows(args);
        case 'get':
            return await n8n.handleN8nGetWorkflow(args);
        case 'create':
            return await n8n.handleN8nCreateWorkflow(args);
        case 'trigger':
            return await n8n.handleN8nTriggerWorkflow(args);
        case 'status':
            return await n8n.handleN8nGetExecutions(args);
        case 'delete':
            if (!args.confirmed) return confirmationRequired('n8n_manage(delete)');
            return await n8n.handleN8nDeleteWorkflow(args);
        default:
            return { content: [{ type: 'text', text: `Unknown n8n action: "${action}". Valid actions: list, get, create, trigger, status, delete` }], isError: true };
    }
}

// ============================================
// browser_manage facade
// ============================================

async function handleBrowserManage(args) {
    const action = args?.action;
    if (!action) {
        return { content: [{ type: 'text', text: 'Error: action is required. Valid actions: search, open, fetch, snapshot, screenshot, click, type, tabs, navigate, start, stop' }], isError: true };
    }

    switch (action) {
        case 'search':
            return await handleBrowserSearch(args);
        case 'fetch':
            return await handleBrowserFetch(args);
        case 'open':
            return await handleBrowserControl('open', args);
        case 'snapshot':
            return await handleBrowserControl('snapshot', args);
        case 'screenshot':
            return await handleBrowserControl('screenshot', args);
        case 'click':
            return await handleBrowserControl('act', { ...args, request: { kind: 'click', ref: args.ref, ...(args.request || {}) } });
        case 'type':
            return await handleBrowserControl('act', { ...args, request: { kind: 'type', ref: args.ref, text: args.text, ...(args.request || {}) } });
        case 'tabs':
            return await handleBrowserControl('tabs', args);
        case 'navigate':
            return await handleBrowserControl('navigate', args);
        case 'start':
            return await handleBrowserControl('start', args);
        case 'stop':
            return await handleBrowserControl('stop', args);
        default:
            return { content: [{ type: 'text', text: `Unknown browser action: "${action}". Valid actions: search, open, fetch, snapshot, screenshot, click, type, tabs, navigate, start, stop` }], isError: true };
    }
}

module.exports = {
    handleMemoryManage,
    handleN8nManage,
    handleBrowserManage
};
