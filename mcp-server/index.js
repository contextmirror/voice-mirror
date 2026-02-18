#!/usr/bin/env node
/**
 * Voice Mirror Electron - MCP Server
 *
 * Provides tools for Claude Code to interact with Voice Mirror.
 * Uses dynamic tool group loading/unloading to keep context lean.
 *
 * Core tools (always loaded): claude_send, claude_inbox, claude_listen, claude_status
 * Meta tools (always loaded): load_tools, unload_tools, list_tool_groups
 * Dynamic groups: screen, memory, voice-clone, browser, n8n
 */

const { Server } = require('@modelcontextprotocol/sdk/server/index.js');
const { StdioServerTransport } = require('@modelcontextprotocol/sdk/server/stdio.js');
const {
    CallToolRequestSchema,
    ListToolsRequestSchema
} = require('@modelcontextprotocol/sdk/types.js');
const fs = require('fs');

// Paths and constants
const { HOME_DATA_DIR, LISTENER_LOCK_PATH } = require('./paths');

// Handlers
const core = require('./handlers/core');
const { handleCaptureScreen } = require('./handlers/screen');
const { handlePipelineTrace } = require('./handlers/diagnostic');
const { handleMemorySearch, handleMemoryGet, handleMemoryRemember, handleMemoryForget, handleMemoryStats, handleMemoryFlush } = require('./handlers/memory');
const { handleCloneVoice, handleClearVoiceClone, handleListVoiceClones } = require('./handlers/voice-clone');
const { handleBrowserControl, handleBrowserSearch, handleBrowserFetch } = require('./handlers/browser');
const n8n = require('./handlers/n8n');
const { handleMemoryManage, handleN8nManage, handleBrowserManage } = require('./handlers/facades');

// Ensure directory exists
if (!fs.existsSync(HOME_DATA_DIR)) {
    fs.mkdirSync(HOME_DATA_DIR, { recursive: true });
}

// Clean up any stale listener lock from previous crashes
// Only delete locks that expired more than 60s ago to avoid racing with active processes
if (fs.existsSync(LISTENER_LOCK_PATH)) {
    try {
        const lock = JSON.parse(fs.readFileSync(LISTENER_LOCK_PATH, 'utf-8'));
        const STALE_GRACE_PERIOD_MS = 60000; // 60 seconds grace period
        if (lock.expires_at < Date.now() - STALE_GRACE_PERIOD_MS) {
            fs.unlinkSync(LISTENER_LOCK_PATH);
            console.error('[MCP] Cleaned up stale listener lock');
        }
    } catch (e) {
        console.error('[MCP]', 'Parse error reading lock file at startup:', e?.message);
        // Corrupt lock file — safe to remove
        try { fs.unlinkSync(LISTENER_LOCK_PATH); } catch (e2) { console.error('[MCP]', 'Failed to remove corrupt lock file:', e2?.message); }
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
            tools: { listChanged: true }
        }
    }
);

// ============================================
// Dynamic Tool Groups (extracted to tool-groups.js)
// ============================================

const TOOL_GROUPS = require('./tool-groups');

// Track which groups are currently loaded
// Check CLI args first (--enabled-groups core,meta,n8n), then env var as fallback
const enabledGroupsArg = (() => {
    // 1. CLI args (highest priority)
    const idx = process.argv.indexOf('--enabled-groups');
    if (idx !== -1 && process.argv[idx + 1]) return process.argv[idx + 1];
    // 2. Environment variable
    if (process.env.ENABLED_GROUPS) return process.env.ENABLED_GROUPS;
    // 3. Read from app config file (fallback when Claude Code strips args/env)
    try {
        const { getConfigPath } = require('./lib/memory/utils');
        const configPath = getConfigPath();
        const appConfig = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        const profileName = appConfig?.ai?.toolProfile || 'voice-assistant';
        const profiles = appConfig?.ai?.toolProfiles || {};
        const groups = profiles[profileName]?.groups;
        if (groups && groups.length > 0) {
            console.error(`[MCP] Loaded tool profile "${profileName}" from config.json: ${groups.join(',')}`);
            return groups.join(',');
        }
    } catch (err) {
        console.error(`[MCP] Could not read app config for tool profile: ${err.message}`);
    }
    return null;
})();
const loadedGroups = enabledGroupsArg
    ? new Set(enabledGroupsArg.split(',').filter(g => TOOL_GROUPS[g]))
    : new Set(['core', 'meta']);

// When enabled groups are set, restrict auto-load to only those groups
const allowedGroups = enabledGroupsArg
    ? new Set(enabledGroupsArg.split(',').filter(g => TOOL_GROUPS[g]))
    : null; // null = all groups allowed (backward compat)

if (enabledGroupsArg) {
    console.error(`[MCP] Tool profile active — enabled groups: ${[...loadedGroups].join(', ')}`);
}

// Reverse lookup: tool name → group name (built once at startup)
const toolNameToGroup = {};
for (const [groupName, group] of Object.entries(TOOL_GROUPS)) {
    for (const tool of group.tools) {
        toolNameToGroup[tool.name] = groupName;
    }
}

// Idle tracking for auto-unload
let totalCallCount = 0;
const groupLastUsed = {}; // { groupName: callCount }
const IDLE_CALLS_THRESHOLD = 15;

// Pre-compiled keyword regexes for autoLoadByIntent (optimization: single regex per group)
const groupKeywordRegex = {};
for (const [groupName, group] of Object.entries(TOOL_GROUPS)) {
    if (group.keywords && group.keywords.length > 0) {
        // Escape regex special chars in keywords, join with |
        const escaped = group.keywords.map(kw => kw.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'));
        groupKeywordRegex[groupName] = new RegExp(escaped.join('|'), 'i');
    }
}

// Destructive tools set (module scope to avoid re-creation per call)
const DESTRUCTIVE_TOOLS = new Set([
    'memory_forget',
    'n8n_delete_workflow',
    'n8n_delete_credential',
    'n8n_delete_tag',
    'n8n_delete_execution',
]);

// ============================================
// Auto-load / Auto-unload
// ============================================

/**
 * Auto-load tool groups based on keyword intent detection.
 */
async function autoLoadByIntent(text) {
    if (!text) return [];
    const loaded = [];

    for (const [groupName, group] of Object.entries(TOOL_GROUPS)) {
        if (group.alwaysLoaded || loadedGroups.has(groupName)) continue;
        if (!groupKeywordRegex[groupName]) continue;
        // If a tool profile restricts groups, skip groups not in the allowed set
        if (allowedGroups && !allowedGroups.has(groupName)) continue;

        if (!groupKeywordRegex[groupName].test(text)) continue;

        loadedGroups.add(groupName);
        loaded.push(groupName);
        console.error(`[MCP] Auto-loaded "${groupName}" (intent: "${text.slice(0, 60)}")`);

        const deps = group.dependencies || [];
        for (const dep of deps) {
            if (!loadedGroups.has(dep) && TOOL_GROUPS[dep]) {
                loadedGroups.add(dep);
                loaded.push(dep);
                console.error(`[MCP] Auto-loaded "${dep}" (dependency of ${groupName})`);
            }
        }
    }

    if (loaded.length > 0) {
        try {
            await server.notification({ method: 'notifications/tools/list_changed' });
        } catch (err) {
            console.error(`[MCP] Failed to send list_changed notification:`, err.message);
        }
    }

    return loaded;
}

/**
 * Check for idle groups and auto-unload them.
 */
async function autoUnloadIdle() {
    const toUnload = [];
    for (const groupName of loadedGroups) {
        const group = TOOL_GROUPS[groupName];
        if (!group || group.alwaysLoaded) continue;
        // Don't auto-unload groups pinned by tool profile
        if (allowedGroups && allowedGroups.has(groupName)) continue;
        const lastUsed = groupLastUsed[groupName] || 0;
        if (totalCallCount - lastUsed > IDLE_CALLS_THRESHOLD) {
            toUnload.push(groupName);
        }
    }

    for (const groupName of toUnload) {
        loadedGroups.delete(groupName);
        console.error(`[MCP] Auto-unloaded "${groupName}" (idle for ${IDLE_CALLS_THRESHOLD}+ calls)`);
    }

    if (toUnload.length > 0) {
        try {
            await server.notification({ method: 'notifications/tools/list_changed' });
        } catch (err) {
            console.error(`[MCP] Failed to send list_changed notification:`, err.message);
        }
    }
}

// Wire autoLoadByIntent into core handlers
core.setAutoLoadByIntent(autoLoadByIntent);

// ============================================
// Meta Tool Handlers
// ============================================

async function handleLoadTools(args) {
    const group = args?.group;
    if (!group) {
        return { content: [{ type: 'text', text: 'Error: group is required' }], isError: true };
    }
    if (!TOOL_GROUPS[group]) {
        const available = Object.keys(TOOL_GROUPS).filter(g => !TOOL_GROUPS[g].alwaysLoaded);
        return { content: [{ type: 'text', text: `Unknown group: "${group}". Available: ${available.join(', ')}` }], isError: true };
    }
    if (loadedGroups.has(group)) {
        const toolNames = TOOL_GROUPS[group].tools.map(t => t.name).join(', ');
        return { content: [{ type: 'text', text: `Group "${group}" is already loaded. Tools: ${toolNames}` }] };
    }

    loadedGroups.add(group);
    groupLastUsed[group] = totalCallCount;
    console.error(`[MCP] Loaded tool group: ${group}`);

    // Also load dependencies
    const deps = TOOL_GROUPS[group].dependencies || [];
    const loadedDeps = [];
    for (const dep of deps) {
        if (!loadedGroups.has(dep) && TOOL_GROUPS[dep]) {
            loadedGroups.add(dep);
            groupLastUsed[dep] = totalCallCount;
            loadedDeps.push(dep);
            console.error(`[MCP] Auto-loaded dependency "${dep}" (required by ${group})`);
        }
    }

    try {
        await server.notification({ method: 'notifications/tools/list_changed' });
    } catch (err) {
        console.error(`[MCP] Failed to send list_changed notification:`, err.message);
    }

    const toolNames = TOOL_GROUPS[group].tools.map(t => t.name).join(', ');
    const depInfo = loadedDeps.length > 0 ? `\nAlso loaded dependencies: ${loadedDeps.join(', ')}` : '';
    return {
        content: [{
            type: 'text',
            text: `Loaded tool group "${group}" (${TOOL_GROUPS[group].tools.length} tools):\n${toolNames}${depInfo}`
        }]
    };
}

async function handleUnloadTools(args) {
    const group = args?.group;
    if (!group) {
        return { content: [{ type: 'text', text: 'Error: group is required' }], isError: true };
    }
    if (TOOL_GROUPS[group]?.alwaysLoaded) {
        return { content: [{ type: 'text', text: `Cannot unload "${group}" — it is always loaded.` }], isError: true };
    }
    if (!loadedGroups.has(group)) {
        return { content: [{ type: 'text', text: `Group "${group}" is not currently loaded.` }] };
    }

    loadedGroups.delete(group);
    console.error(`[MCP] Unloaded tool group: ${group}`);

    try {
        await server.notification({ method: 'notifications/tools/list_changed' });
    } catch (err) {
        console.error(`[MCP] Failed to send list_changed notification:`, err.message);
    }

    return {
        content: [{
            type: 'text',
            text: `Unloaded tool group "${group}". ${TOOL_GROUPS[group].tools.length} tools removed from context.`
        }]
    };
}

function handleListToolGroups() {
    const lines = ['=== Tool Groups ===', ''];
    for (const [name, group] of Object.entries(TOOL_GROUPS)) {
        const loaded = loadedGroups.has(name);
        const status = group.alwaysLoaded ? 'ALWAYS LOADED' : (loaded ? 'LOADED' : 'unloaded');
        const toolNames = group.tools.map(t => t.name).join(', ');
        lines.push(`[${status}] ${name} (${group.tools.length} tools) — ${group.description}`);
        lines.push(`  Tools: ${toolNames}`);
        lines.push('');
    }
    return { content: [{ type: 'text', text: lines.join('\n') }] };
}

// ============================================
// Request Handlers
// ============================================

// List tools — only returns tools from currently loaded groups
server.setRequestHandler(ListToolsRequestSchema, async () => {
    const tools = [];
    for (const groupName of loadedGroups) {
        const group = TOOL_GROUPS[groupName];
        if (group) tools.push(...group.tools);
    }
    return { tools };
});

// Call tool handler
server.setRequestHandler(CallToolRequestSchema, async (request) => {
    const { name, arguments: args } = request.params;

    // Track usage for idle auto-unload
    totalCallCount++;
    const calledGroup = toolNameToGroup[name];
    if (calledGroup) {
        groupLastUsed[calledGroup] = totalCallCount;
    }

    if (DESTRUCTIVE_TOOLS.has(name) && !args?.confirmed) {
        return {
            content: [{
                type: 'text',
                text: `⚠️ CONFIRMATION REQUIRED: "${name}" is a destructive operation.\n` +
                      `Ask the user for voice confirmation before proceeding.\n` +
                      `To execute, call ${name} again with confirmed: true in the arguments.`
            }]
        };
    }

    // Execute the tool, then check for idle groups
    const result = await (async () => {
    switch (name) {
        // Meta tools
        case 'load_tools':
            return await handleLoadTools(args);
        case 'unload_tools':
            return await handleUnloadTools(args);
        case 'list_tool_groups':
            return handleListToolGroups(args);
        // Core tools
        case 'claude_send':
            return await core.handleClaudeSend(args);
        case 'claude_inbox':
            return await core.handleClaudeInbox(args);
        case 'claude_listen':
            return await core.handleClaudeListen(args);
        case 'claude_status':
            return await core.handleClaudeStatus(args);
        // Screen tools
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
        case 'memory_flush':
            return await handleMemoryFlush(args);
        // Voice cloning tools
        case 'clone_voice':
            return await handleCloneVoice(args);
        case 'clear_voice_clone':
            return await handleClearVoiceClone(args);
        case 'list_voice_clones':
            return await handleListVoiceClones(args);
        // Browser control tools
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
            // Gate: evaluate action runs arbitrary JS — require confirmation
            if (args?.request?.kind === 'evaluate' && !args?.confirmed) {
                return {
                    content: [{
                        type: 'text',
                        text: `⚠️ CONFIRMATION REQUIRED: browser_act with "evaluate" executes arbitrary JavaScript.\n` +
                              `Ask the user for voice confirmation before proceeding.\n` +
                              `To execute, call browser_act again with confirmed: true in the arguments.`
                    }]
                };
            }
            return await handleBrowserControl('act', args);
        case 'browser_console':
            return await handleBrowserControl('console', args);
        case 'browser_search':
            return await handleBrowserSearch(args);
        case 'browser_fetch':
            return await handleBrowserFetch(args);
        case 'browser_cookies':
            return await handleBrowserControl('cookies', args);
        case 'browser_storage':
            return await handleBrowserControl('storage', args);
        // n8n workflow tools
        case 'n8n_search_nodes':
            return await n8n.handleN8nSearchNodes(args);
        case 'n8n_get_node':
            return await n8n.handleN8nGetNode(args);
        case 'n8n_list_workflows':
            return await n8n.handleN8nListWorkflows(args);
        case 'n8n_get_workflow':
            return await n8n.handleN8nGetWorkflow(args);
        case 'n8n_create_workflow':
            return await n8n.handleN8nCreateWorkflow(args);
        case 'n8n_update_workflow':
            return await n8n.handleN8nUpdateWorkflow(args);
        case 'n8n_delete_workflow':
            return await n8n.handleN8nDeleteWorkflow(args);
        case 'n8n_validate_workflow':
            return await n8n.handleN8nValidateWorkflow(args);
        case 'n8n_trigger_workflow':
            return await n8n.handleN8nTriggerWorkflow(args);
        case 'n8n_deploy_template':
            return await n8n.handleN8nDeployTemplate(args);
        case 'n8n_get_executions':
            return await n8n.handleN8nGetExecutions(args);
        case 'n8n_get_execution':
            return await n8n.handleN8nGetExecution(args);
        case 'n8n_delete_execution':
            return await n8n.handleN8nDeleteExecution(args);
        case 'n8n_retry_execution':
            return await n8n.handleN8nRetryExecution(args);
        case 'n8n_list_credentials':
            return await n8n.handleN8nListCredentials(args);
        case 'n8n_create_credential':
            return await n8n.handleN8nCreateCredential(args);
        case 'n8n_delete_credential':
            return await n8n.handleN8nDeleteCredential(args);
        case 'n8n_get_credential_schema':
            return await n8n.handleN8nGetCredentialSchema(args);
        case 'n8n_list_tags':
            return await n8n.handleN8nListTags(args);
        case 'n8n_create_tag':
            return await n8n.handleN8nCreateTag(args);
        case 'n8n_delete_tag':
            return await n8n.handleN8nDeleteTag(args);
        case 'n8n_list_variables':
            return await n8n.handleN8nListVariables(args);
        // Diagnostic tools
        case 'pipeline_trace':
            return await handlePipelineTrace(args);
        // Facade tools (voice mode)
        case 'memory_manage':
            return await handleMemoryManage(args);
        case 'n8n_manage':
            return await handleN8nManage(args);
        case 'browser_manage':
            return await handleBrowserManage(args);
        default:
            return {
                content: [{ type: 'text', text: `Unknown tool: ${name}` }],
                isError: true
            };
    }
    })();

    // After tool execution, check for idle groups to auto-unload
    await autoUnloadIdle();

    return result;
});

// Start server
async function main() {
    const transport = new StdioServerTransport();
    await server.connect(transport);
    console.error('Voice Mirror MCP server running');

    // Eager-load embedding model in background so memory search is instant
    try {
        const { getMemoryManager } = require('./lib/memory/MemoryManager');
        const manager = getMemoryManager();
        manager.init().then(() => {
            console.error('[Memory] Embedding model pre-loaded and ready');
        }).catch((err) => {
            console.error(`[Memory] Background init failed (will retry on first use): ${err.message}`);
        });
    } catch (err) {
        console.error(`[Memory] Could not start background init: ${err.message}`);
    }
}

main().catch(console.error);
