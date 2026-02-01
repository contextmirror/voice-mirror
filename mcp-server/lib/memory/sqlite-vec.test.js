/**
 * Tests for sqlite-vec integration
 * Verifies extension loading, vector CRUD, and native search
 */
const { describe, it, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert');
const path = require('path');
const fs = require('fs');
const os = require('os');

const {
    loadSqliteVecExtension,
    ensureVectorTable,
    getVectorTableDimensions,
    upsertVector,
    searchVectors,
    deleteVector
} = require('./sqlite-vec');

function createTestDb() {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqlite-vec-test-'));
    const dbPath = path.join(dir, 'test.db');
    const Database = require('better-sqlite3');
    const db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    return { db, dir, dbPath };
}

function cleanup(db, dir) {
    try { db.close(); } catch {}
    try { fs.rmSync(dir, { recursive: true }); } catch {}
}

describe('sqlite-vec extension', () => {
    let db, dir;

    beforeEach(() => {
        ({ db, dir } = createTestDb());
    });

    afterEach(() => {
        cleanup(db, dir);
    });

    it('should load sqlite-vec extension', () => {
        const result = loadSqliteVecExtension({ db });
        // sqlite-vec may or may not be installed; test gracefully
        assert.ok(typeof result.ok === 'boolean');
        if (!result.ok) {
            console.log('  (sqlite-vec not available, skipping native vector tests)');
        }
    });

    it('should create vector table with correct dimensions', () => {
        const result = loadSqliteVecExtension({ db });
        if (!result.ok) return; // skip if not available

        ensureVectorTable(db, 768);
        const dims = getVectorTableDimensions(db);
        assert.strictEqual(dims, 768);
    });

    it('should recreate vector table on dimension change', () => {
        const result = loadSqliteVecExtension({ db });
        if (!result.ok) return;

        ensureVectorTable(db, 768);
        assert.strictEqual(getVectorTableDimensions(db), 768);

        ensureVectorTable(db, 1536);
        assert.strictEqual(getVectorTableDimensions(db), 1536);
    });

    it('should insert and search vectors', () => {
        const result = loadSqliteVecExtension({ db });
        if (!result.ok) return;

        const dims = 4;
        ensureVectorTable(db, dims);

        upsertVector(db, 'chunk_1', [1.0, 0.0, 0.0, 0.0]);
        upsertVector(db, 'chunk_2', [0.0, 1.0, 0.0, 0.0]);
        upsertVector(db, 'chunk_3', [0.9, 0.1, 0.0, 0.0]);

        const results = searchVectors(db, [1.0, 0.0, 0.0, 0.0], 3);
        assert.strictEqual(results.length, 3);
        // chunk_1 should be closest (exact match)
        assert.strictEqual(results[0].id, 'chunk_1');
        assert.ok(results[0].distance < results[1].distance || results[0].distance === 0);
    });

    it('should delete vectors', () => {
        const result = loadSqliteVecExtension({ db });
        if (!result.ok) return;

        ensureVectorTable(db, 4);
        upsertVector(db, 'chunk_1', [1.0, 0.0, 0.0, 0.0]);
        upsertVector(db, 'chunk_2', [0.0, 1.0, 0.0, 0.0]);

        deleteVector(db, 'chunk_1');
        const results = searchVectors(db, [1.0, 0.0, 0.0, 0.0], 10);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].id, 'chunk_2');
    });

    it('should upsert (replace) vectors', () => {
        const result = loadSqliteVecExtension({ db });
        if (!result.ok) return;

        ensureVectorTable(db, 4);
        upsertVector(db, 'chunk_1', [1.0, 0.0, 0.0, 0.0]);
        upsertVector(db, 'chunk_1', [0.0, 1.0, 0.0, 0.0]); // update

        const results = searchVectors(db, [0.0, 1.0, 0.0, 0.0], 1);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].id, 'chunk_1');
        assert.ok(results[0].distance < 0.01, 'Updated vector should be near query');
    });

    it('should return null dimensions when table does not exist', () => {
        const dims = getVectorTableDimensions(db);
        assert.strictEqual(dims, null);
    });
});

describe('SQLiteIndex sqlite-vec integration', () => {
    let index, dir;

    beforeEach(async () => {
        dir = fs.mkdtempSync(path.join(os.tmpdir(), 'sqliteindex-vec-test-'));
        const dbPath = path.join(dir, 'test.db');
        const SQLiteIndex = require('./SQLiteIndex');
        index = new SQLiteIndex(dbPath);
        await index.init();
    });

    afterEach(() => {
        index.close();
        try { fs.rmSync(dir, { recursive: true }); } catch {}
    });

    it('should set vectorReady flag on init', () => {
        assert.ok(typeof index.vectorReady === 'boolean');
    });

    it('should include vectorReady in stats', () => {
        const stats = index.getStats();
        assert.ok('vectorReady' in stats);
    });

    it('should initialize vector table for given dimensions', () => {
        if (!index.vectorReady) return;
        index.initVectorTable(768);
        // No error thrown = success
    });

    it('should upsert chunk with vector when vectorReady', () => {
        if (!index.vectorReady) return;
        index.initVectorTable(4);

        index.upsertChunk({
            id: 'test_chunk_1',
            path: '/test/file.md',
            startLine: 1,
            endLine: 10,
            hash: 'abc123',
            model: 'test-model',
            text: 'hello world',
            embedding: [1.0, 0.0, 0.0, 0.0],
            tier: 'stable'
        });

        // Verify it's in the vector table
        const results = index.searchVectorsNative([1.0, 0.0, 0.0, 0.0], 1);
        assert.ok(results);
        assert.strictEqual(results.length, 1);
        assert.strictEqual(results[0].id, 'test_chunk_1');
    });

    it('should delete vectors when deleting chunks for file', () => {
        if (!index.vectorReady) return;
        index.initVectorTable(4);

        index.upsertChunk({
            id: 'chunk_a',
            path: '/test/file.md',
            startLine: 1, endLine: 5,
            hash: 'h1', model: 'test', text: 'text a',
            embedding: [1.0, 0.0, 0.0, 0.0]
        });
        index.upsertChunk({
            id: 'chunk_b',
            path: '/test/file.md',
            startLine: 6, endLine: 10,
            hash: 'h2', model: 'test', text: 'text b',
            embedding: [0.0, 1.0, 0.0, 0.0]
        });

        index.deleteChunksForFile('/test/file.md');
        const results = index.searchVectorsNative([1.0, 0.0, 0.0, 0.0], 10);
        assert.ok(results);
        assert.strictEqual(results.length, 0);
    });

    it('should return null from searchVectorsNative when not available', () => {
        // Force vectorReady off
        const saved = index.vectorReady;
        index.vectorReady = false;
        const result = index.searchVectorsNative([1.0, 0.0], 5);
        assert.strictEqual(result, null);
        index.vectorReady = saved;
    });
});
