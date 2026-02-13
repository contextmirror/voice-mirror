/**
 * Integration test scaffold: verify service factories return objects
 * with the standard lifecycle interface (start, stop, isRunning).
 *
 * These tests only check the returned shape — they do NOT actually start
 * services (avoiding side effects like file I/O, network, Electron deps).
 */

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

/**
 * Helper: assert that an object has start/stop/isRunning functions.
 */
function assertLifecycleMethods(obj, label) {
    assert.equal(typeof obj.start, 'function', `${label}.start should be a function`);
    assert.equal(typeof obj.stop, 'function', `${label}.stop should be a function`);
    assert.equal(typeof obj.isRunning, 'function', `${label}.isRunning should be a function`);
}

describe('service lifecycle interface', () => {
    it('createJsonFileWatcher returns start/stop/isRunning', () => {
        const { createJsonFileWatcher } = require('../../electron/lib/json-file-watcher');
        const instance = createJsonFileWatcher({
            watchDir: __dirname,
            filename: 'dummy.json',
            onEvent: () => {},
        });
        assertLifecycleMethods(instance, 'JsonFileWatcher');
    });

    it('createPerfMonitor returns start/stop/isRunning', () => {
        const { createPerfMonitor } = require('../../electron/services/perf-monitor');
        const instance = createPerfMonitor();
        assertLifecycleMethods(instance, 'PerfMonitor');
    });

    it('createUpdateChecker returns start/stop', () => {
        const { createUpdateChecker } = require('../../electron/services/update-checker');
        const instance = createUpdateChecker({ projectRoot: __dirname });
        assert.equal(typeof instance.start, 'function', 'UpdateChecker.start should be a function');
        assert.equal(typeof instance.stop, 'function', 'UpdateChecker.stop should be a function');
    });

    it('createLogger returns init/log/close and level methods', () => {
        const { createLogger } = require('../../electron/services/logger');
        const instance = createLogger();
        assert.equal(typeof instance.init, 'function');
        assert.equal(typeof instance.log, 'function');
        assert.equal(typeof instance.close, 'function');
        assert.equal(typeof instance.info, 'function');
        assert.equal(typeof instance.warn, 'function');
        assert.equal(typeof instance.error, 'function');
        assert.equal(typeof instance.debug, 'function');
    });

    // Services that require Electron are skipped in plain Node tests.
    // They would need an Electron test harness (e.g., electron-mocha).
    it.skip('createHotkeyManager requires Electron runtime', () => {
        // const { createHotkeyManager } = require('../../electron/services/hotkey-manager');
    });

    it.skip('createScreenCaptureWatcher requires Electron runtime', () => {
        // const { createScreenCaptureWatcher } = require('../../electron/services/screen-capture-watcher');
    });
});
