/**
 * Tests for MemorySync file watcher and debounce behavior
 */
const { describe, it } = require('node:test');
const assert = require('node:assert');
const { debounce } = require('./utils');

describe('MemorySync debounce', () => {
    it('debounce utility should coalesce rapid calls', async () => {
        let callCount = 0;
        const fn = debounce(() => { callCount++; }, 50);

        fn(); fn(); fn(); fn(); fn();  // 5 rapid calls
        assert.strictEqual(callCount, 0, 'Should not fire yet');

        await new Promise(r => setTimeout(r, 100));
        assert.strictEqual(callCount, 1, 'Should fire exactly once');
    });

    it('debounce should reset timer on each call', async () => {
        let callCount = 0;
        const fn = debounce(() => { callCount++; }, 50);

        fn();
        await new Promise(r => setTimeout(r, 30));
        fn();  // Reset timer
        await new Promise(r => setTimeout(r, 30));
        assert.strictEqual(callCount, 0, 'Should not fire yet (timer was reset)');

        await new Promise(r => setTimeout(r, 60));
        assert.strictEqual(callCount, 1, 'Should fire once after final reset');
    });

    it('MemorySync constructor should accept custom debounceMs', () => {
        const MemorySync = require('./sync');
        const mockManager = { config: { memoryDir: '/tmp/test' }, init: async () => {} };
        const sync = new MemorySync(mockManager, { debounceMs: 3000 });
        assert.strictEqual(sync.options.debounceMs, 3000);
    });

    it('MemorySync should default debounceMs to 1500', () => {
        const MemorySync = require('./sync');
        const mockManager = { config: { memoryDir: '/tmp/test' }, init: async () => {} };
        const sync = new MemorySync(mockManager);
        assert.strictEqual(sync.options.debounceMs, 1500);
    });
});
