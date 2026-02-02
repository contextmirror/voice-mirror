/**
 * Voice Mirror Memory System - SQLite Schema
 * Database schema for the memory index
 */

/**
 * Create all required tables and indexes
 * @param {import('better-sqlite3').Database} db - SQLite database instance
 * @returns {{ftsAvailable: boolean, ftsError?: string}}
 */
function ensureSchema(db) {
    // Metadata table for tracking index version and settings
    db.exec(`
        CREATE TABLE IF NOT EXISTS meta (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );
    `);

    // File tracking for incremental updates
    db.exec(`
        CREATE TABLE IF NOT EXISTS files (
            path TEXT PRIMARY KEY,
            hash TEXT NOT NULL,
            mtime INTEGER NOT NULL,
            size INTEGER NOT NULL
        );
    `);

    // Chunk storage with embeddings
    db.exec(`
        CREATE TABLE IF NOT EXISTS chunks (
            id TEXT PRIMARY KEY,
            path TEXT NOT NULL,
            start_line INTEGER NOT NULL,
            end_line INTEGER NOT NULL,
            hash TEXT NOT NULL,
            model TEXT NOT NULL,
            text TEXT NOT NULL,
            embedding TEXT NOT NULL,
            tier TEXT DEFAULT 'stable',
            updated_at INTEGER NOT NULL
        );
    `);

    // Add source column if not present (migration)
    try {
        db.exec(`ALTER TABLE chunks ADD COLUMN source TEXT DEFAULT 'memory'`);
    } catch {
        // Column already exists
    }
    try {
        db.exec(`ALTER TABLE files ADD COLUMN source TEXT DEFAULT 'memory'`);
    } catch {
        // Column already exists
    }

    // Indexes for chunks
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_path ON chunks(path);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_tier ON chunks(tier);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_model ON chunks(model);`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_chunks_source ON chunks(source);`);

    // Embedding cache table
    db.exec(`
        CREATE TABLE IF NOT EXISTS embedding_cache (
            provider TEXT NOT NULL,
            model TEXT NOT NULL,
            text_hash TEXT NOT NULL,
            embedding TEXT NOT NULL,
            dims INTEGER,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (provider, model, text_hash)
        );
    `);

    db.exec(`CREATE INDEX IF NOT EXISTS idx_embedding_cache_updated ON embedding_cache(updated_at);`);

    // Try to create FTS5 virtual table for keyword search
    let ftsAvailable = false;
    let ftsError = null;

    try {
        db.exec(`
            CREATE VIRTUAL TABLE IF NOT EXISTS chunks_fts USING fts5(
                text,
                id UNINDEXED,
                path UNINDEXED,
                start_line UNINDEXED,
                end_line UNINDEXED
            );
        `);
        ftsAvailable = true;
    } catch (err) {
        ftsError = err.message;
        console.warn('FTS5 not available:', err.message);
    }

    return { ftsAvailable, ftsError };
}

/**
 * Get metadata value
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @returns {string | null}
 */
function getMeta(db, key) {
    const row = db.prepare('SELECT value FROM meta WHERE key = ?').get(key);
    return row ? row.value : null;
}

/**
 * Set metadata value
 * @param {import('better-sqlite3').Database} db
 * @param {string} key
 * @param {string} value
 */
function setMeta(db, key, value) {
    db.prepare(`
        INSERT INTO meta (key, value) VALUES (?, ?)
        ON CONFLICT(key) DO UPDATE SET value = excluded.value
    `).run(key, value);
}

/**
 * Get index metadata
 * @param {import('better-sqlite3').Database} db
 * @returns {Object | null}
 */
function getIndexMeta(db) {
    const value = getMeta(db, 'index_meta_v1');
    if (!value) return null;
    try {
        return JSON.parse(value);
    } catch {
        return null;
    }
}

/**
 * Set index metadata
 * @param {import('better-sqlite3').Database} db
 * @param {Object} meta
 */
function setIndexMeta(db, meta) {
    setMeta(db, 'index_meta_v1', JSON.stringify(meta));
}

/**
 * Drop all data tables (for full reindex)
 * @param {import('better-sqlite3').Database} db
 */
function dropAllData(db) {
    db.exec('DELETE FROM chunks');
    db.exec('DELETE FROM files');
    db.exec('DELETE FROM embedding_cache');

    // Try to clear FTS
    try {
        db.exec('DELETE FROM chunks_fts');
    } catch {
        // FTS might not exist
    }
}

module.exports = {
    ensureSchema,
    getIndexMeta,
    setIndexMeta,
    dropAllData
};
