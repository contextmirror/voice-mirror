/**
 * Screen capture test suite — 2 tests (plan mode).
 */

const { createTestContext } = require('../lib/harness');

function getPlan() {
    return {
        suite: 'screen',
        mode: 'mcp',
        description: 'Screen capture tests via MCP',
        steps: [
            {
                id: 'capture-succeeds',
                description: 'Capture screen returns without error',
                mcpCall: { tool: 'capture_screen', args: {} },
                verify: 'Should return image data or success, not an error',
            },
            {
                id: 'capture-display-0',
                description: 'Capture specific display index',
                mcpCall: { tool: 'capture_screen', args: { display: 0 } },
                verify: 'Should return image data for display 0',
            },
            {
                id: 'capture-display-1',
                description: 'Capture second display (if available)',
                mcpCall: { tool: 'capture_screen', args: { display: 1 } },
                verify: 'Should return image data for display 1, or fall back to display 0 if only one monitor',
            },
        ],
    };
}

async function run(options = {}) {
    const t = createTestContext('screen');
    t.skip('All tests', 'MCP-driven suite — use --mode plan');
    return t.getResults();
}

module.exports = { run, getPlan };
