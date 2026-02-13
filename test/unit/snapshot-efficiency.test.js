const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Mock cdp module
const mockCdp = {
    sendCommand: mock.fn(async () => ({})),
    onEvent: mock.fn(),
    isAttached: () => true,
    getUrl: async () => 'https://example.com',
    getTitle: async () => 'Test',
    evaluate: mock.fn(async () => ({ result: { value: '' } })),
    getAccessibilityTree: mock.fn(async () => []),
    getWebContents: () => null
};

const Module = require('module');
const originalResolve = Module._resolveFilename;
const cdpPath = require.resolve('../../electron/browser/webview-cdp');
Module._resolveFilename = function (request, parent, ...rest) {
    if (request === './webview-cdp' || request === '../browser/webview-cdp') {
        return cdpPath;
    }
    return originalResolve.call(this, request, parent, ...rest);
};
require.cache[cdpPath] = {
    id: cdpPath,
    filename: cdpPath,
    loaded: true,
    exports: mockCdp
};

const { takeSnapshot, resetSnapshotHash } = require('../../electron/browser/webview-snapshot');

// Set up consistent DOM snapshot mock
let currentDomContent = '- button "OK"';
let currentPageText = 'Page text content';

function setupDomMock(domContent = '- button "OK"', pageText = 'Page text content') {
    currentDomContent = domContent;
    currentPageText = pageText;
    mockCdp.getAccessibilityTree.mock.mockImplementation(async () => []);
    mockCdp.evaluate.mock.mockImplementation(async (expr) => {
        if (typeof expr === 'string') {
            // Table extraction (contains querySelectorAll('table') — check before innerText
            // since the table expression also contains 'innerText')
            if (expr.includes("querySelectorAll('table')") || expr.includes('querySelectorAll(\'table\')')) {
                return { result: { value: '' } };
            }
            // Main page text extraction (contains body.innerText)
            if (expr.includes('body.innerText')) {
                const match = expr.match(/substring\(0,\s*(\d+)\)/);
                const limit = match ? parseInt(match[1]) : 4000;
                return { result: { value: currentPageText.substring(0, limit) } };
            }
            // Clear vmref markers (short expression, contains removeAttribute)
            if (expr.includes('removeAttribute') && expr.includes('data-vmref')) {
                return { result: { value: undefined } };
            }
        }
        // DOM snapshot fallback (the long walk function)
        return { result: { value: currentDomContent } };
    });
}

describe('snapshot efficiency', () => {
    beforeEach(() => {
        mockCdp.sendCommand.mock.resetCalls();
        mockCdp.evaluate.mock.resetCalls();
        mockCdp.getAccessibilityTree.mock.resetCalls();
        resetSnapshotHash();
    });

    describe('ifChanged optimization', () => {
        it('first snapshot returns full data', async () => {
            setupDomMock('- button "Submit"\n- link "Home"');

            const result = await takeSnapshot({ format: 'role' });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.unchanged, undefined);
            assert.ok(result.snapshot, 'Should have snapshot text');
            assert.ok(result.refs, 'Should have refs');
        });

        it('second identical snapshot with ifChanged returns unchanged', async () => {
            setupDomMock('- button "Submit"\n- link "Home"');

            // First snapshot
            const first = await takeSnapshot({ format: 'role' });
            assert.strictEqual(first.ok, true);
            assert.strictEqual(first.unchanged, undefined);

            // Second identical snapshot with ifChanged
            const second = await takeSnapshot({ format: 'role', ifChanged: true });
            assert.strictEqual(second.ok, true);
            assert.strictEqual(second.unchanged, true, 'Should return unchanged: true');
            assert.ok(second.stats, 'Should include stats');
            assert.strictEqual(second.snapshot, undefined, 'Should not include full snapshot');
        });

        it('returns full snapshot when page changed', async () => {
            setupDomMock('- button "Submit"');

            // First snapshot
            await takeSnapshot({ format: 'role' });

            // Change page content significantly
            currentDomContent = '- heading "New Page" [level=1]\n- link "Back to Home"\n- button "Cancel"\n- textbox "Search"';

            // Second snapshot with ifChanged — different content
            const second = await takeSnapshot({ format: 'role', ifChanged: true });
            assert.strictEqual(second.ok, true);
            assert.strictEqual(second.unchanged, undefined, 'Should NOT be unchanged');
            assert.ok(second.snapshot, 'Should have full snapshot');
        });

        it('ifChanged=false (default) always returns full snapshot', async () => {
            setupDomMock('- button "Submit"');

            // First snapshot
            await takeSnapshot({ format: 'role' });

            // Second snapshot without ifChanged
            const second = await takeSnapshot({ format: 'role' });
            assert.strictEqual(second.ok, true);
            assert.strictEqual(second.unchanged, undefined);
            assert.ok(second.snapshot, 'Should have full snapshot');
        });
    });

    describe('maxPageText option', () => {
        it('maxPageText=0 skips page text extraction', async () => {
            setupDomMock('- button "OK"', 'This is page text that should be skipped');

            const result = await takeSnapshot({ format: 'role', maxPageText: 0 });
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.pageText, '', 'Page text should be empty when maxPageText=0');
        });

        it('default behavior includes page text', async () => {
            setupDomMock('- button "OK"', 'Some visible page text');

            const result = await takeSnapshot({ format: 'role' });
            assert.strictEqual(result.ok, true);
            assert.ok(result.pageText.length > 0, 'Default should include page text');
        });

        it('maxPageText=500 truncates page text', async () => {
            const longText = 'A'.repeat(2000);
            setupDomMock('- button "OK"', longText);

            const result = await takeSnapshot({ format: 'role', maxPageText: 500 });
            assert.strictEqual(result.ok, true);
            // The text goes through cleanup which may alter length, but it should be bounded
            assert.ok(result.pageText.length <= 600, `Page text should be bounded (got ${result.pageText.length})`);
        });
    });

    describe('default behavior unchanged', () => {
        it('no opts returns full snapshot with page text as before', async () => {
            setupDomMock('- heading "Test Page" [level=1]\n- button "Click me"', 'Hello World');

            const result = await takeSnapshot({});
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.format, 'role');
            assert.ok(result.snapshot, 'Should have snapshot');
            assert.ok(result.refs, 'Should have refs');
            assert.ok(result.stats, 'Should have stats');
            assert.ok(result.pageText.includes('Hello World'), 'Should include page text');
        });
    });
});
