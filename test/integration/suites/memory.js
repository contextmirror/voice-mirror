/**
 * Memory test suite — 5 memory CRUD tests (plan mode).
 */

const { createTestContext } = require('../lib/harness');

function getPlan() {
    const testId = `integration-test-${Date.now()}`;
    return {
        suite: 'memory',
        mode: 'mcp',
        description: 'Memory CRUD tests via MCP',
        steps: [
            {
                id: 'remember-search',
                description: 'Store a memory and search for it',
                mcpCall: [
                    { tool: 'memory_remember', args: { content: `Test memory ${testId}: the sky is blue`, tier: 'notes' } },
                    { tool: 'memory_search', args: { query: testId } },
                ],
                verify: `Search results should contain "${testId}"`,
            },
            {
                id: 'memory-tier',
                description: 'Verify memory stored with notes tier',
                mcpCall: { tool: 'memory_search', args: { query: testId } },
                verify: 'Result should exist (stored as notes tier)',
            },
            {
                id: 'forget',
                description: 'Forget the test memory',
                mcpCall: [
                    { tool: 'memory_forget', args: { content_or_id: `Test memory ${testId}: the sky is blue` } },
                    { tool: 'memory_search', args: { query: testId } },
                ],
                verify: 'Search should return 0 results after forget',
            },
            {
                id: 'stats',
                description: 'Get memory stats',
                mcpCall: { tool: 'memory_stats', args: {} },
                verify: 'Should return storage and index info',
            },
            {
                id: 'empty-search',
                description: 'Search for random UUID returns empty',
                mcpCall: { tool: 'memory_search', args: { query: 'zzz-nonexistent-xyz-999' } },
                verify: 'Should return 0 or no relevant results',
            },
        ],
    };
}

async function run(options = {}) {
    const t = createTestContext('memory');
    t.skip('All tests', 'MCP-driven suite — use --mode plan');
    return t.getResults();
}

module.exports = { run, getPlan };
