/**
 * Voice Mirror Memory System - sqlite-vec Extension Loader
 * Provides native vector similarity search via sqlite-vec
 *
 * Ported from OpenClaw's sqlite-vec.ts
 */

/**
 * Load the sqlite-vec extension into a better-sqlite3 database
 * @param {Object} params
 * @param {import('better-sqlite3').Database} params.db - Database instance
 * @param {string} [params.extensionPath] - Optional manual path to extension
 * @returns {{ ok: boolean, extensionPath?: string, error?: string }}
 */
function loadSqliteVecExtension(params) {
    try {
        const sqliteVec = require('sqlite-vec');
        sqliteVec.load(params.db);
        return { ok: true };
    } catch (err) {
        return { ok: false, error: String(err) };
    }
}

/**
 * Create or recreate the chunks_vec virtual table
 * @param {import('better-sqlite3').Database} db
 * @param {number} dimensions - Embedding dimensions
 */
function ensureVectorTable(db, dimensions) {
    // Drop and recreate if exists (dimensions may have changed)
    db.exec('DROP TABLE IF EXISTS chunks_vec');
    db.exec(`CREATE VIRTUAL TABLE chunks_vec USING vec0(id TEXT PRIMARY KEY, embedding float[${dimensions}])`);
}

/**
 * Get the current dimensions of the chunks_vec table
 * @param {import('better-sqlite3').Database} db
 * @returns {number|null} Dimensions or null if table doesn't exist
 */
function getVectorTableDimensions(db) {
    try {
        // Try to read the table info; vec0 tables store dimensions in creation SQL
        const row = db.prepare("SELECT sql FROM sqlite_master WHERE name = 'chunks_vec'").get();
        if (!row) return null;
        const match = row.sql.match(/float\[(\d+)\]/);
        return match ? parseInt(match[1], 10) : null;
    } catch {
        return null;
    }
}

/**
 * Insert or update a vector in chunks_vec
 * @param {import('better-sqlite3').Database} db
 * @param {string} id - Chunk ID
 * @param {number[]} embedding - Embedding vector
 */
function upsertVector(db, id, embedding) {
    const blob = new Float32Array(embedding);
    const buf = Buffer.from(blob.buffer);
    // vec0 virtual tables don't support INSERT OR REPLACE; delete first
    try { db.prepare('DELETE FROM chunks_vec WHERE id = ?').run(id); } catch {}
    db.prepare('INSERT INTO chunks_vec (id, embedding) VALUES (?, ?)').run(id, buf);
}

/**
 * Search for nearest vectors
 * @param {import('better-sqlite3').Database} db
 * @param {number[]} queryVector - Query embedding
 * @param {number} limit - Max results
 * @returns {Array<{id: string, distance: number}>}
 */
function searchVectors(db, queryVector, limit) {
    const blob = new Float32Array(queryVector);
    const rows = db.prepare(
        'SELECT id, distance FROM chunks_vec WHERE embedding MATCH ? ORDER BY distance LIMIT ?'
    ).all(Buffer.from(blob.buffer), limit);
    return rows;
}

/**
 * Delete a vector by ID
 * @param {import('better-sqlite3').Database} db
 * @param {string} id - Chunk ID
 */
function deleteVector(db, id) {
    db.prepare('DELETE FROM chunks_vec WHERE id = ?').run(id);
}

module.exports = {
    loadSqliteVecExtension,
    ensureVectorTable,
    getVectorTableDimensions,
    upsertVector,
    searchVectors,
    deleteVector
};
