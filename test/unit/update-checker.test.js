/**
 * Tests for update-checker service
 */

const { describe, it, beforeEach, mock } = require('node:test');
const assert = require('node:assert/strict');
const { createUpdateChecker } = require('../../electron/services/update-checker');

describe('update-checker', () => {
    it('exports createUpdateChecker', () => {
        assert.equal(typeof createUpdateChecker, 'function');
    });

    it('returns an object with check, applyUpdate, start, stop', () => {
        const checker = createUpdateChecker({});
        assert.equal(typeof checker.check, 'function');
        assert.equal(typeof checker.applyUpdate, 'function');
        assert.equal(typeof checker.start, 'function');
        assert.equal(typeof checker.stop, 'function');
    });

    it('check() returns null on error (no git repo)', async () => {
        const checker = createUpdateChecker({ appDir: '/nonexistent/path' });
        const result = await checker.check();
        assert.equal(result, null);
    });

    it('check() logs when skipping', async () => {
        const logs = [];
        const checker = createUpdateChecker({
            appDir: '/nonexistent/path',
            log: (level, msg) => logs.push({ level, msg })
        });
        await checker.check();
        assert.ok(logs.length > 0);
        assert.ok(logs[0].msg.includes('Update check skipped'));
    });

    it('start() and stop() manage intervals', () => {
        const checker = createUpdateChecker({ appDir: '/nonexistent/path' });
        checker.start(60000);
        // Should not throw
        checker.stop();
        // Double stop should not throw
        checker.stop();
    });

    it('applyUpdate() returns error on failure', async () => {
        const checker = createUpdateChecker({ appDir: '/nonexistent/path' });
        const result = await checker.applyUpdate();
        assert.equal(result.success, false);
        assert.ok(result.error);
    });

    it('applyUpdate() sends error status via safeSend', async () => {
        const sent = [];
        const checker = createUpdateChecker({
            appDir: '/nonexistent/path',
            safeSend: (channel, data) => sent.push({ channel, data })
        });
        await checker.applyUpdate();
        // Should have sent pulling status then error status
        assert.ok(sent.length >= 2);
        assert.equal(sent[0].channel, 'update-status');
        assert.equal(sent[0].data.status, 'pulling');
        assert.equal(sent[sent.length - 1].data.status, 'error');
    });
});
