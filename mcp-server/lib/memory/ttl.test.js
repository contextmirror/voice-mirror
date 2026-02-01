/**
 * Tests for memory tier TTL enforcement
 */
const { describe, it, before, after } = require('node:test');
const assert = require('node:assert');
const fs = require('fs');
const path = require('path');
const os = require('os');
const MarkdownStore = require('./MarkdownStore');

describe('Memory TTL', () => {
    let testDir;
    let store;

    before(() => {
        testDir = fs.mkdtempSync(path.join(os.tmpdir(), 'vm-ttl-test-'));
    });

    after(() => {
        fs.rmSync(testDir, { recursive: true, force: true });
    });

    it('should create store and init', async () => {
        store = new MarkdownStore(testDir);
        await store.init();
        const { content } = await store.readMemory();
        assert.ok(content.includes('## Core'));
    });

    it('appendMemory should add timestamp comment', async () => {
        await store.appendMemory('Test memory item', 'stable');
        const { content } = await store.readMemory();
        assert.ok(content.includes('- Test memory item <!-- '));
        // Verify ISO timestamp format
        const match = content.match(/<!-- (\d{4}-\d{2}-\d{2}T[\d:.]+Z?) -->/);
        assert.ok(match, 'Should contain ISO timestamp comment');
    });

    it('parseMemoryTiersWithDates should extract timestamps', async () => {
        const tiers = await store.parseMemoryTiersWithDates();
        assert.strictEqual(tiers.stable.length, 1);
        assert.strictEqual(tiers.stable[0].text, 'Test memory item');
        assert.ok(tiers.stable[0].savedAt instanceof Date);
        assert.ok(!isNaN(tiers.stable[0].savedAt.getTime()));
    });

    it('should not delete fresh memories', async () => {
        const removed = await store.cleanupExpiredMemories();
        assert.strictEqual(removed, 0);
        const tiers = await store.parseMemoryTiers();
        assert.strictEqual(tiers.stable.length, 1);
    });

    it('should delete expired stable memories (7 day TTL)', async () => {
        // Write a memory with a backdated timestamp (8 days ago)
        const eightDaysAgo = new Date(Date.now() - 8 * 24 * 60 * 60 * 1000).toISOString();
        const { content } = await store.readMemory();
        const backdated = content + `\n- Old stable memory <!-- ${eightDaysAgo} -->`;
        // We need to put it in the stable section - rewrite properly
        await store.writeMemory(`# Voice Mirror Memory

## Core (Permanent)

## Stable (7 days)
- Fresh stable memory <!-- ${new Date().toISOString()} -->
- Old stable memory <!-- ${eightDaysAgo} -->

## Notes
`);

        const removed = await store.cleanupExpiredMemories();
        assert.strictEqual(removed, 1);

        const tiers = await store.parseMemoryTiers();
        assert.strictEqual(tiers.stable.length, 1);
        assert.strictEqual(tiers.stable[0], 'Fresh stable memory');
    });

    it('should delete expired notes memories (24h TTL)', async () => {
        const twoDaysAgo = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
        const fresh = new Date().toISOString();

        await store.writeMemory(`# Voice Mirror Memory

## Core (Permanent)
- Permanent fact <!-- ${twoDaysAgo} -->

## Stable (7 days)
- Fresh stable <!-- ${fresh} -->

## Notes
- Fresh note <!-- ${fresh} -->
- Old note <!-- ${twoDaysAgo} -->
`);

        const removed = await store.cleanupExpiredMemories();
        assert.strictEqual(removed, 1); // Only old note removed

        const tiers = await store.parseMemoryTiers();
        assert.strictEqual(tiers.core.length, 1, 'Core memories should never be cleaned');
        assert.strictEqual(tiers.stable.length, 1);
        assert.strictEqual(tiers.notes.length, 1);
        assert.strictEqual(tiers.notes[0], 'Fresh note');
    });

    it('should never delete core memories regardless of age', async () => {
        const ancient = new Date(Date.now() - 365 * 24 * 60 * 60 * 1000).toISOString();

        await store.writeMemory(`# Voice Mirror Memory

## Core (Permanent)
- Ancient core memory <!-- ${ancient} -->

## Stable (7 days)

## Notes
`);

        const removed = await store.cleanupExpiredMemories();
        assert.strictEqual(removed, 0);

        const tiers = await store.parseMemoryTiers();
        assert.strictEqual(tiers.core.length, 1);
    });

    it('should handle memories without timestamps (skip them)', async () => {
        const old = new Date(Date.now() - 30 * 24 * 60 * 60 * 1000).toISOString();

        await store.writeMemory(`# Voice Mirror Memory

## Core (Permanent)

## Stable (7 days)
- No timestamp memory
- Has timestamp <!-- ${old} -->

## Notes
`);

        const removed = await store.cleanupExpiredMemories();
        assert.strictEqual(removed, 1); // Only the one with old timestamp

        const tiers = await store.parseMemoryTiers();
        assert.strictEqual(tiers.stable.length, 1);
        assert.strictEqual(tiers.stable[0], 'No timestamp memory');
    });

    it('should accept custom TTL values', async () => {
        const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
        const fresh = new Date().toISOString();

        await store.writeMemory(`# Voice Mirror Memory

## Core (Permanent)

## Stable (7 days)
- One hour old <!-- ${oneHourAgo} -->

## Notes
- Also one hour old <!-- ${oneHourAgo} -->
- Just added <!-- ${fresh} -->
`);

        // Set stable TTL to 30 minutes, notes to 30 minutes
        const removed = await store.cleanupExpiredMemories({
            stable: 30 * 60 * 1000,
            notes: 30 * 60 * 1000
        });
        assert.strictEqual(removed, 2);
    });
});
