const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert');

// Mock cdp module before requiring action/controller modules
const mockCdp = {
    sendCommand: mock.fn(async () => ({})),
    onEvent: mock.fn(),
    isAttached: () => true,
    getUrl: async () => 'https://example.com',
    getTitle: async () => 'Test Page',
    evaluate: mock.fn(async () => ({ result: { value: '' } })),
    getAccessibilityTree: mock.fn(async () => [])
};

// Replace the real cdp module with our mock
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

const { dialogAcceptAction, dialogDismissAction } = require('../../electron/browser/webview-actions');
const { setupDialogListener, getDialogState, getStatus } = require('../../electron/browser/browser-controller');

describe('dialog handling', () => {
    beforeEach(() => {
        mockCdp.sendCommand.mock.resetCalls();
        mockCdp.onEvent.mock.resetCalls();
        // Reset dialog state
        const ds = getDialogState();
        ds.active = null;
        ds.history = [];
    });

    describe('dialogAcceptAction', () => {
        it('calls Page.handleJavaScriptDialog with accept: true', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async () => ({}));
            const result = await dialogAcceptAction({});
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.action, 'dialog_accept');

            const calls = mockCdp.sendCommand.mock.calls;
            const handleCall = calls.find(c => c.arguments[0] === 'Page.handleJavaScriptDialog');
            assert.ok(handleCall, 'Should call Page.handleJavaScriptDialog');
            assert.strictEqual(handleCall.arguments[1].accept, true);
        });

        it('passes promptText when provided', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async () => ({}));
            await dialogAcceptAction({ promptText: 'my input' });

            const calls = mockCdp.sendCommand.mock.calls;
            const handleCall = calls.find(c => c.arguments[0] === 'Page.handleJavaScriptDialog');
            assert.ok(handleCall);
            assert.strictEqual(handleCall.arguments[1].promptText, 'my input');
        });

        it('does not include promptText when not provided', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async () => ({}));
            await dialogAcceptAction({});

            const calls = mockCdp.sendCommand.mock.calls;
            const handleCall = calls.find(c => c.arguments[0] === 'Page.handleJavaScriptDialog');
            assert.ok(handleCall);
            assert.strictEqual(handleCall.arguments[1].promptText, undefined);
        });
    });

    describe('dialogDismissAction', () => {
        it('calls Page.handleJavaScriptDialog with accept: false', async () => {
            mockCdp.sendCommand.mock.mockImplementation(async () => ({}));
            const result = await dialogDismissAction({});
            assert.strictEqual(result.ok, true);
            assert.strictEqual(result.action, 'dialog_dismiss');

            const calls = mockCdp.sendCommand.mock.calls;
            const handleCall = calls.find(c => c.arguments[0] === 'Page.handleJavaScriptDialog');
            assert.ok(handleCall, 'Should call Page.handleJavaScriptDialog');
            assert.strictEqual(handleCall.arguments[1].accept, false);
        });
    });

    describe('dialog state tracking', () => {
        it('setupDialogListener registers CDP event listeners', async () => {
            await setupDialogListener();

            const onEventCalls = mockCdp.onEvent.mock.calls;
            const events = onEventCalls.map(c => c.arguments[0]);
            assert.ok(events.includes('Page.javascriptDialogOpening'), 'Should listen for dialogOpening');
            assert.ok(events.includes('Page.javascriptDialogClosed'), 'Should listen for dialogClosed');
        });

        it('tracks dialog opened state', async () => {
            await setupDialogListener();

            // Find the dialogOpening callback and invoke it
            const openingCall = mockCdp.onEvent.mock.calls.find(
                c => c.arguments[0] === 'Page.javascriptDialogOpening'
            );
            assert.ok(openingCall);
            const openingCb = openingCall.arguments[1];

            openingCb({
                type: 'confirm',
                message: 'Are you sure?',
                defaultPrompt: '',
                url: 'https://example.com'
            });

            const ds = getDialogState();
            assert.ok(ds.active, 'Dialog should be active');
            assert.strictEqual(ds.active.type, 'confirm');
            assert.strictEqual(ds.active.message, 'Are you sure?');
        });

        it('clears dialog on close and adds to history', async () => {
            await setupDialogListener();

            // Find callbacks
            const openingCb = mockCdp.onEvent.mock.calls.find(
                c => c.arguments[0] === 'Page.javascriptDialogOpening'
            ).arguments[1];
            const closedCb = mockCdp.onEvent.mock.calls.find(
                c => c.arguments[0] === 'Page.javascriptDialogClosed'
            ).arguments[1];

            // Open dialog
            openingCb({ type: 'alert', message: 'Hello' });
            assert.ok(getDialogState().active);

            // Close dialog
            closedCb({});
            assert.strictEqual(getDialogState().active, null, 'Active should be null after close');
            assert.strictEqual(getDialogState().history.length, 1, 'Should have 1 history entry');
            assert.strictEqual(getDialogState().history[0].type, 'alert');
        });
    });

    describe('getStatus includes dialog info', () => {
        it('includes dialog field when dialog is active', async () => {
            const ds = getDialogState();
            ds.active = {
                type: 'prompt',
                message: 'Enter name',
                defaultPrompt: 'default',
                timestamp: Date.now()
            };

            const status = await getStatus();
            assert.ok(status.dialog, 'Status should include dialog');
            assert.strictEqual(status.dialog.type, 'prompt');
            assert.strictEqual(status.dialog.message, 'Enter name');
        });

        it('does not include dialog field when no dialog is active', async () => {
            const ds = getDialogState();
            ds.active = null;

            const status = await getStatus();
            assert.strictEqual(status.dialog, undefined, 'Status should not include dialog');
        });
    });

    describe('snapshot includes dialog banner', () => {
        it('prepends dialog banner when dialog is active', async () => {
            const ds = getDialogState();
            ds.active = {
                type: 'confirm',
                message: 'Delete this?',
                defaultPrompt: '',
                timestamp: Date.now()
            };

            // Mock the AX tree to return something minimal so snapshot works
            mockCdp.getAccessibilityTree.mock.mockImplementation(async () => []);
            mockCdp.evaluate.mock.mockImplementation(async (expr) => {
                if (typeof expr === 'string' && expr.includes('innerText')) {
                    return { result: { value: 'Page content' } };
                }
                if (typeof expr === 'string' && expr.includes('querySelectorAll')) {
                    return { result: { value: '' } };
                }
                // DOM snapshot fallback
                return { result: { value: '- button "OK"' } };
            });

            const { takeSnapshot } = require('../../electron/browser/webview-snapshot');
            const result = await takeSnapshot({ format: 'role' });

            assert.ok(result.snapshot.includes('[DIALOG: confirm "Delete this?"]'),
                'Snapshot should include dialog banner');
            assert.ok(result.snapshot.includes('dialog_accept'),
                'Snapshot should mention dialog_accept action');
        });
    });
});
