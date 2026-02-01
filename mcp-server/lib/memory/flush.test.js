/**
 * Tests for pre-compaction memory flush
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const MarkdownStore = require('./MarkdownStore');

describe('Pre-compaction memory flush', () => {
    let dir, store;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'flush-test-'));
        store = new MarkdownStore(dir);
        await store.init();
    });

    afterEach(() => {
        try { fs.rmSync(dir, { recursive: true }); } catch {}
    });

    it('should write decisions to core tier', async () => {
        await store.appendMemory('Decision: Use SQLite for storage', 'core');
        const tiers = await store.parseMemoryTiers();
        assert.ok(tiers.core.some(m => m.includes('Use SQLite for storage')));
    });

    it('should write summary to stable tier', async () => {
        await store.appendMemory('Session summary: Implemented memory system', 'stable');
        const tiers = await store.parseMemoryTiers();
        assert.ok(tiers.stable.some(m => m.includes('Implemented memory system')));
    });

    it('should write action items to notes tier', async () => {
        await store.appendMemory('TODO: Add more tests', 'notes');
        const tiers = await store.parseMemoryTiers();
        assert.ok(tiers.notes.some(m => m.includes('Add more tests')));
    });

    it('should write multiple items across tiers', async () => {
        await store.appendMemory('Decision: Use vector search', 'core');
        await store.appendMemory('Session summary: Built search', 'stable');
        await store.appendMemory('Topics discussed: search, embeddings', 'stable');
        await store.appendMemory('TODO: Optimize queries', 'notes');

        const tiers = await store.parseMemoryTiers();
        assert.strictEqual(tiers.core.length, 1);
        assert.strictEqual(tiers.stable.length, 2);
        assert.strictEqual(tiers.notes.length, 1);
    });

    it('should include timestamps on flushed memories', async () => {
        await store.appendMemory('Decision: Use WAL mode', 'core');
        const { content } = await store.readMemory();
        assert.ok(content.includes('<!--'), 'Should have timestamp comment');
    });
});
