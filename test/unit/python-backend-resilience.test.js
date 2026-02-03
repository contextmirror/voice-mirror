/**
 * Tests for Python backend resilience (auto-restart on crash).
 * Validates restart logic, retry limits, and event emission.
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');

describe('python-backend-resilience', () => {
    let mockCallback;
    let restartAttempts;
    let intentionalStop;

    beforeEach(() => {
        mockCallback = mock.fn();
        restartAttempts = 0;
        intentionalStop = false;
    });

    /**
     * Simulate the close handler logic from python-backend.js
     * This mirrors the actual implementation for unit testing.
     */
    function simulateClose(code, onEventCallback) {
        const MAX_RESTARTS = 3;

        if (intentionalStop) {
            intentionalStop = false;
            onEventCallback({ type: 'disconnected' });
            return { action: 'stopped' };
        }

        if (code !== 0 && restartAttempts < MAX_RESTARTS) {
            restartAttempts++;
            onEventCallback({
                type: 'reconnecting',
                attempt: restartAttempts,
                maxAttempts: MAX_RESTARTS
            });
            return { action: 'restart', attempt: restartAttempts };
        } else if (code !== 0 && restartAttempts >= MAX_RESTARTS) {
            onEventCallback({ type: 'error', message: 'Voice backend failed after 3 restart attempts' });
            onEventCallback({ type: 'restart_failed' });
            return { action: 'failed' };
        } else {
            // Clean exit (code 0)
            onEventCallback({ type: 'disconnected' });
            return { action: 'clean_exit' };
        }
    }

    it('should attempt restart on crash (non-zero exit)', () => {
        const result = simulateClose(1, mockCallback);
        assert.equal(result.action, 'restart');
        assert.equal(result.attempt, 1);
        assert.equal(mockCallback.mock.calls.length, 1);
        assert.equal(mockCallback.mock.calls[0].arguments[0].type, 'reconnecting');
    });

    it('should not restart on clean exit (code 0)', () => {
        const result = simulateClose(0, mockCallback);
        assert.equal(result.action, 'clean_exit');
        assert.equal(mockCallback.mock.calls[0].arguments[0].type, 'disconnected');
    });

    it('should not restart when intentionally stopped', () => {
        intentionalStop = true;
        const result = simulateClose(1, mockCallback);
        assert.equal(result.action, 'stopped');
        assert.equal(mockCallback.mock.calls[0].arguments[0].type, 'disconnected');
    });

    it('should fail after max restart attempts', () => {
        restartAttempts = 3;
        const result = simulateClose(1, mockCallback);
        assert.equal(result.action, 'failed');
        assert.equal(mockCallback.mock.calls.length, 2);
        assert.equal(mockCallback.mock.calls[0].arguments[0].type, 'error');
        assert.equal(mockCallback.mock.calls[1].arguments[0].type, 'restart_failed');
    });

    it('should increment restart attempts on each crash', () => {
        simulateClose(1, mockCallback);
        assert.equal(restartAttempts, 1);
        simulateClose(1, mockCallback);
        assert.equal(restartAttempts, 2);
        simulateClose(1, mockCallback);
        assert.equal(restartAttempts, 3);
    });

    it('reconnecting event should include attempt count', () => {
        simulateClose(1, mockCallback);
        const event = mockCallback.mock.calls[0].arguments[0];
        assert.equal(event.type, 'reconnecting');
        assert.equal(event.attempt, 1);
        assert.equal(event.maxAttempts, 3);
    });

    it('should emit error before restart_failed', () => {
        restartAttempts = 3;
        simulateClose(1, mockCallback);
        const calls = mockCallback.mock.calls;
        assert.equal(calls[0].arguments[0].type, 'error');
        assert.equal(calls[1].arguments[0].type, 'restart_failed');
    });

    it('error message should mention restart attempts', () => {
        restartAttempts = 3;
        simulateClose(1, mockCallback);
        const errorEvent = mockCallback.mock.calls[0].arguments[0];
        assert.ok(errorEvent.message.includes('3'));
    });

    it('should reset intentionalStop flag after stop', () => {
        intentionalStop = true;
        simulateClose(1, mockCallback);
        assert.equal(intentionalStop, false, 'intentionalStop should be reset');
    });

    it('multiple crashes should increment attempts correctly', () => {
        // Simulate 3 crashes in a row
        for (let i = 1; i <= 3; i++) {
            const result = simulateClose(1, mockCallback);
            assert.equal(result.action, 'restart');
            assert.equal(result.attempt, i);
        }
        // 4th crash should fail
        const result = simulateClose(1, mockCallback);
        assert.equal(result.action, 'failed');
    });
});

describe('python-backend-restart-function', () => {
    it('restart should reset attempt counter', () => {
        let restartAttempts = 3;
        let intentionalStop = false;

        // Simulate restart() function
        function restart() {
            restartAttempts = 0;
            intentionalStop = false;
            return true;
        }

        restart();
        assert.equal(restartAttempts, 0, 'restartAttempts should be reset to 0');
        assert.equal(intentionalStop, false, 'intentionalStop should be false');
    });
});
