const { describe, it, beforeEach } = require('node:test');
const assert = require('node:assert');

// ── browser-watcher: tabs/open/close_tab/focus handlers ──

describe('browser-watcher action dispatch', () => {
    // We test the switch logic by requiring the module and checking
    // that it processes requests with the new action types.
    // Since browser-watcher uses file-based IPC, we test the switch
    // indirectly by verifying the source contains the expected cases.

    const fs = require('fs');
    const path = require('path');
    const watcherSrc = fs.readFileSync(
        path.join(__dirname, '../../electron/services/browser-watcher.js'), 'utf-8'
    );

    for (const action of ['tabs', 'open', 'close_tab', 'focus', 'search', 'fetch',
        'start', 'stop', 'status', 'navigate', 'screenshot', 'snapshot', 'act', 'console']) {
        it(`handles '${action}' action (has case in switch)`, () => {
            assert.ok(
                watcherSrc.includes(`case '${action}'`),
                `browser-watcher.js should have case '${action}' in its switch statement`
            );
        });
    }

    it('tabs handler returns array format', () => {
        // Verify the tabs handler constructs the expected response shape
        assert.ok(watcherSrc.includes('tabs:'), 'tabs handler should return a tabs array');
        assert.ok(watcherSrc.includes('targetId:'), 'tabs entries should include targetId');
    });
});

// ── webview-actions: evaluateAction accepts expression param ──

describe('evaluateAction parameter handling', () => {
    const fs = require('fs');
    const path = require('path');
    const actionsSrc = fs.readFileSync(
        path.join(__dirname, '../../electron/browser/webview-actions.js'), 'utf-8'
    );

    it('accepts opts.expression as alias for opts.fn', () => {
        assert.ok(
            actionsSrc.includes('opts.expression'),
            'evaluateAction should read opts.expression'
        );
    });

    it('accepts opts.fn as the primary parameter', () => {
        assert.ok(
            actionsSrc.includes('opts.fn'),
            'evaluateAction should read opts.fn'
        );
    });

    it('has timeout wrapping for evaluate calls', () => {
        assert.ok(
            actionsSrc.includes('withTimeout'),
            'evaluateAction should use a timeout wrapper'
        );
        assert.ok(
            actionsSrc.includes('Evaluate timed out'),
            'evaluateAction should have a timeout error message'
        );
    });

    it('uses clampTimeout for evaluate timeout', () => {
        // Ensure the timeout is configurable via opts.timeoutMs
        assert.ok(
            actionsSrc.includes('clampTimeout(opts.timeoutMs'),
            'evaluateAction should use clampTimeout with opts.timeoutMs'
        );
    });

    it('evaluates expressions directly via CDP (supports multi-statement code)', () => {
        // The old implementation wrapped everything in eval('(' + expr + ')') inside an IIFE,
        // which broke multi-statement expressions (const, let, loops, etc.)
        // The new implementation passes expressions directly to cdp.evaluate()
        assert.ok(
            !actionsSrc.includes("eval('(' +"),
            'evaluateAction should NOT wrap expressions in eval with parens (breaks multi-statement code)'
        );
    });

    it('reports evaluation errors instead of swallowing them', () => {
        // When an expression throws, the error details should be included in the response
        assert.ok(
            actionsSrc.includes('exceptionDetails'),
            'evaluateAction should check for exceptionDetails from CDP'
        );
        assert.ok(
            actionsSrc.includes('action: \'evaluate\', error:'),
            'evaluateAction should return error field when expression throws'
        );
    });
});

// ── pressAction: focus before key dispatch ──

describe('pressAction focus handling', () => {
    const fs = require('fs');
    const path = require('path');
    const actionsSrc = fs.readFileSync(
        path.join(__dirname, '../../electron/browser/webview-actions.js'), 'utf-8'
    );

    it('focuses document body before dispatching key events', () => {
        // Key events like PageDown only scroll if the page content has focus
        assert.ok(
            actionsSrc.includes("document.body?.focus()"),
            'pressAction should focus document.body before dispatching key events'
        );
    });
});

// ── webview-cdp: screenshot captureBeyondViewport ──

describe('captureScreenshot viewport behavior', () => {
    const fs = require('fs');
    const path = require('path');
    const cdpSrc = fs.readFileSync(
        path.join(__dirname, '../../electron/browser/webview-cdp.js'), 'utf-8'
    );

    it('uses captureBeyondViewport only when fullPage is requested', () => {
        assert.ok(
            cdpSrc.includes('captureBeyondViewport: !!opts.fullPage'),
            'captureBeyondViewport should be conditional on opts.fullPage'
        );
    });

    it('does NOT hardcode captureBeyondViewport to true', () => {
        assert.ok(
            !cdpSrc.includes('captureBeyondViewport: true'),
            'captureBeyondViewport should not be unconditionally true'
        );
    });
});

// ── MCP schema consistency: expression param in browser_act evaluate ──

describe('MCP browser_act schema consistency', () => {
    const fs = require('fs');
    const path = require('path');
    const mcpSrc = fs.readFileSync(
        path.join(__dirname, '../../mcp-server/tool-groups.js'), 'utf-8'
    );

    it('MCP schema defines expression property for evaluate', () => {
        assert.ok(
            mcpSrc.includes("expression: { type: 'string'"),
            'MCP schema should define expression property for evaluate action'
        );
    });

    it('webview-actions accepts expression parameter that MCP sends', () => {
        const actionsSrc = fs.readFileSync(
            path.join(__dirname, '../../electron/browser/webview-actions.js'), 'utf-8'
        );
        // The MCP sends {kind: "evaluate", expression: "..."} but action handler
        // originally only read opts.fn. Verify both are accepted.
        assert.ok(
            actionsSrc.includes('opts.fn || opts.expression'),
            'evaluateAction should accept both fn and expression parameters'
        );
    });
});
