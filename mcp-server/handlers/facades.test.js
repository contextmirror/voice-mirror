/**
 * Tests for facade tool handlers (memory_manage, n8n_manage, browser_manage).
 *
 * Stubs out underlying handlers so tests run without database / network.
 */

const { describe, it, beforeEach, afterEach, mock } = require('node:test');
const assert = require('node:assert/strict');

// ---------------------------------------------------------------------------
// Stub helpers — replace real handler modules before requiring facades
// ---------------------------------------------------------------------------

const OK = { content: [{ type: 'text', text: 'ok' }] };

// Build a fresh facades module with stubbed dependencies for each test
function buildFacades(overrides = {}) {
    // Clear caches so require() picks up fresh mocks
    const facadesPath = require.resolve('./facades');
    const memoryPath = require.resolve('./memory');
    const browserPath = require.resolve('./browser');
    const n8nPath = require.resolve('./n8n');
    delete require.cache[facadesPath];
    delete require.cache[memoryPath];
    delete require.cache[browserPath];
    delete require.cache[n8nPath];

    // Stub memory handlers
    require.cache[memoryPath] = {
        id: memoryPath,
        filename: memoryPath,
        loaded: true,
        exports: {
            handleMemorySearch: overrides.handleMemorySearch || (async () => OK),
            handleMemoryGet: overrides.handleMemoryGet || (async () => OK),
            handleMemoryRemember: overrides.handleMemoryRemember || (async () => OK),
            handleMemoryForget: overrides.handleMemoryForget || (async () => OK),
            handleMemoryStats: overrides.handleMemoryStats || (async () => OK),
            handleMemoryFlush: overrides.handleMemoryFlush || (async () => OK),
        }
    };

    // Stub browser handlers
    require.cache[browserPath] = {
        id: browserPath,
        filename: browserPath,
        loaded: true,
        exports: {
            handleBrowserControl: overrides.handleBrowserControl || (async () => OK),
            handleBrowserSearch: overrides.handleBrowserSearch || (async () => OK),
            handleBrowserFetch: overrides.handleBrowserFetch || (async () => OK),
        }
    };

    // Stub n8n handlers
    require.cache[n8nPath] = {
        id: n8nPath,
        filename: n8nPath,
        loaded: true,
        exports: {
            handleN8nListWorkflows: overrides.handleN8nListWorkflows || (async () => OK),
            handleN8nGetWorkflow: overrides.handleN8nGetWorkflow || (async () => OK),
            handleN8nCreateWorkflow: overrides.handleN8nCreateWorkflow || (async () => OK),
            handleN8nDeleteWorkflow: overrides.handleN8nDeleteWorkflow || (async () => OK),
            handleN8nTriggerWorkflow: overrides.handleN8nTriggerWorkflow || (async () => OK),
            handleN8nGetExecutions: overrides.handleN8nGetExecutions || (async () => OK),
        }
    };

    return require('./facades');
}

// ---------------------------------------------------------------------------
// memory_manage
// ---------------------------------------------------------------------------

describe('memory_manage facade', () => {
    it('requires action parameter', async () => {
        const { handleMemoryManage } = buildFacades();
        const result = await handleMemoryManage({});
        assert.ok(result.isError);
        assert.ok(result.content[0].text.includes('action is required'));
    });

    it('rejects unknown action', async () => {
        const { handleMemoryManage } = buildFacades();
        const result = await handleMemoryManage({ action: 'explode' });
        assert.ok(result.isError);
        assert.ok(result.content[0].text.includes('Unknown memory action'));
    });

    it('routes search to handleMemorySearch', async () => {
        let called = false;
        const { handleMemoryManage } = buildFacades({
            handleMemorySearch: async (args) => { called = true; return OK; }
        });
        await handleMemoryManage({ action: 'search', query: 'test' });
        assert.ok(called);
    });

    it('routes remember to handleMemoryRemember', async () => {
        let called = false;
        const { handleMemoryManage } = buildFacades({
            handleMemoryRemember: async (args) => { called = true; return OK; }
        });
        await handleMemoryManage({ action: 'remember', content: 'hello' });
        assert.ok(called);
    });

    it('blocks forget without confirmed:true', async () => {
        let called = false;
        const { handleMemoryManage } = buildFacades({
            handleMemoryForget: async () => { called = true; return OK; }
        });
        const result = await handleMemoryManage({ action: 'forget', content_or_id: 'x' });
        assert.ok(!called, 'handleMemoryForget should not be called');
        assert.ok(result.content[0].text.includes('CONFIRMATION REQUIRED'));
    });

    it('allows forget with confirmed:true', async () => {
        let called = false;
        const { handleMemoryManage } = buildFacades({
            handleMemoryForget: async () => { called = true; return OK; }
        });
        await handleMemoryManage({ action: 'forget', content_or_id: 'x', confirmed: true });
        assert.ok(called);
    });

    it('routes stats to handleMemoryStats', async () => {
        let called = false;
        const { handleMemoryManage } = buildFacades({
            handleMemoryStats: async () => { called = true; return OK; }
        });
        await handleMemoryManage({ action: 'stats' });
        assert.ok(called);
    });

    it('routes flush to handleMemoryFlush', async () => {
        let called = false;
        const { handleMemoryManage } = buildFacades({
            handleMemoryFlush: async () => { called = true; return OK; }
        });
        await handleMemoryManage({ action: 'flush', topics: ['a'] });
        assert.ok(called);
    });
});

// ---------------------------------------------------------------------------
// n8n_manage
// ---------------------------------------------------------------------------

describe('n8n_manage facade', () => {
    it('requires action parameter', async () => {
        const { handleN8nManage } = buildFacades();
        const result = await handleN8nManage({});
        assert.ok(result.isError);
        assert.ok(result.content[0].text.includes('action is required'));
    });

    it('rejects unknown action', async () => {
        const { handleN8nManage } = buildFacades();
        const result = await handleN8nManage({ action: 'nope' });
        assert.ok(result.isError);
        assert.ok(result.content[0].text.includes('Unknown n8n action'));
    });

    it('routes list to handleN8nListWorkflows', async () => {
        let called = false;
        const { handleN8nManage } = buildFacades({
            handleN8nListWorkflows: async () => { called = true; return OK; }
        });
        await handleN8nManage({ action: 'list' });
        assert.ok(called);
    });

    it('routes get to handleN8nGetWorkflow', async () => {
        let called = false;
        const { handleN8nManage } = buildFacades({
            handleN8nGetWorkflow: async () => { called = true; return OK; }
        });
        await handleN8nManage({ action: 'get', workflow_id: '1' });
        assert.ok(called);
    });

    it('blocks delete without confirmed:true', async () => {
        let called = false;
        const { handleN8nManage } = buildFacades({
            handleN8nDeleteWorkflow: async () => { called = true; return OK; }
        });
        const result = await handleN8nManage({ action: 'delete', workflow_id: '1' });
        assert.ok(!called, 'handleN8nDeleteWorkflow should not be called');
        assert.ok(result.content[0].text.includes('CONFIRMATION REQUIRED'));
    });

    it('allows delete with confirmed:true', async () => {
        let called = false;
        const { handleN8nManage } = buildFacades({
            handleN8nDeleteWorkflow: async () => { called = true; return OK; }
        });
        await handleN8nManage({ action: 'delete', workflow_id: '1', confirmed: true });
        assert.ok(called);
    });

    it('routes trigger to handleN8nTriggerWorkflow', async () => {
        let called = false;
        const { handleN8nManage } = buildFacades({
            handleN8nTriggerWorkflow: async () => { called = true; return OK; }
        });
        await handleN8nManage({ action: 'trigger', workflow_id: '1' });
        assert.ok(called);
    });

    it('routes status to handleN8nGetExecutions', async () => {
        let called = false;
        const { handleN8nManage } = buildFacades({
            handleN8nGetExecutions: async () => { called = true; return OK; }
        });
        await handleN8nManage({ action: 'status', workflow_id: '1' });
        assert.ok(called);
    });
});

// ---------------------------------------------------------------------------
// browser_manage
// ---------------------------------------------------------------------------

describe('browser_manage facade', () => {
    it('requires action parameter', async () => {
        const { handleBrowserManage } = buildFacades();
        const result = await handleBrowserManage({});
        assert.ok(result.isError);
        assert.ok(result.content[0].text.includes('action is required'));
    });

    it('rejects unknown action', async () => {
        const { handleBrowserManage } = buildFacades();
        const result = await handleBrowserManage({ action: 'fly' });
        assert.ok(result.isError);
        assert.ok(result.content[0].text.includes('Unknown browser action'));
    });

    it('routes search to handleBrowserSearch', async () => {
        let called = false;
        const { handleBrowserManage } = buildFacades({
            handleBrowserSearch: async () => { called = true; return OK; }
        });
        await handleBrowserManage({ action: 'search', query: 'test' });
        assert.ok(called);
    });

    it('routes fetch to handleBrowserFetch', async () => {
        let called = false;
        const { handleBrowserManage } = buildFacades({
            handleBrowserFetch: async () => { called = true; return OK; }
        });
        await handleBrowserManage({ action: 'fetch', url: 'https://example.com' });
        assert.ok(called);
    });

    it('routes open to handleBrowserControl with correct action', async () => {
        let capturedAction;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action, args) => { capturedAction = action; return OK; }
        });
        await handleBrowserManage({ action: 'open', url: 'https://example.com' });
        assert.equal(capturedAction, 'open');
    });

    it('routes start to handleBrowserControl', async () => {
        let capturedAction;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action) => { capturedAction = action; return OK; }
        });
        await handleBrowserManage({ action: 'start' });
        assert.equal(capturedAction, 'start');
    });

    it('routes stop to handleBrowserControl', async () => {
        let capturedAction;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action) => { capturedAction = action; return OK; }
        });
        await handleBrowserManage({ action: 'stop' });
        assert.equal(capturedAction, 'stop');
    });

    it('routes click to handleBrowserControl act with click kind', async () => {
        let capturedArgs;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action, args) => { capturedArgs = { action, args }; return OK; }
        });
        await handleBrowserManage({ action: 'click', ref: 'e5' });
        assert.equal(capturedArgs.action, 'act');
        assert.equal(capturedArgs.args.request.kind, 'click');
        assert.equal(capturedArgs.args.request.ref, 'e5');
    });

    it('routes type to handleBrowserControl act with type kind', async () => {
        let capturedArgs;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action, args) => { capturedArgs = { action, args }; return OK; }
        });
        await handleBrowserManage({ action: 'type', ref: 'e3', text: 'hello' });
        assert.equal(capturedArgs.action, 'act');
        assert.equal(capturedArgs.args.request.kind, 'type');
        assert.equal(capturedArgs.args.request.text, 'hello');
    });

    it('routes snapshot to handleBrowserControl', async () => {
        let capturedAction;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action) => { capturedAction = action; return OK; }
        });
        await handleBrowserManage({ action: 'snapshot' });
        assert.equal(capturedAction, 'snapshot');
    });

    it('routes screenshot to handleBrowserControl', async () => {
        let capturedAction;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action) => { capturedAction = action; return OK; }
        });
        await handleBrowserManage({ action: 'screenshot' });
        assert.equal(capturedAction, 'screenshot');
    });

    it('routes tabs to handleBrowserControl', async () => {
        let capturedAction;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action) => { capturedAction = action; return OK; }
        });
        await handleBrowserManage({ action: 'tabs' });
        assert.equal(capturedAction, 'tabs');
    });

    it('routes navigate to handleBrowserControl', async () => {
        let capturedAction;
        const { handleBrowserManage } = buildFacades({
            handleBrowserControl: async (action) => { capturedAction = action; return OK; }
        });
        await handleBrowserManage({ action: 'navigate', url: 'https://example.com' });
        assert.equal(capturedAction, 'navigate');
    });
});
