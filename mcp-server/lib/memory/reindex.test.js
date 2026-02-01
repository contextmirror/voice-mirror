/**
 * Tests for full reindex detection
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const SQLiteIndex = require('./SQLiteIndex');

describe('Full reindex detection', () => {
    let index, dir;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'reindex-test-'));
        index = new SQLiteIndex(path.join(dir, 'test.db'));
        await index.init();
    });

    afterEach(() => {
        index.close();
        try { fs.rmSync(dir, { recursive: true }); } catch {}
    });

    it('should need reindex when no metadata stored', () => {
        assert.strictEqual(index.needsFullReindex({
            provider: 'local', model: 'test', chunkTokens: 400, chunkOverlap: 80
        }), true);
    });

    it('should not need reindex when metadata matches', () => {
        const meta = { provider: 'local', model: 'test', chunkTokens: 400, chunkOverlap: 80 };
        index.updateIndexMeta(meta);
        assert.strictEqual(index.needsFullReindex(meta), false);
    });

    it('should need reindex when provider changes', () => {
        index.updateIndexMeta({ provider: 'local', model: 'test', chunkTokens: 400, chunkOverlap: 80 });
        assert.strictEqual(index.needsFullReindex({
            provider: 'openai', model: 'test', chunkTokens: 400, chunkOverlap: 80
        }), true);
    });

    it('should need reindex when model changes', () => {
        index.updateIndexMeta({ provider: 'local', model: 'v1', chunkTokens: 400, chunkOverlap: 80 });
        assert.strictEqual(index.needsFullReindex({
            provider: 'local', model: 'v2', chunkTokens: 400, chunkOverlap: 80
        }), true);
    });

    it('should need reindex when chunk tokens change', () => {
        index.updateIndexMeta({ provider: 'local', model: 'v1', chunkTokens: 400, chunkOverlap: 80 });
        assert.strictEqual(index.needsFullReindex({
            provider: 'local', model: 'v1', chunkTokens: 800, chunkOverlap: 80
        }), true);
    });

    it('should need reindex when chunk overlap changes', () => {
        index.updateIndexMeta({ provider: 'local', model: 'v1', chunkTokens: 400, chunkOverlap: 80 });
        assert.strictEqual(index.needsFullReindex({
            provider: 'local', model: 'v1', chunkTokens: 400, chunkOverlap: 160
        }), true);
    });

    it('clearAll should remove all data', () => {
        // Insert some data
        index.upsertFile('/test.md', 'hash1', Date.now(), 100);
        index.upsertChunk({
            id: 'chunk_1', path: '/test.md', startLine: 1, endLine: 5,
            hash: 'h1', model: 'test', text: 'hello', embedding: [1, 2, 3]
        });

        const statsBefore = index.getStats();
        assert.ok(statsBefore.files > 0);
        assert.ok(statsBefore.chunks > 0);

        index.clearAll();

        const statsAfter = index.getStats();
        assert.strictEqual(statsAfter.files, 0);
        assert.strictEqual(statsAfter.chunks, 0);
    });
});
