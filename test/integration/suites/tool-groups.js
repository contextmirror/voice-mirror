/**
 * Tool Groups test suite — 7 MCP tool management tests (plan mode).
 *
 * These tests output a plan for Claude Code to execute via MCP tools.
 */

const { createTestContext } = require('../lib/harness');

function getPlan() {
    return {
        suite: 'tool-groups',
        mode: 'mcp',
        description: 'MCP tool group loading/unloading tests',
        steps: [
            {
                id: 'list-all-groups',
                description: 'List all tool groups',
                mcpCall: { tool: 'list_tool_groups', args: {} },
                verify: 'Response should list 7 groups: core, meta, screen, memory, voice-clone, browser, n8n',
            },
            {
                id: 'load-screen',
                description: 'Load screen group',
                mcpCall: { tool: 'load_tools', args: { group: 'screen' } },
                verify: 'capture_screen tool should become available',
            },
            {
                id: 'load-unload-cycle',
                description: 'Load memory then unload',
                mcpCall: [
                    { tool: 'load_tools', args: { group: 'memory' } },
                    { tool: 'unload_tools', args: { group: 'memory' } },
                ],
                verify: 'Memory tools should appear then disappear',
            },
            {
                id: 'cannot-unload-core',
                description: 'Attempt to unload core group',
                mcpCall: { tool: 'unload_tools', args: { group: 'core' } },
                verify: 'Should return error — core cannot be unloaded',
            },
            {
                id: 'load-invalid-group',
                description: 'Load nonexistent group',
                mcpCall: { tool: 'load_tools', args: { group: 'nonexistent' } },
                verify: 'Should return error about unknown group',
            },
            {
                id: 'double-load',
                description: 'Load screen twice — should be idempotent',
                mcpCall: [
                    { tool: 'load_tools', args: { group: 'screen' } },
                    { tool: 'load_tools', args: { group: 'screen' } },
                ],
                verify: 'No error on second load',
            },
            {
                id: 'list-after-changes',
                description: 'List groups after load/unload cycle',
                mcpCall: { tool: 'list_tool_groups', args: {} },
                verify: 'Groups reflect current loaded state',
            },
        ],
    };
}

async function run(options = {}) {
    const t = createTestContext('tool-groups');
    t.skip('All tests', 'MCP-driven suite — use --mode plan to get test plan for Claude Code to execute');
    return t.getResults();
}

module.exports = { run, getPlan };
